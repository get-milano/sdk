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

/** A parsed action, per the document model spec's action encoding. */
internal sealed class ActionSpec {
    data class Set(
        val key: String,
        val value: DocValue,
    ) : ActionSpec()

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
)

/** A parsed document: structure and declarations only, never data values. */
internal class ParsedDocument(
    val versionString: String,
    val major: Int,
    val minor: Int,
    val contextDeclarations: Map<String, MilanoType>,
    val stateDeclarations: Map<String, MilanoType>,
    val localActions: Map<String, MilanoVocabulary.Action>,
    val root: RawNode,
    val metadata: MilanoValue?,
)
