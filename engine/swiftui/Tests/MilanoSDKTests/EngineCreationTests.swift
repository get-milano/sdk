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

/// engine-pinned: invalid-vocabulary-at-creation
/// engine-pinned: vocabulary-contract-version-rejected
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
        #expect(vocabulary.contractMajor == 2)
        #expect(vocabulary.contractMinor == 1)
        #expect(vocabulary.name == "examples")
        #expect(vocabulary.components.count == 12)

        let badge = try #require(vocabulary.components["Badge"])
        let tone = MilanoType(.enumeration(["info", "warning", "danger"]))
        #expect(badge.properties["tone"] == tone)
        #expect(badge.events["select"] == tone)

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

        // The host functions the suite declares (contract 2.1), `round`
        // among them: the `$` namespace holds the built-in of that name,
        // so the declaration collides with nothing.
        #expect(vocabulary.functions.count == 6)
        #expect(vocabulary.functions["round"]?.arguments == [MilanoType(.double), MilanoType(.int)])
        let formatMoney = try #require(vocabulary.functions["formatMoney"])
        #expect(formatMoney.arguments == [MilanoType(.int), MilanoType(.string)])
        #expect(formatMoney.returns == MilanoType(.string))
        #expect(vocabulary.functions["parseInt"]?.returns == MilanoType(.int, optional: true))
        let toneFunction = try #require(vocabulary.functions["tone"])
        #expect(toneFunction.arguments == [tone])
        // An enum's zero value is its first declared member, not the
        // alphabetically first one.
        #expect(toneFunction.returns.zeroValue == .string("info"))
    }

    /// Creation's outcome for an artifact: the engine error, or nil when it parses.
    private func creation(_ json: String) -> MilanoEngineError? {
        do {
            _ = try MilanoVocabulary(artifactJSON: Data(json.utf8))
            return nil
        } catch let error as MilanoEngineError {
            return error
        } catch {
            return nil
        }
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

    @Test func unknownTypePolicyDefaultsToFail() throws {
        let vocabulary = try MilanoVocabulary(artifactJSON: examplesVocabularyJSON())
        let engine = try MilanoEngine(
            vocabularyJSON: examplesVocabularyJSON(),
            registry: fullRegistry(for: vocabulary))
        #expect(engine.defaultUnknownTypePolicy == .fail)
    }

    @Test func invalidVocabulariesAreRejected() throws {
        // Not JSON at all.
        #expect(creation("{ nope") == .invalidVocabulary(rule: "json", detail: "not well-formed JSON"))

        // Bad contract version.
        #expect(
            creation(#"{"milano": "1", "name": "x", "version": "1", "components": {}}"#)
                == .invalidVocabulary(rule: "milano", detail: "expected major.minor.patch, found 1"))

        // Contract version outside what the engine implements: an unknown
        // major, and a minor above the ceiling of a known one.
        #expect(
            creation(#"{"milano": "0.1.0", "name": "x", "version": "1.0.0", "components": {}}"#)
                == .invalidVocabulary(
                    rule: "milano-version",
                    detail: "unsupported contract version 0.1.0; supported: 1.0, 2.1"))
        #expect(
            creation(#"{"milano": "2.2.0", "name": "x", "version": "1.0.0", "components": {}}"#)
                == .invalidVocabulary(
                    rule: "milano-version",
                    detail: "unsupported contract version 2.2.0; supported: 1.0, 2.1"))
        // A failure payload needs contract 2.1: the artifact's declared
        // version is a floor it holds itself to.
        let failing = #"{"go": {"failure": "string"}}"#
        #expect(
            creation(
                #"{"milano": "2.0.0", "name": "x", "version": "1.0.0", "components": {}, "actions": "# + failing + "}")
                == .invalidVocabulary(
                    rule: "contract-feature",
                    detail: "go declares a failure payload, which needs contract 2.1"))
        #expect(
            creation(
                #"{"milano": "2.1.0", "name": "x", "version": "1.0.0", "components": {}, "actions": "# + failing + "}")
                == nil)

        // Vocabulary version must be semantic.
        #expect(
            creation(#"{"milano": "1.0.0", "name": "x", "version": "1", "components": {}}"#)
                == .invalidVocabulary(rule: "version", detail: "vocabulary version must be major.minor.patch"))

        // Component name violating the identifier grammar.
        let badName = #"{"milano": "1.0.0", "name": "x", "version": "1.0.0", "components": {"$Bad": {}}}"#
        #expect(creation(badName) == .invalidVocabulary(rule: "component-name", detail: "$Bad"))

        // Property with an unknown type descriptor.
        let badType = #"""
            {"milano": "1.0.0", "name": "x", "version": "1.0.0",
             "components": {"Text": {"properties": {"text": "varchar"}}}}
            """#
        #expect(creation(badType) == .invalidVocabulary(rule: "component-property", detail: "Text.text"))

        // Event with an invalid payload descriptor.
        let badEvent = #"""
            {"milano": "1.0.0", "name": "x", "version": "1.0.0",
             "components": {"Button": {"events": {"tap": 5}}}}
            """#
        #expect(creation(badEvent) == .invalidVocabulary(rule: "component-event", detail: "Button.tap"))
    }

    /// Host function declarations (vocabulary schema spec, Function
    /// declarations): an empty argument list is refused, a name that is
    /// not an identifier is refused, and the section needs contract 2.1.
    /// A built-in's name is not refused: the two namespaces are separate.
    @Test func invalidFunctionDeclarationsAreRejected() throws {
        func artifact(_ functions: String, milano: String = "2.1.0") -> String {
            #"{"milano": ""# + milano + #"", "name": "x", "version": "1.0.0", "components": {}, "functions": "#
                + functions + "}"
        }
        #expect(
            creation(artifact(#"{"now": {"arguments": [], "returns": "string"}}"#))
                == .invalidVocabulary(rule: "function-arguments", detail: "now"))
        #expect(
            creation(artifact(#"{"shout": {"returns": "string"}}"#))
                == .invalidVocabulary(rule: "function-arguments", detail: "shout"))
        #expect(
            creation(artifact(#"{"shout": {"arguments": ["string"]}}"#))
                == .invalidVocabulary(rule: "function-returns", detail: "shout"))
        #expect(
            creation(artifact(#"{"shout": {"arguments": ["varchar"], "returns": "string"}}"#))
                == .invalidVocabulary(rule: "function-argument", detail: "shout"))
        #expect(
            creation(artifact(#"{"$shout": {"arguments": ["string"], "returns": "string"}}"#))
                == .invalidVocabulary(rule: "function-name", detail: "$shout"))
        #expect(
            creation(artifact("[]"))
                == .invalidVocabulary(rule: "functions", detail: "functions is not an object"))
        // The artifact's declared version is a floor it holds itself to:
        // a functions section needs contract 2.1, whatever it contains.
        #expect(
            creation(artifact(#"{"shout": {"arguments": ["string"], "returns": "string"}}"#, milano: "2.0.0"))
                == .invalidVocabulary(rule: "contract-feature", detail: "functions need contract 2.1"))
        #expect(
            creation(artifact("{}", milano: "1.0.0"))
                == .invalidVocabulary(rule: "contract-feature", detail: "functions need contract 2.1"))
        #expect(creation(artifact(#"{"shout": {"arguments": ["string"], "returns": "string"}}"#)) == nil)
    }

    /// A vocabulary may declare a host function named after a built-in:
    /// the contract's own functions are called through the `$` namespace,
    /// so nothing collides and no declaration can ever be shadowed
    /// (vocabulary schema spec, Function declarations). The examples
    /// vocabulary declares `round` for exactly this reason.
    @Test func aFunctionNamedLikeABuiltinIsAccepted() throws {
        let json = #"""
            {"milano": "2.1.0", "name": "x", "version": "1.0.0", "components": {},
             "functions": {"round": {"arguments": ["double", "int"], "returns": "string"}}}
            """#
        let vocabulary = try MilanoVocabulary(artifactJSON: Data(json.utf8))
        #expect(
            vocabulary.functions["round"]
                == MilanoVocabulary.Function(
                    arguments: [MilanoType(.double), MilanoType(.int)], returns: MilanoType(.string)))
    }

    /// An engine holds its own copy of the registry: registering or
    /// replacing a renderer afterwards changes nothing an existing engine
    /// renders. Value semantics give Swift this for free; Kotlin and
    /// TypeScript copy explicitly, and this pins the shared guarantee.
    @Test func registrationsAfterCreationDoNotReachTheEngine() throws {
        var registry = MilanoRegistry()
        let original = StubRenderer()
        registry.register(original, for: "Text")
        let engine = try MilanoEngine(
            vocabularyJSON: Data(#"""
                {"milano": "1.0.0", "name": "x", "version": "1.0.0",
                 "components": {"Text": {"properties": {"text": "string"}}}}
                """#.utf8),
            registry: registry)
        registry.register(StubRenderer(), for: "Text")
        registry.registerPlaceholder(StubPlaceholder())
        #expect(engine.registry.renderers["Text"] === original)
        #expect(engine.registry.placeholder == nil)
    }
}
