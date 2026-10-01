package dev.getmilano

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Contract 2.1 at the host boundary: what the conformance vectors cannot
 * reach because it lives in the engine's API rather than in documents.
 * Failure payloads travel through the real async funnel as a thrown
 * [MilanoActionFailure]; lifecycle signals arrive through the view's own
 * methods; every dispatch carries an identity the host can key on; host
 * functions are answered by the engine's handler; a replacement's
 * provider failure reaches the caller unchanged.
 */
class Contract21Test {
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

    private class InteractionCollector : MilanoUserInteractionObserver {
        val collected = ArrayList<MilanoUserInteraction>()

        override fun interaction(interaction: MilanoUserInteraction) {
            collected.add(interaction)
        }
    }

    private val vocabulary =
        """
        {"milano": "2.1.0", "name": "contract21", "version": "1.0.0",
         "components": {"Button": {"properties": {"label": "string"}, "events": {"tap": null}}},
         "actions": {
            "submit": {"failure": {"enum": ["limit", "offline"]}},
            "lenient": {"failure": "string?"},
            "plain": {}}}
        """.trimIndent()

    private fun document(action: String): String {
        val failureValue =
            when (action) {
                "plain" -> "\"failed\""
                "lenient" -> "{\"${'$'}expr\": \"${'$'}concat('failed: ', failure ?? 'unknown')\"}"
                else -> "{\"${'$'}expr\": \"${'$'}concat('failed: ', failure)\"}"
            }
        return """
            {"version": "2.1.0",
             "state": {"outcome": "string"},
             "root": {"type": "Button", "id": "b",
                      "properties": {"label": {"${'$'}expr": "state.outcome"}},
                      "on": {"tap": [{
                          "action": "$action",
                          "onSuccess": [{"action": "${'$'}set", "key": "outcome", "value": "ok"}],
                          "onFailure": [{"action": "${'$'}set", "key": "outcome", "value": $failureValue}]}]}},
             "on": {"appear": [{"action": "${'$'}set", "key": "outcome", "value": "appeared"}]}}
            """.trimIndent()
    }

    private fun build(
        action: String,
        label: String? = null,
        occurrences: OccurrenceCollector? = null,
        interactions: InteractionCollector? = null,
        handler: MilanoActionHandler,
    ): MilanoView {
        val registry = MilanoRegistry()
        registry.register("Button", StubRenderer)
        val engine = MilanoEngine(vocabulary, registry, observer = occurrences, userInteractionObserver = interactions)
        return runBlocking {
            val builder =
                engine
                    .viewBuilder(document(action))
                    .stateDataProvider { mapOf("outcome" to MilanoValue.StringValue("start")) }
                    .actionHandler(handler)
                    .dispatcher(InlineDispatcher)
            label?.let { builder.label(it) }
            builder.build()
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

    // Failure payloads

    @Test
    fun aThrownMilanoActionFailureBindsTheFailureRoot() {
        val interactions = InteractionCollector()
        val view = build("submit", interactions = interactions) { throw MilanoActionFailure(MilanoValue.StringValue("limit")) }
        view.emit("b", "tap")
        waitUntil { view.state["outcome"] == MilanoValue.StringValue("failed: limit") }
        val completion = interactions.collected.first { it.kind == MilanoUserInteraction.Kind.COMPLETION_FAILED }
        assertEquals(MilanoValue.StringValue("limit"), completion.value)
        assertEquals(0, completion.dispatch)
    }

    @Test
    fun aPlainExceptionIsAFailureWithNoPayload() {
        // Against a non-optional declaration: an invalid completion, neither
        // branch runs (state and actions spec, Completion).
        val collector = OccurrenceCollector()
        val strict = build("submit", occurrences = collector) { throw IllegalStateException("network") }
        strict.emit("b", "tap")
        waitUntil { collector.collected.any { it.kind == MilanoOccurrence.Kind.INVALID_COMPLETION } }
        assertEquals(MilanoValue.StringValue("start"), strict.state["outcome"])
        assertEquals("enum", collector.collected.first().expected)
        assertEquals("null", collector.collected.first().found)

        // Against an optional declaration: failure is null and onFailure runs.
        val lenient = build("lenient") { throw IllegalStateException("network") }
        lenient.emit("b", "tap")
        waitUntil { lenient.state["outcome"] == MilanoValue.StringValue("failed: unknown") }
    }

    @Test
    fun aPayloadOutsideTheDeclaredEnumIsInvalid() {
        val collector = OccurrenceCollector()
        val view = build("submit", occurrences = collector) { throw MilanoActionFailure(MilanoValue.StringValue("teapot")) }
        view.emit("b", "tap")
        waitUntil { collector.collected.any { it.kind == MilanoOccurrence.Kind.INVALID_COMPLETION } }
        assertEquals(MilanoValue.StringValue("start"), view.state["outcome"])
    }

    @Test
    fun anActionDeclaringNoFailureKeepsTheOldRule() {
        val collector = OccurrenceCollector()
        val view = build("plain", occurrences = collector) { throw MilanoActionFailure(MilanoValue.StringValue("x")) }
        view.emit("b", "tap")
        waitUntil { collector.collected.any { it.kind == MilanoOccurrence.Kind.INVALID_COMPLETION } }
        assertEquals("no payload", collector.collected.first().expected)
        assertEquals(MilanoValue.StringValue("start"), view.state["outcome"])
    }

    // Lifecycle

    @Test
    fun lifecycleSignalsRunBindingsOncePerAcceptance() {
        val interactions = InteractionCollector()
        val view = build("plain", interactions = interactions) { null }
        view.appear()
        view.appear()
        assertEquals(MilanoValue.StringValue("appeared"), view.state["outcome"])
        view.disappear()
        view.disappear()
        view.appear()
        assertEquals(
            listOf(
                MilanoUserInteraction.Kind.VIEW_BUILT,
                MilanoUserInteraction.Kind.VIEW_APPEARED,
                MilanoUserInteraction.Kind.VIEW_DISAPPEARED,
                MilanoUserInteraction.Kind.VIEW_APPEARED,
            ),
            interactions.collected.map { it.kind },
        )
        view.teardown()
        view.appear()
        assertEquals(MilanoUserInteraction.Kind.VIEW_TORN_DOWN, interactions.collected.last().kind)
    }

    // Dispatch identity

    // engine-pinned: dispatch-id-unique-across-views
    @Test
    fun dispatchIdsAreUniqueAcrossViewsSharingALabel() {
        val seen =
            java.util.concurrent.ConcurrentHashMap
                .newKeySet<String>()
        val deliveries =
            java.util.concurrent.atomic
                .AtomicInteger()
        repeat(3) {
            val view =
                build("plain", label = "shared-label") { action ->
                    seen.add(action.dispatchId)
                    deliveries.incrementAndGet()
                    null
                }
            view.emit("b", "tap")
            view.emit("b", "tap")
            // Two views with one label share an identity and a dispatch
            // number sequence; the id still tells every dispatch apart.
            assertEquals(listOf(0, 1), view.dispatched.map { it.action.dispatch })
            assertEquals(
                "shared-label",
                view.dispatched
                    .first()
                    .action.viewIdentity,
            )
            view.teardown()
        }
        waitUntil { deliveries.get() == 6 }
        assertEquals(6, seen.size)
    }

    // Host functions

    private val functionVocabulary =
        """
        {"milano": "2.1.0", "name": "functions", "version": "1.0.0",
         "components": {"Text": {"properties": {"text": "string"}}},
         "functions": {"shout": {"arguments": ["string"], "returns": "string"}}}
        """.trimIndent()

    private fun buildWithFunctions(
        expression: String,
        occurrences: OccurrenceCollector? = null,
        handler: MilanoFunctionHandler?,
        configure: (MilanoViewBuilder) -> Unit = {},
    ): MilanoView {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val engine = MilanoEngine(functionVocabulary, registry, observer = occurrences, functionHandler = handler)
        val document =
            """{"version": "2.1.0", "root": {"type": "Text", "id": "t", "properties": {"text": {"${'$'}expr": "$expression"}}}}"""
        return runBlocking {
            val builder = engine.viewBuilder(document).dispatcher(InlineDispatcher)
            configure(builder)
            builder.build()
        }
    }

    @Test
    fun theEngineHandlerAnswersDeclaredFunctionsSynchronously() {
        val calls = ArrayList<MilanoFunctionCall>()
        val view =
            buildWithFunctions("shout('hi')", handler = { call ->
                calls.add(call)
                MilanoValue.StringValue(
                    call.arguments
                        .single()
                        .stringOrNull!!
                        .uppercase(),
                )
            })
        assertEquals(MilanoValue.StringValue("HI"), view.resolvedRoot.values["text"])
        assertEquals(listOf(MilanoFunctionCall("shout", listOf(MilanoValue.StringValue("hi")))), calls)
    }

    @Test
    fun aThrowingHandlerIsAnInvalidResultReplacedByTheZeroValue() {
        val collector = OccurrenceCollector()
        val view =
            buildWithFunctions("${'$'}concat('[', shout('hi'), ']')", occurrences = collector, handler = {
                throw IllegalStateException("no shouting")
            })
        assertEquals(MilanoValue.StringValue("[]"), view.resolvedRoot.values["text"])
        val report = collector.collected.single()
        assertEquals(MilanoOccurrence.Kind.INVALID_FUNCTION_RESULT, report.kind)
        assertEquals("t", report.node)
        assertEquals("shout", report.name)
        assertEquals("string", report.expected)
        assertEquals("error", report.found)
    }

    @Test
    fun aBuilderDeclarationOverridesTheVocabularyAndNeedsTheHandler() {
        // Overridden to return an int: the call is typed by the surface's declaration.
        val view =
            buildWithFunctions("${'$'}str(shout('x') + 1)", handler = { MilanoValue.IntValue(41) }) { builder ->
                builder.function("shout", listOf(MilanoType(MilanoType.Kind.Text)), MilanoType(MilanoType.Kind.Int))
            }
        assertEquals(MilanoValue.StringValue("42"), view.resolvedRoot.values["text"])

        // Without a handler on the engine, a calling document fails at build.
        val error =
            assertFailsWith<MilanoBuildException.SchemaViolation> {
                buildWithFunctions("shout('x')", handler = null)
            }
        assertEquals("function-handler", error.rule)
        assertEquals("function handler", error.expected)
        assertNull(error.node)

        // A document calling nothing builds without one.
        assertEquals(MilanoValue.StringValue("plain"), buildWithFunctions("'plain'", handler = null).resolvedRoot.values["text"])
    }

    // Document replacement

    private val replaceVocabulary =
        """
        {"milano": "2.1.0", "name": "replace", "version": "1.0.0",
         "components": {"Text": {"properties": {"text": "string"}, "events": {"tap": null}}}}
        """.trimIndent()

    private fun countingDocument(
        key: String,
        extra: String = "",
    ): String =
        """
        {"version": "2.1.0",
         "state": {"$key": "int"$extra},
         "root": {"type": "Text", "id": "t",
                  "properties": {"text": {"${'$'}expr": "${'$'}str(state.$key)"}},
                  "on": {"tap": [{"action": "${'$'}set", "key": "$key", "value": {"${'$'}expr": "state.$key + 1"}}]}}}
        """.trimIndent()

    // engine-pinned: replace-provider-failure-propagates
    @Test
    fun aProviderFailureDuringReplacementPropagatesAndLeavesTheViewUntouched() {
        class ProviderFailure : Exception("provider down")

        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val interactions = InteractionCollector()
        val engine = MilanoEngine(replaceVocabulary, registry, userInteractionObserver = interactions)
        var builds = 0
        val view =
            runBlocking {
                engine
                    .viewBuilder(countingDocument("n"))
                    .stateDataProvider { declarations ->
                        builds += 1
                        if (builds > 1) throw ProviderFailure()
                        declarations.mapValues { MilanoValue.IntValue(7) }
                    }.dispatcher(InlineDispatcher)
                    .build()
            }
        view.emit("t", "tap")
        val treeBefore = view.resolvedRoot
        val documentBefore = view.document

        // The new document declares a key the old one lacks: the provider
        // is asked, and its own error reaches the caller unchanged.
        val failure =
            assertFailsWith<ProviderFailure> {
                runBlocking { view.replace(countingDocument("n", extra = ", \"m\": \"int\"")) }
            }
        assertEquals("provider down", failure.message)
        assertEquals(2, builds)

        // Same document, same tree, same state, still serviceable.
        assertSame(documentBefore, view.document)
        assertSame(treeBefore, view.resolvedRoot)
        assertEquals(mapOf("n" to MilanoValue.IntValue(8)), view.state)
        view.emit("t", "tap")
        assertEquals(MilanoValue.StringValue("9"), view.resolvedRoot.values["text"])
        assertTrue(interactions.collected.none { it.kind == MilanoUserInteraction.Kind.VIEW_REPLACED })
    }

    // A throwing listener clears the work queue; a replacement whose swap
    // was queued behind it must fail, never wait forever.
    @Test
    fun aReplacementDroppedByAThrowingListenerFailsInsteadOfHanging() {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val engine = MilanoEngine(replaceVocabulary, registry)
        val held = ArrayList<() -> Unit>()
        var holding = false
        val dispatcher =
            object : MilanoDispatcher {
                override fun dispatch(work: () -> Unit) {
                    if (holding) {
                        held.add(work)
                    } else {
                        work()
                    }
                }
            }
        val view =
            runBlocking {
                engine
                    .viewBuilder(countingDocument("n"))
                    .stateDataProvider { declarations -> declarations.mapValues { MilanoValue.IntValue(0) } }
                    .dispatcher(dispatcher)
                    .build()
            }
        val failure =
            runBlocking {
                // The replacement's swap waits on the dispatcher; the listener
                // releases it mid-drain, so it queues behind the emission,
                // then throws and clears the queue.
                holding = true
                val replacing = async { runCatching { view.replace(countingDocument("n")) } }
                while (held.isEmpty()) delay(1)
                holding = false
                view.onChange = {
                    held.toList().also { held.clear() }.forEach { it() }
                    throw IllegalStateException("host bug")
                }
                assertFailsWith<IllegalStateException> { view.emit("t", "tap") }
                replacing.await().exceptionOrNull()
            }
        assertEquals("the view's work queue was cleared before this update ran", failure?.message)
        assertEquals(mapOf("n" to MilanoValue.IntValue(1)), view.state)
    }

    @Test
    fun aReplacementFromBytesCarriesStateAndKeepsTheAppearedState() {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val interactions = InteractionCollector()
        val engine = MilanoEngine(replaceVocabulary, registry, userInteractionObserver = interactions)
        val asked = ArrayList<Set<String>>()
        val view =
            runBlocking {
                engine
                    .viewBuilder(countingDocument("n"))
                    .stateDataProvider { declarations ->
                        asked.add(declarations.keys)
                        declarations.mapValues { MilanoValue.IntValue(0) }
                    }.dispatcher(InlineDispatcher)
                    .build()
            }
        view.appear()
        view.emit("t", "tap")

        // `n` carries over with its current value; only `m` is asked for.
        val replacement =
            """
            {"version": "2.1.0",
             "state": {"n": "int", "m": "int"},
             "root": {"type": "Text", "id": "t",
                      "properties": {"text": {"${'$'}expr": "${'$'}concat(${'$'}str(state.n), '/', ${'$'}str(state.m))"}}},
             "on": {"appear": [{"action": "${'$'}set", "key": "m", "value": 5}]},
             "metadata": {"campaign": "x"}}
            """.trimIndent()
        runBlocking { view.replace(replacement.encodeToByteArray()) }
        assertEquals(listOf(setOf("n"), setOf("m")), asked)
        assertEquals(MilanoValue.StringValue("1/0"), view.resolvedRoot.values["text"])
        assertEquals(MilanoValue.RecordValue(mapOf("campaign" to MilanoValue.StringValue("x"))), view.metadata)

        // No signal is synthesized: the view is still appeared, so the new
        // appear list runs on the next acceptance only.
        view.appear()
        assertEquals(MilanoValue.IntValue(0), view.state["m"])
        view.disappear()
        view.appear()
        assertEquals(MilanoValue.IntValue(5), view.state["m"])
        assertEquals(
            listOf(
                MilanoUserInteraction.Kind.VIEW_BUILT,
                MilanoUserInteraction.Kind.VIEW_APPEARED,
                MilanoUserInteraction.Kind.EVENT,
                MilanoUserInteraction.Kind.VIEW_REPLACED,
                MilanoUserInteraction.Kind.VIEW_DISAPPEARED,
                MilanoUserInteraction.Kind.VIEW_APPEARED,
            ),
            interactions.collected.map { it.kind },
        )
    }
}
