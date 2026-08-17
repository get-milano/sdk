package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The user-interaction analytics stream: engine-captured records and the
 * renderer-facing widget channel, separate from the observability stream.
 */
class UserInteractionTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private class Collector : MilanoUserInteractionObserver {
        val collected = ArrayList<MilanoUserInteraction>()

        override fun interaction(interaction: MilanoUserInteraction) {
            collected.add(interaction)
        }
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "analytics", "version": "1.0.0",
         "components": {
            "Field": {"properties": {"value": "string"},
                      "events": {"change": "string"}}},
         "actions": {"submit": {"parameters": {"value": "string"}}}}
        """.trimIndent()

    private val document =
        """
        {"version": "1.0.0",
         "metadata": {"experiment": "b"},
         "state": {"value": "string"},
         "root": {"type": "Field", "id": "f",
                  "properties": {"value": {"${'$'}expr": "state.value"}},
                  "on": {"change": [
                      {"action": "${'$'}set", "key": "value", "value": {"${'$'}expr": "event"}},
                      {"action": "submit", "value": {"${'$'}expr": "event"}}]}}}
        """.trimIndent()

    private fun build(collector: Collector?): MilanoView {
        val registry = MilanoRegistry()
        registry.register("Field", StubRenderer)
        val engine =
            MilanoEngine(
                vocabulary,
                registry,
                userInteractionObserver = collector,
            )
        return runBlocking {
            engine
                .viewBuilder(document)
                .stateDataProvider { mapOf("value" to MilanoValue.StringValue("")) }
                .actionHandler { null }
                .dispatcher(InlineDispatcher)
                .build()
        }
    }

    /**
     * The full funnel in order: impression with metadata, the emission
     * with its payload, the dispatch with captured parameters anchored to
     * the source node, and the torn-down bracket, exactly once.
     */
    @Test
    fun runtimeStreamCarriesTheFullFunnel() {
        val collector = Collector()
        val view = build(collector)
        view.emit("f", "change", MilanoValue.StringValue("hi"))
        view.teardown()
        view.teardown() // once: the second is inert

        assertEquals(
            listOf(
                MilanoUserInteraction.Kind.VIEW_BUILT,
                MilanoUserInteraction.Kind.EVENT,
                MilanoUserInteraction.Kind.ACTION_DISPATCHED,
                MilanoUserInteraction.Kind.VIEW_TORN_DOWN,
            ),
            collector.collected.map { it.kind },
        )
        assertEquals(
            MilanoValue.RecordValue(mapOf("experiment" to MilanoValue.StringValue("b"))),
            collector.collected[0].value,
        )
        assertEquals("f", collector.collected[1].node)
        assertEquals("change", collector.collected[1].name)
        assertEquals(MilanoValue.StringValue("hi"), collector.collected[1].value)
        assertEquals("f", collector.collected[2].node)
        assertEquals("submit", collector.collected[2].name)
        assertEquals(
            MilanoValue.RecordValue(mapOf("value" to MilanoValue.StringValue("hi"))),
            collector.collected[2].value,
        )
    }

    /**
     * The renderer-facing channel: a widget report reaches the stream
     * anchored to the node, with its value, without touching dispatch.
     */
    @Test
    fun widgetReportsFlowStraightToTheStream() {
        val collector = Collector()
        val view = build(collector)
        val node = MilanoNode(view, view.resolvedRoot)

        node.userInteraction(MilanoUserInteraction.Kind.FOCUS_GAINED)
        node.userInteraction(
            MilanoUserInteraction.Kind.SELECTION_CHANGED,
            MilanoValue.StringValue("second"),
        )

        val widget = collector.collected.filter { it.kind != MilanoUserInteraction.Kind.VIEW_BUILT }
        assertEquals(
            listOf(
                MilanoUserInteraction.Kind.FOCUS_GAINED,
                MilanoUserInteraction.Kind.SELECTION_CHANGED,
            ),
            widget.map { it.kind },
        )
        assertEquals("f", widget[0].node)
        assertEquals(MilanoValue.StringValue("second"), widget[1].value)
        // Analytics never touches dispatch: nothing was dispatched.
        assertTrue(view.dispatched.isEmpty())
    }

    /** Without an observer, capture costs nothing and changes nothing. */
    @Test
    fun absentObserverIsInert() {
        val view = build(null)
        view.emit("f", "change", MilanoValue.StringValue("hi"))
        MilanoNode(view, view.resolvedRoot).userInteraction(MilanoUserInteraction.Kind.TAP)
        assertEquals(MilanoValue.StringValue("hi"), view.state["value"])
    }
}
