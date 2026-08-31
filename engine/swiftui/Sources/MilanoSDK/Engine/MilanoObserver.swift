import Foundation

/// One reported occurrence, delivered to the engine observer, tagged with
/// the originating view. Kinds are the closed union defined by the runtime
/// API spec.
public struct MilanoOccurrence: Equatable, Sendable {
    public enum Kind: String, Equatable, Sendable {
        case unknownTypeSkipped
        case unknownTypePlaceholder
        case undeclaredProperty
        case droppedEvent
        case invalidEmission
        case invalidCompletion
        case duplicateCompletion
        case completionAfterTeardown
        case completionAfterReplace
        case rejectedContextUpdate
        case rejectedMutation
        case divisionByZero
        case saturation
        case invalidFunctionResult
    }

    public let kind: Kind
    /// Stable identity of the originating view, plus the builder's label when set.
    public let viewIdentity: String
    /// The node's id or canonical path, when one applies.
    public let node: String?
    /// What the occurrence is about, when one thing is: the event, action,
    /// property, component type, or context key involved.
    public let name: String?
    /// Detail in the gate's own terms, when it applies: the declared type
    /// or shape that was expected, and the kind that arrived (or `missing`).
    public let expected: String?
    public let found: String?

    public init(
        kind: Kind, viewIdentity: String, node: String?,
        name: String? = nil, expected: String? = nil, found: String? = nil
    ) {
        self.kind = kind
        self.viewIdentity = viewIdentity
        self.node = node
        self.name = name
        self.expected = expected
        self.found = found
    }
}

/// Engine-scoped observer: one integration point per engine for logging and
/// telemetry. Every reported occurrence flows here.
public protocol MilanoObserver: AnyObject {
    func occurrence(_ occurrence: MilanoOccurrence)
}
