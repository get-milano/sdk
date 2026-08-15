import Foundation

/// How unknown component types are handled: engine default, per-view override.
public enum MilanoUnknownTypePolicy: String, Equatable, Sendable {
    /// Drop the node and its entire subtree, keep siblings, report.
    case skip
    /// Building throws `UnknownComponentType` at the gate.
    case fail
    /// Route the node and its raw subtree to the placeholder renderer, report.
    case placeholder
}

/// Resource limits; safe defaults fixed by the document model spec,
/// adjustable per engine.
public struct MilanoLimits: Equatable, Sendable {
    public var maxTreeDepth: Int
    public var maxNodeCount: Int
    public var maxDocumentBytes: Int
    public var maxExpressionLength: Int

    public init(
        maxTreeDepth: Int = 32,
        maxNodeCount: Int = 10_000,
        maxDocumentBytes: Int = 1_048_576,
        maxExpressionLength: Int = 1_024
    ) {
        self.maxTreeDepth = maxTreeDepth
        self.maxNodeCount = maxNodeCount
        self.maxDocumentBytes = maxDocumentBytes
        self.maxExpressionLength = maxExpressionLength
    }
}
