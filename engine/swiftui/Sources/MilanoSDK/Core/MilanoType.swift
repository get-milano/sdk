import Foundation

/// A type from the document type system: bool, int, double, string,
/// array of T, or record with named typed fields; each optionally optional.
public struct MilanoType: Equatable, Sendable {
    public indirect enum Kind: Equatable, Sendable {
        case bool
        case int
        case double
        case string
        case array(MilanoType)
        case record([String: MilanoType])
    }

    public let kind: Kind
    public let optional: Bool

    public init(_ kind: Kind, optional: Bool = false) {
        self.kind = kind
        self.optional = optional
    }
}

// MARK: - Descriptor parsing

extension MilanoType {
    /// Parses a JSON type descriptor:
    /// - a primitive name string, with a trailing `?` for optional (`"int"`, `"string?"`)
    /// - `{"array": <descriptor>, "optional": <bool>}`
    /// - `{"record": {<field>: <descriptor>}, "optional": <bool>}`
    init?(descriptor: MilanoValue) {
        switch descriptor {
        case .string(var name):
            var optional = false
            if name.hasSuffix("?") {
                optional = true
                name.removeLast()
            }
            switch name {
            case "bool": self.init(.bool, optional: optional)
            case "int": self.init(.int, optional: optional)
            case "double": self.init(.double, optional: optional)
            case "string": self.init(.string, optional: optional)
            default: return nil
            }
        case .record(let object):
            let optional: Bool
            switch object["optional"] {
            case nil: optional = false
            case .bool(let flag): optional = flag
            default: return nil
            }
            if let element = object["array"] {
                guard object.keys.allSatisfy({ $0 == "array" || $0 == "optional" }),
                    let elementType = MilanoType(descriptor: element)
                else {
                    return nil
                }
                self.init(.array(elementType), optional: optional)
            } else if case .record(let fields)? = object["record"] {
                guard object.keys.allSatisfy({ $0 == "record" || $0 == "optional" }) else { return nil }
                var fieldTypes: [String: MilanoType] = [:]
                for (name, fieldDescriptor) in fields {
                    guard MilanoIdentifier.isValid(name),
                        let fieldType = MilanoType(descriptor: fieldDescriptor)
                    else { return nil }
                    fieldTypes[name] = fieldType
                }
                self.init(.record(fieldTypes), optional: optional)
            } else {
                return nil
            }
        default:
            return nil
        }
    }
}

// MARK: - Value validation

extension MilanoType {
    /// Validates a value against this type and returns its canonical form,
    /// or `nil` on mismatch.
    ///
    /// Rules, identical in both runtimes:
    /// - `null` is valid only for optional types.
    /// - A non-optional value is accepted where the optional of its type is expected.
    /// - An `int` value is accepted where `double` is declared and is canonicalized
    ///   to `double` (mirroring expression promotion). A `double` value never
    ///   satisfies an `int` declaration.
    /// - Records must match their declared shape exactly: missing non-optional
    ///   fields and undeclared fields are mismatches. Missing optional fields
    ///   canonicalize to `null`.
    func validated(_ value: MilanoValue) -> MilanoValue? {
        if value == .null {
            return optional ? MilanoValue.null : nil
        }
        switch (kind, value) {
        case (.bool, .bool):
            return value
        case (.int, .int):
            return value
        case (.double, .double):
            return value
        case (.double, .int(let i)):
            return .double(Double(i))
        case (.string, .string):
            return value
        case (.array(let elementType), .array(let elements)):
            var canonical: [MilanoValue] = []
            canonical.reserveCapacity(elements.count)
            for element in elements {
                guard let validated = elementType.validated(element) else { return nil }
                canonical.append(validated)
            }
            return .array(canonical)
        case (.record(let fields), .record(let entries)):
            for key in entries.keys where fields[key] == nil {
                return nil  // undeclared field
            }
            var canonical: [String: MilanoValue] = [:]
            for (name, fieldType) in fields {
                let fieldValue = entries[name] ?? .null
                guard let validated = fieldType.validated(fieldValue) else { return nil }
                canonical[name] = validated
            }
            return .record(canonical)
        default:
            return nil
        }
    }
}
