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
        case rejectedContextUpdate
        case divisionByZero
        case saturation
    }

    public let kind: Kind
    /// Stable identity of the originating view, plus the builder's label when set.
    public let viewIdentity: String
    /// The node's id or canonical path, when one applies.
    public let node: String?

    public init(kind: Kind, viewIdentity: String, node: String?) {
        self.kind = kind
        self.viewIdentity = viewIdentity
        self.node = node
    }
}

/// Engine-scoped observer: one integration point per engine for logging and
/// telemetry. Every reported occurrence flows here.
public protocol MilanoObserver: AnyObject {
    func occurrence(_ occurrence: MilanoOccurrence)
}
