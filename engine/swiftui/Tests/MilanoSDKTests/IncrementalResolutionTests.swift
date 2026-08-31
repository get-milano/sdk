import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Incremental resolution: an update re-evaluates only what reads a key
/// whose value changed and tells the host only when something did. The
/// conformance vector `dispatch-set-independent-expression-not-reevaluated`
/// pins the observable half (no repeated arithmetic report); this pins the
/// rest.
struct IncrementalResolutionTests {

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
        {"milano": "1.0.0", "name": "incremental", "version": "1.0.0",
         "components": {
            "Column": {"children": true},
            "Text": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {}}
        """.utf8)

    private let document = Data("""
        {"version": "1.0.0",
         "context": {"who": "string"},
         "state": {"divisor": "int", "other": "int"},
         "root": {"type": "Column", "id": "root", "children": [
            {"type": "Text", "id": "ratio", "properties": {"text": {"$expr": "$str(100 / state.divisor)"}}},
            {"type": "Text", "id": "greeting", "properties": {"text": {"$expr": "$concat('hi ', context.who)"}}},
            {"type": "Text", "id": "buttons", "properties": {"text": "x"},
             "on": {"tap": [{"action": "$set", "key": "other", "value": {"$expr": "state.other + 1"}}]}}]}}
        """.utf8)

    private func build() async throws -> (MilanoView, Collector, MilanoContextHandle) {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Column")
        registry.register(StubRenderer(), for: "Text")
        let collector = Collector()
        let engine = try MilanoEngine(vocabularyJSON: vocabulary, registry: registry, observer: collector)
        let context = MilanoContextHandle(["who": .string("Ada")])
        let view = try await engine.viewBuilder(document: document)
            .contextSource(context)
            .stateData { _ in ["divisor": .int(0), "other": .int(0)] }
            .dispatcher(InlineDispatcher())
            .build()
        return (view, collector, context)
    }

    @Test func dependenciesAreCollectedThroughEveryConstruct() throws {
        let expr = try ExprParser.parse("$if(state.flag, context.a ?? 'x', $str(state.n + -state.m))")
        #expect(expr.dependencies == ["state.flag", "context.a", "state.n", "state.m"])
        #expect(try ExprParser.parse("state.person.name").dependencies == ["state.person"])
        #expect(try ExprParser.parse("1 + 2").dependencies.isEmpty)
    }

    @Test func anUnrelatedKeyReEvaluatesNothingAndNotifiesNoOne() async throws {
        let (view, collector, _) = try await build()
        #expect(collector.collected.filter { $0.kind == .divisionByZero }.count == 1)
        nonisolated(unsafe) var notified = 0
        view.core.onChange = { notified += 1 }
        view.emit(node: "buttons", event: "tap")
        #expect(view.state["other"] == .int(1))
        #expect(collector.collected.filter { $0.kind == .divisionByZero }.count == 1)
        #expect(notified == 0)
    }

    @Test func aDependentPropertyReEvaluatesAndTheHostHearsOnce() async throws {
        let (view, _, context) = try await build()
        nonisolated(unsafe) var notified = 0
        view.core.onChange = { notified += 1 }
        context.update(["who": .string("Grace")])
        #expect(view.resolvedRoot.children[1].values["text"] == .string("hi Grace"))
        #expect(notified == 1)
    }

    @Test func aContextUpdateThatChangesNoValueDoesNothing() async throws {
        let (view, collector, context) = try await build()
        nonisolated(unsafe) var notified = 0
        view.core.onChange = { notified += 1 }
        context.update(["who": .string("Ada")])
        #expect(notified == 0)
        #expect(!collector.collected.contains { $0.kind == .rejectedContextUpdate })
    }
}
