import Foundation

// MARK: - Transparent constructs (contract 2.1)

extension BuiltNode {
    /// Every node a transparent construct's branches hold, or nil when the
    /// node is not one. `$repeat` is excluded: its template is `children`,
    /// and every walk that cares treats it separately.
    var branchNodes: [BuiltNode]? {
        if let conditional { return conditional.then + conditional.otherwise }
        if let choice { return choice.cases.values.flatMap { $0 } + (choice.fallback ?? []) }
        return nil
    }
}
