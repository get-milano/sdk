/** The expression syntax tree, per the expression language spec. */
export type BinaryOp =
  | "multiply"
  | "divide"
  | "modulo"
  | "add"
  | "subtract"
  | "less"
  | "lessEqual"
  | "greater"
  | "greaterEqual"
  | "equal"
  | "notEqual"
  | "and"
  | "or"
  | "coalesce";

export type UnaryOp = "not" | "negate";

export type Expr =
  | { readonly kind: "nullLiteral" }
  | { readonly kind: "boolLiteral"; readonly value: boolean }
  | { readonly kind: "intLiteral"; readonly value: bigint }
  | { readonly kind: "doubleLiteral"; readonly value: number }
  | { readonly kind: "stringLiteral"; readonly value: string }
  | { readonly kind: "root"; readonly name: string }
  | { readonly kind: "member"; readonly base: Expr; readonly field: string }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Expr[] }
  | { readonly kind: "unary"; readonly op: UnaryOp; readonly operand: Expr }
  | {
      readonly kind: "binary";
      readonly op: BinaryOp;
      readonly left: Expr;
      readonly right: Expr;
    };

/**
 * A defect in an expression: raised while lexing, parsing, or type
 * checking, and surfaced by the gate as a `SchemaViolation` with rule
 * `expression`.
 */
export class ExprError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "ExprError";
    this.detail = detail;
  }
}
