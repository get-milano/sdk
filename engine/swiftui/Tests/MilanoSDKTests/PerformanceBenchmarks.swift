import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Coarse performance benchmarks over synthetic documents: cold build
/// (parse, gate, first resolution) and the update path (event dispatch,
/// built-in actions, re-resolution) across tree sizes. Medians are printed
/// as a table; the assertions are generous order-of-magnitude ceilings so
/// CI catches regressions without flaking on runner noise. Methodology and
/// published numbers live in docs/performance.md.
struct PerformanceBenchmarks {

    private final class StubRenderer: MilanoRenderer {
        func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
    }

    private final class PumpDispatcher: MilanoDispatcher, @unchecked Sendable {
        private var queue: [@Sendable () -> Void] = []
        func dispatch(_ work: @escaping @Sendable () -> Void) { queue.append(work) }
        func pump() {
            while !queue.isEmpty { queue.removeFirst()() }
        }
    }

    private let vocabulary = Data("""
        {
          "milano": "1.0.0", "name": "bench", "version": "1.0.0",
          "components": {
            "Column": {"children": true},
            "Text": {"properties": {"text": "string"}},
            "Field": {"properties": {"value": "string"}, "events": {"change": "string"}}
          }
        }
        """.utf8)

    /// A wide tree: one Field plus `nodes` Texts, every other Text bound to
    /// state.value through an expression, the rest literal.
    private func document(nodes: Int) -> Data {
        var children = """
            {"type": "Field", "id": "field", \
            "properties": {"value": {"$expr": "state.value"}}, \
            "on": {"change": [{"action": "$set", "key": "value", "value": {"$expr": "event"}}]}}
            """
        for index in 0..<nodes {
            children += ","
            children += index.isMultiple(of: 2)
                ? #"{"type": "Text", "properties": {"text": {"$expr": "concat('v', state.value)"}}}"#
                : #"{"type": "Text", "properties": {"text": "static \#(index)"}}"#
        }
        let text = """
            {"version": "1.0.0", "state": {"value": "string"}, \
            "root": {"type": "Column", "id": "root", "children": [\(children)]}}
            """
        return Data(text.utf8)
    }

    private func median(_ samples: [Double]) -> Double {
        samples.sorted()[samples.count / 2]
    }

    @Test func buildAndUpdateLatency() async throws {
        var registry = MilanoRegistry()
        for type in ["Column", "Text", "Field"] { registry.register(StubRenderer(), for: type) }
        let engine = try MilanoEngine(vocabularyJSON: vocabulary, registry: registry)

        let sizes = [10, 100, 1000, 5000]
        var results: [(Int, Double, Double)] = []
        let clock = ContinuousClock()

        for nodes in sizes {
            let documentData = document(nodes: nodes)
            let iterations = nodes >= 1000 ? 5 : 25

            func build() async throws -> (MilanoView, PumpDispatcher) {
                let pump = PumpDispatcher()
                let builder = engine.viewBuilder(document: documentData)
                builder.dispatcher(pump)
                builder.stateData { _ in ["value": .string("0")] }
                return (try await builder.build(), pump)
            }

            _ = try await build()
            var buildSamples: [Double] = []
            for _ in 0..<iterations {
                let start = clock.now
                _ = try await build()
                buildSamples.append(Double(clock.now - start))
            }

            // The update path: one event dispatch, $set, full re-resolution.
            let (view, pump) = try await build()
            var tick = 0
            func update() {
                tick += 1
                view.emit(node: "field", event: "change", payload: .string("\(tick)"))
                pump.pump()
            }
            update()
            var updateSamples: [Double] = []
            for _ in 0..<(iterations * 4) {
                let start = clock.now
                update()
                updateSamples.append(Double(clock.now - start))
            }
            results.append((nodes, median(buildSamples), median(updateSamples)))
        }

        print("nodes | cold build (ms) | update (ms)")
        for (nodes, build, update) in results {
            print(String(format: "%5d | %15.3f | %11.3f", nodes, build, update))
        }

        // Order-of-magnitude regression guards, deliberately loose.
        let largest = results.last!
        #expect(largest.1 < 5_000, "cold build of 5000 nodes took \(largest.1)ms")
        #expect(largest.2 < 2_000, "update on 5000 nodes took \(largest.2)ms")
    }
}

private extension Double {
    /// Milliseconds from a clock duration.
    init(_ duration: Duration) {
        let (seconds, attoseconds) = duration.components
        self = Double(seconds) * 1_000 + Double(attoseconds) / 1e15
    }
}
