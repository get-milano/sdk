package dev.getmilano

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The single representation for every value crossing a Milano boundary:
 * resolved properties into renderers, event payloads out of them, action
 * parameters into handlers, context and state values in from the host.
 *
 * Mirrors the document type system exactly: bool, int (64-bit), double
 * (IEEE 754 binary64), string, array, record, null.
 */
sealed class MilanoValue {
    data object Null : MilanoValue()

    data class BoolValue(
        val value: Boolean,
    ) : MilanoValue()

    data class IntValue(
        val value: Long,
    ) : MilanoValue()

    data class DoubleValue(
        val value: Double,
    ) : MilanoValue()

    data class StringValue(
        val value: String,
    ) : MilanoValue()

    data class ArrayValue(
        val values: List<MilanoValue>,
    ) : MilanoValue()

    data class RecordValue(
        val values: Map<String, MilanoValue>,
    ) : MilanoValue()

    val isNull: Boolean get() = this is Null
    val boolOrNull: Boolean? get() = (this as? BoolValue)?.value
    val intOrNull: Long? get() = (this as? IntValue)?.value
    val doubleOrNull: Double? get() = (this as? DoubleValue)?.value
    val stringOrNull: String? get() = (this as? StringValue)?.value
    val arrayOrNull: List<MilanoValue>? get() = (this as? ArrayValue)?.values
    val recordOrNull: Map<String, MilanoValue>? get() = (this as? RecordValue)?.values

    companion object {
        /**
         * Builds a value from a kotlinx JsonElement.
         *
         * JSON numbers written without a fractional part become int; numbers
         * written with one become double. This distinction is what makes
         * "a JSON number with a fractional part never satisfies an int
         * declaration" checkable.
         */
        fun fromJson(element: JsonElement): MilanoValue? =
            when (element) {
                is JsonNull -> {
                    Null
                }

                is JsonPrimitive -> {
                    if (element.isString) {
                        StringValue(element.content)
                    } else {
                        when (element.content) {
                            "true" -> {
                                BoolValue(true)
                            }

                            "false" -> {
                                BoolValue(false)
                            }

                            else -> {
                                element.content.toLongOrNull()?.let { IntValue(it) }
                                    ?: element.content.toDoubleOrNull()?.let { DoubleValue(it) }
                            }
                        }
                    }
                }

                is JsonArray -> {
                    val values = ArrayList<MilanoValue>(element.size)
                    for (child in element) {
                        values.add(fromJson(child) ?: return null)
                    }
                    ArrayValue(values)
                }

                is JsonObject -> {
                    val values = LinkedHashMap<String, MilanoValue>(element.size)
                    for ((key, child) in element) {
                        values[key] = fromJson(child) ?: return null
                    }
                    RecordValue(values)
                }
            }
    }
}
