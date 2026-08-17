import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// The builder's contract obligations that conformance vectors cannot
/// express: handler and context requirements, capability narrowing through
/// the public API, provider error propagation, per-view policy overrides,
/// labels on observability, and emission edge behavior.
struct BuilderContractTests {

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
        {"milano": "1.0.0", "name": "contract", "version": "1.0.0",
         "components": {
            "Button": {"properties": {"label": "string"}, "events": {"tap": null}},
            "Text": {"properties": {"text": "string"}}},
         "actions": {"ping": {}, "pong": {}}}
        """.utf8)

    private func engine(observer: Collector? = nil) throws -> MilanoEngine {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Button")
        registry.register(StubRenderer(), for: "Text")
        return try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry, observer: observer)
    }

    private func document(action: String = "ping") -> Data {
        Data("""
            {"version": "1.0.0",
             "root": {"type": "Button", "id": "b",
                      "properties": {"label": "Go"},
                      "on": {"tap": [{"action": "\(action)"}]}}}
            """.utf8)
    }

    private func buildError(_ builder: MilanoViewBuilder) async throws -> MilanoBuildError? {
        do {
            _ = try await builder.build()
            return nil
        } catch let error as MilanoBuildError {
            return error
        }
    }

    @Test func customActionsRequireAHandler() async throws {
        let builder = try engine().viewBuilder(document: document())
            .dispatcher(InlineDispatcher())
        #expect(
            try await buildError(builder)
                == .schemaViolation(
                    rule: "action-handler", node: nil,
                    expected: "action handler", found: nil))
    }

    @Test func builtInsNeedNoHandler() async throws {
        let noActions = Data("""
            {"version": "1.0.0",
             "root": {"type": "Text", "properties": {"text": "x"}}}
            """.utf8)
        let builder = try engine().viewBuilder(document: noActions)
            .dispatcher(InlineDispatcher())
        #expect(try await buildError(builder) == nil)
    }

    @Test func allowlistNarrowsTheGrantedSet() async throws {
        // pong is vocabulary-declared but not allowed on this surface.
        let builder = try engine().viewBuilder(document: document(action: "pong"))
            .allowActions(["ping"])
            .actionHandler { _ in nil }
            .dispatcher(InlineDispatcher())
        #expect(
            try await buildError(builder)
                == .schemaViolation(
                    rule: "action-capability", node: "b",
                    expected: "granted action", found: "pong"))
    }

    @Test func builderDeclarationJoinsTheGrantedSet() async throws {
        let builder = try engine().viewBuilder(document: document(action: "local"))
            .action("local")
            .actionHandler { _ in nil }
            .dispatcher(InlineDispatcher())
        #expect(try await buildError(builder) == nil)
    }

    @Test func missingContextValueFailsTheBuild() async throws {
        let withContext = Data("""
            {"version": "1.0.0",
             "context": {"userName": "string"},
             "root": {"type": "Text",
                      "properties": {"text": {"$expr": "context.userName"}}}}
            """.utf8)
        let builder = try engine().viewBuilder(document: withContext)
            .context([:])
            .dispatcher(InlineDispatcher())
        let error = try await buildError(builder)
        guard case .schemaViolation(let rule, _, _, _)? = error else {
            Issue.record("expected a SchemaViolation, got \(String(describing: error))")
            return
        }
        #expect(rule == "context-declaration")
    }

    @Test func providerErrorsPropagateUnchanged() async throws {
        struct ProviderFailure: Error, Equatable {}
        let withState = Data("""
            {"version": "1.0.0",
             "state": {"count": "int"},
             "root": {"type": "Text",
                      "properties": {"text": {"$expr": "str(state.count)"}}}}
            """.utf8)
        let builder = try engine().viewBuilder(document: withState)
            .stateData { _ in throw ProviderFailure() }
            .dispatcher(InlineDispatcher())
        await #expect(throws: ProviderFailure.self) {
            _ = try await builder.build()
        }
    }

    @Test func placeholderOverrideWithoutRendererFailsAtBuild() async throws {
        let unknown = Data("""
            {"version": "1.0.0", "root": {"type": "Mystery"}}
            """.utf8)
        let builder = try engine().viewBuilder(document: unknown)
            .unknownTypePolicy(.placeholder)
            .dispatcher(InlineDispatcher())
        do {
            _ = try await builder.build()
            Issue.record("expected IncompleteRegistry")
        } catch let error as MilanoEngineError {
            #expect(error == .incompleteRegistry(missing: ["(placeholder renderer)"]))
        }
    }

    @Test func labelReachesOccurrenceIdentity() async throws {
        let collector = Collector()
        let unknown = Data("""
            {"version": "1.0.0", "root": {"type": "Mystery"}}
            """.utf8)
        let view = try await engine(observer: collector)
            .viewBuilder(document: unknown)
            .unknownTypePolicy(.skip)
            .label("promo-slot")
            .dispatcher(InlineDispatcher())
            .build()
        _ = view
        let skip = collector.collected.first { $0.kind == .unknownTypeSkipped }
        #expect(skip?.viewIdentity.contains("promo-slot") == true)
    }

    @Test func emissionEdgesReportOrStaySilent() async throws {
        let collector = Collector()
        let view = try await engine(observer: collector)
            .viewBuilder(document: document())
            .actionHandler { _ in nil }
            .dispatcher(InlineDispatcher())
            .build()

        // Unknown node and undeclared event are invalid emissions.
        view.emit(node: "nope", event: "tap")
        view.emit(node: "b", event: "swipe")
        // A payload on a payload-less event is invalid too.
        view.emit(node: "b", event: "tap", payload: .string("x"))
        #expect(collector.collected.filter { $0.kind == .invalidEmission }.count == 3)

        // After teardown, emissions are silently ignored: no pending work.
        let before = collector.collected.count
        view.teardown()
        view.emit(node: "b", event: "tap")
        #expect(collector.collected.count == before)
    }

    @Test func contextHandleUpdatesFromABackgroundThread() async throws {
        let withContext = Data("""
            {"version": "1.0.0",
             "context": {"label": "string"},
             "root": {"type": "Text", "id": "t",
                      "properties": {"text": {"$expr": "context.label"}}}}
            """.utf8)
        let handle = MilanoContextHandle(["label": .string("first")])
        let view = try await engine().viewBuilder(document: withContext)
            .contextSource(handle)
            .dispatcher(InlineDispatcher())
            .build()
        #expect(view.resolvedRoot.values["text"] == .string("first"))

        // Posted off the main thread; applied through the dispatcher.
        await Task.detached {
            handle.update(["label": .string("second")])
        }.value
        try await Task.sleep(nanoseconds: 50_000_000)
        #expect(view.resolvedRoot.values["text"] == .string("second"))
    }
}
