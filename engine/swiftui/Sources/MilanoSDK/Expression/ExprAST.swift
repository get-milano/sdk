import Foundation

/// The expression AST, per the expression language spec's EBNF.
indirect enum Expr: Equatable, Sendable {
    case nullLiteral
    case boolLiteral(Bool)
    case intLiteral(Int64)
    case doubleLiteral(Double)
    case stringLiteral(String)
    /// A reserved root: `state`, `context`, `event`, `result`, or `failure`.
    case root(String)
    case member(Expr, String)
    /// `record[key]`: the field an enum key names (contract 2.1).
    case lookup(Expr, Expr)
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

/// A function or root that a later minor than the document declares
/// introduced: the gate surfaces it as the `contract-feature` rule, named
/// after the feature and carrying the version it needs, rather than as an
/// ordinary expression defect.
struct ExprFeatureError: Error {
    let feature: String
    /// The `contract-feature` detail's spelling of the version: "2.1".
    let version: String
}

/// The contract version that introduced each feature a document or a
/// vocabulary may use, by the name the `contract-feature` detail carries
/// (document model spec, Validation). A document declaring an earlier
/// minor of the same major may not use it.
enum MilanoContractFeatures {
    static let introduced: [String: (major: Int, minor: Int)] = [
        "key": (2, 1), "on": (2, 1), "failure": (2, 1),
        "$abs": (2, 1), "$min": (2, 1), "$max": (2, 1),
        "$floor": (2, 1), "$ceil": (2, 1), "$round": (2, 1),
        "watch": (2, 1), "functions": (2, 1),
        "$append": (2, 1), "$remove": (2, 1), "$update": (2, 1),
        "$substring": (2, 1), "$indexOf": (2, 1), "$replace": (2, 1),
        "$split": (2, 1), "$join": (2, 1), "$switchConstruct": (2, 1),
        // A lookup has no name; `[]` is how a document spells it.
        "[]": (2, 1),
        // The construct, in its own key: `$if` is also a function, and
        // that one has been in the contract since 1.0.
        "$ifConstruct": (2, 1)
    ]

    /// Whether a document declaring `major.minor` has the named feature.
    static func has(_ name: String, major: Int, minor: Int) -> Bool {
        guard let since = introduced[name] else { return true }
        return major > since.major || (major == since.major && minor >= since.minor)
    }

    /// The `contract-feature` detail's spelling of the version a feature needs: "2.1".
    static func version(of name: String) -> String {
        guard let since = introduced[name] else { return "0.0" }
        return "\(since.major).\(since.minor)"
    }
}
