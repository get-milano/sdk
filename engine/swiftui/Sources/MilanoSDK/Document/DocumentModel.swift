import Foundation

/// A document value: a literal of the type system, an unchecked expression
/// (the `$expr` wrapper, straight from parsing), or a gate-checked
/// expression carrying its AST and the declared type it must produce.
enum DocValue: Equatable, Sendable {
    case literal(MilanoValue)
    case expression(String)
    case typedExpression(source: String, expr: Expr, expected: MilanoType)
}

/// A parsed action, per the document model spec's action encoding.
indirect enum ActionSpec: Equatable, Sendable {
    case set(key: String, value: DocValue)
    case sequence([ActionSpec])
    case when(condition: DocValue, then: [ActionSpec], otherwise: [ActionSpec])
    case custom(
        name: String, parameters: [String: DocValue],
        onSuccess: [ActionSpec], onFailure: [ActionSpec])
}

/// A parsed node envelope, before vocabulary validation.
struct RawNode: Sendable {
    let type: String
    let id: String?
    let properties: [String: DocValue]
    let children: [RawNode]
    let events: [String: [ActionSpec]]
    /// The node's whole subtree as raw data, kept for the placeholder policy.
    let raw: MilanoValue
}

/// A parsed document: structure and declarations only, never data values.
struct ParsedDocument: Sendable {
    let versionString: String
    let major: Int
    let minor: Int
    let contextDeclarations: [String: MilanoType]
    let stateDeclarations: [String: MilanoType]
    let localActions: [String: MilanoVocabulary.Action]
    let root: RawNode
    let metadata: MilanoValue?
}
