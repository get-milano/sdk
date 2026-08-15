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

    /** A reserved root: state, context, or event. */
    data class Root(
        val name: String,
    ) : Expr()

    data class Member(
        val base: Expr,
        val field: String,
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
internal class ExprException(
    val detail: String,
) : Exception(detail)
