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
 * The UTF-16 offset of scalar number [scalar], clamped into the string.
 * The contract indexes strings by Unicode scalar, so a surrogate pair is
 * one position and no slice ever splits one.
 */
internal fun String.offsetOfScalar(scalar: Int): Int {
    if (scalar <= 0) return 0
    var seen = 0
    var index = 0
    while (index < length && seen < scalar) {
        val c = this[index]
        index +=
            if (c.isHighSurrogate() && index + 1 < length && this[index + 1].isLowSurrogate()) {
                2
            } else {
                1
            }
        seen += 1
    }
    return index
}

/** The scalars from [from] up to, not including, [to], both clamped. */
internal fun String.scalarSlice(
    from: Int,
    to: Int,
): String {
    val count = unicodeScalarCount()
    val start = from.coerceIn(0, count)
    val end = to.coerceIn(0, count)
    if (start >= end) return ""
    return substring(offsetOfScalar(start), offsetOfScalar(end))
}

/** The scalar index where [needle] first occurs, or -1. */
internal fun String.scalarIndexOf(needle: String): Int {
    val units = indexOf(needle)
    if (units < 0) return -1
    return substring(0, units).unicodeScalarCount()
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
