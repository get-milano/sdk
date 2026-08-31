import Foundation

/// An asynchronous receiver of custom actions: one funnel per view.
/// Normal return is success and the returned value, validated against the
/// action's declared `result` type, binds the `result` root inside
/// `onSuccess`; return `nil` for actions declaring no result. Throwing is
/// failure: a `MilanoActionFailure` carries the failure payload, validated
/// against the declared `failure` type and bound to the `failure` root
/// inside `onFailure`; any other error is a failure with no payload.
/// Completion-exactly-once holds by construction.
public protocol MilanoActionHandler: Sendable {
    func handle(_ action: MilanoAction) async throws -> MilanoValue?
}

/// A dispatched custom action, delivered as data.
public struct MilanoAction: Equatable, Sendable {
    public let name: String
    public let parameters: [String: MilanoValue]
    public let viewIdentity: String
    /// The dispatch's position among the view's custom action dispatches,
    /// counting from zero in delivery order (state and actions spec,
    /// Dispatch identity). Deterministic; the conformance suite pins it.
    public let dispatch: Int
    /// A string unique among every dispatch of every view in the process,
    /// whatever the views' labels; its format is opaque. The host's
    /// idempotency key toward whatever the handler calls.
    public let dispatchId: String

    public init(
        name: String, parameters: [String: MilanoValue], viewIdentity: String,
        dispatch: Int = 0, dispatchId: String = ""
    ) {
        self.name = name
        self.parameters = parameters
        self.viewIdentity = viewIdentity
        self.dispatch = dispatch
        self.dispatchId = dispatchId
    }
}

/// The error a handler throws to fail a dispatch with a payload: the value
/// is validated against the action's declared `failure` type and bound to
/// the `failure` root inside `onFailure`. Any other thrown error is a
/// failure with no payload.
public struct MilanoActionFailure: Error, Equatable, Sendable {
    public let value: MilanoValue?

    public init(_ value: MilanoValue? = nil) {
        self.value = value
    }
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
