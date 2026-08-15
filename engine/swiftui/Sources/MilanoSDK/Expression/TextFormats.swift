import Foundation

/// The Unicode White_Space table, shared verbatim by both runtimes.
enum MilanoWhitespace {
    static let scalars: Set<UInt32> = [
        0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x0085, 0x00A0,
        0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
        0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000
    ]
    static func contains(_ scalar: UnicodeScalar) -> Bool {
        scalars.contains(scalar.value)
    }
}

/// The Milano-defined double format: never the platform default.
enum MilanoDoubleFormat {
    static func format(_ value: Double) -> String {
        if value.isNaN { return "nan" }
        if value.isInfinite { return value > 0 ? "inf" : "-inf" }
        if value == 0 { return value.sign == .minus ? "-0.0" : "0.0" }

        let negative = value < 0
        // Shortest round-trip digits from the platform, then re-rendered
        // into the Milano notation.
        var repr = "\(abs(value))"
        var exponent10 = 0
        if let eIndex = repr.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            exponent10 = Int(repr[repr.index(after: eIndex)...].replacingOccurrences(of: "+", with: "")) ?? 0
            repr = String(repr[..<eIndex])
        }
        var digits = repr
        if let dotIndex = repr.firstIndex(of: ".") {
            let fractionCount = repr.distance(from: repr.index(after: dotIndex), to: repr.endIndex)
            digits = repr.replacingOccurrences(of: ".", with: "")
            exponent10 -= fractionCount
        }
        // digits is an integer string; normalize: strip leading zeros, then
        // value = digits * 10^exponent10.
        digits = String(digits.drop(while: { $0 == "0" }))
        while digits.hasSuffix("0") {
            digits.removeLast()
            exponent10 += 1
        }
        // Normalized scientific exponent: d.ddd * 10^E.
        let normalizedExponent = exponent10 + digits.count - 1
        let sign = negative ? "-" : ""

        if normalizedExponent >= -4 && normalizedExponent <= 15 {
            // Plain decimal.
            if exponent10 >= 0 {
                return sign + digits + String(repeating: "0", count: exponent10) + ".0"
            }
            let fractionDigits = -exponent10
            if fractionDigits < digits.count {
                let splitIndex = digits.index(digits.endIndex, offsetBy: -fractionDigits)
                return sign + digits[..<splitIndex] + "." + digits[splitIndex...]
            }
            return sign + "0." + String(repeating: "0", count: fractionDigits - digits.count) + digits
        }
        // Scientific: d[.ddd]e[-]NN.
        let head = String(digits.first!)
        let tail = String(digits.dropFirst())
        let mantissa = tail.isEmpty ? head : "\(head).\(tail)"
        return "\(sign)\(mantissa)e\(normalizedExponent)"
    }
}
