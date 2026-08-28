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
 * Zero-values per declaration, overridden by supplied values: false, 0,
 * 0.0, the empty string; null for optionals; the alphabetically first
 * member for an enum, which is always a valid member; empty arrays;
 * records recursed. Every value satisfies its declaration, so a provider
 * built on this never fails the gate's data check. The quick path uses it;
 * it is public for providers that have nothing better than a zero-value
 * for some keys. The same function on every engine.
 */
fun synthesizedState(
    declarations: Map<String, MilanoType>,
    supplied: Map<String, MilanoValue> = emptyMap(),
): Map<String, MilanoValue> = declarations.mapValues { (key, type) -> supplied[key] ?: zeroValue(type) }

private fun zeroValue(type: MilanoType): MilanoValue {
    if (type.optional) return MilanoValue.Null
    return when (val kind = type.kind) {
        is MilanoType.Kind.Bool -> MilanoValue.BoolValue(false)
        is MilanoType.Kind.Int -> MilanoValue.IntValue(0)
        is MilanoType.Kind.Double -> MilanoValue.DoubleValue(0.0)
        is MilanoType.Kind.Text -> MilanoValue.StringValue("")
        is MilanoType.Kind.Enum -> MilanoValue.StringValue(kind.members.sorted()[0])
        is MilanoType.Kind.Array -> MilanoValue.ArrayValue(emptyList())
        is MilanoType.Kind.Record -> MilanoValue.RecordValue(kind.fields.mapValues { (_, field) -> zeroValue(field) })
    }
}
