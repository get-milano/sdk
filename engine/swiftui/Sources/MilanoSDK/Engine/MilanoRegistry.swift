import Foundation

/// The binding from vocabulary component types to consumer renderers.
public struct MilanoRegistry {
    private(set) var renderers: [String: MilanoRenderer] = [:]
    private(set) var placeholder: MilanoPlaceholderRenderer?

    public init() {}

    /// Registers a renderer for one component type name.
    public mutating func register(_ renderer: MilanoRenderer, for componentType: String) {
        renderers[componentType] = renderer
    }

    /// Registers the placeholder renderer, required only when the
    /// unknown-type policy is `.placeholder`.
    public mutating func registerPlaceholder(_ renderer: MilanoPlaceholderRenderer) {
        placeholder = renderer
    }
}
