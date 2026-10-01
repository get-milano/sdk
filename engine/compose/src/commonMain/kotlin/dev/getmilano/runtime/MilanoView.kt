package dev.getmilano

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * What the gate produced for one document under a surface's configuration,
 * before the data checks: the builder's outcome at the first build, and a
 * replacement's plan (state and actions spec, Document replacement), where
 * [provided] carries the provider's values for the keys that do not carry
 * over, or null when every key carries over and the provider was not
 * consulted.
 */
internal class PreparedDocument(
    val gate: MilanoGate,
    val document: ParsedDocument,
    val root: BuiltNode,
    val lifecycle: Map<String, List<ActionSpec>>,
    val watch: Map<String, List<ActionSpec>>,
    /** Occurrences the gate detected, reported only when the build or the swap succeeds. */
    val pending: MutableList<MilanoOccurrence>,
    val provided: Map<String, MilanoValue>? = null,
) {
    fun withProvided(values: Map<String, MilanoValue>): PreparedDocument =
        PreparedDocument(gate, document, root, lifecycle, watch, pending, values)
}

/**
 * The built, guaranteed-renderable view: bound to one document at a time.
 * Runtime semantics per the state and actions spec; everything mutable
 * runs through the view's serial dispatcher.
 */
class MilanoView internal constructor(
    val identity: String,
    internal val engine: MilanoEngine,
    document: ParsedDocument,
    root: BuiltNode,
    lifecycle: Map<String, List<ActionSpec>>,
    watch: Map<String, List<ActionSpec>>,
    resolvedRoot: ResolvedNode,
    context: Map<String, MilanoValue>,
    state: Map<String, MilanoValue>,
    internal val dispatcher: MilanoDispatcher,
    internal val handler: MilanoActionHandler?,
    internal val occurrencesAtBuild: List<MilanoOccurrence>,
    /** The host functions the surface declares and the engine's handler. */
    private val env: EvalEnvironment = EvalEnvironment.NONE,
    /**
     * Prepares a replacement under the builder's configuration: the new
     * document's text and byte count in, with the current state
     * declarations, the gate's outcome and the provider's values out.
     */
    private val replacer: suspend (String, Int?, Map<String, MilanoType>) -> PreparedDocument,
) {
    /** The parsed document the view is currently bound to. */
    internal var document: ParsedDocument = document
        private set
    internal var root: BuiltNode = root
        private set

    /** The document's lifecycle bindings, validated by the gate. */
    internal var lifecycle: Map<String, List<ActionSpec>> = lifecycle
        private set

    /** The document's watch bindings, validated by the gate. */
    internal var watch: Map<String, List<ActionSpec>> = watch
        private set

    internal var resolvedRoot: ResolvedNode = resolvedRoot
        private set

    /** What every expression reads, indexed once per document: the update path's map. */
    private var dependencies = MilanoResolver.index(root)
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

    /**
     * The view's Compose content: bound to this document for its lifetime.
     * Entering composition delivers the appear signal and leaving it the
     * disappear signal, from Compose's own account of presentation (runtime
     * API spec, MilanoHost).
     */
    @androidx.compose.runtime.Composable
    fun Content() {
        @Suppress("UNUSED_EXPRESSION")
        invalidations.value
        androidx.compose.runtime.DisposableEffect(this) {
            appear()
            onDispose { disappear() }
        }
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
        val failureType: MilanoType?,
        val sourceNode: String?,
        /**
         * Dispatched from a watch list: its follow-ups run with watches
         * suppressed too, since a watch never triggers a watch.
         */
        val fromWatch: Boolean = false,
    )

    /** An occurrence held back until the update that raised it is accepted. */
    private class HeldReport(
        val kind: MilanoOccurrence.Kind,
        val node: String,
        val name: String,
        val detail: ReportDetail?,
    )

    /**
     * A tree an update would produce, with the reports it raised held back
     * until the update is accepted; or the key a keyed repeat would render
     * twice, which refuses the update.
     */
    private sealed class Materialized {
        class Tree(
            val tree: ResolvedNode,
            val count: Int,
            val reports: List<HeldReport>,
        ) : Materialized()

        class Conflict(
            val key: String,
        ) : Materialized()
    }

    /** An instance in the current tree: its template and enclosing identities. */
    private class InstanceLocation(
        val base: String,
        val identities: List<String>,
    )

    private val nodeEvents = HashMap<String, NodeEvents>()

    /**
     * Instance reference to its template and identities, for the current
     * tree; built on the first emission after a commit, since references
     * are compared, never parsed.
     */
    private var instanceIndex: Map<String, InstanceLocation>? = null

    /**
     * One serialized work queue: action lists and context updates both run
     * through it, so an update can never land mid-action-list even when a
     * re-entrant post arrives on the dispatcher thread.
     */
    private val queue = ArrayDeque<QueuedWork>()
    private var processing = false
    private var tornDown = false

    /** The lifecycle state: appear is accepted only while false, disappear only while true. */
    private var appeared = false

    /**
     * Above zero while a watch list, or a follow-up of a dispatch made
     * from one, is executing: mutations then trigger no watch (state and
     * actions spec, Watch bindings).
     */
    private var watchDepth = 0

    /**
     * Dispatches below this index belong to a document since replaced:
     * their completions are dropped and reported.
     */
    private var replacedBefore = 0

    /** Cancels the context source subscription; invoked at teardown. */
    internal var cancelContextSubscription: (() -> Unit)? = null
    internal val dispatched = ArrayList<DispatchRecord>()
    private val handlerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /**
     * Unique per view instance in the process, whatever the builder's
     * label; dispatch ids are minted from it.
     */
    private val instanceToken: String = mintInstanceToken()

    private companion object {
        /**
         * 128 random bits: a collision between two views of one process is
         * astronomically unlikely, and common code has no atomic counter to
         * make it impossible without a dependency.
         */
        fun mintInstanceToken(): String =
            "${Random.nextLong().toULong().toString(36)}-${Random.nextLong().toULong().toString(36)}"
    }

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
        // A construct's branches hold ordinary nodes that are simply not
        // reached through `children`. Missing them here leaves their
        // emissions with no binding to find, reported as invalidEmission.
        val branches = node.branchNodes()
        if (branches != null) {
            for (child in branches) indexNodes(child, repeats)
            return
        }
        if (!node.isPlaceholder) {
            engine.vocabulary.components[node.type]?.let { component ->
                nodeEvents[node.reference] = NodeEvents(component.events, node.events, repeats)
            }
        }
        for (child in node.children) indexNodes(child, repeats)
    }

    /** Where every instance of the current tree comes from, built on demand. */
    private fun locate(reference: String): InstanceLocation? {
        val index =
            instanceIndex ?: HashMap<String, InstanceLocation>().also { built ->
                fun walk(node: ResolvedNode) {
                    if (node.identities.isNotEmpty()) built[node.reference] = InstanceLocation(node.base, node.identities)
                    for (child in node.children) walk(child)
                }
                walk(resolvedRoot)
                instanceIndex = built
            }
        return index[reference]
    }

    /**
     * The `$repeat` bindings an instance's emission dispatches with: the
     * element each identity names, evaluated now, outermost repeat first.
     * The failure names what is missing when an identity no longer names
     * an element.
     */
    private fun bindingsFor(
        info: NodeEvents,
        identities: List<String>,
    ): Result<Map<String, MilanoValue>> {
        var bindings: Map<String, MilanoValue> = emptyMap()
        val enclosing = ArrayList<String>()
        for ((level, repeatNode) in info.repeats.withIndex()) {
            val identity = identities[level]
            val reference = repeatNode.reference + MilanoResolver.suffixOf(enclosing)
            val elements =
                MilanoResolver.repeatElements(repeatNode, reference, state, context, { _, _, _, _ -> }, bindings, env)
            val spec = repeatNode.repeatSpec ?: return Result.failure(MissingInstance("index $identity"))
            val index =
                if (spec.key != null) {
                    // The identities of the current elements are their keys,
                    // distinct by the invariant every accepted update keeps.
                    val current =
                        runCatching {
                            MilanoResolver.instanceIdentities(
                                repeatNode,
                                reference,
                                elements,
                                state,
                                context,
                                { _, _, _, _ -> },
                                bindings,
                                env,
                            )
                        }.getOrDefault(emptyList())
                    val found = current.indexOf(identity)
                    if (found < 0) return Result.failure(MissingInstance("key $identity"))
                    found
                } else {
                    val parsed = identity.toIntOrNull()
                    if (parsed == null || parsed < 0 || parsed >= elements.size) {
                        return Result.failure(MissingInstance("index $identity"))
                    }
                    parsed
                }
            bindings = MilanoResolver.elementBindings(spec.alias, elements[index], index, bindings)
            enclosing.add(identity)
        }
        return Result.success(bindings)
    }

    private class MissingInstance(
        val detail: String,
    ) : Exception(detail)

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
     * The host's signal that the view has come on screen: accepted while
     * not appeared, ignored otherwise and after teardown; an accepted
     * signal runs the document's `appear` bindings. [Content] delivers it
     * itself when composed; hosts driving the view without composing it
     * (tests, tooling) call it directly.
     */
    fun appear() {
        dispatcher.dispatch { processLifecycle(appear = true) }
    }

    /** The mirror of [appear]: the view has left the screen. */
    fun disappear() {
        dispatcher.dispatch { processLifecycle(appear = false) }
    }

    /**
     * The document's `metadata` section, verbatim and untyped: producer
     * annotations reach host code without a side channel.
     */
    val metadata: MilanoValue? get() = document.metadata

    /**
     * Replaces the document the view is bound to (state and actions spec,
     * Document replacement): the new document passes the gate under the
     * surface's configuration, state whose declaration is unchanged
     * (optionality included) carries over, the state data provider
     * supplies the rest, and the swap lands on the dispatcher, serialized
     * with dispatch. Throws what [MilanoViewBuilder.build] throws (the
     * gate's typed errors, or the provider's own error, unchanged); on a
     * throw the view is exactly as it was. Ignored silently after teardown.
     */
    suspend fun replace(document: String) {
        replaceDocument(document, null)
    }

    /** As [replace] with text, from raw UTF-8 bytes: the document-size limit is checked against them exactly. */
    suspend fun replace(document: ByteArray) {
        replaceDocument(document.decodeToString(), document.size)
    }

    private suspend fun replaceDocument(
        text: String,
        byteCount: Int?,
    ) {
        if (tornDown) return
        // The gate and the provider run before anything touches the view;
        // the swap itself is one queued unit, so it never lands
        // mid-action-list.
        val plan = replacer(text, byteCount, document.stateDeclarations)
        val settled = CompletableDeferred<Unit>()
        dispatcher.dispatch {
            // A throw that clears the queue ahead of the swap leaves the
            // view as it was; the caller hears that instead of waiting.
            enqueue(drop = { error -> settled.completeExceptionally(error) }) {
                try {
                    swap(plan)
                    settled.complete(Unit)
                } catch (error: Exception) {
                    settled.completeExceptionally(error)
                }
            }
        }
        settled.await()
    }

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

    private fun processLifecycle(appear: Boolean) {
        if (tornDown) return
        // A redundant signal carries no work: ignored silently.
        if (appeared == appear) return
        appeared = appear
        record(
            if (appear) MilanoUserInteraction.Kind.VIEW_APPEARED else MilanoUserInteraction.Kind.VIEW_DISAPPEARED,
            null,
            null,
            null,
        )
        val actions = lifecycle[if (appear) "appear" else "disappear"]
        if (actions.isNullOrEmpty()) return
        enqueue { execute(actions, null, null, sourceNode = null) }
    }

    private fun processEmission(
        node: String,
        event: String,
        payload: MilanoValue?,
    ) {
        if (tornDown) return
        // A plain reference, or an instance reference: located in the
        // current tree, never parsed, so a key may contain any character.
        var info = nodeEvents[node]
        var identities: List<String> = emptyList()
        if (info == null || info.repeats.isNotEmpty()) {
            val located = locate(node)
            if (located != null) {
                val candidate = nodeEvents[located.base]
                info =
                    if (candidate != null && candidate.repeats.size == located.identities.size) {
                        identities = located.identities
                        candidate
                    } else {
                        null
                    }
            } else {
                // Not in the current tree: an instance that has vanished,
                // which the report names, or a node that never existed.
                val vanished = vanishedInstance(node)
                if (vanished != null) {
                    report(
                        MilanoOccurrence.Kind.INVALID_EMISSION,
                        node,
                        name = event,
                        expected = "repeat element",
                        found = vanished,
                    )
                    return
                }
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
        val bindings =
            bindingsFor(info, identities).getOrElse { missing ->
                report(
                    MilanoOccurrence.Kind.INVALID_EMISSION,
                    node,
                    name = event,
                    expected = "repeat element",
                    found = missing.message ?: "null",
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

    /**
     * An emission naming an instance the current tree no longer has: the
     * reference ends in bracketed identities whose template is a repeated
     * node. The detail names the last identity, as an index or a key by
     * the innermost repeat's shape.
     */
    private fun vanishedInstance(reference: String): String? {
        var base = reference
        val parts = ArrayList<String>()
        while (base.endsWith("]")) {
            val open = base.lastIndexOf('[')
            if (open < 0) break
            val inner = base.substring(open + 1, base.length - 1)
            if ('[' in inner) break
            parts.add(0, inner)
            base = base.substring(0, open)
        }
        if (parts.isEmpty()) return null
        val info = nodeEvents[base] ?: return null
        if (info.repeats.size != parts.size) return null
        val innermost = info.repeats.last()
        val last = parts.last()
        return if (innermost.repeatSpec?.key != null) "key $last" else "index $last"
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
        // limit, or a keyed repeat rendering one key twice, rejects the
        // update whole.
        if (changed.isEmpty()) {
            context = canonical
            return
        }
        when (val materialized = materialize(changed, state, canonical)) {
            is Materialized.Conflict -> {
                report(
                    MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE,
                    null,
                    name = lastKey,
                    expected = "distinct key",
                    found = materialized.key,
                )
            }

            is Materialized.Tree -> {
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
        }
    }

    /**
     * The swap of a replacement (state and actions spec, Document
     * replacement), one queued unit: the held context against the new
     * declarations, state carried where the declaration is unchanged and
     * taken from the provider otherwise, the tree resolved whole; any
     * failure throws before anything changes. Then the view adopts the
     * new document, keeps its identity, numbering, and appeared state, and
     * reports what the gate held back.
     */
    private fun swap(plan: PreparedDocument) {
        if (tornDown) return
        val gate = plan.gate
        val next = plan.document
        val nextContext = gate.validateContext(next, context)

        val merged = LinkedHashMap<String, MilanoValue>()
        for ((key, type) in next.stateDeclarations) {
            val previous = document.stateDeclarations[key]
            val current = state[key]
            if (previous != null && current != null && previous == type) {
                merged[key] = current
            } else {
                plan.provided?.get(key)?.let { merged[key] = it }
            }
        }
        val nextState = if (next.stateDeclarations.isNotEmpty()) gate.validateState(next, merged) else emptyMap()

        val pending = ArrayList(plan.pending)
        val tree =
            try {
                MilanoResolver.resolve(plan.root, nextState, nextContext, env = env) { kind, node, name, detail ->
                    pending.add(MilanoOccurrence(kind, identity, node, name, detail?.expected, detail?.found))
                }
            } catch (conflict: RepeatKeyConflict) {
                throw MilanoBuildException.SchemaViolation(
                    rule = "repeat",
                    node = conflict.reference,
                    expected = "distinct key",
                    found = conflict.key,
                )
            }
        val count = MilanoResolver.countNodes(tree)
        if (count > engine.limits.maxNodeCount) {
            throw MilanoBuildException.LimitExceeded("maxNodeCount", engine.limits.maxNodeCount, count)
        }

        // Nothing above changed the view; from here everything does, at once.
        document = next
        root = plan.root
        lifecycle = plan.lifecycle
        watch = plan.watch
        dependencies = MilanoResolver.index(plan.root)
        nodeEvents.clear()
        indexNodes(plan.root)
        context = nextContext
        state = nextState
        resolvedRoot = tree
        instanceIndex = null
        replacedBefore = dispatched.size
        engine.observer?.let { observer -> for (occurrence in pending) observer.occurrence(occurrence) }
        record(MilanoUserInteraction.Kind.VIEW_REPLACED, null, null, next.metadata)
        invalidations.value += 1
        onChange?.invoke()
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
        // A dispatch of a document since replaced: its follow-ups belong to
        // a document that no longer exists. It still counts as completed.
        if (dispatchIndex < replacedBefore) {
            report(MilanoOccurrence.Kind.COMPLETION_AFTER_REPLACE, null, name = action)
            return
        }

        // The completion's value against the declared type for its outcome:
        // a missing value counts as null, a value for an outcome declaring
        // no type never validates. An invalid completion is consumed
        // without running either branch (state and actions spec).
        val declared = if (success) record.resultType else record.failureType
        var value: MilanoValue? = null
        if (declared != null) {
            value = declared.validated(payload ?: MilanoValue.Null)
            if (value == null) {
                report(
                    MilanoOccurrence.Kind.INVALID_COMPLETION,
                    null,
                    name = action,
                    expected = MilanoGate.name(declared),
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
            value,
            record.action.dispatch,
        )

        val followUps = if (success) record.onSuccess else record.onFailure
        if (followUps.isNotEmpty()) {
            val captured = record.capturedEvent
            val bindings = record.capturedBindings
            val source = record.sourceNode
            val result = if (success) value else null
            val failure = if (success) null else value
            enqueue {
                // Follow-ups of a dispatch made from a watch list run with
                // watches suppressed, like the list itself.
                if (record.fromWatch) watchDepth += 1
                try {
                    execute(followUps, captured, result, sourceNode = source, bindings = bindings, failure = failure)
                } finally {
                    if (record.fromWatch) watchDepth -= 1
                }
            }
        }
    }

    /** A unit of queued work; `drop` hears of it being discarded unrun. */
    private class QueuedWork(
        val run: () -> Unit,
        val drop: ((Throwable) -> Unit)?,
    )

    private fun enqueue(
        drop: ((Throwable) -> Unit)? = null,
        work: () -> Unit,
    ) {
        queue.addLast(QueuedWork(work, drop))
        if (processing) return
        processing = true
        try {
            while (queue.isNotEmpty()) {
                queue.removeFirst().run()
            }
        } finally {
            // A host listener or renderer that throws unwinds through here.
            // The queue is cleared and the flag released: the throw still
            // reaches the caller, and the view stays usable instead of
            // silently dying with work stuck behind a flag never reset.
            // Whoever awaits a discarded unit is told, so none waits forever.
            val dropped = queue.toList()
            queue.clear()
            processing = false
            for (unit in dropped) {
                unit.drop?.invoke(IllegalStateException("the view's work queue was cleared before this update ran"))
            }
        }
    }

    /**
     * Runs an action list. Returns false when the list ended early: a
     * mutation past a limit, producing a repeated key, or addressing an
     * index outside the array assigns nothing, is reported, and stops the
     * remaining actions of the dispatch; what the list already applied
     * stays.
     */
    private fun execute(
        actions: List<ActionSpec>,
        event: MilanoValue?,
        result: MilanoValue?,
        sourceNode: String?,
        bindings: Map<String, MilanoValue> = emptyMap(),
        failure: MilanoValue? = null,
    ): Boolean {
        for (action in actions) {
            when (action) {
                is StateMutation -> {
                    if (!mutate(action, event, result, sourceNode, bindings, failure)) return false
                }

                is ActionSpec.ArrayAction -> {
                    // Unreachable: the gate replaces every parsed array action.
                    error("unvalidated ${action.name}")
                }

                is ActionSpec.Sequence -> {
                    if (!execute(action.actions, event, result, sourceNode, bindings, failure)) return false
                }

                is ActionSpec.When -> {
                    val takeThen = evaluate(action.condition, event, result, bindings, failure).boolOrNull == true
                    val branch = if (takeThen) action.then else action.otherwise
                    if (!execute(branch, event, result, sourceNode, bindings, failure)) return false
                }

                is ActionSpec.Custom -> {
                    val captured = LinkedHashMap<String, MilanoValue>()
                    for ((parameter, value) in action.parameters) {
                        captured[parameter] = evaluate(value, event, result, bindings, failure)
                    }
                    // The dispatch identity: the position among this view's
                    // dispatches, and a process-unique id minted from the
                    // view instance's token.
                    val index = dispatched.size
                    val milanoAction = MilanoAction(action.name, captured, identity, index, "$instanceToken#$index")
                    record(
                        MilanoUserInteraction.Kind.ACTION_DISPATCHED,
                        sourceNode,
                        action.name,
                        MilanoValue.RecordValue(captured),
                        index,
                    )
                    dispatched.add(
                        DispatchRecord(
                            milanoAction,
                            false,
                            action.onSuccess,
                            action.onFailure,
                            event,
                            bindings,
                            action.result,
                            action.failure,
                            sourceNode,
                            fromWatch = watchDepth > 0,
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
                                } catch (failed: MilanoActionFailure) {
                                    // The failure payload; any other exception
                                    // is a failure with none.
                                    payload = failed.value
                                    false
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

    /**
     * A state mutation (state and actions spec, Action execution): the
     * value `$set` assigns, or the array an array action produces, then
     * the one assignment path. Returns false when the mutation was
     * rejected and the list must end.
     */
    private fun mutate(
        action: StateMutation,
        event: MilanoValue?,
        result: MilanoValue?,
        sourceNode: String?,
        bindings: Map<String, MilanoValue>,
        failure: MilanoValue?,
    ): Boolean {
        val key = action.key
        val declared = document.stateDeclarations[key]
        val elementType = (declared?.kind as? MilanoType.Kind.Array)?.element
        val items = state[key]?.arrayOrNull ?: emptyList()

        fun outOfRange(at: Long): Boolean {
            if (at >= 0 && at < items.size) return false
            report(
                MilanoOccurrence.Kind.REJECTED_MUTATION,
                sourceNode,
                name = key,
                expected = "index in range",
                found = at.toString(),
            )
            return true
        }
        val next: MilanoValue =
            when (action) {
                is ActionSpec.Set -> {
                    val evaluated = evaluate(action.value, event, result, bindings, failure)
                    declared?.validated(evaluated) ?: evaluated
                }

                is ActionSpec.Append -> {
                    val evaluated = evaluate(action.value, event, result, bindings, failure)
                    MilanoValue.ArrayValue(items + (elementType?.validated(evaluated) ?: evaluated))
                }

                is ActionSpec.Remove -> {
                    val at = evaluate(action.at, event, result, bindings, failure).intOrNull ?: 0L
                    if (outOfRange(at)) return false
                    MilanoValue.ArrayValue(items.filterIndexed { index, _ -> index.toLong() != at })
                }

                is ActionSpec.Update -> {
                    val at = evaluate(action.at, event, result, bindings, failure).intOrNull ?: 0L
                    val evaluated = evaluate(action.value, event, result, bindings, failure)
                    if (outOfRange(at)) return false
                    val fieldType = (elementType?.kind as? MilanoType.Kind.Record)?.fields?.get(action.field)
                    val fieldValue = fieldType?.validated(evaluated) ?: evaluated
                    val position = at.toInt()
                    val element = items[position].recordOrNull ?: emptyMap()
                    val updated = MilanoValue.RecordValue(element + (action.field to fieldValue))
                    MilanoValue.ArrayValue(items.mapIndexed { index, item -> if (index == position) updated else item })
                }
            }
        return assign(key, next, sourceNode)
    }

    /**
     * The one assignment path: the value against the value size limit, the
     * no-change rule, the re-materialized tree against the node count
     * limit and the distinct-key invariant, then commit, then the key's
     * watch.
     */
    private fun assign(
        key: String,
        next: MilanoValue,
        sourceNode: String?,
    ): Boolean {
        val size = next.size
        if (size > engine.limits.maxValueSize) {
            report(
                MilanoOccurrence.Kind.REJECTED_MUTATION,
                sourceNode,
                name = key,
                expected = "maxValueSize",
                found = size.toString(),
            )
            return false
        }
        // A value that did not change re-resolves nothing and triggers no watch.
        if (state[key] == next) return true
        val nextState = state + (key to next)
        // Visible immediately: the properties that read this key re-resolve
        // before the next action. A tree materialized past the node count
        // limit, or a keyed repeat rendering one key twice, rejects the
        // mutation instead.
        when (val materialized = materialize(setOf("state.$key"), nextState, context)) {
            is Materialized.Conflict -> {
                report(
                    MilanoOccurrence.Kind.REJECTED_MUTATION,
                    sourceNode,
                    name = key,
                    expected = "distinct key",
                    found = materialized.key,
                )
                return false
            }

            is Materialized.Tree -> {
                if (materialized.count > engine.limits.maxNodeCount) {
                    report(
                        MilanoOccurrence.Kind.REJECTED_MUTATION,
                        sourceNode,
                        name = key,
                        expected = "maxNodeCount",
                        found = materialized.count.toString(),
                    )
                    return false
                }
                state = nextState
                commit(materialized)
            }
        }
        runWatch(key)
        return true
    }

    /**
     * The key's watch list, as part of the mutation that changed it (state
     * and actions spec, Watch bindings): before the next action of the
     * list that applied it, with no event root and no repeat binding,
     * anchored to no node. Never from inside a watch: a watch never
     * triggers a watch. A rejection inside ends the watch list only.
     */
    private fun runWatch(key: String) {
        if (watchDepth > 0) return
        val actions = watch[key]
        if (actions.isNullOrEmpty()) return
        watchDepth += 1
        try {
            execute(actions, null, null, sourceNode = null)
        } finally {
            watchDepth -= 1
        }
    }

    private fun evaluate(
        value: DocValue,
        event: MilanoValue?,
        result: MilanoValue?,
        bindings: Map<String, MilanoValue> = emptyMap(),
        failure: MilanoValue? = null,
    ): MilanoValue =
        when (value) {
            is DocValue.Literal -> {
                value.value
            }

            is DocValue.TypedExpression -> {
                val evaluator =
                    ExprEvaluator(state, context, event, result, bindings, failure, env) { kind, detail ->
                        report(kind, null, name = detail?.name, expected = detail?.expected, found = detail?.found)
                    }
                val evaluated = evaluator.evaluate(value.expr)
                value.expected.validated(evaluated) ?: evaluated
            }

            is DocValue.Expression -> {
                MilanoValue.Null
            }
        }

    /**
     * The tree an update would produce, with the reports it raised held
     * back: nothing reaches the observer until the update is accepted, and
     * a rejected one leaves no trace. A keyed repeat that would render one
     * key twice is a conflict, not a tree.
     */
    private fun materialize(
        changed: Set<String>,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
    ): Materialized {
        val reports = ArrayList<HeldReport>()
        val tree =
            try {
                MilanoResolver.refresh(
                    root,
                    dependencies,
                    resolvedRoot,
                    changed,
                    state,
                    context,
                    env,
                ) { kind, node, name, detail ->
                    reports.add(HeldReport(kind, node, name, detail))
                }
            } catch (conflict: RepeatKeyConflict) {
                return Materialized.Conflict(conflict.key)
            }
        val count = if (tree === resolvedRoot) 0 else MilanoResolver.countNodes(tree)
        return Materialized.Tree(tree, count, reports)
    }

    /** Adopts a materialized tree, flushes its reports, notifies the host. */
    private fun commit(materialized: Materialized.Tree) {
        for (held in materialized.reports) {
            report(held.kind, held.node, name = held.name, expected = held.detail?.expected, found = held.detail?.found)
        }
        // Nothing depended on the change: the tree is the same instance, and
        // there is nothing to tell the host.
        if (materialized.tree === resolvedRoot) return
        resolvedRoot = materialized.tree
        instanceIndex = null
        invalidations.value += 1
        onChange?.invoke()
    }

    /** The product-analytics seam: a no-op without an observer. */
    internal fun record(
        kind: MilanoUserInteraction.Kind,
        node: String?,
        name: String?,
        value: MilanoValue?,
        dispatch: Int? = null,
    ) {
        engine.userInteractionObserver?.interaction(
            MilanoUserInteraction(kind, identity, node, name, value, dispatch),
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
