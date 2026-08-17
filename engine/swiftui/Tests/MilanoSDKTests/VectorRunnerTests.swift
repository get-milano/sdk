import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Executes every conformance vector: build scenarios and stepped
/// interaction scenarios (events, context updates, completions, teardown).
struct VectorRunnerTests {

    private final class StubRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
}
    private final class StubPlaceholder: MilanoPlaceholderRenderer {
    func render(_ unknown: MilanoUnknownNode) -> AnyView { AnyView(EmptyView()) }
}

    private final class OccurrenceCollector: MilanoObserver {
        var collected: [MilanoOccurrence] = []
        func occurrence(_ occurrence: MilanoOccurrence) { collected.append(occurrence) }
    }

    private final class InteractionCollector: MilanoUserInteractionObserver, @unchecked Sendable {
        var collected: [MilanoUserInteraction] = []
        func interaction(_ interaction: MilanoUserInteraction) { collected.append(interaction) }
    }

    /// The harness serialization seam: work queues until pumped, so every
    /// step is deterministic.
    private final class PumpDispatcher: MilanoDispatcher, @unchecked Sendable {
        private let lock = NSLock()
        private var queue: [@Sendable () -> Void] = []

        func dispatch(_ work: @escaping @Sendable () -> Void) {
            lock.lock()
            queue.append(work)
            lock.unlock()
        }

        func pump() {
            while true {
                lock.lock()
                let next = queue.isEmpty ? nil : queue.removeFirst()
                lock.unlock()
                guard let next else { return }
                next()
            }
        }
    }

    /// Completions are scripted by steps, never by the handler: it suspends
    /// forever, and the runner drives the completion path directly.
    private struct NeverCompletingHandler: MilanoActionHandler {
        func handle(_ action: MilanoAction) async throws -> MilanoValue? {
            await withUnsafeContinuation { (_: UnsafeContinuation<Void, Never>) in }
            return nil
        }
    }

    private func vectorJSON(_ url: URL) throws -> [String: MilanoValue] {
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
        guard case .record(let vector)? = MilanoValue(json: raw) else {
            throw MilanoBuildError.malformedDocument(detail: "vector is not an object")
        }
        return vector
    }

    /// Subset match, per the suite's conventions.
    private func matches(_ produced: [String: MilanoValue], expected: [String: MilanoValue]) -> Bool {
        expected.allSatisfy { key, value in produced[key] == value }
    }

    private func snapshot(_ node: ResolvedNode) -> MilanoValue {
        var fields: [String: MilanoValue] = [
            "type": .string(node.type),
            "reference": .string(node.reference)
        ]
        if node.isPlaceholder { fields["placeholder"] = .bool(true) }
        if !node.values.isEmpty {
            fields["properties"] = .record(node.values)
        }
        if !node.children.isEmpty {
            fields["children"] = .array(node.children.map(snapshot))
        }
        return .record(fields)
    }

    @Test func allVectors() async throws {
        var executed = 0
        for suite in try SpecsLocator.suiteDirectories() {
            let vocabularyJSON = try Data(
                contentsOf: suite.appendingPathComponent("vocabulary.json"))
            let vocabulary = try MilanoVocabulary(artifactJSON: vocabularyJSON)

            let vectorFiles = try FileManager.default.contentsOfDirectory(
                at: suite, includingPropertiesForKeys: nil
            )
            .filter { $0.pathExtension == "json" && $0.lastPathComponent != "vocabulary.json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

            for file in vectorFiles {
                let vector = try vectorJSON(file)
                guard case .string(let name)? = vector["name"] else { continue }
                try await run(
                    vector: vector, name: name,
                    vocabulary: vocabulary, vocabularyJSON: vocabularyJSON)
                executed += 1
            }
        }
        #expect(executed >= 41, "expected the full starter suite, ran \(executed)")
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func run(
        vector: [String: MilanoValue], name: String,
        vocabulary: MilanoVocabulary, vocabularyJSON: Data
    ) async throws {
        var registry = MilanoRegistry()
        for type in vocabulary.components.keys {
            registry.register(StubRenderer(), for: type)
        }
        registry.registerPlaceholder(StubPlaceholder())

        var policy = MilanoUnknownTypePolicy.fail
        if case .record(let config)? = vector["config"],
            case .string(let configured)? = config["unknownTypePolicy"],
            let parsed = MilanoUnknownTypePolicy(rawValue: configured) {
            policy = parsed
        }

        let collector = OccurrenceCollector()
        let interactions = InteractionCollector()
        let engine = try MilanoEngine(
            vocabularyJSON: vocabularyJSON, registry: registry,
            defaultUnknownTypePolicy: policy, observer: collector,
            userInteractionObserver: interactions)

        let builder: MilanoViewBuilder
        if case .string(let text)? = vector["documentText"] {
            builder = engine.viewBuilder(documentText: text)
        } else {
            let documentJSON = try JSONSerialization.data(
                withJSONObject: foundation(vector["document"] ?? .null))
            builder = engine.viewBuilder(document: documentJSON)
        }
        let pump = PumpDispatcher()
        builder.label(name)

        // The surface's action grants, per the vector's config.
        if case .record(let config)? = vector["config"],
            case .record(let actionsConfig)? = config["actions"] {
            if case .array(let allowed)? = actionsConfig["allow"] {
                builder.allowActions(allowed.compactMap { $0.stringValue })
            }
            if case .record(let declared)? = actionsConfig["declare"] {
                for (actionName, declaration) in declared {
                    var parameters: [String: MilanoType] = [:]
                    var result: MilanoType?
                    if case .record(let fields) = declaration {
                        if case .record(let descriptors)? = fields["parameters"] {
                            for (parameter, descriptor) in descriptors {
                                parameters[parameter] = MilanoType(descriptor: descriptor)
                            }
                        }
                        if let descriptor = fields["result"] {
                            result = MilanoType(descriptor: descriptor)
                        }
                    }
                    builder.action(
                        actionName, parameters: parameters.compactMapValues { $0 },
                        result: result)
                }
            }
        }
        builder.dispatcher(pump)
        builder.actionHandler(NeverCompletingHandler())

        let contextHandle: MilanoContextHandle
        if case .record(let context)? = vector["context"] {
            contextHandle = MilanoContextHandle(context)
        } else {
            contextHandle = MilanoContextHandle([:])
        }
        builder.contextSource(contextHandle)

        if case .record(let state)? = vector["state"] {
            builder.stateData { _ in state }
        }

        guard case .record(let expect)? = vector["expect"] else {
            Issue.record("\(name): missing expect")
            return
        }

        do {
            let view = try await builder.build()

            if case .record(let expectedError)? = expect["error"] {
                Issue.record("\(name): expected error \(expectedError), build succeeded")
                return
            }

            // Steps: events, context updates, completions, teardown.
            if case .array(let steps)? = vector["steps"] {
                for step in steps {
                    guard case .record(let fields) = step else { continue }
                    if case .record(let event)? = fields["event"] {
                        guard case .string(let node)? = event["node"],
                            case .string(let eventName)? = event["name"]
                        else { continue }
                        view.emit(node: node, event: eventName, payload: event["payload"])
                        pump.pump()
                    } else if case .record(let update)? = fields["contextUpdate"] {
                        contextHandle.update(update)
                        pump.pump()
                    } else if fields["teardown"] != nil {
                        view.teardown()
                        pump.pump()
                    } else if case .record(let completion)? = fields["complete"] {
                        guard case .int(let index)? = completion["dispatch"],
                            case .string(let outcome)? = completion["outcome"]
                        else { continue }
                        let payload = completion["payload"]
                        pump.dispatch {
                            view.complete(
                                dispatchIndex: Int(index), success: outcome == "success",
                                payload: payload)
                        }
                        pump.pump()
                    }
                }
            }

            if let expectedView = expect["view"] {
                let produced = snapshot(view.resolvedRoot)
                #expect(produced == expectedView, "\(name): resolved tree mismatch")
            }
            if case .record(let expectedState)? = expect["state"] {
                #expect(view.state == expectedState, "\(name): state mismatch")
            }
            if case .array(let expectedDispatched)? = expect["dispatched"] {
                #expect(
                    view.dispatched.count == expectedDispatched.count,
                    "\(name): dispatch count")
                for (index, expected) in expectedDispatched.enumerated()
                where index < view.dispatched.count {
                    guard case .record(let fields) = expected else { continue }
                    let record = view.dispatched[index].action
                    let produced: [String: MilanoValue] = [
                        "action": .string(record.name),
                        "parameters": .record(record.parameters)
                    ]
                    #expect(
                        matches(produced, expected: fields),
                        "\(name): dispatch \(index) mismatch: \(produced) vs \(fields)")
                }
            }
            if case .array(let expectedInteractions)? = expect["interactions"] {
                #expect(
                    interactions.collected.count == expectedInteractions.count,
                    "\(name): interaction count, got \(interactions.collected.map(\.kind))")
                for (index, expected) in expectedInteractions.enumerated()
                where index < interactions.collected.count {
                    guard case .record(let fields) = expected else { continue }
                    let produced = interactions.collected[index]
                    var snapshot: [String: MilanoValue] = [
                        "kind": .string(produced.kind.rawValue)
                    ]
                    if let node = produced.node { snapshot["node"] = .string(node) }
                    if let name = produced.name { snapshot["name"] = .string(name) }
                    if let value = produced.value { snapshot["value"] = value }
                    #expect(
                        matches(snapshot, expected: fields),
                        "\(name): interaction \(index) mismatch, got \(snapshot)")
                }
            }
            if case .array(let expectedOccurrences)? = expect["occurrences"] {
                #expect(
                    collector.collected.count == expectedOccurrences.count,
                    "\(name): occurrence count, got \(collector.collected.map(\.kind))")
                for (index, expected) in expectedOccurrences.enumerated()
                where index < collector.collected.count {
                    guard case .record(let fields) = expected else { continue }
                    let produced = collector.collected[index]
                    var producedFields: [String: MilanoValue] = [
                        "kind": .string(produced.kind.rawValue)
                    ]
                    if let node = produced.node { producedFields["node"] = .string(node) }
                    #expect(
                        matches(producedFields, expected: fields),
                        "\(name): occurrence \(index) mismatch")
                }
            }
        } catch let error as MilanoBuildError {
            guard case .record(let expectedError)? = expect["error"] else {
                Issue.record("\(name): unexpected build error \(error)")
                return
            }
            #expect(
                matches(error.fields, expected: expectedError),
                "\(name): error mismatch, produced \(error.fields), expected \(expectedError)")
        }
    }

    /// MilanoValue back to a Foundation JSON object graph.
    private func foundation(_ value: MilanoValue) -> Any {
        switch value {
        case .null: return NSNull()
        case .bool(let v): return v
        case .int(let v): return v
        case .double(let v): return v
        case .string(let v): return v
        case .array(let values): return values.map(foundation)
        case .record(let values): return values.mapValues(foundation)
        }
    }
}
