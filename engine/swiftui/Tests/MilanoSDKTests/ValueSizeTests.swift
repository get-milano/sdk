import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// The value size limit: the document model's one runtime bound, applied
/// wherever a value enters state or context. The conformance suite pins
/// the observable behavior at a configured limit; this pins the metric on
/// every value shape, the default, and the shape of the list stop through
/// nested action constructs.
struct ValueSizeTests {

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
        {"milano": "1.0.0", "name": "limits", "version": "1.0.0",
         "components": {"Text": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {}}
        """.utf8)

    @Test func theSizeMetric() {
        #expect(MilanoValue.null.size == 1)
        #expect(MilanoValue.bool(true).size == 1)
        #expect(MilanoValue.int(.max).size == 1)
        #expect(MilanoValue.double(2.5).size == 1)
        #expect(MilanoValue.string("").size == 0)
        #expect(MilanoValue.string("abcdefg\u{1F600}").size == 8)
        #expect(MilanoValue.array([]).size == 1)
        #expect(MilanoValue.array([.string("ab"), .string("cd")]).size == 5)
        #expect(MilanoValue.record(["a": .array([.int(1), .int(2)]), "b": .string("xyz")]).size == 7)
        #expect(MilanoLimits().maxValueSize == 65_536)
    }

    private func build(
        _ document: String, state: [String: MilanoValue], context: MilanoContextHandle? = nil
    ) async throws -> (MilanoView, Collector) {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Text")
        let collector = Collector()
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry,
            limits: MilanoLimits(maxValueSize: 8), observer: collector)
        let builder = engine.viewBuilder(documentText: document)
            .stateData { _ in state }
            .dispatcher(InlineDispatcher())
        if let context { builder.contextSource(context) }
        return (try await builder.build(), collector)
    }

    @Test func aRejectedSetStopsTheListThroughSequenceAndWhen() async throws {
        let (view, collector) = try await build("""
            {"version": "1.0.0", "state": {"s": "string", "n": "int"},
             "root": {"type": "Text", "id": "t", "properties": {"text": {"$expr": "state.s"}},
              "on": {"tap": [
                {"action": "$set", "key": "n", "value": {"$expr": "state.n + 1"}},
                {"action": "$when", "condition": true, "then": [
                  {"action": "$sequence", "actions": [
                    {"action": "$set", "key": "s", "value": {"$expr": "concat(state.s, state.s)"}}]},
                  {"action": "$set", "key": "n", "value": {"$expr": "state.n + 10"}}]},
                {"action": "$set", "key": "n", "value": {"$expr": "state.n + 100"}}]}}}
            """, state: ["s": .string("abcde"), "n": .int(0)])
        view.emit(node: "t", event: "tap")
        #expect(view.state["s"] == .string("abcde"))
        #expect(view.state["n"] == .int(1))
        #expect(collector.collected.map { [$0.kind.rawValue, $0.node, $0.name, $0.expected, $0.found] }
            == [["rejectedMutation", "t", "s", "maxValueSize", "10"]])
    }

    @Test func aSetExactlyAtTheLimitIsAcceptedAndOnePastItIsNot() async throws {
        let (view, collector) = try await build("""
            {"version": "1.0.0", "state": {"s": "string"},
             "root": {"type": "Text", "id": "t", "properties": {"text": {"$expr": "state.s"}},
              "on": {"tap": [{"action": "$set", "key": "s", "value": {"$expr": "concat(state.s, 'x')"}}]}}}
            """, state: ["s": .string("abcdefg")])
        view.emit(node: "t", event: "tap")
        #expect(view.state["s"] == .string("abcdefgx"))
        view.emit(node: "t", event: "tap")
        #expect(view.state["s"] == .string("abcdefgx"))
        #expect(collector.collected.filter { $0.kind == .rejectedMutation }.count == 1)
    }

    @Test func aContextUpdatePastTheLimitIsRejectedWhole() async throws {
        let handle = MilanoContextHandle(["who": .string("Ada"), "n": .int(1)])
        let (view, collector) = try await build("""
            {"version": "1.0.0", "context": {"who": "string", "n": "int"},
             "root": {"type": "Text", "id": "t",
              "properties": {"text": {"$expr": "concat(context.who, str(context.n))"}}}}
            """, state: [:], context: handle)
        handle.update(["who": .string("a very long name"), "n": .int(2)])
        #expect(view.resolvedRoot.values["text"] == .string("Ada1"))
        #expect(collector.collected.map { [$0.kind.rawValue, $0.name, $0.expected, $0.found] }
            == [["rejectedContextUpdate", "who", "maxValueSize", "16"]])
    }

    @Test func initialValuesPastTheLimitAreRefusedAtTheGate() async throws {
        await #expect(throws: MilanoBuildError.limitExceeded(limit: "maxValueSize", value: 8, actual: 9)) {
            _ = try await build("""
                {"version": "1.0.0", "state": {"s": "string"},
                 "root": {"type": "Text", "id": "t", "properties": {"text": {"$expr": "state.s"}}}}
                """, state: ["s": .string("nine char")])
        }
    }
}
