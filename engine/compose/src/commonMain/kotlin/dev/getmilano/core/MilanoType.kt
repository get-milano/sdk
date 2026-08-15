package dev.getmilano

/**
 * A type from the document type system: bool, int, double, string,
 * array of T, or record with named typed fields; each optionally optional.
 */
data class MilanoType(
    val kind: Kind,
    val optional: Boolean = false,
) {
    sealed class Kind {
        data object Bool : Kind()

        data object Int : Kind()

        data object Double : Kind()

        data object Text : Kind()

        data class Array(
            val element: MilanoType,
        ) : Kind()

        data class Record(
            val fields: Map<String, MilanoType>,
        ) : Kind()
    }

    /**
     * Validates a value against this type and returns its canonical form,
     * or null on mismatch.
     *
     * Rules, identical in both runtimes:
     * - null is valid only for optional types.
     * - A non-optional value is accepted where the optional of its type is expected.
     * - An int value is accepted where double is declared and is canonicalized
     *   to double (mirroring expression promotion). A double value never
     *   satisfies an int declaration.
     * - Records must match their declared shape exactly: missing non-optional
     *   fields and undeclared fields are mismatches. Missing optional fields
     *   canonicalize to null.
     */
    internal fun validated(value: MilanoValue): MilanoValue? {
        if (value is MilanoValue.Null) {
            return if (optional) MilanoValue.Null else null
        }
        return when (kind) {
            is Kind.Bool -> {
                value.takeIf { it is MilanoValue.BoolValue }
            }

            is Kind.Int -> {
                value.takeIf { it is MilanoValue.IntValue }
            }

            is Kind.Double -> {
                when (value) {
                    is MilanoValue.DoubleValue -> value
                    is MilanoValue.IntValue -> MilanoValue.DoubleValue(value.value.toDouble())
                    else -> null
                }
            }

            is Kind.Text -> {
                value.takeIf { it is MilanoValue.StringValue }
            }

            is Kind.Array -> {
                val elements = (value as? MilanoValue.ArrayValue)?.values ?: return null
                val canonical = ArrayList<MilanoValue>(elements.size)
                for (element in elements) {
                    canonical.add(kind.element.validated(element) ?: return null)
                }
                MilanoValue.ArrayValue(canonical)
            }

            is Kind.Record -> {
                val entries = (value as? MilanoValue.RecordValue)?.values ?: return null
                if (entries.keys.any { it !in kind.fields }) return null // undeclared field
                val canonical = LinkedHashMap<String, MilanoValue>(kind.fields.size)
                for ((name, fieldType) in kind.fields) {
                    val fieldValue = entries[name] ?: MilanoValue.Null
                    canonical[name] = fieldType.validated(fieldValue) ?: return null
                }
                MilanoValue.RecordValue(canonical)
            }
        }
    }

    companion object {
        /**
         * Parses a JSON type descriptor:
         * - a primitive name string, with a trailing `?` for optional ("int", "string?")
         * - {"array": <descriptor>, "optional": <bool>}
         * - {"record": {<field>: <descriptor>}, "optional": <bool>}
         */
        internal fun fromDescriptor(descriptor: MilanoValue): MilanoType? =
            when (descriptor) {
                is MilanoValue.StringValue -> {
                    val optional = descriptor.value.endsWith("?")
                    when (descriptor.value.removeSuffix("?")) {
                        "bool" -> MilanoType(Kind.Bool, optional)
                        "int" -> MilanoType(Kind.Int, optional)
                        "double" -> MilanoType(Kind.Double, optional)
                        "string" -> MilanoType(Kind.Text, optional)
                        else -> null
                    }.takeIf { descriptor.value.count { c -> c == '?' } <= 1 }
                }

                is MilanoValue.RecordValue -> {
                    val entries = descriptor.values
                    val optional =
                        when (val flag = entries["optional"]) {
                            null -> false
                            is MilanoValue.BoolValue -> flag.value
                            else -> return null
                        }
                    val arrayEntry = entries["array"]
                    val recordEntry = entries["record"]
                    when {
                        arrayEntry != null -> {
                            if (!entries.keys.all { it == "array" || it == "optional" }) return null
                            val element = fromDescriptor(arrayEntry) ?: return null
                            MilanoType(Kind.Array(element), optional)
                        }

                        recordEntry is MilanoValue.RecordValue -> {
                            if (!entries.keys.all { it == "record" || it == "optional" }) return null
                            val fields = LinkedHashMap<String, MilanoType>(recordEntry.values.size)
                            for ((name, fieldDescriptor) in recordEntry.values) {
                                if (!MilanoIdentifier.isValid(name)) return null
                                fields[name] = fromDescriptor(fieldDescriptor) ?: return null
                            }
                            MilanoType(Kind.Record(fields), optional)
                        }

                        else -> {
                            null
                        }
                    }
                }

                else -> {
                    null
                }
            }
    }
}
