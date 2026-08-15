package dev.getmilano

/**
 * A consumer-provided renderer for one component type: receives the node,
 * emits Compose UI. Invoked in composition on the main thread.
 */
interface MilanoRenderer {
    @androidx.compose.runtime.Composable
    fun Render(node: MilanoNode)
}

/**
 * The consumer-provided renderer for unknown component types under the
 * *placeholder* policy. Receives the raw subtree as data, never as live
 * children.
 */
interface MilanoPlaceholderRenderer {
    @androidx.compose.runtime.Composable
    fun Render(unknown: MilanoUnknownNode)
}

/** An unknown node routed to the placeholder renderer. */
data class MilanoUnknownNode(
    /** The component type the document asked for. */
    val type: String,
    /** The node's id or canonical path. */
    val reference: String,
    /** The node's whole subtree, as raw data. */
    val rawSubtree: MilanoValue,
)
