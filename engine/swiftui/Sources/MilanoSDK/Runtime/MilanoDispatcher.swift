import Foundation

/// The serialization seam: everything that touches a view's state runs
/// through its dispatcher, one item at a time. The platform layer binds it
/// to the main thread; the conformance harness injects a pump.
public protocol MilanoDispatcher: Sendable {
    func dispatch(_ work: @escaping @Sendable () -> Void)
}

/// The default dispatcher: the main thread, per the threading contract.
/// Runs inline when already on the main thread, so renderer emissions are
/// processed synchronously in FIFO order.
public final class MilanoMainDispatcher: MilanoDispatcher {
    public init() {}

    public func dispatch(_ work: @escaping @Sendable () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }
}
