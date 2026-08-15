package dev.getmilano

import kotlin.random.Random

/**
 * The construction gate's public face: a MilanoView is created exclusively
 * through a MilanoViewBuilder, obtained from a MilanoEngine.
 */
class MilanoViewBuilder internal constructor(
    private val engine: MilanoEngine,
    private val documentText: String,
) {
    private var contextSource: MilanoContextSource? = null
    private var stateProvider: MilanoStateDataProvider? = null
    private var handler: MilanoActionHandler? = null
    private var dispatcher: MilanoDispatcher = MilanoInlineDispatcher
    private var policyOverride: MilanoUnknownTypePolicy? = null
    private var label: String? = null

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

        val pending = ArrayList<MilanoOccurrence>()
        val gate = MilanoGate(engine, policy, identity) { pending.add(it) }

        // Steps 1 to 4.
        val (document, root) = gate.validateDocument(documentText)

        // A document using custom actions needs somewhere to send them.
        if (gate.usesCustomActions && handler == null) {
            throw MilanoBuildException.SchemaViolation(rule = "action-handler", expected = "action handler")
        }

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

        // Initial resolution: every property expression evaluated.
        val resolvedRoot =
            MilanoResolver.resolve(root, state, context) { kind, node ->
                pending.add(MilanoOccurrence(kind, identity, node))
            }

        // Only a successful build reports its occurrences.
        val observer = engine.observer
        if (observer != null) {
            for (occurrence in pending) observer.occurrence(occurrence)
        }

        val view =
            MilanoView(
                identity,
                engine,
                document,
                root,
                resolvedRoot,
                context,
                state,
                dispatcher,
                handler,
                pending,
            )

        // Context updates flow through the view's dispatcher and are
        // validated atomically there.
        contextSource?.let { source ->
            val viewDispatcher = dispatcher
            source.subscribe { values ->
                viewDispatcher.dispatch { view.applyContextUpdate(values) }
            }
        }
        return view
    }
}

/** Creates a builder for one document given as text. */
fun MilanoEngine.viewBuilder(documentText: String): MilanoViewBuilder = MilanoViewBuilder(this, documentText)
