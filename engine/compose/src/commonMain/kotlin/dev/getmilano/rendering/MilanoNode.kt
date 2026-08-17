package dev.getmilano

import androidx.compose.runtime.Composable

/**
 * What a renderer receives: the node's resolved values, its materialized
 * children, and the emission surface.
 */
class MilanoNode internal constructor(
    private val view: MilanoView,
    private val resolved: ResolvedNode,
) {
    /** The component type name. */
    val type: String get() = resolved.type

    /** The node's id, or canonical path when no id is declared. */
    val reference: String get() = resolved.reference

    /**
     * The resolved value of a declared property. Because the gate
     * type-checked everything, reading with the declared type's accessor
     * always succeeds; an absent optional is Null.
     */
    fun property(name: String): MilanoValue = resolved.values[name] ?: MilanoValue.Null

    /**
     * The node's materialized children, ready to place. Each carries a
     * stable key: its node reference.
     */
    val children: List<MilanoChild>
        get() = resolved.children.map { MilanoChild(view, it) }

    /**
     * Emits a declared event into dispatch; invalid emissions are dropped
     * and reported per Foundations.
     */
    fun emit(
        event: String,
        payload: MilanoValue? = null,
    ) {
        view.emit(resolved.reference, event, payload)
    }

    /**
     * Reports a widget interaction to the engine's user-interaction
     * stream, for signals the document does not model as events (focus,
     * visibility, selection). Never touches dispatch or state; a no-op
     * when the engine carries no user-interaction observer.
     */
    fun userInteraction(
        kind: MilanoUserInteraction.Kind,
        value: MilanoValue? = null,
    ) {
        view.record(kind, resolved.reference, null, value)
    }
}

/** One materialized child, ready to place in a layout. */
class MilanoChild internal constructor(
    private val view: MilanoView,
    private val resolved: ResolvedNode,
) {
    /** Stable identity for keyed composition: the node reference. */
    val key: String get() = resolved.reference

    @Composable
    fun Render() {
        RenderNode(view, resolved)
    }
}

/**
 * Dispatches one resolved node to its registered renderer (or the
 * placeholder renderer). Registry coverage is total by construction, so
 * the lookups cannot miss.
 */
@Composable
internal fun RenderNode(
    view: MilanoView,
    resolved: ResolvedNode,
) {
    if (resolved.isPlaceholder) {
        view.engine.registry.placeholder?.Render(
            MilanoUnknownNode(
                type = resolved.type,
                reference = resolved.reference,
                rawSubtree = resolved.rawSubtree ?: MilanoValue.Null,
            ),
        )
        return
    }
    view.engine.registry.renderers[resolved.type]
        ?.Render(MilanoNode(view, resolved))
}
