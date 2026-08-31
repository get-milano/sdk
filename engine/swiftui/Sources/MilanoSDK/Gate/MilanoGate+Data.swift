import Foundation

// MARK: - Data checks: supplied context and provided state

extension MilanoGate {
    /// Step 5, data half: validates supplied context values against the
    /// document's declarations. Returns the canonicalized context.
    func validateContext(
        _ document: ParsedDocument, supplied: [String: MilanoValue]
    ) throws -> [String: MilanoValue] {
        try Self.validateContext(document, supplied: supplied, limits: engine.limits)
    }

    /// Step 5, state half: validates provider values against declarations.
    func validateState(
        _ document: ParsedDocument, provided: [String: MilanoValue]
    ) throws -> [String: MilanoValue] {
        try Self.validateState(document, provided: provided, limits: engine.limits)
    }

    /// The context check, as a replacement's swap also applies it to the
    /// values the view holds (state and actions spec, Document
    /// replacement).
    static func validateContext(
        _ document: ParsedDocument, supplied: [String: MilanoValue], limits: MilanoLimits
    ) throws -> [String: MilanoValue] {
        var canonical: [String: MilanoValue] = [:]
        for (key, type) in document.contextDeclarations.byKey {
            guard let value = supplied[key] else {
                throw MilanoBuildError.schemaViolation(
                    rule: "context-declaration", node: nil, expected: key, found: nil)
            }
            guard let validated = type.validated(value) else {
                let detail = mismatch(type, value)
                throw MilanoBuildError.schemaViolation(
                    rule: "context-declaration", node: nil,
                    expected: detail.expected, found: detail.found)
            }
            try checkValueSize(validated, limits: limits)
            canonical[key] = validated
        }
        // Extra supplied keys are ignored: the document reads only what it declares.
        return canonical
    }

    /// The state check, as a replacement's swap also applies it to the
    /// merged values of carried-over and provided keys.
    static func validateState(
        _ document: ParsedDocument, provided: [String: MilanoValue], limits: MilanoLimits
    ) throws -> [String: MilanoValue] {
        var canonical: [String: MilanoValue] = [:]
        for (key, type) in document.stateDeclarations.byKey {
            let value = provided[key] ?? .null
            guard let validated = type.validated(value) else {
                let detail = mismatch(type, value)
                throw MilanoBuildError.schemaViolation(
                    rule: "state-declaration", node: nil,
                    expected: detail.expected, found: detail.found)
            }
            try checkValueSize(validated, limits: limits)
            canonical[key] = validated
        }
        return canonical
    }

    /// A value entering state or context fits the value size limit.
    private static func checkValueSize(_ value: MilanoValue, limits: MilanoLimits) throws {
        let size = value.size
        if size > limits.maxValueSize {
            throw MilanoBuildError.limitExceeded(
                limit: "maxValueSize", value: limits.maxValueSize, actual: size)
        }
    }
}
