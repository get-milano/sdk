package dev.getmilano

// Evaluation

/**
 * Total evaluation: after the gate, this cannot fail. Division by zero and
 * saturation report occurrences through [report].
 */
internal class ExprEvaluator(
    private val state: Map<String, MilanoValue>,
    private val context: Map<String, MilanoValue>,
    private val event: MilanoValue?,
    private val result: MilanoValue? = null,
    private val report: (MilanoOccurrence.Kind) -> Unit,
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
                when (expr.name) {
                    "event" -> event ?: MilanoValue.Null
                    "result" -> result ?: MilanoValue.Null
                    else -> MilanoValue.Null
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
                if (expr.name == "if") {
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
                        report(MilanoOccurrence.Kind.DIVISION_BY_ZERO)
                        MilanoValue.IntValue(0)
                    } else if (l == Long.MIN_VALUE && r == -1L) {
                        MilanoValue.IntValue(Long.MIN_VALUE) // wraps
                    } else {
                        MilanoValue.IntValue(l / r)
                    }
                }

                BinaryOp.MODULO -> {
                    if (r == 0L) {
                        report(MilanoOccurrence.Kind.DIVISION_BY_ZERO)
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
    ): MilanoValue =
        when (name) {
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
                        report(MilanoOccurrence.Kind.SATURATION)
                        MilanoValue.IntValue(0)
                    }

                    v >= 9.223372036854776E18 -> {
                        report(MilanoOccurrence.Kind.SATURATION)
                        MilanoValue.IntValue(Long.MAX_VALUE)
                    }

                    v < -9.223372036854776E18 -> {
                        report(MilanoOccurrence.Kind.SATURATION)
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
                        when (name) {
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

            else -> {
                MilanoValue.Null
            }
        }
}
