import { emptyRecord, own } from "../core/lookup.ts";
import type { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoBuildError, MilanoEngineError } from "../document/errors.ts";
import type { ActionSpec, ParsedDocument } from "../document/model.ts";
import type { MilanoUnknownTypePolicy } from "../engine/configuration.ts";
import type { MilanoEngine } from "../engine/engine.ts";
import type { MilanoOccurrence } from "../engine/observer.ts";
import type {
  MilanoAction as MilanoActionDeclaration,
  MilanoFunction as MilanoFunctionDeclaration,
} from "../engine/vocabulary.ts";
import type { EvalEnvironment } from "../expression/evaluator.ts";
import type { BuiltNode } from "../gate/gate.ts";
import { MilanoGate } from "../gate/gate.ts";
import { RepeatKeyConflict, countNodes, resolve } from "../gate/resolver.ts";
import type { MilanoContextSource } from "./context-source.ts";
import { StaticContextSource } from "./context-source.ts";
import type { MilanoDispatcher } from "./dispatcher.ts";
import { inlineDispatcher } from "./dispatcher.ts";
import type { MilanoActionHandler, MilanoStateDataProvider } from "./handlers.ts";
import type { ReplacementPlan } from "./view.ts";
import { MilanoView } from "./view.ts";

let viewCounter = 0;

function nextIdentity(): string {
  viewCounter += 1;
  return `milano-view-${viewCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The token every dispatch id of a view is minted from: unique per view
 * instance in the process, whatever the builder's label, so dispatch ids
 * never collide across views (state and actions spec, Dispatch identity).
 */
let instanceCounter = 0;

function nextInstanceToken(): string {
  instanceCounter += 1;
  return `${instanceCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What the gate produced for one document, before the data checks. */
interface Prepared {
  readonly gate: MilanoGate;
  readonly document: ParsedDocument;
  readonly root: BuiltNode;
  readonly lifecycle: Readonly<Record<string, readonly ActionSpec[]>>;
  readonly watch: Readonly<Record<string, readonly ActionSpec[]>>;
  /** Occurrences the gate detected, reported only when the build succeeds. */
  readonly pending: MilanoOccurrence[];
}

/**
 * The construction gate's public face: a MilanoView is created exclusively
 * through a builder, obtained from an engine. Configure and build once.
 */
export class MilanoViewBuilder<R = unknown, P = R> {
  /** The engine this view is built from; bindings read its registry. */
  readonly engine: MilanoEngine<R, P>;
  private readonly documentText: string;
  private readonly documentByteCount: number | null;

  private source: MilanoContextSource | null = null;
  private stateProvider: MilanoStateDataProvider | null = null;
  private handler: MilanoActionHandler | null = null;
  private viewDispatcher: MilanoDispatcher = inlineDispatcher;
  private policyOverride: MilanoUnknownTypePolicy | null = null;
  private viewLabel: string | null = null;
  private allowedActions: readonly string[] | null = null;
  private readonly declaredActions = emptyRecord<MilanoActionDeclaration>();
  private readonly declaredFunctions = emptyRecord<MilanoFunctionDeclaration>();

  constructor(
    engine: MilanoEngine<R, P>,
    documentText: string,
    documentByteCount: number | null = null,
  ) {
    this.engine = engine;
    this.documentText = documentText;
    this.documentByteCount = documentByteCount;
  }

  /**
   * Grants only the listed custom actions to this surface: a document
   * binding any other custom action fails at the gate with a
   * `SchemaViolation` (rule `action-capability`). Built-in `$` actions are
   * contract, not capabilities, and are always available.
   */
  allowActions(names: readonly string[]): this {
    this.allowedActions = [...names];
    return this;
  }

  /**
   * Declares (or overrides) a custom action for this surface: the name,
   * parameter shape, optional success result type, and optional failure
   * payload type join the granted set for this builder only.
   */
  action(
    name: string,
    declaration: {
      parameters?: Readonly<Record<string, MilanoType>>;
      result?: MilanoType | null;
      failure?: MilanoType | null;
    } = {},
  ): this {
    this.declaredActions[name] = {
      parameters: declaration.parameters ?? {},
      result: declaration.result ?? null,
      failure: declaration.failure ?? null,
    };
    return this;
  }

  /**
   * Declares (or overrides) a host function for this surface (contract
   * 2.1): its argument types in order and its return type join the
   * vocabulary's declarations for this builder only. The engine's function
   * handler resolves it by name like any other.
   */
  function(
    name: string,
    declaration: { arguments: readonly MilanoType[]; returns: MilanoType },
  ): this {
    this.declaredFunctions[name] = {
      arguments: [...declaration.arguments],
      returns: declaration.returns,
    };
    return this;
  }

  /** Supplies fixed context values for the keys the document declares. */
  context(values: Readonly<Record<string, MilanoValue>>): this {
    this.source = new StaticContextSource(values);
    return this;
  }

  /** Supplies an observable context source (see MilanoContextHandle). */
  contextSource(source: MilanoContextSource): this {
    this.source = source;
    return this;
  }

  stateData(provider: MilanoStateDataProvider): this {
    this.stateProvider = provider;
    return this;
  }

  /** The view's action handler; required when the document uses custom actions. */
  actionHandler(handler: MilanoActionHandler): this {
    this.handler = handler;
    return this;
  }

  /** The serialization seam; defaults to running inline on the JS thread. */
  dispatcher(dispatcher: MilanoDispatcher): this {
    this.viewDispatcher = dispatcher;
    return this;
  }

  /** Per-view override of the engine's default unknown-type policy. */
  unknownTypePolicy(policy: MilanoUnknownTypePolicy): this {
    this.policyOverride = policy;
    return this;
  }

  /** Host-chosen name attached to this view's observability reports. */
  label(label: string): this {
    this.viewLabel = label;
    return this;
  }

  /**
   * The surface's granted action set: vocabulary declarations, overridden
   * by builder declarations, narrowed by the allowlist.
   */
  private grantedActions(): Readonly<Record<string, MilanoActionDeclaration>> {
    const granted = Object.assign(
      emptyRecord<MilanoActionDeclaration>(),
      this.engine.vocabulary.actions,
      this.declaredActions,
    );
    if (this.allowedActions === null) return granted;
    const allowed = new Set(this.allowedActions);
    const narrowed = emptyRecord<MilanoActionDeclaration>();
    for (const [name, declaration] of Object.entries(granted)) {
      if (allowed.has(name)) narrowed[name] = declaration;
    }
    return narrowed;
  }

  /** The surface's declared host functions: the vocabulary's, overridden by the builder's. */
  private declaredFunctionSet(): Readonly<Record<string, MilanoFunctionDeclaration>> {
    return Object.assign(
      emptyRecord<MilanoFunctionDeclaration>(),
      this.engine.vocabulary.functions,
      this.declaredFunctions,
    );
  }

  /**
   * Steps 1 to 5 of the gate for one document under this surface's
   * configuration, plus the two handler checks. Shared by the first build
   * and every replacement.
   */
  private prepare(
    text: string,
    byteCount: number | null,
    identity: string,
    policy: MilanoUnknownTypePolicy,
  ): Prepared {
    const pending: MilanoOccurrence[] = [];
    const gate = new MilanoGate({
      vocabulary: this.engine.vocabulary,
      limits: this.engine.limits,
      policy,
      viewIdentity: identity,
      grantedActions: this.grantedActions(),
      declaredFunctions: this.declaredFunctionSet(),
      report: (occurrence) => pending.push(occurrence),
    });

    const { document, root, lifecycle, watch } = gate.validateDocument(text, byteCount);

    // A document using custom actions needs somewhere to send them, and
    // one calling host functions needs something to answer.
    if (gate.usesCustomActions && this.handler === null) {
      throw MilanoBuildError.schemaViolation("action-handler", null, "action handler", null);
    }
    if (gate.usedFunctions.size > 0 && this.engine.functionHandler === null) {
      throw MilanoBuildError.schemaViolation("function-handler", null, "function handler", null);
    }
    return { gate, document, root, lifecycle, watch, pending };
  }

  /**
   * A replacement's plan (state and actions spec, Document replacement):
   * the new document through the gate, and the provider's values for the
   * keys that do not carry over from the prior declarations, invoked once
   * with exactly those declarations, or not at all. The view completes
   * the swap on its dispatcher.
   */
  private async plan(
    text: string,
    byteCount: number | null,
    identity: string,
    policy: MilanoUnknownTypePolicy,
    priorDeclarations: Readonly<Record<string, MilanoType>>,
  ): Promise<ReplacementPlan> {
    const prepared = this.prepare(text, byteCount, identity, policy);
    const needed = emptyRecord<MilanoType>();
    for (const [key, type] of Object.entries(prepared.document.stateDeclarations)) {
      const previous = own(priorDeclarations, key);
      if (previous === undefined || !previous.equals(type)) needed[key] = type;
    }
    let provided: Readonly<Record<string, MilanoValue>> | null = null;
    if (Object.keys(needed).length > 0) {
      if (this.stateProvider === null) {
        throw MilanoBuildError.schemaViolation("state-declaration", null, "state data provider", null);
      }
      // Awaited here; the provider's own errors propagate unchanged.
      provided = await this.stateProvider(needed);
    }
    return { ...prepared, provided };
  }

  /**
   * Building is asynchronous: the document is parsed and validated in
   * full, then the state data provider is awaited and its values are
   * validated against the document's declarations. Throws typed
   * `MilanoBuildError`s; provider failures propagate unchanged.
   */
  async build(): Promise<MilanoView> {
    const identity = this.viewLabel ?? nextIdentity();
    const policy = this.policyOverride ?? this.engine.defaultUnknownTypePolicy;

    if (policy === "placeholder" && this.engine.registry.placeholder === null) {
      throw MilanoEngineError.incompleteRegistry(["(placeholder renderer)"]);
    }

    const { gate, document, root, lifecycle, watch, pending } = this.prepare(
      this.documentText,
      this.documentByteCount,
      identity,
      policy,
    );

    const context = gate.validateContext(document, this.source?.current ?? {});

    let state: Record<string, MilanoValue> = {};
    if (Object.keys(document.stateDeclarations).length > 0) {
      if (this.stateProvider === null) {
        throw MilanoBuildError.schemaViolation(
          "state-declaration",
          null,
          "state data provider",
          null,
        );
      }
      // Awaited here; the provider's own errors propagate unchanged.
      const provided = await this.stateProvider(document.stateDeclarations);
      state = gate.validateState(document, provided);
    }

    const env: EvalEnvironment = {
      functions: this.declaredFunctionSet(),
      handler: this.engine.functionHandler,
    };

    // Initial resolution: every property expression evaluated, every
    // `$repeat` materialized; the node count limit is measured on the
    // result, and a keyed repeat rendering one key twice is a data defect.
    let resolvedRoot;
    try {
      resolvedRoot = resolve(
        root,
        state,
        context,
        (kind, node, name, detail) => {
          pending.push({
            kind,
            viewIdentity: identity,
            node,
            name,
            expected: detail?.expected ?? null,
            found: detail?.found ?? null,
          });
        },
        {},
        [],
        env,
      );
    } catch (error) {
      if (error instanceof RepeatKeyConflict) {
        throw MilanoBuildError.schemaViolation("repeat", error.reference, "distinct key", error.key);
      }
      throw error;
    }
    const materialized = countNodes(resolvedRoot);
    if (materialized > this.engine.limits.maxNodeCount) {
      throw MilanoBuildError.limitExceeded("maxNodeCount", this.engine.limits.maxNodeCount, materialized);
    }

    // Only a successful build reports its occurrences.
    const observer = this.engine.observer;
    if (observer !== null) {
      for (const occurrence of pending) observer.occurrence(occurrence);
    }

    // The impression: the analytics stream opens with the built view,
    // carrying the document's metadata for attribution.
    this.engine.userInteractionObserver?.interaction({
      kind: "viewBuilt",
      viewIdentity: identity,
      node: null,
      name: null,
      dispatch: null,
      value: document.metadata,
    });

    const view = new MilanoView({
      identity,
      instanceToken: nextInstanceToken(),
      runtime: this.engine,
      document,
      root,
      lifecycle,
      watch,
      resolvedRoot,
      context,
      state,
      dispatcher: this.viewDispatcher,
      handler: this.handler,
      env,
      replacer: (text, byteCount, priorDeclarations) =>
        this.plan(text, byteCount, identity, policy, priorDeclarations),
    });

    // Context updates flow through the view's dispatcher and are validated
    // atomically there.
    if (this.source !== null) {
      const dispatcher = this.viewDispatcher;
      view.attachContextSubscription(
        this.source.subscribe((values) => {
          dispatcher.dispatch(() => view.applyContextUpdate(values));
        }),
      );
    }

    return view;
  }
}
