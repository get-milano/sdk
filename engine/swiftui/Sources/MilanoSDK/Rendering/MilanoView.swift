import SwiftUI

/// The built, guaranteed-renderable view: a SwiftUI View bound to one
/// document for its lifetime. Presentation reacts to state and context;
/// the binding never changes.
public struct MilanoView: View {
    nonisolated let core: MilanoViewCore

    nonisolated init(core: MilanoViewCore) {
        self.core = core
    }

    /// Stable identity, plus the builder's label; used in all
    /// observability reports.
    public nonisolated var identity: String { core.identity }

    public var body: some View {
        MilanoRootView(core: core)
    }

    /// A renderer emission, for hosts driving the view without renderers
    /// (tests, tooling). Renderers use MilanoNode.emit.
    public nonisolated func emit(node: String, event: String, payload: MilanoValue? = nil) {
        core.emit(node: node, event: event, payload: payload)
    }

    /// The view ceases to participate: completions arriving afterwards drop
    /// their follow-ups and report.
    /// The document's `metadata` section, verbatim and untyped: producer
    /// annotations reach host code without a side channel.
    public nonisolated var metadata: MilanoValue? { core.document.metadata }

    public nonisolated func teardown() {
        core.teardown()
    }

    // Internal forwards for the conformance harness.
    nonisolated var state: [String: MilanoValue] { core.state }
    nonisolated var resolvedRoot: ResolvedNode { core.resolvedRoot }
    nonisolated var dispatched: [MilanoViewCore.DispatchRecord] { core.dispatched }
    nonisolated func complete(dispatchIndex: Int, success: Bool, payload: MilanoValue? = nil) {
        core.complete(dispatchIndex: dispatchIndex, success: success, payload: payload)
    }
}
