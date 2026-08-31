package dev.getmilano

// Evaluation

/**
 * The detail an evaluation report may carry: an invalid function result
 * names the function, the declared return type, and what arrived.
 */
internal class ReportDetail(
    val name: String,
    val expected: String,
    val found: String,
)

/**
 * What an evaluation needs to call host functions: the surface's
 * declarations and the engine's handler (null when none is installed,
 * which the gate rules out for any document that calls one).
 */
internal class EvalEnvironment(
    val functions: Map<String, MilanoVocabulary.Function>,
    val handler: MilanoFunctionHandler?,
) {
    companion object {
        val NONE = EvalEnvironment(emptyMap(), null)
    }
}

/**
 * The zero value of a declared type (expression spec, Host functions):
 * what an invalid function result evaluates to, so evaluation stays
 * total. Optionals are null; an enum is its first declared member.
 */
internal fun zeroValueOf(type: MilanoType): MilanoValue {
    if (type.optional) return MilanoValue.Null
    return when (val kind = type.kind) {
        is MilanoType.Kind.Bool -> MilanoValue.BoolValue(false)
        is MilanoType.Kind.Int -> MilanoValue.IntValue(0)
        is MilanoType.Kind.Double -> MilanoValue.DoubleValue(0.0)
        is MilanoType.Kind.Text -> MilanoValue.StringValue("")
        is MilanoType.Kind.Enum -> MilanoValue.StringValue(kind.members.firstOrNull() ?: "")
        is MilanoType.Kind.Array -> MilanoValue.ArrayValue(emptyList())
        is MilanoType.Kind.Record -> MilanoValue.RecordValue(kind.fields.mapValues { (_, field) -> zeroValueOf(field) })
    }
}

/**
 * Total evaluation: after the gate, this cannot fail. Division by zero,
 * saturation, and invalid function results report occurrences through
 * [report] (the detail names the function, its declared return type, and
 * what arrived; null for the arithmetic reports).
 */
internal class ExprEvaluator(
    private val state: Map<String, MilanoValue>,
    private val context: Map<String, MilanoValue>,
    private val event: MilanoValue?,
    private val result: MilanoValue? = null,
    /** `$repeat` bindings in scope: the element and its index, by name. */
    private val bindings: Map<String, MilanoValue> = emptyMap(),
    private val failure: MilanoValue? = null,
    /** The host functions the surface declares and the engine's handler. */
    private val env: EvalEnvironment = EvalEnvironment.NONE,
    private val report: (MilanoOccurrence.Kind, ReportDetail?) -> Unit,
) {
    fun evaluate(expr: Expr): MilanoValue =
        when (expr) {
            is Expr.NullLiteral -> {
                MilanoValue.Null
            }

            is Expr.BoolLiteral -> {
                MilanoValue.BoolValue(expr.value)
            }

            is Expr.IntLiteral -> {
                MilanoValue.IntValue(expr.value)
            }

            is Expr.DoubleLiteral -> {
                MilanoValue.DoubleValue(expr.value)
            }

            is Expr.StringLiteral -> {
                MilanoValue.StringValue(expr.value)
            }

            is Expr.Root -> {
                bindings[expr.name] ?: when (expr.name) {
                    "event" -> event ?: MilanoValue.Null
                    "result" -> result ?: MilanoValue.Null
                    "failure" -> failure ?: MilanoValue.Null
                    else -> MilanoValue.Null
                }
            }

            is Expr.Lookup -> {
                // An enum value is its member string, and the gate proved
                // the record has a field of exactly that name.
                val record = (evaluate(expr.base) as? MilanoValue.RecordValue)?.values
                val member = (evaluate(expr.key) as? MilanoValue.StringValue)?.value
                if (record == null || member == null) {
                    MilanoValue.Null
                } else {
                    record[member] ?: MilanoValue.Null
                }
            }

            is Expr.Member -> {
                val base = expr.base
                when {
                    base is Expr.Root && base.name == "state" -> {
                        state[expr.field] ?: MilanoValue.Null
                    }

                    base is Expr.Root && base.name == "context" -> {
                        context[expr.field] ?: MilanoValue.Null
                    }

                    else -> {
                        (evaluate(base) as? MilanoValue.RecordValue)
                            ?.values
                            ?.get(expr.field) ?: MilanoValue.Null
                    }
                }
            }

            is Expr.Call -> {
                if (expr.name == "${'$'}if") {
                    // Lazy conditional: only the taken branch evaluates, like
                    // && || and ??, so guards suppress the reports they guard.
                    val taken = if (evaluate(expr.arguments[0]).boolOrNull == true) 1 else 2
                    evaluate(expr.arguments[taken])
                } else {
                    call(expr.name, expr.arguments.map { evaluate(it) })
                }
            }

            is Expr.Unary -> {
                val value = evaluate(expr.operand)
                when (expr.op) {
                    UnaryOp.NOT -> {
                        MilanoValue.BoolValue(value.boolOrNull != true)
                    }

                    UnaryOp.NEGATE -> {
                        when (value) {
                            is MilanoValue.IntValue -> MilanoValue.IntValue(0L - value.value)
                            is MilanoValue.DoubleValue -> MilanoValue.DoubleValue(-value.value)
                            else -> MilanoValue.Null
                        }
                    }
                }
            }

            is Expr.Binary -> {
                when (expr.op) {
                    BinaryOp.AND -> {
                        if (evaluate(expr.left).boolOrNull != true) {
                            MilanoValue.BoolValue(false)
                        } else {
                            MilanoValue.BoolValue(evaluate(expr.right).boolOrNull == true)
                        }
                    }

                    BinaryOp.OR -> {
                        if (evaluate(expr.left).boolOrNull == true) {
                            MilanoValue.BoolValue(true)
                        } else {
                            MilanoValue.BoolValue(evaluate(expr.right).boolOrNull == true)
                        }
                    }

                    BinaryOp.COALESCE -> {
                        val left = evaluate(expr.left)
                        if (left is MilanoValue.Null) evaluate(expr.right) else left
                    }

                    else -> {
                        binary(expr.op, evaluate(expr.left), evaluate(expr.right))
                    }
                }
            }
        }

    private fun binary(
        op: BinaryOp,
        left: MilanoValue,
        right: MilanoValue,
    ): MilanoValue {
        if (op == BinaryOp.ADD && left is MilanoValue.StringValue && right is MilanoValue.StringValue) {
            return MilanoValue.StringValue(left.value + right.value)
        }

        if (op == BinaryOp.EQUAL || op == BinaryOp.NOT_EQUAL) {
            val equal =
                when {
                    left is MilanoValue.IntValue && right is MilanoValue.DoubleValue -> {
                        left.value.toDouble() == right.value
                    }

                    left is MilanoValue.DoubleValue && right is MilanoValue.IntValue -> {
                        left.value == right.value.toDouble()
                    }

                    left is MilanoValue.DoubleValue && right is MilanoValue.DoubleValue -> {
                        left.value == right.value
                    }

                    // IEEE: NaN != NaN
                    else -> {
                        left == right
                    }
                }
            return MilanoValue.BoolValue(if (op == BinaryOp.EQUAL) equal else !equal)
        }

        if (left is MilanoValue.IntValue && right is MilanoValue.IntValue) {
            val l = left.value
            val r = right.value
            return when (op) {
                BinaryOp.MULTIPLY -> {
                    MilanoValue.IntValue(l * r)
                }

                BinaryOp.ADD -> {
                    MilanoValue.IntValue(l + r)
                }

                BinaryOp.SUBTRACT -> {
                    MilanoValue.IntValue(l - r)
                }

                BinaryOp.DIVIDE -> {
                    if (r == 0L) {
                        report(MilanoOccurrence.Kind.DIVISION_BY_ZERO, null)
                        MilanoValue.IntValue(0)
                    } else if (l == Long.MIN_VALUE && r == -1L) {
                        MilanoValue.IntValue(Long.MIN_VALUE) // wraps
                    } else {
                        MilanoValue.IntValue(l / r)
                    }
                }

                BinaryOp.MODULO -> {
                    if (r == 0L) {
                        report(MilanoOccurrence.Kind.DIVISION_BY_ZERO, null)
                        MilanoValue.IntValue(0)
                    } else if (l == Long.MIN_VALUE && r == -1L) {
                        MilanoValue.IntValue(0)
                    } else {
                        MilanoValue.IntValue(l % r)
                    }
                }

                BinaryOp.LESS -> {
                    MilanoValue.BoolValue(l < r)
                }

                BinaryOp.LESS_EQUAL -> {
                    MilanoValue.BoolValue(l <= r)
                }

                BinaryOp.GREATER -> {
                    MilanoValue.BoolValue(l > r)
                }

                BinaryOp.GREATER_EQUAL -> {
                    MilanoValue.BoolValue(l >= r)
                }

                else -> {
                    MilanoValue.Null
                }
            }
        }

        val l = promoted(left) ?: return MilanoValue.Null
        val r = promoted(right) ?: return MilanoValue.Null
        return when (op) {
            BinaryOp.MULTIPLY -> MilanoValue.DoubleValue(l * r)

            BinaryOp.DIVIDE -> MilanoValue.DoubleValue(l / r)

            // IEEE: infinities and NaN
            // Kotlin's % on doubles is the truncating remainder, matching
            // Swift's truncatingRemainder: sign follows the dividend.
            BinaryOp.MODULO -> MilanoValue.DoubleValue(l % r)

            BinaryOp.ADD -> MilanoValue.DoubleValue(l + r)

            BinaryOp.SUBTRACT -> MilanoValue.DoubleValue(l - r)

            BinaryOp.LESS -> MilanoValue.BoolValue(l < r)

            BinaryOp.LESS_EQUAL -> MilanoValue.BoolValue(l <= r)

            BinaryOp.GREATER -> MilanoValue.BoolValue(l > r)

            BinaryOp.GREATER_EQUAL -> MilanoValue.BoolValue(l >= r)

            else -> MilanoValue.Null
        }
    }

    private fun promoted(value: MilanoValue): Double? =
        when (value) {
            is MilanoValue.IntValue -> value.value.toDouble()
            is MilanoValue.DoubleValue -> value.value
            else -> null
        }

    private fun call(
        name: String,
        arguments: List<MilanoValue>,
    ): MilanoValue {
        if (!name.startsWith('$')) {
            val declared = env.functions[name] ?: return MilanoValue.Null
            return hostCall(name, arguments, declared)
        }
        // A val, so the branches below can test it directly.
        val builtin = name.substring(1)
        return when (builtin) {
            "abs" -> {
                when (val v = arguments[0]) {
                    // Two's complement: the minimum int negates to itself, no report.
                    is MilanoValue.IntValue -> MilanoValue.IntValue(if (v.value < 0) 0L - v.value else v.value)

                    // IEEE magnitude: abs(-0.0) is 0.0, NaN stays NaN.
                    is MilanoValue.DoubleValue -> MilanoValue.DoubleValue(kotlin.math.abs(v.value))

                    else -> MilanoValue.Null
                }
            }

            "min", "max" -> {
                extremum(builtin, arguments)
            }

            "floor", "ceil", "round" -> {
                (arguments[0] as? MilanoValue.DoubleValue)
                    ?.let { MilanoValue.DoubleValue(rounded(builtin, it.value)) } ?: MilanoValue.Null
            }

            "str" -> {
                when (val v = arguments[0]) {
                    is MilanoValue.BoolValue -> MilanoValue.StringValue(if (v.value) "true" else "false")
                    is MilanoValue.IntValue -> MilanoValue.StringValue(v.value.toString())
                    is MilanoValue.DoubleValue -> MilanoValue.StringValue(MilanoDoubleFormat.format(v.value))
                    is MilanoValue.StringValue -> v
                    else -> MilanoValue.Null
                }
            }

            "int" -> {
                val v = (arguments[0] as? MilanoValue.DoubleValue)?.value
                when {
                    v == null -> {
                        MilanoValue.Null
                    }

                    v.isNaN() -> {
                        report(MilanoOccurrence.Kind.SATURATION, null)
                        MilanoValue.IntValue(0)
                    }

                    v >= 9.223372036854776E18 -> {
                        report(MilanoOccurrence.Kind.SATURATION, null)
                        MilanoValue.IntValue(Long.MAX_VALUE)
                    }

                    v < -9.223372036854776E18 -> {
                        report(MilanoOccurrence.Kind.SATURATION, null)
                        MilanoValue.IntValue(Long.MIN_VALUE)
                    }

                    else -> {
                        MilanoValue.IntValue(v.toLong())
                    } // truncates toward zero
                }
            }

            "double" -> {
                (arguments[0] as? MilanoValue.IntValue)
                    ?.let { MilanoValue.DoubleValue(it.value.toDouble()) } ?: MilanoValue.Null
            }

            "concat" -> {
                MilanoValue.StringValue(arguments.joinToString("") { it.stringOrNull ?: "" })
            }

            "length" -> {
                when (val v = arguments[0]) {
                    is MilanoValue.StringValue -> {
                        MilanoValue.IntValue(v.value.unicodeScalarCount().toLong())
                    }

                    is MilanoValue.ArrayValue -> {
                        MilanoValue.IntValue(v.values.size.toLong())
                    }

                    else -> {
                        MilanoValue.Null
                    }
                }
            }

            "isEmpty" -> {
                when (val v = arguments[0]) {
                    is MilanoValue.StringValue -> MilanoValue.BoolValue(v.value.isEmpty())
                    is MilanoValue.ArrayValue -> MilanoValue.BoolValue(v.values.isEmpty())
                    else -> MilanoValue.Null
                }
            }

            "contains", "startsWith", "endsWith" -> {
                val haystack = arguments[0].stringOrNull
                val needle = arguments[1].stringOrNull
                if (haystack == null || needle == null) {
                    MilanoValue.Null
                } else {
                    MilanoValue.BoolValue(
                        when (builtin) {
                            "startsWith" -> haystack.startsWith(needle)
                            "endsWith" -> haystack.endsWith(needle)
                            else -> haystack.contains(needle)
                        },
                    )
                }
            }

            "trim" -> {
                val v = arguments[0].stringOrNull
                if (v == null) {
                    MilanoValue.Null
                } else {
                    var start = 0
                    var end = v.length
                    while (start < end && MilanoWhitespace.contains(v[start].code)) start += 1
                    while (end > start && MilanoWhitespace.contains(v[end - 1].code)) end -= 1
                    MilanoValue.StringValue(v.substring(start, end))
                }
            }

            "substring" -> {
                val subject = arguments[0].stringOrNull
                val from = arguments[1].intOrNull
                val to = arguments[2].intOrNull
                if (subject == null || from == null || to == null) {
                    MilanoValue.Null
                } else {
                    // The indices are int64 and clamp, so they may sit far
                    // outside anything an Int offset could hold.
                    MilanoValue.StringValue(subject.scalarSlice(clampIndex(from), clampIndex(to)))
                }
            }

            "indexOf" -> {
                val subject = arguments[0].stringOrNull
                val needle = arguments[1].stringOrNull
                if (subject == null || needle == null) {
                    MilanoValue.Null
                } else {
                    MilanoValue.IntValue(subject.scalarIndexOf(needle).toLong())
                }
            }

            "replace" -> {
                val subject = arguments[0].stringOrNull
                val needle = arguments[1].stringOrNull
                val replacement = arguments[2].stringOrNull
                if (subject == null || needle == null || replacement == null) {
                    MilanoValue.Null
                } else if (needle.isEmpty()) {
                    // An empty needle matches everywhere; returning the
                    // subject is what keeps the result bounded.
                    MilanoValue.StringValue(subject)
                } else {
                    MilanoValue.StringValue(subject.split(needle).joinToString(replacement))
                }
            }

            "split" -> {
                val subject = arguments[0].stringOrNull
                val separator = arguments[1].stringOrNull
                if (subject == null || separator == null) {
                    MilanoValue.Null
                } else {
                    // An empty separator would give one element per scalar,
                    // unbounded in the value size; one element is the answer.
                    val pieces =
                        if (separator.isEmpty()) listOf(subject) else subject.split(separator)
                    MilanoValue.ArrayValue(pieces.map { MilanoValue.StringValue(it) })
                }
            }

            "join" -> {
                val items = (arguments[0] as? MilanoValue.ArrayValue)?.values
                val separator = arguments[1].stringOrNull
                if (items == null || separator == null) {
                    MilanoValue.Null
                } else {
                    val pieces = items.map { it.stringOrNull }
                    if (pieces.any { it == null }) {
                        MilanoValue.Null
                    } else {
                        MilanoValue.StringValue(pieces.joinToString(separator) { it!! })
                    }
                }
            }

            else -> {
                MilanoValue.Null
            }
        }
    }

    /**
     * A host function call (expression spec, Host functions): the arguments
     * promoted to their declared types, the handler asked synchronously,
     * its answer validated against the declared return. A mismatch or a
     * throw is an invalid function result: reported, and the zero value of
     * the return type stands in, so evaluation stays total.
     */
    private fun hostCall(
        name: String,
        arguments: List<MilanoValue>,
        declared: MilanoVocabulary.Function,
    ): MilanoValue {
        val promoted =
            arguments.mapIndexed { index, value ->
                declared.arguments.getOrNull(index)?.validated(value) ?: value
            }

        fun invalid(found: String): MilanoValue {
            report(
                MilanoOccurrence.Kind.INVALID_FUNCTION_RESULT,
                ReportDetail(name, MilanoGate.name(declared.returns), found),
            )
            return zeroValueOf(declared.returns)
        }
        val handler = env.handler ?: return invalid("error")
        val answer =
            try {
                handler.call(MilanoFunctionCall(name, promoted)) ?: MilanoValue.Null
            } catch (_: Exception) {
                return invalid("error")
            }
        return declared.returns.validated(answer) ?: invalid(MilanoGate.name(answer))
    }

    /**
     * min and max per the expression spec: the first argument, replaced by
     * each later one that is strictly less (min) or greater (max), so ties
     * keep the leftmost and min(0.0, -0.0) is 0.0; all int stays int, any
     * double promotes every argument; a NaN anywhere is NaN. Never the
     * platform's min, which orders signed zeros and NaN its own way.
     */
    private fun extremum(
        name: String,
        arguments: List<MilanoValue>,
    ): MilanoValue {
        if (arguments.all { it is MilanoValue.IntValue }) {
            var best = (arguments[0] as MilanoValue.IntValue).value
            for (argument in arguments.drop(1)) {
                val value = (argument as MilanoValue.IntValue).value
                if (if (name == "min") value < best else value > best) best = value
            }
            return MilanoValue.IntValue(best)
        }
        val doubles = arguments.map { promoted(it) ?: Double.NaN }
        if (doubles.any { it.isNaN() }) return MilanoValue.DoubleValue(Double.NaN)
        var best = doubles[0]
        for (value in doubles.drop(1)) {
            if (if (name == "min") value < best else value > best) best = value
        }
        return MilanoValue.DoubleValue(best)
    }

    /**
     * floor, ceil, and round per the expression spec, IEEE 754 doubles in
     * and out: non-finite values pass through, round breaks ties away from
     * zero (never kotlin.math.round, which rounds half to even), and a zero
     * result keeps the argument's sign, so ceil(-0.5) and round(-0.4) are
     * -0.0.
     */
    private fun rounded(
        name: String,
        value: Double,
    ): Double {
        if (!value.isFinite()) return value
        val result =
            when (name) {
                "floor" -> {
                    kotlin.math.floor(value)
                }

                "ceil" -> {
                    kotlin.math.ceil(value)
                }

                else -> {
                    val truncated = kotlin.math.truncate(value)
                    if (kotlin.math.abs(value - truncated) >= 0.5) truncated + (if (value > 0) 1.0 else -1.0) else truncated
                }
            }
        return if (result == 0.0) (if (value < 0 || (value == 0.0 && 1.0 / value < 0)) -0.0 else 0.0) else result
    }
}

/**
 * An int64 index brought into an Int offset. Both of substring's indices
 * clamp into range anyway, so anything beyond Int is pinned at the ends.
 */
private fun clampIndex(value: Long): Int =
    when {
        value <= 0L -> 0
        value >= Int.MAX_VALUE.toLong() -> Int.MAX_VALUE
        else -> value.toInt()
    }
