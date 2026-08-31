import Foundation

// MARK: - Action lists, mutations, and watches (always on the dispatcher)

extension MilanoViewCore {
    /// Runs an action list. Returns false when the list ended early: a
    /// mutation past a limit, producing a repeated key, or addressing an
    /// index outside the array assigns nothing, is reported, and stops the
    /// remaining actions of the dispatch; what the list already applied
    /// stays.
    @discardableResult
    func execute(_ actions: [ActionSpec], scope: ActionScope) -> Bool {
        for action in actions {
            switch action {
            case .set, .append, .remove, .update:
                guard mutate(action, scope: scope) else { return false }

            case .arrayAction:
                // Unreachable: the gate replaces every parsed array action.
                assertionFailure("an array action reached execution unvalidated")

            case .sequence(let nested):
                guard execute(nested, scope: scope) else { return false }

            case .when(let condition, let then, let otherwise):
                let takeThen = evaluate(condition, scope: scope).boolValue == true
                guard execute(takeThen ? then : otherwise, scope: scope) else { return false }

            case .custom(let name, let parameters, let onSuccess, let onFailure, let resultType, let failureType):
                dispatchCustom(
                    name: name, parameters: parameters, onSuccess: onSuccess, onFailure: onFailure,
                    resultType: resultType, failureType: failureType, scope: scope)
            }
        }
        return true
    }

    /// A custom action: parameters captured now, the dispatch recorded and
    /// numbered, the handler invoked asynchronously. Dispatch does not
    /// wait: the sequence continues immediately.
    private func dispatchCustom(
        name: String, parameters: [String: DocValue], onSuccess: [ActionSpec], onFailure: [ActionSpec],
        resultType: MilanoType?, failureType: MilanoType?, scope: ActionScope
    ) {
        var captured: [String: MilanoValue] = [:]
        for (parameter, value) in parameters.byKey {
            captured[parameter] = evaluate(value, scope: scope)
        }
        // The dispatch identity: the position among this view's dispatches,
        // and a process-unique id minted from the view instance's token.
        let index = dispatched.count
        let action = MilanoAction(
            name: name, parameters: captured, viewIdentity: identity,
            dispatch: index, dispatchId: "\(instanceToken)#\(index)")
        record(
            .actionDispatched, node: scope.sourceNode, name: name,
            value: .record(captured), dispatch: index)
        dispatched.append(
            DispatchRecord(
                action: action, completed: false,
                onSuccess: onSuccess, onFailure: onFailure,
                capturedEvent: scope.event, capturedBindings: scope.bindings,
                resultType: resultType, failureType: failureType, sourceNode: scope.sourceNode,
                fromWatch: watchDepth > 0))
        guard let handler else { return }
        // Captured strongly so a completion for a deallocated view
        // (deallocation counts as teardown) still reports.
        let observer = engine.observer
        let identity = identity
        Task { [weak self] in
            let success: Bool
            let payload: MilanoValue?
            do {
                payload = try await handler.handle(action)
                success = true
            } catch let failure as MilanoActionFailure {
                // The failure payload; any other error is a failure with none.
                payload = failure.value
                success = false
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
                self.complete(dispatchIndex: index, success: success, payload: payload)
            }
        }
    }

    /// A state mutation (state and actions spec, Action execution): the
    /// value `$set` assigns, or the array an array action produces, then
    /// the one assignment path. Returns false when the mutation was
    /// rejected and the list must end.
    private func mutate(_ action: ActionSpec, scope: ActionScope) -> Bool {
        switch action {
        case .set(let key, let value):
            let evaluated = evaluate(value, scope: scope)
            let next = document.stateDeclarations[key]?.validated(evaluated) ?? evaluated
            return assign(key, next, sourceNode: scope.sourceNode)

        case .append(let key, let value):
            let evaluated = evaluate(value, scope: scope)
            let element = elementType(of: key)?.validated(evaluated) ?? evaluated
            let items = state[key]?.arrayValue ?? []
            return assign(key, .array(items + [element]), sourceNode: scope.sourceNode)

        case .remove(let key, let at):
            var items = state[key]?.arrayValue ?? []
            let position = evaluate(at, scope: scope)
            guard let index = indexInRange(position, of: key, count: items.count, sourceNode: scope.sourceNode)
            else { return false }
            items.remove(at: index)
            return assign(key, .array(items), sourceNode: scope.sourceNode)

        case .update(let key, let at, let field, let value):
            var items = state[key]?.arrayValue ?? []
            // `at`, then `value`, then the range: the spec's order.
            let position = evaluate(at, scope: scope)
            let evaluated = evaluate(value, scope: scope)
            guard let index = indexInRange(position, of: key, count: items.count, sourceNode: scope.sourceNode)
            else { return false }
            var fieldType: MilanoType?
            if case .record(let fields)? = elementType(of: key)?.kind { fieldType = fields[field] }
            var element = items[index].recordValue ?? [:]
            element[field] = fieldType?.validated(evaluated) ?? evaluated
            items[index] = .record(element)
            return assign(key, .array(items), sourceNode: scope.sourceNode)

        default:
            return true
        }
    }

    /// The element type of an array-typed state key.
    private func elementType(of key: String) -> MilanoType? {
        guard case .array(let element)? = document.stateDeclarations[key]?.kind else { return nil }
        return element
    }

    /// The index an array action evaluated, when it addresses an element.
    /// An index below zero or at or past the array's length is a rejected
    /// mutation expecting an index in range and finding the index in
    /// decimal; nothing is assigned.
    private func indexInRange(
        _ value: MilanoValue, of key: String, count: Int, sourceNode: String?
    ) -> Int? {
        let at = value.intValue ?? 0
        guard at >= 0, at < Int64(count) else {
            report(
                .rejectedMutation, node: sourceNode, name: key,
                expected: "index in range", found: String(at))
            return nil
        }
        return Int(at)
    }

    /// The one assignment path: the value against the value size limit,
    /// the no-change rule, the re-materialized tree against the node count
    /// limit and the distinct-key invariant, then commit, then the key's
    /// watch.
    private func assign(_ key: String, _ next: MilanoValue, sourceNode: String?) -> Bool {
        let size = next.size
        if size > engine.limits.maxValueSize {
            report(
                .rejectedMutation, node: sourceNode, name: key,
                expected: "maxValueSize", found: "\(size)")
            return false
        }
        // A value that did not change re-resolves nothing and triggers no watch.
        if state[key] == next { return true }
        var nextState = state
        nextState[key] = next
        // Visible immediately: the properties that read this key re-resolve
        // before the next action. A tree materialized past the node count
        // limit, or a keyed repeat rendering one key twice, rejects the
        // mutation instead.
        switch materialize(changed: ["state.\(key)"], state: nextState, context: context) {
        case .conflict(let conflicting):
            report(.rejectedMutation, node: sourceNode, name: key, expected: "distinct key", found: conflicting)
            return false
        case .tree(_, let count, _) where count > engine.limits.maxNodeCount:
            report(
                .rejectedMutation, node: sourceNode, name: key,
                expected: "maxNodeCount", found: "\(count)")
            return false
        case .tree(let tree, _, let reports):
            state = nextState
            commit(tree, reports: reports)
            runWatch(key)
            return true
        }
    }

    /// The key's watch list, as part of the mutation that changed it
    /// (state and actions spec, Watch bindings): before the next action of
    /// the list that applied it, with no event root and no repeat binding,
    /// anchored to no node. Never from inside a watch: a watch never
    /// triggers a watch. A rejection inside ends the watch list only.
    private func runWatch(_ key: String) {
        guard watchDepth == 0, let actions = watch[key], !actions.isEmpty else { return }
        watchDepth += 1
        defer { watchDepth -= 1 }
        execute(actions, scope: ActionScope())
    }

    func evaluate(_ value: DocValue, scope: ActionScope) -> MilanoValue {
        switch value {
        case .literal(let literal):
            return literal
        case .typedExpression(_, let expr, let expected):
            let evaluator = ExprEvaluator(
                state: state, context: context, event: scope.event, result: scope.result, node: nil,
                report: { [weak self] kind, detail in
                    self?.report(
                        kind, node: nil, name: detail?.name, expected: detail?.expected, found: detail?.found)
                },
                bindings: scope.bindings, failure: scope.failure, env: env)
            let evaluated = evaluator.evaluate(expr)
            return expected.validated(evaluated) ?? evaluated
        case .expression:
            return .null
        }
    }
}
