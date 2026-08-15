package dev.getmilano

/**
 * Engine-creation errors, per the vocabulary schema spec. These arise at
 * engine creation only; they can never occur at the gate or later.
 */
sealed class MilanoEngineException(
    message: String,
) : Exception(message) {
    /**
     * The vocabulary artifact violates the vocabulary schema spec.
     * [rule] names the violated rule; [detail] says where or what.
     */
    class InvalidVocabulary(
        val rule: String,
        val detail: String,
    ) : MilanoEngineException("invalid vocabulary ($rule): $detail")

    /**
     * A declared component type has no registered renderer, or the
     * placeholder policy is the engine default with no placeholder
     * renderer registered. Lists what is missing.
     */
    class IncompleteRegistry(
        val missing: List<String>,
    ) : MilanoEngineException("incomplete registry, missing: ${missing.joinToString()}")
}
