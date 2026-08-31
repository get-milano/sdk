import Foundation

extension Expr {
    /// The state and context keys the expression reads, as `state.<key>`
    /// and `context.<key>`. A record field access counts as reading the
    /// whole key: `state.address.city` depends on `state.address`. Computed
    /// once per expression at build; it is what lets an update re-evaluate
    /// only what reads a key whose value changed.
    var dependencies: Set<String> {
        var keys: Set<String> = []
        collectDependencies(into: &keys)
        return keys
    }

    private func collectDependencies(into keys: inout Set<String>) {
        switch self {
        case .member(let base, let field):
            if case .root(let root) = base, root == "state" || root == "context" {
                keys.insert("\(root).\(field)")
            } else {
                base.collectDependencies(into: &keys)
            }
        case .lookup(let base, let key):
            base.collectDependencies(into: &keys)
            key.collectDependencies(into: &keys)
        case .call(_, let arguments):
            for argument in arguments { argument.collectDependencies(into: &keys) }
        case .unary(_, let operand):
            operand.collectDependencies(into: &keys)
        case .binary(_, let left, let right):
            left.collectDependencies(into: &keys)
            right.collectDependencies(into: &keys)
        default:
            break
        }
    }
}
