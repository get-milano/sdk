package dev.getmilano

/**
 * A document value: a literal of the type system, an unchecked expression
 * (the `$expr` wrapper, straight from parsing), or a gate-checked
 * expression carrying its AST and the declared type it must produce.
 */
internal sealed class DocValue {
    data class Literal(
        val value: MilanoValue,
    ) : DocValue()

    data class Expression(
        val source: String,
    ) : DocValue()

    data class TypedExpression(
        val source: String,
        val expr: Expr,
        val expected: MilanoType,
    ) : DocValue()
}

/**
 * A validated action that writes one state key: `$set`, or one of the
 * array actions once the gate has typed it. What the view's mutation path
 * takes (state and actions spec, Action execution).
 */
internal sealed interface StateMutation {
    val key: String
}

/** A parsed action, per the document model spec's action encoding. */
internal sealed class ActionSpec {
    data class Set(
        override val key: String,
        val value: DocValue,
    ) : ActionSpec(),
        StateMutation

    /**
     * An array action as parsed, before the gate (contract 2.1): every
     * parameter as the document carried it (null when absent), plus the
     * keys the action does not take. The gate replaces it by one of the
     * three validated kinds below.
     */
    data class ArrayAction(
        /** `$append`, `$remove`, or `$update`. */
        val name: String,
        val key: String?,
        val at: DocValue?,
        val field: String?,
        /** The kind of a `field` that is present but not a string. */
        val fieldFound: String?,
        val value: DocValue?,
        /** The keys the action does not take, sorted. */
        val extra: List<String>,
    ) : ActionSpec() {
        companion object {
            /** Each array action's parameters, in the lexicographic order the walk visits them. */
            val PARAMETERS: Map<String, List<String>> =
                mapOf(
                    "\$append" to listOf("key", "value"),
                    "\$remove" to listOf("at", "key"),
                    "\$update" to listOf("at", "field", "key", "value"),
                )
        }
    }

    data class Append(
        override val key: String,
        val value: DocValue,
    ) : ActionSpec(),
        StateMutation

    data class Remove(
        override val key: String,
        val at: DocValue,
    ) : ActionSpec(),
        StateMutation

    data class Update(
        override val key: String,
        val at: DocValue,
        val field: String,
        val value: DocValue,
    ) : ActionSpec(),
        StateMutation

    data class Sequence(
        val actions: List<ActionSpec>,
    ) : ActionSpec()

    data class When(
        val condition: DocValue,
        val then: List<ActionSpec>,
        val otherwise: List<ActionSpec>,
    ) : ActionSpec()

    data class Custom(
        val name: String,
        val parameters: Map<String, DocValue>,
        val onSuccess: List<ActionSpec>,
        val onFailure: List<ActionSpec>,
        /** Declared success result type, resolved by the gate; null until then. */
        val result: MilanoType? = null,
        /** Declared failure payload type, resolved by the gate; null until then. */
        val failure: MilanoType? = null,
    ) : ActionSpec()
}

/** A parsed node envelope, before vocabulary validation. */
internal class RawNode(
    val type: String,
    val id: String?,
    val properties: Map<String, DocValue>,
    val children: List<RawNode>,
    val events: Map<String, List<ActionSpec>>,
    /** The node's whole subtree as raw data, kept for the placeholder policy. */
    val raw: MilanoValue,
    /** Present exactly when [type] is `$repeat`. */
    val repeatSpec: RepeatSpec? = null,
    /** Present exactly when [type] is `${'$'}if`. */
    val conditionalSpec: ConditionalSpec? = null,
    /** Present exactly when [type] is `${'$'}switch`. */
    val switchSpec: SwitchSpec? = null,
)

/**
 * The `${'$'}switch` construct's own keys, as parsed: the enum subject and one
 * node list per member, plus the list every uncovered member takes.
 */
internal class SwitchSpec(
    val subject: DocValue?,
    val cases: Map<String, List<RawNode>>?,
    val fallback: List<RawNode>?,
    val hasFallback: Boolean,
    /** Keys the construct does not declare, so the gate can name one. */
    val undeclared: List<String>,
)

/**
 * The `${'$'}if` construct's own keys, as parsed: the condition (a value the
 * gate requires to be a bool expression) and the two branches. A branch
 * absent is null and one written empty is an empty list: the first is how
 * a document says nothing happens, the second is an encoding violation.
 */
internal class ConditionalSpec(
    val condition: DocValue?,
    val then: List<RawNode>?,
    val otherwise: List<RawNode>?,
    /** Keys the construct does not declare, so the gate can name one. */
    val undeclared: List<String>,
)

/**
 * The `$repeat` construct's own keys, as parsed: `items` (a value, which
 * the gate requires to be an array expression), `as` (the binding name),
 * and `key` (contract 2.1: a value the gate requires to be a string or
 * int expression). Null where the document omitted them; the gate reports.
 */
internal class RepeatSpec(
    val items: DocValue?,
    val alias: String?,
    val key: DocValue? = null,
)

/** Parses "major.minor.patch" into a comparable triple; null when malformed. */
internal fun parseSemver(text: String): Triple<Int, Int, Int>? {
    val parts = text.split(".")
    if (parts.size != 3) return null
    val numbers = parts.map { it.toIntOrNull() ?: return null }
    if (numbers.any { it < 0 }) return null
    return Triple(numbers[0], numbers[1], numbers[2])
}

internal operator fun Triple<Int, Int, Int>.compareTo(other: Triple<Int, Int, Int>): Int =
    compareValuesBy(this, other, { it.first }, { it.second }, { it.third })

/**
 * The document's optional vocabulary requirement, checked at the gate
 * against the engine's vocabulary (name equality, version at least min).
 */
internal class VocabularyRequirement(
    val name: String,
    val min: String?,
)

/** A parsed document: structure and declarations only, never data values. */
internal class ParsedDocument(
    val versionString: String,
    val major: Int,
    val minor: Int,
    val vocabularyRequirement: VocabularyRequirement?,
    val contextDeclarations: Map<String, MilanoType>,
    val stateDeclarations: Map<String, MilanoType>,
    val root: RawNode,
    val metadata: MilanoValue?,
    /**
     * The document's lifecycle bindings (contract 2.1), as parsed: signal
     * name to action list. The gate rules on the names.
     */
    val lifecycle: Map<String, List<ActionSpec>> = emptyMap(),
    /** Whether the document carried an `on` section at all, for gating. */
    val hasLifecycle: Boolean = false,
    /**
     * The document's watch bindings (contract 2.1), as parsed: state key
     * to action list. The gate rules on the keys.
     */
    val watch: Map<String, List<ActionSpec>> = emptyMap(),
    /** Whether the document carried a `watch` section at all, for gating. */
    val hasWatch: Boolean = false,
)
