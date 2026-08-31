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
  /** `record[key]`: the field an enum key names (contract 2.1). */
  | { readonly kind: "lookup"; readonly base: Expr; readonly key: Expr }
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

/**
 * A function or root that a later minor than the document declares
 * introduced: the gate surfaces it as the `contract-feature` rule, named
 * after the feature, rather than as an ordinary expression defect.
 */
export class ExprFeatureError extends ExprError {
  readonly feature: string;
  /** The `major.minor` that introduced the feature, as the detail spells it. */
  readonly version: string;

  constructor(feature: string, version: string) {
    super(`${feature} needs contract ${version}`);
    this.name = "ExprFeatureError";
    this.feature = feature;
    this.version = version;
  }
}
