import Foundation
import SwiftUI

/// A consumer-provided renderer for one component type: receives the node,
/// returns SwiftUI. Invoked on the main actor.
public protocol MilanoRenderer: AnyObject {
    @MainActor func render(_ node: MilanoNode) -> AnyView
}

/// The consumer-provided renderer for unknown component types under the
/// *placeholder* policy. Receives the raw subtree as data, never as live
/// children.
public protocol MilanoPlaceholderRenderer: AnyObject {
    @MainActor func render(_ unknown: MilanoUnknownNode) -> AnyView
}

/// An unknown node routed to the placeholder renderer.
public struct MilanoUnknownNode: Sendable {
    /// The component type the document asked for.
    public let type: String
    /// The node's id or canonical path.
    public let reference: String
    /// The node's whole subtree, as raw data.
    public let rawSubtree: MilanoValue
}
