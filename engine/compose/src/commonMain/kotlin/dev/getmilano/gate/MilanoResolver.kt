package dev.getmilano

/** A node with every property expression evaluated: what renderers see. */
internal class ResolvedNode(
    val type: String,
    val reference: String,
    val isPlaceholder: Boolean,
    val rawSubtree: MilanoValue?,
    val values: Map<String, MilanoValue>,
    val children: List<ResolvedNode>,
)

/**
 * Full re-evaluation, per the v1 strategy: every resolution walks the whole
 * tree. Evaluation is total; division by zero and saturation report through
 * the occurrence pipeline, attributed to the owning node.
 */
internal object MilanoResolver {
    fun resolve(
        node: BuiltNode,
        state: Map<String, MilanoValue>,
        context: Map<String, MilanoValue>,
        report: (MilanoOccurrence.Kind, String) -> Unit,
    ): ResolvedNode {
        val values = LinkedHashMap<String, MilanoValue>()
        for ((name, value) in node.properties) {
            values[name] =
                when (value) {
                    is DocValue.Literal -> {
                        value.value
                    }

                    is DocValue.TypedExpression -> {
                        val evaluator =
                            ExprEvaluator(state, context, event = null) { kind ->
                                report(kind, node.reference)
                            }
                        val result = evaluator.evaluate(value.expr)
                        // Canonicalize toward the declared type (int where double
                        // is declared).
                        value.expected.validated(result) ?: result
                    }

                    // Unreachable: the gate types every expression.
                    is DocValue.Expression -> {
                        MilanoValue.Null
                    }
                }
        }
        return ResolvedNode(
            type = node.type,
            reference = node.reference,
            isPlaceholder = node.isPlaceholder,
            rawSubtree = node.rawSubtree,
            values = values,
            children = node.children.map { resolve(it, state, context, report) },
        )
    }
}
