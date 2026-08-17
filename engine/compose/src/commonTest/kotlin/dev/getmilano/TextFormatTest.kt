package dev.getmilano

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Direct battery over the Milano double format at values the expression
 * grammar cannot write as literals: extremes, signed zero, and the
 * carry-on-round shapes. The conformance suite covers the same territory
 * through state values; this pins the formatter in isolation, including
 * the shortest-digits search that the platform toString cannot provide.
 */
class TextFormatTest {
    @Test
    fun milanoDoubleFormatBattery() {
        val cases =
            listOf(
                0.0 to "0.0",
                -0.0 to "-0.0",
                5.0 to "5.0",
                0.1 to "0.1",
                (1.0 / 3.0) to "0.3333333333333333",
                1e15 to "1000000000000000.0",
                1e16 to "1e16",
                0.0001 to "0.0001",
                0.00001 to "1e-5",
                // smallest subnormal
                Double.MIN_VALUE to "5e-324",
                Double.MAX_VALUE to "1.7976931348623157e308",
                // carry on rounding
                1e23 to "1e23",
                (9223372036854775807.0 / 10.0) to "9.223372036854776e17",
                -123.456 to "-123.456",
                Double.POSITIVE_INFINITY to "inf",
                Double.NEGATIVE_INFINITY to "-inf",
                Double.NaN to "nan",
            )
        for ((value, expected) in cases) {
            assertEquals(expected, MilanoDoubleFormat.format(value), "format($value)")
        }
    }
}
