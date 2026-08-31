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
    /**
     * The template node's reference and, for a `$repeat` instance, the
     * identity of each enclosing instance (an index or a key rendering,
     * outermost first), which together make [reference]. Internal: what
     * lets an emission find its template without parsing the reference.
     */
    val base: String = "",
    val identities: List<String> = emptyList(),
)

/**
 * Two elements of a keyed `$repeat` rendering the same key: a data defect.
 * The gate reports it as a build error; at runtime the update that
 * produced it is rejected whole.
 */
internal class RepeatKeyConflict(
    val reference: String,
    val key: String,
) : Exception("repeat $reference has two elements with key $key")

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
 * An occurrence raised while resolving: the kind, the node and property
 * being resolved, and, for an invalid function result, its detail (whose
 * name is the function's, already substituted for the property's).
 */
internal typealias ResolveReport = (MilanoOccurrence.Kind, String, String, ReportDetail?) -> Unit

/**
 * Resolution: the first pass evaluates every property expression and
 * materializes every `$repeat`; every later pass re-evaluates only what
 * reads a key whose value changed. Evaluation is total; division by zero,
 * saturation, and invalid function results report through the occurrence
 * pipeline, attributed to the owning node and property.
 */
internal object MilanoResolver {
    private fun evaluate(
        value: DocValue.TypedExpression,
        reference: String,
        name: String,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        env: EvalEnvironment,
    ): MilanoValue {
        val evaluator =
            ExprEvaluator(state, context, event = null, bindings = bindings, env = env) { kind, detail ->
                report(kind, reference, detail?.name ?: name, detail)
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
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        env: EvalEnvironment = EvalEnvironment.NONE,
    ): List<MilanoValue> {
        val items = node.repeatSpec?.items as? DocValue.TypedExpression ?: return emptyList()
        val evaluated = evaluate(items, reference, "items", state, context, report, bindings, env)
        return (evaluated as? MilanoValue.ArrayValue)?.values ?: emptyList()
    }

    /** The template's bindings for one element. */
    fun elementBindings(
        alias: String,
        element: MilanoValue,
        index: Int,
        outer: Map<String, MilanoValue>,
    ): Map<String, MilanoValue> = outer + (alias to element) + ("${alias}_index" to MilanoValue.IntValue(index.toLong()))

    /**
     * A key's rendering in an instance reference (document model spec,
     * Constructs): a string verbatim, an int in decimal.
     */
    fun renderKey(value: MilanoValue): String =
        when (value) {
            is MilanoValue.StringValue -> value.value
            is MilanoValue.IntValue -> value.value.toString()
            else -> ""
        }

    /** The bracketed identities that make an instance reference: `[2][abc]`. */
    fun suffixOf(identities: List<String>): String = identities.joinToString("") { "[$it]" }

    /**
     * The identity of every instance a `$repeat` materializes: the key's
     * rendering per element when it declares one, the element index
     * otherwise. Keys are distinct within one materialization.
     */
    fun instanceIdentities(
        node: BuiltNode,
        reference: String,
        elements: List<MilanoValue>,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        env: EvalEnvironment = EvalEnvironment.NONE,
    ): List<String> {
        val spec = node.repeatSpec
        val key = spec?.key as? DocValue.TypedExpression
        if (spec == null || key == null) return elements.indices.map { it.toString() }
        val identities = ArrayList<String>(elements.size)
        val seen = HashSet<String>()
        for ((index, element) in elements.withIndex()) {
            val bound = elementBindings(spec.alias, element, index, bindings)
            val identity = renderKey(evaluate(key, reference, "key", state, context, report, bound, env))
            if (!seen.add(identity)) throw RepeatKeyConflict(reference, identity)
            identities.add(identity)
        }
        return identities
    }

    private fun resolveRepeat(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        identities: List<String>,
        env: EvalEnvironment,
    ): List<ResolvedNode> {
        val spec = node.repeatSpec ?: return emptyList()
        val instances = ArrayList<ResolvedNode>()
        val reference = node.reference + suffixOf(identities)
        val elements = repeatElements(node, reference, state, context, report, bindings, env)
        val instanceIds = instanceIdentities(node, reference, elements, state, context, report, bindings, env)
        for ((index, element) in elements.withIndex()) {
            val bound = elementBindings(spec.alias, element, index, bindings)
            val instanceIdentities = identities + instanceIds[index]
            for (template in node.children) {
                // A nested construct instantiates within this element's scope.
                instances.addAll(materialize(template, state, context, report, bound, instanceIdentities, env))
            }
        }
        return instances
    }

    /**
     * The `${'$'}if` construct (document model spec, Constructs): the condition
     * is evaluated and only the chosen branch materializes, as only the
     * taken branch of the `${'$'}if` function is evaluated. Like a repeat, the
     * construct is transparent: its branch's nodes take its place.
     */
    private fun resolveConditional(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        identities: List<String>,
        env: EvalEnvironment,
    ): List<ResolvedNode> {
        val spec = node.conditional ?: return emptyList()
        val reference = node.reference + suffixOf(identities)
        val condition = spec.condition as? DocValue.TypedExpression ?: return emptyList()
        val taken =
            evaluate(condition, reference, "condition", state, context, report, bindings, env)
        val branch = if ((taken as? MilanoValue.BoolValue)?.value == true) spec.then else spec.otherwise
        val chosen = ArrayList<ResolvedNode>()
        for (child in branch) {
            chosen.addAll(materialize(child, state, context, report, bindings, identities, env))
        }
        return chosen
    }

    /**
     * The `${'$'}switch` construct (document model spec, Constructs): the
     * subject is evaluated and only the member's branch materializes, or
     * the default when the cases do not name it.
     */
    private fun resolveSwitch(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        identities: List<String>,
        env: EvalEnvironment,
    ): List<ResolvedNode> {
        val spec = node.choice ?: return emptyList()
        val subject = spec.subject as? DocValue.TypedExpression ?: return emptyList()
        val reference = node.reference + suffixOf(identities)
        val value =
            evaluate(
                subject,
                reference,
                "subject",
                state,
                context,
                report,
                bindings,
                env,
            )
        val member = (value as? MilanoValue.StringValue)?.value
        val branch = spec.cases[member] ?: spec.fallback ?: emptyList()
        val chosen = ArrayList<ResolvedNode>()
        for (child in branch) {
            chosen.addAll(materialize(child, state, context, report, bindings, identities, env))
        }
        return chosen
    }

    /**
     * One document node as the nodes it materializes: itself, or, for a
     * transparent construct, however many its branch or its elements make.
     */
    private fun materialize(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        identities: List<String>,
        env: EvalEnvironment,
    ): List<ResolvedNode> =
        when {
            node.repeatSpec != null -> {
                resolveRepeat(node, state, context, report, bindings, identities, env)
            }

            node.conditional != null -> {
                resolveConditional(node, state, context, report, bindings, identities, env)
            }

            node.choice != null -> {
                resolveSwitch(node, state, context, report, bindings, identities, env)
            }

            else -> {
                listOf(resolve(node, state, context, bindings, identities, env, report))
            }
        }

    private fun resolveChildren(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: ResolveReport,
        bindings: Map<String, MilanoValue>,
        identities: List<String>,
        env: EvalEnvironment,
    ): Pair<List<ResolvedNode>, List<Int>> {
        val children = ArrayList<ResolvedNode>()
        val spans = ArrayList<Int>()
        for (child in node.children) {
            val materialized = materialize(child, state, context, report, bindings, identities, env)
            children.addAll(materialized)
            spans.add(materialized.size)
        }
        return children to spans
    }

    /**
     * The first resolution. Inside a repeat instance, [identities] carries
     * the element indices or key renderings that make its reference.
     * Throws [RepeatKeyConflict] when a keyed repeat renders one key twice.
     */
    fun resolve(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        bindings: Map<String, MilanoValue> = emptyMap(),
        identities: List<String> = emptyList(),
        env: EvalEnvironment = EvalEnvironment.NONE,
        report: ResolveReport,
    ): ResolvedNode {
        val reference = node.reference + suffixOf(identities)
        val values = LinkedHashMap<String, MilanoValue>()
        for ((name, value) in node.properties) {
            values[name] =
                when (value) {
                    is DocValue.Literal -> {
                        value.value
                    }

                    is DocValue.TypedExpression -> {
                        evaluate(value, reference, name, state, context, report, bindings, env)
                    }

                    // Unreachable: the gate types every expression.
                    is DocValue.Expression -> {
                        MilanoValue.Null
                    }
                }
        }
        val (children, spans) = resolveChildren(node, state, context, report, bindings, identities, env)
        return ResolvedNode(
            type = node.type,
            reference = reference,
            isPlaceholder = node.isPlaceholder,
            rawSubtree = node.rawSubtree,
            values = values,
            children = children,
            spans = spans,
            base = node.reference,
            identities = identities,
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
        (node.repeatSpec?.key as? DocValue.TypedExpression)?.let { key ->
            val keys = key.expr.dependencies()
            own["key"] = keys
            subtree.addAll(keys)
        }
        // A construct's own expression decides which branch materializes,
        // so a change to what it reads is a change to the subtree.
        (node.conditional?.condition as? DocValue.TypedExpression)?.let { condition ->
            val keys = condition.expr.dependencies()
            own["condition"] = keys
            subtree.addAll(keys)
        }
        (node.choice?.subject as? DocValue.TypedExpression)?.let { subject ->
            val keys = subject.expr.dependencies()
            own["subject"] = keys
            subtree.addAll(keys)
        }
        // Branch nodes are indexed too, so their reads reach this
        // subtree. `refresh` addresses `children` positionally against
        // `node.children`, and these sit past that range, read only for
        // the union.
        val children = (node.children + (node.branchNodes() ?: emptyList())).map(::index)
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
        env: EvalEnvironment = EvalEnvironment.NONE,
        report: ResolveReport,
    ): ResolvedNode {
        if (!index.subtree.intersects(changed)) return resolved

        var values: MutableMap<String, MilanoValue>? = null
        for ((name, keys) in index.own) {
            if (!keys.intersects(changed)) continue
            val value = node.properties[name] as? DocValue.TypedExpression ?: continue
            val target = values ?: LinkedHashMap(resolved.values).also { values = it }
            target[name] = evaluate(value, resolved.reference, name, state, context, report, emptyMap(), env)
        }

        val children = ArrayList<ResolvedNode>()
        val spans = ArrayList<Int>()
        var offset = 0
        for ((position, child) in node.children.withIndex()) {
            val span = resolved.spans.getOrElse(position) { 1 }
            val childIndex = index.children[position]
            // Every transparent construct re-materializes wholesale: how
            // many nodes it makes is its own business, and a changed
            // condition or subject can change which nodes those are.
            if (child.repeatSpec != null || child.conditional != null || child.choice != null) {
                if (childIndex.subtree.intersects(changed)) {
                    val made = materialize(child, state, context, report, emptyMap(), resolved.identities, env)
                    children.addAll(made)
                    spans.add(made.size)
                } else {
                    children.addAll(resolved.children.subList(offset, offset + span))
                    spans.add(span)
                }
            } else {
                val previous = resolved.children[offset]
                children.add(refresh(child, childIndex, previous, changed, state, context, env, report))
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
            base = resolved.base,
            identities = resolved.identities,
        )
    }
}
