import SwiftUI

/// Dispatches one resolved node to its registered renderer (or the
/// placeholder renderer). Registry coverage is total by construction, so
/// the lookups cannot miss.
@MainActor
func milanoRender(core: MilanoViewCore, resolved: ResolvedNode) -> AnyView {
    if resolved.isPlaceholder {
        guard let placeholder = core.engine.registry.placeholder else {
            return AnyView(EmptyView())
        }
        return placeholder.render(
            MilanoUnknownNode(
                type: resolved.type,
                reference: resolved.reference,
                rawSubtree: resolved.rawSubtree ?? .null))
    }
    guard let renderer = core.engine.registry.renderers[resolved.type] else {
        return AnyView(EmptyView())
    }
    return renderer.render(MilanoNode(core: core, resolved: resolved))
}

/// View-level invalidation: one signal per re-resolution; SwiftUI's diffing
/// keeps actual UI updates minimal.
private final class MilanoInvalidator: ObservableObject {
    init(core: MilanoViewCore) {
        core.onChange = { [weak self] in
            self?.objectWillChange.send()
        }
    }
}

struct MilanoRootView: View {
    let core: MilanoViewCore
    @StateObject private var invalidator: MilanoInvalidator

    init(core: MilanoViewCore) {
        self.core = core
        _invalidator = StateObject(wrappedValue: MilanoInvalidator(core: core))
    }

    var body: some View {
        milanoRender(core: core, resolved: core.resolvedRoot)
    }
}
