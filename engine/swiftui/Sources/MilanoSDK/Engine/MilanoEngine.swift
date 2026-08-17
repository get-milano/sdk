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

    /// The held vocabulary's identity, for tooling such as generated
    /// bindings that assert they were generated from this vocabulary.
    public var vocabularyName: String { vocabulary.name }
    public var vocabularyVersion: String { vocabulary.version }
    public let limits: MilanoLimits
    // Retained for the engine's lifetime: a host may pass a freshly created
    // observer inline and still receive every occurrence.
    let observer: MilanoObserver?
    /// The product-analytics stream, retained like the observer; nil means
    /// interactions are not captured at all.
    let userInteractionObserver: MilanoUserInteractionObserver?

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
        defaultUnknownTypePolicy: MilanoUnknownTypePolicy = .fail,
        limits: MilanoLimits = MilanoLimits(),
        observer: MilanoObserver? = nil,
        userInteractionObserver: MilanoUserInteractionObserver? = nil
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
        self.userInteractionObserver = userInteractionObserver
    }
}
