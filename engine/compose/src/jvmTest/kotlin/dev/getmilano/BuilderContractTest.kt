package dev.getmilano

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The builder's contract obligations that conformance vectors cannot
 * express: handler and context requirements, capability narrowing through
 * the public API, provider error propagation, per-view policy overrides,
 * labels on observability, and emission edge behavior.
 */
class BuilderContractTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private class Collector : MilanoObserver {
        val collected = ArrayList<MilanoOccurrence>()

        override fun occurrence(occurrence: MilanoOccurrence) {
            collected.add(occurrence)
        }
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "contract", "version": "1.0.0",
         "components": {
            "Button": {"properties": {"label": "string"}, "events": {"tap": null}},
            "Text": {"properties": {"text": "string"}}},
         "actions": {"ping": {}, "pong": {}}}
        """.trimIndent()

    private fun engine(observer: MilanoObserver? = null): MilanoEngine {
        val registry = MilanoRegistry()
        registry.register("Button", StubRenderer)
        registry.register("Text", StubRenderer)
        return MilanoEngine(vocabulary, registry, observer = observer)
    }

    private fun document(action: String = "ping"): String =
        """
        {"version": "1.0.0",
         "root": {"type": "Button", "id": "b",
                  "properties": {"label": "Go"},
                  "on": {"tap": [{"action": "$action"}]}}}
        """.trimIndent()

    private fun buildError(builder: MilanoViewBuilder): MilanoBuildException? =
        try {
            runBlocking { builder.build() }
            null
        } catch (exception: MilanoBuildException) {
            exception
        }

    private fun assertViolation(
        exception: MilanoBuildException?,
        rule: String,
    ): MilanoBuildException.SchemaViolation {
        val violation =
            exception as? MilanoBuildException.SchemaViolation
                ?: fail("expected SchemaViolation, got $exception")
        assertEquals(rule, violation.rule)
        return violation
    }

    @Test
    fun customActionsRequireAHandler() {
        val builder = engine().viewBuilder(document()).dispatcher(InlineDispatcher)
        assertViolation(buildError(builder), "action-handler")
    }

    @Test
    fun builtInsNeedNoHandler() {
        val noActions =
            """{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}"""
        assertNull(buildError(engine().viewBuilder(noActions).dispatcher(InlineDispatcher)))
    }

    @Test
    fun allowlistNarrowsTheGrantedSet() {
        // pong is vocabulary-declared but not allowed on this surface.
        val builder =
            engine()
                .viewBuilder(document(action = "pong"))
                .allowActions(listOf("ping"))
                .actionHandler { null }
                .dispatcher(InlineDispatcher)
        val violation = assertViolation(buildError(builder), "action-capability")
        assertEquals("pong", violation.found)
    }

    @Test
    fun builderDeclarationJoinsTheGrantedSet() {
        val builder =
            engine()
                .viewBuilder(document(action = "local"))
                .action("local")
                .actionHandler { null }
                .dispatcher(InlineDispatcher)
        assertNull(buildError(builder))
    }

    @Test
    fun missingContextValueFailsTheBuild() {
        val withContext =
            """{"version": "1.0.0",
                "context": {"userName": "string"},
                "root": {"type": "Text",
                         "properties": {"text": {"${'$'}expr": "context.userName"}}}}"""
        val builder =
            engine()
                .viewBuilder(withContext)
                .context(emptyMap())
                .dispatcher(InlineDispatcher)
        assertViolation(buildError(builder), "context-declaration")
    }

    @Test
    fun providerErrorsPropagateUnchanged() {
        class ProviderFailure : Exception("provider failure")

        val withState =
            """{"version": "1.0.0",
                "state": {"count": "int"},
                "root": {"type": "Text",
                         "properties": {"text": {"${'$'}expr": "str(state.count)"}}}}"""
        val builder =
            engine()
                .viewBuilder(withState)
                .stateDataProvider { throw ProviderFailure() }
                .dispatcher(InlineDispatcher)
        try {
            runBlocking { builder.build() }
            fail("expected the provider failure to propagate")
        } catch (expected: ProviderFailure) {
            assertEquals("provider failure", expected.message)
        }
    }

    @Test
    fun placeholderOverrideWithoutRendererFailsAtBuild() {
        val unknown = """{"version": "1.0.0", "root": {"type": "Mystery"}}"""
        val builder =
            engine()
                .viewBuilder(unknown)
                .unknownTypePolicy(MilanoUnknownTypePolicy.PLACEHOLDER)
                .dispatcher(InlineDispatcher)
        try {
            runBlocking { builder.build() }
            fail("expected IncompleteRegistry")
        } catch (expected: MilanoEngineException.IncompleteRegistry) {
            assertTrue("placeholder" in expected.message.orEmpty())
        }
    }

    @Test
    fun labelReachesOccurrenceIdentity() {
        val collector = Collector()
        val unknown = """{"version": "1.0.0", "root": {"type": "Mystery"}}"""
        runBlocking {
            engine(observer = collector)
                .viewBuilder(unknown)
                .unknownTypePolicy(MilanoUnknownTypePolicy.SKIP)
                .label("promo-slot")
                .dispatcher(InlineDispatcher)
                .build()
        }
        val skip = collector.collected.first { it.kind == MilanoOccurrence.Kind.UNKNOWN_TYPE_SKIPPED }
        assertTrue("promo-slot" in skip.viewIdentity)
    }

    @Test
    fun emissionEdgesReportOrStaySilent() {
        val collector = Collector()
        val view =
            runBlocking {
                engine(observer = collector)
                    .viewBuilder(document())
                    .actionHandler { null }
                    .dispatcher(InlineDispatcher)
                    .build()
            }

        // Unknown node and undeclared event are invalid emissions.
        view.emit("nope", "tap")
        view.emit("b", "swipe")
        // A payload on a payload-less event is invalid too.
        view.emit("b", "tap", MilanoValue.StringValue("x"))
        assertEquals(
            3,
            collector.collected.count { it.kind == MilanoOccurrence.Kind.INVALID_EMISSION },
        )

        // After teardown, emissions are silently ignored: no pending work.
        val before = collector.collected.size
        view.teardown()
        view.emit("b", "tap")
        assertEquals(before, collector.collected.size)
    }

    @Test
    fun contextHandleUpdatesFromABackgroundThread() {
        val withContext =
            """{"version": "1.0.0",
                "context": {"label": "string"},
                "root": {"type": "Text", "id": "t",
                         "properties": {"text": {"${'$'}expr": "context.label"}}}}"""
        val handle = MilanoContextHandle(mapOf("label" to MilanoValue.StringValue("first")))
        val view =
            runBlocking {
                engine()
                    .viewBuilder(withContext)
                    .contextSource(handle)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
        assertEquals(MilanoValue.StringValue("first"), view.resolvedRoot.values["text"])

        // Posted off the calling thread; applied through the dispatcher.
        runBlocking {
            withContext(Dispatchers.IO) {
                handle.update(mapOf("label" to MilanoValue.StringValue("second")))
            }
        }
        assertEquals(MilanoValue.StringValue("second"), view.resolvedRoot.values["text"])
    }
}
