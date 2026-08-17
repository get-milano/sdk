import Foundation

/// Total evaluation: after the gate, this cannot fail. Division by zero and
/// saturation report occurrences through `report`.
struct ExprEvaluator {
    let state: [String: MilanoValue]
    let context: [String: MilanoValue]
    let event: MilanoValue?
    var result: MilanoValue?
    let node: String?
    let report: (MilanoOccurrence.Kind) -> Void

    /// Only `event` and `result` reach evaluation as bare roots.
    private func rootValue(_ name: String) -> MilanoValue {
        switch name {
        case "event": return event ?? .null
        case "result": return result ?? .null
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
            if name == "if" {
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
                    report(.divisionByZero)
                    return .int(0)
                }
                if l == Int64.min, r == -1 { return .int(Int64.min) }  // wraps
                return .int(l / r)
            case .modulo:
                guard r != 0 else {
                    report(.divisionByZero)
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

    // swiftlint:disable:next cyclomatic_complexity
    private func call(_ name: String, _ arguments: [MilanoValue]) -> MilanoValue {
        switch name {
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
                report(.saturation)
                return .int(0)
            }
            if v >= 9_223_372_036_854_775_808.0 {
                report(.saturation)
                return .int(Int64.max)
            }
            if v < -9_223_372_036_854_775_808.0 {
                report(.saturation)
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
            switch name {
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
        default:
            return .null
        }
    }
}
