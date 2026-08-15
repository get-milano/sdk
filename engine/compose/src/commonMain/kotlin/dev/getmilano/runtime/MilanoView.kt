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
    )

    internal class DispatchRecord(
        val action: MilanoAction,
        var completed: Boolean,
        val onSuccess: List<ActionSpec>,
        val onFailure: List<ActionSpec>,
        val capturedEvent: MilanoValue?,
    )

    private val nodeEvents = HashMap<String, NodeEvents>()
    private val queue = ArrayDeque<Pair<List<ActionSpec>, MilanoValue?>>()
    private var processing = false
    private var tornDown = false
    internal val dispatched = ArrayList<DispatchRecord>()
    private val handlerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    init {
        indexNodes(root)
    }

    private fun indexNodes(node: BuiltNode) {
        if (!node.isPlaceholder) {
            engine.vocabulary.components[node.type]?.let { component ->
                nodeEvents[node.reference] = NodeEvents(component.events, node.events)
            }
        }
        for (child in node.children) indexNodes(child)
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
     * The view ceases to participate: completions arriving afterwards drop
     * their follow-ups and report.
     */
    fun teardown() {
        dispatcher.dispatch { tornDown = true }
    }

    // Runtime (always on the dispatcher)

    private fun processEmission(
        node: String,
        event: String,
        payload: MilanoValue?,
    ) {
        if (tornDown) return
        val info = nodeEvents[node]
        if (info == null || event !in info.declared) {
            report(MilanoOccurrence.Kind.INVALID_EMISSION, node)
            return
        }
        val payloadType = info.declared[event]
        var eventValue: MilanoValue? = null
        if (payloadType != null) {
            val validated = payload?.let { payloadType.validated(it) }
            if (validated == null) {
                report(MilanoOccurrence.Kind.INVALID_EMISSION, node)
                return
            }
            eventValue = validated
        } else if (payload != null) {
            report(MilanoOccurrence.Kind.INVALID_EMISSION, node)
            return
        }
        val actions = info.bindings[event]
        if (actions.isNullOrEmpty()) {
            report(MilanoOccurrence.Kind.DROPPED_EVENT, node)
            return
        }
        enqueue(actions to eventValue)
    }

    internal fun applyContextUpdate(supplied: Map<String, MilanoValue>) {
        if (tornDown) return
        // Atomic: all declared keys validate or the whole update is rejected.
        val canonical = LinkedHashMap<String, MilanoValue>()
        for ((key, type) in document.contextDeclarations) {
            val validated = supplied[key]?.let { type.validated(it) }
            if (validated == null) {
                report(MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE, null)
                return
            }
            canonical[key] = validated
        }
        context = canonical
        reResolve()
    }

    /**
     * Internal completion path; the async funnel lands here, and the
     * conformance harness drives it directly.
     */
    internal fun complete(
        dispatchIndex: Int,
        success: Boolean,
    ) {
        if (dispatchIndex >= dispatched.size) return
        if (tornDown) {
            report(MilanoOccurrence.Kind.COMPLETION_AFTER_TEARDOWN, null)
            return
        }
        val record = dispatched[dispatchIndex]
        if (record.completed) {
            report(MilanoOccurrence.Kind.DUPLICATE_COMPLETION, null)
            return
        }
        record.completed = true
        val followUps = if (success) record.onSuccess else record.onFailure
        if (followUps.isNotEmpty()) {
            enqueue(followUps to record.capturedEvent)
        }
    }

    private fun enqueue(item: Pair<List<ActionSpec>, MilanoValue?>) {
        queue.addLast(item)
        if (processing) return
        processing = true
        while (queue.isNotEmpty()) {
            val (actions, event) = queue.removeFirst()
            execute(actions, event)
        }
        processing = false
    }

    private fun execute(
        actions: List<ActionSpec>,
        event: MilanoValue?,
    ) {
        for (action in actions) {
            when (action) {
                is ActionSpec.Set -> {
                    val declared = document.stateDeclarations[action.key]
                    val evaluated = evaluate(action.value, event)
                    state = state + (action.key to (declared?.validated(evaluated) ?: evaluated))
                    // Visible immediately: re-resolution before the next action.
                    reResolve()
                }

                is ActionSpec.Sequence -> {
                    execute(action.actions, event)
                }

                is ActionSpec.When -> {
                    val takeThen = evaluate(action.condition, event).boolOrNull == true
                    execute(if (takeThen) action.then else action.otherwise, event)
                }

                is ActionSpec.Custom -> {
                    val captured = LinkedHashMap<String, MilanoValue>()
                    for ((parameter, value) in action.parameters) {
                        captured[parameter] = evaluate(value, event)
                    }
                    val milanoAction = MilanoAction(action.name, captured, identity)
                    val index = dispatched.size
                    dispatched.add(DispatchRecord(milanoAction, false, action.onSuccess, action.onFailure, event))
                    // Dispatch does not wait: the sequence continues immediately.
                    val funnel = handler
                    if (funnel != null) {
                        handlerScope.launch {
                            val success =
                                try {
                                    funnel.handle(milanoAction)
                                    true
                                } catch (_: Exception) {
                                    false
                                }
                            dispatcher.dispatch { complete(index, success) }
                        }
                    }
                }
            }
        }
    }

    private fun evaluate(
        value: DocValue,
        event: MilanoValue?,
    ): MilanoValue =
        when (value) {
            is DocValue.Literal -> {
                value.value
            }

            is DocValue.TypedExpression -> {
                val evaluator = ExprEvaluator(state, context, event) { kind -> report(kind, null) }
                val result = evaluator.evaluate(value.expr)
                value.expected.validated(result) ?: result
            }

            is DocValue.Expression -> {
                MilanoValue.Null
            }
        }

    private fun reResolve() {
        resolvedRoot =
            MilanoResolver.resolve(root, state, context) { kind, node ->
                report(kind, node)
            }
        invalidations.value += 1
        onChange?.invoke()
    }

    private fun report(
        kind: MilanoOccurrence.Kind,
        node: String?,
    ) {
        engine.observer?.occurrence(MilanoOccurrence(kind, identity, node))
    }
}
