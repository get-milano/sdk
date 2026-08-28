package dev.getmilano

/** A node with every property expression evaluated: what renderers see. */
internal class ResolvedNode(
    val type: String,
    val reference: String,
    val isPlaceholder: Boolean,
    val rawSubtree: MilanoValue?,
    val values: Map<String, MilanoValue>,
    val children: List<ResolvedNode>,
)

/**
 * What a built subtree reads: per property, the keys its expression
 * depends on; for the subtree as a whole, their union. Built once per view,
 * aligned with the built tree's children, so an update knows which nodes
 * to revisit without walking the rest.
 */
internal class DependencyNode(
    val own: Map<String, Set<String>>,
    val subtree: Set<String>,
    val children: List<DependencyNode>,
)

/**
 * Resolution: the first pass evaluates every property expression; every
 * later pass re-evaluates only what reads a key whose value changed.
 * Evaluation is total; division by zero and saturation report through the
 * occurrence pipeline, attributed to the owning node and property.
 */
internal object MilanoResolver {
    private fun evaluate(
        value: DocValue.TypedExpression,
        reference: String,
        name: String,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
    ): MilanoValue {
        val evaluator =
            ExprEvaluator(state, context, event = null) { kind ->
                report(kind, reference, name)
            }
        val result = evaluator.evaluate(value.expr)
        // Canonicalize toward the declared type (int where double is declared).
        return value.expected.validated(result) ?: result
    }

    fun resolve(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
    ): ResolvedNode {
        val values = LinkedHashMap<String, MilanoValue>()
        for ((name, value) in node.properties) {
            values[name] =
                when (value) {
                    is DocValue.Literal -> {
                        value.value
                    }

                    is DocValue.TypedExpression -> {
                        evaluate(value, node.reference, name, state, context, report)
                    }

                    // Unreachable: the gate types every expression.
                    is DocValue.Expression -> {
                        MilanoValue.Null
                    }
                }
        }
        return ResolvedNode(
            type = node.type,
            reference = node.reference,
            isPlaceholder = node.isPlaceholder,
            rawSubtree = node.rawSubtree,
            values = values,
            children = node.children.map { resolve(it, state, context, report) },
        )
    }

    fun index(node: BuiltNode): DependencyNode {
        val own = LinkedHashMap<String, Set<String>>()
        val subtree = LinkedHashSet<String>()
        for ((name, value) in node.properties) {
            if (value !is DocValue.TypedExpression) continue
            val keys = value.expr.dependencies()
            own[name] = keys
            subtree.addAll(keys)
        }
        val children = node.children.map(::index)
        for (child in children) subtree.addAll(child.subtree)
        return DependencyNode(own, subtree, children)
    }

    private fun Set<String>.intersects(changed: Set<String>): Boolean = any { it in changed }

    /**
     * Re-resolution after an update: only the properties that read a
     * changed key are re-evaluated, only the path from those nodes to the
     * root is rebuilt, and an untouched subtree is returned as the very
     * instance it was. Returns [resolved] itself when nothing under it
     * depends on the change.
     */
    fun refresh(
        node: BuiltNode,
        index: DependencyNode,
        resolved: ResolvedNode,
        changed: Set<String>,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
    ): ResolvedNode {
        if (!index.subtree.intersects(changed)) return resolved

        var values: MutableMap<String, MilanoValue>? = null
        for ((name, keys) in index.own) {
            if (!keys.intersects(changed)) continue
            val value = node.properties[name] as? DocValue.TypedExpression ?: continue
            val target = values ?: LinkedHashMap(resolved.values).also { values = it }
            target[name] = evaluate(value, node.reference, name, state, context, report)
        }

        val children =
            node.children.mapIndexed { position, child ->
                refresh(child, index.children[position], resolved.children[position], changed, state, context, report)
            }
        return ResolvedNode(
            type = resolved.type,
            reference = resolved.reference,
            isPlaceholder = resolved.isPlaceholder,
            rawSubtree = resolved.rawSubtree,
            values = values ?: resolved.values,
            children = children,
        )
    }
}
