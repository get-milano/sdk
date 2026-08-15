package dev.getmilano

// Type checking

/**
 * What the event root means where an expression appears: unavailable
 * (property expressions), or available with a payload type.
 */
internal sealed class EventScope {
    data object Unavailable : EventScope()

    data class Payload(
        val type: MilanoType,
    ) : EventScope()
}

internal class ExprChecker(
    private val state: Map<String, MilanoType>,
    private val context: Map<String, MilanoType>,
    private val eventScope: EventScope,
) {
    /**
     * Infers the static type. Null means the null literal: typeless until
     * an expected type or an operator gives it one.
     */
    fun infer(expr: Expr): MilanoType? =
        when (expr) {
            is Expr.NullLiteral -> {
                null
            }

            is Expr.BoolLiteral -> {
                MilanoType(MilanoType.Kind.Bool)
            }

            is Expr.IntLiteral -> {
                MilanoType(MilanoType.Kind.Int)
            }

            is Expr.DoubleLiteral -> {
                MilanoType(MilanoType.Kind.Double)
            }

            is Expr.StringLiteral -> {
                MilanoType(MilanoType.Kind.Text)
            }

            is Expr.Root -> {
                when (expr.name) {
                    "event" -> {
                        (eventScope as? EventScope.Payload)?.type
                            ?: throw ExprException("event is not available here")
                    }

                    else -> {
                        throw ExprException("unknown reference '${expr.name}'")
                    }
                }
            }

            is Expr.Member -> {
                val base = expr.base
                if (base is Expr.Root && (base.name == "state" || base.name == "context")) {
                    val declarations = if (base.name == "state") state else context
                    declarations[expr.field]
                        ?: throw ExprException("unknown ${base.name} key '${expr.field}'")
                } else {
                    val baseType =
                        infer(base)
                            ?: throw ExprException("field access on a non-record")
                    val fields =
                        (baseType.kind as? MilanoType.Kind.Record)?.fields
                            ?: throw ExprException("field access on a non-record")
                    if (baseType.optional) {
                        throw ExprException("field access on an optional record; resolve with ?? first")
                    }
                    fields[expr.field] ?: throw ExprException("unknown field '${expr.field}'")
                }
            }

            is Expr.Call -> {
                inferCall(expr.name, expr.arguments)
            }

            is Expr.Unary -> {
                val type = infer(expr.operand)
                if (type == null || type.optional) throw ExprException("unary operator on null or optional")
                when (expr.op) {
                    UnaryOp.NOT -> {
                        if (type.kind !is MilanoType.Kind.Bool) throw ExprException("! needs bool")
                        type
                    }

                    UnaryOp.NEGATE -> {
                        if (type.kind !is MilanoType.Kind.Int && type.kind !is MilanoType.Kind.Double) {
                            throw ExprException("unary - needs a number")
                        }
                        type
                    }
                }
            }

            is Expr.Binary -> {
                inferBinary(expr.op, expr.left, expr.right)
            }
        }

    /**
     * Whether [actual] is accepted where [expected] is declared: same kind,
     * T where T? is expected, int where double is expected, and the null
     * literal where any optional is expected.
     */
    fun accepts(
        expected: MilanoType,
        actual: MilanoType?,
    ): Boolean {
        if (actual == null) return expected.optional
        if (actual.optional && !expected.optional) return false
        if (actual.kind == expected.kind) return true
        if (actual.kind is MilanoType.Kind.Int && expected.kind is MilanoType.Kind.Double) return true
        return false
    }

    private fun inferCall(
        name: String,
        arguments: List<Expr>,
    ): MilanoType? {
        fun requireCount(count: Int) {
            if (arguments.size != count) throw ExprException("$name takes $count argument(s)")
        }

        fun nonOptional(
            index: Int,
            what: String,
        ): MilanoType {
            val type = infer(arguments[index])
            if (type == null || type.optional) throw ExprException("$name needs a non-optional $what")
            return type
        }

        return when (name) {
            "str" -> {
                requireCount(1)
                when (nonOptional(0, "scalar").kind) {
                    is MilanoType.Kind.Bool, is MilanoType.Kind.Int,
                    is MilanoType.Kind.Double, is MilanoType.Kind.Text,
                    -> MilanoType(MilanoType.Kind.Text)

                    else -> throw ExprException("str needs a scalar")
                }
            }

            "int" -> {
                requireCount(1)
                if (nonOptional(0, "double").kind !is MilanoType.Kind.Double) {
                    throw ExprException("int needs a double")
                }
                MilanoType(MilanoType.Kind.Int)
            }

            "double" -> {
                requireCount(1)
                if (nonOptional(0, "int").kind !is MilanoType.Kind.Int) {
                    throw ExprException("double needs an int")
                }
                MilanoType(MilanoType.Kind.Double)
            }

            "concat" -> {
                if (arguments.size < 2) throw ExprException("concat takes 2 or more arguments")
                for (index in arguments.indices) {
                    if (nonOptional(index, "string").kind !is MilanoType.Kind.Text) {
                        throw ExprException("concat needs strings")
                    }
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "length", "isEmpty" -> {
                requireCount(1)
                when (nonOptional(0, "string or array").kind) {
                    is MilanoType.Kind.Text, is MilanoType.Kind.Array -> {
                        MilanoType(if (name == "length") MilanoType.Kind.Int else MilanoType.Kind.Bool)
                    }

                    else -> {
                        throw ExprException("$name needs a string or array")
                    }
                }
            }

            "contains", "startsWith", "endsWith" -> {
                requireCount(2)
                if (nonOptional(0, "string").kind !is MilanoType.Kind.Text ||
                    nonOptional(1, "string").kind !is MilanoType.Kind.Text
                ) {
                    throw ExprException("$name needs strings")
                }
                MilanoType(MilanoType.Kind.Bool)
            }

            "trim" -> {
                requireCount(1)
                if (nonOptional(0, "string").kind !is MilanoType.Kind.Text) {
                    throw ExprException("trim needs a string")
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "if" -> {
                requireCount(3)
                if (nonOptional(0, "bool").kind !is MilanoType.Kind.Bool) {
                    throw ExprException("if needs a bool condition")
                }
                val thenType = infer(arguments[1])
                val elseType = infer(arguments[2])
                when {
                    thenType == null && elseType == null -> {
                        throw ExprException("if branches cannot both be null")
                    }

                    thenType == null -> {
                        MilanoType(elseType!!.kind, optional = true)
                    }

                    elseType == null -> {
                        MilanoType(thenType.kind, optional = true)
                    }

                    thenType == elseType -> {
                        thenType
                    }

                    else -> {
                        throw ExprException("if branches must have the same type")
                    }
                }
            }

            else -> {
                throw ExprException("unknown function '$name'")
            }
        }
    }

    private fun inferBinary(
        op: BinaryOp,
        left: Expr,
        right: Expr,
    ): MilanoType? {
        fun isNumeric(kind: MilanoType.Kind) = kind is MilanoType.Kind.Int || kind is MilanoType.Kind.Double

        fun isScalar(kind: MilanoType.Kind) =
            when (kind) {
                is MilanoType.Kind.Bool, is MilanoType.Kind.Int,
                is MilanoType.Kind.Double, is MilanoType.Kind.Text,
                -> true

                else -> false
            }

        return when (op) {
            BinaryOp.COALESCE -> {
                val leftType = infer(left)
                val rightType = infer(right)
                if (rightType == null || rightType.optional) {
                    throw ExprException("?? right side must be non-optional")
                }
                if (leftType == null) return rightType // null ?? x
                if (!leftType.optional || leftType.kind != rightType.kind) {
                    throw ExprException("?? needs optional T and T of the same kind")
                }
                rightType
            }

            BinaryOp.AND, BinaryOp.OR -> {
                val l = infer(left)
                val r = infer(right)
                if (l == null || r == null || l.optional || r.optional ||
                    l.kind !is MilanoType.Kind.Bool || r.kind !is MilanoType.Kind.Bool
                ) {
                    throw ExprException("logical operators need bool")
                }
                MilanoType(MilanoType.Kind.Bool)
            }

            BinaryOp.EQUAL, BinaryOp.NOT_EQUAL -> {
                val l = infer(left)
                val r = infer(right)
                if (l == null || r == null) {
                    val other = l ?: r
                    if (other == null || !other.optional) {
                        throw ExprException("only optionals compare to null")
                    }
                    return MilanoType(MilanoType.Kind.Bool)
                }
                if (!isScalar(l.kind) || !isScalar(r.kind)) {
                    throw ExprException("arrays and records are not comparable")
                }
                if (l.kind != r.kind && !(isNumeric(l.kind) && isNumeric(r.kind))) {
                    throw ExprException("equality needs matching scalar types")
                }
                if (l.optional || r.optional) {
                    throw ExprException("resolve optionals with ?? before comparing values")
                }
                MilanoType(MilanoType.Kind.Bool)
            }

            BinaryOp.LESS, BinaryOp.LESS_EQUAL, BinaryOp.GREATER, BinaryOp.GREATER_EQUAL -> {
                val l = infer(left)
                val r = infer(right)
                if (l == null || r == null || l.optional || r.optional ||
                    !isNumeric(l.kind) || !isNumeric(r.kind)
                ) {
                    throw ExprException("ordering needs numbers")
                }
                MilanoType(MilanoType.Kind.Bool)
            }

            BinaryOp.ADD, BinaryOp.SUBTRACT, BinaryOp.MULTIPLY, BinaryOp.DIVIDE, BinaryOp.MODULO -> {
                val l = infer(left)
                val r = infer(right)
                if (op == BinaryOp.ADD && l != null && r != null && !l.optional && !r.optional &&
                    l.kind is MilanoType.Kind.Text && r.kind is MilanoType.Kind.Text
                ) {
                    return MilanoType(MilanoType.Kind.Text)
                }
                if (l == null || r == null || l.optional || r.optional ||
                    !isNumeric(l.kind) || !isNumeric(r.kind)
                ) {
                    throw ExprException("arithmetic needs numbers")
                }
                if (l.kind is MilanoType.Kind.Double || r.kind is MilanoType.Kind.Double) {
                    MilanoType(MilanoType.Kind.Double)
                } else {
                    MilanoType(MilanoType.Kind.Int)
                }
            }
        }
    }
}
