package dev.getmilano

/**
 * One user interaction, delivered to the engine's user-interaction
 * observer. Records pass everything through unredacted (payloads, action
 * parameters, document metadata): Milano implements no tracker, the
 * receiving host owns the data and decides what to do with it.
 */
data class MilanoUserInteraction(
    val kind: Kind,
    /** Stable identity of the originating view, plus the builder's label when set. */
    val viewIdentity: String,
    /** The node's id or canonical path, when anchored to a node. */
    val node: String? = null,
    /** The event or action name, when one applies. */
    val name: String? = null,
    /**
     * The interaction's data: the emission payload for [Kind.EVENT], the
     * captured parameters for [Kind.ACTION_DISPATCHED], the document
     * metadata for [Kind.VIEW_BUILT], and whatever the renderer supplies
     * for widget kinds.
     */
    val value: MilanoValue? = null,
) {
    /**
     * The closed union of both sources: runtime-captured records
     * (lifecycle, emissions, dispatch, completions) and renderer-reported
     * widget interactions ([MilanoNode.userInteraction]).
     */
    enum class Kind {
        // Runtime-captured: nothing required from renderers or documents.
        VIEW_BUILT,
        VIEW_TORN_DOWN,
        EVENT,
        ACTION_DISPATCHED,
        COMPLETION_SUCCEEDED,
        COMPLETION_FAILED,

        // Renderer-reported: signals the document does not model as events.
        TAP,
        DOUBLE_TAP,
        LONG_PRESS,
        FOCUS_GAINED,
        FOCUS_LOST,
        TEXT_CHANGED,
        TOGGLED,
        SELECTION_CHANGED,
        VALUE_CHANGED,
        APPEARED,
        DISAPPEARED,
        SCROLLED,
    }
}

/**
 * A receiver of user interactions: the engine's product-analytics stream,
 * separate from [MilanoObserver], which carries engine observability only.
 */
fun interface MilanoUserInteractionObserver {
    fun interaction(interaction: MilanoUserInteraction)
}
