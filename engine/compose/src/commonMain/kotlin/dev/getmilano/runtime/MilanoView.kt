package dev.getmilano

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * The built, guaranteed-renderable view: bound to one document for its
 * lifetime. Runtime semantics per the state and actions spec; everything
 * mutable runs through the view's serial dispatcher.
 */
class MilanoView internal constructor(
    val identity: String,
    internal val engine: MilanoEngine,
    internal val document: ParsedDocument,
    internal val root: BuiltNode,
    resolvedRoot: ResolvedNode,
    context: Map<String, MilanoValue>,
    state: Map<String, MilanoValue>,
    internal val dispatcher: MilanoDispatcher,
    internal val handler: MilanoActionHandler?,
    internal val occurrencesAtBuild: List<MilanoOccurrence>,
) {
    internal var resolvedRoot: ResolvedNode = resolvedRoot
        private set

    /** What every expression reads, indexed once: the update path's map. */
    private val dependencies = MilanoResolver.index(root)
    internal var context: Map<String, MilanoValue> = context
        private set
    internal var state: Map<String, MilanoValue> = state
        private set

    /** Rendering hook: invoked after every re-resolution, on the dispatcher. */
    internal var onChange: (() -> Unit)? = null

    /**
     * View-level invalidation: one signal per re-resolution; Compose's
     * diffing keeps actual UI updates minimal.
     */
    private val invalidations = androidx.compose.runtime.mutableStateOf(0)

    /** The view's Compose content: bound to this document for its lifetime. */
    @androidx.compose.runtime.Composable
    fun Content() {
        @Suppress("UNUSED_EXPRESSION")
        invalidations.value
        RenderNode(this, resolvedRoot)
    }

    private class NodeEvents(
        val declared: Map<String, MilanoType?>,
        val bindings: Map<String, List<ActionSpec>>,
        /** The enclosing `$repeat` constructs, outermost first. */
        val repeats: List<BuiltNode>,
    )

    internal class DispatchRecord(
        val action: MilanoAction,
        var completed: Boolean,
        val onSuccess: List<ActionSpec>,
        val onFailure: List<ActionSpec>,
        val capturedEvent: MilanoValue?,
        /** The `$repeat` bindings in scope at dispatch, kept for follow-ups. */
        val capturedBindings: Map<String, MilanoValue>,
        val resultType: MilanoType?,
        val sourceNode: String?,
    )

    /**
     * A tree an update would produce, with the reports it raised held back
     * until the update is accepted.
     */
    private class Materialized(
        val tree: ResolvedNode,
        val count: Int,
        val reports: List<Triple<MilanoOccurrence.Kind, String, String>>,
    )

    private val nodeEvents = HashMap<String, NodeEvents>()

    /**
     * One serialized work queue: action lists and context updates both run
     * through it, so an update can never land mid-action-list even when a
     * re-entrant post arrives on the dispatcher thread.
     */
    private val queue = ArrayDeque<() -> Unit>()
    private var processing = false
    private var tornDown = false

    /** Cancels the context source subscription; invoked at teardown. */
    internal var cancelContextSubscription: (() -> Unit)? = null
    internal val dispatched = ArrayList<DispatchRecord>()
    private val handlerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    init {
        indexNodes(root)
    }

    private fun indexNodes(
        node: BuiltNode,
        repeats: List<BuiltNode> = emptyList(),
    ) {
        if (node.repeatSpec != null) {
            for (template in node.children) indexNodes(template, repeats + node)
            return
        }
        if (!node.isPlaceholder) {
            engine.vocabulary.components[node.type]?.let { component ->
                nodeEvents[node.reference] = NodeEvents(component.events, node.events, repeats)
            }
        }
        for (child in node.children) indexNodes(child, repeats)
    }

    /**
     * An instance reference split into its template reference and the
     * element index per enclosing `$repeat`, outermost first: `line[2][0]`
     * is `line` at 2 then 0. A plain reference has no indices.
     */
    private fun splitInstanceReference(reference: String): Pair<String, List<Int>> {
        var base = reference
        val indices = ArrayList<Int>()
        while (base.endsWith("]")) {
            val open = base.lastIndexOf('[')
            val index = if (open < 0) null else base.substring(open + 1, base.length - 1).toIntOrNull()
            if (index == null) break
            indices.add(0, index)
            base = base.substring(0, open)
        }
        return base to indices
    }

    /**
     * The `$repeat` bindings an instance's emission dispatches with: the
     * element at each index, evaluated now, outermost repeat first. Null
     * when an index no longer exists.
     */
    private fun bindingsFor(
        info: NodeEvents,
        indices: List<Int>,
    ): Map<String, MilanoValue>? {
        var bindings: Map<String, MilanoValue> = emptyMap()
        var suffix = ""
        for ((level, repeatNode) in info.repeats.withIndex()) {
            val index = indices[level]
            val elements =
                MilanoResolver.repeatElements(repeatNode, repeatNode.reference + suffix, state, context, { _, _, _ -> }, bindings)
            val spec = repeatNode.repeatSpec
            if (index >= elements.size || spec == null) return null
            bindings = MilanoResolver.elementBindings(spec.alias, elements[index], index, bindings)
            suffix += "[$index]"
        }
        return bindings
    }

    // Renderer-facing surface

    /**
     * A renderer emission. Undeclared events and mis-typed payloads are
     * dropped and reported before reaching dispatch; declared events with
     * no binding are dropped and reported.
     */
    fun emit(
        node: String,
        event: String,
        payload: MilanoValue? = null,
    ) {
        dispatcher.dispatch { processEmission(node, event, payload) }
    }

    /**
     * The document's `metadata` section, verbatim and untyped: producer
     * annotations reach host code without a side channel.
     */
    val metadata: MilanoValue? get() = document.metadata

    /**
     * The view ceases to participate: completions arriving afterwards drop
     * their follow-ups and report.
     */
    fun teardown() {
        cancelContextSubscription?.invoke()
        cancelContextSubscription = null
        dispatcher.dispatch {
            if (!tornDown) {
                tornDown = true
                record(MilanoUserInteraction.Kind.VIEW_TORN_DOWN, null, null, null)
            }
        }
    }

    // Runtime (always on the dispatcher)

    private fun processEmission(
        node: String,
        event: String,
        payload: MilanoValue?,
    ) {
        if (tornDown) return
        // A plain reference, or an instance reference: the template's
        // reference with one index per enclosing repeat.
        var info = nodeEvents[node]
        var indices: List<Int> = emptyList()
        if (info == null || info.repeats.isNotEmpty()) {
            val (base, split) = splitInstanceReference(node)
            val candidate = nodeEvents[base]
            if (candidate != null && candidate.repeats.size == split.size) {
                info = candidate
                indices = split
            } else {
                info = null
            }
        }
        if (info == null) {
            report(
                MilanoOccurrence.Kind.INVALID_EMISSION,
                node,
                name = event,
                expected = "declared event",
                found = "unknown node",
            )
            return
        }
        val bindings = bindingsFor(info, indices)
        if (bindings == null) {
            report(
                MilanoOccurrence.Kind.INVALID_EMISSION,
                node,
                name = event,
                expected = "repeat element",
                found = "index ${indices.lastOrNull() ?: 0}",
            )
            return
        }
        if (event !in info.declared) {
            report(
                MilanoOccurrence.Kind.INVALID_EMISSION,
                node,
                name = event,
                expected = "declared event",
                found = "undeclared event",
            )
            return
        }
        val payloadType = info.declared[event]
        var eventValue: MilanoValue? = null
        if (payloadType != null) {
            val validated = payload?.let { payloadType.validated(it) }
            if (validated == null) {
                report(
                    MilanoOccurrence.Kind.INVALID_EMISSION,
                    node,
                    name = event,
                    expected = MilanoGate.name(payloadType),
                    found = payload?.let { MilanoGate.name(it) } ?: "null",
                )
                return
            }
            eventValue = validated
        } else if (payload != null) {
            report(
                MilanoOccurrence.Kind.INVALID_EMISSION,
                node,
                name = event,
                expected = "no payload",
                found = MilanoGate.name(payload),
            )
            return
        }
        // Analytics sees every declared emission with a valid payload,
        // before the binding lookup: unbound taps are signal for the host
        // even while droppedEvent keeps its defect meaning.
        record(MilanoUserInteraction.Kind.EVENT, node, event, eventValue)
        val actions = info.bindings[event]
        if (actions.isNullOrEmpty()) {
            report(MilanoOccurrence.Kind.DROPPED_EVENT, node, name = event)
            return
        }
        enqueue { execute(actions, eventValue, null, sourceNode = node, bindings = bindings) }
    }

    internal fun applyContextUpdate(supplied: Map<String, MilanoValue>) {
        // Serialized with dispatch through the queue: an update never lands
        // mid-action-list (state and actions spec).
        enqueue { performContextUpdate(supplied) }
    }

    private fun performContextUpdate(supplied: Map<String, MilanoValue>) {
        if (tornDown) return
        // Atomic: all declared keys validate or the whole update is rejected.
        val canonical = LinkedHashMap<String, MilanoValue>()
        val changed = LinkedHashSet<String>()
        var lastKey: String? = null
        for ((key, type) in document.contextDeclarations) {
            val validated = supplied[key]?.let { type.validated(it) }
            if (validated == null) {
                report(
                    MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE,
                    null,
                    name = key,
                    expected = MilanoGate.name(type),
                    found = supplied[key]?.let { MilanoGate.name(it) } ?: "missing",
                )
                return
            }
            // A value past the value size limit rejects the update whole.
            val size = validated.size
            if (size > engine.limits.maxValueSize) {
                report(
                    MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE,
                    null,
                    name = key,
                    expected = "maxValueSize",
                    found = size.toString(),
                )
                return
            }
            canonical[key] = validated
            if (context[key] != validated) changed.add("context.$key")
            lastKey = key
        }
        // Only what reads a changed key re-evaluates; an update that changes
        // no value changes nothing. A tree materialized past the node count
        // limit rejects the update whole.
        if (changed.isEmpty()) {
            context = canonical
            return
        }
        val materialized = materialize(changed, state, canonical)
        if (materialized.count > engine.limits.maxNodeCount) {
            report(
                MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE,
                null,
                name = lastKey,
                expected = "maxNodeCount",
                found = materialized.count.toString(),
            )
            return
        }
        context = canonical
        commit(materialized)
    }

    /**
     * Internal completion path; the async funnel lands here, and the
     * conformance harness drives it directly.
     */
    internal fun complete(
        dispatchIndex: Int,
        success: Boolean,
        payload: MilanoValue? = null,
    ) {
        if (dispatchIndex >= dispatched.size) return
        val action = dispatched[dispatchIndex].action.name
        if (tornDown) {
            report(MilanoOccurrence.Kind.COMPLETION_AFTER_TEARDOWN, null, name = action)
            return
        }
        val record = dispatched[dispatchIndex]
        if (record.completed) {
            report(MilanoOccurrence.Kind.DUPLICATE_COMPLETION, null, name = action)
            return
        }
        record.completed = true

        // The success value against the declared result type: a missing
        // value counts as null, a value on failure or on an action
        // declaring no result never validates. An invalid completion is
        // consumed without running either branch (state and actions spec).
        var resultValue: MilanoValue? = null
        val resultType = record.resultType
        if (success && resultType != null) {
            resultValue = resultType.validated(payload ?: MilanoValue.Null)
            if (resultValue == null) {
                report(
                    MilanoOccurrence.Kind.INVALID_COMPLETION,
                    null,
                    name = action,
                    expected = MilanoGate.name(resultType),
                    found = MilanoGate.name(payload ?: MilanoValue.Null),
                )
                return
            }
        } else if (payload != null) {
            report(
                MilanoOccurrence.Kind.INVALID_COMPLETION,
                null,
                name = action,
                expected = if (success) "no result" else "no payload",
                found = MilanoGate.name(payload),
            )
            return
        }

        record(
            if (success) {
                MilanoUserInteraction.Kind.COMPLETION_SUCCEEDED
            } else {
                MilanoUserInteraction.Kind.COMPLETION_FAILED
            },
            record.sourceNode,
            record.action.name,
            null,
        )

        val followUps = if (success) record.onSuccess else record.onFailure
        if (followUps.isNotEmpty()) {
            val captured = record.capturedEvent
            val bindings = record.capturedBindings
            val source = record.sourceNode
            enqueue { execute(followUps, captured, resultValue, sourceNode = source, bindings = bindings) }
        }
    }

    private fun enqueue(work: () -> Unit) {
        queue.addLast(work)
        if (processing) return
        processing = true
        try {
            while (queue.isNotEmpty()) {
                queue.removeFirst()()
            }
        } finally {
            // A host listener or renderer that throws unwinds through here.
            // The queue is cleared and the flag released: the throw still
            // reaches the caller, and the view stays usable instead of
            // silently dying with work stuck behind a flag never reset.
            queue.clear()
            processing = false
        }
    }

    /**
     * Runs an action list. Returns false when the list ended early: a `$set`
     * past the value size limit assigns nothing, is reported, and stops the
     * remaining actions of the dispatch; what the list already applied
     * stays.
     */
    private fun execute(
        actions: List<ActionSpec>,
        event: MilanoValue?,
        result: MilanoValue?,
        sourceNode: String?,
        bindings: Map<String, MilanoValue> = emptyMap(),
    ): Boolean {
        for (action in actions) {
            when (action) {
                is ActionSpec.Set -> {
                    val declared = document.stateDeclarations[action.key]
                    val evaluated = evaluate(action.value, event, result, bindings)
                    val next = declared?.validated(evaluated) ?: evaluated
                    val size = next.size
                    if (size > engine.limits.maxValueSize) {
                        report(
                            MilanoOccurrence.Kind.REJECTED_MUTATION,
                            sourceNode,
                            name = action.key,
                            expected = "maxValueSize",
                            found = size.toString(),
                        )
                        return false
                    }
                    // A value that did not change re-resolves nothing.
                    if (state[action.key] == next) continue
                    val nextState = state + (action.key to next)
                    // Visible immediately: the properties that read this key
                    // re-resolve before the next action. A tree materialized
                    // past the node count limit rejects the mutation instead.
                    val materialized = materialize(setOf("state.${action.key}"), nextState, context)
                    if (materialized.count > engine.limits.maxNodeCount) {
                        report(
                            MilanoOccurrence.Kind.REJECTED_MUTATION,
                            sourceNode,
                            name = action.key,
                            expected = "maxNodeCount",
                            found = materialized.count.toString(),
                        )
                        return false
                    }
                    state = nextState
                    commit(materialized)
                }

                is ActionSpec.Sequence -> {
                    if (!execute(action.actions, event, result, sourceNode, bindings)) return false
                }

                is ActionSpec.When -> {
                    val takeThen = evaluate(action.condition, event, result, bindings).boolOrNull == true
                    val branch = if (takeThen) action.then else action.otherwise
                    if (!execute(branch, event, result, sourceNode, bindings)) return false
                }

                is ActionSpec.Custom -> {
                    val captured = LinkedHashMap<String, MilanoValue>()
                    for ((parameter, value) in action.parameters) {
                        captured[parameter] = evaluate(value, event, result, bindings)
                    }
                    val milanoAction = MilanoAction(action.name, captured, identity)
                    record(
                        MilanoUserInteraction.Kind.ACTION_DISPATCHED,
                        sourceNode,
                        action.name,
                        MilanoValue.RecordValue(captured),
                    )
                    val index = dispatched.size
                    dispatched.add(
                        DispatchRecord(
                            milanoAction,
                            false,
                            action.onSuccess,
                            action.onFailure,
                            event,
                            bindings,
                            action.result,
                            sourceNode,
                        ),
                    )
                    // Dispatch does not wait: the sequence continues immediately.
                    val funnel = handler
                    if (funnel != null) {
                        handlerScope.launch {
                            var payload: MilanoValue? = null
                            val success =
                                try {
                                    payload = funnel.handle(milanoAction)
                                    true
                                } catch (_: Exception) {
                                    false
                                }
                            dispatcher.dispatch { complete(index, success, payload) }
                        }
                    }
                }
            }
        }
        return true
    }

    private fun evaluate(
        value: DocValue,
        event: MilanoValue?,
        result: MilanoValue?,
        bindings: Map<String, MilanoValue> = emptyMap(),
    ): MilanoValue =
        when (value) {
            is DocValue.Literal -> {
                value.value
            }

            is DocValue.TypedExpression -> {
                val evaluator = ExprEvaluator(state, context, event, result, bindings) { kind -> report(kind, null) }
                val evaluated = evaluator.evaluate(value.expr)
                value.expected.validated(evaluated) ?: evaluated
            }

            is DocValue.Expression -> {
                MilanoValue.Null
            }
        }

    /**
     * The tree an update would produce, with the arithmetic reports it
     * raised held back: nothing reaches the observer until the update is
     * accepted, and a rejected one leaves no trace.
     */
    private fun materialize(
        changed: Set<String>,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
    ): Materialized {
        val reports = ArrayList<Triple<MilanoOccurrence.Kind, String, String>>()
        val tree =
            MilanoResolver.refresh(root, dependencies, resolvedRoot, changed, state, context) { kind, node, name ->
                reports.add(Triple(kind, node, name))
            }
        val count = if (tree === resolvedRoot) 0 else MilanoResolver.countNodes(tree)
        return Materialized(tree, count, reports)
    }

    /** Adopts a materialized tree, flushes its reports, notifies the host. */
    private fun commit(materialized: Materialized) {
        for ((kind, node, name) in materialized.reports) report(kind, node, name = name)
        // Nothing depended on the change: the tree is the same instance, and
        // there is nothing to tell the host.
        if (materialized.tree === resolvedRoot) return
        resolvedRoot = materialized.tree
        invalidations.value += 1
        onChange?.invoke()
    }

    /** The product-analytics seam: a no-op without an observer. */
    internal fun record(
        kind: MilanoUserInteraction.Kind,
        node: String?,
        name: String?,
        value: MilanoValue?,
    ) {
        engine.userInteractionObserver?.interaction(
            MilanoUserInteraction(kind, identity, node, name, value),
        )
    }

    private fun report(
        kind: MilanoOccurrence.Kind,
        node: String?,
        name: String? = null,
        expected: String? = null,
        found: String? = null,
    ) {
        engine.observer?.occurrence(MilanoOccurrence(kind, identity, node, name, expected, found))
    }
}
