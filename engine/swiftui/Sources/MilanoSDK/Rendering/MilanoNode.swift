import SwiftUI

/// What a renderer receives: the node's resolved values, its materialized
/// children, and the emission surface.
public struct MilanoNode {
    let core: MilanoViewCore
    let resolved: ResolvedNode

    /// The component type name.
    public var type: String { resolved.type }

    /// The node's id, or canonical path when no id is declared.
    public var reference: String { resolved.reference }

    /// The resolved value of a declared property. Because the gate
    /// type-checked everything, reading with the declared type's accessor
    /// always succeeds; an absent optional is `.null`.
    public func property(_ name: String) -> MilanoValue {
        resolved.values[name] ?? .null
    }

    /// The node's materialized children, ready to place. Each is
    /// Identifiable by its node reference.
    public var children: [MilanoChildView] {
        resolved.children.map { MilanoChildView(core: core, resolved: $0) }
    }

    /// Emits a declared event into dispatch; invalid emissions are dropped
    /// and reported per Foundations.
    public func emit(_ event: String, payload: MilanoValue? = nil) {
        core.emit(node: resolved.reference, event: event, payload: payload)
    }
}

/// One materialized child, ready to place in a layout.
public struct MilanoChildView: View, Identifiable {
    nonisolated let core: MilanoViewCore
    nonisolated let resolved: ResolvedNode

    public nonisolated var id: String { resolved.reference }

    public var body: some View {
        milanoRender(core: core, resolved: resolved)
    }
}
