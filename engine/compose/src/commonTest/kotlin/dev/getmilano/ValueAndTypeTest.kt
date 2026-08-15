package dev.getmilano

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun jsonValue(text: String): MilanoValue = assertNotNull(MilanoValue.fromJson(Json.parseToJsonElement(text)))

private fun type(descriptorJson: String): MilanoType = assertNotNull(MilanoType.fromDescriptor(jsonValue(descriptorJson)))

class MilanoValueTest {
    @Test
    fun numbersWithoutFractionArePartOfInt() {
        assertEquals(MilanoValue.IntValue(5), jsonValue("5"))
        assertEquals(MilanoValue.IntValue(-3), jsonValue("-3"))
        assertEquals(MilanoValue.DoubleValue(5.0), jsonValue("5.0"))
        assertEquals(MilanoValue.DoubleValue(0.25), jsonValue("0.25"))
    }

    @Test
    fun boolsAreNotNumbers() {
        assertEquals(MilanoValue.BoolValue(true), jsonValue("true"))
        assertEquals(MilanoValue.BoolValue(false), jsonValue("false"))
        assertEquals(MilanoValue.IntValue(1), jsonValue("1"))
    }

    @Test
    fun containersDecode() {
        assertEquals(
            MilanoValue.ArrayValue(listOf(MilanoValue.StringValue("a"), MilanoValue.IntValue(1), MilanoValue.Null)),
            jsonValue("""["a", 1, null]"""),
        )
        assertEquals(
            MilanoValue.RecordValue(mapOf("k" to MilanoValue.BoolValue(true))),
            jsonValue("""{"k": true}"""),
        )
    }

    @Test
    fun accessorsReturnDeclaredTypeOnly() {
        val value: MilanoValue = MilanoValue.IntValue(7)
        assertEquals(7L, value.intOrNull)
        assertNull(value.doubleOrNull)
        assertNull(value.stringOrNull)
    }
}

class MilanoTypeTest {
    @Test
    fun primitiveDescriptorsParse() {
        assertEquals(MilanoType(MilanoType.Kind.Int), type("\"int\""))
        assertEquals(MilanoType(MilanoType.Kind.Text, optional = true), type("\"string?\""))
        assertNull(MilanoType.fromDescriptor(MilanoValue.StringValue("float")))
        assertNull(MilanoType.fromDescriptor(MilanoValue.StringValue("int??")))
    }

    @Test
    fun compositeDescriptorsParse() {
        assertEquals(
            MilanoType(MilanoType.Kind.Array(MilanoType(MilanoType.Kind.Text))),
            type("""{"array": "string"}"""),
        )
        assertEquals(
            MilanoType(
                MilanoType.Kind.Record(
                    mapOf(
                        "id" to MilanoType(MilanoType.Kind.Int),
                        "title" to MilanoType(MilanoType.Kind.Text, optional = true),
                    ),
                ),
                optional = true,
            ),
            type("""{"record": {"id": "int", "title": "string?"}, "optional": true}"""),
        )
        assertNull(MilanoType.fromDescriptor(jsonValue("""{"array": "string", "extra": 1}""")))
        assertNull(MilanoType.fromDescriptor(jsonValue("""{"record": {"1bad": "int"}}""")))
    }

    @Test
    fun nullSatisfiesOptionalOnly() {
        assertEquals(
            MilanoValue.Null,
            MilanoType(MilanoType.Kind.Text, optional = true).validated(MilanoValue.Null),
        )
        assertNull(MilanoType(MilanoType.Kind.Text).validated(MilanoValue.Null))
    }

    @Test
    fun intPromotesToDoubleNeverTheReverse() {
        assertEquals(
            MilanoValue.DoubleValue(5.0),
            MilanoType(MilanoType.Kind.Double).validated(MilanoValue.IntValue(5)),
        )
        assertNull(MilanoType(MilanoType.Kind.Int).validated(MilanoValue.DoubleValue(5.0)))
    }

    @Test
    fun recordsValidateShapeExactly() {
        val recordType =
            MilanoType(
                MilanoType.Kind.Record(
                    mapOf(
                        "name" to MilanoType(MilanoType.Kind.Text),
                        "phone" to MilanoType(MilanoType.Kind.Text, optional = true),
                    ),
                ),
            )

        assertEquals(
            MilanoValue.RecordValue(mapOf("name" to MilanoValue.StringValue("Ada"), "phone" to MilanoValue.StringValue("555"))),
            recordType.validated(
                MilanoValue.RecordValue(
                    mapOf("name" to MilanoValue.StringValue("Ada"), "phone" to MilanoValue.StringValue("555")),
                ),
            ),
        )

        // Missing optional field canonicalizes to null.
        assertEquals(
            MilanoValue.RecordValue(mapOf("name" to MilanoValue.StringValue("Ada"), "phone" to MilanoValue.Null)),
            recordType.validated(MilanoValue.RecordValue(mapOf("name" to MilanoValue.StringValue("Ada")))),
        )

        // Missing required field and undeclared field are mismatches.
        assertNull(recordType.validated(MilanoValue.RecordValue(mapOf("phone" to MilanoValue.StringValue("555")))))
        assertNull(
            recordType.validated(
                MilanoValue.RecordValue(mapOf("name" to MilanoValue.StringValue("Ada"), "extra" to MilanoValue.IntValue(1))),
            ),
        )
    }

    @Test
    fun arraysValidateElements() {
        val arrayType = MilanoType(MilanoType.Kind.Array(MilanoType(MilanoType.Kind.Double)))
        assertEquals(
            MilanoValue.ArrayValue(listOf(MilanoValue.DoubleValue(1.0), MilanoValue.DoubleValue(2.5))),
            arrayType.validated(MilanoValue.ArrayValue(listOf(MilanoValue.IntValue(1), MilanoValue.DoubleValue(2.5)))),
        )
        assertNull(arrayType.validated(MilanoValue.ArrayValue(listOf(MilanoValue.StringValue("x")))))
    }

    @Test
    fun identifierGrammar() {
        assertTrue(MilanoIdentifier.isValid("Banner"))
        assertTrue(MilanoIdentifier.isValid("a_1"))
        assertFalse(MilanoIdentifier.isValid("\$repeat"))
        assertFalse(MilanoIdentifier.isValid("1bad"))
        assertFalse(MilanoIdentifier.isValid(""))
        assertFalse(MilanoIdentifier.isValid("with-dash"))
    }
}
