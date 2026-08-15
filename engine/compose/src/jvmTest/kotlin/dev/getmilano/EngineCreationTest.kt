package dev.getmilano

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private object StubRenderer : MilanoRenderer {
    @androidx.compose.runtime.Composable
    override fun Render(node: MilanoNode) {}
}

private object StubPlaceholder : MilanoPlaceholderRenderer {
    @androidx.compose.runtime.Composable
    override fun Render(unknown: MilanoUnknownNode) {}
}

class EngineCreationTest {
    private fun examplesVocabularyJson(): String {
        val specs =
            requireNotNull(
                System.getenv("MILANO_SPECS_DIR")?.takeIf { it.isNotEmpty() }?.let(::File)
                    ?: File(System.getProperty("user.dir"))
                        .resolve("../../../specs")
                        .canonicalFile
                        .takeIf { it.isDirectory },
            ) { "specs repository not found" }
        return specs.resolve("conformance/examples/vocabulary.json").readText()
    }

    private fun fullRegistry(vocabulary: MilanoVocabulary): MilanoRegistry {
        val registry = MilanoRegistry()
        for (type in vocabulary.components.keys) {
            registry.register(type, StubRenderer)
        }
        return registry
    }

    @Test
    fun examplesVocabularyParses() {
        val vocabulary = MilanoVocabulary.parse(examplesVocabularyJson())
        assertEquals(0, vocabulary.contractMajor)
        assertEquals(1, vocabulary.contractMinor)
        assertEquals("examples", vocabulary.name)
        assertEquals(7, vocabulary.components.size)

        val button = assertNotNull(vocabulary.components["Button"])
        assertTrue("tap" in button.events) // declared
        assertNull(button.events["tap"]) // payload-less
        assertEquals(MilanoType(MilanoType.Kind.Bool), button.properties["enabled"])
        assertFalse(button.children)

        val textField = assertNotNull(vocabulary.components["TextField"])
        assertEquals(MilanoType(MilanoType.Kind.Text), textField.events["change"])

        val numberField = assertNotNull(vocabulary.components["NumberField"])
        assertEquals(MilanoType(MilanoType.Kind.Double), numberField.events["change"])
        assertEquals(MilanoType(MilanoType.Kind.Double), numberField.properties["value"])

        val banner = assertNotNull(vocabulary.components["Banner"])
        assertTrue(banner.children)

        val openUrl = assertNotNull(vocabulary.actions["openUrl"])
        assertEquals(MilanoType(MilanoType.Kind.Text), openUrl.parameters["url"])
    }

    @Test
    fun engineCreatesWithFullRegistry() {
        val json = examplesVocabularyJson()
        val vocabulary = MilanoVocabulary.parse(json)
        val engine =
            MilanoEngine(
                vocabularyJson = json,
                registry = fullRegistry(vocabulary),
                defaultUnknownTypePolicy = MilanoUnknownTypePolicy.SKIP,
            )
        assertEquals("examples", engine.vocabulary.name)
        assertEquals(MilanoLimits(), engine.limits)
    }

    @Test
    fun missingRendererIsIncompleteRegistry() {
        val json = examplesVocabularyJson()
        val vocabulary = MilanoVocabulary.parse(json)
        val registry = MilanoRegistry()
        for (type in vocabulary.components.keys.filter { it != "Checkbox" }) {
            registry.register(type, StubRenderer)
        }
        val error =
            assertFailsWith<MilanoEngineException.IncompleteRegistry> {
                MilanoEngine(json, registry, MilanoUnknownTypePolicy.SKIP)
            }
        assertEquals(listOf("Checkbox"), error.missing)
    }

    @Test
    fun placeholderPolicyRequiresPlaceholderRenderer() {
        val json = examplesVocabularyJson()
        val vocabulary = MilanoVocabulary.parse(json)

        val error =
            assertFailsWith<MilanoEngineException.IncompleteRegistry> {
                MilanoEngine(json, fullRegistry(vocabulary), MilanoUnknownTypePolicy.PLACEHOLDER)
            }
        assertEquals(listOf("(placeholder renderer)"), error.missing)

        val withPlaceholder = fullRegistry(vocabulary).apply { registerPlaceholder(StubPlaceholder) }
        MilanoEngine(json, withPlaceholder, MilanoUnknownTypePolicy.PLACEHOLDER)
    }

    @Test
    fun invalidVocabulariesAreRejected() {
        fun creationError(json: String): MilanoEngineException.InvalidVocabulary =
            assertFailsWith { MilanoVocabulary.parse(json) }

        creationError("{ nope").let {
            assertEquals("json", it.rule)
        }
        creationError("""{"milano": "1", "name": "x", "version": "1", "components": {}}""").let {
            assertEquals("milano", it.rule)
            assertEquals("expected major.minor.patch, found 1", it.detail)
        }
        creationError(
            """{"milano": "0.1.0", "name": "x", "version": "1", "components": {"${'$'}Bad": {}}}""",
        ).let {
            assertEquals("component-name", it.rule)
            assertEquals("\$Bad", it.detail)
        }
        creationError(
            """{"milano": "0.1.0", "name": "x", "version": "1",
                "components": {"Text": {"properties": {"text": "varchar"}}}}""",
        ).let {
            assertEquals("component-property", it.rule)
            assertEquals("Text.text", it.detail)
        }
        creationError(
            """{"milano": "0.1.0", "name": "x", "version": "1",
                "components": {"Button": {"events": {"tap": 5}}}}""",
        ).let {
            assertEquals("component-event", it.rule)
            assertEquals("Button.tap", it.detail)
        }
    }
}
