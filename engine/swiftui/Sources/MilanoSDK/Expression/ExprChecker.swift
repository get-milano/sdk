import Foundation

/// What the `event` root means where an expression appears: unavailable
/// (property expressions), or available with a payload type.
enum EventScope: Equatable, Sendable {
    case unavailable
    case payload(MilanoType)
}

struct ExprChecker {
    let state: [String: MilanoType]
    let context: [String: MilanoType]
    let eventScope: EventScope

    /// Infers the static type. `nil` means the null literal: typeless until
    /// an expected type or an operator gives it one.
    func infer(_ expr: Expr) throws -> MilanoType? {
        switch expr {
        case .nullLiteral: return nil
        case .boolLiteral: return MilanoType(.bool)
        case .intLiteral: return MilanoType(.int)
        case .doubleLiteral: return MilanoType(.double)
        case .stringLiteral: return MilanoType(.string)

        case .root(let name):
            switch name {
            case "event":
                guard case .payload(let type) = eventScope else {
                    throw ExprError(detail: "event is not available here")
                }
                return type
            default:
                throw ExprError(detail: "unknown reference '\(name)'")
            }

        case .member(let base, let field):
            // state.x and context.x resolve against declarations.
            if case .root(let rootName) = base, rootName == "state" || rootName == "context" {
                let declarations = rootName == "state" ? state : context
                guard let type = declarations[field] else {
                    throw ExprError(detail: "unknown \(rootName) key '\(field)'")
                }
                return type
            }
            let baseType = try infer(base)
            guard let baseType, case .record(let fields) = baseType.kind else {
                throw ExprError(detail: "field access on a non-record")
            }
            guard !baseType.optional else {
                throw ExprError(detail: "field access on an optional record; resolve with ?? first")
            }
            guard let fieldType = fields[field] else {
                throw ExprError(detail: "unknown field '\(field)'")
            }
            return fieldType

        case .call(let name, let arguments):
            return try inferCall(name, arguments)

        case .unary(let op, let operand):
            guard let type = try infer(operand), !type.optional else {
                throw ExprError(detail: "unary operator on null or optional")
            }
            switch op {
            case .not:
                guard type.kind == .bool else { throw ExprError(detail: "! needs bool") }
                return type
            case .negate:
                guard type.kind == .int || type.kind == .double else {
                    throw ExprError(detail: "unary - needs a number")
                }
                return type
            }

        case .binary(let op, let left, let right):
            return try inferBinary(op, left, right)
        }
    }

    /// Whether `actual` is accepted where `expected` is declared:
    /// same kind, T where T? is expected, int where double is expected,
    /// and the null literal where any optional is expected.
    func accepts(_ expected: MilanoType, actual: MilanoType?) -> Bool {
        guard let actual else { return expected.optional }
        if actual.optional, !expected.optional { return false }
        if actual.kind == expected.kind { return true }
        if case .int = actual.kind, case .double = expected.kind { return true }
        return false
    }

    private func inferCall(_ name: String, _ arguments: [Expr]) throws -> MilanoType? {
        func argument(_ index: Int) throws -> MilanoType? {
            try infer(arguments[index])
        }
        func requireCount(_ count: Int) throws {
            guard arguments.count == count else {
                throw ExprError(detail: "\(name) takes \(count) argument(s)")
            }
        }
        func requireNonOptional(_ type: MilanoType?, _ what: String) throws -> MilanoType {
            guard let type, !type.optional else {
                throw ExprError(detail: "\(name) needs a non-optional \(what)")
            }
            return type
        }

        switch name {
        case "str":
            try requireCount(1)
            let type = try requireNonOptional(try argument(0), "scalar")
            switch type.kind {
            case .bool, .int, .double, .string: return MilanoType(.string)
            default: throw ExprError(detail: "str needs a scalar")
            }
        case "int":
            try requireCount(1)
            guard try requireNonOptional(try argument(0), "double").kind == .double else {
                throw ExprError(detail: "int needs a double")
            }
            return MilanoType(.int)
        case "double":
            try requireCount(1)
            guard try requireNonOptional(try argument(0), "int").kind == .int else {
                throw ExprError(detail: "double needs an int")
            }
            return MilanoType(.double)
        case "concat":
            guard arguments.count >= 2 else { throw ExprError(detail: "concat takes 2 or more arguments") }
            for index in arguments.indices {
                guard try requireNonOptional(try argument(index), "string").kind == .string else {
                    throw ExprError(detail: "concat needs strings")
                }
            }
            return MilanoType(.string)
        case "length", "isEmpty":
            try requireCount(1)
            let type = try requireNonOptional(try argument(0), "string or array")
            switch type.kind {
            case .string, .array:
                return MilanoType(name == "length" ? .int : .bool)
            default:
                throw ExprError(detail: "\(name) needs a string or array")
            }
        case "contains", "startsWith", "endsWith":
            try requireCount(2)
            guard try requireNonOptional(try argument(0), "string").kind == .string,
                try requireNonOptional(try argument(1), "string").kind == .string
            else {
                throw ExprError(detail: "\(name) needs strings")
            }
            return MilanoType(.bool)
        case "trim":
            try requireCount(1)
            guard try requireNonOptional(try argument(0), "string").kind == .string else {
                throw ExprError(detail: "trim needs a string")
            }
            return MilanoType(.string)
        case "if":
            try requireCount(3)
            guard try requireNonOptional(try argument(0), "bool").kind == .bool else {
                throw ExprError(detail: "if needs a bool condition")
            }
            let thenType = try argument(1)
            let elseType = try argument(2)
            switch (thenType, elseType) {
            case (nil, nil):
                throw ExprError(detail: "if branches cannot both be null")
            case (nil, .some(let type)), (.some(let type), nil):
                return MilanoType(type.kind, optional: true)
            case (.some(let a), .some(let b)):
                guard a == b else { throw ExprError(detail: "if branches must have the same type") }
                return a
            }
        default:
            throw ExprError(detail: "unknown function '\(name)'")
        }
    }

    private func inferBinary(_ op: BinaryOp, _ left: Expr, _ right: Expr) throws -> MilanoType? {
        switch op {
        case .coalesce:
            let leftType = try infer(left)
            let rightType = try infer(right)
            guard let rightType, !rightType.optional else {
                throw ExprError(detail: "?? right side must be non-optional")
            }
            guard let leftType else { return rightType }  // null ?? x
            guard leftType.optional, leftType.kind == rightType.kind else {
                throw ExprError(detail: "?? needs optional T and T of the same kind")
            }
            return rightType

        case .and, .or:
            guard let l = try infer(left), let r = try infer(right),
                !l.optional, !r.optional, l.kind == .bool, r.kind == .bool
            else {
                throw ExprError(detail: "logical operators need bool")
            }
            return MilanoType(.bool)

        case .equal, .notEqual:
            let leftType = try infer(left)
            let rightType = try infer(right)
            // Optionals comparable to null.
            if leftType == nil || rightType == nil {
                let other = leftType ?? rightType
                guard other == nil ? false : other!.optional else {
                    throw ExprError(detail: "only optionals compare to null")
                }
                return MilanoType(.bool)
            }
            guard let l = leftType, let r = rightType else {
                throw ExprError(detail: "invalid equality")
            }
            guard isScalar(l.kind), isScalar(r.kind) else {
                throw ExprError(detail: "arrays and records are not comparable")
            }
            guard l.kind == r.kind || isNumericPair(l.kind, r.kind) else {
                throw ExprError(detail: "equality needs matching scalar types")
            }
            guard !l.optional, !r.optional else {
                throw ExprError(detail: "resolve optionals with ?? before comparing values")
            }
            return MilanoType(.bool)

        case .less, .lessEqual, .greater, .greaterEqual:
            guard let l = try infer(left), let r = try infer(right),
                !l.optional, !r.optional, isNumeric(l.kind), isNumeric(r.kind)
            else {
                throw ExprError(detail: "ordering needs numbers")
            }
            return MilanoType(.bool)

        case .add:
            let l = try infer(left)
            let r = try infer(right)
            if let l, let r, !l.optional, !r.optional, l.kind == .string, r.kind == .string {
                return MilanoType(.string)
            }
            fallthrough
        case .subtract, .multiply, .divide, .modulo:
            guard let l = try infer(left), let r = try infer(right),
                !l.optional, !r.optional, isNumeric(l.kind), isNumeric(r.kind)
            else {
                throw ExprError(detail: "arithmetic needs numbers")
            }
            return (l.kind == .double || r.kind == .double)
                ? MilanoType(.double) : MilanoType(.int)
        }
    }

    private func isNumeric(_ kind: MilanoType.Kind) -> Bool {
        kind == .int || kind == .double
    }
    private func isNumericPair(_ a: MilanoType.Kind, _ b: MilanoType.Kind) -> Bool {
        isNumeric(a) && isNumeric(b)
    }
    private func isScalar(_ kind: MilanoType.Kind) -> Bool {
        switch kind {
        case .bool, .int, .double, .string: return true
        case .array, .record: return false
        }
    }
}
