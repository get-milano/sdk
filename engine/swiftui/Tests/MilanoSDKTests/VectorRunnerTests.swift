import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Executes every conformance vector: build scenarios and stepped
/// interaction scenarios (events, context updates, completions, lifecycle
/// signals, replacements, teardown).
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

    /// The harness's function handler: a table of cases per function, each
    /// answering (or throwing for) one argument tuple; a call the table has
    /// no case for is a vector defect.
    private struct TableFunctionHandler: MilanoFunctionHandler {
        struct Throws: Error {}
        let vector: String
        let results: [String: MilanoValue]

        func call(_ call: MilanoFunctionCall) throws -> MilanoValue {
            for entry in results[call.name]?.arrayValue ?? [] {
                guard case .record(let fields) = entry,
                    fields["arguments"]?.arrayValue ?? [] == call.arguments
                else { continue }
                if fields["throws"] != nil { throw Throws() }
                return fields["returns"] ?? .null
            }
            let message = "\(vector): host function \(call.name) called with \(call.arguments), "
                + "no case in config.functions.results"
            Issue.record(Comment(rawValue: message))
            return .null
        }
    }

    /// What the state data provider answers: the vector's values at build,
    /// then a replace step's values for the keys it is asked for.
    private final class SuppliedState: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String: MilanoValue]

        init(_ values: [String: MilanoValue]) {
            self.values = values
        }

        var current: [String: MilanoValue] {
            lock.lock()
            defer { lock.unlock() }
            return values
        }

        func set(_ values: [String: MilanoValue]) {
            lock.lock()
            self.values = values
            lock.unlock()
        }
    }

    /// A replacement's outcome, settled by the task that requested it.
    private final class ReplaceOutcome: @unchecked Sendable {
        private let lock = NSLock()
        private var settled = false
        private var failure: (any Error)?

        var done: Bool {
            lock.lock()
            defer { lock.unlock() }
            return settled
        }

        var error: (any Error)? {
            lock.lock()
            defer { lock.unlock() }
            return failure
        }

        func settle(_ error: (any Error)?) {
            lock.lock()
            failure = error
            settled = true
            lock.unlock()
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

    /// A document as the vector carries it: text verbatim, or the JSON
    /// object serialized.
    private func documentData(_ carrier: [String: MilanoValue]) throws -> Data {
        if case .string(let text)? = carrier["documentText"] {
            return Data(text.utf8)
        }
        return try JSONSerialization.data(withJSONObject: foundation(carrier["document"] ?? .null))
    }

    /// Drives a replacement to its outcome: the gate and the provider run
    /// on the replacing task, and the swap lands when the pump runs, so
    /// the pump is turned until the task settles.
    private func replace(_ view: MilanoView, with data: Data, pump: PumpDispatcher) async -> (any Error)? {
        let outcome = ReplaceOutcome()
        let task = Task {
            do {
                try await view.replace(document: data)
                outcome.settle(nil)
            } catch {
                outcome.settle(error)
            }
        }
        while !outcome.done {
            pump.pump()
            await Task.yield()
        }
        await task.value
        return outcome.error
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
        print("      conformance: \(executed) vectors")
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

        let surface = vector["config"]?.recordValue ?? [:]
        var policy = MilanoUnknownTypePolicy.fail
        if case .string(let configured)? = surface["unknownTypePolicy"],
            let parsed = MilanoUnknownTypePolicy(rawValue: configured) {
            policy = parsed
        }

        // Engine limits: the defaults, overridden by name from the vector's config.
        var limits = MilanoLimits()
        if case .record(let overrides)? = surface["limits"] {
            for (limit, value) in overrides {
                guard case .int(let configured) = value else { continue }
                switch limit {
                case "maxTreeDepth": limits.maxTreeDepth = Int(configured)
                case "maxNodeCount": limits.maxNodeCount = Int(configured)
                case "maxDocumentBytes": limits.maxDocumentBytes = Int(configured)
                case "maxExpressionLength": limits.maxExpressionLength = Int(configured)
                case "maxValueSize": limits.maxValueSize = Int(configured)
                default: Issue.record("unknown limit \(limit) in config.limits")
                }
            }
        }

        // The harness's function handler answers from the vector's table;
        // absent when the config says the surface has none.
        let functionsConfig = surface["functions"]?.recordValue ?? [:]
        var functionHandler: (any MilanoFunctionHandler)?
        if surface["functionHandler"] != .bool(false) {
            functionHandler = TableFunctionHandler(
                vector: name, results: functionsConfig["results"]?.recordValue ?? [:])
        }

        let collector = OccurrenceCollector()
        let interactions = InteractionCollector()
        let engine = try MilanoEngine(
            vocabularyJSON: vocabularyJSON, registry: registry,
            defaultUnknownTypePolicy: policy, limits: limits, observer: collector,
            userInteractionObserver: interactions, functionHandler: functionHandler)

        let builder = engine.viewBuilder(document: try documentData(vector))
        let pump = PumpDispatcher()
        builder.label(name)

        // The surface's action grants, per the vector's config.
        if case .record(let actionsConfig)? = surface["actions"] {
            if case .array(let allowed)? = actionsConfig["allow"] {
                builder.allowActions(allowed.compactMap { $0.stringValue })
            }
            if case .record(let declared)? = actionsConfig["declare"] {
                for (actionName, declaration) in declared {
                    var parameters: [String: MilanoType] = [:]
                    var result: MilanoType?
                    var failure: MilanoType?
                    if case .record(let fields) = declaration {
                        if case .record(let descriptors)? = fields["parameters"] {
                            for (parameter, descriptor) in descriptors {
                                parameters[parameter] = MilanoType(descriptor: descriptor)
                            }
                        }
                        if let descriptor = fields["result"] {
                            result = MilanoType(descriptor: descriptor)
                        }
                        if let descriptor = fields["failure"] {
                            failure = MilanoType(descriptor: descriptor)
                        }
                    }
                    builder.action(
                        actionName, parameters: parameters.compactMapValues { $0 },
                        result: result, failure: failure)
                }
            }
        }
        // The surface's host function declarations, per the vector's config.
        if case .record(let declared)? = functionsConfig["declare"] {
            for (functionName, declaration) in declared {
                guard case .record(let fields) = declaration,
                    case .array(let descriptors)? = fields["arguments"],
                    let returnsDescriptor = fields["returns"],
                    let returns = MilanoType(descriptor: returnsDescriptor)
                else {
                    Issue.record("\(name): malformed function declaration \(functionName)")
                    continue
                }
                builder.function(
                    functionName, arguments: descriptors.compactMap { MilanoType(descriptor: $0) },
                    returns: returns)
            }
        }
        builder.dispatcher(pump)
        // The surface's inputs: present unless the vector's config says not.
        if surface["actionHandler"] != .bool(false) {
            builder.actionHandler(NeverCompletingHandler())
        }

        let contextHandle: MilanoContextHandle
        if case .record(let context)? = vector["context"] {
            contextHandle = MilanoContextHandle(context)
        } else {
            contextHandle = MilanoContextHandle([:])
        }
        builder.contextSource(contextHandle)

        // The provider answers the vector's values at build and, for a
        // replacement, the replace step's values for the keys it is asked for.
        let supplied = SuppliedState(vector["state"]?.recordValue ?? [:])
        if surface["stateDataProvider"] != .bool(false) {
            builder.stateData { _ in supplied.current }
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

            // Steps: events, context updates, completions, lifecycle
            // signals, replacements, teardown.
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
                    } else if fields["appear"] != nil {
                        view.appear()
                        pump.pump()
                    } else if fields["disappear"] != nil {
                        view.disappear()
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
                    } else if case .record(let replacement)? = fields["replace"] {
                        supplied.set(replacement["state"]?.recordValue ?? [:])
                        let failure = await replace(view, with: try documentData(replacement), pump: pump)
                        if case .record(let expectedError)? = replacement["error"] {
                            if let error = failure as? MilanoBuildError {
                                #expect(
                                    matches(error.fields, expected: expectedError),
                                    "\(name): replacement error mismatch, produced \(error.fields)")
                            } else {
                                let message = "\(name): expected the replacement to fail with \(expectedError), "
                                    + "got \(String(describing: failure))"
                                Issue.record(Comment(rawValue: message))
                            }
                        } else if let failure {
                            Issue.record("\(name): unexpected replacement error \(failure)")
                        }
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
                        "parameters": .record(record.parameters),
                        "dispatch": .int(Int64(record.dispatch))
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
                    if let dispatch = produced.dispatch { snapshot["dispatch"] = .int(Int64(dispatch)) }
                    // An absent value is null, so a vector may pin it as such.
                    snapshot["value"] = produced.value ?? .null
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
                    if let value = produced.name { producedFields["name"] = .string(value) }
                    if let value = produced.expected { producedFields["expected"] = .string(value) }
                    if let value = produced.found { producedFields["found"] = .string(value) }
                    #expect(
                        matches(producedFields, expected: fields),
                        "\(name): occurrence \(index) mismatch: \(producedFields) vs \(fields)")
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
