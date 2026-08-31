import Foundation

// MARK: - Array actions (contract 2.1)

extension MilanoGate {
    /// Each array action's parameters, in the lexicographic order the walk
    /// visits them.
    private static let arrayActionKeys: [String: [String]] = [
        "$append": ["key", "value"],
        "$remove": ["at", "key"],
        "$update": ["at", "field", "key", "value"]
    ]

    /// An array action's encoding (document model spec, Actions): the
    /// target a declared, non-optional array key (records for `$update`),
    /// no undeclared parameter, every parameter present, `at` an int,
    /// `field` a declared field, `value` typed as the element or the
    /// field; each rule an `action-encoding` violation, in the order the
    /// spec fixes. A document declaring 2.0 may not carry one at all.
    func validateArrayAction(
        _ action: ArrayActionSpec, in document: ParsedDocument, node: String?,
        eventScope: EventScope, resultScope: EventScope,
        bindings: [String: MilanoType], failureScope: EventScope
    ) throws -> ActionSpec {
        try requireFeature(action.name, in: document, node: node)
        func violation(_ expected: String?, _ found: String?) -> MilanoBuildError {
            .schemaViolation(rule: "action-encoding", node: node, expected: expected, found: found)
        }
        guard let key = action.key, let declared = document.stateDeclarations[key] else {
            throw violation("declared state key", action.key)
        }
        guard case .array(let element) = declared.kind, !declared.optional else {
            throw violation("array state key", key)
        }
        var fields: [String: MilanoType] = [:]
        if action.name == "$update" {
            guard case .record(let declaredFields) = element.kind, !element.optional else {
                throw violation("record element", key)
            }
            fields = declaredFields
        }
        if let extra = action.extra.first { throw violation("declared parameter", extra) }
        for parameter in Self.arrayActionKeys[action.name] ?? [] {
            let present: Bool
            switch parameter {
            case "at": present = action.at != nil
            case "field": present = action.field != nil || action.fieldFound != nil
            case "value": present = action.value != nil
            default: present = true
            }
            guard present else { throw violation(parameter, nil) }
        }
        func check(_ value: DocValue, _ type: MilanoType) throws -> DocValue {
            try checked(
                value, against: type, rule: "action-encoding", node: node, in: document,
                eventScope: eventScope, resultScope: resultScope, bindings: bindings,
                failureScope: failureScope)
        }
        let at = try action.at.map { try check($0, MilanoType(.int)) }
        switch action.name {
        case "$update":
            guard let field = action.field, let fieldType = fields[field] else {
                throw violation("declared field", action.field ?? action.fieldFound)
            }
            guard let at, let value = action.value else { throw violation("value", nil) }
            return .update(key: key, at: at, field: field, value: try check(value, fieldType))
        case "$remove":
            guard let at else { throw violation("at", nil) }
            return .remove(key: key, at: at)
        default:
            guard let value = action.value else { throw violation("value", nil) }
            return .append(key: key, value: try check(value, element))
        }
    }
}
