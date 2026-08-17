import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// The user-interaction analytics stream: engine-captured records and the
/// renderer-facing widget channel, separate from the observability stream.
struct UserInteractionTests {

    private struct InlineDispatcher: MilanoDispatcher {
        func dispatch(_ work: @escaping @Sendable () -> Void) { work() }
    }

    private final class StubRenderer: MilanoRenderer {
        func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
    }

    private final class Collector: MilanoUserInteractionObserver, @unchecked Sendable {
        var collected: [MilanoUserInteraction] = []
        func interaction(_ interaction: MilanoUserInteraction) { collected.append(interaction) }
    }

    private let vocabulary = Data("""
        {"milano": "1.0.0", "name": "analytics", "version": "1.0.0",
         "components": {
            "Field": {"properties": {"value": "string"},
                      "events": {"change": "string"}}},
         "actions": {"submit": {"parameters": {"value": "string"}}}}
        """.utf8)

    private let document = Data("""
        {"version": "1.0.0",
         "metadata": {"experiment": "b"},
         "state": {"value": "string"},
         "root": {"type": "Field", "id": "f",
                  "properties": {"value": {"$expr": "state.value"}},
                  "on": {"change": [
                      {"action": "$set", "key": "value", "value": {"$expr": "event"}},
                      {"action": "submit", "value": {"$expr": "event"}}]}}}
        """.utf8)

    private func build(_ collector: Collector?) async throws -> MilanoView {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Field")
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry,
            userInteractionObserver: collector)
        return try await engine.viewBuilder(document: document)
            .stateData { _ in ["value": .string("")] }
            .actionHandler { _ in nil }
            .dispatcher(InlineDispatcher())
            .build()
    }

    /// The full funnel in order: impression with metadata, the emission
    /// with its payload, the dispatch with captured parameters anchored to
    /// the source node, and the torn-down bracket, exactly once.
    @Test func runtimeStreamCarriesTheFullFunnel() async throws {
        let collector = Collector()
        let view = try await build(collector)
        view.emit(node: "f", event: "change", payload: .string("hi"))
        view.teardown()
        view.teardown()  // once: the second is inert

        let kinds = collector.collected.map(\.kind)
        #expect(kinds == [.viewBuilt, .event, .actionDispatched, .viewTornDown])

        #expect(collector.collected[0].value == .record(["experiment": .string("b")]))
        #expect(collector.collected[1].node == "f")
        #expect(collector.collected[1].name == "change")
        #expect(collector.collected[1].value == .string("hi"))
        #expect(collector.collected[2].node == "f")
        #expect(collector.collected[2].name == "submit")
        #expect(collector.collected[2].value == .record(["value": .string("hi")]))
    }

    /// The renderer-facing channel: a widget report reaches the stream
    /// anchored to the node, with its value, without touching dispatch.
    @Test func widgetReportsFlowStraightToTheStream() async throws {
        let collector = Collector()
        let view = try await build(collector)
        let node = MilanoNode(core: view.core, resolved: view.resolvedRoot)

        node.userInteraction(.focusGained)
        node.userInteraction(.selectionChanged, value: .string("second"))

        let widget = collector.collected.filter { $0.kind != .viewBuilt }
        #expect(widget.map(\.kind) == [.focusGained, .selectionChanged])
        #expect(widget[0].node == "f")
        #expect(widget[1].value == .string("second"))
        // Analytics never touches dispatch: nothing was dispatched.
        #expect(view.dispatched.isEmpty)
    }

    /// Without an observer, capture costs nothing and changes nothing.
    @Test func absentObserverIsInert() async throws {
        let view = try await build(nil)
        view.emit(node: "f", event: "change", payload: .string("hi"))
        let node = MilanoNode(core: view.core, resolved: view.resolvedRoot)
        node.userInteraction(.tap)
        #expect(view.state["value"] == .string("hi"))
    }
}
