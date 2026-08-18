import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Regression pins for the spec-alignment audit: each test failed against
/// the pre-audit engine and passes against the aligned one.
struct SpecAlignmentTests {

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
        {"milano": "1.0.0", "name": "align", "version": "1.0.0",
         "components": {
            "Text": {"properties": {"text": "string"},
                     "events": {"tap": null}}},
         "actions": {"work": {}}}
        """.utf8)

    private func engine(
        observer: MilanoObserver? = nil, limits: MilanoLimits = MilanoLimits()
    ) throws -> MilanoEngine {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Text")
        return try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry,
            limits: limits, observer: observer)
    }

    /// The engine retains its observer: an observer passed inline, with no
    /// other strong reference, must stay alive for the engine's lifetime.
    /// Pre-fix the reference was weak and every occurrence was lost.
    @Test func engineRetainsItsObserver() throws {
        weak var weakCollector: Collector?
        let engine: MilanoEngine
        do {
            let collector = Collector()
            weakCollector = collector
            engine = try self.engine(observer: collector)
        }
        _ = engine
        #expect(weakCollector != nil)
    }

    /// A completion for a deallocated view (deallocation counts as
    /// teardown) is reported, never dropped silently. Pre-fix the weak-self
    /// task returned without reporting.
    @Test func completionForDeallocatedViewIsReported() async throws {
        let collector = Collector()
        let gate = AsyncStream<Void>.makeStream()
        let handler = MilanoClosureActionHandler { _ in
            for await _ in gate.stream { break }
            return nil
        }

        var view: MilanoView? = try await engine(observer: collector)
            .viewBuilder(document: Data("""
                {"version": "1.0.0",
                 "root": {"type": "Text", "id": "t",
                          "properties": {"text": "x"},
                          "on": {"tap": [{"action": "work"}]}}}
                """.utf8))
            .actionHandler(handler)
            .dispatcher(InlineDispatcher())
            .build()

        view?.emit(node: "t", event: "tap")
        view = nil  // released mid-handler, without teardown()
        gate.continuation.yield()
        gate.continuation.finish()

        for _ in 0..<500 {
            if collector.collected.contains(where: { $0.kind == .completionAfterTeardown }) {
                break
            }
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        #expect(collector.collected.contains { $0.kind == .completionAfterTeardown })
    }

    /// A context update posted re-entrantly (from the re-resolution hook,
    /// mid-action-list) never lands between two actions of the same list.
    /// Pre-fix it applied immediately and the second action saw it.
    @Test func contextUpdateNeverLandsMidActionList() async throws {
        let document = Data("""
            {"version": "1.0.0",
             "context": {"c": "string"},
             "state": {"a": "int", "b": "string"},
             "root": {"type": "Text", "id": "t",
                      "properties": {"text": {"$expr": "state.b"}},
                      "on": {"tap": [
                          {"action": "$set", "key": "a", "value": 1},
                          {"action": "$set", "key": "b",
                           "value": {"$expr": "context.c"}}]}}}
            """.utf8)
        let view = try await engine()
            .viewBuilder(document: document)
            .context(["c": .string("old")])
            .stateData { _ in ["a": .int(0), "b": .string("")] }
            .dispatcher(InlineDispatcher())
            .build()

        // The first $set re-resolves and fires onChange; posting an update
        // there is the re-entrant, same-thread case.
        var posted = false
        view.core.onChange = { [weak core = view.core] in
            if !posted {
                posted = true
                core?.applyContextUpdate(["c": .string("new")])
            }
        }
        view.emit(node: "t", event: "tap")

        // The second action still saw the pre-update context; the update
        // applied after the list completed.
        #expect(view.state["b"] == .string("old"))
        #expect(view.core.context["c"] == .string("new"))
    }

    /// Teardown cancels the context subscription, so a source never retains
    /// callbacks for views that are gone. Pre-fix subscribe returned
    /// nothing and the source accumulated subscribers forever.
    @Test func teardownCancelsTheContextSubscription() async throws {
        final class RecordingSource: MilanoContextSource, @unchecked Sendable {
            let current: [String: MilanoValue] = ["c": .string("v")]
            var cancelled = false
            func subscribe(
                _ onUpdate: @escaping @Sendable ([String: MilanoValue]) -> Void
            ) -> @Sendable () -> Void {
                { [weak self] in self?.cancelled = true }
            }
        }
        let source = RecordingSource()
        let view = try await engine()
            .viewBuilder(document: Data("""
                {"version": "1.0.0", "context": {"c": "string"},
                 "root": {"type": "Text",
                          "properties": {"text": {"$expr": "context.c"}}}}
                """.utf8))
            .contextSource(source)
            .dispatcher(InlineDispatcher())
            .build()
        #expect(!source.cancelled)
        view.teardown()
        #expect(source.cancelled)
    }

    /// A cancelled MilanoContextHandle subscription receives no further
    /// updates.
    @Test func handleCancellationStopsUpdates() {
        let handle = MilanoContextHandle(["c": .string("v")])
        nonisolated(unsafe) var received = 0
        let cancel = handle.subscribe { _ in received += 1 }
        handle.update(["c": .string("1")])
        #expect(received == 1)
        cancel()
        handle.update(["c": .string("2")])
        #expect(received == 1)
    }

    /// The document's metadata section reaches the host verbatim.
    @Test func metadataReachesTheHost() async throws {
        let view = try await engine()
            .viewBuilder(document: Data("""
                {"version": "1.0.0",
                 "metadata": {"campaign": "summer-2026"},
                 "root": {"type": "Text", "properties": {"text": "x"}}}
                """.utf8))
            .dispatcher(InlineDispatcher())
            .build()
        #expect(view.metadata == .record(["campaign": .string("summer-2026")]))

        let bare = try await engine()
            .viewBuilder(document: Data("""
                {"version": "1.0.0",
                 "root": {"type": "Text", "properties": {"text": "x"}}}
                """.utf8))
            .dispatcher(InlineDispatcher())
            .build()
        #expect(bare.metadata == nil)
    }

    /// The expression-length limit is counted in Unicode scalars: combining
    /// sequences with fewer grapheme clusters than scalars still exceed the
    /// limit. Pre-fix Swift counted grapheme clusters and accepted this.
    @Test func expressionLimitCountsUnicodeScalars() async throws {
        // 30 e-plus-combining-acute pairs: 30 graphemes, 60 scalars, in an
        // expression of 75 scalars against a limit of 74.
        let padding = String(repeating: "e\u{0301}", count: 30)
        let expr = "concat('\(padding)', 'y')"
        #expect(expr.unicodeScalars.count == 75)
        let document = Data("""
            {"version": "1.0.0",
             "root": {"type": "Text", "id": "t",
                      "properties": {"text": {"$expr": "\(expr)"}}}}
            """.utf8)
        do {
            _ = try await engine(limits: MilanoLimits(maxExpressionLength: 74))
                .viewBuilder(document: document)
                .dispatcher(InlineDispatcher())
                .build()
            Issue.record("expected LimitExceeded")
        } catch let error as MilanoBuildError {
            #expect(error == .limitExceeded(
                limit: "maxExpressionLength", value: 74, actual: 75))
        }
    }

    /// The work queue is released on every exit from the drain, so a view
    /// stays usable no matter how a listener behaves. Swift's non-throwing
    /// closures make a throwing listener unreachable, which is why this
    /// pins the property the other engines' regression test pins: the
    /// drain completes, the flag is released, and re-entrant work posted
    /// from the hook runs after the list rather than never.
    @Test func theWorkQueueIsReleasedAfterEveryDrain() async throws {
        let document = Data("""
            {"version": "1.0.0",
             "state": {"a": "int"},
             "root": {"type": "Text", "id": "t",
                      "properties": {"text": {"$expr": "str(state.a)"}},
                      "on": {"tap": [{"action": "$set", "key": "a",
                                      "value": {"$expr": "state.a + 1"}}]}}}
            """.utf8)
        let view = try await engine()
            .viewBuilder(document: document)
            .stateData { _ in ["a": .int(0)] }
            .dispatcher(InlineDispatcher())
            .build()

        // A re-entrant emission from the hook: it must run, and after the
        // list that provoked it.
        var reentered = false
        view.core.onChange = { [weak core = view.core] in
            if !reentered {
                reentered = true
                core?.emit(node: "t", event: "tap")
            }
        }
        view.emit(node: "t", event: "tap")
        #expect(view.state["a"] == .int(2))

        // And the view keeps working afterwards: nothing stayed behind a
        // flag that was never reset.
        view.core.onChange = nil
        view.emit(node: "t", event: "tap")
        #expect(view.state["a"] == .int(3))
    }

    /// Teardown observed mid-list does not interrupt the list: state and
    /// actions spec, Completion. Pinned here because a conformance vector
    /// cannot express it (steps run between events, never inside one).
    @Test func teardownDuringAnActionListDoesNotInterruptIt() async throws {
        final class Analytics: MilanoUserInteractionObserver, @unchecked Sendable {
            var kinds: [(MilanoUserInteraction.Kind, String?)] = []
            func interaction(_ interaction: MilanoUserInteraction) {
                kinds.append((interaction.kind, interaction.name))
            }
        }

        let document = Data("""
            {"version": "1.0.0",
             "state": {"a": "int"},
             "root": {"type": "Text", "id": "t",
                      "properties": {"text": {"$expr": "str(state.a)"}},
                      "on": {"tap": [
                          {"action": "$set", "key": "a", "value": 1},
                          {"action": "work"},
                          {"action": "$set", "key": "a", "value": 42}]}}}
            """.utf8)
        let analytics = Analytics()
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Text")
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry,
            userInteractionObserver: analytics)
        let view = try await engine
            .viewBuilder(document: document)
            .stateData { _ in ["a": .int(0)] }
            .actionHandler { _ in nil }
            .dispatcher(InlineDispatcher())
            .build()

        // The first $set re-resolves and fires the hook, which tears the
        // view down. The rest of the list still runs: the custom action is
        // dispatched (the handler's own invocation is asynchronous, so the
        // synchronous evidence is the analytics record) and the trailing
        // $set applies.
        view.core.onChange = { [weak core = view.core] in core?.teardown() }
        view.emit(node: "t", event: "tap")

        #expect(analytics.kinds.contains { $0.0 == .actionDispatched && $0.1 == "work" })
        #expect(view.state["a"] == .int(42))

        // Torn down all the same: nothing after the list is accepted.
        view.emit(node: "t", event: "tap")
        #expect(view.state["a"] == .int(42))
    }
}
