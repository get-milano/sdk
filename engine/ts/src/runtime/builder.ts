import { emptyRecord } from "../core/lookup.ts";
import type { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoBuildError, MilanoEngineError } from "../document/errors.ts";
import type { MilanoUnknownTypePolicy } from "../engine/configuration.ts";
import type { MilanoEngine } from "../engine/engine.ts";
import type { MilanoOccurrence } from "../engine/observer.ts";
import type { MilanoAction as MilanoActionDeclaration } from "../engine/vocabulary.ts";
import { MilanoGate } from "../gate/gate.ts";
import { resolve } from "../gate/resolver.ts";
import type { MilanoContextSource } from "./context-source.ts";
import { StaticContextSource } from "./context-source.ts";
import type { MilanoDispatcher } from "./dispatcher.ts";
import { inlineDispatcher } from "./dispatcher.ts";
import type { MilanoActionHandler, MilanoStateDataProvider } from "./handlers.ts";
import { MilanoView } from "./view.ts";

let viewCounter = 0;

function nextIdentity(): string {
  viewCounter += 1;
  return `milano-view-${viewCounter}-${Math.random().toString(36).slice(2, 10)}`;
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
   * parameter shape, and optional success result type join the granted set
   * for this builder only.
   */
  action(
    name: string,
    declaration: {
      parameters?: Readonly<Record<string, MilanoType>>;
      result?: MilanoType | null;
    } = {},
  ): this {
    this.declaredActions[name] = {
      parameters: declaration.parameters ?? {},
      result: declaration.result ?? null,
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

    // The surface's granted action set: vocabulary declarations, overridden
    // by builder declarations, narrowed by the allowlist.
    let granted = Object.assign(
      emptyRecord<MilanoActionDeclaration>(),
      this.engine.vocabulary.actions,
      this.declaredActions,
    );
    if (this.allowedActions !== null) {
      const allowed = new Set(this.allowedActions);
      const narrowed = emptyRecord<MilanoActionDeclaration>();
      for (const [name, declaration] of Object.entries(granted)) {
        if (allowed.has(name)) narrowed[name] = declaration;
      }
      granted = narrowed;
    }

    const pending: MilanoOccurrence[] = [];
    const gate = new MilanoGate({
      vocabulary: this.engine.vocabulary,
      limits: this.engine.limits,
      policy,
      viewIdentity: identity,
      grantedActions: granted,
      report: (occurrence) => pending.push(occurrence),
    });

    const { document, root } = gate.validateDocument(this.documentText, this.documentByteCount);

    // A document using custom actions needs somewhere to send them.
    if (gate.usesCustomActions && this.handler === null) {
      throw MilanoBuildError.schemaViolation(
        "action-handler",
        null,
        "action handler",
        null,
      );
    }

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

    // Initial resolution: every property expression evaluated.
    const resolvedRoot = resolve(root, state, context, (kind, node) => {
      pending.push({ kind, viewIdentity: identity, node });
    });

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
      value: document.metadata,
    });

    const view = new MilanoView({
      identity,
      runtime: this.engine,
      document,
      root,
      resolvedRoot,
      context,
      state,
      dispatcher: this.viewDispatcher,
      handler: this.handler,
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
