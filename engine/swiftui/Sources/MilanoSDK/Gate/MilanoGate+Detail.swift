import Foundation

// MARK: - Names for error details

extension MilanoGate {
    /// The detail a value mismatch carries (document model spec, rule
    /// tables): the declared type against the value's kind, except a
    /// string that is not a member of a declared enum, where naming the
    /// type would say "enum" and hide which string was rejected.
    static func mismatch(
        _ type: MilanoType, _ value: MilanoValue
    ) -> (expected: String, found: String) {
        if case .enumeration = type.kind, case .string(let text) = value {
            return ("enum member", text)
        }
        return (name(of: type), name(of: value))
    }

    static func name(of type: MilanoType) -> String {
        let base: String
        switch type.kind {
        case .bool: base = "bool"
        case .int: base = "int"
        case .double: base = "double"
        case .string: base = "string"
        case .enumeration: base = "enum"
        case .array: base = "array"
        case .record: base = "record"
        }
        return type.optional ? "\(base)?" : base
    }

    static func name(of value: MilanoValue) -> String {
        switch value {
        case .null: return "null"
        case .bool: return "bool"
        case .int: return "int"
        case .double: return "double"
        case .string: return "string"
        case .array: return "array"
        case .record: return "record"
        }
    }
}
