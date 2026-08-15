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
) {
    enum class Kind {
        UNKNOWN_TYPE_SKIPPED,
        UNKNOWN_TYPE_PLACEHOLDER,
        UNDECLARED_PROPERTY,
        DROPPED_EVENT,
        INVALID_EMISSION,
        DUPLICATE_COMPLETION,
        COMPLETION_AFTER_TEARDOWN,
        REJECTED_CONTEXT_UPDATE,
        OVER_LIMIT_REJECTED,
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
