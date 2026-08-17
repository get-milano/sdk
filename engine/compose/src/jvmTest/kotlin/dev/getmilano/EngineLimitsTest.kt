package dev.getmilano

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.fail

/**
 * Resource limits at their exact boundaries, at the defaults and through
 * the engine's limits configuration. Tree depth and expression length are
 * pinned by conformance vectors; node count and document size, whose
 * boundary vectors would be megabyte-scale, are pinned here, per the
 * conformance suite spec.
 */
class EngineLimitsTest {
    private object StubRenderer : MilanoRenderer {
        @androidx.compose.runtime.Composable
        override fun Render(node: MilanoNode) {}
    }

    private object InlineDispatcher : MilanoDispatcher {
        override fun dispatch(work: () -> Unit) = work()
    }

    private val vocabulary =
        """
        {"milano": "1.0.0", "name": "limits", "version": "1.0.0",
         "components": {
            "Text": {"properties": {"text": "string"}},
            "Column": {"children": true}}}
        """.trimIndent()

    private fun engine(limits: MilanoLimits = MilanoLimits()): MilanoEngine {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        registry.register("Column", StubRenderer)
        return MilanoEngine(vocabulary, registry, limits = limits)
    }

    private fun buildError(
        document: String,
        limits: MilanoLimits = MilanoLimits(),
    ): MilanoBuildException? =
        try {
            runBlocking {
                engine(limits)
                    .viewBuilder(document)
                    .dispatcher(InlineDispatcher)
                    .build()
            }
            null
        } catch (exception: MilanoBuildException) {
            exception
        }

    /** A wide document: one Column root with `count - 1` Text children. */
    private fun wideDocument(nodes: Int): String {
        val children =
            (1 until nodes).joinToString(",") {
                """{"type": "Text", "properties": {"text": "x"}}"""
            }
        return """{"version": "1.0.0", "root": {"type": "Column", "children": [$children]}}"""
    }

    private fun assertLimit(
        exception: MilanoBuildException?,
        limit: String,
        value: Int,
        actual: Int,
    ) {
        val limitExceeded =
            exception as? MilanoBuildException.LimitExceeded
                ?: fail("expected LimitExceeded, got $exception")
        assertEquals(limit, limitExceeded.limit)
        assertEquals(value, limitExceeded.value)
        assertEquals(actual, limitExceeded.actual)
    }

    @Test
    fun defaultsMatchTheContract() {
        val limits = MilanoLimits()
        assertEquals(32, limits.maxTreeDepth)
        assertEquals(10_000, limits.maxNodeCount)
        assertEquals(1_048_576, limits.maxDocumentBytes)
        assertEquals(1_024, limits.maxExpressionLength)
    }

    @Test
    fun nodeCountBoundaryAtTheDefault() {
        // Exactly at the limit passes; one over is a typed gate error.
        assertNull(buildError(wideDocument(nodes = 10_000)))
        assertLimit(
            buildError(wideDocument(nodes = 10_001)),
            limit = "maxNodeCount",
            value = 10_000,
            actual = 10_001,
        )
    }

    @Test
    fun documentBytesBoundaryAtTheDefault() {
        // Pad a small valid document with insignificant whitespace to the
        // exact byte boundary; the size check runs on raw bytes, before
        // parsing.
        val core = """{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}"""
        val padded = core + " ".repeat(1_048_576 - core.encodeToByteArray().size)
        assertNull(buildError(padded))
        assertLimit(
            buildError("$padded "),
            limit = "maxDocumentBytes",
            value = 1_048_576,
            actual = 1_048_577,
        )
    }

    @Test
    fun configuredLimitsOverrideTheDefaults() {
        val deep =
            """{"version": "1.0.0", "root": {"type": "Column", "children": [
                {"type": "Column", "children": [
                    {"type": "Text", "properties": {"text": "x"}}]}]}}"""
        assertLimit(
            buildError(deep, MilanoLimits(maxTreeDepth = 2)),
            limit = "maxTreeDepth",
            value = 2,
            actual = 3,
        )

        val wide =
            """{"version": "1.0.0", "root": {"type": "Column", "children": [
                {"type": "Text", "properties": {"text": "a"}},
                {"type": "Text", "properties": {"text": "b"}},
                {"type": "Text", "properties": {"text": "c"}}]}}"""
        assertLimit(
            buildError(wide, MilanoLimits(maxNodeCount = 3)),
            limit = "maxNodeCount",
            value = 3,
            actual = 4,
        )

        val expression =
            """{"version": "1.0.0", "root": {"type": "Text",
                "properties": {"text": {"${'$'}expr": "'abcdefg'"}}}}"""
        assertLimit(
            buildError(expression, MilanoLimits(maxExpressionLength = 8)),
            limit = "maxExpressionLength",
            value = 8,
            actual = 9,
        )

        val anything = """{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}"""
        assertLimit(
            buildError(anything, MilanoLimits(maxDocumentBytes = 10)),
            limit = "maxDocumentBytes",
            value = 10,
            actual = anything.encodeToByteArray().size,
        )
    }
}
