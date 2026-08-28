package dev.getmilano

/** A node with every property expression evaluated: what renderers see. */
internal class ResolvedNode(
    val type: String,
    val reference: String,
    val isPlaceholder: Boolean,
    val rawSubtree: MilanoValue?,
    val values: Map<String, MilanoValue>,
    val children: List<ResolvedNode>,
    /**
     * Resolved children per built child, in order: one for a component
     * node, the instance count for a `$repeat`. Internal to re-resolution.
     */
    val spans: List<Int> = emptyList(),
)

/**
 * What a built subtree reads: per property, the keys its expression
 * depends on; for the subtree as a whole, their union. A `$repeat`'s
 * subtree includes what its `items` read, since every instance derives
 * from them. Built once per view, aligned with the built tree's children,
 * so an update knows which nodes to revisit without walking the rest.
 */
internal class DependencyNode(
    val own: Map<String, Set<String>>,
    val subtree: Set<String>,
    val children: List<DependencyNode>,
)

/**
 * Resolution: the first pass evaluates every property expression and
 * materializes every `$repeat`; every later pass re-evaluates only what
 * reads a key whose value changed. Evaluation is total; division by zero
 * and saturation report through the occurrence pipeline, attributed to the
 * owning node and property.
 */
internal object MilanoResolver {
    private fun evaluate(
        value: DocValue.TypedExpression,
        reference: String,
        name: String,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
        bindings: Map<String, MilanoValue>,
    ): MilanoValue {
        val evaluator =
            ExprEvaluator(state, context, event = null, bindings = bindings) { kind ->
                report(kind, reference, name)
            }
        val result = evaluator.evaluate(value.expr)
        // Canonicalize toward the declared type (int where double is declared).
        return value.expected.validated(result) ?: result
    }

    /** The elements a `$repeat` instantiates over, right now. */
    fun repeatElements(
        node: BuiltNode,
        reference: String,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
        bindings: Map<String, MilanoValue>,
    ): List<MilanoValue> {
        val items = node.repeatSpec?.items as? DocValue.TypedExpression ?: return emptyList()
        val evaluated = evaluate(items, reference, "items", state, context, report, bindings)
        return (evaluated as? MilanoValue.ArrayValue)?.values ?: emptyList()
    }

    /** The template's bindings for one element. */
    fun elementBindings(
        alias: String,
        element: MilanoValue,
        index: Int,
        outer: Map<String, MilanoValue>,
    ): Map<String, MilanoValue> = outer + (alias to element) + ("${alias}_index" to MilanoValue.IntValue(index.toLong()))

    private fun resolveRepeat(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
        bindings: Map<String, MilanoValue>,
        suffix: String,
    ): List<ResolvedNode> {
        val spec = node.repeatSpec ?: return emptyList()
        val instances = ArrayList<ResolvedNode>()
        val elements = repeatElements(node, node.reference + suffix, state, context, report, bindings)
        for ((index, element) in elements.withIndex()) {
            val bound = elementBindings(spec.alias, element, index, bindings)
            val instanceSuffix = "$suffix[$index]"
            for (template in node.children) {
                // A nested repeat instantiates within this element's scope.
                if (template.repeatSpec != null) {
                    instances.addAll(resolveRepeat(template, state, context, report, bound, instanceSuffix))
                } else {
                    instances.add(resolve(template, state, context, bound, instanceSuffix, report))
                }
            }
        }
        return instances
    }

    private fun resolveChildren(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
        bindings: Map<String, MilanoValue>,
        suffix: String,
    ): Pair<List<ResolvedNode>, List<Int>> {
        val children = ArrayList<ResolvedNode>()
        val spans = ArrayList<Int>()
        for (child in node.children) {
            if (child.repeatSpec != null) {
                val instances = resolveRepeat(child, state, context, report, bindings, suffix)
                children.addAll(instances)
                spans.add(instances.size)
            } else {
                children.add(resolve(child, state, context, bindings, suffix, report))
                spans.add(1)
            }
        }
        return children to spans
    }

    /**
     * The first resolution. Inside a repeat instance, [suffix] carries the
     * element indices that make its reference.
     */
    fun resolve(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        bindings: Map<String, MilanoValue> = emptyMap(),
        suffix: String = "",
        report: (MilanoOccurrence.Kind, String, String) -> Unit,
    ): ResolvedNode {
        val reference = node.reference + suffix
        val values = LinkedHashMap<String, MilanoValue>()
        for ((name, value) in node.properties) {
            values[name] =
                when (value) {
                    is DocValue.Literal -> {
                        value.value
                    }

                    is DocValue.TypedExpression -> {
                        evaluate(value, reference, name, state, context, report, bindings)
                    }

                    // Unreachable: the gate types every expression.
                    is DocValue.Expression -> {
                        MilanoValue.Null
                    }
                }
        }
        val (children, spans) = resolveChildren(node, state, context, report, bindings, suffix)
        return ResolvedNode(
            type = node.type,
            reference = reference,
            isPlaceholder = node.isPlaceholder,
            rawSubtree = node.rawSubtree,
            values = values,
            children = children,
            spans = spans,
        )
    }

    /** Nodes in a resolved tree: the node count limit's runtime measure. */
    fun countNodes(node: ResolvedNode): Int = node.children.fold(1) { count, child -> count + countNodes(child) }

    fun index(node: BuiltNode): DependencyNode {
        val own = LinkedHashMap<String, Set<String>>()
        val subtree = LinkedHashSet<String>()
        for ((name, value) in node.properties) {
            if (value !is DocValue.TypedExpression) continue
            val keys = value.expr.dependencies()
            own[name] = keys
            subtree.addAll(keys)
        }
        (node.repeatSpec?.items as? DocValue.TypedExpression)?.let { items ->
            val keys = items.expr.dependencies()
            own["items"] = keys
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
     * instance it was; a `$repeat` whose subtree reads a changed key is
     * re-materialized whole. Returns [resolved] itself when nothing under it
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
            target[name] = evaluate(value, resolved.reference, name, state, context, report, emptyMap())
        }

        val children = ArrayList<ResolvedNode>()
        val spans = ArrayList<Int>()
        var offset = 0
        for ((position, child) in node.children.withIndex()) {
            val span = resolved.spans.getOrElse(position) { 1 }
            val childIndex = index.children[position]
            if (child.repeatSpec != null) {
                if (childIndex.subtree.intersects(changed)) {
                    val instances = resolveRepeat(child, state, context, report, emptyMap(), "")
                    children.addAll(instances)
                    spans.add(instances.size)
                } else {
                    children.addAll(resolved.children.subList(offset, offset + span))
                    spans.add(span)
                }
            } else {
                val previous = resolved.children[offset]
                children.add(refresh(child, childIndex, previous, changed, state, context, report))
                spans.add(1)
            }
            offset += span
        }
        return ResolvedNode(
            type = resolved.type,
            reference = resolved.reference,
            isPlaceholder = resolved.isPlaceholder,
            rawSubtree = resolved.rawSubtree,
            values = values ?: resolved.values,
            children = children,
            spans = spans,
        )
    }
}
