import type { BinaryOp, Expr } from "./ast.ts";
import { ExprError } from "./ast.ts";
import type { Token } from "./lexer.ts";
import { tokenize } from "./lexer.ts";

const COMPARISON: Readonly<Record<string, BinaryOp>> = {
  "<": "less",
  "<=": "lessEqual",
  ">": "greater",
  ">=": "greaterEqual",
};

const ADDITIVE: Readonly<Record<string, BinaryOp>> = {
  "+": "add",
  "-": "subtract",
};

const MULTIPLICATIVE: Readonly<Record<string, BinaryOp>> = {
  "*": "multiply",
  "/": "divide",
  "%": "modulo",
};

/**
 * Recursive descent over the spec's grammar. Binary operators associate
 * left except `??`, which associates right.
 */
class Parser {
  private readonly tokens: readonly Token[];
  private position = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  parse(): Expr {
    const expression = this.expression();
    if (this.peek().kind !== "end") throw new ExprError("unexpected trailing tokens");
    return expression;
  }

  private peek(): Token {
    return this.tokens[this.position] as Token;
  }

  private atPunct(...values: readonly string[]): string | null {
    const token = this.peek();
    if (token.kind === "punct" && values.includes(token.value)) return token.value;
    return null;
  }

  private take(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private expectPunct(value: string): void {
    const token = this.take();
    if (token.kind !== "punct" || token.value !== value) {
      throw new ExprError(`expected '${value}'`);
    }
  }

  private expression(): Expr {
    return this.coalesce();
  }

  private coalesce(): Expr {
    const left = this.or();
    if (this.atPunct("??") !== null) {
      this.take();
      // Right-associative.
      return { kind: "binary", op: "coalesce", left, right: this.coalesce() };
    }
    return left;
  }

  private or(): Expr {
    let left = this.and();
    while (this.atPunct("||") !== null) {
      this.take();
      left = { kind: "binary", op: "or", left, right: this.and() };
    }
    return left;
  }

  private and(): Expr {
    let left = this.equality();
    while (this.atPunct("&&") !== null) {
      this.take();
      left = { kind: "binary", op: "and", left, right: this.equality() };
    }
    return left;
  }

  private equality(): Expr {
    let left = this.comparison();
    for (;;) {
      const operator = this.atPunct("==", "!=");
      if (operator === null) return left;
      this.take();
      left = {
        kind: "binary",
        op: operator === "==" ? "equal" : "notEqual",
        left,
        right: this.comparison(),
      };
    }
  }

  private comparison(): Expr {
    let left = this.additive();
    for (;;) {
      const operator = this.atPunct("<", "<=", ">", ">=");
      if (operator === null) return left;
      this.take();
      left = {
        kind: "binary",
        op: COMPARISON[operator] as BinaryOp,
        left,
        right: this.additive(),
      };
    }
  }

  private additive(): Expr {
    let left = this.multiplicative();
    for (;;) {
      const operator = this.atPunct("+", "-");
      if (operator === null) return left;
      this.take();
      left = {
        kind: "binary",
        op: ADDITIVE[operator] as BinaryOp,
        left,
        right: this.multiplicative(),
      };
    }
  }

  private multiplicative(): Expr {
    let left = this.unary();
    for (;;) {
      const operator = this.atPunct("*", "/", "%");
      if (operator === null) return left;
      this.take();
      left = {
        kind: "binary",
        op: MULTIPLICATIVE[operator] as BinaryOp,
        left,
        right: this.unary(),
      };
    }
  }

  private unary(): Expr {
    const operator = this.atPunct("!", "-");
    if (operator !== null) {
      this.take();
      return {
        kind: "unary",
        op: operator === "!" ? "not" : "negate",
        operand: this.unary(),
      };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let base = this.primary();
    while (this.atPunct(".") !== null) {
      this.take();
      const token = this.take();
      if (token.kind !== "identifier") throw new ExprError("expected a field name");
      base = { kind: "member", base, field: token.value };
    }
    return base;
  }

  private primary(): Expr {
    const token = this.take();
    switch (token.kind) {
      case "int":
        return { kind: "intLiteral", value: token.value };
      case "double":
        return { kind: "doubleLiteral", value: token.value };
      case "string":
        return { kind: "stringLiteral", value: token.value };
      case "identifier": {
        if (token.value === "true") return { kind: "boolLiteral", value: true };
        if (token.value === "false") return { kind: "boolLiteral", value: false };
        if (token.value === "null") return { kind: "nullLiteral" };
        // Function names appear only in call position.
        if (this.atPunct("(") !== null) {
          this.take();
          const args: Expr[] = [];
          if (this.atPunct(")") === null) {
            for (;;) {
              args.push(this.expression());
              if (this.atPunct(",") === null) break;
              this.take();
            }
          }
          this.expectPunct(")");
          return { kind: "call", name: token.value, args };
        }
        return { kind: "root", name: token.value };
      }
      case "punct": {
        if (token.value === "(") {
          const inner = this.expression();
          this.expectPunct(")");
          return inner;
        }
        throw new ExprError(`unexpected '${token.value}'`);
      }
      default:
        throw new ExprError("unexpected end of expression");
    }
  }
}

export function parseExpression(source: string): Expr {
  return new Parser(tokenize(source)).parse();
}
