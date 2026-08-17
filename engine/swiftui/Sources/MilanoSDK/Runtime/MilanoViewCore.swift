import Foundation

/// The runtime behind a MilanoView: bound to one document for its lifetime.
/// Runtime semantics per the state and actions spec; everything mutable
/// runs through the view's serial dispatcher.
final class MilanoViewCore: @unchecked Sendable {
    let identity: String
    let engine: MilanoEngine
    let document: ParsedDocument
    let root: BuiltNode
    let dispatcher: any MilanoDispatcher
    let handler: (any MilanoActionHandler)?
    let occurrencesAtBuild: [MilanoOccurrence]

    private(set) var resolvedRoot: ResolvedNode
    private(set) var context: [String: MilanoValue]
    private(set) var state: [String: MilanoValue]

    /// Rendering hook: invoked after every re-resolution, on the dispatcher.
    var onChange: (() -> Void)?

    // Runtime, guarded by the serial dispatcher.
    private struct NodeEvents {
        let declared: [String: MilanoType?]
        let bindings: [String: [ActionSpec]]
    }
    struct DispatchRecord {
        let action: MilanoAction
        var completed: Bool
        let onSuccess: [ActionSpec]
        let onFailure: [ActionSpec]
        let capturedEvent: MilanoValue?
        let resultType: MilanoType?
        let sourceNode: String?
    }
    private var nodeEvents: [String: NodeEvents] = [:]
    /// One serialized work queue: action lists and context updates both run
    /// through it, so an update can never land mid-action-list even when a
    /// re-entrant post arrives on the dispatcher thread.
    private var queue: [() -> Void] = []
    private var processing = false
    private var tornDown = false
    /// Cancels the context source subscription; invoked at teardown.
    var cancelContextSubscription: (@Sendable () -> Void)?
    private(set) var dispatched: [DispatchRecord] = []

    init(
        identity: String, engine: MilanoEngine, document: ParsedDocument,
        root: BuiltNode, resolvedRoot: ResolvedNode,
        context: [String: MilanoValue], state: [String: MilanoValue],
        dispatcher: any MilanoDispatcher, handler: (any MilanoActionHandler)?,
        occurrencesAtBuild: [MilanoOccurrence]
    ) {
        self.identity = identity
        self.engine = engine
        self.document = document
        self.root = root
        self.resolvedRoot = resolvedRoot
        self.context = context
        self.state = state
        self.dispatcher = dispatcher
        self.handler = handler
        self.occurrencesAtBuild = occurrencesAtBuild
        indexNodes(root)
    }

    private func indexNodes(_ node: BuiltNode) {
        if !node.isPlaceholder, let component = engine.vocabulary.components[node.type] {
            nodeEvents[node.reference] = NodeEvents(
                declared: component.events, bindings: node.events)
        }
        for child in node.children {
            indexNodes(child)
        }
    }

    // MARK: - Renderer-facing surface

    /// A renderer emission. Undeclared events and mis-typed payloads are
    /// dropped and reported before reaching dispatch; declared events with
    /// no binding are dropped and reported.
    func emit(node: String, event: String, payload: MilanoValue? = nil) {
        dispatcher.dispatch { [weak self] in
            self?.processEmission(node: node, event: event, payload: payload)
        }
    }

    /// The view ceases to participate: completions arriving afterwards drop
    /// their follow-ups and report.
    func teardown() {
        cancelContextSubscription?()
        cancelContextSubscription = nil
        dispatcher.dispatch { [weak self] in
            guard let self, !self.tornDown else { return }
            self.tornDown = true
            self.record(.viewTornDown, node: nil, name: nil, value: nil)
        }
    }

    deinit {
        cancelContextSubscription?()
    }

    // MARK: - Runtime (always on the dispatcher)

    private func processEmission(node: String, event: String, payload: MilanoValue?) {
        guard !tornDown else { return }
        guard let info = nodeEvents[node], let declaredPayload = info.declared[event] else {
            report(.invalidEmission, node: node)
            return
        }
        // Payload against the declared type: payload-less events take none.
        var eventValue: MilanoValue?
        if let payloadType = declaredPayload {
            guard let payload, let validated = payloadType.validated(payload) else {
                report(.invalidEmission, node: node)
                return
            }
            eventValue = validated
        } else if payload != nil {
            report(.invalidEmission, node: node)
            return
        }
        // Analytics sees every declared emission with a valid payload,
        // before the binding lookup: unbound taps are signal for the host
        // even while droppedEvent keeps its defect meaning.
        record(.event, node: node, name: event, value: eventValue)
        guard let actions = info.bindings[event], !actions.isEmpty else {
            report(.droppedEvent, node: node)
            return
        }
        let payload = eventValue
        enqueue { [weak self] in
            self?.execute(actions, event: payload, result: nil, sourceNode: node)
        }
    }

    func applyContextUpdate(_ supplied: [String: MilanoValue]) {
        // Serialized with dispatch through the queue: an update never lands
        // mid-action-list (state and actions spec).
        enqueue { [weak self] in
            self?.performContextUpdate(supplied)
        }
    }

    private func performContextUpdate(_ supplied: [String: MilanoValue]) {
        guard !tornDown else { return }
        // Atomic: all declared keys validate or the whole update is rejected.
        var canonical: [String: MilanoValue] = [:]
        for (key, type) in document.contextDeclarations {
            guard let value = supplied[key], let validated = type.validated(value) else {
                report(.rejectedContextUpdate, node: nil)
                return
            }
            canonical[key] = validated
        }
        context = canonical
        reResolve()
    }

    /// Internal completion path; the async funnel lands here, and the
    /// conformance harness drives it directly.
    func complete(dispatchIndex: Int, success: Bool, payload: MilanoValue? = nil) {
        guard dispatchIndex < dispatched.count else { return }
        if tornDown {
            report(.completionAfterTeardown, node: nil)
            return
        }
        if dispatched[dispatchIndex].completed {
            report(.duplicateCompletion, node: nil)
            return
        }
        dispatched[dispatchIndex].completed = true
        let record = dispatched[dispatchIndex]

        // The success value against the declared result type: a missing
        // value counts as null, a value on failure or on an action
        // declaring no result never validates. An invalid completion is
        // consumed without running either branch (state and actions spec).
        var resultValue: MilanoValue?
        if success, let resultType = record.resultType {
            guard let validated = resultType.validated(payload ?? .null) else {
                report(.invalidCompletion, node: nil)
                return
            }
            resultValue = validated
        } else if payload != nil {
            report(.invalidCompletion, node: nil)
            return
        }

        self.record(
            success ? .completionSucceeded : .completionFailed,
            node: record.sourceNode, name: record.action.name, value: nil)

        let followUps = success ? record.onSuccess : record.onFailure
        if !followUps.isEmpty {
            let captured = record.capturedEvent
            let source = record.sourceNode
            enqueue { [weak self] in
                self?.execute(followUps, event: captured, result: resultValue, sourceNode: source)
            }
        }
    }

    private func enqueue(_ work: @escaping () -> Void) {
        queue.append(work)
        guard !processing else { return }
        processing = true
        while !queue.isEmpty {
            queue.removeFirst()()
        }
        processing = false
    }

    private func execute(
        _ actions: [ActionSpec], event: MilanoValue?, result: MilanoValue?,
        sourceNode: String?
    ) {
        for action in actions {
            switch action {
            case .set(let key, let value):
                let declared = document.stateDeclarations[key]
                let evaluated = evaluate(value, event: event, result: result)
                state[key] = declared?.validated(evaluated) ?? evaluated
                // Visible immediately: re-resolution before the next action.
                reResolve()

            case .sequence(let nested):
                execute(nested, event: event, result: result, sourceNode: sourceNode)

            case .when(let condition, let then, let otherwise):
                let takeThen = evaluate(condition, event: event, result: result).boolValue == true
                execute(
                    takeThen ? then : otherwise, event: event, result: result,
                    sourceNode: sourceNode)

            case .custom(let name, let parameters, let onSuccess, let onFailure, let resultType):
                var captured: [String: MilanoValue] = [:]
                for (parameter, value) in parameters {
                    captured[parameter] = evaluate(value, event: event, result: result)
                }
                let action = MilanoAction(
                    name: name, parameters: captured, viewIdentity: identity)
                record(
                    .actionDispatched, node: sourceNode, name: name,
                    value: .record(captured))
                let index = dispatched.count
                dispatched.append(
                    DispatchRecord(
                        action: action, completed: false,
                        onSuccess: onSuccess, onFailure: onFailure,
                        capturedEvent: event, resultType: resultType,
                        sourceNode: sourceNode))
                // Dispatch does not wait: the sequence continues immediately.
                if let handler {
                    // Captured strongly so a completion for a deallocated
                    // view (deallocation counts as teardown) still reports.
                    let observer = engine.observer
                    let identity = identity
                    Task { [weak self] in
                        let success: Bool
                        let payload: MilanoValue?
                        do {
                            payload = try await handler.handle(action)
                            success = true
                        } catch {
                            payload = nil
                            success = false
                        }
                        guard let self else {
                            observer?.occurrence(MilanoOccurrence(
                                kind: .completionAfterTeardown,
                                viewIdentity: identity, node: nil))
                            return
                        }
                        self.dispatcher.dispatch {
                            self.complete(
                                dispatchIndex: index, success: success, payload: payload)
                        }
                    }
                }
            }
        }
    }

    private func evaluate(
        _ value: DocValue, event: MilanoValue?, result: MilanoValue?
    ) -> MilanoValue {
        switch value {
        case .literal(let literal):
            return literal
        case .typedExpression(_, let expr, let expected):
            let evaluator = ExprEvaluator(
                state: state, context: context, event: event, result: result, node: nil,
                report: { [weak self] kind in self?.report(kind, node: nil) })
            let evaluated = evaluator.evaluate(expr)
            return expected.validated(evaluated) ?? evaluated
        case .expression:
            return .null
        }
    }

    private func reResolve() {
        resolvedRoot = MilanoResolver.resolve(
            root, state: state, context: context,
            report: { [weak self] kind, node in self?.report(kind, node: node) })
        onChange?()
    }

    private func report(_ kind: MilanoOccurrence.Kind, node: String?) {
        engine.observer?.occurrence(
            MilanoOccurrence(kind: kind, viewIdentity: identity, node: node))
    }

    /// The product-analytics seam: a no-op without an observer.
    func record(
        _ kind: MilanoUserInteraction.Kind, node: String?, name: String?,
        value: MilanoValue?
    ) {
        engine.userInteractionObserver?.interaction(
            MilanoUserInteraction(
                kind: kind, viewIdentity: identity,
                node: node, name: name, value: value))
    }
}
