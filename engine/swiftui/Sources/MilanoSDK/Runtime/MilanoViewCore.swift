import Foundation

/// The runtime behind a MilanoView: bound to one document at a time.
/// Runtime semantics per the state and actions spec; everything mutable
/// runs through the view's serial dispatcher. Action lists and mutations
/// live in MilanoViewCore+Actions, emissions, lifecycle signals, and
/// context updates in MilanoViewCore+Updates, and document replacement in
/// MilanoViewCore+Replacement.
final class MilanoViewCore: @unchecked Sendable {
    let identity: String
    let engine: MilanoEngine
    /// The document the view is bound to, its built tree, its lifecycle and
    /// watch bindings, and its dependency index (the update path's map).
    /// One document at a time: only the swap of a replacement rebinds
    /// them, whole, on the dispatcher.
    var document: ParsedDocument
    var root: BuiltNode
    var lifecycle: [String: [ActionSpec]]
    var watch: [String: [ActionSpec]]
    var dependencies: DependencyNode
    let dispatcher: any MilanoDispatcher
    let handler: (any MilanoActionHandler)?
    let occurrencesAtBuild: [MilanoOccurrence]
    /// The host functions the surface declares and the engine's handler.
    let env: EvalEnvironment
    /// Prepares a replacement under the builder's configuration; nil when
    /// the view cannot be replaced.
    let replacer: Replacer?
    /// Unique per view instance in the process, whatever the builder's
    /// label; dispatch ids are minted from it.
    let instanceToken: String

    var resolvedRoot: ResolvedNode
    var context: [String: MilanoValue]
    var state: [String: MilanoValue]

    /// Rendering hook: invoked after every re-resolution, on the dispatcher.
    var onChange: (() -> Void)?

    // Runtime, guarded by the serial dispatcher.
    struct NodeEvents {
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
        let failureType: MilanoType?
        let sourceNode: String?
        /// Dispatched from a watch list: its follow-ups run with watches
        /// suppressed too, since a watch never triggers a watch.
        var fromWatch = false
    }
    /// What an action list evaluates against: the payload captured at
    /// dispatch, the completion's result or failure payload, the `$repeat`
    /// bindings in scope, and the node whose binding dispatched (nil for a
    /// lifecycle or watch binding).
    struct ActionScope {
        var event: MilanoValue?
        var result: MilanoValue?
        var failure: MilanoValue?
        var bindings: [String: MilanoValue] = [:]
        var sourceNode: String?
    }
    /// A tree an update would produce, with the reports it raised held
    /// back until the update is accepted; or the key a keyed repeat would
    /// render twice, which refuses the update.
    enum Materialized {
        case tree(ResolvedNode?, count: Int, reports: [ResolutionReport])
        case conflict(key: String)
    }
    /// An instance in the current tree: its template and enclosing identities.
    struct InstanceLocation {
        let base: String
        let identities: [String]
    }
    struct MissingInstance: Error {
        let detail: String
    }
    var nodeEvents: [String: NodeEvents] = [:]
    /// Instance reference to its template and identities, for the current
    /// tree; built on the first emission after a commit, since references
    /// are compared, never parsed.
    var instanceIndex: [String: InstanceLocation]?
    /// One serialized work queue: action lists and context updates both run
    /// through it, so an update can never land mid-action-list even when a
    /// re-entrant post arrives on the dispatcher thread.
    private var queue: [() -> Void] = []
    private var processing = false
    var tornDown = false
    /// The lifecycle state: appear is accepted only while false, disappear
    /// only while true.
    var appeared = false
    /// Above zero while a watch list, or a follow-up of a dispatch made
    /// from one, is executing: mutations then trigger no watch (state and
    /// actions spec, Watch bindings).
    var watchDepth = 0
    /// Dispatches below this index belong to a document since replaced:
    /// their completions are dropped and reported.
    var replacedBefore = 0
    /// Cancels the context source subscription; invoked at teardown.
    var cancelContextSubscription: (@Sendable () -> Void)?
    var dispatched: [DispatchRecord] = []

    private static let instanceCounter = InstanceCounter()

    private final class InstanceCounter: @unchecked Sendable {
        private let lock = NSLock()
        private var next = 0
        func mint() -> String {
            lock.lock()
            defer { lock.unlock() }
            next += 1
            return "\(next)-\(UUID().uuidString.lowercased())"
        }
    }

    init(
        identity: String, engine: MilanoEngine, document: ParsedDocument,
        root: BuiltNode, lifecycle: [String: [ActionSpec]] = [:], watch: [String: [ActionSpec]] = [:],
        resolvedRoot: ResolvedNode,
        context: [String: MilanoValue], state: [String: MilanoValue],
        dispatcher: any MilanoDispatcher, handler: (any MilanoActionHandler)?,
        env: EvalEnvironment = .none, replacer: Replacer? = nil,
        occurrencesAtBuild: [MilanoOccurrence]
    ) {
        self.identity = identity
        self.engine = engine
        self.document = document
        self.root = root
        self.lifecycle = lifecycle
        self.watch = watch
        self.dependencies = MilanoResolver.index(root)
        self.resolvedRoot = resolvedRoot
        self.context = context
        self.state = state
        self.dispatcher = dispatcher
        self.handler = handler
        self.env = env
        self.replacer = replacer
        self.occurrencesAtBuild = occurrencesAtBuild
        self.instanceToken = Self.instanceCounter.mint()
        indexNodes(root)
    }

    func indexNodes(_ node: BuiltNode, repeats: [BuiltNode] = []) {
        if node.repeatSpec != nil {
            for template in node.children {
                indexNodes(template, repeats: repeats + [node])
            }
            return
        }
        // A construct's branches hold ordinary nodes that are simply not
        // reached through `children`. Missing them here leaves their
        // emissions with no binding to find, reported as invalidEmission.
        if let branches = node.branchNodes {
            for child in branches { indexNodes(child, repeats: repeats) }
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

    /// Where every instance of the current tree comes from, built on demand.
    func locate(_ reference: String) -> InstanceLocation? {
        if instanceIndex == nil {
            var index: [String: InstanceLocation] = [:]
            func walk(_ node: ResolvedNode) {
                if !node.identities.isEmpty {
                    index[node.reference] = InstanceLocation(base: node.base, identities: node.identities)
                }
                for child in node.children { walk(child) }
            }
            walk(resolvedRoot)
            instanceIndex = index
        }
        return instanceIndex?[reference]
    }

    /// The `$repeat` bindings an instance's emission dispatches with: the
    /// element each identity names, evaluated now, outermost repeat first.
    /// The detail names what is missing when an identity no longer names
    /// an element.
    func bindingsFor(
        _ info: NodeEvents, identities: [String]
    ) -> Result<[String: MilanoValue], MissingInstance> {
        var bindings: [String: MilanoValue] = [:]
        var enclosing: [String] = []
        for (level, repeatNode) in info.repeats.enumerated() {
            let identity = identities[level]
            let reference = repeatNode.reference + MilanoResolver.suffix(of: enclosing)
            let elements = MilanoResolver.repeatElements(
                repeatNode, reference: reference,
                state: state, context: context, report: { _ in }, bindings: bindings, env: env)
            guard let spec = repeatNode.repeatSpec else { return .failure(MissingInstance(detail: "index \(identity)")) }
            let index: Int
            if spec.key != nil {
                // The identities of the current elements are their keys,
                // distinct by the invariant every accepted update keeps.
                let current = (try? MilanoResolver.instanceIdentities(
                    repeatNode, reference: reference, elements: elements,
                    state: state, context: context, report: { _ in }, bindings: bindings, env: env)) ?? []
                guard let found = current.firstIndex(of: identity) else {
                    return .failure(MissingInstance(detail: "key \(identity)"))
                }
                index = found
            } else {
                guard let parsed = Int(identity), parsed >= 0, parsed < elements.count else {
                    return .failure(MissingInstance(detail: "index \(identity)"))
                }
                index = parsed
            }
            bindings = MilanoResolver.elementBindings(
                as: spec.as, element: elements[index], index: index, outer: bindings)
            enclosing.append(identity)
        }
        return .success(bindings)
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

    /// The host's signal that the view has come on screen (state and
    /// actions spec, Lifecycle signals).
    func appear() {
        dispatcher.dispatch { [weak self] in
            self?.processLifecycle(appear: true)
        }
    }

    /// The host's signal that the view has left the screen.
    func disappear() {
        dispatcher.dispatch { [weak self] in
            self?.processLifecycle(appear: false)
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
        // A dispatch of a document since replaced: its follow-ups belong to
        // a document that no longer exists. It still counts as completed.
        if dispatchIndex < replacedBefore {
            report(.completionAfterReplace, node: nil, name: action)
            return
        }
        let record = dispatched[dispatchIndex]

        // The completion's value against the declared type for its
        // outcome: a missing value counts as null, a value for an outcome
        // declaring no type never validates. An invalid completion is
        // consumed without running either branch (state and actions spec).
        let declared = success ? record.resultType : record.failureType
        var value: MilanoValue?
        if let declared {
            guard let validated = declared.validated(payload ?? .null) else {
                report(
                    .invalidCompletion, node: nil, name: action,
                    expected: MilanoGate.name(of: declared),
                    found: MilanoGate.name(of: payload ?? .null))
                return
            }
            value = validated
        } else if let supplied = payload {
            report(
                .invalidCompletion, node: nil, name: action,
                expected: success ? "no result" : "no payload",
                found: MilanoGate.name(of: supplied))
            return
        }

        self.record(
            success ? .completionSucceeded : .completionFailed,
            node: record.sourceNode, name: record.action.name, value: value,
            dispatch: record.action.dispatch)

        let followUps = success ? record.onSuccess : record.onFailure
        guard !followUps.isEmpty else { return }
        let scope = ActionScope(
            event: record.capturedEvent, result: success ? value : nil, failure: success ? nil : value,
            bindings: record.capturedBindings, sourceNode: record.sourceNode)
        let fromWatch = record.fromWatch
        enqueue { [weak self] in
            guard let self else { return }
            // Follow-ups of a dispatch made from a watch list run with
            // watches suppressed, like the list itself.
            if fromWatch { self.watchDepth += 1 }
            defer { if fromWatch { self.watchDepth -= 1 } }
            self.execute(followUps, scope: scope)
        }
    }

    func enqueue(_ work: @escaping () -> Void) {
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

    /// The tree an update would produce, with the reports it raised held
    /// back: nothing reaches the observer until the update is accepted,
    /// and a rejected one leaves no trace. A keyed repeat that would render
    /// one key twice is a conflict, not a tree.
    func materialize(
        changed: Set<String>, state: [String: MilanoValue], context: [String: MilanoValue]
    ) -> Materialized {
        var reports: [ResolutionReport] = []
        do {
            let tree = try MilanoResolver.refresh(
                root, index: dependencies, resolved: resolvedRoot, changed: changed,
                state: state, context: context,
                report: { reports.append($0) }, env: env)
            return .tree(tree, count: tree.map(MilanoResolver.countNodes) ?? 0, reports: reports)
        } catch let conflict as RepeatKeyConflict {
            return .conflict(key: conflict.key)
        } catch {
            return .tree(nil, count: 0, reports: reports)
        }
    }

    /// Adopts a materialized tree, flushes its reports, notifies the host.
    func commit(_ tree: ResolvedNode?, reports: [ResolutionReport]) {
        for held in reports {
            report(held.kind, node: held.node, name: held.name, expected: held.expected, found: held.found)
        }
        // Nothing depended on the change: the tree stays, and there is
        // nothing to tell the host.
        guard let next = tree else { return }
        resolvedRoot = next
        instanceIndex = nil
        onChange?()
    }

    func report(
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
        value: MilanoValue?, dispatch: Int? = nil
    ) {
        engine.userInteractionObserver?.interaction(
            MilanoUserInteraction(
                kind: kind, viewIdentity: identity,
                node: node, name: name, value: value, dispatch: dispatch))
    }
}
