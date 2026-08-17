import Testing

@testable import MilanoSDK

/// Direct battery over the Milano double format at values the expression
/// grammar cannot write as literals: extremes, signed zero, and the
/// carry-on-round shapes. The conformance suite covers the same territory
/// through state values; this pins the formatter in isolation.
struct TextFormatTests {

    @Test func milanoDoubleFormatBattery() {
        let cases: [(Double, String)] = [
            (0.0, "0.0"),
            (-0.0, "-0.0"),
            (5.0, "5.0"),
            (0.1, "0.1"),
            (1.0 / 3.0, "0.3333333333333333"),
            (1e15, "1000000000000000.0"),
            (1e16, "1e16"),
            (0.0001, "0.0001"),
            (0.00001, "1e-5"),
            (5e-324, "5e-324"),                              // smallest subnormal
            (Double.greatestFiniteMagnitude, "1.7976931348623157e308"),
            (1e23, "1e23"),                                  // carry on rounding
            (9223372036854775807.0 / 10.0, "9.223372036854776e17"),
            (-123.456, "-123.456"),
            (Double.infinity, "inf"),
            (-Double.infinity, "-inf"),
            (Double.nan, "nan")
        ]
        for (value, expected) in cases {
            #expect(MilanoDoubleFormat.format(value) == expected,
                    "format(\(value)) == \(MilanoDoubleFormat.format(value)), wanted \(expected)")
        }
    }
}
