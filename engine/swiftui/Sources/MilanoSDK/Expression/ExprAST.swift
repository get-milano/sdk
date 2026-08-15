import Foundation

/// The expression AST, per the expression language spec's EBNF.
indirect enum Expr: Equatable, Sendable {
    case nullLiteral
    case boolLiteral(Bool)
    case intLiteral(Int64)
    case doubleLiteral(Double)
    case stringLiteral(String)
    /// A reserved root: `state`, `context`, or `event`.
    case root(String)
    case member(Expr, String)
    case call(String, [Expr])
    case unary(UnaryOp, Expr)
    case binary(BinaryOp, Expr, Expr)
}

enum UnaryOp: Equatable, Sendable { case not, negate }

enum BinaryOp: Equatable, Sendable {
    case multiply, divide, modulo
    case add, subtract
    case less, lessEqual, greater, greaterEqual
    case equal, notEqual
    case and, or
    case coalesce
}

/// A static expression error, mapped to SchemaViolation at the gate.
struct ExprError: Error {
    let detail: String
}
