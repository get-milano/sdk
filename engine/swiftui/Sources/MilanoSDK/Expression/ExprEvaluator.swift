import Foundation

/// The detail an evaluation report may carry: an invalid function result
/// names the function, the declared return type, and what arrived.
struct ExprReportDetail: Sendable {
    let name: String
    let expected: String
    let found: String
}

/// What an evaluation needs to call host functions (contract 2.1): the
/// surface's declarations and the engine's handler (nil when none is
/// installed, which the gate rules out for any document that calls one).
struct EvalEnvironment: Sendable {
    let functions: [String: MilanoVocabulary.Function]
    let handler: (any MilanoFunctionHandler)?

    static let none = EvalEnvironment(functions: [:], handler: nil)
}

/// Total evaluation: after the gate, this cannot fail. Division by zero,
/// saturation, and invalid function results report occurrences through
/// `report` and return defined results, so evaluation always produces a
/// value.
struct ExprEvaluator {
    let state: [String: MilanoValue]
    let context: [String: MilanoValue]
    let event: MilanoValue?
    var result: MilanoValue?
    let node: String?
    let report: (MilanoOccurrence.Kind, ExprReportDetail?) -> Void
    /// `$repeat` bindings in scope: the element and its index, by name.
    var bindings: [String: MilanoValue] = [:]
    var failure: MilanoValue?
    /// The host functions the surface declares and the engine's handler.
    var env: EvalEnvironment = .none

    /// Bare roots: a `$repeat` binding, or `event`, `result`, and `failure`.
    /// `record[key]` (contract 2.1): an enum value is its member string,
    /// and the gate proved the record has a field of exactly that name.
    private func lookupValue(_ base: Expr, _ key: Expr) -> MilanoValue {
        guard case .record(let fields) = evaluate(base),
            case .string(let member) = evaluate(key)
        else { return .null }
        return fields[member] ?? .null
    }

    private func rootValue(_ name: String) -> MilanoValue {
        if let bound = bindings[name] { return bound }
        switch name {
        case "event": return event ?? .null
        case "result": return result ?? .null
        case "failure": return failure ?? .null
        default: return .null
        }
    }

    func evaluate(_ expr: Expr) -> MilanoValue {
        switch expr {
        case .nullLiteral: return .null
        case .boolLiteral(let v): return .bool(v)
        case .intLiteral(let v): return .int(v)
        case .doubleLiteral(let v): return .double(v)
        case .stringLiteral(let v): return .string(v)

        case .root(let name):
            return rootValue(name)

        case .lookup(let base, let key):
            return lookupValue(base, key)

        case .member(let base, let field):
            if case .root(let rootName) = base, rootName == "state" {
                return state[field] ?? .null
            }
            if case .root(let rootName) = base, rootName == "context" {
                return context[field] ?? .null
            }
            guard case .record(let fields) = evaluate(base) else { return .null }
            return fields[field] ?? .null

        case .call(let name, let arguments):
            if name == "$if" {
                // Lazy conditional: only the taken branch evaluates, like
                // && || and ??, so guards suppress the reports they guard.
                let taken = evaluate(arguments[0]).boolValue == true ? 1 : 2
                return evaluate(arguments[taken])
            }
            return call(name, arguments.map(evaluate))

        case .unary(let op, let operand):
            let value = evaluate(operand)
            switch op {
            case .not:
                return .bool(!(value.boolValue ?? false))
            case .negate:
                if case .int(let v) = value { return .int(0 &- v) }
                if case .double(let v) = value { return .double(-v) }
                return .null
            }

        case .binary(let op, let leftExpr, let rightExpr):
            switch op {
            case .and:
                // Short-circuit.
                guard evaluate(leftExpr).boolValue == true else { return .bool(false) }
                return .bool(evaluate(rightExpr).boolValue == true)
            case .or:
                if evaluate(leftExpr).boolValue == true { return .bool(true) }
                return .bool(evaluate(rightExpr).boolValue == true)
            case .coalesce:
                let left = evaluate(leftExpr)
                return left == .null ? evaluate(rightExpr) : left
            default:
                return binary(op, evaluate(leftExpr), evaluate(rightExpr))
            }
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func binary(_ op: BinaryOp, _ left: MilanoValue, _ right: MilanoValue) -> MilanoValue {
        // String concatenation.
        if op == .add, case .string(let l) = left, case .string(let r) = right {
            return .string(l + r)
        }

        // Equality: promote for numeric pairs, otherwise same-type comparison.
        if op == .equal || op == .notEqual {
            let equal: Bool
            switch (left, right) {
            case (.int(let l), .double(let r)): equal = Double(l) == r
            case (.double(let l), .int(let r)): equal = l == Double(r)
            case (.double(let l), .double(let r)): equal = l == r  // IEEE: NaN != NaN
            default: equal = left == right
            }
            return .bool(op == .equal ? equal : !equal)
        }

        // Numeric operators: int with int stays int; any double promotes.
        if case .int(let l) = left, case .int(let r) = right {
            switch op {
            case .multiply: return .int(l &* r)
            case .add: return .int(l &+ r)
            case .subtract: return .int(l &- r)
            case .divide:
                guard r != 0 else {
                    report(.divisionByZero, nil)
                    return .int(0)
                }
                if l == Int64.min, r == -1 { return .int(Int64.min) }  // wraps
                return .int(l / r)
            case .modulo:
                guard r != 0 else {
                    report(.divisionByZero, nil)
                    return .int(0)
                }
                if l == Int64.min, r == -1 { return .int(0) }
                return .int(l % r)
            case .less: return .bool(l < r)
            case .lessEqual: return .bool(l <= r)
            case .greater: return .bool(l > r)
            case .greaterEqual: return .bool(l >= r)
            default: return .null
            }
        }

        guard let l = promoted(left), let r = promoted(right) else { return .null }
        switch op {
        case .multiply: return .double(l * r)
        case .divide: return .double(l / r)  // IEEE: infinities and NaN
        case .modulo: return .double(l.truncatingRemainder(dividingBy: r))
        case .add: return .double(l + r)
        case .subtract: return .double(l - r)
        case .less: return .bool(l < r)
        case .lessEqual: return .bool(l <= r)
        case .greater: return .bool(l > r)
        case .greaterEqual: return .bool(l >= r)
        default: return .null
        }
    }

    private func promoted(_ value: MilanoValue) -> Double? {
        switch value {
        case .int(let v): return Double(v)
        case .double(let v): return v
        default: return nil
        }
    }

    /// The contract 2.1 string functions, in their own member: the
    /// built-in switch is long enough without them, and they share
    /// nothing with the rest but their arguments.
    private func stringCall(_ builtin: String, _ arguments: [MilanoValue]) -> MilanoValue {
        switch builtin {
        case "substring":
            guard case .string(let subject) = arguments[0],
                case .int(let from) = arguments[1],
                case .int(let to) = arguments[2]
            else { return .null }
            // Indices count Unicode scalars, as length does, so a
            // surrogate pair is one position and a slice never splits one.
            let scalars = Array(subject.unicodeScalars)
            let start = Self.clampIndex(from, upTo: scalars.count)
            let end = Self.clampIndex(to, upTo: scalars.count)
            var sliced = ""
            if start < end {
                sliced.unicodeScalars.append(contentsOf: scalars[start..<end])
            }
            return .string(sliced)
        case "indexOf":
            guard case .string(let subject) = arguments[0],
                case .string(let needle) = arguments[1]
            else { return .null }
            return .int(Int64(Self.scalarIndexOf(subject, needle)))
        case "replace":
            guard case .string(let subject) = arguments[0],
                case .string(let needle) = arguments[1],
                case .string(let replacement) = arguments[2]
            else { return .null }
            // An empty needle matches at every position; returning the
            // subject is what keeps the result bounded by its input.
            guard !needle.isEmpty else { return .string(subject) }
            return .string(Self.splitScalars(subject, separator: needle).joined(separator: replacement))
        case "split":
            guard case .string(let subject) = arguments[0],
                case .string(let separator) = arguments[1]
            else { return .null }
            // An empty separator would give one element per scalar,
            // unbounded in the value size; one element is the answer.
            let pieces = separator.isEmpty
                ? [subject]
                : Self.splitScalars(subject, separator: separator)
            return .array(pieces.map { MilanoValue.string($0) })
        case "join":
            guard case .array(let items) = arguments[0],
                case .string(let separator) = arguments[1]
            else { return .null }
            var pieces: [String] = []
            for item in items {
                guard case .string(let piece) = item else { return .null }
                pieces.append(piece)
            }
            return .string(pieces.joined(separator: separator))
        default:
            return .null
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    private func call(_ name: String, _ arguments: [MilanoValue]) -> MilanoValue {
        guard name.hasPrefix("$") else {
            // A host function the surface declares; the gate admits no
            // other bare name here.
            guard let declared = env.functions[name] else { return .null }
            return hostCall(name, arguments, declared: declared)
        }
        // A const, so the cases below can test it directly.
        let builtin = String(name.dropFirst())
        switch builtin {
        case "abs":
            // Two's complement: the minimum int negates to itself, no report.
            if case .int(let v) = arguments[0] { return .int(v < 0 ? 0 &- v : v) }
            // IEEE magnitude: abs(-0.0) is 0.0, NaN stays NaN.
            if case .double(let v) = arguments[0] { return .double(Swift.abs(v)) }
            return .null
        case "min", "max":
            return Self.extremum(builtin, arguments)
        case "floor", "ceil", "round":
            guard case .double(let v) = arguments[0] else { return .null }
            return .double(Self.rounded(builtin, v))
        case "str":
            switch arguments[0] {
            case .bool(let v): return .string(v ? "true" : "false")
            case .int(let v): return .string(String(v))
            case .double(let v): return .string(MilanoDoubleFormat.format(v))
            case .string(let v): return .string(v)
            default: return .null
            }
        case "int":
            guard case .double(let v) = arguments[0] else { return .null }
            if v.isNaN {
                report(.saturation, nil)
                return .int(0)
            }
            if v >= 9_223_372_036_854_775_808.0 {
                report(.saturation, nil)
                return .int(Int64.max)
            }
            if v < -9_223_372_036_854_775_808.0 {
                report(.saturation, nil)
                return .int(Int64.min)
            }
            return .int(Int64(v))  // truncates toward zero
        case "double":
            guard case .int(let v) = arguments[0] else { return .null }
            return .double(Double(v))
        case "concat":
            return .string(arguments.compactMap(\.stringValue).joined())
        case "length":
            if case .string(let v) = arguments[0] { return .int(Int64(v.unicodeScalars.count)) }
            if case .array(let v) = arguments[0] { return .int(Int64(v.count)) }
            return .null
        case "isEmpty":
            if case .string(let v) = arguments[0] { return .bool(v.unicodeScalars.isEmpty) }
            if case .array(let v) = arguments[0] { return .bool(v.isEmpty) }
            return .null
        case "contains", "startsWith", "endsWith":
            guard case .string(let haystack) = arguments[0],
                case .string(let needle) = arguments[1]
            else { return .null }
            let h = Array(haystack.utf16)
            let n = Array(needle.utf16)
            switch builtin {
            case "startsWith": return .bool(h.count >= n.count && Array(h.prefix(n.count)) == n)
            case "endsWith": return .bool(h.count >= n.count && Array(h.suffix(n.count)) == n)
            default:
                if n.isEmpty { return .bool(true) }
                guard n.count <= h.count else { return .bool(false) }
                for start in 0...(h.count - n.count) where Array(h[start..<(start + n.count)]) == n {
                    return .bool(true)
                }
                return .bool(false)
            }
        case "trim":
            guard case .string(let v) = arguments[0] else { return .null }
            let scalars = Array(v.unicodeScalars)
            var start = 0
            var end = scalars.count
            while start < end, MilanoWhitespace.contains(scalars[start]) { start += 1 }
            while end > start, MilanoWhitespace.contains(scalars[end - 1]) { end -= 1 }
            var result = ""
            result.unicodeScalars.append(contentsOf: scalars[start..<end])
            return .string(result)
        case "substring", "indexOf", "replace", "split", "join":
            return stringCall(builtin, arguments)
        default:
            return .null
        }
    }

    /// A host function call (expression spec, Host functions): the
    /// arguments promoted to their declared types, the handler asked
    /// synchronously, its answer validated against the declared return. A
    /// mismatch or a throw is an invalid function result: reported, and
    /// the zero value of the return type stands in, so evaluation stays
    /// total.
    private func hostCall(
        _ name: String, _ arguments: [MilanoValue], declared: MilanoVocabulary.Function
    ) -> MilanoValue {
        let promoted = arguments.enumerated().map { index, value -> MilanoValue in
            guard index < declared.arguments.count else { return value }
            return declared.arguments[index].validated(value) ?? value
        }
        func invalid(_ found: String) -> MilanoValue {
            report(
                .invalidFunctionResult,
                ExprReportDetail(name: name, expected: MilanoGate.name(of: declared.returns), found: found))
            return declared.returns.zeroValue
        }
        guard let handler = env.handler else { return invalid("error") }
        let answer: MilanoValue
        do {
            answer = try handler.call(MilanoFunctionCall(name: name, arguments: promoted))
        } catch {
            return invalid("error")
        }
        guard let validated = declared.returns.validated(answer) else {
            return invalid(MilanoGate.name(of: answer))
        }
        return validated
    }

    /// `$min` and `$max` per the expression spec, by their stripped name:
    /// the first argument, replaced by each later one that is strictly
    /// less (min) or greater (max), so ties keep the leftmost and
    /// min(0.0, -0.0) is 0.0; all int stays int, any double promotes every
    /// argument; a NaN anywhere is NaN. Never the platform's min, which
    /// orders signed zeros and NaN its own way.
    static func extremum(_ builtin: String, _ arguments: [MilanoValue]) -> MilanoValue {
        let ints = arguments.compactMap { value -> Int64? in
            if case .int(let v) = value { return v }
            return nil
        }
        if ints.count == arguments.count, let first = ints.first {
            var best = first
            for value in ints.dropFirst() where builtin == "min" ? value < best : value > best {
                best = value
            }
            return .int(best)
        }
        let doubles = arguments.map { value -> Double in
            switch value {
            case .int(let v): return Double(v)
            case .double(let v): return v
            default: return .nan
            }
        }
        guard let first = doubles.first else { return .null }
        if doubles.contains(where: \.isNaN) { return .double(.nan) }
        var best = first
        for value in doubles.dropFirst() where builtin == "min" ? value < best : value > best {
            best = value
        }
        return .double(best)
    }

    /// An int64 index brought into a scalar offset. Both of substring's
    /// indices clamp into `[0, count]`, so no index is ever out of range
    /// and the function reports nothing.
    static func clampIndex(_ value: Int64, upTo count: Int) -> Int {
        if value <= 0 { return 0 }
        if value >= Int64(count) { return count }
        return Int(value)
    }

    /// The scalar index where `needle` first occurs, or -1. Comparing by
    /// scalars keeps this agreeing with `length` and `substring` for text
    /// outside the Basic Multilingual Plane.
    static func scalarIndexOf(_ subject: String, _ needle: String) -> Int {
        let haystack = Array(subject.unicodeScalars)
        let pattern = Array(needle.unicodeScalars)
        if pattern.isEmpty { return 0 }
        guard pattern.count <= haystack.count else { return -1 }
        for start in 0...(haystack.count - pattern.count)
        where Array(haystack[start..<(start + pattern.count)]) == pattern {
            return start
        }
        return -1
    }

    /// The pieces between non-overlapping occurrences of `separator`,
    /// found left to right. Always at least one piece; Foundation's own
    /// splitting drops trailing empties, which the contract keeps.
    static func splitScalars(_ subject: String, separator: String) -> [String] {
        let haystack = Array(subject.unicodeScalars)
        let pattern = Array(separator.unicodeScalars)
        var pieces: [String] = []
        var piece = ""
        var index = 0
        while index < haystack.count {
            if index + pattern.count <= haystack.count,
                Array(haystack[index..<(index + pattern.count)]) == pattern {
                pieces.append(piece)
                piece = ""
                index += pattern.count
            } else {
                piece.unicodeScalars.append(haystack[index])
                index += 1
            }
        }
        pieces.append(piece)
        return pieces
    }

    /// `$floor`, `$ceil`, and `$round` per the expression spec, by their
    /// stripped name, IEEE 754 doubles in and out: non-finite values pass
    /// through, round breaks ties away from zero (never a platform
    /// rounding whose tie rule differs), and a zero result keeps the
    /// argument's sign, so ceil(-0.5) and round(-0.4) are -0.0.
    static func rounded(_ builtin: String, _ value: Double) -> Double {
        guard value.isFinite else { return value }
        let result: Double
        switch builtin {
        case "floor": result = value.rounded(.down)
        case "ceil": result = value.rounded(.up)
        default: result = value.rounded(.toNearestOrAwayFromZero)
        }
        return result == 0 ? (value.sign == .minus ? -0.0 : 0.0) : result
    }
}
