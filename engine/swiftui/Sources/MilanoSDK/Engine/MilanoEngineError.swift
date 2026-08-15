import Foundation

/// Engine-creation errors, per the vocabulary schema spec. These arise at
/// engine creation only; they can never occur at the gate or later.
public enum MilanoEngineError: Error, Equatable, Sendable {
    /// The vocabulary artifact violates the vocabulary schema spec.
    /// `rule` names the violated rule; `detail` says where or what.
    case invalidVocabulary(rule: String, detail: String)
    /// A declared component type has no registered renderer, or the
    /// placeholder policy is the engine default with no placeholder
    /// renderer registered. Lists what is missing.
    case incompleteRegistry(missing: [String])
}
