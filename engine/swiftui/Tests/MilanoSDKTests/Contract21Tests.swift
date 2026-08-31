import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Contract 2.1 at the host boundary: what the conformance vectors cannot
/// reach because it lives in the engine's API rather than in documents.
/// Failure payloads travel through the real async funnel as a thrown
/// `MilanoActionFailure`; lifecycle signals arrive through the view's own
/// methods; every dispatch carries an identity the host can key on; host
/// functions are answered by the engine's handler; a replacement goes
/// through the view's own `replace`.
struct Contract21Tests {

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

    private final class InteractionCollector: MilanoUserInteractionObserver, @unchecked Sendable {
        var collected: [MilanoUserInteraction] = []
        func interaction(_ interaction: MilanoUserInteraction) { collected.append(interaction) }
    }

    private let vocabulary = Data("""
        {
          "milano": "2.1.0",
          "name": "contract21",
          "version": "1.0.0",
          "components": {
            "Button": {"properties": {"label": "string"}, "events": {"tap": null}}
          },
          "actions": {
            "submit": {"failure": {"enum": ["limit", "offline"]}},
            "lenient": {"failure": "string?"},
            "plain": {}
          },
          "functions": {
            "shout": {"arguments": ["string"], "returns": "string"}
          }
        }
        """.utf8)

    private func document(action: String) -> Data {
        let failureValue = action == "plain"
            ? "\"failed\""
            : action == "lenient"
                ? "{\"$expr\": \"$concat('failed: ', failure ?? 'unknown')\"}"
                : "{\"$expr\": \"$concat('failed: ', failure)\"}"
        return Data("""
            {
              "version": "2.1.0",
              "state": {"outcome": "string"},
              "root": {
                "type": "Button",
                "id": "b",
                "properties": {"label": {"$expr": "state.outcome"}},
                "on": {
                  "tap": [{
                    "action": "\(action)",
                    "onSuccess": [{"action": "$set", "key": "outcome", "value": "ok"}],
                    "onFailure": [{"action": "$set", "key": "outcome", "value": \(failureValue)}]
                  }]
                }
              },
              "on": {"appear": [{"action": "$set", "key": "outcome", "value": "appeared"}]}
            }
            """.utf8)
    }

    private func build(
        action: String,
        label: String? = nil,
        occurrences: OccurrenceCollector? = nil,
        interactions: InteractionCollector? = nil,
        handler: @escaping @Sendable (MilanoAction) async throws -> MilanoValue?
    ) async throws -> MilanoView {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Button")
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry,
            observer: occurrences, userInteractionObserver: interactions)
        let builder = engine.viewBuilder(document: document(action: action))
            .stateData { _ in ["outcome": .string("start")] }
            .actionHandler(handler)
            .dispatcher(InlineDispatcher())
        if let label { builder.label(label) }
        return try await builder.build()
    }

    private func waitUntil(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<500 where !condition() {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        #expect(condition())
    }

    // MARK: - Failure payloads

    @Test func aThrownMilanoActionFailureBindsTheFailureRoot() async throws {
        let interactions = InteractionCollector()
        let view = try await build(action: "submit", interactions: interactions) { _ in
            throw MilanoActionFailure(.string("limit"))
        }
        view.emit(node: "b", event: "tap")
        try await waitUntil { view.state["outcome"] == .string("failed: limit") }
        let completion = interactions.collected.first { $0.kind == .completionFailed }
        #expect(completion?.value == .string("limit"))
        #expect(completion?.dispatch == 0)
    }

    @Test func aPlainErrorIsAFailureWithNoPayload() async throws {
        struct Network: Error {}
        // Against a non-optional declaration: an invalid completion, neither
        // branch runs (state and actions spec, Completion).
        let collector = OccurrenceCollector()
        let strict = try await build(action: "submit", occurrences: collector) { _ in throw Network() }
        strict.emit(node: "b", event: "tap")
        try await waitUntil { collector.collected.contains { $0.kind == .invalidCompletion } }
        #expect(strict.state["outcome"] == .string("start"))
        #expect(collector.collected.first?.expected == "enum")
        #expect(collector.collected.first?.found == "null")

        // Against an optional declaration: failure is null and onFailure runs.
        let lenient = try await build(action: "lenient") { _ in throw Network() }
        lenient.emit(node: "b", event: "tap")
        try await waitUntil { lenient.state["outcome"] == .string("failed: unknown") }
    }

    @Test func aPayloadOutsideTheDeclaredEnumIsInvalid() async throws {
        let collector = OccurrenceCollector()
        let view = try await build(action: "submit", occurrences: collector) { _ in
            throw MilanoActionFailure(.string("teapot"))
        }
        view.emit(node: "b", event: "tap")
        try await waitUntil { collector.collected.contains { $0.kind == .invalidCompletion } }
        #expect(view.state["outcome"] == .string("start"))
    }

    @Test func anActionDeclaringNoFailureKeepsTheOldRule() async throws {
        let collector = OccurrenceCollector()
        let view = try await build(action: "plain", occurrences: collector) { _ in
            throw MilanoActionFailure(.string("x"))
        }
        view.emit(node: "b", event: "tap")
        try await waitUntil { collector.collected.contains { $0.kind == .invalidCompletion } }
        #expect(collector.collected.first?.expected == "no payload")
        #expect(view.state["outcome"] == .string("start"))
    }

    // MARK: - Lifecycle

    @Test func lifecycleSignalsRunBindingsOncePerAcceptance() async throws {
        let interactions = InteractionCollector()
        let view = try await build(action: "plain", interactions: interactions) { _ in nil }
        view.appear()
        view.appear()
        #expect(view.state["outcome"] == .string("appeared"))
        view.disappear()
        view.disappear()
        view.appear()
        #expect(
            interactions.collected.map(\.kind)
                == [.viewBuilt, .viewAppeared, .viewDisappeared, .viewAppeared])
        view.teardown()
        view.appear()
        #expect(interactions.collected.last?.kind == .viewTornDown)
    }

    // MARK: - Dispatch identity

    /// engine-pinned: dispatch-id-unique-across-views
    @Test func dispatchIdsAreUniqueAcrossViewsSharingALabel() async throws {
        final class Ids: @unchecked Sendable {
            let lock = NSLock()
            var seen: Set<String> = []
            var deliveries = 0
            func add(_ id: String) {
                lock.lock()
                seen.insert(id)
                deliveries += 1
                lock.unlock()
            }
        }
        let ids = Ids()
        for _ in 0..<3 {
            let view = try await build(action: "plain", label: "shared-label") { action in
                ids.add(action.dispatchId)
                return nil
            }
            view.emit(node: "b", event: "tap")
            view.emit(node: "b", event: "tap")
            // Two views with one label share an identity and a dispatch
            // number sequence; the id still tells every dispatch apart.
            #expect(view.dispatched.map(\.action.dispatch) == [0, 1])
            #expect(view.dispatched.first?.action.viewIdentity == "shared-label")
            view.teardown()
        }
        try await waitUntil { ids.deliveries == 6 }
        #expect(ids.seen.count == 6)
    }

    // MARK: - Host functions

    @Test func aFunctionHandlerAnswersTypedCallsAndAThrowIsAnInvalidResult() async throws {
        struct Unsupported: Error {}
        let collector = OccurrenceCollector()
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Button")
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry, observer: collector,
            functionHandler: MilanoClosureFunctionHandler { call in
                guard call.name == "shout", case .string(let text)? = call.arguments.first else {
                    throw Unsupported()
                }
                return .string(text.uppercased())
            })
        let view = try await engine.viewBuilder(documentText: """
            {"version": "2.1.0",
             "root": {"type": "Button", "id": "b",
                      "properties": {"label": {"$expr": "$concat(shout('hi'), fail(1))"}}}}
            """)
            .function("fail", arguments: [MilanoType(.int)], returns: MilanoType(.string))
            .dispatcher(InlineDispatcher())
            .build()
        // The declared function's answer stands; the builder-declared one
        // the handler does not know is an invalid result, the zero value
        // of a string, reported by the function's name.
        #expect(view.resolvedRoot.values["label"] == .string("HI"))
        #expect(collector.collected.map(\.kind) == [.invalidFunctionResult])
        #expect(collector.collected.first?.node == "b")
        #expect(collector.collected.first?.name == "fail")
        #expect(collector.collected.first?.expected == "string")
        #expect(collector.collected.first?.found == "error")
    }

    @Test func aDocumentCallingAFunctionNeedsAHandlerOnTheEngine() async throws {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Button")
        let engine = try MilanoEngine(vocabularyJSON: vocabulary, registry: registry)
        let builder = engine.viewBuilder(documentText: """
            {"version": "2.1.0",
             "root": {"type": "Button", "id": "b", "properties": {"label": {"$expr": "shout('hi')"}}}}
            """)
        await #expect(throws: MilanoBuildError.schemaViolation(
            rule: "function-handler", node: nil, expected: "function handler", found: nil)
        ) {
            try await builder.build()
        }
    }

    // MARK: - Document replacement

    /// engine-pinned: replace-provider-failure-propagates
    @Test func aProviderFailureDuringReplacementLeavesTheViewUntouched() async throws {
        struct ProviderDown: Error {}
        final class Calls: @unchecked Sendable {
            private let lock = NSLock()
            private(set) var count = 0
            func next() -> Int {
                lock.lock()
                defer { lock.unlock() }
                count += 1
                return count
            }
        }
        let calls = Calls()
        let interactions = InteractionCollector()
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Button")
        let engine = try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry, userInteractionObserver: interactions)
        let view = try await engine.viewBuilder(documentText: """
            {"version": "2.1.0", "state": {"a": "int"},
             "root": {"type": "Button", "id": "b", "properties": {"label": {"$expr": "$str(state.a)"}}}}
            """)
            .stateData { _ in
                if calls.next() > 1 { throw ProviderDown() }
                return ["a": .int(7)]
            }
            .dispatcher(InlineDispatcher())
            .build()

        // The provider fails for the key that does not carry over: the
        // error reaches the caller unchanged, and nothing about the view
        // moved.
        await #expect(throws: ProviderDown.self) {
            try await view.replace(documentText: """
                {"version": "2.1.0", "state": {"a": "int", "b": "string"},
                 "root": {"type": "Button", "id": "u", "properties": {"label": {"$expr": "state.b"}}}}
                """)
        }
        #expect(view.resolvedRoot.reference == "b")
        #expect(view.resolvedRoot.values["label"] == .string("7"))
        #expect(view.state["a"] == .int(7))
        #expect(interactions.collected.map(\.kind) == [.viewBuilt])

        // Still serviceable: a replacement that carries everything over
        // lands without consulting the provider again.
        try await view.replace(documentText: """
            {"version": "2.1.0", "state": {"a": "int"},
             "root": {"type": "Button", "id": "u", "properties": {"label": {"$expr": "$concat('a', $str(state.a))"}}}}
            """)
        #expect(view.resolvedRoot.reference == "u")
        #expect(view.resolvedRoot.values["label"] == .string("a7"))
        #expect(interactions.collected.map(\.kind) == [.viewBuilt, .viewReplaced])
        #expect(calls.count == 2)
    }
}
