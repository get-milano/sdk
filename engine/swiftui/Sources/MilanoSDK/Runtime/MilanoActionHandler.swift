import Foundation

/// An asynchronous receiver of custom actions: one funnel per view.
/// Normal return is success; throwing is failure. Completion-exactly-once
/// holds by construction.
public protocol MilanoActionHandler: Sendable {
    func handle(_ action: MilanoAction) async throws
}

/// A dispatched custom action, delivered as data.
public struct MilanoAction: Equatable, Sendable {
    public let name: String
    public let parameters: [String: MilanoValue]
    public let viewIdentity: String
}

/// Closure-based convenience handler.
public struct MilanoClosureActionHandler: MilanoActionHandler {
    private let closure: @Sendable (MilanoAction) async throws -> Void

    public init(_ closure: @escaping @Sendable (MilanoAction) async throws -> Void) {
        self.closure = closure
    }

    public func handle(_ action: MilanoAction) async throws {
        try await closure(action)
    }
}
