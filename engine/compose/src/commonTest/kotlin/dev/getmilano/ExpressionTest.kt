package dev.getmilano

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Expression semantics, pinned per spec 03. Mirrors the Swift engine's
 * ExpressionTests file.
 */
class ExpressionTest {
    private fun evaluate(
        source: String,
        state: Map<String, MilanoValue> = emptyMap(),
        context: Map<String, MilanoValue> = emptyMap(),
        event: MilanoValue? = null,
        reports: MutableList<MilanoOccurrence.Kind>? = null,
    ): MilanoValue {
        val expr = ExprParser.parse(source)
        val evaluator =
            ExprEvaluator(state, context, event = event) { kind ->
                reports?.add(kind)
            }
        return evaluator.evaluate(expr)
    }

    private fun inferredType(
        source: String,
        state: Map<String, MilanoType> = emptyMap(),
        context: Map<String, MilanoType> = emptyMap(),
    ): MilanoType? = ExprChecker(state, context, EventScope.Unavailable).infer(ExprParser.parse(source))

    @Test
    fun precedenceAndParentheses() {
        assertEquals(MilanoValue.IntValue(7), evaluate("1 + 2 * 3"))
        assertEquals(MilanoValue.IntValue(9), evaluate("(1 + 2) * 3"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("!false && true"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("1 + 2 < 4 == true"))
    }

    @Test
    fun promotionRules() {
        assertEquals(MilanoValue.IntValue(3), evaluate("1 + 2"))
        assertEquals(MilanoValue.DoubleValue(3.0), evaluate("1 + 2.0"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("1 == 1.0"))
        assertEquals(MilanoValue.IntValue(3), evaluate("7 / 2")) // int division truncates
        assertEquals(MilanoValue.DoubleValue(3.5), evaluate("7.0 / 2"))
        assertEquals(MilanoValue.IntValue(-1), evaluate("-7 % 3")) // sign follows dividend
    }

    @Test
    fun integerWrapping() {
        assertEquals(MilanoValue.IntValue(Long.MIN_VALUE), evaluate("9223372036854775807 + 1"))
        assertEquals(
            MilanoValue.IntValue(Long.MIN_VALUE),
            evaluate("(0 - 9223372036854775807 - 1) / (0 - 1)"),
        )
        assertEquals(
            MilanoValue.IntValue(0),
            evaluate("(0 - 9223372036854775807 - 1) % (0 - 1)"),
        )
    }

    @Test
    fun divisionByZeroIsZeroAndReported() {
        val reports = ArrayList<MilanoOccurrence.Kind>()
        assertEquals(MilanoValue.IntValue(0), evaluate("1 / 0", reports = reports))
        assertEquals(MilanoValue.IntValue(0), evaluate("5 % 0", reports = reports))
        assertEquals(
            listOf(MilanoOccurrence.Kind.DIVISION_BY_ZERO, MilanoOccurrence.Kind.DIVISION_BY_ZERO),
            reports,
        )
        // Double division follows IEEE: no report.
        assertEquals(MilanoValue.DoubleValue(Double.POSITIVE_INFINITY), evaluate("1.0 / 0.0"))
    }

    @Test
    fun saturationReports() {
        val reports = ArrayList<MilanoOccurrence.Kind>()
        assertEquals(
            MilanoValue.IntValue(Long.MAX_VALUE),
            evaluate("int(1000000000000000000000.0)", reports = reports),
        )
        assertEquals(MilanoValue.IntValue(3), evaluate("int(3.9)", reports = reports))
        assertEquals(listOf(MilanoOccurrence.Kind.SATURATION), reports)
    }

    @Test
    fun coalesceAndNull() {
        assertEquals(
            MilanoValue.StringValue("none"),
            evaluate("state.phone ?? 'none'", state = mapOf("phone" to MilanoValue.Null)),
        )
        assertEquals(
            MilanoValue.StringValue("555"),
            evaluate("state.phone ?? 'none'", state = mapOf("phone" to MilanoValue.StringValue("555"))),
        )
        assertEquals(
            MilanoValue.BoolValue(true),
            evaluate("state.phone == null", state = mapOf("phone" to MilanoValue.Null)),
        )
    }

    @Test
    fun stringFunctions() {
        assertEquals(MilanoValue.StringValue("abc"), evaluate("concat('a', 'b', 'c')"))
        assertEquals(MilanoValue.StringValue("ab"), evaluate("'a' + 'b'"))
        assertEquals(MilanoValue.IntValue(5), evaluate("length('héllo')")) // unicode scalars
        assertEquals(MilanoValue.BoolValue(true), evaluate("isEmpty('')"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("contains('milano', 'lan')"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("startsWith('milano', 'mi')"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("endsWith('milano', 'no')"))
        // trim removes the Unicode White_Space set, including NBSP.
        assertEquals(MilanoValue.StringValue("x"), evaluate("trim('  x  ')"))
        assertEquals(MilanoValue.StringValue("a"), evaluate("if(true, 'a', 'b')"))
    }

    @Test
    fun strFormatting() {
        assertEquals(MilanoValue.StringValue("42"), evaluate("str(42)"))
        assertEquals(MilanoValue.StringValue("true"), evaluate("str(true)"))
        assertEquals(MilanoValue.StringValue("5.0"), evaluate("str(5.0)"))
        assertEquals(MilanoValue.StringValue("0.25"), evaluate("str(0.25)"))
        assertEquals(MilanoValue.StringValue("inf"), evaluate("str(1.0 / 0.0)"))
        assertEquals(MilanoValue.StringValue("nan"), evaluate("str(0.0 / 0.0)"))
        assertEquals(MilanoValue.StringValue("1e19"), evaluate("str(10000000000000000000.0)"))
        assertEquals(MilanoValue.StringValue("1.5e-6"), evaluate("str(0.0000015)"))
    }

    @Test
    fun staticTypingRejects() {
        assertFailsWith<ExprException> { ExprParser.parse("99999999999999999999") }
        assertFailsWith<ExprException> { inferredType("'a' + 1") }
        assertFailsWith<ExprException> { inferredType("'a' < 'b'") }
        assertFailsWith<ExprException> { inferredType("stuff.x") }
        assertFailsWith<ExprException> { inferredType("state.missing") }
        assertFailsWith<ExprException> { inferredType("event") }
        val user =
            MilanoType(
                MilanoType.Kind.Record(mapOf("name" to MilanoType(MilanoType.Kind.Text))),
                optional = true,
            )
        assertFailsWith<ExprException> {
            inferredType("context.user.name", context = mapOf("user" to user))
        }
        assertFailsWith<ExprException> { inferredType("if(true, 1, 'x')") }
    }

    @Test
    fun grammarAndWhitespace() {
        assertEquals(MilanoValue.IntValue(7), evaluate("  1\t+ 2*3  "))
        assertEquals(
            MilanoValue.IntValue(9),
            evaluate("state.user_2", state = mapOf("user_2" to MilanoValue.IntValue(9))),
        )
        assertEquals(MilanoValue.StringValue("it's"), evaluate("'it\\'s'"))
        assertEquals(MilanoValue.StringValue("a\\b"), evaluate("'a\\\\b'"))
    }

    @Test
    fun parseErrors() {
        val invalid = listOf(".5", "1e5", "'abc", "", "1 +", "(1", "1 2", "state.", "?? 1", "1..2")
        for (source in invalid) {
            assertFailsWith<ExprException>(source) { ExprParser.parse(source) }
        }
    }

    @Test
    fun comparisonOperators() {
        assertEquals(MilanoValue.BoolValue(true), evaluate("2 < 3"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("3 <= 3"))
        assertEquals(MilanoValue.BoolValue(false), evaluate("4 > 5"))
        assertEquals(MilanoValue.BoolValue(false), evaluate("5 >= 6"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("2.5 > 2"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("1 != 2"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("'a' != 'b'"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("true == true"))
    }

    @Test
    fun shortCircuitSkipsRightOperand() {
        val reports = ArrayList<MilanoOccurrence.Kind>()
        assertEquals(MilanoValue.BoolValue(false), evaluate("false && 1 / 0 == 0", reports = reports))
        assertEquals(MilanoValue.BoolValue(true), evaluate("true || 1 / 0 == 0", reports = reports))
        assertEquals(
            MilanoValue.IntValue(5),
            evaluate("state.n ?? 1 / 0", state = mapOf("n" to MilanoValue.IntValue(5)), reports = reports),
        )
        assertTrue(reports.isEmpty())
        // The right side does evaluate when reached.
        assertEquals(MilanoValue.BoolValue(true), evaluate("true && 1 / 0 == 0", reports = reports))
        assertEquals(listOf(MilanoOccurrence.Kind.DIVISION_BY_ZERO), reports)
    }

    @Test
    fun ifEvaluatesBothBranches() {
        val reports = ArrayList<MilanoOccurrence.Kind>()
        assertEquals(MilanoValue.IntValue(1), evaluate("if(true, 1, 1 / 0)", reports = reports))
        assertEquals(listOf(MilanoOccurrence.Kind.DIVISION_BY_ZERO), reports)
    }

    @Test
    fun unaryChains() {
        assertEquals(MilanoValue.IntValue(5), evaluate("--5"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("!!true"))
        assertEquals(MilanoValue.IntValue(-5), evaluate("-(2 + 3)"))
        assertEquals(MilanoValue.DoubleValue(-5.0), evaluate("-2.5 * 2.0"))
        // Negating int min wraps back to itself.
        assertEquals(MilanoValue.IntValue(Long.MIN_VALUE), evaluate("-(0 - 9223372036854775807 - 1)"))
    }

    @Test
    fun doubleModulo() {
        assertEquals(MilanoValue.DoubleValue(1.5), evaluate("7.5 % 2.0"))
        assertEquals(MilanoValue.DoubleValue(-1.5), evaluate("-7.5 % 2.0")) // sign follows dividend
        assertEquals(MilanoValue.DoubleValue(1.5), evaluate("7.5 % 2")) // promotion
    }

    @Test
    fun nanAndInfinities() {
        assertEquals(MilanoValue.BoolValue(false), evaluate("0.0 / 0.0 == 0.0 / 0.0")) // NaN != NaN
        assertEquals(MilanoValue.BoolValue(true), evaluate("0.0 / 0.0 != 1.0"))
        assertEquals(MilanoValue.BoolValue(false), evaluate("0.0 / 0.0 < 1.0"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("1.0 / 0.0 > 0.0"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("(0.0 - 1.0) / 0.0 < 0.0"))
        assertEquals(MilanoValue.BoolValue(true), evaluate("-0.0 == 0.0"))
    }

    @Test
    fun conversionEdges() {
        val reports = ArrayList<MilanoOccurrence.Kind>()
        assertEquals(MilanoValue.IntValue(-3), evaluate("int(-3.9)")) // truncation toward zero
        assertEquals(MilanoValue.DoubleValue(3.0), evaluate("double(3)"))
        assertEquals(
            MilanoValue.IntValue(Long.MIN_VALUE),
            evaluate("int(-1000000000000000000000.0)", reports = reports),
        )
        assertEquals(MilanoValue.IntValue(0), evaluate("int(0.0 / 0.0)", reports = reports))
        assertEquals(
            listOf(MilanoOccurrence.Kind.SATURATION, MilanoOccurrence.Kind.SATURATION),
            reports,
        )
    }

    @Test
    fun coalesceChains() {
        // Right-associative, so a chain falls through left to right.
        val none = mapOf("a" to MilanoValue.Null, "b" to MilanoValue.Null)
        assertEquals(MilanoValue.StringValue("z"), evaluate("state.a ?? state.b ?? 'z'", state = none))
        assertEquals(
            MilanoValue.StringValue("b"),
            evaluate(
                "state.a ?? state.b ?? 'z'",
                state = mapOf("a" to MilanoValue.Null, "b" to MilanoValue.StringValue("b")),
            ),
        )
        // ?? binds loosest: the right side is a whole additive expression.
        assertEquals(
            MilanoValue.IntValue(3),
            evaluate("state.a ?? 1 + 2", state = mapOf("a" to MilanoValue.Null)),
        )
    }

    @Test
    fun strBoundaries() {
        assertEquals(MilanoValue.StringValue("-42"), evaluate("str(-42)"))
        assertEquals(
            MilanoValue.StringValue("-9223372036854775808"),
            evaluate("str(0 - 9223372036854775807 - 1)"),
        )
        assertEquals(
            MilanoValue.StringValue("9223372036854775807"),
            evaluate("str(9223372036854775807)"),
        )
        // Normalized exponent 15 stays plain; 16 flips to scientific.
        assertEquals(MilanoValue.StringValue("1000000000000000.0"), evaluate("str(1000000000000000.0)"))
        assertEquals(MilanoValue.StringValue("0.0001"), evaluate("str(0.0001)"))
        assertEquals(MilanoValue.StringValue("1e-5"), evaluate("str(0.00001)"))
        assertEquals(MilanoValue.StringValue("-inf"), evaluate("str((0.0 - 1.0) / 0.0)"))
        assertEquals(MilanoValue.StringValue("-2.5"), evaluate("str(-2.5)"))
    }

    @Test
    fun eventRoot() {
        assertEquals(MilanoValue.IntValue(3), evaluate("event + 1", event = MilanoValue.IntValue(2)))
        val checker =
            ExprChecker(
                emptyMap(),
                emptyMap(),
                EventScope.Payload(MilanoType(MilanoType.Kind.Int)),
            )
        assertEquals(MilanoType(MilanoType.Kind.Int), checker.infer(ExprParser.parse("event * 2")))
    }

    @Test
    fun recordFieldAccess() {
        val user =
            MilanoValue.RecordValue(
                mapOf("name" to MilanoValue.StringValue("Ada"), "age" to MilanoValue.IntValue(36)),
            )
        assertEquals(
            MilanoValue.StringValue("Ada"),
            evaluate("state.user.name", state = mapOf("user" to user)),
        )
        assertEquals(
            MilanoValue.IntValue(37),
            evaluate("state.user.age + 1", state = mapOf("user" to user)),
        )
        val userType = MilanoType(MilanoType.Kind.Record(mapOf("name" to MilanoType(MilanoType.Kind.Text))))
        assertEquals(
            MilanoType(MilanoType.Kind.Text),
            inferredType("context.user.name", context = mapOf("user" to userType)),
        )
    }

    @Test
    fun typingRejectsMore() {
        assertFailsWith<ExprException> { inferredType("!1") }
        assertFailsWith<ExprException> { inferredType("-true") }
        assertFailsWith<ExprException> { inferredType("1 && true") }
        assertFailsWith<ExprException> { inferredType("true < false") }
        assertFailsWith<ExprException> { inferredType("'a' * 2") }
        assertFailsWith<ExprException> { inferredType("if(1, 2, 3)") }
        assertFailsWith<ExprException> { inferredType("length(1)") }
        assertFailsWith<ExprException> { inferredType("concat('a')") }
        assertFailsWith<ExprException> { inferredType("contains('a', 1)") }
        assertFailsWith<ExprException> { inferredType("nope(1)") }
        assertFailsWith<ExprException> { inferredType("str(1, 2)") }
        // Records are not comparable in v1.
        val rec = MilanoType(MilanoType.Kind.Record(mapOf("x" to MilanoType(MilanoType.Kind.Int))))
        assertFailsWith<ExprException> {
            inferredType("context.a == context.b", context = mapOf("a" to rec, "b" to rec))
        }
    }

    @Test
    fun typingAcceptsMore() {
        assertEquals(MilanoType(MilanoType.Kind.Double), inferredType("-2.5"))
        assertEquals(MilanoType(MilanoType.Kind.Int), inferredType("7 % 2"))
        assertEquals(MilanoType(MilanoType.Kind.Text), inferredType("trim(str(1.5))"))
        assertEquals(MilanoType(MilanoType.Kind.Text), inferredType("concat('a', str(1), str(true))"))
        assertEquals(MilanoType(MilanoType.Kind.Double), inferredType("if(1 < 2, 1.0, double(3))"))
        assertEquals(MilanoType(MilanoType.Kind.Bool), inferredType("1 == 1.0"))
    }

    @Test
    fun typingAccepts() {
        assertEquals(MilanoType(MilanoType.Kind.Double), inferredType("1 + 2.0"))
        assertEquals(
            MilanoType(MilanoType.Kind.Text),
            inferredType(
                "state.phone ?? ''",
                state = mapOf("phone" to MilanoType(MilanoType.Kind.Text, optional = true)),
            ),
        )
        assertEquals(
            MilanoType(MilanoType.Kind.Text, optional = true),
            inferredType("if(true, 'a', null)"),
        )

        val checker = ExprChecker(emptyMap(), emptyMap(), EventScope.Unavailable)
        assertTrue(checker.accepts(MilanoType(MilanoType.Kind.Double), MilanoType(MilanoType.Kind.Int)))
        assertFalse(checker.accepts(MilanoType(MilanoType.Kind.Int), MilanoType(MilanoType.Kind.Double)))
        assertTrue(checker.accepts(MilanoType(MilanoType.Kind.Text, optional = true), MilanoType(MilanoType.Kind.Text)))
        assertFalse(checker.accepts(MilanoType(MilanoType.Kind.Text), MilanoType(MilanoType.Kind.Text, optional = true)))
    }
}
