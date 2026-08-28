package dev.getmilano

/** How unknown component types are handled: engine default, per-view override. */
enum class MilanoUnknownTypePolicy {
    /** Drop the node and its entire subtree, keep siblings, report. */
    SKIP,

    /** Building throws UnknownComponentType at the gate. */
    FAIL,

    /** Route the node and its raw subtree to the placeholder renderer, report. */
    PLACEHOLDER,
}

/**
 * Resource limits; safe defaults fixed by the document model spec,
 * adjustable per engine.
 */
data class MilanoLimits(
    val maxTreeDepth: Int = 32,
    val maxNodeCount: Int = 10_000,
    val maxDocumentBytes: Int = 1_048_576,
    val maxExpressionLength: Int = 1_024,
    /**
     * The largest value that may enter state or context, at the gate and at
     * runtime, in the document model's units: one per scalar, one per
     * Unicode scalar of a string, one plus the contents for an array or a
     * record ([MilanoValue.size]).
     */
    val maxValueSize: Int = 65_536,
)
