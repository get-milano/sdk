package dev.getmilano.sample.milanobridge

import dev.getmilano.MilanoRegistry

/**
 * The one doorway between Milano and the design system: generated typed
 * bindings map nodes to component models, renderers register them.
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
    registry.register("Row", RowRenderer)
    registry.register("Card", CardRenderer)
    registry.register("Image", ImageRenderer)
    return registry
}
