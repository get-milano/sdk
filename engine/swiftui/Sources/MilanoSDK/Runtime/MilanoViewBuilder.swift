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
    /// parameter shape, and optional success result type join the granted
    /// set for this builder only. Declarations type the payload; meaning is
    /// assigned by this surface's action handler.
    @discardableResult
    public func action(
        _ name: String, parameters: [String: MilanoType] = [:], result: MilanoType? = nil
    ) -> Self {
        declaredActions[name] = MilanoVocabulary.Action(parameters: parameters, result: result)
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

        // The surface's granted action set: vocabulary declarations,
        // overridden by builder declarations, narrowed by the allowlist.
        var granted = engine.vocabulary.actions.merging(declaredActions) { _, builder in builder }
        if let allowedActions {
            granted = granted.filter { allowedActions.contains($0.key) }
        }

        var pending: [MilanoOccurrence] = []
        let gate = MilanoGate(
            engine: engine, policy: policy, viewIdentity: identity,
            grantedActions: granted,
            report: { pending.append($0) })

        // Steps 1 to 4.
        let (document, root) = try gate.validateDocument(documentData)

        // A document using custom actions needs somewhere to send them.
        if gate.flags.usesCustomActions, handler == nil {
            throw MilanoBuildError.schemaViolation(
                rule: "action-handler", node: nil, expected: "action handler", found: nil)
        }

        // Step 5: cross-checks over supplied data.
        let suppliedContext = contextSource?.current ?? [:]
        let context = try gate.validateContext(document, supplied: suppliedContext)

        var state: [String: MilanoValue] = [:]
        if !document.stateDeclarations.isEmpty {
            guard let stateProvider else {
                throw MilanoBuildError.schemaViolation(
                    rule: "state-declaration", node: nil,
                    expected: "state data provider", found: nil)
            }
            // Awaited here; the provider's own errors propagate unchanged.
            let provided = try await stateProvider.initialState(for: document.stateDeclarations)
            state = try gate.validateState(document, provided: provided)
        }

        // Initial resolution: every property expression evaluated.
        let resolvedRoot = MilanoResolver.resolve(
            root, state: state, context: context,
            report: { kind, node in
                pending.append(
                    MilanoOccurrence(kind: kind, viewIdentity: identity, node: node))
            })

        // Only a successful build reports its occurrences.
        for occurrence in pending {
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
            root: root, resolvedRoot: resolvedRoot,
            context: context, state: state,
            dispatcher: dispatcher, handler: handler,
            occurrencesAtBuild: pending)

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
