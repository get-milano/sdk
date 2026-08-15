package dev.getmilano

/** The binding from vocabulary component types to consumer renderers. */
class MilanoRegistry {
    internal val renderers = LinkedHashMap<String, MilanoRenderer>()
    internal var placeholder: MilanoPlaceholderRenderer? = null
        private set

    /** Registers a renderer for one component type name. */
    fun register(
        componentType: String,
        renderer: MilanoRenderer,
    ) {
        renderers[componentType] = renderer
    }

    /**
     * Registers the placeholder renderer, required only when the
     * unknown-type policy is [MilanoUnknownTypePolicy.PLACEHOLDER].
     */
    fun registerPlaceholder(renderer: MilanoPlaceholderRenderer) {
        placeholder = renderer
    }
}
