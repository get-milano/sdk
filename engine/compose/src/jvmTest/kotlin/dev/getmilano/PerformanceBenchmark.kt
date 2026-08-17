package dev.getmilano

import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.time.DurationUnit
import kotlin.time.measureTime

/**
 * Coarse performance benchmarks over synthetic documents: cold build
 * (parse, gate, first resolution) and the update path (event dispatch,
 * built-in actions, re-resolution) across tree sizes. Medians are printed
 * as a table; the assertions are generous order-of-magnitude ceilings so
 * CI catches regressions without flaking on runner noise. Methodology and
 * published numbers live in docs/performance.md.
 */
class PerformanceBenchmark {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private class PumpDispatcher : MilanoDispatcher {
        private val queue = ArrayDeque<() -> Unit>()

        override fun dispatch(work: () -> Unit) {
            queue.addLast(work)
        }

        fun pump() {
            while (true) (queue.removeFirstOrNull() ?: return)()
        }
    }

    private val vocabulary =
        """
        {
          "milano": "1.0.0", "name": "bench", "version": "1.0.0",
          "components": {
            "Column": {"children": true},
            "Text": {"properties": {"text": "string"}},
            "Field": {"properties": {"value": "string"}, "events": {"change": "string"}}
          }
        }
        """.trimIndent()

    /**
     * A wide tree: one Field plus [nodes] Texts, every other Text bound to
     * state.value through an expression, the rest literal.
     */
    private fun document(nodes: Int): String {
        val children = StringBuilder()
        children.append(
            """{"type": "Field", "id": "field",""" +
                """ "properties": {"value": {"${'$'}expr": "state.value"}},""" +
                """ "on": {"change": [{"action": "${'$'}set", "key": "value",""" +
                """ "value": {"${'$'}expr": "event"}}]}}""",
        )
        for (i in 0 until nodes) {
            children.append(",")
            children.append(
                if (i % 2 == 0) {
                    """{"type": "Text", "properties": {"text": {"${'$'}expr": "concat('v', state.value)"}}}"""
                } else {
                    """{"type": "Text", "properties": {"text": "static $i"}}"""
                },
            )
        }
        return """{"version": "1.0.0", "state": {"value": "string"},""" +
            """"root": {"type": "Column", "id": "root", "children": [$children]}}"""
    }

    private fun median(samples: List<Double>): Double = samples.sorted()[samples.size / 2]

    private fun engine(): MilanoEngine {
        val registry = MilanoRegistry()
        registry.register("Column", StubRenderer)
        registry.register("Text", StubRenderer)
        registry.register("Field", StubRenderer)
        return MilanoEngine(vocabulary, registry)
    }

    @Test
    fun buildAndUpdateLatency() {
        val engine = engine()
        val sizes = listOf(10, 100, 1000, 5000)
        val results = LinkedHashMap<Int, Pair<Double, Double>>()

        for (nodes in sizes) {
            val text = document(nodes)
            val iterations = if (nodes >= 1000) 5 else 25

            // Warmup plus timed cold builds.
            fun build(): Pair<MilanoView, PumpDispatcher> {
                val pump = PumpDispatcher()
                val builder =
                    engine
                        .viewBuilder(text)
                        .dispatcher(pump)
                        .stateDataProvider { mapOf("value" to MilanoValue.StringValue("0")) }
                return kotlinx.coroutines.runBlocking { builder.build() } to pump
            }
            build()
            val buildSamples =
                (0 until iterations).map {
                    measureTime { build() }.toDouble(DurationUnit.MILLISECONDS)
                }

            // The update path: one event dispatch, $set, full re-resolution.
            val (view, pump) = build()
            var tick = 0

            fun update() {
                tick += 1
                view.emit("field", "change", MilanoValue.StringValue(tick.toString()))
                pump.pump()
            }
            update()
            val updateSamples =
                (0 until iterations * 4).map {
                    measureTime { update() }.toDouble(DurationUnit.MILLISECONDS)
                }
            results[nodes] = median(buildSamples) to median(updateSamples)
        }

        println("nodes | cold build (ms) | update (ms)")
        for ((nodes, timings) in results) {
            println("%5d | %15.3f | %11.3f".format(nodes, timings.first, timings.second))
        }

        // Order-of-magnitude regression guards, deliberately loose.
        val (build5000, update5000) = results.getValue(5000)
        assertTrue(build5000 < 5_000.0, "cold build of 5000 nodes took ${build5000}ms")
        assertTrue(update5000 < 2_000.0, "update on 5000 nodes took ${update5000}ms")
    }
}
