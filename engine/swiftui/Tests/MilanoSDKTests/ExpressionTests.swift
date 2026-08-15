import Foundation
import Testing

@testable import MilanoSDK

/// Expression semantics, pinned per spec 03. Each of these is also parity
/// material: the Kotlin engine mirrors this file.
struct ExpressionTests {

    private final class Reports {
        var kinds: [MilanoOccurrence.Kind] = []
    }

    private func evaluate(
        _ source: String,
        state: [String: MilanoValue] = [:],
        context: [String: MilanoValue] = [:],
        event: MilanoValue? = nil,
        reports: Reports? = nil
    ) throws -> MilanoValue {
        let expr = try ExprParser.parse(source)
        let evaluator = ExprEvaluator(
            state: state, context: context, event: event, node: nil,
            report: { kind in reports?.kinds.append(kind) })
        return evaluator.evaluate(expr)
    }

    private func inferredType(
        _ source: String,
        state: [String: MilanoType] = [:],
        context: [String: MilanoType] = [:]
    ) throws -> MilanoType? {
        let checker = ExprChecker(state: state, context: context, eventScope: .unavailable)
        return try checker.infer(try ExprParser.parse(source))
    }

    @Test func precedenceAndParentheses() throws {
        #expect(try evaluate("1 + 2 * 3") == .int(7))
        #expect(try evaluate("(1 + 2) * 3") == .int(9))
        #expect(try evaluate("!false && true") == .bool(true))
        #expect(try evaluate("1 + 2 < 4 == true") == .bool(true))
    }

    @Test func promotionRules() throws {
        #expect(try evaluate("1 + 2") == .int(3))
        #expect(try evaluate("1 + 2.0") == .double(3.0))
        #expect(try evaluate("1 == 1.0") == .bool(true))
        #expect(try evaluate("7 / 2") == .int(3))  // int division truncates
        #expect(try evaluate("7.0 / 2") == .double(3.5))
        #expect(try evaluate("-7 % 3") == .int(-1))  // sign follows dividend
    }

    @Test func integerWrapping() throws {
        #expect(try evaluate("9223372036854775807 + 1") == .int(Int64.min))
        #expect(try evaluate("(0 - 9223372036854775807 - 1) / (0 - 1)") == .int(Int64.min))
        #expect(try evaluate("(0 - 9223372036854775807 - 1) % (0 - 1)") == .int(0))
    }

    @Test func divisionByZeroIsZeroAndReported() throws {
        let reports = Reports()
        #expect(try evaluate("1 / 0", reports: reports) == .int(0))
        #expect(try evaluate("5 % 0", reports: reports) == .int(0))
        #expect(reports.kinds == [.divisionByZero, .divisionByZero])
        // Double division follows IEEE: no report.
        #expect(try evaluate("1.0 / 0.0") == .double(.infinity))
    }

    @Test func saturationReports() throws {
        let reports = Reports()
        #expect(try evaluate("int(1000000000000000000000.0)", reports: reports) == .int(Int64.max))
        #expect(try evaluate("int(3.9)", reports: reports) == .int(3))  // truncation, no report
        #expect(reports.kinds == [.saturation])
    }

    @Test func coalesceAndNull() throws {
        #expect(
            try evaluate("state.phone ?? 'none'", state: ["phone": .null]) == .string("none"))
        #expect(
            try evaluate("state.phone ?? 'none'", state: ["phone": .string("555")])
                == .string("555"))
        #expect(
            try evaluate("state.phone == null", state: ["phone": .null]) == .bool(true))
    }

    @Test func stringFunctions() throws {
        #expect(try evaluate("concat('a', 'b', 'c')") == .string("abc"))
        #expect(try evaluate("'a' + 'b'") == .string("ab"))
        #expect(try evaluate("length('héllo')") == .int(5))  // unicode scalars
        #expect(try evaluate("isEmpty('')") == .bool(true))
        #expect(try evaluate("contains('milano', 'lan')") == .bool(true))
        #expect(try evaluate("startsWith('milano', 'mi')") == .bool(true))
        #expect(try evaluate("endsWith('milano', 'no')") == .bool(true))
        // trim removes the Unicode White_Space set, including NBSP.
        #expect(try evaluate("trim('\u{00A0} x \u{2003}')") == .string("x"))
        #expect(try evaluate("if(true, 'a', 'b')") == .string("a"))
    }

    @Test func strFormatting() throws {
        #expect(try evaluate("str(42)") == .string("42"))
        #expect(try evaluate("str(true)") == .string("true"))
        #expect(try evaluate("str(5.0)") == .string("5.0"))
        #expect(try evaluate("str(0.25)") == .string("0.25"))
        #expect(try evaluate("str(1.0 / 0.0)") == .string("inf"))
        #expect(try evaluate("str(0.0 / 0.0)") == .string("nan"))
        #expect(try evaluate("str(10000000000000000000.0)") == .string("1e19"))
        #expect(try evaluate("str(0.0000015)") == .string("1.5e-6"))
    }

    @Test func staticTypingRejects() throws {
        // Big literal.
        #expect(throws: ExprError.self) { _ = try ExprParser.parse("99999999999999999999") }
        // String plus number.
        #expect(throws: ExprError.self) { _ = try inferredType("'a' + 1") }
        // Ordering on strings.
        #expect(throws: ExprError.self) { _ = try inferredType("'a' < 'b'") }
        // Unknown reference root and key.
        #expect(throws: ExprError.self) { _ = try inferredType("stuff.x") }
        #expect(throws: ExprError.self) { _ = try inferredType("state.missing") }
        // event outside an event scope.
        #expect(throws: ExprError.self) { _ = try inferredType("event") }
        // Field access on an optional record without ??.
        let user = MilanoType(.record(["name": MilanoType(.string)]), optional: true)
        #expect(throws: ExprError.self) {
            _ = try inferredType("context.user.name", context: ["user": user])
        }
        // if branches of different types.
        #expect(throws: ExprError.self) { _ = try inferredType("if(true, 1, 'x')") }
    }

    @Test func grammarAndWhitespace() throws {
        #expect(try evaluate("  1\t+ 2*3  ") == .int(7))
        #expect(try evaluate("state.user_2", state: ["user_2": .int(9)]) == .int(9))
        #expect(try evaluate("'it\\'s'") == .string("it's"))
        #expect(try evaluate("'a\\\\b'") == .string("a\\b"))
    }

    @Test func parseErrors() throws {
        let invalid = [".5", "1e5", "'abc", "", "1 +", "(1", "1 2", "state.", "?? 1", "1..2"]
        for source in invalid {
            #expect(throws: ExprError.self, "\(source)") { _ = try ExprParser.parse(source) }
        }
    }

    @Test func comparisonOperators() throws {
        #expect(try evaluate("2 < 3") == .bool(true))
        #expect(try evaluate("3 <= 3") == .bool(true))
        #expect(try evaluate("4 > 5") == .bool(false))
        #expect(try evaluate("5 >= 6") == .bool(false))
        #expect(try evaluate("2.5 > 2") == .bool(true))
        #expect(try evaluate("1 != 2") == .bool(true))
        #expect(try evaluate("'a' != 'b'") == .bool(true))
        #expect(try evaluate("true == true") == .bool(true))
    }

    @Test func shortCircuitSkipsRightOperand() throws {
        let reports = Reports()
        #expect(try evaluate("false && 1 / 0 == 0", reports: reports) == .bool(false))
        #expect(try evaluate("true || 1 / 0 == 0", reports: reports) == .bool(true))
        #expect(try evaluate("state.n ?? 1 / 0", state: ["n": .int(5)], reports: reports) == .int(5))
        #expect(reports.kinds.isEmpty)
        // The right side does evaluate when reached.
        #expect(try evaluate("true && 1 / 0 == 0", reports: reports) == .bool(true))
        #expect(reports.kinds == [.divisionByZero])
    }

    @Test func ifEvaluatesBothBranches() throws {
        let reports = Reports()
        #expect(try evaluate("if(true, 1, 1 / 0)", reports: reports) == .int(1))
        #expect(reports.kinds == [.divisionByZero])
    }

    @Test func unaryChains() throws {
        #expect(try evaluate("--5") == .int(5))
        #expect(try evaluate("!!true") == .bool(true))
        #expect(try evaluate("-(2 + 3)") == .int(-5))
        #expect(try evaluate("-2.5 * 2.0") == .double(-5.0))
        // Negating int min wraps back to itself.
        #expect(try evaluate("-(0 - 9223372036854775807 - 1)") == .int(Int64.min))
    }

    @Test func doubleModulo() throws {
        #expect(try evaluate("7.5 % 2.0") == .double(1.5))
        #expect(try evaluate("-7.5 % 2.0") == .double(-1.5))  // sign follows dividend
        #expect(try evaluate("7.5 % 2") == .double(1.5))  // promotion
    }

    @Test func nanAndInfinities() throws {
        #expect(try evaluate("0.0 / 0.0 == 0.0 / 0.0") == .bool(false))  // NaN != NaN
        #expect(try evaluate("0.0 / 0.0 != 1.0") == .bool(true))
        #expect(try evaluate("0.0 / 0.0 < 1.0") == .bool(false))
        #expect(try evaluate("1.0 / 0.0 > 0.0") == .bool(true))
        #expect(try evaluate("(0.0 - 1.0) / 0.0 < 0.0") == .bool(true))
        #expect(try evaluate("-0.0 == 0.0") == .bool(true))
    }

    @Test func conversionEdges() throws {
        let reports = Reports()
        #expect(try evaluate("int(-3.9)") == .int(-3))  // truncation toward zero
        #expect(try evaluate("double(3)") == .double(3.0))
        #expect(try evaluate("int(-1000000000000000000000.0)", reports: reports) == .int(Int64.min))
        #expect(try evaluate("int(0.0 / 0.0)", reports: reports) == .int(0))
        #expect(reports.kinds == [.saturation, .saturation])
    }

    @Test func coalesceChains() throws {
        // Right-associative, so a chain falls through left to right.
        let none: [String: MilanoValue] = ["a": .null, "b": .null]
        #expect(try evaluate("state.a ?? state.b ?? 'z'", state: none) == .string("z"))
        #expect(
            try evaluate("state.a ?? state.b ?? 'z'", state: ["a": .null, "b": .string("b")])
                == .string("b"))
        // ?? binds loosest: the right side is a whole additive expression.
        #expect(try evaluate("state.a ?? 1 + 2", state: ["a": .null]) == .int(3))
    }

    @Test func strBoundaries() throws {
        #expect(try evaluate("str(-42)") == .string("-42"))
        #expect(try evaluate("str(0 - 9223372036854775807 - 1)") == .string("-9223372036854775808"))
        #expect(try evaluate("str(9223372036854775807)") == .string("9223372036854775807"))
        // Normalized exponent 15 stays plain; 16 flips to scientific.
        #expect(try evaluate("str(1000000000000000.0)") == .string("1000000000000000.0"))
        #expect(try evaluate("str(0.0001)") == .string("0.0001"))
        #expect(try evaluate("str(0.00001)") == .string("1e-5"))
        #expect(try evaluate("str((0.0 - 1.0) / 0.0)") == .string("-inf"))
        #expect(try evaluate("str(-2.5)") == .string("-2.5"))
    }

    @Test func eventRoot() throws {
        #expect(try evaluate("event + 1", event: .int(2)) == .int(3))
        let checker = ExprChecker(state: [:], context: [:], eventScope: .payload(MilanoType(.int)))
        #expect(try checker.infer(try ExprParser.parse("event * 2")) == MilanoType(.int))
    }

    @Test func recordFieldAccess() throws {
        let user: MilanoValue = .record(["name": .string("Ada"), "age": .int(36)])
        #expect(try evaluate("state.user.name", state: ["user": user]) == .string("Ada"))
        #expect(try evaluate("state.user.age + 1", state: ["user": user]) == .int(37))
        let userType = MilanoType(.record(["name": MilanoType(.string)]))
        #expect(
            try inferredType("context.user.name", context: ["user": userType])
                == MilanoType(.string))
    }

    @Test func typingRejectsMore() throws {
        #expect(throws: ExprError.self) { _ = try inferredType("!1") }
        #expect(throws: ExprError.self) { _ = try inferredType("-true") }
        #expect(throws: ExprError.self) { _ = try inferredType("1 && true") }
        #expect(throws: ExprError.self) { _ = try inferredType("true < false") }
        #expect(throws: ExprError.self) { _ = try inferredType("'a' * 2") }
        #expect(throws: ExprError.self) { _ = try inferredType("if(1, 2, 3)") }
        #expect(throws: ExprError.self) { _ = try inferredType("length(1)") }
        #expect(throws: ExprError.self) { _ = try inferredType("concat('a')") }
        #expect(throws: ExprError.self) { _ = try inferredType("contains('a', 1)") }
        #expect(throws: ExprError.self) { _ = try inferredType("nope(1)") }
        #expect(throws: ExprError.self) { _ = try inferredType("str(1, 2)") }
        // Records are not comparable in v1.
        let rec = MilanoType(.record(["x": MilanoType(.int)]))
        #expect(throws: ExprError.self) {
            _ = try inferredType("context.a == context.b", context: ["a": rec, "b": rec])
        }
    }

    @Test func typingAcceptsMore() throws {
        #expect(try inferredType("-2.5") == MilanoType(.double))
        #expect(try inferredType("7 % 2") == MilanoType(.int))
        #expect(try inferredType("trim(str(1.5))") == MilanoType(.string))
        #expect(try inferredType("concat('a', str(1), str(true))") == MilanoType(.string))
        #expect(try inferredType("if(1 < 2, 1.0, double(3))") == MilanoType(.double))
        #expect(try inferredType("1 == 1.0") == MilanoType(.bool))
    }

    @Test func typingAccepts() throws {
        #expect(try inferredType("1 + 2.0") == MilanoType(.double))
        #expect(
            try inferredType(
                "state.phone ?? ''", state: ["phone": MilanoType(.string, optional: true)])
                == MilanoType(.string))
        // if with a null branch produces an optional.
        #expect(try inferredType("if(true, 'a', null)") == MilanoType(.string, optional: true))
        let checker = ExprChecker(state: [:], context: [:], eventScope: .unavailable)
        // int accepted where double declared; reverse rejected.
        #expect(checker.accepts(MilanoType(.double), actual: MilanoType(.int)))
        #expect(!checker.accepts(MilanoType(.int), actual: MilanoType(.double)))
        // T accepted where T? declared.
        #expect(checker.accepts(MilanoType(.string, optional: true), actual: MilanoType(.string)))
        #expect(!checker.accepts(MilanoType(.string), actual: MilanoType(.string, optional: true)))
    }
}
