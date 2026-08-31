import Foundation

/// What a scoped scalar root (`event`, `result`, `failure`) means where an
/// expression appears: unavailable, or available with a declared type.
enum EventScope: Equatable, Sendable {
    case unavailable
    case payload(MilanoType)
}

struct ExprChecker {
    let state: [String: MilanoType]
    let context: [String: MilanoType]
    let eventScope: EventScope
    var resultScope: EventScope = .unavailable
    var failureScope: EventScope = .unavailable
    /// `$repeat` bindings in scope: the element and its index, by name.
    var bindings: [String: MilanoType] = [:]
    /// The document's declared major.minor: gates the features it may use.
    var contract: (major: Int, minor: Int) = (2, 1)
    /// The surface's declared host functions, by name (contract 2.1).
    var functions: [String: MilanoVocabulary.Function] = [:]
    /// Told of every host function a checked expression calls, for the gate.
    var onFunctionUse: ((String) -> Void)?

    /// A function or root from a later minor than the document declares.
    /// Internal rather than private: the lookup's rules live in their own
    /// file, which the checker's body-length limit is what forced.
    func gateFeature(_ name: String) throws {
        if !MilanoContractFeatures.has(name, major: contract.major, minor: contract.minor) {
            throw ExprFeatureError(feature: name, version: MilanoContractFeatures.version(of: name))
        }
    }

    /// Infers the static type. `nil` means the null literal: typeless until
    /// an expected type or an operator gives it one. The expected type
    /// propagates into `if` branches and `??` sides, so string literals in
    /// enum positions refine to the enum (membership checked here).
    func infer(_ expr: Expr, expecting: MilanoType? = nil) throws -> MilanoType? {
        switch expr {
        case .nullLiteral: return nil
        case .boolLiteral: return MilanoType(.bool)
        case .intLiteral: return MilanoType(.int)
        case .doubleLiteral: return MilanoType(.double)
        case .stringLiteral(let value):
            if case .enumeration(let members)? = expecting?.kind {
                guard members.contains(value) else {
                    throw ExprError(detail: "'\(value)' is not a member of the declared enum")
                }
                return MilanoType(.enumeration(members))
            }
            return MilanoType(.string)

        case .root(let name):
            return try rootType(name)

        case .lookup(let base, let key):
            return try lookupType(base, key)

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
            return try inferCall(name, arguments, expecting: expecting)

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
            return try inferBinary(op, left, right, expecting: expecting)
        }
    }

    /// The scoped roots: available only where their scope binds.
    private func rootType(_ name: String) throws -> MilanoType {
        if let bound = bindings[name] { return bound }
        switch name {
        case "event":
            guard case .payload(let type) = eventScope else {
                throw ExprError(detail: "event is not available here")
            }
            return type
        case "result":
            guard case .payload(let type) = resultScope else {
                throw ExprError(detail: "result is not available here")
            }
            return type
        case "failure":
            try gateFeature(name)
            guard case .payload(let type) = failureScope else {
                throw ExprError(detail: "failure is not available here")
            }
            return type
        default:
            throw ExprError(detail: "unknown reference '\(name)'")
        }
    }

    /// Whether `actual` is accepted where `expected` is declared:
    /// same kind (member-set equality for enums), T where T? is expected,
    /// int where double is expected, an enum where string is expected
    /// (widening), and the null literal where any optional is expected.
    func accepts(_ expected: MilanoType, actual: MilanoType?) -> Bool {
        guard let actual else { return expected.optional }
        if actual.optional, !expected.optional { return false }
        if actual.kind == expected.kind { return true }
        if case .int = actual.kind, case .double = expected.kind { return true }
        if case .enumeration = actual.kind, case .string = expected.kind { return true }
        return false
    }

    /// The contract 2.1 string functions, in their own member: the
    /// built-in switch is long enough without them, and they share
    /// nothing with the rest but the argument accessors.
    private func inferStringCall(
        _ builtin: String, _ name: String, _ arguments: [Expr]
    ) throws -> MilanoType? {
        func argument(_ index: Int) throws -> MilanoType? {
            try infer(arguments[index])
        }
        func requireCount(_ expected: Int) throws {
            guard arguments.count == expected else {
                throw ExprError(detail: "\(name) takes \(expected) arguments")
            }
        }
        func requireNonOptional(_ type: MilanoType?, _ what: String) throws -> MilanoType {
            guard let type, !type.optional else {
                throw ExprError(detail: "\(name) needs a non-optional \(what)")
            }
            return type
        }
        switch builtin {
        case "substring":
            try requireCount(3)
            guard isStringLike(try requireNonOptional(try argument(0), "string").kind) else {
                throw ExprError(detail: "substring needs a string")
            }
            for index in 1...2 {
                guard case .int = try requireNonOptional(try argument(index), "int").kind else {
                    throw ExprError(detail: "substring needs int indices")
                }
            }
            return MilanoType(.string)
        case "indexOf":
            try requireCount(2)
            guard isStringLike(try requireNonOptional(try argument(0), "string").kind),
                isStringLike(try requireNonOptional(try argument(1), "string").kind)
            else {
                throw ExprError(detail: "indexOf needs strings")
            }
            return MilanoType(.int)
        case "replace":
            try requireCount(3)
            for index in 0...2 {
                guard isStringLike(try requireNonOptional(try argument(index), "string").kind) else {
                    throw ExprError(detail: "replace needs strings")
                }
            }
            return MilanoType(.string)
        case "split":
            try requireCount(2)
            guard isStringLike(try requireNonOptional(try argument(0), "string").kind),
                isStringLike(try requireNonOptional(try argument(1), "string").kind)
            else {
                throw ExprError(detail: "split needs strings")
            }
            return MilanoType(.array(MilanoType(.string)))
        case "join":
            try requireCount(2)
            // The element type is what matters: an array of enum joins by
            // member string, since an enum widens to string everywhere.
            let subject = try requireNonOptional(try argument(0), "array of string")
            guard case .array(let element) = subject.kind,
                !element.optional, isStringLike(element.kind)
            else {
                throw ExprError(detail: "join needs an array of string")
            }
            guard isStringLike(try requireNonOptional(try argument(1), "string").kind) else {
                throw ExprError(detail: "join needs a string separator")
            }
            return MilanoType(.string)
        default:
            throw ExprError(detail: "unknown built-in function '\(name)'")
        }
    }

    private func inferCall(
        _ name: String, _ arguments: [Expr], expecting: MilanoType? = nil
    ) throws -> MilanoType? {
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

        // A bare name is a host function the surface declares; the
        // contract's own functions are called through `$` and cannot be
        // shadowed (expression spec, Host functions).
        guard name.hasPrefix("$") else { return try inferHostCall(name, arguments) }
        // Every built-in a later minor introduced is gated here, once.
        try gateFeature(name)

        // A const, so the cases below can test it directly.
        let builtin = String(name.dropFirst())
        if let numeric = try inferNumericCall(builtin, name, arguments) { return numeric }

        switch builtin {
        case "str":
            try requireCount(1)
            let type = try requireNonOptional(try argument(0), "scalar")
            switch type.kind {
            case .bool, .int, .double, .string, .enumeration: return MilanoType(.string)
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
                guard isStringLike(try requireNonOptional(try argument(index), "string").kind) else {
                    throw ExprError(detail: "concat needs strings")
                }
            }
            return MilanoType(.string)
        case "length", "isEmpty":
            try requireCount(1)
            let type = try requireNonOptional(try argument(0), "string or array")
            switch type.kind {
            case .string, .enumeration, .array:
                return MilanoType(builtin == "length" ? .int : .bool)
            default:
                throw ExprError(detail: "\(name) needs a string or array")
            }
        case "contains", "startsWith", "endsWith":
            try requireCount(2)
            guard isStringLike(try requireNonOptional(try argument(0), "string").kind),
                isStringLike(try requireNonOptional(try argument(1), "string").kind)
            else {
                throw ExprError(detail: "\(name) needs strings")
            }
            return MilanoType(.bool)
        case "trim":
            try requireCount(1)
            guard isStringLike(try requireNonOptional(try argument(0), "string").kind) else {
                throw ExprError(detail: "trim needs a string")
            }
            return MilanoType(.string)
        case "substring", "indexOf", "replace", "split", "join":
            return try inferStringCall(builtin, name, arguments)
        case "if":
            try requireCount(3)
            return try inferConditional(arguments, expecting: expecting)
        default:
            throw ExprError(detail: "unknown built-in function '\(name)'")
        }
    }

    /// A host function (expression spec, Host functions): exactly the
    /// declared arity, each argument a declared position, the call typed
    /// as the declared return. A bare name nothing declares is unknown,
    /// whatever the `$` namespace holds; under an earlier contract the
    /// call is the contract-feature violation named after it.
    private func inferHostCall(_ name: String, _ arguments: [Expr]) throws -> MilanoType {
        guard let declared = functions[name] else {
            throw ExprError(detail: "unknown function '\(name)'")
        }
        if !MilanoContractFeatures.has("functions", major: contract.major, minor: contract.minor) {
            throw ExprFeatureError(feature: name, version: MilanoContractFeatures.version(of: "functions"))
        }
        guard arguments.count == declared.arguments.count else {
            throw ExprError(detail: "\(name) takes \(declared.arguments.count) argument(s)")
        }
        for (index, argumentType) in declared.arguments.enumerated() {
            let inferred = try infer(arguments[index], expecting: argumentType)
            guard accepts(argumentType, actual: inferred) else {
                throw ExprError(detail: "\(name) argument \(index) must be \(MilanoGate.name(of: argumentType))")
            }
        }
        onFunctionUse?(name)
        return declared.returns
    }

    /// `if(c, a, b)`: both branches type-check to the same T, and T may
    /// itself be optional: a single null branch makes the result optional.
    private func inferConditional(_ arguments: [Expr], expecting: MilanoType?) throws -> MilanoType? {
        guard let condition = try infer(arguments[0]), !condition.optional, condition.kind == .bool else {
            throw ExprError(detail: "if needs a bool condition")
        }
        let thenType = try infer(arguments[1], expecting: expecting)
        let elseType = try infer(arguments[2], expecting: expecting)
        switch (thenType, elseType) {
        case (nil, nil):
            throw ExprError(detail: "if branches cannot both be null")
        case (nil, .some(let type)), (.some(let type), nil):
            return MilanoType(type.kind, optional: true)
        case (.some(let a), .some(let b)):
            guard a == b else { throw ExprError(detail: "if branches must have the same type") }
            return a
        }
    }

    /// The numeric functions contract 2.1 added, by their stripped name;
    /// nil when `builtin` is none of them. `$abs` keeps its numeric type;
    /// `$min` and `$max` take two or more numbers and promote like the
    /// arithmetic operators; the rounding functions take exactly a double,
    /// like `$int()` and `$double()`.
    private func inferNumericCall(
        _ builtin: String, _ name: String, _ arguments: [Expr]
    ) throws -> MilanoType? {
        func number(_ index: Int) throws -> MilanoType {
            guard let type = try infer(arguments[index]), !type.optional, isNumeric(type.kind) else {
                throw ExprError(detail: "\(name) needs a number")
            }
            return type
        }
        switch builtin {
        case "abs":
            guard arguments.count == 1 else { throw ExprError(detail: "\(name) takes 1 argument(s)") }
            return try number(0)
        case "min", "max":
            guard arguments.count >= 2 else { throw ExprError(detail: "\(name) takes 2 or more arguments") }
            var anyDouble = false
            for index in arguments.indices where try number(index).kind == .double { anyDouble = true }
            return MilanoType(anyDouble ? .double : .int)
        case "floor", "ceil", "round":
            guard arguments.count == 1, try number(0).kind == .double else {
                throw ExprError(detail: "\(name) needs a double")
            }
            return MilanoType(.double)
        default:
            return nil
        }
    }

    private func inferBinary(
        _ op: BinaryOp, _ left: Expr, _ right: Expr, expecting: MilanoType? = nil
    ) throws -> MilanoType? {
        switch op {
        case .coalesce:
            let leftType = try infer(left, expecting: expecting)
            let rightType = try infer(right, expecting: expecting)
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
            try checkEnumComparison(l, r, left: left, right: right)
            guard l.kind == r.kind || isNumericPair(l.kind, r.kind)
                || isEnumStringPair(l.kind, r.kind)
            else {
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
            if let l, let r, !l.optional, !r.optional,
                isStringLike(l.kind), isStringLike(r.kind) {
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

    /// Enum comparison rules: a string-literal operand must be a member;
    /// two enums must be the same enum; a non-literal string compares as a
    /// string (the enum widens).
    private func checkEnumComparison(
        _ l: MilanoType, _ r: MilanoType, left: Expr, right: Expr
    ) throws {
        guard case .enumeration(let members) = l.kind else {
            if case .enumeration = r.kind {
                try checkEnumComparison(r, l, left: right, right: left)
            }
            return
        }
        if case .enumeration = r.kind {
            guard l.kind == r.kind else {
                throw ExprError(detail: "distinct enum types are not comparable")
            }
            return
        }
        if case .stringLiteral(let value) = right, !members.contains(value) {
            throw ExprError(detail: "'\(value)' is not a member of the declared enum")
        }
    }

    private func isEnumStringPair(_ a: MilanoType.Kind, _ b: MilanoType.Kind) -> Bool {
        if case .enumeration = a, case .string = b { return true }
        if case .string = a, case .enumeration = b { return true }
        return false
    }

    private func isNumeric(_ kind: MilanoType.Kind) -> Bool {
        kind == .int || kind == .double
    }
    private func isNumericPair(_ a: MilanoType.Kind, _ b: MilanoType.Kind) -> Bool {
        isNumeric(a) && isNumeric(b)
    }
    private func isScalar(_ kind: MilanoType.Kind) -> Bool {
        switch kind {
        case .bool, .int, .double, .string, .enumeration: return true
        case .array, .record: return false
        }
    }

    private func isStringLike(_ kind: MilanoType.Kind) -> Bool {
        switch kind {
        case .string, .enumeration: return true
        default: return false
        }
    }
}
