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
    )

    internal class DispatchRecord(
        val action: MilanoAction,
        var completed: Boolean,
        val onSuccess: List<ActionSpec>,
        val onFailure: List<ActionSpec>,
        val capturedEvent: MilanoValue?,
        val resultType: MilanoType?,
        val sourceNode: String?,
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
        val info = nodeEvents[node]
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
        enqueue { execute(actions, eventValue, null, sourceNode = node) }
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
                    expected = engine.limits.maxValueSize.toString(),
                    found = size.toString(),
                )
                return
            }
            canonical[key] = validated
            if (context[key] != validated) changed.add("context.$key")
        }
        context = canonical
        // Only what reads a changed key re-evaluates; an update that changes
        // no value changes nothing.
        if (changed.isNotEmpty()) reResolve(changed)
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
            val source = record.sourceNode
            enqueue { execute(followUps, captured, resultValue, sourceNode = source) }
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
    ): Boolean {
        for (action in actions) {
            when (action) {
                is ActionSpec.Set -> {
                    val declared = document.stateDeclarations[action.key]
                    val evaluated = evaluate(action.value, event, result)
                    val next = declared?.validated(evaluated) ?: evaluated
                    val size = next.size
                    if (size > engine.limits.maxValueSize) {
                        report(
                            MilanoOccurrence.Kind.REJECTED_MUTATION,
                            sourceNode,
                            name = action.key,
                            expected = engine.limits.maxValueSize.toString(),
                            found = size.toString(),
                        )
                        return false
                    }
                    val previous = state[action.key]
                    state = state + (action.key to next)
                    // Visible immediately: the properties that read this key
                    // re-resolve before the next action. A value that did not
                    // change re-resolves nothing.
                    if (previous != next) reResolve(setOf("state.${action.key}"))
                }

                is ActionSpec.Sequence -> {
                    if (!execute(action.actions, event, result, sourceNode)) return false
                }

                is ActionSpec.When -> {
                    val takeThen = evaluate(action.condition, event, result).boolOrNull == true
                    if (!execute(if (takeThen) action.then else action.otherwise, event, result, sourceNode)) return false
                }

                is ActionSpec.Custom -> {
                    val captured = LinkedHashMap<String, MilanoValue>()
                    for ((parameter, value) in action.parameters) {
                        captured[parameter] = evaluate(value, event, result)
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
    ): MilanoValue =
        when (value) {
            is DocValue.Literal -> {
                value.value
            }

            is DocValue.TypedExpression -> {
                val evaluator = ExprEvaluator(state, context, event, result) { kind -> report(kind, null) }
                val evaluated = evaluator.evaluate(value.expr)
                value.expected.validated(evaluated) ?: evaluated
            }

            is DocValue.Expression -> {
                MilanoValue.Null
            }
        }

    private fun reResolve(changed: Set<String>) {
        val next =
            MilanoResolver.refresh(root, dependencies, resolvedRoot, changed, state, context) { kind, node, name ->
                report(kind, node, name = name)
            }
        // Nothing depended on the change: the tree is the same instance, and
        // there is nothing to tell the host.
        if (next === resolvedRoot) return
        resolvedRoot = next
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
