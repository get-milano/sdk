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
        onSuccess: [ActionSpec], onFailure: [ActionSpec],
        result: MilanoType?)
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
/// Parses "major.minor.patch" into a comparable triple; nil when malformed.
func parseSemver(_ text: String) -> (Int, Int, Int)? {
    let parts = text.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, let major = Int(parts[0]), let minor = Int(parts[1]),
        let patch = Int(parts[2]), major >= 0, minor >= 0, patch >= 0
    else { return nil }
    return (major, minor, patch)
}

/// The document's optional vocabulary requirement, checked at the gate
/// against the engine's vocabulary (name equality, version at least min).
struct VocabularyRequirement: Sendable {
    let name: String
    let min: String?
}

struct ParsedDocument: Sendable {
    let versionString: String
    let major: Int
    let minor: Int
    let vocabularyRequirement: VocabularyRequirement?
    let contextDeclarations: [String: MilanoType]
    let stateDeclarations: [String: MilanoType]
    let root: RawNode
    let metadata: MilanoValue?
}
