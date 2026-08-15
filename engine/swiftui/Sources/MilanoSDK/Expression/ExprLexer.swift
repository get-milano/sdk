import Foundation

enum Token: Equatable {
    case identifier(String)
    case intLiteral(Int64)
    case doubleLiteral(Double)
    case stringLiteral(String)
    case punct(String)
    case end
}

struct Lexer {
    let scalars: [UnicodeScalar]
    var position = 0

    init(_ source: String) {
        scalars = Array(source.unicodeScalars)
    }

    mutating func tokens() throws -> [Token] {
        var result: [Token] = []
        while true {
            let token = try next()
            result.append(token)
            if token == .end { return result }
        }
    }

    private mutating func next() throws -> Token {
        // Whitespace between tokens: spaces and tabs.
        while position < scalars.count, scalars[position] == " " || scalars[position] == "\t" {
            position += 1
        }
        guard position < scalars.count else { return .end }
        let c = scalars[position]

        if isLetter(c) {
            var name = ""
            while position < scalars.count, isLetter(scalars[position]) || isDigit(scalars[position])
                || scalars[position] == "_" {
                name.unicodeScalars.append(scalars[position])
                position += 1
            }
            return .identifier(name)
        }

        if isDigit(c) {
            var text = ""
            while position < scalars.count, isDigit(scalars[position]) {
                text.unicodeScalars.append(scalars[position])
                position += 1
            }
            if position + 1 < scalars.count, scalars[position] == ".", isDigit(scalars[position + 1]) {
                text.unicodeScalars.append(".")
                position += 1
                while position < scalars.count, isDigit(scalars[position]) {
                    text.unicodeScalars.append(scalars[position])
                    position += 1
                }
                guard let value = Double(text) else { throw ExprError(detail: "invalid double literal") }
                return .doubleLiteral(value)
            }
            guard let value = Int64(text) else {
                throw ExprError(detail: "int literal outside 64-bit range")
            }
            return .intLiteral(value)
        }

        if c == "'" {
            position += 1
            var text = ""
            while position < scalars.count {
                let s = scalars[position]
                if s == "\\" {
                    guard position + 1 < scalars.count else {
                        throw ExprError(detail: "unterminated escape")
                    }
                    let escaped = scalars[position + 1]
                    guard escaped == "'" || escaped == "\\" else {
                        throw ExprError(detail: "invalid escape")
                    }
                    text.unicodeScalars.append(escaped)
                    position += 2
                } else if s == "'" {
                    position += 1
                    return .stringLiteral(text)
                } else {
                    text.unicodeScalars.append(s)
                    position += 1
                }
            }
            throw ExprError(detail: "unterminated string literal")
        }

        // Multi-character operators first.
        for op in ["??", "==", "!=", "<=", ">=", "&&", "||"] where matches(op) {
            position += 2
            return .punct(op)
        }
        for op in ["!", "-", "+", "*", "/", "%", "<", ">", ".", ",", "(", ")"] where String(c) == op {
            position += 1
            return .punct(op)
        }
        throw ExprError(detail: "unexpected character '\(c)'")
    }

    private func matches(_ op: String) -> Bool {
        let opScalars = Array(op.unicodeScalars)
        guard position + opScalars.count <= scalars.count else { return false }
        return Array(scalars[position..<(position + opScalars.count)]) == opScalars
    }

    private func isLetter(_ c: UnicodeScalar) -> Bool {
        (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
    }
    private func isDigit(_ c: UnicodeScalar) -> Bool { c >= "0" && c <= "9" }
}
