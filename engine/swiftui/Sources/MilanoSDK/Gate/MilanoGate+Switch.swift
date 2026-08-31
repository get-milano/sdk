import Foundation

// MARK: - The $switch construct (contract 2.1)

extension MilanoGate {
    /// The `$switch` construct (document model spec, Constructs): an enum
    /// subject and one branch per member, or a `default` for the rest. A
    /// member that neither covers is the whole point: the gate says so
    /// rather than the view rendering nothing.
    func validateSwitch(
        _ node: RawNode, in document: ParsedDocument, path: String, reference: String,
        seenIds: inout Set<String>, bindings: [String: MilanoType]
    ) throws -> BuiltNode {
        func violation(_ expected: String, _ found: String?) -> MilanoBuildError {
            MilanoBuildError.schemaViolation(
                rule: "switch", node: reference, expected: expected, found: found)
        }
        if path == "root" { throw violation("not the root", "root") }
        if !node.properties.isEmpty { throw violation("no properties", "properties") }
        if !node.events.isEmpty { throw violation("no on", "on") }
        if let id = node.id { throw violation("no id", id) }
        guard let spec = node.switchSpec else { throw violation("subject expression", nil) }
        if let undeclared = spec.undeclared.first { throw violation("declared key", undeclared) }
        guard let subject = spec.subject else { throw violation("subject expression", nil) }
        if case .literal(let literal) = subject {
            throw violation("subject expression", Self.name(of: literal))
        }
        guard let cases = spec.cases else { throw violation("cases", nil) }
        if cases.isEmpty { throw violation("cases", "empty") }

        guard case .expression(let source) = subject else {
            throw violation("subject expression", nil)
        }
        let scalarLength = source.unicodeScalars.count
        if scalarLength > engine.limits.maxExpressionLength {
            throw MilanoBuildError.limitExceeded(
                limit: "maxExpressionLength", value: engine.limits.maxExpressionLength,
                actual: scalarLength)
        }
        let expr: Expr
        let subjectType: MilanoType?
        do {
            expr = try ExprParser.parse(source)
            subjectType = try checker(
                document, eventScope: .unavailable, resultScope: .unavailable,
                failureScope: .unavailable, bindings: bindings
            ).infer(expr)
        } catch let error as ExprFeatureError {
            throw MilanoBuildError.schemaViolation(
                rule: "contract-feature", node: reference,
                expected: error.version, found: error.feature)
        } catch is ExprError {
            throw MilanoBuildError.schemaViolation(
                rule: "expression", node: reference, expected: "enum", found: nil)
        }
        guard let subjectType, case .enumeration(let members) = subjectType.kind,
            !subjectType.optional
        else {
            throw violation("enum subject", subjectType.map { Self.name(of: $0) } ?? "null")
        }

        func branch(_ nodes: [RawNode], _ slot: String) throws -> [BuiltNode] {
            var built: [BuiltNode] = []
            for (index, child) in nodes.enumerated() {
                if let one = try validate(
                    child, in: document, path: "\(path)/\(slot)[\(index)]",
                    seenIds: &seenIds, bindings: bindings) {
                    built.append(one)
                }
            }
            return built
        }

        var built: [String: [BuiltNode]] = [:]
        for member in cases.keys.sorted() {
            guard members.contains(member) else { throw violation("declared member", member) }
            let nodes = cases[member]!
            if nodes.isEmpty { throw violation("case branch", "empty") }
            built[member] = try branch(nodes, "cases[\(member)]")
        }
        if spec.hasFallback, spec.fallback?.isEmpty ?? true {
            throw violation("default branch", "empty")
        }
        if !spec.hasFallback {
            // Exhaustive without one: every member is covered, so no
            // value of the subject can reach a branch that is not there.
            if let missing = members.sorted().first(where: { cases[$0] == nil }) {
                throw violation("every member or a default", missing)
            }
        }

        return BuiltNode(
            type: node.type, reference: reference, isPlaceholder: false, rawSubtree: nil,
            properties: [:], children: [], events: [:],
            choice: BuiltSwitch(
                subject: .typedExpression(source: source, expr: expr, expected: subjectType),
                cases: built,
                fallback: try spec.fallback.map { try branch($0, "default") }))
    }
}
