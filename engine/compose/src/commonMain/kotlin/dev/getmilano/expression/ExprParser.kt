package dev.getmilano

// Lexer

private sealed class Token {
    data class Identifier(
        val name: String,
    ) : Token()

    data class IntLit(
        val value: Long,
    ) : Token()

    data class DoubleLit(
        val value: Double,
    ) : Token()

    data class StringLit(
        val value: String,
    ) : Token()

    data class Punct(
        val text: String,
    ) : Token()

    data object End : Token()
}

private class Lexer(
    source: String,
) {
    private val chars = source.toCharArray()
    private var position = 0

    fun tokens(): List<Token> {
        val result = ArrayList<Token>()
        while (true) {
            val token = next()
            result.add(token)
            if (token is Token.End) return result
        }
    }

    private fun next(): Token {
        while (position < chars.size && (chars[position] == ' ' || chars[position] == '\t')) {
            position += 1
        }
        if (position >= chars.size) return Token.End
        val c = chars[position]

        if (isLetter(c)) {
            val start = position
            while (position < chars.size &&
                (isLetter(chars[position]) || isDigit(chars[position]) || chars[position] == '_')
            ) {
                position += 1
            }
            return Token.Identifier(String(chars, start, position - start))
        }

        if (isDigit(c)) {
            val start = position
            while (position < chars.size && isDigit(chars[position])) position += 1
            if (position + 1 < chars.size && chars[position] == '.' && isDigit(chars[position + 1])) {
                position += 1
                while (position < chars.size && isDigit(chars[position])) position += 1
                val text = String(chars, start, position - start)
                return Token.DoubleLit(text.toDoubleOrNull() ?: throw ExprException("invalid double literal"))
            }
            val text = String(chars, start, position - start)
            return Token.IntLit(text.toLongOrNull() ?: throw ExprException("int literal outside 64-bit range"))
        }

        if (c == '\'') {
            position += 1
            val builder = StringBuilder()
            while (position < chars.size) {
                when (val s = chars[position]) {
                    '\\' -> {
                        if (position + 1 >= chars.size) throw ExprException("unterminated escape")
                        val escaped = chars[position + 1]
                        if (escaped != '\'' && escaped != '\\') throw ExprException("invalid escape")
                        builder.append(escaped)
                        position += 2
                    }

                    '\'' -> {
                        position += 1
                        return Token.StringLit(builder.toString())
                    }

                    else -> {
                        builder.append(s)
                        position += 1
                    }
                }
            }
            throw ExprException("unterminated string literal")
        }

        for (op in listOf("??", "==", "!=", "<=", ">=", "&&", "||")) {
            if (matches(op)) {
                position += 2
                return Token.Punct(op)
            }
        }
        for (op in listOf("!", "-", "+", "*", "/", "%", "<", ">", ".", ",", "(", ")")) {
            if (c.toString() == op) {
                position += 1
                return Token.Punct(op)
            }
        }
        throw ExprException("unexpected character '$c'")
    }

    private fun matches(op: String): Boolean {
        if (position + op.length > chars.size) return false
        for (i in op.indices) {
            if (chars[position + i] != op[i]) return false
        }
        return true
    }

    private fun isLetter(c: Char) = c in 'a'..'z' || c in 'A'..'Z'

    private fun isDigit(c: Char) = c in '0'..'9'
}

// Parser

internal object ExprParser {
    fun parse(source: String): Expr {
        val parser = Parser(Lexer(source).tokens())
        val expr = parser.expression()
        if (parser.current() !is Token.End) throw ExprException("unexpected trailing tokens")
        return expr
    }
}

private class Parser(
    private val tokens: List<Token>,
) {
    private var position = 0

    fun current(): Token = tokens[position]

    fun expression(): Expr = coalesce()

    /** Right-associative. */
    private fun coalesce(): Expr {
        val left = or()
        if (consume("??")) return Expr.Binary(BinaryOp.COALESCE, left, coalesce())
        return left
    }

    private fun or(): Expr {
        var left = and()
        while (consume("||")) left = Expr.Binary(BinaryOp.OR, left, and())
        return left
    }

    private fun and(): Expr {
        var left = equality()
        while (consume("&&")) left = Expr.Binary(BinaryOp.AND, left, equality())
        return left
    }

    private fun equality(): Expr {
        var left = comparison()
        while (true) {
            left =
                when {
                    consume("==") -> Expr.Binary(BinaryOp.EQUAL, left, comparison())
                    consume("!=") -> Expr.Binary(BinaryOp.NOT_EQUAL, left, comparison())
                    else -> return left
                }
        }
    }

    private fun comparison(): Expr {
        var left = additive()
        while (true) {
            left =
                when {
                    consume("<=") -> Expr.Binary(BinaryOp.LESS_EQUAL, left, additive())
                    consume(">=") -> Expr.Binary(BinaryOp.GREATER_EQUAL, left, additive())
                    consume("<") -> Expr.Binary(BinaryOp.LESS, left, additive())
                    consume(">") -> Expr.Binary(BinaryOp.GREATER, left, additive())
                    else -> return left
                }
        }
    }

    private fun additive(): Expr {
        var left = multiplicative()
        while (true) {
            left =
                when {
                    consume("+") -> Expr.Binary(BinaryOp.ADD, left, multiplicative())
                    consume("-") -> Expr.Binary(BinaryOp.SUBTRACT, left, multiplicative())
                    else -> return left
                }
        }
    }

    private fun multiplicative(): Expr {
        var left = unary()
        while (true) {
            left =
                when {
                    consume("*") -> Expr.Binary(BinaryOp.MULTIPLY, left, unary())
                    consume("/") -> Expr.Binary(BinaryOp.DIVIDE, left, unary())
                    consume("%") -> Expr.Binary(BinaryOp.MODULO, left, unary())
                    else -> return left
                }
        }
    }

    private fun unary(): Expr =
        when {
            consume("!") -> Expr.Unary(UnaryOp.NOT, unary())
            consume("-") -> Expr.Unary(UnaryOp.NEGATE, unary())
            else -> postfix()
        }

    private fun postfix(): Expr {
        var expr = primary()
        while (consume(".")) {
            val field =
                (current() as? Token.Identifier)?.name
                    ?: throw ExprException("expected field name after '.'")
            position += 1
            expr = Expr.Member(expr, field)
        }
        return expr
    }

    private fun primary(): Expr {
        when (val token = current()) {
            is Token.IntLit -> {
                position += 1
                return Expr.IntLiteral(token.value)
            }

            is Token.DoubleLit -> {
                position += 1
                return Expr.DoubleLiteral(token.value)
            }

            is Token.StringLit -> {
                position += 1
                return Expr.StringLiteral(token.value)
            }

            is Token.Identifier -> {
                position += 1
                when (token.name) {
                    "true" -> return Expr.BoolLiteral(true)
                    "false" -> return Expr.BoolLiteral(false)
                    "null" -> return Expr.NullLiteral
                }
                if (consume("(")) {
                    val arguments = ArrayList<Expr>()
                    if (!consume(")")) {
                        do {
                            arguments.add(expression())
                        } while (consume(","))
                        if (!consume(")")) throw ExprException("expected ')'")
                    }
                    return Expr.Call(token.name, arguments)
                }
                return Expr.Root(token.name)
            }

            is Token.Punct -> {
                if (token.text == "(") {
                    position += 1
                    val expr = expression()
                    if (!consume(")")) throw ExprException("expected ')'")
                    return expr
                }
                throw ExprException("unexpected token")
            }

            is Token.End -> {
                throw ExprException("unexpected end of expression")
            }
        }
    }

    private fun consume(punct: String): Boolean {
        val token = current()
        if (token is Token.Punct && token.text == punct) {
            position += 1
            return true
        }
        return false
    }
}
