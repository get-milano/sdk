package dev.getmilano

/**
 * The one identifier grammar for component types, properties, events,
 * actions, and state and context keys: a letter followed by letters,
 * digits, or underscores. Case-sensitive; never starts with `$`.
 */
internal object MilanoIdentifier {
    fun isValid(name: String): Boolean {
        if (name.isEmpty()) return false
        val first = name[0]
        if (first !in 'a'..'z' && first !in 'A'..'Z') return false
        return name.drop(1).all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' }
    }
}
