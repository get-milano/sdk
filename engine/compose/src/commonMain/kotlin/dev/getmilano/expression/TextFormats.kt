package dev.getmilano

/** The Unicode White_Space table, shared verbatim by both runtimes. */
internal object MilanoWhitespace {
    private val codes =
        setOf(
            0x0009,
            0x000A,
            0x000B,
            0x000C,
            0x000D,
            0x0020,
            0x0085,
            0x00A0,
            0x1680,
            0x2000,
            0x2001,
            0x2002,
            0x2003,
            0x2004,
            0x2005,
            0x2006,
            0x2007,
            0x2008,
            0x2009,
            0x200A,
            0x2028,
            0x2029,
            0x202F,
            0x205F,
            0x3000,
        )

    fun contains(code: Int): Boolean = code in codes
}

/** The Milano-defined double format: never the platform default. */
internal object MilanoDoubleFormat {
    fun format(value: Double): String {
        if (value.isNaN()) return "nan"
        if (value.isInfinite()) return if (value > 0) "inf" else "-inf"
        if (value == 0.0) return if (1.0 / value < 0) "-0.0" else "0.0"

        val negative = value < 0
        var repr = kotlin.math.abs(value).toString()
        var exponent10 = 0
        val eIndex = repr.indexOfFirst { it == 'e' || it == 'E' }
        if (eIndex >= 0) {
            exponent10 = repr.substring(eIndex + 1).replace("+", "").toIntOrNull() ?: 0
            repr = repr.substring(0, eIndex)
        }
        var digits = repr
        val dotIndex = repr.indexOf('.')
        if (dotIndex >= 0) {
            val fractionCount = repr.length - dotIndex - 1
            digits = repr.replace(".", "")
            exponent10 -= fractionCount
        }
        digits = digits.trimStart('0')
        while (digits.endsWith("0")) {
            digits = digits.dropLast(1)
            exponent10 += 1
        }
        val normalizedExponent = exponent10 + digits.length - 1
        val sign = if (negative) "-" else ""

        if (normalizedExponent in -4..15) {
            return when {
                exponent10 >= 0 -> {
                    sign + digits + "0".repeat(exponent10) + ".0"
                }

                -exponent10 < digits.length -> {
                    val splitIndex = digits.length + exponent10
                    sign + digits.substring(0, splitIndex) + "." + digits.substring(splitIndex)
                }

                else -> {
                    sign + "0." + "0".repeat(-exponent10 - digits.length) + digits
                }
            }
        }
        val mantissa =
            if (digits.length == 1) {
                digits
            } else {
                "${digits[0]}.${digits.substring(1)}"
            }
        return "$sign${mantissa}e$normalizedExponent"
    }
}
