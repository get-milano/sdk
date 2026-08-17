import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Resource limits at their exact boundaries, at the defaults and through
/// the engine's limits configuration. Tree depth and expression length are
/// pinned by conformance vectors; node count and document size, whose
/// boundary vectors would be megabyte-scale, are pinned here, per the
/// conformance suite spec.
struct EngineLimitsTests {

    private struct InlineDispatcher: MilanoDispatcher {
        func dispatch(_ work: @escaping @Sendable () -> Void) { work() }
    }

    private final class StubRenderer: MilanoRenderer {
        func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
    }

    private let vocabulary = Data("""
        {"milano": "1.0.0", "name": "limits", "version": "1.0.0",
         "components": {
            "Text": {"properties": {"text": "string"}},
            "Column": {"children": true}}}
        """.utf8)

    private func engine(limits: MilanoLimits = MilanoLimits()) throws -> MilanoEngine {
        var registry = MilanoRegistry()
        registry.register(StubRenderer(), for: "Text")
        registry.register(StubRenderer(), for: "Column")
        return try MilanoEngine(
            vocabularyJSON: vocabulary, registry: registry, limits: limits)
    }

    private func buildError(
        _ document: Data, limits: MilanoLimits = MilanoLimits()
    ) async throws -> MilanoBuildError? {
        let builder = try engine(limits: limits)
            .viewBuilder(document: document)
            .dispatcher(InlineDispatcher())
        do {
            _ = try await builder.build()
            return nil
        } catch let error as MilanoBuildError {
            return error
        }
    }

    /// A wide document: one Column root with `count - 1` Text children.
    private func wideDocument(nodes count: Int) -> Data {
        var json = #"{"version": "1.0.0", "root": {"type": "Column", "children": ["#
        json += (0..<(count - 1))
            .map { _ in #"{"type": "Text", "properties": {"text": "x"}}"# }
            .joined(separator: ",")
        json += "]}}"
        return Data(json.utf8)
    }

    @Test func defaultsMatchTheContract() {
        let limits = MilanoLimits()
        #expect(limits.maxTreeDepth == 32)
        #expect(limits.maxNodeCount == 10_000)
        #expect(limits.maxDocumentBytes == 1_048_576)
        #expect(limits.maxExpressionLength == 1_024)
    }

    @Test func nodeCountBoundaryAtTheDefault() async throws {
        // Exactly at the limit passes; one over is a typed gate error.
        #expect(try await buildError(wideDocument(nodes: 10_000)) == nil)
        #expect(
            try await buildError(wideDocument(nodes: 10_001))
                == .limitExceeded(limit: "maxNodeCount", value: 10_000, actual: 10_001))
    }

    @Test func documentBytesBoundaryAtTheDefault() async throws {
        // Pad a small valid document with insignificant whitespace to the
        // exact byte boundary; the size check runs on raw bytes, before
        // parsing.
        let core = #"{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}"#
        let padding = String(repeating: " ", count: 1_048_576 - core.utf8.count)
        #expect(try await buildError(Data((core + padding).utf8)) == nil)
        #expect(
            try await buildError(Data((core + padding + " ").utf8))
                == .limitExceeded(
                    limit: "maxDocumentBytes", value: 1_048_576, actual: 1_048_577))
    }

    @Test func configuredLimitsOverrideTheDefaults() async throws {
        let tight = MilanoLimits(
            maxTreeDepth: 2, maxNodeCount: 3, maxDocumentBytes: 200, maxExpressionLength: 8)

        // Depth 3 under a limit of 2.
        let deep = Data(#"""
            {"version": "1.0.0", "root": {"type": "Column", "children": [
                {"type": "Column", "children": [
                    {"type": "Text", "properties": {"text": "x"}}]}]}}
            """#.utf8)
        #expect(
            try await buildError(deep, limits: tight)
                == .limitExceeded(limit: "maxTreeDepth", value: 2, actual: 3))

        // Four nodes under a limit of 3 (depth kept within bounds).
        let wide = Data(#"""
            {"version": "1.0.0", "root": {"type": "Column", "children": [
                {"type": "Text", "properties": {"text": "a"}},
                {"type": "Text", "properties": {"text": "b"}},
                {"type": "Text", "properties": {"text": "c"}}]}}
            """#.utf8)
        #expect(
            try await buildError(wide, limits: MilanoLimits(maxNodeCount: 3))
                == .limitExceeded(limit: "maxNodeCount", value: 3, actual: 4))

        // A nine-character expression under a limit of 8.
        let expression = Data(#"""
            {"version": "1.0.0", "root": {"type": "Text",
             "properties": {"text": {"$expr": "'abcdefg'"}}}}
            """#.utf8)
        #expect(
            try await buildError(expression, limits: MilanoLimits(maxExpressionLength: 8))
                == .limitExceeded(limit: "maxExpressionLength", value: 8, actual: 9))

        // A document over a tiny byte budget.
        let anything = Data(#"{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}"#.utf8)
        #expect(
            try await buildError(anything, limits: MilanoLimits(maxDocumentBytes: 10))
                == .limitExceeded(limit: "maxDocumentBytes", value: 10, actual: anything.count))
    }
}
