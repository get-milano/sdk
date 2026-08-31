package dev.getmilano

/**
 * The quick path's construction: engine, registry, and builder in one
 * call, with declared state synthesized as zero-values so a first
 * integration is a single composable. The full architecture (shared
 * engine, explicit providers) remains the recommended shape for real apps.
 */
internal fun milanoQuickBuilder(
    documentText: String,
    vocabularyJson: String,
    renderers: Map<String, MilanoRenderer>,
    context: Map<String, MilanoValue>,
    state: Map<String, MilanoValue>,
    onAction: (suspend (MilanoAction) -> MilanoValue?)?,
): MilanoViewBuilder {
    val registry = MilanoRegistry()
    for ((type, renderer) in renderers) registry.register(type, renderer)
    val engine = MilanoEngine(vocabularyJson, registry)
    val builder =
        engine
            .viewBuilder(documentText)
            .context(context)
            .stateDataProvider { declarations -> synthesizedState(declarations, state) }
    onAction?.let { handler -> builder.actionHandler { action -> handler(action) } }
    return builder
}

/**
 * Zero-values per declaration, overridden by supplied values. The zero is
 * the contract's own ([zeroValueOf]), so a synthesized value is the same
 * value an invalid function result of that type would produce. Enums are
 * why that matters: this once took the alphabetically first member while
 * the contract takes the first declared, so a preview could differ from
 * the engine over the same declaration. Every value satisfies its
 * declaration, so a provider built on this never fails the gate's data
 * check. The quick path uses it; it is public for providers that have
 * nothing better than a zero-value for some keys. The same function on
 * every engine.
 */
fun synthesizedState(
    declarations: Map<String, MilanoType>,
    supplied: Map<String, MilanoValue> = emptyMap(),
): Map<String, MilanoValue> = declarations.mapValues { (key, type) -> supplied[key] ?: zeroValueOf(type) }
