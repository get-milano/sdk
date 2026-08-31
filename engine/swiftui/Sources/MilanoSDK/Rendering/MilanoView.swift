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

    /// The document's `metadata` section, verbatim and untyped: producer
    /// annotations reach host code without a side channel.
    public nonisolated var metadata: MilanoValue? { core.document.metadata }

    /// The host's signal that the view has come on screen: accepted while
    /// not appeared, ignored otherwise and after teardown; an accepted
    /// signal runs the document's `appear` bindings. The view delivers it
    /// itself from SwiftUI's `onAppear` when placed; hosts driving the
    /// core without rendering it (tests, tooling) call it directly.
    public nonisolated func appear() {
        core.appear()
    }

    /// The mirror of `appear`: the view has left the screen.
    public nonisolated func disappear() {
        core.disappear()
    }

    /// Replaces the document the view is bound to (contract 2.1; state and
    /// actions spec, Document replacement): the new document passes the
    /// gate under the surface's configuration as it stands, state whose
    /// declaration is unchanged carries over, the state data provider
    /// supplies the rest, and the swap lands on the dispatcher, serialized
    /// with dispatch. Throws what `build()` throws (the gate's typed errors,
    /// or the provider's own error, unchanged); on a throw the view is
    /// exactly as it was. Ignored after teardown.
    public nonisolated func replace(document: Data) async throws {
        try await core.replace(document: document)
    }

    /// Replaces the document, given as text; see `replace(document:)`.
    public nonisolated func replace(documentText: String) async throws {
        try await core.replace(document: Data(documentText.utf8))
    }

    /// The view ceases to participate: completions arriving afterwards drop
    /// their follow-ups and report.
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
