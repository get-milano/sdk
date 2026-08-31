package dev.getmilano

/** The expression AST, per the expression language spec's EBNF. */
internal sealed class Expr {
    data object NullLiteral : Expr()

    data class BoolLiteral(
        val value: Boolean,
    ) : Expr()

    data class IntLiteral(
        val value: Long,
    ) : Expr()

    data class DoubleLiteral(
        val value: Double,
    ) : Expr()

    data class StringLiteral(
        val value: String,
    ) : Expr()

    /** A reserved root: state, context, event, result, or failure. */
    data class Root(
        val name: String,
    ) : Expr()

    data class Member(
        val base: Expr,
        val field: String,
    ) : Expr()

    /** `record[key]`: the field an enum key names (contract 2.1). */
    data class Lookup(
        val base: Expr,
        val key: Expr,
    ) : Expr()

    data class Call(
        val name: String,
        val arguments: List<Expr>,
    ) : Expr()

    data class Unary(
        val op: UnaryOp,
        val operand: Expr,
    ) : Expr()

    data class Binary(
        val op: BinaryOp,
        val left: Expr,
        val right: Expr,
    ) : Expr()
}

internal enum class UnaryOp { NOT, NEGATE }

internal enum class BinaryOp {
    MULTIPLY,
    DIVIDE,
    MODULO,
    ADD,
    SUBTRACT,
    LESS,
    LESS_EQUAL,
    GREATER,
    GREATER_EQUAL,
    EQUAL,
    NOT_EQUAL,
    AND,
    OR,
    COALESCE,
}

/** A static expression error, mapped to SchemaViolation at the gate. */
internal open class ExprException(
    val detail: String,
) : Exception(detail)

/**
 * A function or root that a later minor than the document declares
 * introduced: the gate surfaces it as the `contract-feature` rule, named
 * after the feature, rather than as an ordinary expression defect.
 */
internal class ExprFeatureException(
    val feature: String,
    /**
     * The `contract-feature` detail's version: the feature's own, or that
     * of the family it belongs to (a host function call needs `functions`).
     */
    val version: String = MilanoContractFeatures.versionOf(feature),
) : ExprException("$feature needs contract $version")

/**
 * The contract version that introduced each feature a document or a
 * vocabulary may use, by the name the `contract-feature` detail carries
 * (document model spec, Validation). A document declaring an earlier
 * minor of the same major may not use it.
 */
internal object MilanoContractFeatures {
    private val introduced: Map<String, Pair<Int, Int>> =
        mapOf(
            "key" to (2 to 1),
            "on" to (2 to 1),
            "failure" to (2 to 1),
            "\$abs" to (2 to 1),
            "\$min" to (2 to 1),
            "\$max" to (2 to 1),
            "\$floor" to (2 to 1),
            "\$ceil" to (2 to 1),
            "\$round" to (2 to 1),
            "watch" to (2 to 1),
            "functions" to (2 to 1),
            "\$append" to (2 to 1),
            "\$remove" to (2 to 1),
            "\$update" to (2 to 1),
            "\$substring" to (2 to 1),
            "\$indexOf" to (2 to 1),
            "\$replace" to (2 to 1),
            "\$split" to (2 to 1),
            "\$join" to (2 to 1),
            // The construct, in its own key: `${'$'}if` is also a function, and
            // that one has been in the contract since 1.0.
            "\$ifConstruct" to (2 to 1),
            "\$switchConstruct" to (2 to 1),
            // A lookup has no name; `[]` is how a document spells it.
            "[]" to (2 to 1),
        )

    /** Whether a document declaring `major.minor` has the named feature. */
    fun has(
        name: String,
        major: Int,
        minor: Int,
    ): Boolean {
        val (sinceMajor, sinceMinor) = introduced[name] ?: return true
        return major > sinceMajor || (major == sinceMajor && minor >= sinceMinor)
    }

    /** The `contract-feature` detail's spelling of the version a feature needs: "2.1". */
    fun versionOf(name: String): String {
        val (major, minor) = introduced[name] ?: return "0.0"
        return "$major.$minor"
    }
}
