package dev.getmilano

import kotlin.random.Random

/**
 * The construction gate's public face: a MilanoView is created exclusively
 * through a MilanoViewBuilder, obtained from a MilanoEngine.
 */
class MilanoViewBuilder internal constructor(
    private val engine: MilanoEngine,
    private val documentText: String,
    private val documentByteCount: Int? = null,
) {
    private var contextSource: MilanoContextSource? = null
    private var stateProvider: MilanoStateDataProvider? = null
    private var handler: MilanoActionHandler? = null
    private var dispatcher: MilanoDispatcher = platformDefaultDispatcher()
    private var policyOverride: MilanoUnknownTypePolicy? = null
    private var label: String? = null
    private var allowedActions: List<String>? = null
    private val declaredActions = LinkedHashMap<String, MilanoVocabulary.Action>()
    private val declaredFunctions = LinkedHashMap<String, MilanoVocabulary.Function>()

    /**
     * Grants only the listed custom actions to this surface: a document
     * binding any other custom action fails at the gate with a
     * SchemaViolation (rule "action-capability"). Built-in dollar actions
     * are contract, not capabilities, and are always available.
     */
    fun allowActions(names: List<String>): MilanoViewBuilder =
        apply {
            allowedActions = names
        }

    /**
     * Declares (or overrides) a custom action for this surface: the name,
     * parameter shape, optional success result type, and optional failure
     * payload type join the granted set for this builder only.
     * Declarations type the payload; meaning is assigned by this surface's
     * action handler.
     */
    fun action(
        name: String,
        parameters: Map<String, MilanoType> = emptyMap(),
        result: MilanoType? = null,
        failure: MilanoType? = null,
    ): MilanoViewBuilder =
        apply {
            declaredActions[name] = MilanoVocabulary.Action(parameters, result, failure)
        }

    /**
     * Declares (or overrides) a host function for this surface (contract
     * 2.1): its argument types in order and its return type join the
     * vocabulary's declarations for this builder only. The engine's
     * function handler resolves it by name like any other.
     */
    fun function(
        name: String,
        arguments: List<MilanoType>,
        returns: MilanoType,
    ): MilanoViewBuilder =
        apply {
            declaredFunctions[name] = MilanoVocabulary.Function(arguments.toList(), returns)
        }

    /** Supplies fixed context values for the keys the document declares. */
    fun context(values: Map<String, MilanoValue>): MilanoViewBuilder =
        apply {
            contextSource = StaticContextSource(values)
        }

    /** Supplies an observable context source (see MilanoContextHandle). */
    fun contextSource(source: MilanoContextSource): MilanoViewBuilder =
        apply {
            contextSource = source
        }

    fun stateDataProvider(provider: MilanoStateDataProvider): MilanoViewBuilder =
        apply {
            stateProvider = provider
        }

    /** The view's action handler; required when the document uses custom actions. */
    fun actionHandler(handler: MilanoActionHandler): MilanoViewBuilder =
        apply {
            this.handler = handler
        }

    /** The serialization seam; the platform layer binds it to the main thread. */
    fun dispatcher(dispatcher: MilanoDispatcher): MilanoViewBuilder =
        apply {
            this.dispatcher = dispatcher
        }

    /** Per-view override of the engine's default unknown-type policy. */
    fun unknownTypePolicy(policy: MilanoUnknownTypePolicy): MilanoViewBuilder =
        apply {
            policyOverride = policy
        }

    /** Host-chosen name attached to this view's observability reports. */
    fun label(label: String): MilanoViewBuilder =
        apply {
            this.label = label
        }

    /**
     * The surface's granted action set: vocabulary declarations, overridden
     * by builder declarations, narrowed by the allowlist.
     */
    private fun grantedActions(): Map<String, MilanoVocabulary.Action> {
        val granted: Map<String, MilanoVocabulary.Action> = engine.vocabulary.actions + declaredActions
        val allowed = allowedActions ?: return granted
        return granted.filterKeys { it in allowed }
    }

    /** The surface's declared host functions: the vocabulary's, overridden by the builder's. */
    private fun declaredFunctionSet(): Map<String, MilanoVocabulary.Function> = engine.vocabulary.functions + declaredFunctions

    /**
     * Steps 1 to 5 of the gate for one document under this surface's
     * configuration, plus the two handler checks. Shared by the first
     * build and every replacement.
     */
    private fun prepare(
        text: String,
        byteCount: Int?,
        identity: String,
        policy: MilanoUnknownTypePolicy,
    ): PreparedDocument {
        val pending = ArrayList<MilanoOccurrence>()
        val gate = MilanoGate(engine, policy, identity, grantedActions(), declaredFunctionSet()) { pending.add(it) }

        // Steps 1 to 4, and the lifecycle and watch bindings.
        val validated = gate.validateDocument(text, byteCount)

        // A document using custom actions needs somewhere to send them, and
        // one calling host functions needs something to answer.
        if (gate.usesCustomActions && handler == null) {
            throw MilanoBuildException.SchemaViolation(rule = "action-handler", expected = "action handler")
        }
        if (gate.usedFunctions.isNotEmpty() && engine.functionHandler == null) {
            throw MilanoBuildException.SchemaViolation(rule = "function-handler", expected = "function handler")
        }
        return PreparedDocument(gate, validated.document, validated.root, validated.lifecycle, validated.watch, pending)
    }

    /**
     * A replacement's plan (state and actions spec, Document replacement):
     * the new document through the gate, and the provider's values for the
     * keys that do not carry over from the prior declarations, invoked once
     * with exactly those declarations, or not at all. The view completes
     * the swap on its dispatcher.
     */
    private suspend fun plan(
        text: String,
        byteCount: Int?,
        identity: String,
        policy: MilanoUnknownTypePolicy,
        priorDeclarations: Map<String, MilanoType>,
    ): PreparedDocument {
        val prepared = prepare(text, byteCount, identity, policy)
        val needed = LinkedHashMap<String, MilanoType>()
        for ((key, type) in prepared.document.stateDeclarations) {
            // Optionality is part of the type: only an identical declaration carries over.
            if (priorDeclarations[key] != type) needed[key] = type
        }
        if (needed.isEmpty()) return prepared
        val provider =
            stateProvider
                ?: throw MilanoBuildException.SchemaViolation(rule = "state-declaration", expected = "state data provider")
        // Awaited here; the provider's own errors propagate unchanged.
        return prepared.withProvided(provider.initialState(needed))
    }

    /**
     * Building is asynchronous: the document is parsed and validated in
     * full, then the state data provider is awaited and its values are
     * validated against the document's declarations. Throws typed
     * [MilanoBuildException]s; provider failures propagate unchanged.
     */
    suspend fun build(): MilanoView {
        val identity = label ?: "milano-view-${Random.nextLong().toULong().toString(16)}"
        val policy = policyOverride ?: engine.defaultUnknownTypePolicy

        if (policy == MilanoUnknownTypePolicy.PLACEHOLDER && engine.registry.placeholder == null) {
            throw MilanoEngineException.IncompleteRegistry(listOf("(placeholder renderer)"))
        }

        val prepared = prepare(documentText, documentByteCount, identity, policy)
        val gate = prepared.gate
        val document = prepared.document
        val root = prepared.root
        val pending = prepared.pending

        // Step 5: cross-checks over supplied data.
        val context = gate.validateContext(document, contextSource?.current ?: emptyMap())

        var state: Map<String, MilanoValue> = emptyMap()
        if (document.stateDeclarations.isNotEmpty()) {
            val provider =
                stateProvider
                    ?: throw MilanoBuildException.SchemaViolation(rule = "state-declaration", expected = "state data provider")
            // Awaited here; the provider's own errors propagate unchanged.
            val provided = provider.initialState(document.stateDeclarations)
            state = gate.validateState(document, provided)
        }

        val env = EvalEnvironment(declaredFunctionSet(), engine.functionHandler)

        // Initial resolution: every property expression evaluated, every
        // `$repeat` materialized; a keyed repeat rendering one key twice is
        // a data defect.
        val resolvedRoot =
            try {
                MilanoResolver.resolve(root, state, context, env = env) { kind, node, name, detail ->
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

        // The node count limit is measured on the materialized tree.
        val materialized = MilanoResolver.countNodes(resolvedRoot)
        if (materialized > engine.limits.maxNodeCount) {
            throw MilanoBuildException.LimitExceeded("maxNodeCount", engine.limits.maxNodeCount, materialized)
        }

        // Only a successful build reports its occurrences.
        val observer = engine.observer
        if (observer != null) {
            for (occurrence in pending) observer.occurrence(occurrence)
        }

        // The impression: the analytics stream opens with the built view,
        // carrying the document's metadata for attribution.
        engine.userInteractionObserver?.interaction(
            MilanoUserInteraction(
                MilanoUserInteraction.Kind.VIEW_BUILT,
                identity,
                value = document.metadata,
            ),
        )

        val view =
            MilanoView(
                identity,
                engine,
                document,
                root,
                prepared.lifecycle,
                prepared.watch,
                resolvedRoot,
                context,
                state,
                dispatcher,
                handler,
                pending,
                env,
            ) { text, byteCount, priorDeclarations -> plan(text, byteCount, identity, policy, priorDeclarations) }

        // Context updates flow through the view's dispatcher and are
        // validated atomically there.
        contextSource?.let { source ->
            val viewDispatcher = dispatcher
            view.cancelContextSubscription =
                source.subscribe { values ->
                    viewDispatcher.dispatch { view.applyContextUpdate(values) }
                }
        }
        return view
    }
}

/** Creates a builder for one document given as text. */
fun MilanoEngine.viewBuilder(documentText: String): MilanoViewBuilder = MilanoViewBuilder(this, documentText)

/**
 * Creates a builder for one document given as raw bytes. The document-size
 * limit is checked against these bytes exactly; the text is decoded as
 * UTF-8.
 */
fun MilanoEngine.viewBuilder(document: ByteArray): MilanoViewBuilder =
    MilanoViewBuilder(this, document.decodeToString(), document.size)
