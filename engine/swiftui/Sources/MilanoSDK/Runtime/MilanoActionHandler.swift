import Foundation

/// An asynchronous receiver of custom actions: one funnel per view.
/// Normal return is success and the returned value, validated against the
/// action's declared `result` type, binds the `result` root inside
/// `onSuccess`; return `nil` for actions declaring no result. Throwing is
/// failure. Completion-exactly-once holds by construction.
public protocol MilanoActionHandler: Sendable {
    func handle(_ action: MilanoAction) async throws -> MilanoValue?
}

/// A dispatched custom action, delivered as data.
public struct MilanoAction: Equatable, Sendable {
    public let name: String
    public let parameters: [String: MilanoValue]
    public let viewIdentity: String
}

/// Closure-based convenience handler.
public struct MilanoClosureActionHandler: MilanoActionHandler {
    private let closure: @Sendable (MilanoAction) async throws -> MilanoValue?

    public init(_ closure: @escaping @Sendable (MilanoAction) async throws -> MilanoValue?) {
        self.closure = closure
    }

    public func handle(_ action: MilanoAction) async throws -> MilanoValue? {
        try await closure(action)
    }
}
