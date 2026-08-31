import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// The `$repeat` construct beyond what the vectors pin: the shape of the
/// resolved tree a binding sees, re-materialization under incremental
/// resolution, and instance emissions carrying their element.
struct RepeatTests {

    private struct InlineDispatcher: MilanoDispatcher {
        func dispatch(_ work: @escaping @Sendable () -> Void) { work() }
    }

    private final class StubRenderer: MilanoRenderer {
        func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
    }

    private final class Collector: MilanoObserver, @unchecked Sendable {
        var collected: [MilanoOccurrence] = []
        func occurrence(_ occurrence: MilanoOccurrence) { collected.append(occurrence) }
    }

    private let vocabulary = Data("""
        {"milano": "2.0.0", "name": "repeat", "version": "1.0.0",
         "components": {"Column": {"children": true},
                        "Text": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {}}
        """.utf8)

    private static let rows: MilanoValue = .array([
        .record(["name": .string("Alpha")]), .record(["name": .string("Beta")])
    ])

    private let document = """
        {"version": "2.0.0",
         "state": {"rows": {"array": {"record": {"name": "string"}}}, "prefix": "string", "other": "int"},
         "root": {"type": "Column", "id": "list", "children": [
           {"type": "Text", "id": "head", "properties": {"text": "head"}},
           {"type": "$repeat", "id": "each", "items": {"$expr": "state.rows"}, "as": "row", "children": [
             {"type": "Text", "id": "name", "properties": {"text": {"$expr": "$concat(state.prefix, row.name)"}},
              "on": {"tap": [{"action": "$set", "key": "prefix",
                              "value": {"$expr": "$concat(row.name, $str(row_index))"}}]}}]},
           {"type": "Text", "id": "control", "properties": {"text": "x"},
            "on": {"tap": [{"action": "$set", "key": "other", "value": {"$expr": "state.other + 1"}}]}},
           {"type": "Text", "id": "prefixer", "properties": {"text": "x"},
            "on": {"tap": [{"action": "$set", "key": "prefix", "value": "> "}]}}]}}
        """

    private func build() async throws -> (MilanoView, Collector) {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Column")
        registry.register(StubRenderer(), for: "Text")
        let collector = Collector()
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry, limits: MilanoLimits(), observer: collector)
        let view = try await engine.viewBuilder(documentText: document)
            .stateData { _ in ["rows": Self.rows, "prefix": .string(""), "other": .int(0)] }
            .dispatcher(InlineDispatcher())
            .build()
        return (view, collector)
    }

    @Test func instancesTakeTheConstructsPlaceWithTheParentsSpans() async throws {
        let (view, _) = try await build()
        let root = view.resolvedRoot
        #expect(root.children.map(\.reference) == ["head", "name[0]", "name[1]", "control", "prefixer"])
        #expect(root.spans == [1, 2, 1, 1])
        #expect(root.children[1].values["text"] == .string("Alpha"))
    }

    @Test func instancesReMaterializeOnlyWhenSomethingTheyReadChanged() async throws {
        let (view, collector) = try await build()
        view.emit(node: "control", event: "tap")
        #expect(view.state["other"] == .int(1))
        #expect(view.resolvedRoot.children[1].values["text"] == .string("Alpha"))
        view.emit(node: "prefixer", event: "tap")
        #expect(view.resolvedRoot.children[1].values["text"] == .string("> Alpha"))
        #expect(view.resolvedRoot.children[2].values["text"] == .string("> Beta"))
        #expect(collector.collected.isEmpty)
    }

    @Test func anInstanceEmissionDispatchesWithItsElementBound() async throws {
        let (view, collector) = try await build()
        view.emit(node: "name[1]", event: "tap")
        #expect(view.state["prefix"] == .string("Beta1"))
        view.emit(node: "name[7]", event: "tap")
        #expect(collector.collected.map { [$0.kind.rawValue, $0.node, $0.expected, $0.found] }
            == [["invalidEmission", "name[7]", "repeat element", "index 7"]])
    }
}
