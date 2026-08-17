import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// The handler-to-document data path: a handler's returned value flows
/// through the async completion funnel, validates against the declared
/// result type, and binds the `result` root inside onSuccess. The
/// scripted-completion variants of these semantics are covered by the
/// conformance vectors; these tests cover the real async funnel.
struct CompletionResultTests {

    private struct InlineDispatcher: MilanoDispatcher {
        func dispatch(_ work: @escaping @Sendable () -> Void) { work() }
    }

    private final class StubRenderer: MilanoRenderer {
        func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
    }

    private final class OccurrenceCollector: MilanoObserver, @unchecked Sendable {
        var collected: [MilanoOccurrence] = []
        func occurrence(_ occurrence: MilanoOccurrence) { collected.append(occurrence) }
    }

    private let vocabulary = Data("""
        {
          "milano": "1.0.0",
          "name": "completions",
          "version": "1.0.0",
          "components": {
            "Button": {
              "properties": {"label": "string"},
              "events": {"tap": null}
            }
          },
          "actions": {
            "fetchCode": {"result": "string"}
          }
        }
        """.utf8)

    private let document = Data("""
        {
          "version": "1.0.0",
          "state": {"code": "string"},
          "root": {
            "type": "Button",
            "id": "b",
            "properties": {"label": "Go"},
            "on": {
              "tap": [{
                "action": "fetchCode",
                "onSuccess": [{"action": "$set", "key": "code", "value": {"$expr": "result"}}],
                "onFailure": [{"action": "$set", "key": "code", "value": "failed"}]
              }]
            }
          }
        }
        """.utf8)

    private func build(
        observer: OccurrenceCollector? = nil,
        handler: @escaping @Sendable (MilanoAction) async throws -> MilanoValue?
    ) async throws -> MilanoView {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Button")
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry, observer: observer)
        return try await engine.viewBuilder(document: document)
            .stateData { _ in ["code": .string("start")] }
            .actionHandler(handler)
            .dispatcher(InlineDispatcher())
            .build()
    }

    private func waitUntil(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<500 where !condition() {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        #expect(condition())
    }

    @Test func handlerReturnedValueBindsResult() async throws {
        let view = try await build { _ in .string("OK-42") }
        view.emit(node: "b", event: "tap")
        try await waitUntil { view.state["code"] == .string("OK-42") }
    }

    @Test func throwingHandlerRunsOnFailureWithoutResult() async throws {
        struct Boom: Error {}
        let view = try await build { _ in throw Boom() }
        view.emit(node: "b", event: "tap")
        try await waitUntil { view.state["code"] == .string("failed") }
    }

    @Test func nilForDeclaredResultIsInvalidCompletion() async throws {
        let collector = OccurrenceCollector()
        let view = try await build(observer: collector) { _ in nil }
        view.emit(node: "b", event: "tap")
        try await waitUntil { collector.collected.contains { $0.kind == .invalidCompletion } }
        // Consumed without running either branch.
        #expect(view.state["code"] == .string("start"))
    }
}
