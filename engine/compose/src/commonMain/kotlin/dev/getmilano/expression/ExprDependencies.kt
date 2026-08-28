package dev.getmilano

/**
 * The state and context keys the expression reads, as `state.<key>` and
 * `context.<key>`. A record field access counts as reading the whole key:
 * `state.address.city` depends on `state.address`. Computed once per
 * expression at build; it is what lets an update re-evaluate only what
 * reads a key whose value changed.
 */
internal fun Expr.dependencies(): Set<String> {
    val keys = LinkedHashSet<String>()
    collectDependencies(keys)
    return keys
}

private fun Expr.collectDependencies(keys: MutableSet<String>) {
    when (this) {
        is Expr.Member -> {
            val root = base
            if (root is Expr.Root && (root.name == "state" || root.name == "context")) {
                keys.add("${root.name}.$field")
            } else {
                base.collectDependencies(keys)
            }
        }

        is Expr.Call -> {
            for (argument in arguments) argument.collectDependencies(keys)
        }

        is Expr.Unary -> {
            operand.collectDependencies(keys)
        }

        is Expr.Binary -> {
            left.collectDependencies(keys)
            right.collectDependencies(keys)
        }

        else -> {}
    }
}
