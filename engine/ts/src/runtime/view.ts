import { emptyRecord, hasOwn, own, recordFrom } from "../core/lookup.ts";
import type { MilanoType } from "../core/type.ts";
import { MilanoValue } from "../core/value.ts";
import { MilanoBuildError } from "../document/errors.ts";
import type { ActionSpec, DocValue, ParsedDocument } from "../document/model.ts";
import type { MilanoLimits } from "../engine/configuration.ts";
import type { MilanoUserInteractionKind, MilanoUserInteractionObserver } from "../engine/interaction.ts";
import type { MilanoObserver, MilanoOccurrence, MilanoOccurrenceKind } from "../engine/observer.ts";
import type { MilanoVocabulary } from "../engine/vocabulary.ts";
import type { EvalEnvironment, ReportDetail } from "../expression/evaluator.ts";
import { ExprEvaluator } from "../expression/evaluator.ts";
import type { BuiltNode, MilanoGate } from "../gate/gate.ts";
import type { DependencyNode, ResolvedNode } from "../gate/resolver.ts";
import {
  RepeatKeyConflict,
  countNodes,
  elementBindings,
  indexDependencies,
  indexOfIdentity,
  refresh,
  repeatElements,
  resolve,
  suffixOf,
} from "../gate/resolver.ts";
import type { MilanoDispatcher } from "./dispatcher.ts";
import type { MilanoAction, MilanoActionHandler } from "./handlers.ts";
import { isActionFailure } from "./handlers.ts";

export interface DispatchRecord {
  readonly action: MilanoAction;
  completed: boolean;
  readonly onSuccess: readonly ActionSpec[];
  readonly onFailure: readonly ActionSpec[];
  readonly capturedEvent: MilanoValue | null;
  /** The `$repeat` bindings in scope at dispatch, kept for follow-ups. */
  readonly capturedBindings: Bindings;
  readonly resultType: MilanoType | null;
  readonly failureType: MilanoType | null;
  readonly sourceNode: string | null;
  /**
   * Dispatched from a watch list: its follow-ups run with watches
   * suppressed too, since a watch never triggers a watch.
   */
  readonly fromWatch: boolean;
}

type Bindings = Readonly<Record<string, MilanoValue>>;

/** A lifecycle signal the host delivers (state and actions spec, Lifecycle signals). */
export type MilanoLifecycleSignal = "appear" | "disappear";

interface NodeEvents {
  readonly declared: Readonly<Record<string, MilanoType | null>>;
  readonly bindings: Readonly<Record<string, readonly ActionSpec[]>>;
  /** The enclosing `$repeat` constructs, outermost first. */
  readonly repeats: readonly BuiltNode[];
}

/** An instance in the current tree: its template and enclosing identities. */
interface InstanceLocation {
  readonly base: string;
  readonly identities: readonly string[];
}

/** An occurrence held back until the update that raised it is accepted. */
type HeldReport = [MilanoOccurrenceKind, string, string, ReportDetail | undefined];

/** What a materialization produced, or why it was refused. */
type Materialized =
  | {
      readonly kind: "tree";
      readonly tree: ResolvedNode;
      readonly count: number;
      readonly reports: HeldReport[];
    }
  | { readonly kind: "conflict"; readonly key: string };

/**
 * What a view needs from its engine: the vocabulary it validates against
 * and the two observation streams. An engine satisfies it structurally.
 */
export interface ViewRuntime {
  readonly vocabulary: MilanoVocabulary;
  readonly limits: MilanoLimits;
  readonly observer: MilanoObserver | null;
  readonly userInteractionObserver: MilanoUserInteractionObserver | null;
}

/**
 * A replacement's plan, prepared by the builder (state and actions spec,
 * Document replacement): the new document through the gate, and the
 * provider's values for the keys that do not carry over, or null when
 * every key carries over and the provider was not consulted.
 */
export interface ReplacementPlan {
  readonly gate: MilanoGate;
  readonly document: ParsedDocument;
  readonly root: BuiltNode;
  readonly lifecycle: Readonly<Record<string, readonly ActionSpec[]>>;
  readonly watch: Readonly<Record<string, readonly ActionSpec[]>>;
  readonly pending: MilanoOccurrence[];
  readonly provided: Readonly<Record<string, MilanoValue>> | null;
}

export type Replacer = (
  text: string,
  byteCount: number | null,
  priorDeclarations: Readonly<Record<string, MilanoType>>,
) => Promise<ReplacementPlan>;

export interface ViewOptions {
  readonly identity: string;
  /** Unique per view instance in the process; dispatch ids are minted from it. */
  readonly instanceToken: string;
  readonly runtime: ViewRuntime;
  readonly document: ParsedDocument;
  readonly root: BuiltNode;
  /** The document's lifecycle bindings, validated by the gate. */
  readonly lifecycle: Readonly<Record<string, readonly ActionSpec[]>>;
  /** The document's watch bindings, validated by the gate. */
  readonly watch: Readonly<Record<string, readonly ActionSpec[]>>;
  readonly resolvedRoot: ResolvedNode;
  readonly context: Readonly<Record<string, MilanoValue>>;
  readonly state: Readonly<Record<string, MilanoValue>>;
  readonly dispatcher: MilanoDispatcher;
  readonly handler: MilanoActionHandler | null;
  /** The host functions the surface declares and the engine's handler. */
  readonly env: EvalEnvironment;
  /** Prepares a replacement under the builder's configuration; null when unsupported. */
  readonly replacer: Replacer | null;
}

/**
 * A built view, bound to one document at a time. Everything mutable runs
 * through the view's dispatcher and its work queue, so an update never
 * lands mid-action-list.
 */
export class MilanoView {
  readonly identity: string;
  private readonly runtime: ViewRuntime;
  private readonly instanceToken: string;

  /** @internal The parsed document; the view's own business. */
  private currentDocument: ParsedDocument;
  private root: BuiltNode;
  private lifecycle: Readonly<Record<string, readonly ActionSpec[]>>;
  private watch: Readonly<Record<string, readonly ActionSpec[]>>;
  /** What every expression reads, indexed once per document: the update path's map. */
  private dependencies: DependencyNode;
  private readonly limits: MilanoLimits;
  private readonly dispatcher: MilanoDispatcher;
  private readonly handler: MilanoActionHandler | null;
  private readonly env: EvalEnvironment;
  private readonly replacer: Replacer | null;
  private readonly nodeEvents = new Map<string, NodeEvents>();
  private readonly listeners = new Set<() => void>();

  /**
   * One serialized work queue: action lists and context updates both run
   * through it, so a re-entrant post cannot interleave with a list.
   */
  private readonly queue: { run: () => void; drop: ((error: Error) => void) | null }[] = [];
  private processing = false;
  private tornDown = false;
  /** The lifecycle state: appear is accepted only while false, disappear only while true. */
  private appeared = false;
  /**
   * Above zero while a watch list, or a follow-up of a dispatch made from
   * one, is executing: mutations then trigger no watch (state and actions
   * spec, Watch bindings).
   */
  private watchDepth = 0;
  /**
   * Dispatches below this index belong to a document since replaced:
   * their completions are dropped and reported.
   */
  private replacedBefore = 0;

  private currentResolvedRoot: ResolvedNode;
  private currentContext: Readonly<Record<string, MilanoValue>>;
  private currentState: Readonly<Record<string, MilanoValue>>;
  /**
   * Instance reference to its template and identities, for the current
   * tree; built on the first emission after a commit, since references
   * are compared, never parsed.
   */
  private instanceIndex: Map<string, InstanceLocation> | null = null;

  /** Cancels the context source subscription; invoked at teardown. */
  private cancelContextSubscription: (() => void) | null = null;

  /**
   * The dispatch log, private because `complete()` addresses it by index
   * and the completion guard lives on its records.
   */
  private readonly records: DispatchRecord[] = [];

  /** @internal Views are created by the builder, never by hosts. */
  constructor(options: ViewOptions) {
    this.identity = options.identity;
    this.instanceToken = options.instanceToken;
    this.runtime = options.runtime;
    this.currentDocument = options.document;
    this.root = options.root;
    this.lifecycle = options.lifecycle;
    this.watch = options.watch;
    this.dependencies = indexDependencies(options.root);
    this.limits = options.runtime.limits;
    this.dispatcher = options.dispatcher;
    this.handler = options.handler;
    this.env = options.env;
    this.replacer = options.replacer;
    this.currentResolvedRoot = options.resolvedRoot;
    this.currentContext = options.context;
    this.currentState = options.state;
    this.indexNodes(options.root);
  }

  /** @internal The parsed document the view is currently bound to. */
  get document(): ParsedDocument {
    return this.currentDocument;
  }

  /**
   * The custom actions dispatched so far, in order, as plain data. Hosts
   * and the conformance harness read it; nothing about the view can be
   * changed through it.
   */
  get dispatched(): readonly MilanoAction[] {
    return this.records.map((record) => record.action);
  }

  /**
   * Installs the context source's cancellation, once, at build. Calling it
   * again is a no-op: the first subscription is the view's.
   */
  attachContextSubscription(cancel: () => void): void {
    if (this.cancelContextSubscription !== null || this.tornDown) {
      cancel();
      return;
    }
    this.cancelContextSubscription = cancel;
  }

  /** The resolved tree: a new object identity after every re-resolution. */
  get resolvedRoot(): ResolvedNode {
    return this.currentResolvedRoot;
  }

  /** A copy: the engine's own state is never handed out to be edited. */
  get state(): Readonly<Record<string, MilanoValue>> {
    return recordFrom(this.currentState);
  }

  /** A copy, for the same reason as `state`. */
  get context(): Readonly<Record<string, MilanoValue>> {
    return recordFrom(this.currentContext);
  }

  /**
   * The document's `metadata` section, verbatim and untyped: producer
   * annotations reach host code without a side channel.
   */
  get metadata(): MilanoValue | null {
    return this.currentDocument.metadata;
  }

  /** Notifies after every re-resolution; the React binding subscribes here. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * A renderer emission. Undeclared events and mis-typed payloads are
   * dropped and reported before reaching dispatch; declared events with no
   * binding are dropped and reported.
   */
  emit(node: string, event: string, payload: MilanoValue | null = null): void {
    this.dispatcher.dispatch(() => this.processEmission(node, event, payload));
  }

  /**
   * The host's signal that the view has come on screen: accepted while
   * not appeared, ignored otherwise, and after teardown. An accepted
   * signal dispatches the document's `appear` bindings, if any.
   */
  appear(): void {
    this.dispatcher.dispatch(() => this.processLifecycle("appear"));
  }

  /** The host's signal that the view has left the screen; the mirror of `appear`. */
  disappear(): void {
    this.dispatcher.dispatch(() => this.processLifecycle("disappear"));
  }

  /**
   * Reports a widget interaction to the engine's user-interaction stream,
   * for signals the document does not model as events. Never touches
   * dispatch or state.
   */
  userInteraction(
    kind: MilanoUserInteractionKind,
    node: string,
    value: MilanoValue | null = null,
  ): void {
    this.record(kind, node, null, value);
  }

  /**
   * Replaces the document the view is bound to (state and actions spec,
   * Document replacement): the new document passes the gate under the
   * surface's configuration, state whose declaration is unchanged carries
   * over, the provider supplies the rest, and the swap lands on the
   * dispatcher, serialized with dispatch. Throws what `build()` throws; on
   * a throw the view is exactly as it was. Ignored after teardown.
   */
  async replace(document: string | Uint8Array): Promise<void> {
    if (this.tornDown || this.replacer === null) return;
    let text: string;
    let byteCount: number | null;
    if (typeof document === "string") {
      text = document;
      byteCount = null;
    } else {
      if (typeof TextDecoder === "undefined") {
        throw new Error("TextDecoder is required to replace a document from bytes");
      }
      text = new TextDecoder("utf-8").decode(document);
      byteCount = document.byteLength;
    }
    // The gate and the provider run before anything touches the view; the
    // swap itself is one queued unit, so it never lands mid-action-list.
    const plan = await this.replacer(text, byteCount, this.currentDocument.stateDeclarations);
    await new Promise<void>((settle, fail) => {
      this.dispatcher.dispatch(() => {
        this.enqueue(
          () => {
            try {
              this.swap(plan);
              settle();
            } catch (error) {
              fail(error);
            }
          },
          // A throw that clears the queue ahead of the swap leaves the
          // view as it was; the caller hears that instead of waiting.
          fail,
        );
      });
    });
  }

  /**
   * The view ceases to participate: completions arriving afterwards drop
   * their follow-ups and report.
   */
  teardown(): void {
    this.cancelContextSubscription?.();
    this.cancelContextSubscription = null;
    this.dispatcher.dispatch(() => {
      if (this.tornDown) return;
      this.tornDown = true;
      this.record("viewTornDown", null, null, null);
      // Nothing will notify again: holding the listeners would pin the
      // host's component scope for as long as anything holds the view.
      this.listeners.clear();
    });
  }

  applyContextUpdate(supplied: Readonly<Record<string, MilanoValue>>): void {
    // Serialized with dispatch through the queue.
    this.enqueue(() => this.performContextUpdate(supplied));
  }

  /**
   * Internal completion path; the async funnel lands here, and the
   * conformance harness drives it directly.
   */
  complete(dispatchIndex: number, success: boolean, payload: MilanoValue | null = null): void {
    const record = this.records[dispatchIndex];
    if (record === undefined) return;
    const action = record.action.name;
    if (this.tornDown) {
      this.report("completionAfterTeardown", null, { name: action });
      return;
    }
    if (record.completed) {
      this.report("duplicateCompletion", null, { name: action });
      return;
    }
    record.completed = true;
    // A dispatch of a document since replaced: its follow-ups belong to a
    // document that no longer exists. It still counts as completed.
    if (dispatchIndex < this.replacedBefore) {
      this.report("completionAfterReplace", null, { name: action });
      return;
    }

    // The completion's value against the declared type for its outcome:
    // a missing value counts as null, a value for an outcome declaring no
    // type never validates. An invalid completion is consumed without
    // running either branch.
    const declared = success ? record.resultType : record.failureType;
    let value: MilanoValue | null = null;
    if (declared !== null) {
      const validated = declared.validated(payload ?? MilanoValue.null);
      if (validated === null) {
        this.report("invalidCompletion", null, {
          name: action,
          expected: declared.name,
          found: (payload ?? MilanoValue.null).kind,
        });
        return;
      }
      value = validated;
    } else if (payload !== null) {
      this.report("invalidCompletion", null, {
        name: action,
        expected: success ? "no result" : "no payload",
        found: payload.kind,
      });
      return;
    }

    this.record(
      success ? "completionSucceeded" : "completionFailed",
      record.sourceNode,
      record.action.name,
      value,
      record.action.dispatch,
    );

    const followUps = success ? record.onSuccess : record.onFailure;
    if (followUps.length > 0) {
      const captured = record.capturedEvent;
      const bindings = record.capturedBindings;
      const source = record.sourceNode;
      const result = success ? value : null;
      const failure = success ? null : value;
      this.enqueue(() => {
        // Follow-ups of a dispatch made from a watch list run with watches
        // suppressed, like the list itself.
        if (record.fromWatch) this.watchDepth += 1;
        try {
          this.execute(followUps, captured, result, source, bindings, failure);
        } finally {
          if (record.fromWatch) this.watchDepth -= 1;
        }
      });
    }
  }

  private indexNodes(node: BuiltNode, repeats: readonly BuiltNode[] = []): void {
    if (node.repeat !== null) {
      for (const template of node.children) this.indexNodes(template, [...repeats, node]);
      return;
    }
    // A construct's branches hold ordinary nodes that are simply not
    // reached through `children`. Missing them here leaves their
    // emissions with no binding to find, reported as invalidEmission.
    if (node.conditional !== null) {
      for (const child of node.conditional.then) this.indexNodes(child, repeats);
      for (const child of node.conditional.otherwise) this.indexNodes(child, repeats);
      return;
    }
    if (node.choice !== null) {
      for (const branch of Object.values(node.choice.cases)) {
        for (const child of branch) this.indexNodes(child, repeats);
      }
      for (const child of node.choice.fallback ?? []) this.indexNodes(child, repeats);
      return;
    }
    if (!node.isPlaceholder) {
      const component = own(this.runtime.vocabulary.components, node.type);
      if (component !== undefined) {
        this.nodeEvents.set(node.reference, {
          declared: component.events,
          bindings: node.events,
          repeats,
        });
      }
    }
    for (const child of node.children) this.indexNodes(child, repeats);
  }

  /** Where every instance of the current tree comes from, built on demand. */
  private locate(reference: string): InstanceLocation | undefined {
    if (this.instanceIndex === null) {
      const index = new Map<string, InstanceLocation>();
      const walk = (node: ResolvedNode): void => {
        if (node.identities.length > 0) {
          index.set(node.reference, { base: node.base, identities: node.identities });
        }
        for (const child of node.children) walk(child);
      };
      walk(this.currentResolvedRoot);
      this.instanceIndex = index;
    }
    return this.instanceIndex.get(reference);
  }

  /**
   * The `$repeat` bindings an instance's emission dispatches with: the
   * element each identity names, evaluated now, outermost repeat first.
   * Null when an identity no longer names an element, with the detail the
   * report carries.
   */
  private bindingsFor(
    info: NodeEvents,
    identities: readonly string[],
  ): { bindings: Bindings } | { missing: string } {
    let bindings: Bindings = {};
    const enclosing: string[] = [];
    for (let level = 0; level < info.repeats.length; level += 1) {
      const repeat = info.repeats[level] as BuiltNode;
      const identity = identities[level] as string;
      const reference = repeat.reference + suffixOf(enclosing);
      const elements = repeatElements(repeat, reference, this.currentState, this.currentContext, () => {}, bindings, this.env);
      const keyed = repeat.repeat?.key !== null;
      let index: number;
      if (keyed) {
        // The first element rendering the key; the keys of the current
        // tree are distinct by the invariant every accepted update keeps.
        index = indexOfIdentity(repeat, reference, elements, identity, this.currentState, this.currentContext, () => {}, bindings, this.env);
        if (index < 0) return { missing: `key ${identity}` };
      } else {
        index = /^\d+$/.test(identity) ? Number(identity) : -1;
        if (index < 0 || elements[index] === undefined) return { missing: `index ${identity}` };
      }
      bindings = elementBindings((repeat.repeat as { as: string }).as, elements[index] as MilanoValue, index, bindings);
      enclosing.push(identity);
    }
    return { bindings };
  }

  private processEmission(node: string, event: string, payload: MilanoValue | null): void {
    if (this.tornDown) return;
    // A plain reference, or an instance reference: located in the current
    // tree, never parsed, so a key may contain any character.
    let info = this.nodeEvents.get(node);
    let identities: readonly string[] = [];
    if (info === undefined || info.repeats.length > 0) {
      const located = this.locate(node);
      if (located !== undefined) {
        const candidate = this.nodeEvents.get(located.base);
        info = candidate !== undefined && candidate.repeats.length === located.identities.length
          ? candidate
          : undefined;
        identities = located.identities;
      } else {
        // Not in the current tree: an instance that has vanished, which
        // the report names, or a node that never existed.
        const vanished = this.vanishedInstance(node);
        if (vanished !== null) {
          this.report("invalidEmission", node, {
            name: event,
            expected: "repeat element",
            found: vanished,
          });
          return;
        }
        info = undefined;
      }
    }
    if (info === undefined) {
      this.report("invalidEmission", node, {
        name: event,
        expected: "declared event",
        found: "unknown node",
      });
      return;
    }
    const bound = this.bindingsFor(info, identities);
    if ("missing" in bound) {
      this.report("invalidEmission", node, {
        name: event,
        expected: "repeat element",
        found: bound.missing,
      });
      return;
    }
    const bindings = bound.bindings;
    if (!hasOwn(info.declared, event)) {
      this.report("invalidEmission", node, {
        name: event,
        expected: "declared event",
        found: "undeclared event",
      });
      return;
    }

    // Payload against the declared type: payload-less events take none.
    const declaredPayload = own(info.declared, event) ?? null;
    let eventValue: MilanoValue | null = null;
    if (declaredPayload !== null) {
      const validated = payload === null ? null : declaredPayload.validated(payload);
      if (validated === null) {
        this.report("invalidEmission", node, {
          name: event,
          expected: declaredPayload.name,
          found: payload === null ? "null" : payload.kind,
        });
        return;
      }
      eventValue = validated;
    } else if (payload !== null) {
      this.report("invalidEmission", node, {
        name: event,
        expected: "no payload",
        found: payload.kind,
      });
      return;
    }

    // Analytics sees every declared emission with a valid payload, before
    // the binding lookup: unbound taps are signal for the host even while
    // droppedEvent keeps its defect meaning.
    this.record("event", node, event, eventValue);

    const actions = own(info.bindings, event);
    if (actions === undefined || actions.length === 0) {
      this.report("droppedEvent", node, { name: event });
      return;
    }
    this.enqueue(() => this.execute(actions, eventValue, null, node, bindings));
  }

  /**
   * An emission naming an instance the current tree no longer has: the
   * reference ends in bracketed identities whose template is a repeated
   * node. The detail names the last identity, as an index or a key by the
   * innermost repeat's shape.
   */
  private vanishedInstance(reference: string): string | null {
    const parts: string[] = [];
    let base = reference;
    for (;;) {
      const match = /\[([^\[\]]*)\]$/.exec(base);
      if (match === null) break;
      parts.unshift(match[1] as string);
      base = base.slice(0, match.index);
    }
    if (parts.length === 0) return null;
    const info = this.nodeEvents.get(base);
    if (info === undefined || info.repeats.length !== parts.length) return null;
    const innermost = info.repeats[info.repeats.length - 1] as BuiltNode;
    const last = parts[parts.length - 1] as string;
    return innermost.repeat?.key !== null ? `key ${last}` : `index ${last}`;
  }

  private processLifecycle(signal: MilanoLifecycleSignal): void {
    if (this.tornDown) return;
    // A redundant signal carries no work: ignored silently.
    if (this.appeared === (signal === "appear")) return;
    this.appeared = signal === "appear";
    this.record(signal === "appear" ? "viewAppeared" : "viewDisappeared", null, null, null);
    const actions = own(this.lifecycle, signal);
    if (actions === undefined || actions.length === 0) return;
    this.enqueue(() => this.execute(actions, null, null, null, {}));
  }

  private performContextUpdate(supplied: Readonly<Record<string, MilanoValue>>): void {
    if (this.tornDown) return;
    // Atomic: all declared keys validate or the whole update is rejected.
    const canonical = emptyRecord<MilanoValue>();
    const changed = new Set<string>();
    let lastKey: string | null = null;
    for (const [key, type] of Object.entries(this.currentDocument.contextDeclarations)) {
      const value = own(supplied, key);
      const validated = value === undefined ? null : type.validated(value);
      if (validated === null) {
        this.report("rejectedContextUpdate", null, {
          name: key,
          expected: type.name,
          found: value === undefined ? "missing" : value.kind,
        });
        return;
      }
      // A value past the value size limit rejects the update whole.
      const size = validated.size;
      if (size > this.limits.maxValueSize) {
        this.report("rejectedContextUpdate", null, {
          name: key,
          expected: "maxValueSize",
          found: String(size),
        });
        return;
      }
      canonical[key] = validated;
      const previous = own(this.currentContext, key);
      if (previous === undefined || !previous.equals(validated)) changed.add(`context.${key}`);
      lastKey = key;
    }
    // Only what reads a changed key re-evaluates; an update that changes
    // no value changes nothing. A tree materialized past the node count
    // limit, or a keyed repeat rendering one key twice, rejects the
    // update whole.
    if (changed.size === 0) {
      this.currentContext = canonical;
      return;
    }
    const materialized = this.materialize(changed, this.currentState, canonical);
    if (materialized.kind === "conflict") {
      this.report("rejectedContextUpdate", null, {
        name: lastKey ?? undefined,
        expected: "distinct key",
        found: materialized.key,
      });
      return;
    }
    if (materialized.count > this.limits.maxNodeCount) {
      this.report("rejectedContextUpdate", null, {
        name: lastKey ?? undefined,
        expected: "maxNodeCount",
        found: String(materialized.count),
      });
      return;
    }
    this.currentContext = canonical;
    this.commit(materialized);
  }

  /**
   * The swap of a replacement (state and actions spec, Document
   * replacement), one queued unit: the held context against the new
   * declarations, state carried where the declaration is unchanged and
   * taken from the provider otherwise, the tree resolved whole; any
   * failure throws before anything changes. Then the view adopts the new
   * document, keeps its identity, numbering, and appeared state, and
   * reports what the gate held back.
   */
  private swap(plan: ReplacementPlan): void {
    if (this.tornDown) return;
    const gate = plan.gate;
    const document = plan.document;
    const context = gate.validateContext(document, this.currentContext);

    const merged = emptyRecord<MilanoValue>();
    for (const [key, type] of Object.entries(document.stateDeclarations)) {
      const previous = own(this.currentDocument.stateDeclarations, key);
      const current = own(this.currentState, key);
      if (previous !== undefined && current !== undefined && previous.equals(type)) {
        merged[key] = current;
      } else if (plan.provided !== null) {
        const provided = own(plan.provided, key);
        if (provided !== undefined) merged[key] = provided;
      }
    }
    const state =
      Object.keys(document.stateDeclarations).length > 0 ? gate.validateState(document, merged) : {};

    const pending = [...plan.pending];
    let tree: ResolvedNode;
    try {
      tree = resolve(
        plan.root,
        state,
        context,
        (kind, node, name, detail) => {
          pending.push({
            kind,
            viewIdentity: this.identity,
            node,
            name,
            expected: detail?.expected ?? null,
            found: detail?.found ?? null,
          });
        },
        {},
        [],
        this.env,
      );
    } catch (error) {
      if (error instanceof RepeatKeyConflict) {
        throw MilanoBuildError.schemaViolation("repeat", error.reference, "distinct key", error.key);
      }
      throw error;
    }
    const count = countNodes(tree);
    if (count > this.limits.maxNodeCount) {
      throw MilanoBuildError.limitExceeded("maxNodeCount", this.limits.maxNodeCount, count);
    }

    // Nothing above changed the view; from here everything does, at once.
    this.currentDocument = document;
    this.root = plan.root;
    this.lifecycle = plan.lifecycle;
    this.watch = plan.watch;
    this.dependencies = indexDependencies(plan.root);
    this.nodeEvents.clear();
    this.indexNodes(plan.root);
    this.currentContext = context;
    this.currentState = state;
    this.currentResolvedRoot = tree;
    this.instanceIndex = null;
    this.replacedBefore = this.records.length;
    const observer = this.runtime.observer;
    if (observer !== null) for (const occurrence of pending) observer.occurrence(occurrence);
    this.record("viewReplaced", null, null, document.metadata);
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Queues a unit of work. `drop` is told when the unit is discarded
   * unrun because a unit ahead of it threw, so whoever awaits it can stop.
   */
  private enqueue(run: () => void, drop: ((error: Error) => void) | null = null): void {
    this.queue.push({ run, drop });
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        (this.queue.shift() as { run: () => void }).run();
      }
    } finally {
      // A host listener or renderer that throws unwinds through here. The
      // queue is cleared and the flag released: the throw reaches the
      // caller, and the view stays usable instead of silently dying with
      // work stuck behind a flag that was never reset.
      const dropped = this.queue.splice(0);
      this.processing = false;
      for (const unit of dropped) {
        unit.drop?.(new Error("the view's work queue was cleared before this update ran"));
      }
    }
  }

  /**
   * Runs an action list. Returns false when the list ended early: a
   * mutation past a limit, producing a repeated key, or addressing an
   * index outside the array assigns nothing, is reported, and stops the
   * remaining actions of the dispatch; what the list already applied
   * stays.
   */
  private execute(
    actions: readonly ActionSpec[],
    event: MilanoValue | null,
    result: MilanoValue | null,
    sourceNode: string | null,
    bindings: Bindings = {},
    failure: MilanoValue | null = null,
  ): boolean {
    for (const action of actions) {
      switch (action.kind) {
        case "set":
        case "append":
        case "remove":
        case "update":
          if (!this.mutate(action, event, result, sourceNode, bindings, failure)) return false;
          break;

        case "arrayAction":
          // Unreachable: the gate replaces every parsed array action.
          throw new Error(`unvalidated ${action.name}`);

        case "sequence":
          if (!this.execute(action.actions, event, result, sourceNode, bindings, failure)) return false;
          break;

        case "when": {
          const takeThen = this.evaluate(action.condition, event, result, bindings, failure).boolValue === true;
          if (!this.execute(takeThen ? action.then : action.otherwise, event, result, sourceNode, bindings, failure)) {
            return false;
          }
          break;
        }

        case "custom": {
          const captured: Record<string, MilanoValue> = {};
          for (const [parameter, value] of Object.entries(action.parameters)) {
            captured[parameter] = this.evaluate(value, event, result, bindings, failure);
          }
          // The dispatch identity: the position among this view's
          // dispatches, and a process-unique id minted from the view
          // instance's token.
          const index = this.records.length;
          const dispatchedAction: MilanoAction = {
            name: action.name,
            parameters: captured,
            viewIdentity: this.identity,
            dispatch: index,
            dispatchId: `${this.instanceToken}#${index}`,
          };
          this.record(
            "actionDispatched",
            sourceNode,
            action.name,
            MilanoValue.record(captured),
            index,
          );
          this.records.push({
            action: dispatchedAction,
            completed: false,
            onSuccess: action.onSuccess,
            onFailure: action.onFailure,
            capturedEvent: event,
            capturedBindings: bindings,
            resultType: action.result,
            failureType: action.failure,
            sourceNode,
            fromWatch: this.watchDepth > 0,
          });
          // Dispatch does not wait: the sequence continues immediately.
          const handler = this.handler;
          if (handler !== null) {
            void (async () => {
              let payload: MilanoValue | null = null;
              let success: boolean;
              try {
                payload = (await handler(dispatchedAction)) ?? null;
                success = true;
              } catch (error) {
                // A MilanoActionFailure carries the failure payload; any
                // other error is a failure with none.
                payload = isActionFailure(error) ? error.value : null;
                success = false;
              }
              this.dispatcher.dispatch(() => this.complete(index, success, payload));
            })();
          }
          break;
        }
      }
    }
    return true;
  }

  /**
   * A state mutation (state and actions spec, Action execution): the value
   * `$set` assigns, or the array an array action produces, then the one
   * assignment path. Returns false when the mutation was rejected and the
   * list must end.
   */
  private mutate(
    action: Extract<ActionSpec, { kind: "set" | "append" | "remove" | "update" }>,
    event: MilanoValue | null,
    result: MilanoValue | null,
    sourceNode: string | null,
    bindings: Bindings,
    failure: MilanoValue | null,
  ): boolean {
    const key = action.key;
    const declared = own(this.currentDocument.stateDeclarations, key);
    const elementType = declared?.kind.kind === "array" ? declared.kind.element : null;
    const current = own(this.currentState, key) ?? MilanoValue.null;
    let next: MilanoValue;
    switch (action.kind) {
      case "set": {
        const evaluated = this.evaluate(action.value, event, result, bindings, failure);
        next = declared?.validated(evaluated) ?? evaluated;
        break;
      }
      case "append": {
        const evaluated = this.evaluate(action.value, event, result, bindings, failure);
        const element = elementType?.validated(evaluated) ?? evaluated;
        next = MilanoValue.array([...(current.arrayValue ?? []), element]);
        break;
      }
      case "remove": {
        const items = current.arrayValue ?? [];
        const at = this.evaluate(action.at, event, result, bindings, failure).intValue ?? 0n;
        if (at < 0n || at >= BigInt(items.length)) {
          this.report("rejectedMutation", sourceNode, {
            name: key,
            expected: "index in range",
            found: String(at),
          });
          return false;
        }
        next = MilanoValue.array(items.filter((_, index) => BigInt(index) !== at));
        break;
      }
      case "update": {
        const items = current.arrayValue ?? [];
        const at = this.evaluate(action.at, event, result, bindings, failure).intValue ?? 0n;
        const evaluated = this.evaluate(action.value, event, result, bindings, failure);
        if (at < 0n || at >= BigInt(items.length)) {
          this.report("rejectedMutation", sourceNode, {
            name: key,
            expected: "index in range",
            found: String(at),
          });
          return false;
        }
        const fieldType =
          elementType?.kind.kind === "record" ? own(elementType.kind.fields, action.field) : undefined;
        const fieldValue = fieldType?.validated(evaluated) ?? evaluated;
        const position = Number(at);
        const element = items[position] as MilanoValue;
        const updated = MilanoValue.record({
          ...(element.recordValue ?? {}),
          [action.field]: fieldValue,
        });
        next = MilanoValue.array(items.map((item, index) => (index === position ? updated : item)));
        break;
      }
    }
    return this.assign(key, next, sourceNode);
  }

  /**
   * The one assignment path: the value against the value size limit, the
   * no-change rule, the re-materialized tree against the node count limit
   * and the distinct-key invariant, then commit, then the key's watch.
   */
  private assign(key: string, validated: MilanoValue, sourceNode: string | null): boolean {
    const size = validated.size;
    if (size > this.limits.maxValueSize) {
      this.report("rejectedMutation", sourceNode, {
        name: key,
        expected: "maxValueSize",
        found: String(size),
      });
      return false;
    }
    const previous = own(this.currentState, key);
    // A value that did not change re-resolves nothing and triggers no watch.
    if (previous !== undefined && previous.equals(validated)) return true;
    const next = recordFrom(this.currentState);
    next[key] = validated;
    // Visible immediately: the properties that read this key re-resolve
    // before the next action. A tree materialized past the node count
    // limit, or a keyed repeat rendering one key twice, rejects the
    // mutation instead.
    const materialized = this.materialize(new Set([`state.${key}`]), next, this.currentContext);
    if (materialized.kind === "conflict") {
      this.report("rejectedMutation", sourceNode, {
        name: key,
        expected: "distinct key",
        found: materialized.key,
      });
      return false;
    }
    if (materialized.count > this.limits.maxNodeCount) {
      this.report("rejectedMutation", sourceNode, {
        name: key,
        expected: "maxNodeCount",
        found: String(materialized.count),
      });
      return false;
    }
    this.currentState = next;
    this.commit(materialized);
    this.runWatch(key);
    return true;
  }

  /**
   * The key's watch list, as part of the mutation that changed it (state
   * and actions spec, Watch bindings): before the next action of the list
   * that applied it, with no event root and no repeat binding, anchored to
   * no node. Never from inside a watch: a watch never triggers a watch. A
   * rejection inside ends the watch list only.
   */
  private runWatch(key: string): void {
    if (this.watchDepth > 0) return;
    const actions = own(this.watch, key);
    if (actions === undefined || actions.length === 0) return;
    this.watchDepth += 1;
    try {
      this.execute(actions, null, null, null, {});
    } finally {
      this.watchDepth -= 1;
    }
  }

  private evaluate(
    value: DocValue,
    event: MilanoValue | null,
    result: MilanoValue | null,
    bindings: Bindings = {},
    failure: MilanoValue | null = null,
  ): MilanoValue {
    switch (value.kind) {
      case "literal":
        return value.value;
      case "typedExpression": {
        const evaluator = new ExprEvaluator(
          this.currentState,
          this.currentContext,
          event,
          result,
          (kind, detail) => this.report(kind, null, detail),
          bindings,
          failure,
          this.env,
        );
        const evaluated = evaluator.evaluate(value.expr);
        return value.expected.validated(evaluated) ?? evaluated;
      }
      case "expression":
        return MilanoValue.null;
    }
  }

  /**
   * The tree an update would produce, with the reports it raised held
   * back: nothing reaches the observer until the update is accepted, and
   * a rejected one leaves no trace. A keyed repeat that would render one
   * key twice is a conflict, not a tree.
   */
  private materialize(
    changed: ReadonlySet<string>,
    state: Readonly<Record<string, MilanoValue>>,
    context: Readonly<Record<string, MilanoValue>>,
  ): Materialized {
    const reports: HeldReport[] = [];
    let tree: ResolvedNode;
    try {
      tree = refresh(
        this.root,
        this.dependencies,
        this.currentResolvedRoot,
        changed,
        state,
        context,
        (kind, node, name, detail) => reports.push([kind, node, name, detail]),
        this.env,
      );
    } catch (error) {
      if (error instanceof RepeatKeyConflict) return { kind: "conflict", key: error.key };
      throw error;
    }
    const count = tree === this.currentResolvedRoot ? 0 : countNodes(tree);
    return { kind: "tree", tree, count, reports };
  }

  /** Adopts a materialized tree, flushes its reports, notifies the host. */
  private commit(materialized: Extract<Materialized, { kind: "tree" }>): void {
    for (const [kind, node, name, detail] of materialized.reports) {
      this.report(kind, node, { name, expected: detail?.expected, found: detail?.found });
    }
    // Nothing depended on the change: the tree is the same object, and
    // there is nothing to tell the host.
    if (materialized.tree === this.currentResolvedRoot) return;
    this.currentResolvedRoot = materialized.tree;
    this.instanceIndex = null;
    for (const listener of [...this.listeners]) listener();
  }

  private report(
    kind: MilanoOccurrenceKind,
    node: string | null,
    detail: { name?: string; expected?: string; found?: string } = {},
  ): void {
    this.runtime.observer?.occurrence({
      kind,
      viewIdentity: this.identity,
      node,
      name: detail.name ?? null,
      expected: detail.expected ?? null,
      found: detail.found ?? null,
    });
  }

  /** The product-analytics seam: a no-op without an observer. */
  private record(
    kind: MilanoUserInteractionKind,
    node: string | null,
    name: string | null,
    value: MilanoValue | null,
    dispatch: number | null = null,
  ): void {
    this.runtime.userInteractionObserver?.interaction({
      kind,
      viewIdentity: this.identity,
      node,
      name,
      dispatch,
      value,
    });
  }
}
