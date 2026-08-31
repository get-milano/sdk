import Foundation

/// A document value: a literal of the type system, an unchecked expression
/// (the `$expr` wrapper, straight from parsing), or a gate-checked
/// expression carrying its AST and the declared type it must produce.
enum DocValue: Equatable, Sendable {
    case literal(MilanoValue)
    case expression(String)
    case typedExpression(source: String, expr: Expr, expected: MilanoType)
}

/// An array action as parsed, before the gate (contract 2.1): every
/// parameter as the document carried it (nil when absent), plus the keys
/// the action does not take. The gate replaces it by one of the three
/// validated `ActionSpec` cases.
struct ArrayActionSpec: Equatable, Sendable {
    /// `$append`, `$remove`, or `$update`.
    let name: String
    let key: String?
    let at: DocValue?
    let field: String?
    /// The kind of a `field` that is present but not a string.
    let fieldFound: String?
    let value: DocValue?
    /// The keys the action does not take, sorted.
    let extra: [String]
}

/// A parsed action, per the document model spec's action encoding.
indirect enum ActionSpec: Equatable, Sendable {
    case set(key: String, value: DocValue)
    /// An array action before the gate validated it.
    case arrayAction(ArrayActionSpec)
    case append(key: String, value: DocValue)
    case remove(key: String, at: DocValue)
    case update(key: String, at: DocValue, field: String, value: DocValue)
    case sequence([ActionSpec])
    case when(condition: DocValue, then: [ActionSpec], otherwise: [ActionSpec])
    case custom(
        name: String, parameters: [String: DocValue],
        onSuccess: [ActionSpec], onFailure: [ActionSpec],
        result: MilanoType?, failure: MilanoType?)
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
    /// Present exactly when `type` is `$repeat`.
    var repeatSpec: RepeatSpec?
    /// Present exactly when `type` is `$if`.
    var conditionalSpec: ConditionalSpec?
    /// Present exactly when `type` is `$switch`.
    var switchSpec: SwitchSpec?
}

/// The `$switch` construct's own keys, as parsed: the enum subject and one
/// node list per member, plus the list every uncovered member takes.
struct SwitchSpec: Sendable {
    let subject: DocValue?
    let cases: [String: [RawNode]]?
    let fallback: [RawNode]?
    let hasFallback: Bool
    /// Keys the construct does not declare, so the gate can name one.
    let undeclared: [String]
}

/// The `$if` construct's own keys, as parsed: the condition (a value the
/// gate requires to be a bool expression) and the two branches. A branch
/// absent is nil and one written empty is an empty array: the first is how
/// a document says nothing happens, the second is an encoding violation.
struct ConditionalSpec: Sendable {
    let condition: DocValue?
    let then: [RawNode]?
    let otherwise: [RawNode]?
    /// Keys the construct does not declare, so the gate can name one.
    let undeclared: [String]
}

/// The `$repeat` construct's own keys, as parsed: `items` (a value, which
/// the gate requires to be an array expression), `as` (the binding name),
/// and `key` (contract 2.1: a value the gate requires to be a string or
/// int expression). Nil where the document omitted them; the gate reports.
struct RepeatSpec: Sendable {
    let items: DocValue?
    let `as`: String?
    var key: DocValue?
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
    /// The document's lifecycle bindings (contract 2.1), as parsed: signal
    /// name to action list. The gate rules on the names.
    var lifecycle: [String: [ActionSpec]] = [:]
    /// Whether the document carried an `on` section at all, for gating.
    var hasLifecycle = false
    /// The document's watch bindings (contract 2.1), as parsed: state key
    /// to action list. The gate rules on the keys.
    var watch: [String: [ActionSpec]] = [:]
    /// Whether the document carried a `watch` section at all, for gating.
    var hasWatch = false
    let metadata: MilanoValue?
}
