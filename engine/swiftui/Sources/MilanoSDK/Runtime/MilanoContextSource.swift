import Foundation

/// Supplies and updates context values. Milano validates each change
/// atomically; an invalid update is rejected whole and reported.
public protocol MilanoContextSource: AnyObject, Sendable {
    var current: [String: MilanoValue] { get }
    func subscribe(_ onUpdate: @escaping @Sendable ([String: MilanoValue]) -> Void)
}

/// The standard context source: create it with initial values, push updates
/// from any thread.
public final class MilanoContextHandle: MilanoContextSource, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: MilanoValue]
    private var subscribers: [@Sendable ([String: MilanoValue]) -> Void] = []

    public init(_ values: [String: MilanoValue]) {
        self.values = values
    }

    public var current: [String: MilanoValue] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }

    public func subscribe(_ onUpdate: @escaping @Sendable ([String: MilanoValue]) -> Void) {
        lock.lock()
        subscribers.append(onUpdate)
        lock.unlock()
    }

    /// Merges the given values over the current ones and notifies views.
    /// May be called from any thread; validation and application happen on
    /// each view's dispatcher.
    public func update(_ newValues: [String: MilanoValue]) {
        lock.lock()
        values.merge(newValues) { _, new in new }
        let snapshot = values
        let subs = subscribers
        lock.unlock()
        for subscriber in subs {
            subscriber(snapshot)
        }
    }
}

/// A fixed context source for hosts with nothing to update.
final class StaticContextSource: MilanoContextSource, @unchecked Sendable {
    let current: [String: MilanoValue]

    init(_ values: [String: MilanoValue]) {
        self.current = values
    }

    func subscribe(_ onUpdate: @escaping @Sendable ([String: MilanoValue]) -> Void) {}
}
