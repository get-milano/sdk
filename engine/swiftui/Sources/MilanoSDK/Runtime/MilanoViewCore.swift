import Foundation

/// The runtime behind a MilanoView: bound to one document for its lifetime.
/// Runtime semantics per the state and actions spec; everything mutable
/// runs through the view's serial dispatcher.
final class MilanoViewCore: @unchecked Sendable {
    let identity: String
    let engine: MilanoEngine
    let document: ParsedDocument
    let root: BuiltNode
    /// What every expression reads, indexed once: the update path's map.
    private let dependencies: DependencyNode
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
        /// The enclosing `$repeat` constructs, outermost first.
        let repeats: [BuiltNode]
    }
    struct DispatchRecord {
        let action: MilanoAction
        var completed: Bool
        let onSuccess: [ActionSpec]
        let onFailure: [ActionSpec]
        let capturedEvent: MilanoValue?
        /// The `$repeat` bindings in scope at dispatch, kept for follow-ups.
        let capturedBindings: [String: MilanoValue]
        let resultType: MilanoType?
        let sourceNode: String?
    }
    /// A tree an update would produce, with the reports it raised held
    /// back until the update is accepted.
    private struct Materialized {
        let tree: ResolvedNode?
        let count: Int
        let reports: [(MilanoOccurrence.Kind, String, String)]
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
        self.dependencies = MilanoResolver.index(root)
        self.resolvedRoot = resolvedRoot
        self.context = context
        self.state = state
        self.dispatcher = dispatcher
        self.handler = handler
        self.occurrencesAtBuild = occurrencesAtBuild
        indexNodes(root)
    }

    private func indexNodes(_ node: BuiltNode, repeats: [BuiltNode] = []) {
        if node.repeatSpec != nil {
            for template in node.children {
                indexNodes(template, repeats: repeats + [node])
            }
            return
        }
        if !node.isPlaceholder, let component = engine.vocabulary.components[node.type] {
            nodeEvents[node.reference] = NodeEvents(
                declared: component.events, bindings: node.events, repeats: repeats)
        }
        for child in node.children {
            indexNodes(child, repeats: repeats)
        }
    }

    /// An instance reference split into its template reference and the
    /// element index per enclosing `$repeat`, outermost first: `line[2][0]`
    /// is `line` at 2 then 0. A plain reference has no indices.
    private static func splitInstanceReference(_ reference: String) -> (base: String, indices: [Int]) {
        var base = Substring(reference)
        var indices: [Int] = []
        while base.hasSuffix("]"), let open = base.lastIndex(of: "["),
            let index = Int(base[base.index(after: open)..<base.index(before: base.endIndex)]) {
            indices.insert(index, at: 0)
            base = base[..<open]
        }
        return (String(base), indices)
    }

    /// The `$repeat` bindings an instance's emission dispatches with: the
    /// element at each index, evaluated now, outermost repeat first. Nil
    /// when an index no longer exists.
    private func bindingsFor(_ info: NodeEvents, indices: [Int]) -> [String: MilanoValue]? {
        var bindings: [String: MilanoValue] = [:]
        var suffix = ""
        for (level, repeatNode) in info.repeats.enumerated() {
            let index = indices[level]
            let elements = MilanoResolver.repeatElements(
                repeatNode, reference: repeatNode.reference + suffix,
                state: state, context: context, report: { _, _, _ in }, bindings: bindings)
            guard index < elements.count, let spec = repeatNode.repeatSpec else { return nil }
            bindings = MilanoResolver.elementBindings(
                as: spec.as, element: elements[index], index: index, outer: bindings)
            suffix += "[\(index)]"
        }
        return bindings
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
        // A plain reference, or an instance reference: the template's
        // reference with one index per enclosing repeat.
        var info = nodeEvents[node]
        var indices: [Int] = []
        if info == nil || !(info?.repeats.isEmpty ?? true) {
            let split = Self.splitInstanceReference(node)
            if let candidate = nodeEvents[split.base], candidate.repeats.count == split.indices.count {
                info = candidate
                indices = split.indices
            } else {
                info = nil
            }
        }
        guard let info else {
            report(.invalidEmission, node: node, name: event, expected: "declared event", found: "unknown node")
            return
        }
        guard let bindings = bindingsFor(info, indices: indices) else {
            report(
                .invalidEmission, node: node, name: event,
                expected: "repeat element", found: "index \(indices.last ?? 0)")
            return
        }
        guard let declaredPayload = info.declared[event] else {
            report(.invalidEmission, node: node, name: event, expected: "declared event", found: "undeclared event")
            return
        }
        // Payload against the declared type: payload-less events take none.
        var eventValue: MilanoValue?
        if let payloadType = declaredPayload {
            guard let supplied = payload, let validated = payloadType.validated(supplied) else {
                report(
                    .invalidEmission, node: node, name: event,
                    expected: MilanoGate.name(of: payloadType),
                    found: payload.map { MilanoGate.name(of: $0) } ?? "null")
                return
            }
            eventValue = validated
        } else if let supplied = payload {
            report(
                .invalidEmission, node: node, name: event,
                expected: "no payload", found: MilanoGate.name(of: supplied))
            return
        }
        // Analytics sees every declared emission with a valid payload,
        // before the binding lookup: unbound taps are signal for the host
        // even while droppedEvent keeps its defect meaning.
        record(.event, node: node, name: event, value: eventValue)
        guard let actions = info.bindings[event], !actions.isEmpty else {
            report(.droppedEvent, node: node, name: event)
            return
        }
        let payload = eventValue
        enqueue { [weak self] in
            self?.execute(actions, event: payload, result: nil, sourceNode: node, bindings: bindings)
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
        var changed: Set<String> = []
        var lastKey: String?
        for (key, type) in document.contextDeclarations.byKey {
            guard let value = supplied[key], let validated = type.validated(value) else {
                report(
                    .rejectedContextUpdate, node: nil, name: key,
                    expected: MilanoGate.name(of: type),
                    found: supplied[key].map { MilanoGate.name(of: $0) } ?? "missing")
                return
            }
            // A value past the value size limit rejects the update whole.
            let size = validated.size
            if size > engine.limits.maxValueSize {
                report(
                    .rejectedContextUpdate, node: nil, name: key,
                    expected: "maxValueSize", found: "\(size)")
                return
            }
            canonical[key] = validated
            if context[key] != validated { changed.insert("context.\(key)") }
            lastKey = key
        }
        // Only what reads a changed key re-evaluates; an update that changes
        // no value changes nothing. A tree materialized past the node count
        // limit rejects the update whole.
        guard !changed.isEmpty else {
            context = canonical
            return
        }
        let materialized = materialize(changed: changed, state: state, context: canonical)
        if materialized.count > engine.limits.maxNodeCount {
            report(
                .rejectedContextUpdate, node: nil, name: lastKey,
                expected: "maxNodeCount", found: "\(materialized.count)")
            return
        }
        context = canonical
        commit(materialized)
    }

    /// Internal completion path; the async funnel lands here, and the
    /// conformance harness drives it directly.
    func complete(dispatchIndex: Int, success: Bool, payload: MilanoValue? = nil) {
        guard dispatchIndex < dispatched.count else { return }
        let action = dispatched[dispatchIndex].action.name
        if tornDown {
            report(.completionAfterTeardown, node: nil, name: action)
            return
        }
        if dispatched[dispatchIndex].completed {
            report(.duplicateCompletion, node: nil, name: action)
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
                report(
                    .invalidCompletion, node: nil, name: action,
                    expected: MilanoGate.name(of: resultType),
                    found: MilanoGate.name(of: payload ?? .null))
                return
            }
            resultValue = validated
        } else if let supplied = payload {
            report(
                .invalidCompletion, node: nil, name: action,
                expected: success ? "no result" : "no payload",
                found: MilanoGate.name(of: supplied))
            return
        }

        self.record(
            success ? .completionSucceeded : .completionFailed,
            node: record.sourceNode, name: record.action.name, value: nil)

        let followUps = success ? record.onSuccess : record.onFailure
        if !followUps.isEmpty {
            let captured = record.capturedEvent
            let bindings = record.capturedBindings
            let source = record.sourceNode
            enqueue { [weak self] in
                self?.execute(
                    followUps, event: captured, result: resultValue, sourceNode: source,
                    bindings: bindings)
            }
        }
    }

    private func enqueue(_ work: @escaping () -> Void) {
        queue.append(work)
        guard !processing else { return }
        processing = true
        // The queue is released on every exit from the drain, matching the
        // Kotlin and TypeScript engines. Swift's non-throwing closures make
        // a non-local exit unreachable here today; the guarantee should not
        // depend on that.
        defer {
            queue.removeAll()
            processing = false
        }
        while !queue.isEmpty {
            queue.removeFirst()()
        }
    }

    /// Runs an action list. Returns false when the list ended early: a
    /// `$set` past the value size limit assigns nothing, is reported, and
    /// stops the remaining actions of the dispatch; what the list already
    /// applied stays.
    @discardableResult
    private func execute(
        _ actions: [ActionSpec], event: MilanoValue?, result: MilanoValue?,
        sourceNode: String?, bindings: [String: MilanoValue] = [:]
    ) -> Bool {
        for action in actions {
            switch action {
            case .set(let key, let value):
                let declared = document.stateDeclarations[key]
                let evaluated = evaluate(value, event: event, result: result, bindings: bindings)
                let next = declared?.validated(evaluated) ?? evaluated
                let size = next.size
                if size > engine.limits.maxValueSize {
                    report(
                        .rejectedMutation, node: sourceNode, name: key,
                        expected: "maxValueSize", found: "\(size)")
                    return false
                }
                // A value that did not change re-resolves nothing.
                if state[key] == next { continue }
                var nextState = state
                nextState[key] = next
                // Visible immediately: the properties that read this key
                // re-resolve before the next action. A tree materialized
                // past the node count limit rejects the mutation instead.
                let materialized = materialize(changed: ["state.\(key)"], state: nextState, context: context)
                if materialized.count > engine.limits.maxNodeCount {
                    report(
                        .rejectedMutation, node: sourceNode, name: key,
                        expected: "maxNodeCount", found: "\(materialized.count)")
                    return false
                }
                state = nextState
                commit(materialized)

            case .sequence(let nested):
                guard execute(
                    nested, event: event, result: result, sourceNode: sourceNode,
                    bindings: bindings)
                else { return false }

            case .when(let condition, let then, let otherwise):
                let takeThen = evaluate(condition, event: event, result: result, bindings: bindings)
                    .boolValue == true
                guard execute(
                    takeThen ? then : otherwise, event: event, result: result,
                    sourceNode: sourceNode, bindings: bindings)
                else { return false }

            case .custom(let name, let parameters, let onSuccess, let onFailure, let resultType):
                var captured: [String: MilanoValue] = [:]
                for (parameter, value) in parameters.byKey {
                    captured[parameter] = evaluate(value, event: event, result: result, bindings: bindings)
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
                        capturedEvent: event, capturedBindings: bindings,
                        resultType: resultType, sourceNode: sourceNode))
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
                                viewIdentity: identity, node: nil, name: action.name))
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
        return true
    }

    private func evaluate(
        _ value: DocValue, event: MilanoValue?, result: MilanoValue?,
        bindings: [String: MilanoValue] = [:]
    ) -> MilanoValue {
        switch value {
        case .literal(let literal):
            return literal
        case .typedExpression(_, let expr, let expected):
            let evaluator = ExprEvaluator(
                state: state, context: context, event: event, result: result, node: nil,
                report: { [weak self] kind in self?.report(kind, node: nil) },
                bindings: bindings)
            let evaluated = evaluator.evaluate(expr)
            return expected.validated(evaluated) ?? evaluated
        case .expression:
            return .null
        }
    }

    /// The tree an update would produce, with the arithmetic reports it
    /// raised held back: nothing reaches the observer until the update is
    /// accepted, and a rejected one leaves no trace.
    private func materialize(
        changed: Set<String>, state: [String: MilanoValue], context: [String: MilanoValue]
    ) -> Materialized {
        var reports: [(MilanoOccurrence.Kind, String, String)] = []
        let tree = MilanoResolver.refresh(
            root, index: dependencies, resolved: resolvedRoot, changed: changed,
            state: state, context: context,
            report: { kind, node, name in reports.append((kind, node, name)) })
        return Materialized(
            tree: tree, count: tree.map(MilanoResolver.countNodes) ?? 0, reports: reports)
    }

    /// Adopts a materialized tree, flushes its reports, notifies the host.
    private func commit(_ materialized: Materialized) {
        for (kind, node, name) in materialized.reports {
            report(kind, node: node, name: name)
        }
        // Nothing depended on the change: the tree stays, and there is
        // nothing to tell the host.
        guard let next = materialized.tree else { return }
        resolvedRoot = next
        onChange?()
    }

    private func report(
        _ kind: MilanoOccurrence.Kind, node: String?,
        name: String? = nil, expected: String? = nil, found: String? = nil
    ) {
        engine.observer?.occurrence(
            MilanoOccurrence(
                kind: kind, viewIdentity: identity, node: node,
                name: name, expected: expected, found: found))
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
