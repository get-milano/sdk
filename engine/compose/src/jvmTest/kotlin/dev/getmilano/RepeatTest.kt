package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertSame

/**
 * The `$repeat` construct beyond what the vectors pin: the shape of the
 * resolved tree a binding sees, identity under incremental resolution
 * (kept when nothing an instance reads changed, re-materialized whole
 * otherwise), and instance emissions carrying their element.
 */
class RepeatTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private val vocabulary =
        """
        {"milano": "2.0.0", "name": "repeat", "version": "1.0.0",
         "components": {"Column": {"children": true},
                        "Text": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {}}
        """.trimIndent()

    private val rows =
        MilanoValue.ArrayValue(
            listOf(
                MilanoValue.RecordValue(mapOf("name" to MilanoValue.StringValue("Alpha"))),
                MilanoValue.RecordValue(mapOf("name" to MilanoValue.StringValue("Beta"))),
            ),
        )

    private val document =
        """
        {"version": "2.0.0",
         "state": {"rows": {"array": {"record": {"name": "string"}}}, "prefix": "string", "other": "int"},
         "root": {"type": "Column", "id": "list", "children": [
           {"type": "Text", "id": "head", "properties": {"text": "head"}},
           {"type": "${'$'}repeat", "id": "each", "items": {"${'$'}expr": "state.rows"}, "as": "row", "children": [
             {"type": "Text", "id": "name", "properties": {"text": {"${'$'}expr": "${'$'}concat(state.prefix, row.name)"}},
              "on": {"tap": [{"action": "${'$'}set", "key": "prefix",
                              "value": {"${'$'}expr": "${'$'}concat(row.name, ${'$'}str(row_index))"}}]}}]},
           {"type": "Text", "id": "control", "properties": {"text": "x"},
            "on": {"tap": [{"action": "${'$'}set", "key": "other", "value": {"${'$'}expr": "state.other + 1"}}]}},
           {"type": "Text", "id": "prefixer", "properties": {"text": "x"},
            "on": {"tap": [{"action": "${'$'}set", "key": "prefix", "value": "> "}]}}]}}
        """.trimIndent()

    private class Built(
        val view: MilanoView,
        val occurrences: List<MilanoOccurrence>,
    )

    private fun build(): Built {
        val registry = MilanoRegistry()
        registry.register("Column", StubRenderer)
        registry.register("Text", StubRenderer)
        val occurrences = ArrayList<MilanoOccurrence>()
        val engine = MilanoEngine(vocabulary, registry, observer = { occurrences.add(it) })
        val view =
            runBlocking {
                engine
                    .viewBuilder(document)
                    .stateDataProvider {
                        mapOf("rows" to rows, "prefix" to MilanoValue.StringValue(""), "other" to MilanoValue.IntValue(0))
                    }.dispatcher(InlineDispatcher)
                    .build()
            }
        return Built(view, occurrences)
    }

    private fun text(node: ResolvedNode): MilanoValue? = node.values["text"]

    @Test
    fun instancesTakeTheConstructsPlaceWithTheParentsSpans() {
        val root = build().view.resolvedRoot
        assertEquals(listOf("head", "name[0]", "name[1]", "control", "prefixer"), root.children.map { it.reference })
        assertEquals(listOf(1, 2, 1, 1), root.spans)
        assertEquals(MilanoValue.StringValue("Alpha"), text(root.children[1]))
    }

    @Test
    fun instanceIdentityIsKeptWhenNothingTheyReadChanged() {
        val view = build().view
        val before = view.resolvedRoot
        view.emit("control", "tap")
        assertEquals(MilanoValue.IntValue(1), view.state["other"])
        // Nothing reads `other`: the tree is the same instance.
        assertSame(before, view.resolvedRoot)
    }

    @Test
    fun everyInstanceReMaterializesWhenSomethingTheyReadChanged() {
        val view = build().view
        val before = view.resolvedRoot
        view.emit("prefixer", "tap")
        val after = view.resolvedRoot
        assertNotSame(before, after)
        assertEquals(MilanoValue.StringValue("> Alpha"), text(after.children[1]))
        assertEquals(MilanoValue.StringValue("> Beta"), text(after.children[2]))
        // Siblings outside the repeat kept their identity.
        assertSame(before.children[0], after.children[0])
        assertSame(before.children[3], after.children[3])
    }

    @Test
    fun anInstanceEmissionDispatchesWithItsElementBound() {
        val built = build()
        built.view.emit("name[1]", "tap")
        assertEquals(MilanoValue.StringValue("Beta1"), built.view.state["prefix"])
        built.view.emit("name[7]", "tap")
        assertEquals(
            listOf(listOf("INVALID_EMISSION", "name[7]", "repeat element", "index 7")),
            built.occurrences.map { listOf(it.kind.name, it.node, it.expected, it.found) },
        )
    }
}
