import Foundation

/// A host function call (expression language spec, Host functions): the
/// declared function's name and its evaluated arguments, in declared
/// order, each already of its declared type.
public struct MilanoFunctionCall: Equatable, Sendable {
    public let name: String
    public let arguments: [MilanoValue]

    public init(name: String, arguments: [MilanoValue]) {
        self.name = name
        self.arguments = arguments
    }
}

/// The engine's synchronous resolver of host functions (contract 2.1), one
/// for every view and every surface's declarations. Invoked on the thread
/// evaluating the expression, which is the main thread, during resolution
/// and action evaluation: it must be fast, must not block, must not touch
/// the view, and must be pure over its arguments (vocabulary schema spec,
/// Function declarations). The value is validated against the declared
/// `returns`; a mismatch or a throw is an invalid function result,
/// reported and replaced by the zero value of the return type. Return
/// `.null` for the null value of an optional return.
public protocol MilanoFunctionHandler: Sendable {
    func call(_ call: MilanoFunctionCall) throws -> MilanoValue
}

/// Closure-based convenience handler.
public struct MilanoClosureFunctionHandler: MilanoFunctionHandler {
    private let closure: @Sendable (MilanoFunctionCall) throws -> MilanoValue

    public init(_ closure: @escaping @Sendable (MilanoFunctionCall) throws -> MilanoValue) {
        self.closure = closure
    }

    public func call(_ call: MilanoFunctionCall) throws -> MilanoValue {
        try closure(call)
    }
}
