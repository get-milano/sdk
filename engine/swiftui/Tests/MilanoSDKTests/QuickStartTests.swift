import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// The quick path: one call builds engine, registry, and builder, with
/// declared state synthesized as zero-values.
struct QuickStartTests {

    private final class StubRenderer: MilanoRenderer {
        func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
    }

    private let vocabulary = Data("""
        {"milano": "1.0.0", "name": "quick", "version": "1.0.0",
         "components": {"Greeting": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {"celebrate": {}}}
        """.utf8)

    private func document(_ expression: String) -> Data {
        Data("""
            {"version": "1.0.0",
             "context": {"userName": "string"},
             "state": {"taps": "int", "note": "string?"},
             "root": {"type": "Greeting", "id": "hello",
                      "properties": {"text": {"$expr": "\(expression)"}},
                      "on": {"tap": [{"action": "celebrate"}]}}}
            """.utf8)
    }

    @Test func buildsWithSynthesizedStateAndContext() async throws {
        let builder = try MilanoQuickStart.builder(
            document: document("concat(context.userName, ':', str(state.taps), ':', state.note ?? '-')"),
            vocabulary: vocabulary,
            renderers: ["Greeting": StubRenderer()],
            context: ["userName": .string("Ada")],
            state: [:],
            onAction: { _ in nil })
        let view = try await builder.build()
        // taps synthesized to 0, optional note to null.
        #expect(view.resolvedRoot.values["text"] == .string("Ada:0:-"))
    }

    @Test func suppliedStateOverridesSynthesis() async throws {
        let builder = try MilanoQuickStart.builder(
            document: document("str(state.taps)"),
            vocabulary: vocabulary,
            renderers: ["Greeting": StubRenderer()],
            context: ["userName": .string("Ada")],
            state: ["taps": .int(7)],
            onAction: { _ in nil })
        let view = try await builder.build()
        #expect(view.resolvedRoot.values["text"] == .string("7"))
    }

    @Test func customActionsRequireTheClosure() async throws {
        let builder = try MilanoQuickStart.builder(
            document: document("context.userName"),
            vocabulary: vocabulary,
            renderers: ["Greeting": StubRenderer()],
            context: ["userName": .string("Ada")],
            state: [:],
            onAction: nil)
        await #expect(throws: MilanoBuildError.self) {
            _ = try await builder.build()
        }
    }

    @Test func invalidVocabularySurfacesAtConstruction() {
        #expect(throws: MilanoEngineError.self) {
            _ = try MilanoQuickStart.builder(
                document: document("'x'"),
                vocabulary: Data("{ nope".utf8),
                renderers: [:], context: [:], state: [:], onAction: nil)
        }
    }

    @Test func zeroValuesCoverEveryKind() {
        let declarations: [String: MilanoType] = [
            "flag": MilanoType(.bool),
            "count": MilanoType(.int),
            "ratio": MilanoType(.double),
            "label": MilanoType(.string),
            "items": MilanoType(.array(MilanoType(.int))),
            "pair": MilanoType(.record(["a": MilanoType(.bool)])),
            "maybe": MilanoType(.string, optional: true)
        ]
        let values = MilanoQuickStart.synthesized(declarations, overriding: [:])
        #expect(values["flag"] == .bool(false))
        #expect(values["count"] == .int(0))
        #expect(values["ratio"] == .double(0))
        #expect(values["label"] == .string(""))
        #expect(values["items"] == .array([]))
        #expect(values["pair"] == .record(["a": .bool(false)]))
        #expect(values["maybe"] == .null)
    }
}
