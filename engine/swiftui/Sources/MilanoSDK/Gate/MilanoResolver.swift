import Foundation

/// The resolved tree a binding renders: every property a value. Immutable;
/// re-resolution produces a new tree, sharing untouched subtrees.
struct ResolvedNode: Sendable {
    let type: String
    let reference: String
    let isPlaceholder: Bool
    let rawSubtree: MilanoValue?
    let values: [String: MilanoValue]
    let children: [ResolvedNode]
    /// Resolved children per built child, in order: one for a component
    /// node, the instance count for a `$repeat`. Internal to re-resolution.
    var spans: [Int] = []
}

/// What a built subtree reads: per property, the keys its expression
/// depends on; for the subtree as a whole, their union. A `$repeat`'s
/// subtree includes what its `items` read, since every instance derives
/// from them. Built once per view, aligned with the built tree's children.
struct DependencyNode: Sendable {
    let own: [String: Set<String>]
    let subtree: Set<String>
    let children: [DependencyNode]
}

/// Resolution: the first pass evaluates every property expression and
/// materializes every `$repeat`; every later pass re-evaluates only what
/// reads a key whose value changed. Evaluation is total; division by zero
/// and saturation report through the occurrence pipeline, attributed to
/// the owning node and property.
enum MilanoResolver {
    typealias Report = (MilanoOccurrence.Kind, String, String) -> Void
    typealias Bindings = [String: MilanoValue]

    private static func evaluate(
        _ expr: Expr, expected: MilanoType, reference: String, name: String,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings
    ) -> MilanoValue {
        let evaluator = ExprEvaluator(
            state: state, context: context, event: nil, result: nil,
            node: reference,
            report: { kind in report(kind, reference, name) },
            bindings: bindings)
        let result = evaluator.evaluate(expr)
        // Canonicalize toward the declared type (int where double is declared).
        return expected.validated(result) ?? result
    }

    /// The elements a `$repeat` instantiates over, right now.
    static func repeatElements(
        _ node: BuiltNode, reference: String,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings
    ) -> [MilanoValue] {
        guard let spec = node.repeatSpec,
            case .typedExpression(_, let expr, let expected) = spec.items
        else { return [] }
        return evaluate(
            expr, expected: expected, reference: reference, name: "items",
            state: state, context: context, report: report, bindings: bindings
        ).arrayValue ?? []
    }

    /// The template's bindings for one element.
    static func elementBindings(
        as alias: String, element: MilanoValue, index: Int, outer: Bindings
    ) -> Bindings {
        var bound = outer
        bound[alias] = element
        bound["\(alias)_index"] = .int(Int64(index))
        return bound
    }

    private static func resolveRepeat(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, suffix: String
    ) -> [ResolvedNode] {
        guard let spec = node.repeatSpec else { return [] }
        var instances: [ResolvedNode] = []
        let elements = repeatElements(
            node, reference: node.reference + suffix, state: state, context: context,
            report: report, bindings: bindings)
        for (index, element) in elements.enumerated() {
            let bound = elementBindings(as: spec.as, element: element, index: index, outer: bindings)
            let instanceSuffix = "\(suffix)[\(index)]"
            for template in node.children {
                // A nested repeat instantiates within this element's scope.
                if template.repeatSpec != nil {
                    instances.append(contentsOf: resolveRepeat(
                        template, state: state, context: context, report: report,
                        bindings: bound, suffix: instanceSuffix))
                } else {
                    instances.append(resolve(
                        template, state: state, context: context, report: report,
                        bindings: bound, suffix: instanceSuffix))
                }
            }
        }
        return instances
    }

    private static func resolveChildren(
        _ node: BuiltNode, state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report, bindings: Bindings, suffix: String
    ) -> (children: [ResolvedNode], spans: [Int]) {
        var children: [ResolvedNode] = []
        var spans: [Int] = []
        for child in node.children {
            if child.repeatSpec != nil {
                let instances = resolveRepeat(
                    child, state: state, context: context, report: report,
                    bindings: bindings, suffix: suffix)
                children.append(contentsOf: instances)
                spans.append(instances.count)
            } else {
                children.append(resolve(
                    child, state: state, context: context, report: report,
                    bindings: bindings, suffix: suffix))
                spans.append(1)
            }
        }
        return (children, spans)
    }

    /// The first resolution. Inside a repeat instance, `suffix` carries the
    /// element indices that make its reference.
    static func resolve(
        _ node: BuiltNode,
        state: [String: MilanoValue],
        context: [String: MilanoValue],
        report: @escaping Report,
        bindings: Bindings = [:],
        suffix: String = ""
    ) -> ResolvedNode {
        let reference = node.reference + suffix
        var values: [String: MilanoValue] = [:]
        for (name, value) in node.properties.byKey {
            switch value {
            case .literal(let literal):
                values[name] = literal
            case .typedExpression(_, let expr, let expected):
                values[name] = evaluate(
                    expr, expected: expected, reference: reference, name: name,
                    state: state, context: context, report: report, bindings: bindings)
            case .expression:
                // Unreachable: the gate types every expression.
                values[name] = .null
            }
        }
        let (children, spans) = resolveChildren(
            node, state: state, context: context, report: report,
            bindings: bindings, suffix: suffix)
        return ResolvedNode(
            type: node.type,
            reference: reference,
            isPlaceholder: node.isPlaceholder,
            rawSubtree: node.rawSubtree,
            values: values,
            children: children,
            spans: spans)
    }

    /// Nodes in a resolved tree: the node count limit's runtime measure.
    static func countNodes(_ node: ResolvedNode) -> Int {
        node.children.reduce(1) { $0 + countNodes($1) }
    }

    static func index(_ node: BuiltNode) -> DependencyNode {
        var own: [String: Set<String>] = [:]
        var subtree: Set<String> = []
        for (name, value) in node.properties {
            guard case .typedExpression(_, let expr, _) = value else { continue }
            let keys = expr.dependencies
            own[name] = keys
            subtree.formUnion(keys)
        }
        if let spec = node.repeatSpec, case .typedExpression(_, let expr, _) = spec.items {
            let keys = expr.dependencies
            own["items"] = keys
            subtree.formUnion(keys)
        }
        let children = node.children.map(index)
        for child in children { subtree.formUnion(child.subtree) }
        return DependencyNode(own: own, subtree: subtree, children: children)
    }

    /// Re-resolution after an update: only the properties that read a
    /// changed key are re-evaluated and only the path from those nodes to
    /// the root is rebuilt; a `$repeat` whose subtree reads a changed key is
    /// re-materialized whole. Returns nil when nothing under `node` depends
    /// on the change, so the caller keeps what it had.
    static func refresh(
        _ node: BuiltNode, index: DependencyNode, resolved: ResolvedNode,
        changed: Set<String>,
        state: [String: MilanoValue], context: [String: MilanoValue],
        report: @escaping Report
    ) -> ResolvedNode? {
        guard !index.subtree.isDisjoint(with: changed) else { return nil }

        var values = resolved.values
        for (name, keys) in index.own.byKey where !keys.isDisjoint(with: changed) {
            guard case .typedExpression(_, let expr, let expected)? = node.properties[name] else { continue }
            values[name] = evaluate(
                expr, expected: expected, reference: resolved.reference, name: name,
                state: state, context: context, report: report, bindings: [:])
        }

        var children: [ResolvedNode] = []
        var spans: [Int] = []
        var offset = 0
        for (position, child) in node.children.enumerated() {
            let span = position < resolved.spans.count ? resolved.spans[position] : 1
            let childIndex = index.children[position]
            if child.repeatSpec != nil {
                if !childIndex.subtree.isDisjoint(with: changed) {
                    let instances = resolveRepeat(
                        child, state: state, context: context, report: report,
                        bindings: [:], suffix: "")
                    children.append(contentsOf: instances)
                    spans.append(instances.count)
                } else {
                    children.append(contentsOf: resolved.children[offset..<offset + span])
                    spans.append(span)
                }
            } else {
                let previous = resolved.children[offset]
                children.append(refresh(
                    child, index: childIndex, resolved: previous, changed: changed,
                    state: state, context: context, report: report) ?? previous)
                spans.append(1)
            }
            offset += span
        }
        return ResolvedNode(
            type: resolved.type,
            reference: resolved.reference,
            isPlaceholder: resolved.isPlaceholder,
            rawSubtree: resolved.rawSubtree,
            values: values,
            children: children,
            spans: spans)
    }
}
