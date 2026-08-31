import Foundation

/// The resolved tree a binding renders: every property a value. Immutable;
/// re-resolution produces a new tree, sharing untouched subtrees.
struct ResolvedNode: Sendable {
    let type: String
    let reference: String
    let isPlaceholder: Bool
    let rawSubtree: MilanoValue?
    let values: [String: MilanoValue]
    let children: [ResolvedNode]
    /// Resolved children per built child, in order: one for a component
    /// node, the instance count for a `$repeat`. Internal to re-resolution.
    var spans: [Int] = []
    /// The template node's reference and, for a `$repeat` instance, the
    /// identity of each enclosing instance (an index or a key rendering,
    /// outermost first), which together make `reference`. Internal: what
    /// lets an emission find its template without parsing the reference.
    var base: String = ""
    var identities: [String] = []
}

/// Two elements of a keyed `$repeat` rendering the same key: a data
/// defect. The gate reports it as a build error; at runtime the update
/// that produced it is rejected whole.
struct RepeatKeyConflict: Error {
    let reference: String
    let key: String
}

/// What a built subtree reads: per property, the keys its expression
/// depends on; for the subtree as a whole, their union. A `$repeat`'s
/// subtree includes what its `items` read, since every instance derives
/// from them. Built once per view, aligned with the built tree's children.
struct DependencyNode: Sendable {
    let own: [String: Set<String>]
    let subtree: Set<String>
    let children: [DependencyNode]
}

/// An occurrence raised while resolving: the kind, the node and property
/// being resolved, and, for an invalid function result, its detail (whose
/// name is the function's, replacing the property's).
struct ResolutionReport: Sendable {
    let kind: MilanoOccurrence.Kind
    let node: String
    let name: String
    var expected: String?
    var found: String?

    func occurrence(in viewIdentity: String) -> MilanoOccurrence {
        MilanoOccurrence(
            kind: kind, viewIdentity: viewIdentity, node: node,
            name: name, expected: expected, found: found)
    }
}

/// Resolution: the first pass evaluates every property expression and
/// materializes every `$repeat`; every later pass re-evaluates only what
/// reads a key whose value changed. Evaluation is total; division by zero,
/// saturation, and invalid function results report through the occurrence
/// pipeline, attributed to the owning node and property.
enum MilanoResolver {
    typealias Report = (ResolutionReport) -> Void
    typealias Bindings = [String: MilanoValue]

    private static func evaluate(
        _ expr: Expr, expected: MilanoType, reference: String, name: String,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, env: EvalEnvironment = .none
    ) -> MilanoValue {
        let evaluator = ExprEvaluator(
            state: state, context: context, event: nil, result: nil,
            node: reference,
            report: { kind, detail in
                report(ResolutionReport(
                    kind: kind, node: reference, name: detail?.name ?? name,
                    expected: detail?.expected, found: detail?.found))
            },
            bindings: bindings, env: env)
        let result = evaluator.evaluate(expr)
        // Canonicalize toward the declared type (int where double is declared).
        return expected.validated(result) ?? result
    }

    /// The elements a `$repeat` instantiates over, right now.
    static func repeatElements(
        _ node: BuiltNode, reference: String,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, env: EvalEnvironment = .none
    ) -> [MilanoValue] {
        guard let spec = node.repeatSpec,
            case .typedExpression(_, let expr, let expected) = spec.items
        else { return [] }
        return evaluate(
            expr, expected: expected, reference: reference, name: "items",
            state: state, context: context, report: report, bindings: bindings, env: env
        ).arrayValue ?? []
    }

    /// The template's bindings for one element.
    static func elementBindings(
        as alias: String, element: MilanoValue, index: Int, outer: Bindings
    ) -> Bindings {
        var bound = outer
        bound[alias] = element
        bound["\(alias)_index"] = .int(Int64(index))
        return bound
    }

    /// A key's rendering in an instance reference (document model spec,
    /// Constructs): a string verbatim, an int in decimal.
    static func renderKey(_ value: MilanoValue) -> String {
        switch value {
        case .string(let text): return text
        case .int(let number): return String(number)
        default: return ""
        }
    }

    /// The bracketed identities that make an instance reference: `[2][abc]`.
    static func suffix(of identities: [String]) -> String {
        identities.map { "[\($0)]" }.joined()
    }

    /// The identity of every instance a `$repeat` materializes: the key's
    /// rendering per element when it declares one, the element index
    /// otherwise. Keys are distinct within one materialization.
    static func instanceIdentities(
        _ node: BuiltNode, reference: String, elements: [MilanoValue],
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, env: EvalEnvironment = .none
    ) throws -> [String] {
        guard let spec = node.repeatSpec,
            case .typedExpression(_, let expr, let expected)? = spec.key
        else {
            return elements.indices.map { String($0) }
        }
        var identities: [String] = []
        var seen: Set<String> = []
        for (index, element) in elements.enumerated() {
            let bound = elementBindings(as: spec.as, element: element, index: index, outer: bindings)
            let identity = renderKey(evaluate(
                expr, expected: expected, reference: reference, name: "key",
                state: state, context: context, report: report, bindings: bound, env: env))
            guard seen.insert(identity).inserted else {
                throw RepeatKeyConflict(reference: reference, key: identity)
            }
            identities.append(identity)
        }
        return identities
    }

    private static func resolveRepeat(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, identities: [String], env: EvalEnvironment
    ) throws -> [ResolvedNode] {
        guard let spec = node.repeatSpec else { return [] }
        var instances: [ResolvedNode] = []
        let reference = node.reference + suffix(of: identities)
        let elements = repeatElements(
            node, reference: reference, state: state, context: context,
            report: report, bindings: bindings, env: env)
        let instanceIds = try instanceIdentities(
            node, reference: reference, elements: elements, state: state, context: context,
            report: report, bindings: bindings, env: env)
        for (index, element) in elements.enumerated() {
            let bound = elementBindings(as: spec.as, element: element, index: index, outer: bindings)
            let instanceIdentities = identities + [instanceIds[index]]
            for template in node.children {
                // A nested construct instantiates within this element's scope.
                instances.append(contentsOf: try materialize(
                    template, state: state, context: context, report: report,
                    bindings: bound, identities: instanceIdentities, env: env))
            }
        }
        return instances
    }

    /// The `$if` construct (document model spec, Constructs): the condition
    /// is evaluated and only the chosen branch materializes, as only the
    /// taken branch of the `$if` function is evaluated. Like a repeat, the
    /// construct is transparent: its branch's nodes take its place.
    private static func resolveConditional(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, identities: [String], env: EvalEnvironment
    ) throws -> [ResolvedNode] {
        guard let spec = node.conditional else { return [] }
        let reference = node.reference + suffix(of: identities)
        guard case .typedExpression(_, let expr, let expected) = spec.condition else { return [] }
        let taken = evaluate(
            expr, expected: expected, reference: reference, name: "condition",
            state: state, context: context, report: report, bindings: bindings, env: env)
        let branch = taken == .bool(true) ? spec.then : spec.otherwise
        var chosen: [ResolvedNode] = []
        for child in branch {
            chosen.append(contentsOf: try materialize(
                child, state: state, context: context, report: report,
                bindings: bindings, identities: identities, env: env))
        }
        return chosen
    }

    /// The `$switch` construct (document model spec, Constructs): the
    /// subject is evaluated and only the member's branch materializes, or
    /// the default when the cases do not name it.
    private static func resolveSwitch(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, identities: [String], env: EvalEnvironment
    ) throws -> [ResolvedNode] {
        guard let spec = node.choice,
            case .typedExpression(_, let expr, let expected) = spec.subject
        else { return [] }
        let reference = node.reference + suffix(of: identities)
        let value = evaluate(
            expr, expected: expected, reference: reference, name: "subject",
            state: state, context: context, report: report, bindings: bindings, env: env)
        var branch: [BuiltNode] = spec.fallback ?? []
        if case .string(let member) = value, let named = spec.cases[member] {
            branch = named
        }
        var chosen: [ResolvedNode] = []
        for child in branch {
            chosen.append(contentsOf: try materialize(
                child, state: state, context: context, report: report,
                bindings: bindings, identities: identities, env: env))
        }
        return chosen
    }

    /// One document node as the nodes it materializes: itself, or, for a
    /// transparent construct, however many its branch or its elements make.
    private static func materialize(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, identities: [String], env: EvalEnvironment
    ) throws -> [ResolvedNode] {
        if node.repeatSpec != nil {
            return try resolveRepeat(
                node, state: state, context: context, report: report,
                bindings: bindings, identities: identities, env: env)
        }
        if node.conditional != nil {
            return try resolveConditional(
                node, state: state, context: context, report: report,
                bindings: bindings, identities: identities, env: env)
        }
        if node.choice != nil {
            return try resolveSwitch(
                node, state: state, context: context, report: report,
                bindings: bindings, identities: identities, env: env)
        }
        return [try resolve(
            node, state: state, context: context, report: report,
            bindings: bindings, identities: identities, env: env)]
    }

    private static func resolveChildren(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, identities: [String], env: EvalEnvironment
    ) throws -> (children: [ResolvedNode], spans: [Int]) {
        var children: [ResolvedNode] = []
        var spans: [Int] = []
        for child in node.children {
            let materialized = try materialize(
                child, state: state, context: context, report: report,
                bindings: bindings, identities: identities, env: env)
            children.append(contentsOf: materialized)
            spans.append(materialized.count)
        }
        return (children, spans)
    }

    /// The first resolution. Inside a repeat instance, `identities` carries
    /// the element indices or key renderings that make its reference.
    /// Throws `RepeatKeyConflict` when a keyed repeat renders one key twice.
    static func resolve(
        _ node: BuiltNode,
        state: [String: MilanoValue],
        context: [String: MilanoValue],
        report: @escaping Report,
        bindings: Bindings = [:],
        identities: [String] = [],
        env: EvalEnvironment = .none
    ) throws -> ResolvedNode {
        let reference = node.reference + suffix(of: identities)
        var values: [String: MilanoValue] = [:]
        for (name, value) in node.properties.byKey {
            switch value {
            case .literal(let literal):
                values[name] = literal
            case .typedExpression(_, let expr, let expected):
                values[name] = evaluate(
                    expr, expected: expected, reference: reference, name: name,
                    state: state, context: context, report: report, bindings: bindings, env: env)
            case .expression:
                // Unreachable: the gate types every expression.
                values[name] = .null
            }
        }
        let (children, spans) = try resolveChildren(
            node, state: state, context: context, report: report,
            bindings: bindings, identities: identities, env: env)
        return ResolvedNode(
            type: node.type,
            reference: reference,
            isPlaceholder: node.isPlaceholder,
            rawSubtree: node.rawSubtree,
            values: values,
            children: children,
            spans: spans,
            base: node.reference,
            identities: identities)
    }

    /// Nodes in a resolved tree: the node count limit's runtime measure.
    static func countNodes(_ node: ResolvedNode) -> Int {
        node.children.reduce(1) { $0 + countNodes($1) }
    }

    static func index(_ node: BuiltNode) -> DependencyNode {
        var own: [String: Set<String>] = [:]
        var subtree: Set<String> = []
        for (name, value) in node.properties {
            guard case .typedExpression(_, let expr, _) = value else { continue }
            let keys = expr.dependencies
            own[name] = keys
            subtree.formUnion(keys)
        }
        if let spec = node.repeatSpec, case .typedExpression(_, let expr, _) = spec.items {
            let keys = expr.dependencies
            own["items"] = keys
            subtree.formUnion(keys)
        }
        if let spec = node.repeatSpec, case .typedExpression(_, let expr, _)? = spec.key {
            let keys = expr.dependencies
            own["key"] = keys
            subtree.formUnion(keys)
        }
        // A construct's own expression decides which branch materializes,
        // so a change to what it reads is a change to the subtree.
        if let conditional = node.conditional,
            case .typedExpression(_, let expr, _) = conditional.condition {
            let keys = expr.dependencies
            own["condition"] = keys
            subtree.formUnion(keys)
        }
        if let choice = node.choice, case .typedExpression(_, let expr, _) = choice.subject {
            let keys = expr.dependencies
            own["subject"] = keys
            subtree.formUnion(keys)
        }
        // Branch nodes are indexed too, so their reads reach this subtree.
        // `refresh` addresses `children` positionally against
        // `node.children`, and these sit past that range, read only for
        // the union.
        let children = (node.children + (node.branchNodes ?? [])).map(index)
        for child in children { subtree.formUnion(child.subtree) }
        return DependencyNode(own: own, subtree: subtree, children: children)
    }

    /// Re-resolution after an update: only the properties that read a
    /// changed key are re-evaluated and only the path from those nodes to
    /// the root is rebuilt; a `$repeat` whose subtree reads a changed key is
    /// re-materialized whole. Returns nil when nothing under `node` depends
    /// on the change, so the caller keeps what it had.
    static func refresh(
        _ node: BuiltNode, index: DependencyNode, resolved: ResolvedNode,
        changed: Set<String>,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, env: EvalEnvironment = .none
    ) throws -> ResolvedNode? {
        guard !index.subtree.isDisjoint(with: changed) else { return nil }

        var values = resolved.values
        for (name, keys) in index.own.byKey where !keys.isDisjoint(with: changed) {
            guard case .typedExpression(_, let expr, let expected)? = node.properties[name] else { continue }
            values[name] = evaluate(
                expr, expected: expected, reference: resolved.reference, name: name,
                state: state, context: context, report: report, bindings: [:], env: env)
        }

        var children: [ResolvedNode] = []
        var spans: [Int] = []
        var offset = 0
        for (position, child) in node.children.enumerated() {
            let span = position < resolved.spans.count ? resolved.spans[position] : 1
            let childIndex = index.children[position]
            // Every transparent construct re-materializes wholesale: how
            // many nodes it makes is its own business, and a changed
            // condition or subject can change which nodes those are.
            if child.repeatSpec != nil || child.conditional != nil || child.choice != nil {
                if !childIndex.subtree.isDisjoint(with: changed) {
                    let made = try materialize(
                        child, state: state, context: context, report: report,
                        bindings: [:], identities: resolved.identities, env: env)
                    children.append(contentsOf: made)
                    spans.append(made.count)
                } else {
                    children.append(contentsOf: resolved.children[offset..<offset + span])
                    spans.append(span)
                }
            } else {
                let previous = resolved.children[offset]
                children.append(try refresh(
                    child, index: childIndex, resolved: previous, changed: changed,
                    state: state, context: context, report: report, env: env) ?? previous)
                spans.append(1)
            }
            offset += span
        }
        return ResolvedNode(
            type: resolved.type,
            reference: resolved.reference,
            isPlaceholder: resolved.isPlaceholder,
            rawSubtree: resolved.rawSubtree,
            values: values,
            children: children,
            spans: spans,
            base: resolved.base,
            identities: resolved.identities)
    }
}
