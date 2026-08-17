package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Executes every conformance vector: build scenarios and stepped
 * interaction scenarios (events, context updates, completions, teardown).
 */
class VectorRunnerTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object StubPlaceholder : MilanoPlaceholderRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(unknown: MilanoUnknownNode) {}
    }

    private class InteractionCollector : MilanoUserInteractionObserver {
        val collected = ArrayList<MilanoUserInteraction>()

        override fun interaction(interaction: MilanoUserInteraction) {
            collected.add(interaction)
        }
    }

    private fun interactionWireName(kind: MilanoUserInteraction.Kind): String {
        val parts = kind.name.lowercase().split("_")
        return parts[0] + parts.drop(1).joinToString("") { part -> part.replaceFirstChar { it.uppercase() } }
    }

    private class OccurrenceCollector : MilanoObserver {
        val collected = ArrayList<MilanoOccurrence>()

        override fun occurrence(occurrence: MilanoOccurrence) {
            collected.add(occurrence)
        }
    }

    /**
     * The harness serialization seam: work queues until pumped, so every
     * step is deterministic.
     */
    private class PumpDispatcher : MilanoDispatcher {
        private val queue = ArrayDeque<() -> Unit>()

        override fun dispatch(work: () -> Unit) {
            synchronized(queue) { queue.addLast(work) }
        }

        fun pump() {
            while (true) {
                val next = synchronized(queue) { queue.removeFirstOrNull() } ?: return
                next()
            }
        }
    }

    /**
     * Completions are scripted by steps, never by the handler: it suspends
     * forever, and the runner drives the completion path directly.
     */
    private object NeverCompletingHandler : MilanoActionHandler {
        override suspend fun handle(action: MilanoAction): MilanoValue? {
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { }
            return null
        }
    }

    private fun specsDirectory(): File =
        requireNotNull(
            System.getenv("MILANO_SPECS_DIR")?.takeIf { it.isNotEmpty() }?.let(::File)
                ?: File(System.getProperty("user.dir"))
                    .resolve("../../../specs")
                    .canonicalFile
                    .takeIf { it.isDirectory },
        ) { "specs repository not found" }

    private fun wireName(kind: MilanoOccurrence.Kind): String =
        when (kind) {
            MilanoOccurrence.Kind.UNKNOWN_TYPE_SKIPPED -> "unknownTypeSkipped"
            MilanoOccurrence.Kind.UNKNOWN_TYPE_PLACEHOLDER -> "unknownTypePlaceholder"
            MilanoOccurrence.Kind.UNDECLARED_PROPERTY -> "undeclaredProperty"
            MilanoOccurrence.Kind.DROPPED_EVENT -> "droppedEvent"
            MilanoOccurrence.Kind.INVALID_EMISSION -> "invalidEmission"
            MilanoOccurrence.Kind.INVALID_COMPLETION -> "invalidCompletion"
            MilanoOccurrence.Kind.DUPLICATE_COMPLETION -> "duplicateCompletion"
            MilanoOccurrence.Kind.COMPLETION_AFTER_TEARDOWN -> "completionAfterTeardown"
            MilanoOccurrence.Kind.REJECTED_CONTEXT_UPDATE -> "rejectedContextUpdate"
            MilanoOccurrence.Kind.DIVISION_BY_ZERO -> "divisionByZero"
            MilanoOccurrence.Kind.SATURATION -> "saturation"
        }

    /**
     * Subset match, per the suite's conventions: every key the vector
     * specifies must be present and equal.
     */
    private fun matches(
        produced: Map<String, MilanoValue>,
        expected: Map<String, MilanoValue>,
    ) = expected.all { (key, value) -> produced[key] == value }

    private fun snapshot(node: ResolvedNode): MilanoValue {
        val fields = LinkedHashMap<String, MilanoValue>()
        fields["type"] = MilanoValue.StringValue(node.type)
        fields["reference"] = MilanoValue.StringValue(node.reference)
        if (node.isPlaceholder) fields["placeholder"] = MilanoValue.BoolValue(true)
        if (node.values.isNotEmpty()) {
            fields["properties"] = MilanoValue.RecordValue(node.values)
        }
        if (node.children.isNotEmpty()) {
            fields["children"] = MilanoValue.ArrayValue(node.children.map { snapshot(it) })
        }
        return MilanoValue.RecordValue(fields)
    }

    /** MilanoValue back to canonical JSON text for the builder input. */
    private fun jsonText(value: MilanoValue): String =
        when (value) {
            is MilanoValue.Null -> {
                "null"
            }

            is MilanoValue.BoolValue -> {
                value.value.toString()
            }

            is MilanoValue.IntValue -> {
                value.value.toString()
            }

            is MilanoValue.DoubleValue -> {
                value.value.toString()
            }

            is MilanoValue.StringValue -> {
                Json.encodeToString(kotlinx.serialization.json.JsonPrimitive(value.value))
            }

            is MilanoValue.ArrayValue -> {
                value.values.joinToString(",", "[", "]") { jsonText(it) }
            }

            is MilanoValue.RecordValue -> {
                value.values.entries.joinToString(",", "{", "}") { (k, v) ->
                    "${Json.encodeToString(kotlinx.serialization.json.JsonPrimitive(k))}:${jsonText(v)}"
                }
            }
        }

    @Test
    fun allVectors() {
        var executed = 0
        val conformance = specsDirectory().resolve("conformance")
        val suites =
            conformance.listFiles { f: File ->
                f.isDirectory && f.resolve("vocabulary.json").isFile
            } ?: emptyArray()

        for (suite in suites) {
            val vocabularyJson = suite.resolve("vocabulary.json").readText()
            val vocabulary = MilanoVocabulary.parse(vocabularyJson)

            val vectorFiles =
                (
                    suite.listFiles { f: File ->
                        f.extension == "json" && f.name != "vocabulary.json"
                    } ?: emptyArray()
                ).sortedBy { it.name }

            for (file in vectorFiles) {
                val vector =
                    (
                        MilanoValue.fromJson(Json.parseToJsonElement(file.readText()))
                            as MilanoValue.RecordValue
                    ).values
                val name = (vector["name"] as MilanoValue.StringValue).value
                run(vector, name, vocabulary, vocabularyJson)
                executed += 1
            }
        }
        assertTrue(executed >= 41, "expected the full starter suite, ran $executed")
    }

    private fun run(
        vector: Map<String, MilanoValue>,
        name: String,
        vocabulary: MilanoVocabulary,
        vocabularyJson: String,
    ) {
        val registry = MilanoRegistry()
        for (type in vocabulary.components.keys) registry.register(type, StubRenderer)
        registry.registerPlaceholder(StubPlaceholder)

        val policy =
            (
                (vector["config"] as? MilanoValue.RecordValue)
                    ?.values
                    ?.get("unknownTypePolicy") as? MilanoValue.StringValue
            )?.let { MilanoUnknownTypePolicy.valueOf(it.value.uppercase()) }
                ?: MilanoUnknownTypePolicy.FAIL

        val collector = OccurrenceCollector()
        val interactions = InteractionCollector()
        val engine =
            MilanoEngine(
                vocabularyJson,
                registry,
                policy,
                observer = collector,
                userInteractionObserver = interactions,
            )

        val documentText =
            (vector["documentText"] as? MilanoValue.StringValue)?.value
                ?: jsonText(vector["document"] ?: MilanoValue.Null)

        val pump = PumpDispatcher()
        val builder = engine.viewBuilder(documentText).label(name)

        // The surface's action grants, per the vector's config.
        val actionsConfig =
            ((vector["config"] as? MilanoValue.RecordValue)?.values?.get("actions") as? MilanoValue.RecordValue)?.values
        (actionsConfig?.get("allow") as? MilanoValue.ArrayValue)?.let { allowed ->
            builder.allowActions(allowed.values.mapNotNull { it.stringOrNull })
        }
        (actionsConfig?.get("declare") as? MilanoValue.RecordValue)?.values?.forEach { (actionName, declaration) ->
            val descriptors =
                ((declaration as? MilanoValue.RecordValue)?.values?.get("parameters") as? MilanoValue.RecordValue)
                    ?.values
                    .orEmpty()
            val parameters = LinkedHashMap<String, MilanoType>()
            for ((parameter, descriptor) in descriptors) {
                MilanoType.fromDescriptor(descriptor)?.let { parameters[parameter] = it }
            }
            val result =
                (declaration as? MilanoValue.RecordValue)
                    ?.values
                    ?.get("result")
                    ?.let { MilanoType.fromDescriptor(it) }
            builder.action(actionName, parameters, result)
        }
        builder.dispatcher(pump)
        builder.actionHandler(NeverCompletingHandler)

        val contextHandle =
            MilanoContextHandle((vector["context"] as? MilanoValue.RecordValue)?.values ?: emptyMap())
        builder.contextSource(contextHandle)

        (vector["state"] as? MilanoValue.RecordValue)?.let { state ->
            builder.stateDataProvider { state.values }
        }

        val expect = (vector["expect"] as MilanoValue.RecordValue).values
        val expectedError = (expect["error"] as? MilanoValue.RecordValue)?.values

        try {
            val view = runBlocking { builder.build() }

            if (expectedError != null) {
                fail("$name: expected error $expectedError, build succeeded")
            }

            // Steps: events, context updates, completions, teardown.
            (vector["steps"] as? MilanoValue.ArrayValue)?.let { steps ->
                for (step in steps.values) {
                    val fields = (step as? MilanoValue.RecordValue)?.values ?: continue
                    (fields["event"] as? MilanoValue.RecordValue)?.values?.let { event ->
                        val node = (event["node"] as MilanoValue.StringValue).value
                        val eventName = (event["name"] as MilanoValue.StringValue).value
                        view.emit(node, eventName, event["payload"])
                        pump.pump()
                    }
                    (fields["contextUpdate"] as? MilanoValue.RecordValue)?.values?.let { update ->
                        contextHandle.update(update)
                        pump.pump()
                    }
                    if ("teardown" in fields) {
                        view.teardown()
                        pump.pump()
                    }
                    (fields["complete"] as? MilanoValue.RecordValue)?.values?.let { completion ->
                        val index = (completion["dispatch"] as MilanoValue.IntValue).value.toInt()
                        val success =
                            (completion["outcome"] as MilanoValue.StringValue).value == "success"
                        val payload = completion["payload"]
                        pump.dispatch { view.complete(index, success, payload) }
                        pump.pump()
                    }
                }
            }

            expect["view"]?.let { expectedView ->
                assertEquals(expectedView, snapshot(view.resolvedRoot), "$name: resolved tree mismatch")
            }
            (expect["state"] as? MilanoValue.RecordValue)?.let { expectedState ->
                assertEquals(expectedState.values, view.state, "$name: state mismatch")
            }
            (expect["dispatched"] as? MilanoValue.ArrayValue)?.let { expectedDispatched ->
                assertEquals(expectedDispatched.values.size, view.dispatched.size, "$name: dispatch count")
                for ((index, expected) in expectedDispatched.values.withIndex()) {
                    val fields = (expected as MilanoValue.RecordValue).values
                    val record = view.dispatched[index].action
                    val produced =
                        mapOf(
                            "action" to MilanoValue.StringValue(record.name),
                            "parameters" to MilanoValue.RecordValue(record.parameters),
                        )
                    assertTrue(
                        matches(produced, fields),
                        "$name: dispatch $index mismatch: $produced vs $fields",
                    )
                }
            }
            (expect["interactions"] as? MilanoValue.ArrayValue)?.let { expectedInteractions ->
                assertEquals(
                    expectedInteractions.values.size,
                    interactions.collected.size,
                    "$name: interaction count, got ${interactions.collected.map { it.kind }}",
                )
                for ((index, expected) in expectedInteractions.values.withIndex()) {
                    val fields = (expected as MilanoValue.RecordValue).values
                    val produced = interactions.collected[index]
                    val producedFields =
                        buildMap {
                            put("kind", MilanoValue.StringValue(interactionWireName(produced.kind)))
                            produced.node?.let { put("node", MilanoValue.StringValue(it)) }
                            produced.name?.let { put("name", MilanoValue.StringValue(it)) }
                            produced.value?.let { put("value", it) }
                        }
                    assertTrue(
                        matches(producedFields, fields),
                        "$name: interaction $index mismatch, got $producedFields",
                    )
                }
            }
            (expect["occurrences"] as? MilanoValue.ArrayValue)?.let { expectedOccurrences ->
                assertEquals(
                    expectedOccurrences.values.size,
                    collector.collected.size,
                    "$name: occurrence count",
                )
                for ((index, expected) in expectedOccurrences.values.withIndex()) {
                    val fields = (expected as MilanoValue.RecordValue).values
                    val produced = collector.collected[index]
                    val producedFields =
                        buildMap {
                            put("kind", MilanoValue.StringValue(wireName(produced.kind)))
                            produced.node?.let { put("node", MilanoValue.StringValue(it)) }
                        }
                    assertTrue(
                        matches(producedFields, fields),
                        "$name: occurrence $index mismatch: $producedFields vs $fields",
                    )
                }
            }
        } catch (error: MilanoBuildException) {
            if (expectedError == null) {
                fail("$name: unexpected build error ${error.fields()}")
            }
            assertTrue(
                matches(error.fields(), expectedError),
                "$name: error mismatch, produced ${error.fields()}, expected $expectedError",
            )
        }
    }
}
