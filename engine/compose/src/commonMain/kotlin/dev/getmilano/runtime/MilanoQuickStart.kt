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
 * 0.0, empty string; null for optionals; empty arrays; records recursed.
 */
internal fun synthesizedState(
    declarations: Map<String, MilanoType>,
    supplied: Map<String, MilanoValue>,
): Map<String, MilanoValue> = declarations.mapValues { (key, type) -> supplied[key] ?: zeroValue(type) }

private fun zeroValue(type: MilanoType): MilanoValue =
    when {
        type.optional -> {
            MilanoValue.Null
        }

        type.kind is MilanoType.Kind.Bool -> {
            MilanoValue.BoolValue(false)
        }

        type.kind is MilanoType.Kind.Int -> {
            MilanoValue.IntValue(0)
        }

        type.kind is MilanoType.Kind.Double -> {
            MilanoValue.DoubleValue(0.0)
        }

        type.kind is MilanoType.Kind.Text -> {
            MilanoValue.StringValue("")
        }

        type.kind is MilanoType.Kind.Array -> {
            MilanoValue.ArrayValue(emptyList())
        }

        else -> {
            val fields = (type.kind as MilanoType.Kind.Record).fields
            MilanoValue.RecordValue(fields.mapValues { (_, field) -> zeroValue(field) })
        }
    }
