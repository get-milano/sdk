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
        while consume(".") {
            guard case .identifier(let field) = tokens[position] else {
                throw ExprError(detail: "expected field name after '.'")
            }
            position += 1
            expr = .member(expr, field)
        }
        return expr
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
            if consume("(") {
                var arguments: [Expr] = []
                if !consume(")") {
                    repeat {
                        arguments.append(try expression())
                    } while consume(",")
                    guard consume(")") else { throw ExprError(detail: "expected ')'") }
                }
                return .call(name, arguments)
            }
            return .root(name)
        case .punct("("):
            position += 1
            let expr = try expression()
            guard consume(")") else { throw ExprError(detail: "expected ')'") }
            return expr
        default:
            throw ExprError(detail: "unexpected token")
        }
    }

    private mutating func consume(_ punct: String) -> Bool {
        if tokens[position] == .punct(punct) {
            position += 1
            return true
        }
        return false
    }
}
