package dev.getmilano

/**
 * One reported occurrence, delivered to the engine observer, tagged with
 * the originating view. Kinds are the closed union defined by the runtime
 * API spec.
 */
data class MilanoOccurrence(
    val kind: Kind,
    /** Stable identity of the originating view, plus the builder's label when set. */
    val viewIdentity: String,
    /** The node's id or canonical path, when one applies. */
    val node: String?,
    /**
     * What the occurrence is about, when one thing is: the event, action,
     * property, component type, or context key involved.
     */
    val name: String? = null,
    /**
     * Detail in the gate's own terms, when it applies: the declared type
     * or shape that was expected, and the kind that arrived (or "missing").
     */
    val expected: String? = null,
    val found: String? = null,
) {
    enum class Kind {
        UNKNOWN_TYPE_SKIPPED,
        UNKNOWN_TYPE_PLACEHOLDER,
        UNDECLARED_PROPERTY,
        DROPPED_EVENT,
        INVALID_EMISSION,
        INVALID_COMPLETION,
        DUPLICATE_COMPLETION,
        COMPLETION_AFTER_TEARDOWN,
        REJECTED_CONTEXT_UPDATE,
        REJECTED_MUTATION,
        DIVISION_BY_ZERO,
        SATURATION,
    }
}

/**
 * Engine-scoped observer: one integration point per engine for logging and
 * telemetry. Every reported occurrence flows here.
 */
fun interface MilanoObserver {
    fun occurrence(occurrence: MilanoOccurrence)
}
