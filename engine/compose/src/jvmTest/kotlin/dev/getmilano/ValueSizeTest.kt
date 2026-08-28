package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * The value size limit: the document model's one runtime bound, applied
 * wherever a value enters state or context. The conformance suite pins
 * the observable behavior at a configured limit; this pins the metric on
 * every value shape, the default, and the shape of the list stop through
 * nested action constructs.
 */
class ValueSizeTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "limits", "version": "1.0.0",
         "components": {"Text": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {}}
        """.trimIndent()

    @Test
    fun theSizeMetric() {
        assertEquals(1, MilanoValue.Null.size)
        assertEquals(1, MilanoValue.BoolValue(true).size)
        assertEquals(1, MilanoValue.IntValue(Long.MAX_VALUE).size)
        assertEquals(1, MilanoValue.DoubleValue(2.5).size)
        assertEquals(0, MilanoValue.StringValue("").size)
        assertEquals(8, MilanoValue.StringValue("abcdefg\uD83D\uDE00").size)
        assertEquals(1, MilanoValue.ArrayValue(emptyList()).size)
        assertEquals(5, MilanoValue.ArrayValue(listOf(MilanoValue.StringValue("ab"), MilanoValue.StringValue("cd"))).size)
        val record =
            MilanoValue.RecordValue(
                mapOf(
                    "a" to MilanoValue.ArrayValue(listOf(MilanoValue.IntValue(1), MilanoValue.IntValue(2))),
                    "b" to MilanoValue.StringValue("xyz"),
                ),
            )
        assertEquals(7, record.size)
        assertEquals(65_536, MilanoLimits().maxValueSize)
    }

    private class Built(
        val view: MilanoView,
        val occurrences: List<MilanoOccurrence>,
    )

    private fun build(
        document: String,
        state: Map<String, MilanoValue>,
        context: MilanoContextHandle? = null,
    ): Built {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val occurrences = ArrayList<MilanoOccurrence>()
        val engine =
            MilanoEngine(vocabulary, registry, limits = MilanoLimits(maxValueSize = 8), observer = { occurrences.add(it) })
        val builder =
            engine
                .viewBuilder(document)
                .stateDataProvider { state }
                .dispatcher(InlineDispatcher)
        if (context != null) builder.contextSource(context)
        return Built(runBlocking { builder.build() }, occurrences)
    }

    private fun detail(occurrence: MilanoOccurrence): List<String?> =
        listOf(occurrence.kind.name, occurrence.node, occurrence.name, occurrence.expected, occurrence.found)

    @Test
    fun aRejectedSetStopsTheListThroughSequenceAndWhen() {
        val built =
            build(
                """
                {"version": "1.0.0", "state": {"s": "string", "n": "int"},
                 "root": {"type": "Text", "id": "t", "properties": {"text": {"${'$'}expr": "state.s"}},
                  "on": {"tap": [
                    {"action": "${'$'}set", "key": "n", "value": {"${'$'}expr": "state.n + 1"}},
                    {"action": "${'$'}when", "condition": true, "then": [
                      {"action": "${'$'}sequence", "actions": [
                        {"action": "${'$'}set", "key": "s", "value": {"${'$'}expr": "concat(state.s, state.s)"}}]},
                      {"action": "${'$'}set", "key": "n", "value": {"${'$'}expr": "state.n + 10"}}]},
                    {"action": "${'$'}set", "key": "n", "value": {"${'$'}expr": "state.n + 100"}}]}}}
                """.trimIndent(),
                mapOf("s" to MilanoValue.StringValue("abcde"), "n" to MilanoValue.IntValue(0)),
            )
        built.view.emit("t", "tap")
        assertEquals(MilanoValue.StringValue("abcde"), built.view.state["s"])
        assertEquals(MilanoValue.IntValue(1), built.view.state["n"])
        assertEquals(listOf(listOf("REJECTED_MUTATION", "t", "s", "maxValueSize", "10")), built.occurrences.map(::detail))
    }

    @Test
    fun aSetExactlyAtTheLimitIsAcceptedAndOnePastItIsNot() {
        val built =
            build(
                """
                {"version": "1.0.0", "state": {"s": "string"},
                 "root": {"type": "Text", "id": "t", "properties": {"text": {"${'$'}expr": "state.s"}},
                  "on": {"tap": [{"action": "${'$'}set", "key": "s", "value": {"${'$'}expr": "concat(state.s, 'x')"}}]}}}
                """.trimIndent(),
                mapOf("s" to MilanoValue.StringValue("abcdefg")),
            )
        built.view.emit("t", "tap")
        assertEquals(MilanoValue.StringValue("abcdefgx"), built.view.state["s"])
        built.view.emit("t", "tap")
        assertEquals(MilanoValue.StringValue("abcdefgx"), built.view.state["s"])
        assertEquals(1, built.occurrences.count { it.kind == MilanoOccurrence.Kind.REJECTED_MUTATION })
    }

    @Test
    fun aContextUpdatePastTheLimitIsRejectedWhole() {
        val handle = MilanoContextHandle(mapOf("who" to MilanoValue.StringValue("Ada"), "n" to MilanoValue.IntValue(1)))
        val built =
            build(
                """
                {"version": "1.0.0", "context": {"who": "string", "n": "int"},
                 "root": {"type": "Text", "id": "t",
                  "properties": {"text": {"${'$'}expr": "concat(context.who, str(context.n))"}}}}
                """.trimIndent(),
                emptyMap(),
                handle,
            )
        handle.update(mapOf("who" to MilanoValue.StringValue("a very long name"), "n" to MilanoValue.IntValue(2)))
        assertEquals(MilanoValue.StringValue("Ada1"), built.view.resolvedRoot.values["text"])
        assertEquals(
            listOf(listOf("REJECTED_CONTEXT_UPDATE", null, "who", "maxValueSize", "16")),
            built.occurrences.map(::detail),
        )
    }

    @Test
    fun initialValuesPastTheLimitAreRefusedAtTheGate() {
        val error =
            assertFailsWith<MilanoBuildException.LimitExceeded> {
                build(
                    """
                    {"version": "1.0.0", "state": {"s": "string"},
                     "root": {"type": "Text", "id": "t", "properties": {"text": {"${'$'}expr": "state.s"}}}}
                    """.trimIndent(),
                    mapOf("s" to MilanoValue.StringValue("nine char")),
                )
            }
        assertEquals("maxValueSize", error.limit)
        assertEquals(8, error.value)
        assertEquals(9, error.actual)
    }
}
