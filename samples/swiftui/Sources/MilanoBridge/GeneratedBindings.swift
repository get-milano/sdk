// Generated from vocabulary "examples" 1.1.0 by generate_bindings.py.
// Do not edit; regenerate when the vocabulary changes.

import MilanoSDK

/// Members of the `contentAlignment` enum on `Banner`. Gate-guaranteed: decoding never fails.
public enum SampleBannerContentAlignment: String {
    case bottomLeading
    case bottomTrailing
    case center
    case topLeading
    case topTrailing
}

/// Members of the `layout` enum on `Banner`. Gate-guaranteed: decoding never fails.
public enum SampleBannerLayout: String {
    case card
    case overlay
    case strip
}

/// Members of the `liveRegion` enum on `Text`. Gate-guaranteed: decoding never fails.
public enum SampleTextLiveRegion: String {
    case assertive
    case polite
}

/// Members of the `role` enum on `Text`. Gate-guaranteed: decoding never fails.
public enum SampleTextRole: String {
    case body
    case subtitle
    case title
}

/// Typed view of a resolved `Banner` node. Non-optional accessors are gate-guaranteed.
public struct SampleBannerNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var backgroundImageUrl: String? { node.property("backgroundImageUrl").stringValue }
    public var contentAlignment: SampleBannerContentAlignment? {
        node.property("contentAlignment").stringValue.flatMap(SampleBannerContentAlignment.init(rawValue:))
    }
    public var cornerRadius: Int64? { node.property("cornerRadius").intValue }
    public var height: Int64? { node.property("height").intValue }
    public var layout: SampleBannerLayout? {
        node.property("layout").stringValue.flatMap(SampleBannerLayout.init(rawValue:))
    }
    public var showScrim: Bool? { node.property("showScrim").boolValue }
    public var visible: Bool? { node.property("visible").boolValue }
}

/// Typed view of a resolved `Button` node. Non-optional accessors are gate-guaranteed.
public struct SampleButtonNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var enabled: Bool { node.property("enabled").boolValue! }
    public var label: String { node.property("label").stringValue! }
    public var visible: Bool? { node.property("visible").boolValue }
    public func emitTap() { node.emit("tap") }
}

/// Typed view of a resolved `Card` node. Non-optional accessors are gate-guaranteed.
public struct SampleCardNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var accessibilityHint: String? { node.property("accessibilityHint").stringValue }
    public var accessibilityLabel: String? { node.property("accessibilityLabel").stringValue }
    public var cornerRadius: Int64? { node.property("cornerRadius").intValue }
    public var padding: Int64? { node.property("padding").intValue }
    public func emitTap() { node.emit("tap") }
}

/// Typed view of a resolved `Checkbox` node. Non-optional accessors are gate-guaranteed.
public struct SampleCheckboxNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var checked: Bool { node.property("checked").boolValue! }
    public var label: String { node.property("label").stringValue! }
    public var visible: Bool? { node.property("visible").boolValue }
    public func emitChange(_ payload: Bool) { node.emit("change", payload: .bool(payload)) }
}

/// Typed view of a resolved `Column` node. Non-optional accessors are gate-guaranteed.
public struct SampleColumnNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
}

/// Typed view of a resolved `Image` node. Non-optional accessors are gate-guaranteed.
public struct SampleImageNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var contentDescription: String? { node.property("contentDescription").stringValue }
    public var cornerRadius: Int64? { node.property("cornerRadius").intValue }
    public var decorative: Bool? { node.property("decorative").boolValue }
    public var height: Int64? { node.property("height").intValue }
    public var url: String { node.property("url").stringValue! }
    public var width: Int64? { node.property("width").intValue }
}

/// Typed view of a resolved `NumberField` node. Non-optional accessors are gate-guaranteed.
public struct SampleNumberFieldNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var label: String { node.property("label").stringValue! }
    public var value: Double { node.property("value").doubleValue! }
    public var visible: Bool? { node.property("visible").boolValue }
    public func emitChange(_ payload: Double) { node.emit("change", payload: .double(payload)) }
}

/// Typed view of a resolved `Row` node. Non-optional accessors are gate-guaranteed.
public struct SampleRowNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var spacing: Int64? { node.property("spacing").intValue }
}

/// Typed view of a resolved `Text` node. Non-optional accessors are gate-guaranteed.
public struct SampleTextNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var liveRegion: SampleTextLiveRegion? {
        node.property("liveRegion").stringValue.flatMap(SampleTextLiveRegion.init(rawValue:))
    }
    public var role: SampleTextRole? {
        node.property("role").stringValue.flatMap(SampleTextRole.init(rawValue:))
    }
    public var text: String { node.property("text").stringValue! }
    public var visible: Bool? { node.property("visible").boolValue }
}

/// Typed view of a resolved `TextField` node. Non-optional accessors are gate-guaranteed.
public struct SampleTextFieldNode {
    public let node: MilanoNode
    public init(_ node: MilanoNode) { self.node = node }
    public var error: String? { node.property("error").stringValue }
    public var label: String { node.property("label").stringValue! }
    public var required: Bool? { node.property("required").boolValue }
    public var value: String { node.property("value").stringValue! }
    public var visible: Bool? { node.property("visible").boolValue }
    public func emitChange(_ payload: String) { node.emit("change", payload: .string(payload)) }
}

/// Every custom action this vocabulary declares, decoded from dispatch.
public enum SampleAction {
    case dismiss
    case openUrl(url: String)
    /// The handler completes it with a `string` result, bound to `result` in onSuccess.
    case submitContact(email: String, name: String, phone: String?, surname: String)
    /// An action outside this vocabulary's declarations (builder-declared, or a newer vocabulary).
    case unrecognized(MilanoAction)

    public init(_ action: MilanoAction) {
        switch action.name {
        case "dismiss":
            self = .dismiss
        case "openUrl":
            self = .openUrl(url: action.parameters["url"]!.stringValue!)
        case "submitContact":
            self = .submitContact(
                email: action.parameters["email"]!.stringValue!,
                name: action.parameters["name"]!.stringValue!,
                phone: action.parameters["phone"]?.stringValue,
                surname: action.parameters["surname"]!.stringValue!)
        default:
            self = .unrecognized(action)
        }
    }
}

/// The vocabulary these bindings were generated from.
public enum SampleVocabulary {
    public static let name = "examples"
    public static let version = "1.1.0"

    /// Refuses to run against an engine holding a different vocabulary.
    public static func assertMatches(_ engine: MilanoEngine) {
        precondition(
            engine.vocabularyName == name && engine.vocabularyVersion == version,
            "bindings generated from \(name)@\(version), engine holds"
                + " \(engine.vocabularyName)@\(engine.vocabularyVersion)")
    }
}
