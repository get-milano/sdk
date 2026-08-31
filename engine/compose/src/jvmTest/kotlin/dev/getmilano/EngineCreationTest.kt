package dev.getmilano

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

private object StubRenderer : MilanoRenderer {
    @androidx.compose.runtime.Composable
    override fun Render(node: MilanoNode) {}
}

private object StubPlaceholder : MilanoPlaceholderRenderer {
    @androidx.compose.runtime.Composable
    override fun Render(unknown: MilanoUnknownNode) {}
}

// engine-pinned: invalid-vocabulary-at-creation
// engine-pinned: vocabulary-contract-version-rejected
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
        assertEquals(2, vocabulary.contractMajor)
        assertEquals(1, vocabulary.contractMinor)
        assertEquals("examples", vocabulary.name)
        assertEquals(12, vocabulary.components.size)

        val badge = assertNotNull(vocabulary.components["Badge"])
        val tone = MilanoType(MilanoType.Kind.Enum(setOf("info", "warning", "danger")))
        assertEquals(tone, badge.properties["tone"])
        assertEquals(tone, badge.events["select"])

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

        // Host functions (contract 2.1), in declaration order. `round` is
        // named after a built-in, which the two namespaces allow.
        assertEquals(
            listOf("formatMoney", "parseInt", "round", "scale", "shout", "tone"),
            vocabulary.functions.keys.toList(),
        )
        val formatMoney = assertNotNull(vocabulary.functions["formatMoney"])
        assertEquals(listOf(MilanoType(MilanoType.Kind.Int), MilanoType(MilanoType.Kind.Text)), formatMoney.arguments)
        assertEquals(MilanoType(MilanoType.Kind.Text), formatMoney.returns)
        assertEquals(MilanoType(MilanoType.Kind.Int, optional = true), assertNotNull(vocabulary.functions["parseInt"]).returns)
        val toneFunction = assertNotNull(vocabulary.functions["tone"])
        assertEquals(listOf(tone), toneFunction.arguments)
        assertEquals(tone, toneFunction.returns)
    }

    /**
     * Function declarations (vocabulary schema spec, Function
     * declarations): an empty argument list is a mistake, the descriptors
     * must parse, and the section itself needs an artifact declaring
     * contract 2.1. A built-in's name is not a mistake: the two namespaces
     * are separate.
     */
    @Test
    fun functionDeclarationsAreValidated() {
        fun creationError(
            functions: String,
            milano: String = "2.1.0",
        ): MilanoEngineException.InvalidVocabulary =
            assertFailsWith {
                MilanoVocabulary.parse(
                    """{"milano": "$milano", "name": "x", "version": "1.0.0", "components": {}, "functions": $functions}""",
                )
            }

        creationError("""{"${'$'}now": {"arguments": ["int"], "returns": "string"}}""").let {
            assertEquals("function-name", it.rule)
            assertEquals("\$now", it.detail)
        }
        creationError("""{"now": {"arguments": [], "returns": "string"}}""").let {
            assertEquals("function-arguments", it.rule)
            assertEquals("now", it.detail)
        }
        creationError("""{"now": {"returns": "string"}}""").let {
            assertEquals("function-arguments", it.rule)
        }
        creationError("""{"now": {"arguments": ["varchar"], "returns": "string"}}""").let {
            assertEquals("function-argument", it.rule)
            assertEquals("now", it.detail)
        }
        creationError("""{"now": {"arguments": ["int"]}}""").let {
            assertEquals("function-returns", it.rule)
        }
        creationError("""{"now": 5}""").let {
            assertEquals("function", it.rule)
        }
        creationError("""[]""").let {
            assertEquals("functions", it.rule)
        }
        // The artifact's declared version is a floor: a 2.0 artifact may
        // not declare functions, whatever it declares.
        creationError("""{"shout": {"arguments": ["string"], "returns": "string"}}""", milano = "2.0.0").let {
            assertEquals("contract-feature", it.rule)
            assertEquals("functions need contract 2.1", it.detail)
        }
        creationError("""{}""", milano = "1.0.0").let {
            assertEquals("contract-feature", it.rule)
        }

        // A valid declaration parses in declaration order.
        val vocabulary =
            MilanoVocabulary.parse(
                """{"milano": "2.1.0", "name": "x", "version": "1.0.0", "components": {},
                    "functions": {"b": {"arguments": ["int"], "returns": "int?"},
                                  "a": {"arguments": [{"enum": ["x", "y"]}, "double"], "returns": {"array": "string"}}}}""",
            )
        assertEquals(listOf("a", "b"), vocabulary.functions.keys.toList())
        assertEquals(
            MilanoVocabulary.Function(
                listOf(MilanoType(MilanoType.Kind.Enum(setOf("x", "y"))), MilanoType(MilanoType.Kind.Double)),
                MilanoType(MilanoType.Kind.Array(MilanoType(MilanoType.Kind.Text))),
            ),
            vocabulary.functions["a"],
        )

        // A function named like a built-in is accepted: the contract's own
        // functions are called through `$`, so `round` and `$round` are two
        // names and neither shadows the other.
        val named =
            MilanoVocabulary.parse(
                """{"milano": "2.1.0", "name": "x", "version": "1.0.0", "components": {},
                    "functions": {"round": {"arguments": ["double", "int"], "returns": "string"}}}""",
            )
        assertEquals(
            listOf(MilanoType(MilanoType.Kind.Double), MilanoType(MilanoType.Kind.Int)),
            assertNotNull(named.functions["round"]).arguments,
        )
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
    fun unknownTypePolicyDefaultsToFail() {
        val registry = MilanoRegistry()
        val vocabulary = MilanoVocabulary.parse(examplesVocabularyJson())
        for (type in vocabulary.components.keys) registry.register(type, StubRenderer)
        val engine = MilanoEngine(examplesVocabularyJson(), registry)
        assertEquals(MilanoUnknownTypePolicy.FAIL, engine.defaultUnknownTypePolicy)
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
        creationError("""{"milano": "0.1.0", "name": "x", "version": "1.0.0", "components": {}}""").let {
            assertEquals("milano-version", it.rule)
        }
        creationError("""{"milano": "1.0.0", "name": "x", "version": "1", "components": {}}""").let {
            assertEquals("version", it.rule)
            assertEquals("vocabulary version must be major.minor.patch", it.detail)
        }
        creationError(
            """{"milano": "1.0.0", "name": "x", "version": "1.0.0", "components": {"${'$'}Bad": {}}}""",
        ).let {
            assertEquals("component-name", it.rule)
            assertEquals("\$Bad", it.detail)
        }
        creationError(
            """{"milano": "1.0.0", "name": "x", "version": "1.0.0",
                "components": {"Text": {"properties": {"text": "varchar"}}}}""",
        ).let {
            assertEquals("component-property", it.rule)
            assertEquals("Text.text", it.detail)
        }
        creationError(
            """{"milano": "1.0.0", "name": "x", "version": "1.0.0",
                "components": {"Button": {"events": {"tap": 5}}}}""",
        ).let {
            assertEquals("component-event", it.rule)
            assertEquals("Button.tap", it.detail)
        }
    }

    /**
     * An engine takes a copy of the registry at creation: registering or
     * replacing a renderer afterwards changes nothing an existing engine
     * renders, which is what "immutable after creation" has to mean. Swift
     * gets this from value semantics and TypeScript copies explicitly.
     */
    @Test
    fun registrationsAfterCreationDoNotReachTheEngine() {
        val registry = MilanoRegistry()
        registry.register("Text", StubRenderer)
        val engine =
            MilanoEngine(
                """{"milano": "1.0.0", "name": "x", "version": "1.0.0",
                    "components": {"Text": {"properties": {"text": "string"}}}}""",
                registry,
            )
        val replacement =
            object : MilanoRenderer {
                @androidx.compose.runtime.Composable
                override fun Render(node: MilanoNode) {}
            }
        registry.register("Text", replacement)
        registry.registerPlaceholder(StubPlaceholder)
        assertSame(StubRenderer, engine.registry.renderers["Text"])
        assertNull(engine.registry.placeholder)
    }
}
