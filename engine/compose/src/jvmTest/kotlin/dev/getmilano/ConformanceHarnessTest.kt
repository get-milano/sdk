package dev.getmilano

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Conformance groundwork: locate the specs repository, discover suites, and
 * decode every vector's envelope. Vector execution lives in VectorRunnerTest.
 */
class ConformanceHarnessTest {
    private fun specsDirectory(): File? {
        System.getenv("MILANO_SPECS_DIR")?.takeIf { it.isNotEmpty() }?.let {
            val dir = File(it)
            return if (dir.isDirectory) dir else null
        }
        // user.dir during tests: .../sdk/engine/compose
        val sibling =
            File(System.getProperty("user.dir"))
                .resolve("../../../specs")
                .canonicalFile
        return if (sibling.isDirectory) sibling else null
    }

    private fun suiteDirectories(): List<File> {
        val conformance = specsDirectory()?.resolve("conformance") ?: return emptyList()
        return conformance
            .listFiles { f: File -> f.isDirectory && f.resolve("vocabulary.json").isFile }
            ?.toList() ?: emptyList()
    }

    @Test
    fun specsRepositoryIsDiscoverable() {
        val specs = assertNotNull(specsDirectory(), "specs repository not found")
        assertTrue(specs.resolve("conformance").isDirectory)
    }

    @Test
    fun suitesExist() {
        assertTrue(suiteDirectories().isNotEmpty())
    }

    @Test
    fun everyVocabularyDecodes() {
        for (suite in suiteDirectories()) {
            val artifact = Json.parseToJsonElement(suite.resolve("vocabulary.json").readText())
            assertTrue(artifact is JsonObject, "${suite.name}/vocabulary.json is not an object")
            for (field in listOf("milano", "name", "version")) {
                assertTrue(artifact[field] is JsonPrimitive, "${suite.name}/vocabulary.json: $field")
            }
            assertTrue(artifact["components"] is JsonObject, "${suite.name}/vocabulary.json: components")
        }
    }

    @Test
    fun everyVectorEnvelopeDecodes() {
        var vectorCount = 0
        for (suite in suiteDirectories()) {
            val files =
                suite.listFiles { f: File -> f.extension == "json" && f.name != "vocabulary.json" }
                    ?: emptyArray()
            for (file in files) {
                val vector = Json.parseToJsonElement(file.readText())
                assertTrue(vector is JsonObject, "${file.name} is not an object")
                assertTrue(vector["name"] is JsonPrimitive, "${file.name}: name")
                assertTrue(vector["expect"] is JsonObject, "${file.name}: expect")

                val hasDocument = vector["document"] is JsonObject
                val hasDocumentText = vector["documentText"] is JsonPrimitive
                assertTrue(
                    hasDocument != hasDocumentText,
                    "${file.name}: exactly one of document/documentText",
                )
                vectorCount += 1
            }
        }
        assertTrue(vectorCount > 0)
    }
}
