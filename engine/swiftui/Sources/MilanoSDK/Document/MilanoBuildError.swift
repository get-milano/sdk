import Foundation

/// The closed set of typed errors the gate can throw, per the document
/// model spec. Every error carries structured detail; the diagnostic
/// `message` is non-normative.
public enum MilanoBuildError: Error, Equatable, Sendable {
    /// Input is not well-formed JSON or violates envelope structure.
    case malformedDocument(detail: String)
    /// Declared major is outside the runtime's supported set.
    case unsupportedVersion(declared: String, supported: [Int])
    /// Vocabulary, typing, action encoding, event, id, or namespace rules
    /// violated; supplied context or initial-state values not matching
    /// declarations.
    case schemaViolation(rule: String, node: String?, expected: String?, found: String?)
    /// A type not declared in the vocabulary, under the *fail* policy.
    case unknownComponentType(node: String, unknownType: String)
    /// A resource limit exceeded at the gate.
    case limitExceeded(limit: String, value: Int, actual: Int)
}

extension MilanoBuildError {
    /// The error as comparable fields, used by the conformance driver.
    public var fields: [String: MilanoValue] {
        switch self {
        case .malformedDocument(let detail):
            return ["type": .string("MalformedDocument"), "detail": .string(detail)]
        case .unsupportedVersion(let declared, let supported):
            return [
                "type": .string("UnsupportedVersion"),
                "declared": .string(declared),
                "supported": .array(supported.map { .int(Int64($0)) })
            ]
        case .schemaViolation(let rule, let node, let expected, let found):
            var fields: [String: MilanoValue] = [
                "type": .string("SchemaViolation"), "rule": .string(rule)
            ]
            if let node { fields["node"] = .string(node) }
            if let expected { fields["expected"] = .string(expected) }
            if let found { fields["found"] = .string(found) }
            return fields
        case .unknownComponentType(let node, let unknownType):
            return [
                "type": .string("UnknownComponentType"),
                "node": .string(node),
                "unknownType": .string(unknownType)
            ]
        case .limitExceeded(let limit, let value, let actual):
            return [
                "type": .string("LimitExceeded"),
                "limit": .string(limit),
                "value": .int(Int64(value)),
                "actual": .int(Int64(actual))
            ]
        }
    }
}
