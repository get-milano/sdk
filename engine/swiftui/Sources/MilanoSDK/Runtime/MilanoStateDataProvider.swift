import Foundation

/// An asynchronous source of initial state values, awaited during building
/// and validated against the document's declarations. Provider errors
/// propagate to the build caller unchanged: they are host errors, not
/// Milano errors.
public protocol MilanoStateDataProvider: Sendable {
    func initialState(for declarations: [String: MilanoType]) async throws -> [String: MilanoValue]
}

/// Closure-based convenience provider.
public struct MilanoClosureStateProvider: MilanoStateDataProvider {
    private let closure: @Sendable ([String: MilanoType]) async throws -> [String: MilanoValue]

    public init(
        _ closure: @escaping @Sendable ([String: MilanoType]) async throws -> [String: MilanoValue]
    ) {
        self.closure = closure
    }

    public func initialState(
        for declarations: [String: MilanoType]
    ) async throws -> [String: MilanoValue] {
        try await closure(declarations)
    }
}
