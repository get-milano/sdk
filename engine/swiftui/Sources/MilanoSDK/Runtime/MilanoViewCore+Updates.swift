import Foundation

// MARK: - Emissions, lifecycle, and context updates (always on the dispatcher)

extension MilanoViewCore {
    func processLifecycle(appear: Bool) {
        guard !tornDown else { return }
        // A redundant signal carries no work: ignored silently.
        guard appeared != appear else { return }
        appeared = appear
        record(appear ? .viewAppeared : .viewDisappeared, node: nil, name: nil, value: nil)
        guard let actions = lifecycle[appear ? "appear" : "disappear"], !actions.isEmpty else { return }
        enqueue { [weak self] in
            self?.execute(actions, scope: ActionScope())
        }
    }

    func processEmission(node: String, event: String, payload: MilanoValue?) {
        guard !tornDown else { return }
        // A plain reference, or an instance reference: located in the
        // current tree, never parsed, so a key may contain any character.
        var info = nodeEvents[node]
        var identities: [String] = []
        if info == nil || !(info?.repeats.isEmpty ?? true) {
            if let located = locate(node) {
                if let candidate = nodeEvents[located.base], candidate.repeats.count == located.identities.count {
                    info = candidate
                    identities = located.identities
                } else {
                    info = nil
                }
            } else {
                // Not in the current tree: an instance that has vanished,
                // which the report names, or a node that never existed.
                if let vanished = vanishedInstance(node) {
                    report(.invalidEmission, node: node, name: event, expected: "repeat element", found: vanished)
                    return
                }
                info = nil
            }
        }
        guard let info else {
            report(.invalidEmission, node: node, name: event, expected: "declared event", found: "unknown node")
            return
        }
        let bindings: [String: MilanoValue]
        switch bindingsFor(info, identities: identities) {
        case .success(let bound):
            bindings = bound
        case .failure(let missing):
            report(.invalidEmission, node: node, name: event, expected: "repeat element", found: missing.detail)
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
        let scope = ActionScope(event: eventValue, bindings: bindings, sourceNode: node)
        enqueue { [weak self] in
            self?.execute(actions, scope: scope)
        }
    }

    /// An emission naming an instance the current tree no longer has: the
    /// reference ends in bracketed identities whose template is a repeated
    /// node. The detail names the last identity, as an index or a key by
    /// the innermost repeat's shape.
    private func vanishedInstance(_ reference: String) -> String? {
        var base = Substring(reference)
        var parts: [String] = []
        while base.hasSuffix("]"), let open = base.lastIndex(of: "[") {
            let inner = base[base.index(after: open)..<base.index(before: base.endIndex)]
            guard !inner.contains("[") else { break }
            parts.insert(String(inner), at: 0)
            base = base[..<open]
        }
        guard !parts.isEmpty, let info = nodeEvents[String(base)], info.repeats.count == parts.count,
            let innermost = info.repeats.last, let last = parts.last
        else { return nil }
        return innermost.repeatSpec?.key != nil ? "key \(last)" : "index \(last)"
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
        // limit, or a keyed repeat rendering one key twice, rejects the
        // update whole.
        guard !changed.isEmpty else {
            context = canonical
            return
        }
        switch materialize(changed: changed, state: state, context: canonical) {
        case .conflict(let key):
            report(.rejectedContextUpdate, node: nil, name: lastKey, expected: "distinct key", found: key)
        case .tree(_, let count, _) where count > engine.limits.maxNodeCount:
            report(
                .rejectedContextUpdate, node: nil, name: lastKey,
                expected: "maxNodeCount", found: "\(count)")
        case .tree(let tree, _, let reports):
            context = canonical
            commit(tree, reports: reports)
        }
    }
}
