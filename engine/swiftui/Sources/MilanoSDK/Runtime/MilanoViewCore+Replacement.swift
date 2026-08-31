import Foundation

/// A replacement's plan, prepared by the builder (state and actions spec,
/// Document replacement): the new document through the gate, and the
/// provider's values for the keys that do not carry over, or nil when
/// every key carries over and the provider was not consulted.
struct ReplacementPlan: Sendable {
    let document: ParsedDocument
    let root: BuiltNode
    let lifecycle: [String: [ActionSpec]]
    let watch: [String: [ActionSpec]]
    /// Occurrences the gate detected, reported only when the swap lands.
    let pending: [MilanoOccurrence]
    let provided: [String: MilanoValue]?
}

/// Prepares a replacement under the builder's configuration: the new
/// document's bytes and the declarations the view currently holds, to the
/// plan the swap completes.
typealias Replacer = @Sendable (Data, [String: MilanoType]) async throws -> ReplacementPlan

// MARK: - Document replacement

extension MilanoViewCore {
    /// Replaces the document the view is bound to (state and actions spec,
    /// Document replacement): the new document passes the gate under the
    /// surface's configuration, state whose declaration is unchanged
    /// carries over, the provider supplies the rest, and the swap lands on
    /// the dispatcher, serialized with dispatch. Throws what `build()`
    /// throws; on a throw the view is exactly as it was. Ignored after
    /// teardown.
    func replace(document data: Data) async throws {
        guard !tornDown, let replacer else { return }
        // The gate and the provider run before anything touches the view;
        // the swap itself is one queued unit, so it never lands
        // mid-action-list.
        let plan = try await replacer(data, document.stateDeclarations)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            dispatcher.dispatch { [self] in
                self.enqueue {
                    do {
                        try self.swap(plan)
                        continuation.resume()
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }

    /// The swap, one queued unit: the held context against the new
    /// declarations, state carried where the declaration is unchanged and
    /// taken from the provider otherwise, the tree resolved whole; any
    /// failure throws before anything changes. Then the view adopts the
    /// new document, keeps its identity, numbering, and appeared state,
    /// and reports what the gate held back.
    private func swap(_ plan: ReplacementPlan) throws {
        guard !tornDown else { return }
        let next = plan.document
        let limits = engine.limits
        let nextContext = try MilanoGate.validateContext(next, supplied: context, limits: limits)

        var merged: [String: MilanoValue] = [:]
        for (key, type) in next.stateDeclarations {
            if let previous = document.stateDeclarations[key], let current = state[key], previous == type {
                merged[key] = current
            } else if let provided = plan.provided?[key] {
                merged[key] = provided
            }
        }
        let nextState = next.stateDeclarations.isEmpty
            ? [:] : try MilanoGate.validateState(next, provided: merged, limits: limits)

        var pending = plan.pending
        let tree: ResolvedNode
        do {
            tree = try MilanoResolver.resolve(
                plan.root, state: nextState, context: nextContext,
                report: { pending.append($0.occurrence(in: self.identity)) }, env: env)
        } catch let conflict as RepeatKeyConflict {
            throw MilanoBuildError.schemaViolation(
                rule: "repeat", node: conflict.reference, expected: "distinct key", found: conflict.key)
        }
        let count = MilanoResolver.countNodes(tree)
        if count > limits.maxNodeCount {
            throw MilanoBuildError.limitExceeded(limit: "maxNodeCount", value: limits.maxNodeCount, actual: count)
        }

        // Nothing above changed the view; from here everything does, at once.
        document = next
        root = plan.root
        lifecycle = plan.lifecycle
        watch = plan.watch
        dependencies = MilanoResolver.index(plan.root)
        nodeEvents = [:]
        indexNodes(plan.root)
        context = nextContext
        state = nextState
        resolvedRoot = tree
        instanceIndex = nil
        replacedBefore = dispatched.count
        for occurrence in pending {
            engine.observer?.occurrence(occurrence)
        }
        record(.viewReplaced, node: nil, name: nil, value: next.metadata)
        onChange?()
    }
}
