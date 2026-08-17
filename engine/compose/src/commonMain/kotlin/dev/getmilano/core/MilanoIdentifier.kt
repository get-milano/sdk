package dev.getmilano

/**
 * Unicode scalar count, in pure Kotlin: surrogate pairs count once. The
 * document model's lengths (expression limit, `length()`) are defined in
 * scalars, never UTF-16 units or grapheme clusters.
 */
internal fun String.unicodeScalarCount(): Int {
    var count = 0
    var index = 0
    while (index < length) {
        val c = this[index]
        index +=
            if (c.isHighSurrogate() && index + 1 < length &&
                this[index + 1].isLowSurrogate()
            ) {
                2
            } else {
                1
            }
        count++
    }
    return count
}

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
