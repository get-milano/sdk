package dev.getmilano

/**
 * The instantiable root of the framework. An engine holds one
 * configuration: the vocabulary, the registry, the default unknown-type
 * policy, and resource limits. It is immutable after creation and safe to
 * share across threads. MilanoViewBuilders are obtained from an engine,
 * so every MilanoView is traceable to exactly one configuration.
 */
class MilanoEngine(
    vocabularyJson: String,
    registry: MilanoRegistry,
    val defaultUnknownTypePolicy: MilanoUnknownTypePolicy,
    val limits: MilanoLimits = MilanoLimits(),
    internal val observer: MilanoObserver? = null,
) {
    internal val vocabulary: MilanoVocabulary
    internal val registry: MilanoRegistry

    // Creation validates everything and fails fast on developer mistakes:
    // InvalidVocabulary when the artifact violates the vocabulary schema
    // spec; IncompleteRegistry when a declared component type has no
    // registered renderer, or the default policy is PLACEHOLDER with no
    // placeholder renderer registered.
    init {
        val parsed = MilanoVocabulary.parse(vocabularyJson)

        val missing =
            parsed.components.keys
                .filter { it !in registry.renderers }
                .sorted()
                .toMutableList()
        if (defaultUnknownTypePolicy == MilanoUnknownTypePolicy.PLACEHOLDER && registry.placeholder == null) {
            missing.add("(placeholder renderer)")
        }
        if (missing.isNotEmpty()) {
            throw MilanoEngineException.IncompleteRegistry(missing)
        }

        this.vocabulary = parsed
        this.registry = registry
    }
}
