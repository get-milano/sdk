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
}
