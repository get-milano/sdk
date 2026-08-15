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

/// Full re-evaluation, per the v1 strategy: every resolution walks the whole
/// tree. Evaluation is total; division by zero and saturation report through
/// the occurrence pipeline, attributed to the owning node.
enum MilanoResolver {
    static func resolve(
        _ node: BuiltNode,
        state: [String: MilanoValue],
        context: [String: MilanoValue],
        report: @escaping (MilanoOccurrence.Kind, String) -> Void
    ) -> ResolvedNode {
        var values: [String: MilanoValue] = [:]
        for (name, value) in node.properties {
            switch value {
            case .literal(let literal):
                values[name] = literal
            case .typedExpression(_, let expr, let expected):
                let evaluator = ExprEvaluator(
                    state: state, context: context, event: nil,
                    node: node.reference,
                    report: { kind in report(kind, node.reference) })
                let result = evaluator.evaluate(expr)
                // Canonicalize toward the declared type (int where double
                // is declared).
                values[name] = expected.validated(result) ?? result
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
}
