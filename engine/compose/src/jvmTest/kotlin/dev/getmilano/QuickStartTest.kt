package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * The quick path: one call builds engine, registry, and builder, with
 * declared state synthesized as zero-values.
 */
class QuickStartTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "quick", "version": "1.0.0",
         "components": {"Greeting": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {"celebrate": {}}}
        """.trimIndent()

    private fun document(expression: String): String =
        """
        {"version": "1.0.0",
         "context": {"userName": "string"},
         "state": {"taps": "int", "note": "string?"},
         "root": {"type": "Greeting", "id": "hello",
                  "properties": {"text": {"${'$'}expr": "$expression"}},
                  "on": {"tap": [{"action": "celebrate"}]}}}
        """.trimIndent()

    @Test
    fun buildsWithSynthesizedStateAndContext() {
        val builder =
            milanoQuickBuilder(
                documentText = document("concat(context.userName, ':', str(state.taps), ':', state.note ?? '-')"),
                vocabularyJson = vocabulary,
                renderers = mapOf("Greeting" to StubRenderer),
                context = mapOf("userName" to MilanoValue.StringValue("Ada")),
                state = emptyMap(),
                onAction = { null },
            )
        val view = runBlocking { builder.build() }
        assertEquals(MilanoValue.StringValue("Ada:0:-"), view.resolvedRoot.values["text"])
    }

    @Test
    fun suppliedStateOverridesSynthesis() {
        val builder =
            milanoQuickBuilder(
                documentText = document("str(state.taps)"),
                vocabularyJson = vocabulary,
                renderers = mapOf("Greeting" to StubRenderer),
                context = mapOf("userName" to MilanoValue.StringValue("Ada")),
                state = mapOf("taps" to MilanoValue.IntValue(7)),
                onAction = { null },
            )
        val view = runBlocking { builder.build() }
        assertEquals(MilanoValue.StringValue("7"), view.resolvedRoot.values["text"])
    }

    @Test
    fun customActionsRequireTheClosure() {
        val builder =
            milanoQuickBuilder(
                documentText = document("context.userName"),
                vocabularyJson = vocabulary,
                renderers = mapOf("Greeting" to StubRenderer),
                context = mapOf("userName" to MilanoValue.StringValue("Ada")),
                state = emptyMap(),
                onAction = null,
            )
        assertFailsWith<MilanoBuildException.SchemaViolation> {
            runBlocking { builder.build() }
        }
    }

    @Test
    fun invalidVocabularySurfacesAtConstruction() {
        assertFailsWith<MilanoEngineException.InvalidVocabulary> {
            milanoQuickBuilder(
                documentText = document("'x'"),
                vocabularyJson = "{ nope",
                renderers = emptyMap(),
                context = emptyMap(),
                state = emptyMap(),
                onAction = null,
            )
        }
    }

    @Test
    fun zeroValuesCoverEveryKind() {
        val declarations =
            mapOf(
                "flag" to MilanoType(MilanoType.Kind.Bool),
                "count" to MilanoType(MilanoType.Kind.Int),
                "ratio" to MilanoType(MilanoType.Kind.Double),
                "label" to MilanoType(MilanoType.Kind.Text),
                "items" to MilanoType(MilanoType.Kind.Array(MilanoType(MilanoType.Kind.Int))),
                "pair" to MilanoType(MilanoType.Kind.Record(mapOf("a" to MilanoType(MilanoType.Kind.Bool)))),
                "maybe" to MilanoType(MilanoType.Kind.Text, optional = true),
            )
        val values = synthesizedState(declarations, emptyMap())
        assertEquals(MilanoValue.BoolValue(false), values["flag"])
        assertEquals(MilanoValue.IntValue(0), values["count"])
        assertEquals(MilanoValue.DoubleValue(0.0), values["ratio"])
        assertEquals(MilanoValue.StringValue(""), values["label"])
        assertEquals(MilanoValue.ArrayValue(emptyList()), values["items"])
        assertEquals(MilanoValue.RecordValue(mapOf("a" to MilanoValue.BoolValue(false))), values["pair"])
        assertEquals(MilanoValue.Null, values["maybe"])
    }
}
