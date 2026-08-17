import MilanoSDK

/// The one doorway between Milano and the design system: generated typed
/// bindings map nodes to component models, renderers register them.
enum MilanoBridge {
    static func registry() -> MilanoRegistry {
        var registry = MilanoRegistry()
        registry.register(ColumnRenderer(), for: "Column")
        registry.register(BannerRenderer(), for: "Banner")
        registry.register(TextRenderer(), for: "Text")
        registry.register(ButtonRenderer(), for: "Button")
        registry.register(TextFieldRenderer(), for: "TextField")
        registry.register(NumberFieldRenderer(), for: "NumberField")
        registry.register(CheckboxRenderer(), for: "Checkbox")
        registry.register(RowRenderer(), for: "Row")
        registry.register(CardRenderer(), for: "Card")
        registry.register(ImageRenderer(), for: "Image")
        return registry
    }
}
