import Foundation
import SwiftUI
import Testing

@testable import MilanoSDK

private final class StubRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView { AnyView(EmptyView()) }
}
private final class StubPlaceholder: MilanoPlaceholderRenderer {
    func render(_ unknown: MilanoUnknownNode) -> AnyView { AnyView(EmptyView()) }
}

struct EngineCreationTests {

    private func examplesVocabularyJSON() throws -> Data {
        let specs = try #require(SpecsLocator.specsDirectory())
        let url = specs.appendingPathComponent("conformance/examples/vocabulary.json")
        return try Data(contentsOf: url)
    }

    private func fullRegistry(for vocabulary: MilanoVocabulary) -> MilanoRegistry {
        var registry = MilanoRegistry()
        for type in vocabulary.components.keys {
            registry.register(StubRenderer(), for: type)
        }
        return registry
    }

    @Test func examplesVocabularyParses() throws {
        let vocabulary = try MilanoVocabulary(artifactJSON: examplesVocabularyJSON())
        #expect(vocabulary.contractMajor == 0)
        #expect(vocabulary.contractMinor == 1)
        #expect(vocabulary.name == "examples")
        #expect(vocabulary.components.count == 7)

        let button = try #require(vocabulary.components["Button"])
        #expect(button.events["tap"] == MilanoType?.none)  // declared, payload-less
        #expect(button.properties["enabled"] == MilanoType(.bool))
        #expect(button.children == false)

        let textField = try #require(vocabulary.components["TextField"])
        #expect(textField.events["change"] == MilanoType(.string))

        let numberField = try #require(vocabulary.components["NumberField"])
        #expect(numberField.events["change"] == MilanoType(.double))
        #expect(numberField.properties["value"] == MilanoType(.double))

        let banner = try #require(vocabulary.components["Banner"])
        #expect(banner.children == true)

        let openUrl = try #require(vocabulary.actions["openUrl"])
        #expect(openUrl.parameters["url"] == MilanoType(.string))
    }

    @Test func engineCreatesWithFullRegistry() throws {
        let vocabulary = try MilanoVocabulary(artifactJSON: examplesVocabularyJSON())
        let engine = try MilanoEngine(
            vocabularyJSON: examplesVocabularyJSON(),
            registry: fullRegistry(for: vocabulary),
            defaultUnknownTypePolicy: .skip)
        #expect(engine.vocabulary.name == "examples")
        #expect(engine.limits == MilanoLimits())
    }

    @Test func missingRendererIsIncompleteRegistry() throws {
        let vocabulary = try MilanoVocabulary(artifactJSON: examplesVocabularyJSON())
        var registry = fullRegistry(for: vocabulary)
        registry = MilanoRegistry()  // start over, register all but one
        for type in vocabulary.components.keys where type != "Checkbox" {
            registry.register(StubRenderer(), for: type)
        }
        #expect(throws: MilanoEngineError.incompleteRegistry(missing: ["Checkbox"])) {
            _ = try MilanoEngine(
                vocabularyJSON: examplesVocabularyJSON(),
                registry: registry,
                defaultUnknownTypePolicy: .skip)
        }
    }

    @Test func placeholderPolicyRequiresPlaceholderRenderer() throws {
        let vocabulary = try MilanoVocabulary(artifactJSON: examplesVocabularyJSON())
        let registry = fullRegistry(for: vocabulary)

        #expect(throws: MilanoEngineError.incompleteRegistry(missing: ["(placeholder renderer)"])) {
            _ = try MilanoEngine(
                vocabularyJSON: examplesVocabularyJSON(),
                registry: registry,
                defaultUnknownTypePolicy: .placeholder)
        }

        var withPlaceholder = registry
        withPlaceholder.registerPlaceholder(StubPlaceholder())
        _ = try MilanoEngine(
            vocabularyJSON: examplesVocabularyJSON(),
            registry: withPlaceholder,
            defaultUnknownTypePolicy: .placeholder)
    }

    @Test func invalidVocabulariesAreRejected() throws {
        func creation(_ json: String) -> MilanoEngineError? {
            do {
                _ = try MilanoVocabulary(artifactJSON: Data(json.utf8))
                return nil
            } catch let error as MilanoEngineError {
                return error
            } catch {
                return nil
            }
        }

        // Not JSON at all.
        #expect(creation("{ nope") == .invalidVocabulary(rule: "json", detail: "not well-formed JSON"))

        // Bad contract version.
        #expect(
            creation(#"{"milano": "1", "name": "x", "version": "1", "components": {}}"#)
                == .invalidVocabulary(rule: "milano", detail: "expected major.minor.patch, found 1"))

        // Component name violating the identifier grammar.
        let badName = #"{"milano": "0.1.0", "name": "x", "version": "1", "components": {"$Bad": {}}}"#
        #expect(creation(badName) == .invalidVocabulary(rule: "component-name", detail: "$Bad"))

        // Property with an unknown type descriptor.
        let badType = #"""
            {"milano": "0.1.0", "name": "x", "version": "1",
             "components": {"Text": {"properties": {"text": "varchar"}}}}
            """#
        #expect(creation(badType) == .invalidVocabulary(rule: "component-property", detail: "Text.text"))

        // Event with an invalid payload descriptor.
        let badEvent = #"""
            {"milano": "0.1.0", "name": "x", "version": "1",
             "components": {"Button": {"events": {"tap": 5}}}}
            """#
        #expect(creation(badEvent) == .invalidVocabulary(rule: "component-event", detail: "Button.tap"))
    }
}
