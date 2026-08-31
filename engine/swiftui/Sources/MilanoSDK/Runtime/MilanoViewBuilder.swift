import Foundation

/// The construction gate's public face: a MilanoView is created exclusively
/// through a MilanoViewBuilder, obtained from a MilanoEngine.
///
/// Builders are not thread-safe: configure and build from one task
/// (the Sendable conformance exists for the async build boundary).
public final class MilanoViewBuilder: @unchecked Sendable {
    private let engine: MilanoEngine
    private let documentData: Data
    private var contextSource: (any MilanoContextSource)?
    private var stateProvider: (any MilanoStateDataProvider)?
    private var handler: (any MilanoActionHandler)?
    private var dispatcher: any MilanoDispatcher = MilanoMainDispatcher()
    private var policyOverride: MilanoUnknownTypePolicy?
    private var label: String?
    private var allowedActions: [String]?
    private var declaredActions: [String: MilanoVocabulary.Action] = [:]
    private var declaredFunctions: [String: MilanoVocabulary.Function] = [:]

    /// The gate's reports for one document, collected by reference so the
    /// gate's closure and the builder see one list; reported only when the
    /// build, or the replacement, succeeds.
    private final class PendingOccurrences {
        var items: [MilanoOccurrence] = []
    }

    /// What the gate produced for one document, before the data checks.
    private struct Prepared {
        let gate: MilanoGate
        let validated: ValidatedDocument
        let pending: PendingOccurrences
    }

    init(engine: MilanoEngine, documentData: Data) {
        self.engine = engine
        self.documentData = documentData
    }

    /// Grants only the listed custom actions to this surface: a document
    /// binding any other custom action fails at the gate with a
    /// `SchemaViolation` (rule `action-capability`). Built-in `$` actions
    /// are contract, not capabilities, and are always available.
    @discardableResult
    public func allowActions(_ names: [String]) -> Self {
        allowedActions = names
        return self
    }

    /// Declares (or overrides) a custom action for this surface: the name,
    /// parameter shape, optional success result type, and optional failure
    /// payload type join the granted set for this builder only.
    /// Declarations type the payload; meaning is assigned by this surface's
    /// action handler.
    @discardableResult
    public func action(
        _ name: String, parameters: [String: MilanoType] = [:], result: MilanoType? = nil,
        failure: MilanoType? = nil
    ) -> Self {
        declaredActions[name] = MilanoVocabulary.Action(
            parameters: parameters, result: result, failure: failure)
        return self
    }

    /// Declares (or overrides) a host function for this surface (contract
    /// 2.1): its argument types in order and its return type join the
    /// vocabulary's declarations for this builder only. The engine's
    /// function handler resolves it by name like any other.
    @discardableResult
    public func function(_ name: String, arguments: [MilanoType], returns: MilanoType) -> Self {
        declaredFunctions[name] = MilanoVocabulary.Function(arguments: arguments, returns: returns)
        return self
    }

    /// Supplies fixed context values for the keys the document declares.
    @discardableResult
    public func context(_ values: [String: MilanoValue]) -> Self {
        contextSource = StaticContextSource(values)
        return self
    }

    /// Supplies an observable context source (see MilanoContextHandle).
    @discardableResult
    public func contextSource(_ source: any MilanoContextSource) -> Self {
        contextSource = source
        return self
    }

    @discardableResult
    public func stateDataProvider(_ provider: any MilanoStateDataProvider) -> Self {
        stateProvider = provider
        return self
    }

    @discardableResult
    public func stateData(
        _ closure: @escaping @Sendable ([String: MilanoType]) async throws -> [String: MilanoValue]
    ) -> Self {
        stateProvider = MilanoClosureStateProvider(closure)
        return self
    }

    /// The view's action handler; required when the document uses custom
    /// actions.
    @discardableResult
    public func actionHandler(_ handler: any MilanoActionHandler) -> Self {
        self.handler = handler
        return self
    }

    @discardableResult
    public func actionHandler(
        _ closure: @escaping @Sendable (MilanoAction) async throws -> MilanoValue?
    ) -> Self {
        handler = MilanoClosureActionHandler(closure)
        return self
    }

    /// The serialization seam; defaults to the main thread. Overridden by
    /// the conformance harness.
    @discardableResult
    public func dispatcher(_ dispatcher: any MilanoDispatcher) -> Self {
        self.dispatcher = dispatcher
        return self
    }

    /// Per-view override of the engine's default unknown-type policy.
    @discardableResult
    public func unknownTypePolicy(_ policy: MilanoUnknownTypePolicy) -> Self {
        policyOverride = policy
        return self
    }

    /// Host-chosen name attached to this view's observability reports.
    @discardableResult
    public func label(_ label: String) -> Self {
        self.label = label
        return self
    }

    /// The surface's granted action set: vocabulary declarations,
    /// overridden by builder declarations, narrowed by the allowlist.
    private func grantedActions() -> [String: MilanoVocabulary.Action] {
        let granted = engine.vocabulary.actions.merging(declaredActions) { _, builder in builder }
        guard let allowedActions else { return granted }
        return granted.filter { allowedActions.contains($0.key) }
    }

    /// The surface's declared host functions: the vocabulary's, overridden
    /// by the builder's.
    private func declaredFunctionSet() -> [String: MilanoVocabulary.Function] {
        engine.vocabulary.functions.merging(declaredFunctions) { _, builder in builder }
    }

    /// Steps 1 to 5 of the gate for one document under this surface's
    /// configuration, plus the two handler checks. Shared by the first
    /// build and every replacement.
    private func prepare(_ data: Data, identity: String, policy: MilanoUnknownTypePolicy) throws -> Prepared {
        let pending = PendingOccurrences()
        let gate = MilanoGate(
            engine: engine, policy: policy, viewIdentity: identity,
            grantedActions: grantedActions(), declaredFunctions: declaredFunctionSet(),
            report: { pending.items.append($0) })
        let validated = try gate.validateDocument(data)

        // A document using custom actions needs somewhere to send them, and
        // one calling host functions needs something to answer.
        if gate.flags.usesCustomActions, handler == nil {
            throw MilanoBuildError.schemaViolation(
                rule: "action-handler", node: nil, expected: "action handler", found: nil)
        }
        if !gate.flags.usedFunctions.isEmpty, engine.functionHandler == nil {
            throw MilanoBuildError.schemaViolation(
                rule: "function-handler", node: nil, expected: "function handler", found: nil)
        }
        return Prepared(gate: gate, validated: validated, pending: pending)
    }

    /// A replacement's plan (state and actions spec, Document replacement):
    /// the new document through the gate, and the provider's values for
    /// the keys that do not carry over from the prior declarations,
    /// invoked once with exactly those declarations, or not at all. The
    /// view completes the swap on its dispatcher.
    private func plan(
        _ data: Data, identity: String, policy: MilanoUnknownTypePolicy,
        priorDeclarations: [String: MilanoType]
    ) async throws -> ReplacementPlan {
        let prepared = try prepare(data, identity: identity, policy: policy)
        let document = prepared.validated.document
        // A key carries over when its declared type is identical,
        // optionality included; every other key comes from the provider.
        var needed: [String: MilanoType] = [:]
        for (key, type) in document.stateDeclarations where priorDeclarations[key] != type {
            needed[key] = type
        }
        var provided: [String: MilanoValue]?
        if !needed.isEmpty {
            guard let stateProvider else {
                throw MilanoBuildError.schemaViolation(
                    rule: "state-declaration", node: nil, expected: "state data provider", found: nil)
            }
            // Awaited here; the provider's own errors propagate unchanged.
            provided = try await stateProvider.initialState(for: needed)
        }
        return ReplacementPlan(
            document: document, root: prepared.validated.root,
            lifecycle: prepared.validated.lifecycle, watch: prepared.validated.watch,
            pending: prepared.pending.items, provided: provided)
    }

    /// Building is asynchronous: the document is parsed and validated in
    /// full, then the state data provider is awaited and its values are
    /// validated against the document's declarations. Throws typed
    /// `MilanoBuildError`s; provider failures propagate unchanged.
    public func build() async throws -> MilanoView {
        let identity = label ?? "milano-view-\(UUID().uuidString)"
        let policy = policyOverride ?? engine.defaultUnknownTypePolicy

        if policy == .placeholder, engine.registry.placeholder == nil {
            throw MilanoEngineError.incompleteRegistry(missing: ["(placeholder renderer)"])
        }

        // Steps 1 to 5, the bindings, and the handler checks.
        let prepared = try prepare(documentData, identity: identity, policy: policy)
        let document = prepared.validated.document
        let root = prepared.validated.root
        let pending = prepared.pending

        // The data checks over supplied context and provided state.
        let context = try prepared.gate.validateContext(document, supplied: contextSource?.current ?? [:])
        var state: [String: MilanoValue] = [:]
        if !document.stateDeclarations.isEmpty {
            guard let stateProvider else {
                throw MilanoBuildError.schemaViolation(
                    rule: "state-declaration", node: nil,
                    expected: "state data provider", found: nil)
            }
            // Awaited here; the provider's own errors propagate unchanged.
            let provided = try await stateProvider.initialState(for: document.stateDeclarations)
            state = try prepared.gate.validateState(document, provided: provided)
        }

        // Initial resolution: every property expression evaluated, every
        // `$repeat` materialized; a keyed repeat rendering one key twice
        // is a data defect.
        let env = EvalEnvironment(functions: declaredFunctionSet(), handler: engine.functionHandler)
        let resolvedRoot: ResolvedNode
        do {
            resolvedRoot = try MilanoResolver.resolve(
                root, state: state, context: context,
                report: { pending.items.append($0.occurrence(in: identity)) },
                env: env)
        } catch let conflict as RepeatKeyConflict {
            throw MilanoBuildError.schemaViolation(
                rule: "repeat", node: conflict.reference, expected: "distinct key", found: conflict.key)
        }

        // The node count limit is measured on the materialized tree.
        let materialized = MilanoResolver.countNodes(resolvedRoot)
        if materialized > engine.limits.maxNodeCount {
            throw MilanoBuildError.limitExceeded(
                limit: "maxNodeCount", value: engine.limits.maxNodeCount, actual: materialized)
        }

        // Only a successful build reports its occurrences.
        for occurrence in pending.items {
            engine.observer?.occurrence(occurrence)
        }

        // The impression: the analytics stream opens with the built view,
        // carrying the document's metadata for attribution.
        engine.userInteractionObserver?.interaction(
            MilanoUserInteraction(
                kind: .viewBuilt, viewIdentity: identity,
                value: document.metadata))

        let core = MilanoViewCore(
            identity: identity, engine: engine, document: document,
            root: root, lifecycle: prepared.validated.lifecycle, watch: prepared.validated.watch,
            resolvedRoot: resolvedRoot, context: context, state: state,
            dispatcher: dispatcher, handler: handler, env: env,
            replacer: { [self] data, priorDeclarations in
                try await self.plan(data, identity: identity, policy: policy, priorDeclarations: priorDeclarations)
            },
            occurrencesAtBuild: pending.items)

        // Context updates flow through the view's dispatcher and are
        // validated atomically there.
        if let contextSource {
            let dispatcher = self.dispatcher
            core.cancelContextSubscription = contextSource.subscribe { [weak core] values in
                guard let core else { return }
                dispatcher.dispatch { core.applyContextUpdate(values) }
            }
        }
        return MilanoView(core: core)
    }
}

extension MilanoEngine {
    /// Creates a builder for one document.
    public func viewBuilder(document: Data) -> MilanoViewBuilder {
        MilanoViewBuilder(engine: self, documentData: document)
    }

    /// Creates a builder for one document given as text.
    public func viewBuilder(documentText: String) -> MilanoViewBuilder {
        MilanoViewBuilder(engine: self, documentData: Data(documentText.utf8))
    }
}
