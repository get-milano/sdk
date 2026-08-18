package dev.getmilano

import kotlinx.coroutines.runBlocking
import java.util.concurrent.CountDownLatch
import javax.swing.SwingUtilities
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Regression pins for the spec-alignment audit: each test failed against
 * the pre-audit engine and passes against the aligned one.
 */
class SpecAlignmentTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "align", "version": "1.0.0",
         "components": {
            "Text": {"properties": {"text": "string"},
                     "events": {"tap": null}}},
         "actions": {"work": {}}}
        """.trimIndent()

    private fun engine(limits: MilanoLimits = MilanoLimits()): MilanoEngine {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        return MilanoEngine(vocabulary, registry, limits = limits)
    }

    /**
     * The desktop JVM's platform-default dispatcher serializes on the AWT
     * event dispatch thread, the spec's main thread for Compose Desktop.
     * Pre-fix the default was inline: work ran on the calling thread.
     */
    @Test
    fun jvmDefaultDispatcherRunsOnTheEventDispatchThread() {
        val dispatcher = platformDefaultDispatcher()
        val latch = CountDownLatch(1)
        var onEdt = false
        dispatcher.dispatch {
            onEdt = SwingUtilities.isEventDispatchThread()
            latch.countDown()
        }
        latch.await()
        assertTrue(onEdt, "work posted off the EDT must land on the EDT")

        // Already on the EDT, work executes inline, mirroring Android.
        var inline = false
        SwingUtilities.invokeAndWait {
            dispatcher.dispatch { inline = true }
        }
        assertTrue(inline)
    }

    /**
     * A context update posted re-entrantly (from the re-resolution hook,
     * mid-action-list) never lands between two actions of the same list.
     * Pre-fix it applied immediately and the second action saw it.
     */
    @Test
    fun contextUpdateNeverLandsMidActionList() {
        val document =
            """{"version": "1.0.0",
                "context": {"c": "string"},
                "state": {"a": "int", "b": "string"},
                "root": {"type": "Text", "id": "t",
                         "properties": {"text": {"${'$'}expr": "state.b"}},
                         "on": {"tap": [
                             {"action": "${'$'}set", "key": "a", "value": 1},
                             {"action": "${'$'}set", "key": "b",
                              "value": {"${'$'}expr": "context.c"}}]}}}"""
        val view =
            runBlocking {
                engine()
                    .viewBuilder(document)
                    .context(mapOf("c" to MilanoValue.StringValue("old")))
                    .stateDataProvider {
                        mapOf("a" to MilanoValue.IntValue(0), "b" to MilanoValue.StringValue(""))
                    }.dispatcher(InlineDispatcher)
                    .build()
            }

        var posted = false
        view.onChange = {
            if (!posted) {
                posted = true
                view.applyContextUpdate(mapOf("c" to MilanoValue.StringValue("new")))
            }
        }
        view.emit("t", "tap")

        assertEquals(MilanoValue.StringValue("old"), view.state["b"])
        assertEquals(MilanoValue.StringValue("new"), view.context["c"])
    }

    /**
     * Teardown cancels the context subscription, so a source never retains
     * callbacks for views that are gone. Pre-fix subscribe returned
     * nothing and the source accumulated subscribers forever.
     */
    @Test
    fun teardownCancelsTheContextSubscription() {
        class RecordingSource : MilanoContextSource {
            override val current = mapOf("c" to MilanoValue.StringValue("v"))
            var cancelled = false

            override fun subscribe(onUpdate: (Map<String, MilanoValue>) -> Unit): () -> Unit = { cancelled = true }
        }

        val source = RecordingSource()
        val view =
            runBlocking {
                engine()
                    .viewBuilder(
                        """{"version": "1.0.0", "context": {"c": "string"},
                            "root": {"type": "Text",
                                     "properties": {"text": {"${'$'}expr": "context.c"}}}}""",
                    ).contextSource(source)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
        assertFalse(source.cancelled)
        view.teardown()
        assertTrue(source.cancelled)
    }

    /** A cancelled MilanoContextHandle subscription receives no further updates. */
    @Test
    fun handleCancellationStopsUpdates() {
        val handle = MilanoContextHandle(mapOf("c" to MilanoValue.StringValue("v")))
        var received = 0
        val cancel = handle.subscribe { received += 1 }
        handle.update(mapOf("c" to MilanoValue.StringValue("1")))
        assertEquals(1, received)
        cancel()
        handle.update(mapOf("c" to MilanoValue.StringValue("2")))
        assertEquals(1, received)
    }

    /** The document's metadata section reaches the host verbatim. */
    @Test
    fun metadataReachesTheHost() {
        val view =
            runBlocking {
                engine()
                    .viewBuilder(
                        """{"version": "1.0.0",
                            "metadata": {"campaign": "summer-2026"},
                            "root": {"type": "Text", "properties": {"text": "x"}}}""",
                    ).dispatcher(InlineDispatcher)
                    .build()
            }
        assertEquals(
            MilanoValue.RecordValue(mapOf("campaign" to MilanoValue.StringValue("summer-2026"))),
            view.metadata,
        )

        val bare =
            runBlocking {
                engine()
                    .viewBuilder("""{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}""")
                    .dispatcher(InlineDispatcher)
                    .build()
            }
        assertNull(bare.metadata)
    }

    /**
     * The expression-length limit is counted in Unicode scalars, never
     * UTF-16 units. Pre-fix Kotlin counted UTF-16 units and rejected
     * non-BMP text at half the declared budget.
     */
    @Test
    fun expressionLimitCountsUnicodeScalars() {
        // 30 emoji: 30 scalars, 60 UTF-16 units, in an expression of 45
        // scalars against a limit of 45: at the boundary, accepted.
        val padding = "😀".repeat(30)
        val expr = "concat('$padding', 'y')"
        assertEquals(45, expr.unicodeScalarCount())
        val document =
            """{"version": "1.0.0",
                "root": {"type": "Text", "id": "t",
                         "properties": {"text": {"${'$'}expr": "$expr"}}}}"""
        val view =
            runBlocking {
                engine(MilanoLimits(maxExpressionLength = 45))
                    .viewBuilder(document)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
        assertEquals(MilanoValue.StringValue(padding + "y"), view.resolvedRoot.values["text"])

        // One scalar over the boundary is a typed gate error.
        try {
            runBlocking {
                engine(MilanoLimits(maxExpressionLength = 44))
                    .viewBuilder(document)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
            fail("expected LimitExceeded")
        } catch (expected: MilanoBuildException.LimitExceeded) {
            assertEquals("maxExpressionLength", expected.limit)
            assertEquals(45, expected.actual)
        }
    }

    /**
     * The raw-bytes entry point checks the document-size limit against the
     * received bytes exactly. Pre-fix no bytes entry point existed.
     */
    @Test
    fun byteArrayEntryPointChecksRawBytes() {
        val document = """{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}"""
        val bytes = document.encodeToByteArray()

        val view =
            runBlocking {
                engine()
                    .viewBuilder(bytes)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
        assertEquals(MilanoValue.StringValue("x"), view.resolvedRoot.values["text"])

        try {
            runBlocking {
                engine(MilanoLimits(maxDocumentBytes = bytes.size - 1))
                    .viewBuilder(bytes)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
            fail("expected LimitExceeded")
        } catch (expected: MilanoBuildException.LimitExceeded) {
            assertEquals("maxDocumentBytes", expected.limit)
            assertEquals(bytes.size, expected.actual)
        }
    }

    /**
     * A host listener that throws must not take the view with it. Pre-fix
     * the work-queue drain left `processing` true forever, so every later
     * emission queued work that never ran: the view went silently dead and
     * each dropped closure leaked its captured payload.
     */
    @Test
    fun aThrowingListenerDoesNotWedgeTheView() {
        val document =
            """{"version": "1.0.0",
                "state": {"a": "int"},
                "root": {"type": "Text", "id": "t",
                         "properties": {"text": {"${'$'}expr": "str(state.a)"}},
                         "on": {"tap": [{"action": "${'$'}set", "key": "a",
                                         "value": {"${'$'}expr": "state.a + 1"}}]}}}"""
        val view =
            runBlocking {
                engine()
                    .viewBuilder(document)
                    .stateDataProvider { mapOf("a" to MilanoValue.IntValue(0)) }
                    .dispatcher(InlineDispatcher)
                    .build()
            }

        var failing = true
        view.onChange = {
            if (failing) throw IllegalStateException("host bug")
        }

        try {
            view.emit("t", "tap")
            fail("the listener's exception must reach the caller")
        } catch (expected: IllegalStateException) {
            assertEquals("host bug", expected.message)
        }
        assertEquals(MilanoValue.IntValue(1), view.state["a"])

        // Still alive: the queue was not left wedged behind a flag the
        // throw skipped past.
        failing = false
        val seen = ArrayList<MilanoValue>()
        view.onChange = {
            view.state["a"]?.let { value -> seen.add(value) }
        }
        view.emit("t", "tap")
        view.emit("t", "tap")
        assertEquals(
            listOf<MilanoValue>(MilanoValue.IntValue(2), MilanoValue.IntValue(3)),
            seen,
        )
    }

    /**
     * Teardown observed mid-list does not interrupt the list: state and
     * actions spec, Completion. Pinned here because a conformance vector
     * cannot express it (steps run between events, never inside one).
     */
    @Test
    fun teardownDuringAnActionListDoesNotInterruptIt() {
        class Analytics : MilanoUserInteractionObserver {
            val records = ArrayList<Pair<MilanoUserInteraction.Kind, String?>>()

            override fun interaction(interaction: MilanoUserInteraction) {
                records.add(interaction.kind to interaction.name)
            }
        }

        val document =
            """{"version": "1.0.0",
                "state": {"a": "int"},
                "root": {"type": "Text", "id": "t",
                         "properties": {"text": {"${'$'}expr": "str(state.a)"}},
                         "on": {"tap": [
                             {"action": "${'$'}set", "key": "a", "value": 1},
                             {"action": "work"},
                             {"action": "${'$'}set", "key": "a", "value": 42}]}}}"""
        val analytics = Analytics()
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val engine = MilanoEngine(vocabulary, registry, userInteractionObserver = analytics)
        val view =
            runBlocking {
                engine
                    .viewBuilder(document)
                    .stateDataProvider { mapOf("a" to MilanoValue.IntValue(0)) }
                    .actionHandler { null }
                    .dispatcher(InlineDispatcher)
                    .build()
            }

        // The first $set re-resolves and fires the hook, which tears the
        // view down. The rest of the list still runs: the custom action is
        // dispatched (the handler's own invocation is asynchronous, so the
        // synchronous evidence is the analytics record) and the trailing
        // $set applies.
        view.onChange = { view.teardown() }
        view.emit("t", "tap")

        assertTrue(
            analytics.records.any {
                it.first == MilanoUserInteraction.Kind.ACTION_DISPATCHED && it.second == "work"
            },
        )
        assertEquals(MilanoValue.IntValue(42), view.state["a"])

        // Torn down all the same: nothing after the list is accepted.
        view.emit("t", "tap")
        assertEquals(MilanoValue.IntValue(42), view.state["a"])
    }
}
