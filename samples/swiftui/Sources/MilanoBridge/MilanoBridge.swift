import MilanoSDK

/// The one doorway between Milano and the design system: model
/// initializers map nodes to component models, renderers register them.
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
        return registry
    }
}

extension MilanoNode {
    /// Conditional visibility: an ordinary vocabulary property, honored by
    /// every renderer in this bridge. Absent means visible.
    var isVisible: Bool {
        property("visible").boolValue ?? true
    }
}
