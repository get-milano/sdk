import Foundation

/// The single representation for every value crossing a Milano boundary:
/// resolved properties into renderers, event payloads out of them, action
/// parameters into handlers, context and state values in from the host.
///
/// Mirrors the document type system exactly: bool, int (64-bit), double
/// (IEEE 754 binary64), string, array, record, null.
public enum MilanoValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([MilanoValue])
    case record([String: MilanoValue])
}

// MARK: - Typed accessors

extension MilanoValue {
    public var isNull: Bool { self == .null }

    public var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }

    public var intValue: Int64? {
        if case .int(let v) = self { return v }
        return nil
    }

    public var doubleValue: Double? {
        if case .double(let v) = self { return v }
        return nil
    }

    public var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }

    public var arrayValue: [MilanoValue]? {
        if case .array(let v) = self { return v }
        return nil
    }

    public var recordValue: [String: MilanoValue]? {
        if case .record(let v) = self { return v }
        return nil
    }
}

// MARK: - JSON bridging

extension MilanoValue {
    /// Builds a value from a `JSONSerialization` object graph.
    ///
    /// JSON numbers written without a fractional part become `int`; numbers
    /// written with one become `double`. This distinction is what makes
    /// "a JSON number with a fractional part never satisfies an int
    /// declaration" checkable.
    public init?(json: Any) {
        switch json {
        case is NSNull:
            self = .null
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else {
                switch String(cString: number.objCType) {
                case "d", "f":
                    self = .double(number.doubleValue)
                default:
                    self = .int(number.int64Value)
                }
            }
        case let string as String:
            self = .string(string)
        case let array as [Any]:
            var values: [MilanoValue] = []
            values.reserveCapacity(array.count)
            for element in array {
                guard let value = MilanoValue(json: element) else { return nil }
                values.append(value)
            }
            self = .array(values)
        case let object as [String: Any]:
            var values: [String: MilanoValue] = [:]
            values.reserveCapacity(object.count)
            for (key, element) in object {
                guard let value = MilanoValue(json: element) else { return nil }
                values[key] = value
            }
            self = .record(values)
        default:
            return nil
        }
    }
}
