import Foundation
import Testing

@testable import MilanoSDK

private func jsonValue(_ text: String) throws -> MilanoValue {
    let raw = try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
    return try #require(MilanoValue(json: raw))
}

struct MilanoValueTests {

    @Test func numbersWithoutFractionArePartOfInt() throws {
        #expect(try jsonValue("5") == .int(5))
        #expect(try jsonValue("-3") == .int(-3))
        #expect(try jsonValue("5.0") == .double(5.0))
        #expect(try jsonValue("0.25") == .double(0.25))
    }

    @Test func boolsAreNotNumbers() throws {
        #expect(try jsonValue("true") == .bool(true))
        #expect(try jsonValue("false") == .bool(false))
        #expect(try jsonValue("1") == .int(1))
    }

    @Test func containersDecode() throws {
        #expect(try jsonValue(#"["a", 1, null]"#) == .array([.string("a"), .int(1), .null]))
        #expect(try jsonValue(#"{"k": true}"#) == .record(["k": .bool(true)]))
    }

    @Test func accessorsReturnDeclaredTypeOnly() throws {
        let value = MilanoValue.int(7)
        #expect(value.intValue == 7)
        #expect(value.doubleValue == nil)
        #expect(value.stringValue == nil)
    }
}

struct MilanoTypeTests {

    private func type(_ descriptorJSON: String) throws -> MilanoType {
        try #require(MilanoType(descriptor: jsonValue(descriptorJSON)))
    }

    @Test func primitiveDescriptorsParse() throws {
        #expect(try type("\"int\"") == MilanoType(.int))
        #expect(try type("\"string?\"") == MilanoType(.string, optional: true))
        #expect(MilanoType(descriptor: .string("float")) == nil)
        #expect(MilanoType(descriptor: .string("int??")) == nil)
    }

    @Test func compositeDescriptorsParse() throws {
        let array = try type(#"{"array": "string"}"#)
        #expect(array == MilanoType(.array(MilanoType(.string))))

        let record = try type(#"{"record": {"id": "int", "title": "string?"}, "optional": true}"#)
        #expect(
            record
                == MilanoType(
                    .record(["id": MilanoType(.int), "title": MilanoType(.string, optional: true)]),
                    optional: true))

        #expect(MilanoType(descriptor: try jsonValue(#"{"array": "string", "extra": 1}"#)) == nil)
        #expect(MilanoType(descriptor: try jsonValue(#"{"record": {"1bad": "int"}}"#)) == nil)
    }

    @Test func nullSatisfiesOptionalOnly() throws {
        #expect(MilanoType(.string, optional: true).validated(.null) == MilanoValue.null)
        #expect(MilanoType(.string).validated(.null) == nil)
    }

    @Test func intPromotesToDoubleNeverTheReverse() throws {
        #expect(MilanoType(.double).validated(.int(5)) == .double(5.0))
        #expect(MilanoType(.int).validated(.double(5.0)) == nil)
    }

    @Test func recordsValidateShapeExactly() throws {
        let type = MilanoType(
            .record(["name": MilanoType(.string), "phone": MilanoType(.string, optional: true)]))

        let full = type.validated(.record(["name": .string("Ada"), "phone": .string("555")]))
        #expect(full == .record(["name": .string("Ada"), "phone": .string("555")]))

        // Missing optional field canonicalizes to null.
        let partial = type.validated(.record(["name": .string("Ada")]))
        #expect(partial == .record(["name": .string("Ada"), "phone": .null]))

        // Missing required field and undeclared field are mismatches.
        #expect(type.validated(.record(["phone": .string("555")])) == nil)
        #expect(type.validated(.record(["name": .string("Ada"), "extra": .int(1)])) == nil)
    }

    @Test func arraysValidateElements() throws {
        let type = MilanoType(.array(MilanoType(.double)))
        #expect(type.validated(.array([.int(1), .double(2.5)])) == .array([.double(1.0), .double(2.5)]))
        #expect(type.validated(.array([.string("x")])) == nil)
    }

    @Test func enumDescriptorsParse() throws {
        let tone = try type(#"{"enum": ["info", "warning"]}"#)
        #expect(tone == MilanoType(.enumeration(["info", "warning"])))
        // Structural identity: member order in the descriptor is irrelevant.
        #expect(tone == (try type(#"{"enum": ["warning", "info"]}"#)))
        let optional = try type(#"{"enum": ["a"], "optional": true}"#)
        #expect(optional.optional)

        // Empty, duplicate, non-identifier, non-string, and stray keys are
        // invalid declarations.
        #expect(MilanoType(descriptor: try jsonValue(#"{"enum": []}"#)) == nil)
        #expect(MilanoType(descriptor: try jsonValue(#"{"enum": ["a", "a"]}"#)) == nil)
        #expect(MilanoType(descriptor: try jsonValue(#"{"enum": ["with-dash"]}"#)) == nil)
        #expect(MilanoType(descriptor: try jsonValue(#"{"enum": [1]}"#)) == nil)
        #expect(MilanoType(descriptor: try jsonValue(#"{"enum": ["a"], "extra": 1}"#)) == nil)
    }

    @Test func enumsValidateMembership() throws {
        let tone = MilanoType(.enumeration(["info", "warning"]))
        #expect(tone.validated(.string("info")) == .string("info"))
        #expect(tone.validated(.string("loud")) == nil)
        #expect(tone.validated(.int(1)) == nil)
        #expect(tone.validated(.null) == nil)
        let optional = MilanoType(.enumeration(["info"]), optional: true)
        #expect(optional.validated(.null) == .null)
    }

    @Test func identifierGrammar() {
        #expect(MilanoIdentifier.isValid("Banner"))
        #expect(MilanoIdentifier.isValid("a_1"))
        #expect(!MilanoIdentifier.isValid("$repeat"))
        #expect(!MilanoIdentifier.isValid("1bad"))
        #expect(!MilanoIdentifier.isValid(""))
        #expect(!MilanoIdentifier.isValid("with-dash"))
    }
}
