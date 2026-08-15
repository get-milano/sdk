import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

/// Smoke tests: the rendering pipeline dispatches nodes to renderers
/// with resolved values, materialized children, and a working emission
/// surface.
struct RenderPipelineTests {

    private struct InlineDispatcher: MilanoDispatcher {
        func dispatch(_ work: @escaping @Sendable () -> Void) { work() }
    }

    /// Records what it receives; renders nothing.
    private final class RecordingRenderer: MilanoRenderer {
        var received: [(type: String, reference: String, values: [String: MilanoValue], childCount: Int)] = []
        var lastNode: MilanoNode?

        @MainActor func render(_ node: MilanoNode) -> AnyView {
            var values: [String: MilanoValue] = [:]
            for name in ["text", "label", "backgroundImageUrl", "enabled"] {
                let value = node.property(name)
                if value != .null { values[name] = value }
            }
            received.append((node.type, node.reference, values, node.children.count))
            lastNode = node
            // Materialize children so the whole tree renders.
            for child in node.children {
                _ = child.body
            }
            return AnyView(EmptyView())
        }
    }

    private func bannerEngine(renderer: RecordingRenderer) throws -> MilanoEngine {
        let specs = try #require(SpecsLocator.specsDirectory())
        let vocabularyJSON = try Data(
            contentsOf: specs.appendingPathComponent("conformance/examples/vocabulary.json"))
        let vocabulary = try MilanoVocabulary(artifactJSON: vocabularyJSON)
        var registry = MilanoRegistry()
        for type in vocabulary.components.keys {
            registry.register(renderer, for: type)
        }
        return try MilanoEngine(
            vocabularyJSON: vocabularyJSON, registry: registry, defaultUnknownTypePolicy: .skip)
    }

    @Test @MainActor func rendererReceivesResolvedNodeAndChildren() async throws {
        let specs = try #require(SpecsLocator.specsDirectory())
        let vectorURL = specs.appendingPathComponent("conformance/examples/banner-open-url.json")

        // Extract just the document from the vector file.
        let vectorObject = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: vectorURL)) as? [String: Any])
        let documentObject = try #require(vectorObject["document"])
        let document = try JSONSerialization.data(withJSONObject: documentObject)

        let renderer = RecordingRenderer()
        let engine = try bannerEngine(renderer: renderer)

        let view = try await engine.viewBuilder(document: document)
            .context(["userName": .string("Ada")])
            .actionHandler { _ in }
            .dispatcher(InlineDispatcher())
            .label("render-smoke")
            .build()

        // Drive the pipeline the way SwiftUI would.
        _ = milanoRender(core: view.core, resolved: view.resolvedRoot)

        #expect(renderer.received.count == 4)  // Banner + 2 Texts + Button
        let banner = try #require(renderer.received.first)
        #expect(banner.type == "Banner")
        #expect(banner.childCount == 3)

        let title = try #require(renderer.received.first { $0.reference == "title" })
        #expect(title.values["text"] == .string("Hello, Ada"))

        // The emission surface dispatches through the node.
        let buttonNode = try #require(renderer.lastNode)
        #expect(buttonNode.reference == "cta")
        buttonNode.emit("tap")
        #expect(view.dispatched.count == 1)
        #expect(view.dispatched[0].action.name == "openUrl")
    }
}
