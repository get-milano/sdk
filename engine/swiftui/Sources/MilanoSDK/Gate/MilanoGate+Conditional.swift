import Foundation

// MARK: - The $if construct (contract 2.1)

extension MilanoGate {
    /// The `$if` construct (document model spec, Constructs): never the
    /// root, no properties, bindings, or id, a bool expression as the
    /// condition, and both branches validated, so a defect in the branch a
    /// build does not take still fails that build.
    func validateConditional(
        _ node: RawNode, in document: ParsedDocument, path: String, reference: String,
        seenIds: inout Set<String>, bindings: [String: MilanoType]
    ) throws -> BuiltNode {
        func violation(_ expected: String, _ found: String?) -> MilanoBuildError {
            MilanoBuildError.schemaViolation(
                rule: "conditional", node: reference, expected: expected, found: found)
        }
        if path == "root" { throw violation("not the root", "root") }
        if !node.properties.isEmpty { throw violation("no properties", "properties") }
        if !node.events.isEmpty { throw violation("no on", "on") }
        if let id = node.id { throw violation("no id", id) }
        guard let spec = node.conditionalSpec else { throw violation("condition expression", nil) }
        if let undeclared = spec.undeclared.first { throw violation("declared key", undeclared) }
        guard let condition = spec.condition else { throw violation("condition expression", nil) }
        if case .literal(let literal) = condition {
            throw violation("condition expression", Self.name(of: literal))
        }
        guard let then = spec.then else { throw violation("then branch", nil) }
        if then.isEmpty { throw violation("then branch", "empty") }
        if let otherwise = spec.otherwise, otherwise.isEmpty {
            throw violation("else branch", "empty")
        }

        guard case .expression(let source) = condition else {
            throw violation("condition expression", nil)
        }
        let scalarLength = source.unicodeScalars.count
        if scalarLength > engine.limits.maxExpressionLength {
            throw MilanoBuildError.limitExceeded(
                limit: "maxExpressionLength", value: engine.limits.maxExpressionLength,
                actual: scalarLength)
        }
        let expr: Expr
        let conditionType: MilanoType?
        do {
            expr = try ExprParser.parse(source)
            conditionType = try checker(
                document, eventScope: .unavailable, resultScope: .unavailable,
                failureScope: .unavailable, bindings: bindings
            ).infer(expr)
        } catch let error as ExprFeatureError {
            throw MilanoBuildError.schemaViolation(
                rule: "contract-feature", node: reference,
                expected: error.version, found: error.feature)
        } catch is ExprError {
            throw MilanoBuildError.schemaViolation(
                rule: "expression", node: reference, expected: "bool", found: nil)
        }
        guard let conditionType, case .bool = conditionType.kind, !conditionType.optional else {
            throw violation("bool condition", conditionType.map { Self.name(of: $0) } ?? "null")
        }

        // Both branches are part of the document, so both are validated
        // and ids stay unique across them.
        func branch(_ nodes: [RawNode], _ name: String) throws -> [BuiltNode] {
            var built: [BuiltNode] = []
            for (index, child) in nodes.enumerated() {
                if let one = try validate(
                    child, in: document, path: "\(path)/\(name)[\(index)]", seenIds: &seenIds,
                    bindings: bindings) {
                    built.append(one)
                }
            }
            return built
        }

        return BuiltNode(
            type: node.type, reference: reference, isPlaceholder: false, rawSubtree: nil,
            properties: [:], children: [], events: [:],
            conditional: BuiltConditional(
                condition: .typedExpression(source: source, expr: expr, expected: conditionType),
                then: try branch(then, "then"),
                otherwise: try spec.otherwise.map { try branch($0, "else") } ?? []))
    }
}
