import Foundation

struct ExprParser {
    private var tokens: [Token]
    private var position = 0

    static func parse(_ source: String) throws -> Expr {
        var lexer = Lexer(source)
        var parser = ExprParser(tokens: try lexer.tokens())
        let expr = try parser.expression()
        guard parser.tokens[parser.position] == .end else {
            throw ExprError(detail: "unexpected trailing tokens")
        }
        return expr
    }

    private init(tokens: [Token]) {
        self.tokens = tokens
    }

    private mutating func expression() throws -> Expr {
        try coalesce()
    }

    /// Right-associative.
    private mutating func coalesce() throws -> Expr {
        let left = try or()
        if consume("??") {
            return .binary(.coalesce, left, try coalesce())
        }
        return left
    }

    private mutating func or() throws -> Expr {
        var left = try and()
        while consume("||") { left = .binary(.or, left, try and()) }
        return left
    }

    private mutating func and() throws -> Expr {
        var left = try equality()
        while consume("&&") { left = .binary(.and, left, try equality()) }
        return left
    }

    private mutating func equality() throws -> Expr {
        var left = try comparison()
        while true {
            if consume("==") {
                left = .binary(.equal, left, try comparison())
            } else if consume("!=") {
                left = .binary(.notEqual, left, try comparison())
            } else {
                return left
            }
        }
    }

    private mutating func comparison() throws -> Expr {
        var left = try additive()
        while true {
            if consume("<=") {
                left = .binary(.lessEqual, left, try additive())
            } else if consume(">=") {
                left = .binary(.greaterEqual, left, try additive())
            } else if consume("<") {
                left = .binary(.less, left, try additive())
            } else if consume(">") {
                left = .binary(.greater, left, try additive())
            } else {
                return left
            }
        }
    }

    private mutating func additive() throws -> Expr {
        var left = try multiplicative()
        while true {
            if consume("+") {
                left = .binary(.add, left, try multiplicative())
            } else if consume("-") {
                left = .binary(.subtract, left, try multiplicative())
            } else {
                return left
            }
        }
    }

    private mutating func multiplicative() throws -> Expr {
        var left = try unary()
        while true {
            if consume("*") {
                left = .binary(.multiply, left, try unary())
            } else if consume("/") {
                left = .binary(.divide, left, try unary())
            } else if consume("%") {
                left = .binary(.modulo, left, try unary())
            } else {
                return left
            }
        }
    }

    private mutating func unary() throws -> Expr {
        if consume("!") { return .unary(.not, try unary()) }
        if consume("-") { return .unary(.negate, try unary()) }
        return try postfix()
    }

    private mutating func postfix() throws -> Expr {
        var expr = try primary()
        while true {
            if consume(".") {
                guard case .identifier(let field) = tokens[position] else {
                    throw ExprError(detail: "expected field name after '.'")
                }
                position += 1
                expr = .member(expr, field)
            } else if consume("[") {
                // A lookup: the key is an expression, so the member is
                // chosen at evaluation rather than written in the document.
                let key = try expression()
                guard consume("]") else { throw ExprError(detail: "expected ']'") }
                expr = .lookup(expr, key)
            } else {
                return expr
            }
        }
    }

    private mutating func primary() throws -> Expr {
        switch tokens[position] {
        case .intLiteral(let value):
            position += 1
            return .intLiteral(value)
        case .doubleLiteral(let value):
            position += 1
            return .doubleLiteral(value)
        case .stringLiteral(let value):
            position += 1
            return .stringLiteral(value)
        case .identifier(let name):
            position += 1
            switch name {
            case "true": return .boolLiteral(true)
            case "false": return .boolLiteral(false)
            case "null": return .nullLiteral
            default: break
            }
            // A bare name in call position is a host function the surface
            // declares; anywhere else it is a root.
            if at("(") { return .call(name, try arguments()) }
            return .root(name)
        case .builtin(let name):
            position += 1
            // A built-in is a function: its name is never a value.
            guard at("(") else {
                throw ExprError(detail: "'\(name)' is a function and needs arguments")
            }
            return .call(name, try arguments())
        case .punct("("):
            position += 1
            let expr = try expression()
            guard consume(")") else { throw ExprError(detail: "expected ')'") }
            return expr
        default:
            throw ExprError(detail: "unexpected token")
        }
    }

    /// The parenthesized argument list of a call, the `(` still unconsumed.
    private mutating func arguments() throws -> [Expr] {
        position += 1
        var arguments: [Expr] = []
        if !at(")") {
            repeat {
                arguments.append(try expression())
            } while consume(",")
        }
        guard consume(")") else { throw ExprError(detail: "expected ')'") }
        return arguments
    }

    private func at(_ punct: String) -> Bool {
        tokens[position] == .punct(punct)
    }

    private mutating func consume(_ punct: String) -> Bool {
        if tokens[position] == .punct(punct) {
            position += 1
            return true
        }
        return false
    }
}
