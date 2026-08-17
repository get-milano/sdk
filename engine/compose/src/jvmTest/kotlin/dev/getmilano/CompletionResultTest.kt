package dev.getmilano

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The handler-to-document data path: a handler's returned value flows
 * through the async completion funnel, validates against the declared
 * result type, and binds the result root inside onSuccess. The
 * scripted-completion variants of these semantics are covered by the
 * conformance vectors; these tests cover the real async funnel.
 */
class CompletionResultTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private class OccurrenceCollector : MilanoObserver {
        val collected = ArrayList<MilanoOccurrence>()

        override fun occurrence(occurrence: MilanoOccurrence) {
            collected.add(occurrence)
        }
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "completions", "version": "1.0.0",
         "components": {"Button": {"properties": {"label": "string"}, "events": {"tap": null}}},
         "actions": {"fetchCode": {"result": "string"}}}
        """.trimIndent()

    private val document =
        """
        {"version": "1.0.0",
         "state": {"code": "string"},
         "root": {"type": "Button", "id": "b",
                  "properties": {"label": "Go"},
                  "on": {"tap": [{
                      "action": "fetchCode",
                      "onSuccess": [{"action": "${'$'}set", "key": "code",
                                     "value": {"${'$'}expr": "result"}}],
                      "onFailure": [{"action": "${'$'}set", "key": "code",
                                     "value": "failed"}]}]}}}
        """.trimIndent()

    private fun build(
        observer: MilanoObserver? = null,
        handler: MilanoActionHandler,
    ): MilanoView {
        val registry = MilanoRegistry()
        registry.register("Button", StubRenderer)
        val engine = MilanoEngine(vocabulary, registry, observer = observer)
        return runBlocking {
            engine
                .viewBuilder(document)
                .stateDataProvider { mapOf("code" to MilanoValue.StringValue("start")) }
                .actionHandler(handler)
                .dispatcher(InlineDispatcher)
                .build()
        }
    }

    private fun waitUntil(condition: () -> Boolean) {
        runBlocking {
            repeat(500) {
                if (condition()) return@runBlocking
                delay(5)
            }
        }
        assertTrue(condition())
    }

    @Test
    fun handlerReturnedValueBindsResult() {
        val view = build(handler = { MilanoValue.StringValue("OK-42") })
        view.emit("b", "tap")
        waitUntil { view.state["code"] == MilanoValue.StringValue("OK-42") }
    }

    @Test
    fun throwingHandlerRunsOnFailureWithoutResult() {
        val view = build(handler = { throw IllegalStateException("boom") })
        view.emit("b", "tap")
        waitUntil { view.state["code"] == MilanoValue.StringValue("failed") }
    }

    @Test
    fun nullForDeclaredResultIsInvalidCompletion() {
        val collector = OccurrenceCollector()
        val view = build(observer = collector, handler = { null })
        view.emit("b", "tap")
        waitUntil {
            collector.collected.any { it.kind == MilanoOccurrence.Kind.INVALID_COMPLETION }
        }
        // Consumed without running either branch.
        assertEquals(MilanoValue.StringValue("start"), view.state["code"])
    }
}
