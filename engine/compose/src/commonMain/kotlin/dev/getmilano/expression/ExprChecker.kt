package dev.getmilano

// Type checking

/**
 * What a scoped scalar root (event, result, failure) means where an
 * expression appears: unavailable, or available with a declared type.
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
    private val resultScope: EventScope = EventScope.Unavailable,
    /** `$repeat` bindings in scope: the element and its index, by name. */
    private val bindings: Map<String, MilanoType> = emptyMap(),
    private val failureScope: EventScope = EventScope.Unavailable,
    /** The document's declared major.minor: gates the features it may use. */
    private val contract: Pair<Int, Int> = 2 to 1,
    /** The surface's declared host functions, by name. */
    private val functions: Map<String, MilanoVocabulary.Function> = emptyMap(),
    /** Every host function a checked expression called, for the gate. */
    private val used: MutableSet<String>? = null,
) {
    /** A function or root from a later minor than the document declares. */
    private fun gateFeature(name: String) {
        if (!MilanoContractFeatures.has(name, contract.first, contract.second)) {
            throw ExprFeatureException(name)
        }
    }

    /**
     * Infers the static type. Null means the null literal: typeless until
     * an expected type or an operator gives it one.
     */
    fun infer(
        expr: Expr,
        expecting: MilanoType? = null,
    ): MilanoType? =
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
                val expectedKind = expecting?.kind
                if (expectedKind is MilanoType.Kind.Enum) {
                    if (expr.value !in expectedKind.members) {
                        throw ExprException("'${expr.value}' is not a member of the declared enum")
                    }
                    MilanoType(expectedKind)
                } else {
                    MilanoType(MilanoType.Kind.Text)
                }
            }

            is Expr.Root -> {
                bindings[expr.name] ?: when (expr.name) {
                    "event" -> {
                        (eventScope as? EventScope.Payload)?.type
                            ?: throw ExprException("event is not available here")
                    }

                    "result" -> {
                        (resultScope as? EventScope.Payload)?.type
                            ?: throw ExprException("result is not available here")
                    }

                    "failure" -> {
                        gateFeature("failure")
                        (failureScope as? EventScope.Payload)?.type
                            ?: throw ExprException("failure is not available here")
                    }

                    else -> {
                        throw ExprException("unknown reference '${expr.name}'")
                    }
                }
            }

            is Expr.Lookup -> {
                // `record[key]` (contract 2.1): the field an enum key
                // names. The enum's members and the record's fields must
                // be the same set, which is what makes the lookup total
                // and its coverage exhaustive, and every field must share
                // one type, which is the lookup's.
                gateFeature("[]")
                val subject = infer(expr.base)
                val fields = (subject?.kind as? MilanoType.Kind.Record)?.fields
                if (subject == null || fields == null || subject.optional) {
                    throw ExprException("a lookup reads a non-optional record")
                }
                val key = infer(expr.key)
                val members = (key?.kind as? MilanoType.Kind.Enum)?.members
                if (key == null || members == null || key.optional) {
                    throw ExprException("a lookup's key is a non-optional enum")
                }
                if (members != fields.keys) {
                    throw ExprException(
                        "a lookup's enum members and the record's fields must match",
                    )
                }
                val first = fields.values.first()
                if (fields.values.any { it != first }) {
                    throw ExprException("a lookup's record fields must share one type")
                }
                first
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
                inferCall(expr.name, expr.arguments, expecting)
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
                inferBinary(expr.op, expr.left, expr.right, expecting)
            }
        }

    /**
     * Whether [actual] is accepted where [expected] is declared: same kind
     * (member-set equality for enums), T where T? is expected, int where
     * double is expected, an enum where string is expected (widening), and
     * the null literal where any optional is expected.
     */
    fun accepts(
        expected: MilanoType,
        actual: MilanoType?,
    ): Boolean {
        if (actual == null) return expected.optional
        if (actual.optional && !expected.optional) return false
        if (actual.kind == expected.kind) return true
        if (actual.kind is MilanoType.Kind.Int && expected.kind is MilanoType.Kind.Double) return true
        if (actual.kind is MilanoType.Kind.Enum && expected.kind is MilanoType.Kind.Text) return true
        return false
    }

    private fun isStringLike(kind: MilanoType.Kind) = kind is MilanoType.Kind.Text || kind is MilanoType.Kind.Enum

    private fun inferCall(
        name: String,
        arguments: List<Expr>,
        expecting: MilanoType? = null,
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

        fun isNumeric(kind: MilanoType.Kind) = kind is MilanoType.Kind.Int || kind is MilanoType.Kind.Double

        // A bare name is a host function the surface declares; the
        // contract's own functions are called through `$` and cannot be
        // shadowed (expression spec, Host functions).
        if (!name.startsWith('$')) {
            val declared = functions[name] ?: throw ExprException("unknown function '$name'")
            // A host function (expression spec, Host functions): exactly
            // the declared arity, each argument a declared position, the
            // call typed as the declared return. Under an earlier contract
            // the call is the contract-feature violation named after it.
            if (!MilanoContractFeatures.has("functions", contract.first, contract.second)) {
                throw ExprFeatureException(name, MilanoContractFeatures.versionOf("functions"))
            }
            requireCount(declared.arguments.size)
            for ((index, argumentType) in declared.arguments.withIndex()) {
                val inferred = infer(arguments[index], argumentType)
                if (!accepts(argumentType, inferred)) {
                    throw ExprException("$name argument $index must be ${MilanoGate.name(argumentType)}")
                }
            }
            used?.add(name)
            return declared.returns
        }
        // Every built-in a later minor introduced is gated here, once.
        gateFeature(name)

        // A val, so the branches below can test it directly.
        val builtin = name.substring(1)
        return when (builtin) {
            "abs" -> {
                // The magnitude keeps its numeric type: int to int, double to
                // double (expression spec, Functions).
                requireCount(1)
                val type = nonOptional(0, "number")
                if (!isNumeric(type.kind)) throw ExprException("abs needs a number")
                type
            }

            "min", "max" -> {
                // Two or more numeric arguments, promoting like the arithmetic
                // operators: all int stays int, any double makes it double.
                if (arguments.size < 2) throw ExprException("$name takes 2 or more arguments")
                var anyDouble = false
                for (index in arguments.indices) {
                    val type = nonOptional(index, "number")
                    if (!isNumeric(type.kind)) throw ExprException("$name needs numbers")
                    if (type.kind is MilanoType.Kind.Double) anyDouble = true
                }
                MilanoType(if (anyDouble) MilanoType.Kind.Double else MilanoType.Kind.Int)
            }

            "floor", "ceil", "round" -> {
                // Exactly a double, like int() and double(): the promotion of
                // an int expression applies to declared positions, never to a
                // function's argument.
                requireCount(1)
                if (nonOptional(0, "double").kind !is MilanoType.Kind.Double) {
                    throw ExprException("$name needs a double")
                }
                MilanoType(MilanoType.Kind.Double)
            }

            "str" -> {
                requireCount(1)
                when (nonOptional(0, "scalar").kind) {
                    is MilanoType.Kind.Bool, is MilanoType.Kind.Int,
                    is MilanoType.Kind.Double, is MilanoType.Kind.Text,
                    is MilanoType.Kind.Enum,
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
                    if (!isStringLike(nonOptional(index, "string").kind)) {
                        throw ExprException("concat needs strings")
                    }
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "length", "isEmpty" -> {
                requireCount(1)
                when (nonOptional(0, "string or array").kind) {
                    is MilanoType.Kind.Text, is MilanoType.Kind.Enum, is MilanoType.Kind.Array -> {
                        MilanoType(if (builtin == "length") MilanoType.Kind.Int else MilanoType.Kind.Bool)
                    }

                    else -> {
                        throw ExprException("$name needs a string or array")
                    }
                }
            }

            "contains", "startsWith", "endsWith" -> {
                requireCount(2)
                if (!isStringLike(nonOptional(0, "string").kind) ||
                    !isStringLike(nonOptional(1, "string").kind)
                ) {
                    throw ExprException("$name needs strings")
                }
                MilanoType(MilanoType.Kind.Bool)
            }

            "trim" -> {
                requireCount(1)
                if (!isStringLike(nonOptional(0, "string").kind)) {
                    throw ExprException("trim needs a string")
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "substring" -> {
                requireCount(3)
                if (!isStringLike(nonOptional(0, "string").kind)) {
                    throw ExprException("substring needs a string")
                }
                for (index in 1..2) {
                    if (nonOptional(index, "int").kind !is MilanoType.Kind.Int) {
                        throw ExprException("substring needs int indices")
                    }
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "indexOf" -> {
                requireCount(2)
                if (!isStringLike(nonOptional(0, "string").kind) ||
                    !isStringLike(nonOptional(1, "string").kind)
                ) {
                    throw ExprException("indexOf needs strings")
                }
                MilanoType(MilanoType.Kind.Int)
            }

            "replace" -> {
                requireCount(3)
                for (index in 0..2) {
                    if (!isStringLike(nonOptional(index, "string").kind)) {
                        throw ExprException("replace needs strings")
                    }
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "split" -> {
                requireCount(2)
                if (!isStringLike(nonOptional(0, "string").kind) ||
                    !isStringLike(nonOptional(1, "string").kind)
                ) {
                    throw ExprException("split needs strings")
                }
                MilanoType(MilanoType.Kind.Array(MilanoType(MilanoType.Kind.Text)))
            }

            "join" -> {
                requireCount(2)
                // The element type is what matters: an array of enum joins
                // by member string, since an enum widens to string.
                val subject = nonOptional(0, "array of string").kind
                val element = (subject as? MilanoType.Kind.Array)?.element
                if (element == null || element.optional || !isStringLike(element.kind)) {
                    throw ExprException("join needs an array of string")
                }
                if (!isStringLike(nonOptional(1, "string").kind)) {
                    throw ExprException("join needs a string separator")
                }
                MilanoType(MilanoType.Kind.Text)
            }

            "if" -> {
                requireCount(3)
                if (nonOptional(0, "bool").kind !is MilanoType.Kind.Bool) {
                    throw ExprException("if needs a bool condition")
                }
                val thenType = infer(arguments[1], expecting)
                val elseType = infer(arguments[2], expecting)
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
                throw ExprException("unknown built-in function '$name'")
            }
        }
    }

    private fun inferBinary(
        op: BinaryOp,
        left: Expr,
        right: Expr,
        expecting: MilanoType? = null,
    ): MilanoType? {
        fun isNumeric(kind: MilanoType.Kind) = kind is MilanoType.Kind.Int || kind is MilanoType.Kind.Double

        fun isScalar(kind: MilanoType.Kind) =
            when (kind) {
                is MilanoType.Kind.Bool, is MilanoType.Kind.Int,
                is MilanoType.Kind.Double, is MilanoType.Kind.Text,
                is MilanoType.Kind.Enum,
                -> true

                else -> false
            }

        return when (op) {
            BinaryOp.COALESCE -> {
                val leftType = infer(left, expecting)
                val rightType = infer(right, expecting)
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
                checkEnumComparison(l, r, left, right)
                if (l.kind != r.kind && !(isNumeric(l.kind) && isNumeric(r.kind)) &&
                    !isEnumStringPair(l.kind, r.kind)
                ) {
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
                    isStringLike(l.kind) && isStringLike(r.kind)
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

    /**
     * Enum comparison rules: a string-literal operand must be a member;
     * two enums must be the same enum; a non-literal string compares as a
     * string (the enum widens).
     */
    private fun checkEnumComparison(
        l: MilanoType,
        r: MilanoType,
        left: Expr,
        right: Expr,
    ) {
        val lKind = l.kind
        if (lKind !is MilanoType.Kind.Enum) {
            if (r.kind is MilanoType.Kind.Enum) checkEnumComparison(r, l, right, left)
            return
        }
        if (r.kind is MilanoType.Kind.Enum) {
            if (l.kind != r.kind) throw ExprException("distinct enum types are not comparable")
            return
        }
        if (right is Expr.StringLiteral && right.value !in lKind.members) {
            throw ExprException("'${right.value}' is not a member of the declared enum")
        }
    }

    private fun isEnumStringPair(
        a: MilanoType.Kind,
        b: MilanoType.Kind,
    ): Boolean =
        (a is MilanoType.Kind.Enum && b is MilanoType.Kind.Text) ||
            (a is MilanoType.Kind.Text && b is MilanoType.Kind.Enum)
}
