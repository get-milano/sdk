import Foundation

/// The one identifier grammar for component types, properties, events,
/// actions, and state and context keys: a letter followed by letters,
/// digits, or underscores. Case-sensitive; never starts with `$`.
enum MilanoIdentifier {
    static func isValid(_ name: String) -> Bool {
        guard let first = name.unicodeScalars.first else { return false }
        guard (first >= "a" && first <= "z") || (first >= "A" && first <= "Z") else { return false }
        return name.unicodeScalars.dropFirst().allSatisfy { scalar in
            (scalar >= "a" && scalar <= "z") || (scalar >= "A" && scalar <= "Z")
                || (scalar >= "0" && scalar <= "9") || scalar == "_"
        }
    }
}
