import Foundation

/// The instantiable root of the framework. An engine holds one
/// configuration: the vocabulary, the registry, the default unknown-type
/// policy, and resource limits. It is immutable after creation and safe to
/// share across threads. MilanoViewBuilders are obtained from an engine,
/// so every MilanoView is traceable to exactly one configuration.
public final class MilanoEngine: @unchecked Sendable {
    let vocabulary: MilanoVocabulary
    let registry: MilanoRegistry
    public let defaultUnknownTypePolicy: MilanoUnknownTypePolicy
    public let limits: MilanoLimits
    weak var observer: MilanoObserver?

    /// Creates an engine, validating everything and failing fast on
    /// developer mistakes:
    /// - `MilanoEngineError.invalidVocabulary` when the artifact violates the
    ///   vocabulary schema spec.
    /// - `MilanoEngineError.incompleteRegistry` when a declared component
    ///   type has no registered renderer, or the default policy is
    ///   `.placeholder` with no placeholder renderer registered.
    public init(
        vocabularyJSON: Data,
        registry: MilanoRegistry,
        defaultUnknownTypePolicy: MilanoUnknownTypePolicy,
        limits: MilanoLimits = MilanoLimits(),
        observer: MilanoObserver? = nil
    ) throws {
        let vocabulary = try MilanoVocabulary(artifactJSON: vocabularyJSON)

        var missing = vocabulary.components.keys
            .filter { registry.renderers[$0] == nil }
            .sorted()
        if defaultUnknownTypePolicy == .placeholder, registry.placeholder == nil {
            missing.append("(placeholder renderer)")
        }
        guard missing.isEmpty else {
            throw MilanoEngineError.incompleteRegistry(missing: missing)
        }

        self.vocabulary = vocabulary
        self.registry = registry
        self.defaultUnknownTypePolicy = defaultUnknownTypePolicy
        self.limits = limits
        self.observer = observer
    }
}
