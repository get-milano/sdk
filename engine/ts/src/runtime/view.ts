import { emptyRecord, hasOwn, own, recordFrom } from "../core/lookup.ts";
import type { MilanoType } from "../core/type.ts";
import { MilanoValue } from "../core/value.ts";
import type { ActionSpec, DocValue, ParsedDocument } from "../document/model.ts";
import type { MilanoLimits } from "../engine/configuration.ts";
import type { MilanoUserInteractionKind, MilanoUserInteractionObserver } from "../engine/interaction.ts";
import type { MilanoObserver, MilanoOccurrenceKind } from "../engine/observer.ts";
import type { MilanoVocabulary } from "../engine/vocabulary.ts";
import { ExprEvaluator } from "../expression/evaluator.ts";
import type { BuiltNode } from "../gate/gate.ts";
import type { DependencyNode, ResolvedNode } from "../gate/resolver.ts";
import { countNodes, elementBindings, indexDependencies, refresh, repeatElements } from "../gate/resolver.ts";
import type { MilanoDispatcher } from "./dispatcher.ts";
import type { MilanoAction, MilanoActionHandler } from "./handlers.ts";

export interface DispatchRecord {
  readonly action: MilanoAction;
  completed: boolean;
  readonly onSuccess: readonly ActionSpec[];
  readonly onFailure: readonly ActionSpec[];
  readonly capturedEvent: MilanoValue | null;
  /** The `$repeat` bindings in scope at dispatch, kept for follow-ups. */
  readonly capturedBindings: Bindings;
  readonly resultType: MilanoType | null;
  readonly sourceNode: string | null;
}

type Bindings = Readonly<Record<string, MilanoValue>>;

/**
 * An instance reference split into its template reference and the
 * element index per enclosing `$repeat`, outermost first: `line[2][0]`
 * is `line` at 2 then 0. A plain reference has no indices.
 */
function splitInstanceReference(reference: string): { base: string; indices: number[] } {
  const indices: number[] = [];
  let base = reference;
  for (;;) {
    const match = /\[(\d+)\]$/.exec(base);
    if (match === null) break;
    indices.unshift(Number(match[1]));
    base = base.slice(0, match.index);
  }
  return { base, indices };
}

interface NodeEvents {
  readonly declared: Readonly<Record<string, MilanoType | null>>;
  readonly bindings: Readonly<Record<string, readonly ActionSpec[]>>;
  /** The enclosing `$repeat` constructs, outermost first. */
  readonly repeats: readonly BuiltNode[];
}

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

export interface ViewOptions {
  readonly identity: string;
  readonly runtime: ViewRuntime;
  readonly document: ParsedDocument;
  readonly root: BuiltNode;
  readonly resolvedRoot: ResolvedNode;
  readonly context: Readonly<Record<string, MilanoValue>>;
  readonly state: Readonly<Record<string, MilanoValue>>;
  readonly dispatcher: MilanoDispatcher;
  readonly handler: MilanoActionHandler | null;
}

/**
 * A built view, bound to one document for its lifetime. Everything mutable
 * runs through the view's dispatcher and its work queue, so an update
 * never lands mid-action-list.
 */
export class MilanoView {
  readonly identity: string;
  /** @internal The parsed document; the view's own business. */
  readonly document: ParsedDocument;
  private readonly runtime: ViewRuntime;

  private readonly root: BuiltNode;
  /** What every expression reads, indexed once: the update path's map. */
  private readonly dependencies: DependencyNode;
  private readonly limits: MilanoLimits;
  private readonly dispatcher: MilanoDispatcher;
  private readonly handler: MilanoActionHandler | null;
  private readonly nodeEvents = new Map<string, NodeEvents>();
  private readonly listeners = new Set<() => void>();

  /**
   * One serialized work queue: action lists and context updates both run
   * through it, so a re-entrant post cannot interleave with a list.
   */
  private readonly queue: (() => void)[] = [];
  private processing = false;
  private tornDown = false;

  private currentResolvedRoot: ResolvedNode;
  private currentContext: Readonly<Record<string, MilanoValue>>;
  private currentState: Readonly<Record<string, MilanoValue>>;

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
    this.runtime = options.runtime;
    this.document = options.document;
    this.root = options.root;
    this.dependencies = indexDependencies(options.root);
    this.limits = options.runtime.limits;
    this.dispatcher = options.dispatcher;
    this.handler = options.handler;
    this.currentResolvedRoot = options.resolvedRoot;
    this.currentContext = options.context;
    this.currentState = options.state;
    this.indexNodes(options.root);
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
    return this.document.metadata;
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

    // The success value against the declared result type: a missing value
    // counts as null, a value on failure or on an action declaring no
    // result never validates. An invalid completion is consumed without
    // running either branch.
    let resultValue: MilanoValue | null = null;
    if (success && record.resultType !== null) {
      const validated = record.resultType.validated(payload ?? MilanoValue.null);
      if (validated === null) {
        this.report("invalidCompletion", null, {
          name: action,
          expected: record.resultType.name,
          found: (payload ?? MilanoValue.null).kind,
        });
        return;
      }
      resultValue = validated;
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
      null,
    );

    const followUps = success ? record.onSuccess : record.onFailure;
    if (followUps.length > 0) {
      const captured = record.capturedEvent;
      const bindings = record.capturedBindings;
      const source = record.sourceNode;
      this.enqueue(() => this.execute(followUps, captured, resultValue, source, bindings));
    }
  }

  private indexNodes(node: BuiltNode, repeats: readonly BuiltNode[] = []): void {
    if (node.repeat !== null) {
      for (const template of node.children) this.indexNodes(template, [...repeats, node]);
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

  /**
   * The `$repeat` bindings an instance's emission dispatches with: the
   * element at each index, evaluated now, outermost repeat first. Null
   * when an index no longer exists.
   */
  private bindingsFor(info: NodeEvents, indices: readonly number[]): Bindings | null {
    let bindings: Bindings = {};
    let suffix = "";
    for (let level = 0; level < info.repeats.length; level += 1) {
      const repeat = info.repeats[level] as BuiltNode;
      const index = indices[level] as number;
      const elements = repeatElements(
        repeat, repeat.reference + suffix, this.currentState, this.currentContext, () => {}, bindings,
      );
      const element = elements[index];
      if (element === undefined) return null;
      bindings = elementBindings((repeat.repeat as { as: string }).as, element, index, bindings);
      suffix += `[${index}]`;
    }
    return bindings;
  }

  private processEmission(node: string, event: string, payload: MilanoValue | null): void {
    if (this.tornDown) return;
    // A plain reference, or an instance reference: the template's
    // reference with one index per enclosing repeat.
    let info = this.nodeEvents.get(node);
    let indices: number[] = [];
    if (info === undefined || info.repeats.length > 0) {
      const split = splitInstanceReference(node);
      const candidate = this.nodeEvents.get(split.base);
      if (candidate !== undefined && candidate.repeats.length === split.indices.length) {
        info = candidate;
        indices = split.indices;
      } else {
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
    const bindings = this.bindingsFor(info, indices);
    if (bindings === null) {
      this.report("invalidEmission", node, {
        name: event,
        expected: "repeat element",
        found: `index ${indices[indices.length - 1] ?? 0}`,
      });
      return;
    }
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

  private performContextUpdate(supplied: Readonly<Record<string, MilanoValue>>): void {
    if (this.tornDown) return;
    // Atomic: all declared keys validate or the whole update is rejected.
    const canonical = emptyRecord<MilanoValue>();
    const changed = new Set<string>();
    let lastKey: string | null = null;
    for (const [key, type] of Object.entries(this.document.contextDeclarations)) {
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
    // limit rejects the update whole.
    if (changed.size === 0) {
      this.currentContext = canonical;
      return;
    }
    const materialized = this.materialize(changed, this.currentState, canonical);
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

  private enqueue(work: () => void): void {
    this.queue.push(work);
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        (this.queue.shift() as () => void)();
      }
    } finally {
      // A host listener or renderer that throws unwinds through here. The
      // queue is cleared and the flag released: the throw reaches the
      // caller, and the view stays usable instead of silently dying with
      // work stuck behind a flag that was never reset.
      this.queue.length = 0;
      this.processing = false;
    }
  }

  /**
   * Runs an action list. Returns false when the list ended early: a `$set`
   * past the value size limit assigns nothing, is reported, and stops the
   * remaining actions of the dispatch; what the list already applied
   * stays.
   */
  private execute(
    actions: readonly ActionSpec[],
    event: MilanoValue | null,
    result: MilanoValue | null,
    sourceNode: string | null,
    bindings: Bindings = {},
  ): boolean {
    for (const action of actions) {
      switch (action.kind) {
        case "set": {
          const declared = own(this.document.stateDeclarations, action.key);
          const evaluated = this.evaluate(action.value, event, result, bindings);
          const validated = declared?.validated(evaluated) ?? evaluated;
          const size = validated.size;
          if (size > this.limits.maxValueSize) {
            this.report("rejectedMutation", sourceNode, {
              name: action.key,
              expected: "maxValueSize",
              found: String(size),
            });
            return false;
          }
          const previous = own(this.currentState, action.key);
          // A value that did not change re-resolves nothing.
          if (previous !== undefined && previous.equals(validated)) break;
          const next = recordFrom(this.currentState);
          next[action.key] = validated;
          // Visible immediately: the properties that read this key
          // re-resolve before the next action. A tree materialized past
          // the node count limit rejects the mutation instead.
          const materialized = this.materialize(new Set([`state.${action.key}`]), next, this.currentContext);
          if (materialized.count > this.limits.maxNodeCount) {
            this.report("rejectedMutation", sourceNode, {
              name: action.key,
              expected: "maxNodeCount",
              found: String(materialized.count),
            });
            return false;
          }
          this.currentState = next;
          this.commit(materialized);
          break;
        }

        case "sequence":
          if (!this.execute(action.actions, event, result, sourceNode, bindings)) return false;
          break;

        case "when": {
          const takeThen = this.evaluate(action.condition, event, result, bindings).boolValue === true;
          if (!this.execute(takeThen ? action.then : action.otherwise, event, result, sourceNode, bindings)) {
            return false;
          }
          break;
        }

        case "custom": {
          const captured: Record<string, MilanoValue> = {};
          for (const [parameter, value] of Object.entries(action.parameters)) {
            captured[parameter] = this.evaluate(value, event, result, bindings);
          }
          const dispatchedAction: MilanoAction = {
            name: action.name,
            parameters: captured,
            viewIdentity: this.identity,
          };
          this.record(
            "actionDispatched",
            sourceNode,
            action.name,
            MilanoValue.record(captured),
          );
          const index = this.records.length;
          this.records.push({
            action: dispatchedAction,
            completed: false,
            onSuccess: action.onSuccess,
            onFailure: action.onFailure,
            capturedEvent: event,
            capturedBindings: bindings,
            resultType: action.result,
            sourceNode,
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
              } catch {
                payload = null;
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

  private evaluate(
    value: DocValue,
    event: MilanoValue | null,
    result: MilanoValue | null,
    bindings: Bindings = {},
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
          (kind) => this.report(kind, null),
          bindings,
        );
        const evaluated = evaluator.evaluate(value.expr);
        return value.expected.validated(evaluated) ?? evaluated;
      }
      case "expression":
        return MilanoValue.null;
    }
  }

  /**
   * The tree an update would produce, with the arithmetic reports it
   * raised held back: nothing reaches the observer until the update is
   * accepted, and a rejected one leaves no trace.
   */
  private materialize(
    changed: ReadonlySet<string>,
    state: Readonly<Record<string, MilanoValue>>,
    context: Readonly<Record<string, MilanoValue>>,
  ): { tree: ResolvedNode; count: number; reports: [MilanoOccurrenceKind, string, string][] } {
    const reports: [MilanoOccurrenceKind, string, string][] = [];
    const tree = refresh(
      this.root,
      this.dependencies,
      this.currentResolvedRoot,
      changed,
      state,
      context,
      (kind, node, name) => reports.push([kind, node, name]),
    );
    const count = tree === this.currentResolvedRoot ? 0 : countNodes(tree);
    return { tree, count, reports };
  }

  /** Adopts a materialized tree, flushes its reports, notifies the host. */
  private commit(materialized: { tree: ResolvedNode; reports: [MilanoOccurrenceKind, string, string][] }): void {
    for (const [kind, node, name] of materialized.reports) this.report(kind, node, { name });
    // Nothing depended on the change: the tree is the same object, and
    // there is nothing to tell the host.
    if (materialized.tree === this.currentResolvedRoot) return;
    this.currentResolvedRoot = materialized.tree;
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
  ): void {
    this.runtime.userInteractionObserver?.interaction({
      kind,
      viewIdentity: this.identity,
      node,
      name,
      value,
    });
  }
}
