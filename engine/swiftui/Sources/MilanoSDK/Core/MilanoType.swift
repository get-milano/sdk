import Foundation

/// A type from the document type system: bool, int, double, string,
/// enum over named members, array of T, or record with named typed fields;
/// each optionally optional.
public struct MilanoType: Equatable, Sendable {
    public indirect enum Kind: Equatable, Sendable {
        case bool
        case int
        case double
        case string
        /// A closed set of member strings; two enum types are the same
        /// exactly when their member sets are equal (structural identity).
        case enumeration(Set<String>)
        case array(MilanoType)
        case record([String: MilanoType])
    }

    public let kind: Kind
    public let optional: Bool
    /// An enum's members in declaration order: what fixes the zero
    /// value's member (expression language spec, Host functions). Every
    /// path that has an order keeps it, whether the type came from a
    /// descriptor or from `enumeration(_:optional:)`. Never part of the
    /// type's identity: two enum types are equal by member set, so this
    /// is carried beside the set rather than in it.
    ///
    /// It is nil only for a type built through `init(_:optional:)` with a
    /// `Set` payload, which has no order to keep; such a type orders its
    /// members alphabetically, deterministically but arbitrarily. Prefer
    /// `enumeration(_:optional:)`, which cannot lose the order.
    let declaredMembers: [String]?

    public init(_ kind: Kind, optional: Bool = false) {
        self.init(kind, optional: optional, declaredMembers: nil)
    }

    /// An enum type from its members in declaration order. This is the
    /// constructor to reach for: a `Set` literal has already lost the
    /// order by the time an initializer sees it, and the order is what
    /// the zero value reads.
    public static func enumeration(_ members: [String], optional: Bool = false) -> MilanoType {
        MilanoType(.enumeration(Set(members)), optional: optional, declaredMembers: members)
    }

    init(_ kind: Kind, optional: Bool, declaredMembers: [String]?) {
        self.kind = kind
        self.optional = optional
        self.declaredMembers = declaredMembers
    }

    public static func == (lhs: MilanoType, rhs: MilanoType) -> Bool {
        lhs.kind == rhs.kind && lhs.optional == rhs.optional
    }
}

// MARK: - Descriptor parsing

extension MilanoType {
    /// Parses a JSON type descriptor:
    /// - a primitive name string, with a trailing `?` for optional (`"int"`, `"string?"`)
    /// - `{"enum": [<member>...], "optional": <bool>}`
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
            if case .array(let memberList)? = object["enum"] {
                // Unknown keys are ignored: the tolerance rule (Foundations)
                // lets a descriptor grow in a minor contract version.
                guard !memberList.isEmpty else { return nil }
                var members: Set<String> = []
                var ordered: [String] = []
                for entry in memberList {
                    guard case .string(let member) = entry,
                        MilanoIdentifier.isValid(member),
                        members.insert(member).inserted
                    else { return nil }
                    ordered.append(member)
                }
                self.init(.enumeration(members), optional: optional, declaredMembers: ordered)
            } else if let element = object["array"] {
                guard let elementType = MilanoType(descriptor: element) else { return nil }
                self.init(.array(elementType), optional: optional)
            } else if case .record(let fields)? = object["record"] {
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
        case (.enumeration(let members), .string(let member)):
            return members.contains(member) ? value : nil
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

// MARK: - Zero values

extension MilanoType {
    /// The zero value of the type (expression language spec, Host
    /// functions): what an invalid function result evaluates to, so
    /// evaluation stays total. Optionals are null; an enum is its first
    /// declared member; a record has every field at its zero.
    var zeroValue: MilanoValue {
        if optional { return .null }
        switch kind {
        case .bool: return .bool(false)
        case .int: return .int(0)
        case .double: return .double(0)
        case .string: return .string("")
        case .enumeration(let members):
            return .string(declaredMembers?.first ?? members.sorted().first ?? "")
        case .array: return .array([])
        case .record(let fields): return .record(fields.mapValues(\.zeroValue))
        }
    }
}
