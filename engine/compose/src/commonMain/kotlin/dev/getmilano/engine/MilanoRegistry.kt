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

    /**
     * A copy. An engine takes one at creation, so registering a renderer
     * afterwards cannot change what an existing engine renders, which is
     * what "immutable after creation" has to mean. Swift gets this from
     * value semantics and TypeScript copies the same way.
     */
    internal fun snapshot(): MilanoRegistry =
        MilanoRegistry().also { copy ->
            copy.renderers.putAll(renderers)
            placeholder?.let(copy::registerPlaceholder)
        }
}
