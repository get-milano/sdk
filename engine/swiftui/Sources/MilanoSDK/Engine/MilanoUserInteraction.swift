import Foundation

/// One user interaction, delivered to the engine's user-interaction
/// observer. Records pass everything through unredacted (payloads, action
/// parameters, document metadata): Milano implements no tracker, the
/// receiving host owns the data and decides what to do with it.
public struct MilanoUserInteraction: Equatable, Sendable {
    /// The closed union of both sources: runtime-captured records
    /// (lifecycle, emissions, dispatch, completions) and renderer-reported
    /// widget interactions (`MilanoNode.userInteraction`).
    public enum Kind: String, Equatable, Sendable {
        // Runtime-captured: nothing required from renderers or documents.
        case viewBuilt
        case viewReplaced
        case viewAppeared
        case viewDisappeared
        case viewTornDown
        case event
        case actionDispatched
        case completionSucceeded
        case completionFailed
        // Renderer-reported: signals the document does not model as events.
        case tap
        case doubleTap
        case longPress
        case focusGained
        case focusLost
        case textChanged
        case toggled
        case selectionChanged
        case valueChanged
        case appeared
        case disappeared
        case scrolled
    }

    public let kind: Kind
    /// Stable identity of the originating view, plus the builder's label
    /// when set.
    public let viewIdentity: String
    /// The node's id or canonical path, when the interaction is anchored
    /// to a node.
    public let node: String?
    /// The event or action name, when one applies.
    public let name: String?
    /// The dispatch number, when the record is about a custom action
    /// dispatch (`actionDispatched`, `completionSucceeded`,
    /// `completionFailed`): the same number the action carried.
    public let dispatch: Int?
    /// The interaction's data: the emission payload for `event`, the
    /// captured parameters for `actionDispatched`, the validated result
    /// or failure payload for a completion, the document metadata for
    /// `viewBuilt` and `viewReplaced`, and whatever the renderer supplies
    /// for widget kinds.
    public let value: MilanoValue?

    public init(
        kind: Kind, viewIdentity: String,
        node: String? = nil, name: String? = nil, value: MilanoValue? = nil,
        dispatch: Int? = nil
    ) {
        self.kind = kind
        self.viewIdentity = viewIdentity
        self.node = node
        self.name = name
        self.dispatch = dispatch
        self.value = value
    }
}

/// An asynchronous-safe receiver of user interactions: the engine's
/// product-analytics stream, separate from `MilanoObserver`, which carries
/// engine observability only.
public protocol MilanoUserInteractionObserver: AnyObject, Sendable {
    func interaction(_ interaction: MilanoUserInteraction)
}
