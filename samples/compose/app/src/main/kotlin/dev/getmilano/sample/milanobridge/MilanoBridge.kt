package dev.getmilano.sample.milanobridge

import dev.getmilano.MilanoNode
import dev.getmilano.MilanoRegistry

/**
 * The one doorway between Milano and the design system: model factories
 * map nodes to component models, renderers register them.
 */
fun milanoRegistry(): MilanoRegistry {
    val registry = MilanoRegistry()
    registry.register("Column", ColumnRenderer)
    registry.register("Banner", BannerRenderer)
    registry.register("Text", TextRenderer)
    registry.register("Button", ButtonRenderer)
    registry.register("TextField", TextFieldRenderer)
    registry.register("NumberField", NumberFieldRenderer)
    registry.register("Checkbox", CheckboxRenderer)
    return registry
}

/**
 * Conditional visibility: an ordinary vocabulary property, honored by
 * every renderer in this bridge. Absent means visible.
 */
internal val MilanoNode.isVisible: Boolean
    get() = property("visible").boolOrNull ?: true
