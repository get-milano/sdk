import Foundation

/// A node with every property expression evaluated: what renderers see.
struct ResolvedNode: Sendable {
    let type: String
    let reference: String
    let isPlaceholder: Bool
    let rawSubtree: MilanoValue?
    let values: [String: MilanoValue]
    let children: [ResolvedNode]
}

/// What a built subtree reads: per property, the keys its expression
/// depends on; for the subtree as a whole, their union. Built once per
/// view, aligned with the built tree's children, so an update knows which
/// nodes to revisit without walking the rest.
struct DependencyNode: Sendable {
    let own: [String: Set<String>]
    let subtree: Set<String>
    let children: [DependencyNode]
}

/// Resolution: the first pass evaluates every property expression; every
/// later pass re-evaluates only what reads a key whose value changed.
/// Evaluation is total; division by zero and saturation report through the
/// occurrence pipeline, attributed to the owning node and property.
enum MilanoResolver {
    typealias Report = (MilanoOccurrence.Kind, String, String) -> Void

    private static func evaluate(
        _ expr: Expr, expected: MilanoType, reference: String, name: String,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report
    ) -> MilanoValue {
        let evaluator = ExprEvaluator(
            state: state, context: context, event: nil,
            node: reference,
            report: { kind in report(kind, reference, name) })
        let result = evaluator.evaluate(expr)
        // Canonicalize toward the declared type (int where double is declared).
        return expected.validated(result) ?? result
    }

    static func resolve(
        _ node: BuiltNode,
        state: [String: MilanoValue],
        context: [String: MilanoValue],
        report: @escaping Report
    ) -> ResolvedNode {
        var values: [String: MilanoValue] = [:]
        for (name, value) in node.properties {
            switch value {
            case .literal(let literal):
                values[name] = literal
            case .typedExpression(_, let expr, let expected):
                values[name] = evaluate(
                    expr, expected: expected, reference: node.reference, name: name,
                    state: state, context: context, report: report)
            case .expression:
                // Unreachable: the gate types every expression.
                values[name] = .null
            }
        }
        return ResolvedNode(
            type: node.type,
            reference: node.reference,
            isPlaceholder: node.isPlaceholder,
            rawSubtree: node.rawSubtree,
            values: values,
            children: node.children.map { resolve($0, state: state, context: context, report: report) })
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
        let children = node.children.map(index)
        for child in children { subtree.formUnion(child.subtree) }
        return DependencyNode(own: own, subtree: subtree, children: children)
    }

    /// Re-resolution after an update: only the properties that read a
    /// changed key are re-evaluated and only the path from those nodes to
    /// the root is rebuilt. Returns nil when nothing under `node` depends
    /// on the change, so the caller keeps what it had.
    static func refresh(
        _ node: BuiltNode, index: DependencyNode, resolved: ResolvedNode,
        changed: Set<String>,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report
    ) -> ResolvedNode? {
        guard !index.subtree.isDisjoint(with: changed) else { return nil }

        var values = resolved.values
        for (name, keys) in index.own where !keys.isDisjoint(with: changed) {
            guard case .typedExpression(_, let expr, let expected)? = node.properties[name] else { continue }
            values[name] = evaluate(
                expr, expected: expected, reference: node.reference, name: name,
                state: state, context: context, report: report)
        }

        var children = resolved.children
        for (position, child) in node.children.enumerated() {
            if let refreshed = refresh(
                child, index: index.children[position], resolved: resolved.children[position],
                changed: changed, state: state, context: context, report: report) {
                children[position] = refreshed
            }
        }
        return ResolvedNode(
            type: resolved.type,
            reference: resolved.reference,
            isPlaceholder: resolved.isPlaceholder,
            rawSubtree: resolved.rawSubtree,
            values: values,
            children: children)
    }
}
