package dev.getmilano

/**
 * The closed set of typed errors the gate can throw, per the document
 * model spec. Every error carries structured detail; the diagnostic
 * message is non-normative.
 */
sealed class MilanoBuildException(
    message: String,
) : Exception(message) {
    /** Input is not well-formed JSON or violates envelope structure. */
    class MalformedDocument(
        val detail: String,
    ) : MilanoBuildException("malformed document: $detail")

    /** The declared version is above what the runtime implements. */
    class UnsupportedVersion(
        val declared: String,
        /** The supported ranges as `major.minor`: "1.0", "2.0". */
        val supported: List<String>,
    ) : MilanoBuildException("unsupported contract version $declared; supported: ${supported.joinToString()}")

    /**
     * Vocabulary, typing, action encoding, event, id, or namespace rules
     * violated; supplied context or initial-state values not matching
     * declarations.
     */
    class SchemaViolation(
        val rule: String,
        val node: String? = null,
        val expected: String? = null,
        val found: String? = null,
    ) : MilanoBuildException("schema violation ($rule) at ${node ?: "-"}: expected ${expected ?: "-"}, found ${found ?: "-"}")

    /** A type not declared in the vocabulary, under the *fail* policy. */
    class UnknownComponentType(
        val node: String,
        val unknownType: String,
    ) : MilanoBuildException("unknown component type $unknownType at $node")

    /** A resource limit exceeded at the gate. */
    class LimitExceeded(
        val limit: String,
        val value: Int,
        val actual: Int,
    ) : MilanoBuildException("limit $limit exceeded: $actual > $value")

    /** The error as comparable fields, used by the conformance driver. */
    fun fields(): Map<String, MilanoValue> =
        when (this) {
            is MalformedDocument -> {
                mapOf(
                    "type" to MilanoValue.StringValue("MalformedDocument"),
                    "detail" to MilanoValue.StringValue(detail),
                )
            }

            is UnsupportedVersion -> {
                mapOf(
                    "type" to MilanoValue.StringValue("UnsupportedVersion"),
                    "declared" to MilanoValue.StringValue(declared),
                    "supported" to MilanoValue.ArrayValue(supported.map { MilanoValue.StringValue(it) }),
                )
            }

            is SchemaViolation -> {
                buildMap {
                    put("type", MilanoValue.StringValue("SchemaViolation"))
                    put("rule", MilanoValue.StringValue(rule))
                    node?.let { put("node", MilanoValue.StringValue(it)) }
                    expected?.let { put("expected", MilanoValue.StringValue(it)) }
                    found?.let { put("found", MilanoValue.StringValue(it)) }
                }
            }

            is UnknownComponentType -> {
                mapOf(
                    "type" to MilanoValue.StringValue("UnknownComponentType"),
                    "node" to MilanoValue.StringValue(node),
                    "unknownType" to MilanoValue.StringValue(unknownType),
                )
            }

            is LimitExceeded -> {
                mapOf(
                    "type" to MilanoValue.StringValue("LimitExceeded"),
                    "limit" to MilanoValue.StringValue(limit),
                    "value" to MilanoValue.IntValue(value.toLong()),
                    "actual" to MilanoValue.IntValue(actual.toLong()),
                )
            }
        }
}
