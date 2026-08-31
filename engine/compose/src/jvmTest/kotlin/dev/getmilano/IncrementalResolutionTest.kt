package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Incremental resolution: an update re-evaluates only what reads a key
 * whose value changed, rebuilds only the path to those nodes, and leaves
 * every other subtree as the instance it was. The conformance vector
 * `dispatch-set-independent-expression-not-reevaluated` pins the
 * observable half (no repeated arithmetic report); this pins the rest.
 */
class IncrementalResolutionTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "incremental", "version": "1.0.0",
         "components": {
            "Column": {"children": true},
            "Text": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {}}
        """.trimIndent()

    private val document =
        """
        {"version": "1.0.0",
         "context": {"who": "string"},
         "state": {"divisor": "int", "other": "int"},
         "root": {"type": "Column", "id": "root", "children": [
            {"type": "Text", "id": "ratio", "properties": {"text": {"${'$'}expr": "${'$'}str(100 / state.divisor)"}}},
            {"type": "Text", "id": "greeting", "properties": {"text": {"${'$'}expr": "${'$'}concat('hi ', context.who)"}}},
            {"type": "Column", "id": "static", "children": [
                {"type": "Text", "id": "fixed", "properties": {"text": "fixed"}}]},
            {"type": "Text", "id": "buttons", "properties": {"text": "x"},
             "on": {"tap": [{"action": "${'$'}set", "key": "other", "value": {"${'$'}expr": "state.other + 1"}}]}}]}}
        """.trimIndent()

    private class Built(
        val view: MilanoView,
        val occurrences: List<MilanoOccurrence>,
        val context: MilanoContextHandle,
    )

    private fun build(): Built {
        val registry = MilanoRegistry()
        registry.register("Column", StubRenderer)
        registry.register("Text", StubRenderer)
        val occurrences = ArrayList<MilanoOccurrence>()
        val engine = MilanoEngine(vocabulary, registry, observer = { occurrences.add(it) })
        val context = MilanoContextHandle(mapOf("who" to MilanoValue.StringValue("Ada")))
        val view =
            runBlocking {
                engine
                    .viewBuilder(document)
                    .contextSource(context)
                    .stateDataProvider { mapOf("divisor" to MilanoValue.IntValue(0), "other" to MilanoValue.IntValue(0)) }
                    .dispatcher(InlineDispatcher)
                    .build()
            }
        return Built(view, occurrences, context)
    }

    @Test
    fun dependenciesAreCollectedThroughEveryConstruct() {
        assertEquals(
            setOf("state.flag", "context.a", "state.n", "state.m"),
            ExprParser.parse("${'$'}if(state.flag, context.a ?? 'x', ${'$'}str(state.n + -state.m))").dependencies(),
        )
        assertEquals(setOf("state.person"), ExprParser.parse("state.person.name").dependencies())
        assertTrue(ExprParser.parse("1 + 2").dependencies().isEmpty())
    }

    @Test
    fun anUnrelatedKeyReEvaluatesNothingAndNotifiesNoOne() {
        val built = build()
        assertEquals(1, built.occurrences.count { it.kind == MilanoOccurrence.Kind.DIVISION_BY_ZERO })
        var notified = 0
        built.view.onChange = { notified += 1 }
        val before = built.view.resolvedRoot
        built.view.emit("buttons", "tap")
        assertEquals(MilanoValue.IntValue(1), built.view.state["other"])
        assertEquals(1, built.occurrences.count { it.kind == MilanoOccurrence.Kind.DIVISION_BY_ZERO })
        assertEquals(0, notified)
        assertSame(before, built.view.resolvedRoot)
    }

    @Test
    fun untouchedSubtreesKeepTheirIdentityWhenASiblingChanges() {
        val built = build()
        var notified = 0
        built.view.onChange = { notified += 1 }
        val before = built.view.resolvedRoot
        built.context.update(mapOf("who" to MilanoValue.StringValue("Grace")))
        val after = built.view.resolvedRoot
        assertNotSame(before, after)
        assertEquals(MilanoValue.StringValue("hi Grace"), after.children[1].values["text"])
        assertSame(before.children[0], after.children[0])
        assertSame(before.children[2], after.children[2])
        assertEquals(1, notified)
    }

    @Test
    fun aContextUpdateThatChangesNoValueDoesNothing() {
        val built = build()
        var notified = 0
        built.view.onChange = { notified += 1 }
        val before = built.view.resolvedRoot
        built.context.update(mapOf("who" to MilanoValue.StringValue("Ada")))
        assertSame(before, built.view.resolvedRoot)
        assertEquals(0, notified)
        assertFalse(built.occurrences.any { it.kind == MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE })
    }
}
