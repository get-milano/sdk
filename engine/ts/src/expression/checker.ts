import { own } from "../core/lookup.ts";
import { MilanoType } from "../core/type.ts";
import type { Expr } from "./ast.ts";
import { ExprError } from "./ast.ts";

/**
 * What a scoped scalar root (`event`, `result`) means where an expression
 * appears: unavailable, or available with a declared type.
 */
export type RootScope =
  | { readonly kind: "unavailable" }
  | { readonly kind: "payload"; readonly type: MilanoType };

export const UNAVAILABLE: RootScope = { kind: "unavailable" };

export function payloadScope(type: MilanoType): RootScope {
  return { kind: "payload", type };
}

const isStringLike = (type: MilanoType): boolean =>
  type.kind.kind === "string" || type.kind.kind === "enum";

const isNumeric = (type: MilanoType): boolean =>
  type.kind.kind === "int" || type.kind.kind === "double";

const isScalar = (type: MilanoType): boolean =>
  type.kind.kind !== "array" && type.kind.kind !== "record";

/**
 * Static typing, step 4 of the gate. `null` as an inferred type means the
 * null literal: typeless until an expected type or an operator gives it
 * one.
 */
export class ExprChecker {
  private readonly state: Readonly<Record<string, MilanoType>>;
  private readonly context: Readonly<Record<string, MilanoType>>;
  private readonly eventScope: RootScope;
  private readonly resultScope: RootScope;

  constructor(
    state: Readonly<Record<string, MilanoType>>,
    context: Readonly<Record<string, MilanoType>>,
    eventScope: RootScope = UNAVAILABLE,
    resultScope: RootScope = UNAVAILABLE,
  ) {
    this.state = state;
    this.context = context;
    this.eventScope = eventScope;
    this.resultScope = resultScope;
  }

  /**
   * Infers the static type. The expected type propagates into `if`
   * branches and `??` sides, so string literals in enum positions refine
   * to the enum, with membership checked here.
   */
  infer(expr: Expr, expecting: MilanoType | null = null): MilanoType | null {
    switch (expr.kind) {
      case "nullLiteral":
        return null;
      case "boolLiteral":
        return MilanoType.bool();
      case "intLiteral":
        return MilanoType.int();
      case "doubleLiteral":
        return MilanoType.double();
      case "stringLiteral": {
        const expectedKind = expecting?.kind;
        if (expectedKind !== undefined && expectedKind.kind === "enum") {
          if (!expectedKind.members.has(expr.value)) {
            throw new ExprError(`'${expr.value}' is not a member of the declared enum`);
          }
          return MilanoType.enumeration(expectedKind.members);
        }
        return MilanoType.string();
      }
      case "root":
        return this.rootType(expr.name);
      case "member":
        return this.memberType(expr);
      case "call":
        return this.inferCall(expr.name, expr.args, expecting);
      case "unary": {
        const type = this.infer(expr.operand);
        if (type === null || type.optional) {
          throw new ExprError("unary operator on null or optional");
        }
        if (expr.op === "not") {
          if (type.kind.kind !== "bool") throw new ExprError("! needs bool");
          return type;
        }
        if (!isNumeric(type)) throw new ExprError("unary - needs a number");
        return type;
      }
      case "binary":
        return this.inferBinary(expr, expecting);
    }
  }

  /**
   * Whether `actual` is accepted where `expected` is declared: same kind
   * (member-set equality for enums), T where T? is expected, int where
   * double is expected, an enum where string is expected (widening), and
   * the null literal where any optional is expected.
   */
  accepts(expected: MilanoType, actual: MilanoType | null): boolean {
    if (actual === null) return expected.optional;
    if (actual.optional && !expected.optional) return false;
    if (MilanoType.sameKind(actual.kind, expected.kind)) return true;
    if (actual.kind.kind === "int" && expected.kind.kind === "double") return true;
    if (actual.kind.kind === "enum" && expected.kind.kind === "string") return true;
    return false;
  }

  /** The scoped scalar roots: available only where their scope binds. */
  private rootType(name: string): MilanoType {
    if (name === "event") {
      if (this.eventScope.kind !== "payload") {
        throw new ExprError("event is not available here");
      }
      return this.eventScope.type;
    }
    if (name === "result") {
      if (this.resultScope.kind !== "payload") {
        throw new ExprError("result is not available here");
      }
      return this.resultScope.type;
    }
    // `state` and `context` are namespaces, valid only as the base of a
    // field access.
    throw new ExprError(`unknown reference '${name}'`);
  }

  private memberType(expr: Extract<Expr, { kind: "member" }>): MilanoType {
    const base = expr.base;
    if (base.kind === "root" && (base.name === "state" || base.name === "context")) {
      const declarations = base.name === "state" ? this.state : this.context;
      const declared = own(declarations, expr.field);
      if (declared === undefined) {
        throw new ExprError(`unknown ${base.name} key '${expr.field}'`);
      }
      return declared;
    }
    const baseType = this.infer(base);
    if (baseType === null || baseType.kind.kind !== "record") {
      throw new ExprError("field access on a non-record");
    }
    if (baseType.optional) {
      throw new ExprError("field access on an optional record; resolve with ?? first");
    }
    const fieldType = own(baseType.kind.fields, expr.field);
    if (fieldType === undefined) throw new ExprError(`unknown field '${expr.field}'`);
    return fieldType;
  }

  private nonOptional(expr: Expr, name: string, what: string): MilanoType {
    const type = this.infer(expr);
    if (type === null || type.optional) {
      throw new ExprError(`${name} needs a non-optional ${what}`);
    }
    return type;
  }

  private inferCall(
    name: string,
    args: readonly Expr[],
    expecting: MilanoType | null,
  ): MilanoType | null {
    const requireCount = (count: number): void => {
      if (args.length !== count) throw new ExprError(`${name} takes ${count} argument(s)`);
    };
    const argument = (index: number): Expr => args[index] as Expr;

    switch (name) {
      case "str": {
        requireCount(1);
        const type = this.nonOptional(argument(0), name, "scalar");
        if (!isScalar(type)) throw new ExprError("str needs a scalar");
        return MilanoType.string();
      }
      case "int": {
        requireCount(1);
        if (this.nonOptional(argument(0), name, "double").kind.kind !== "double") {
          throw new ExprError("int needs a double");
        }
        return MilanoType.int();
      }
      case "double": {
        requireCount(1);
        if (this.nonOptional(argument(0), name, "int").kind.kind !== "int") {
          throw new ExprError("double needs an int");
        }
        return MilanoType.double();
      }
      case "concat": {
        if (args.length < 2) throw new ExprError("concat takes 2 or more arguments");
        for (const arg of args) {
          if (!isStringLike(this.nonOptional(arg, name, "string"))) {
            throw new ExprError("concat needs strings");
          }
        }
        return MilanoType.string();
      }
      case "length":
      case "isEmpty": {
        requireCount(1);
        const type = this.nonOptional(argument(0), name, "string or array");
        if (!isStringLike(type) && type.kind.kind !== "array") {
          throw new ExprError(`${name} needs a string or array`);
        }
        return name === "length" ? MilanoType.int() : MilanoType.bool();
      }
      case "contains":
      case "startsWith":
      case "endsWith": {
        requireCount(2);
        if (
          !isStringLike(this.nonOptional(argument(0), name, "string")) ||
          !isStringLike(this.nonOptional(argument(1), name, "string"))
        ) {
          throw new ExprError(`${name} needs strings`);
        }
        return MilanoType.bool();
      }
      case "trim": {
        requireCount(1);
        if (!isStringLike(this.nonOptional(argument(0), name, "string"))) {
          throw new ExprError("trim needs a string");
        }
        return MilanoType.string();
      }
      case "if": {
        requireCount(3);
        if (this.nonOptional(argument(0), name, "bool").kind.kind !== "bool") {
          throw new ExprError("if needs a bool condition");
        }
        // Both branches type-check to the same T, and T may itself be
        // optional: a single null branch makes the result optional.
        const thenType = this.infer(argument(1), expecting);
        const elseType = this.infer(argument(2), expecting);
        if (thenType === null && elseType === null) {
          throw new ExprError("if branches cannot both be null");
        }
        if (thenType === null) return new MilanoType((elseType as MilanoType).kind, true);
        if (elseType === null) return new MilanoType(thenType.kind, true);
        if (!MilanoType.sameKind(thenType.kind, elseType.kind)) {
          throw new ExprError("if branches must have the same type");
        }
        return new MilanoType(thenType.kind, thenType.optional || elseType.optional);
      }
      default:
        throw new ExprError(`unknown function '${name}'`);
    }
  }

  private inferBinary(
    expr: Extract<Expr, { kind: "binary" }>,
    expecting: MilanoType | null,
  ): MilanoType | null {
    const { op, left, right } = expr;

    if (op === "coalesce") {
      const leftType = this.infer(left, expecting);
      const rightType = this.infer(right, expecting);
      if (rightType === null || rightType.optional) {
        throw new ExprError("?? right side must be non-optional");
      }
      if (leftType === null) return rightType; // null ?? x
      if (!leftType.optional || !MilanoType.sameKind(leftType.kind, rightType.kind)) {
        throw new ExprError("?? needs optional T and T of the same kind");
      }
      return rightType;
    }

    if (op === "and" || op === "or") {
      const leftType = this.infer(left);
      const rightType = this.infer(right);
      if (
        leftType === null ||
        rightType === null ||
        leftType.optional ||
        rightType.optional ||
        leftType.kind.kind !== "bool" ||
        rightType.kind.kind !== "bool"
      ) {
        throw new ExprError("logical operators need bool");
      }
      return MilanoType.bool();
    }

    if (op === "equal" || op === "notEqual") {
      const leftType = this.infer(left);
      const rightType = this.infer(right);
      if (leftType === null || rightType === null) {
        const other = leftType ?? rightType;
        if (other === null || !other.optional) {
          throw new ExprError("only optionals compare to null");
        }
        return MilanoType.bool();
      }
      if (!isScalar(leftType) || !isScalar(rightType)) {
        throw new ExprError("arrays and records are not comparable");
      }
      this.checkEnumComparison(leftType, rightType, left, right);
      const numericPair = isNumeric(leftType) && isNumeric(rightType);
      const enumStringPair =
        (leftType.kind.kind === "enum" && rightType.kind.kind === "string") ||
        (leftType.kind.kind === "string" && rightType.kind.kind === "enum");
      if (!MilanoType.sameKind(leftType.kind, rightType.kind) && !numericPair && !enumStringPair) {
        throw new ExprError("equality needs matching scalar types");
      }
      if (leftType.optional || rightType.optional) {
        throw new ExprError("resolve optionals with ?? before comparing values");
      }
      return MilanoType.bool();
    }

    if (op === "less" || op === "lessEqual" || op === "greater" || op === "greaterEqual") {
      const leftType = this.infer(left);
      const rightType = this.infer(right);
      if (
        leftType === null ||
        rightType === null ||
        leftType.optional ||
        rightType.optional ||
        !isNumeric(leftType) ||
        !isNumeric(rightType)
      ) {
        throw new ExprError("ordering needs numbers");
      }
      return MilanoType.bool();
    }

    const leftType = this.infer(left);
    const rightType = this.infer(right);
    if (
      op === "add" &&
      leftType !== null &&
      rightType !== null &&
      !leftType.optional &&
      !rightType.optional &&
      isStringLike(leftType) &&
      isStringLike(rightType)
    ) {
      return MilanoType.string();
    }
    if (
      leftType === null ||
      rightType === null ||
      leftType.optional ||
      rightType.optional ||
      !isNumeric(leftType) ||
      !isNumeric(rightType)
    ) {
      throw new ExprError("arithmetic needs numbers");
    }
    return leftType.kind.kind === "double" || rightType.kind.kind === "double"
      ? MilanoType.double()
      : MilanoType.int();
  }

  /**
   * Enum comparison rules: a string-literal operand must be a member; two
   * enums must be the same enum; a non-literal string compares as a
   * string (the enum widens).
   */
  private checkEnumComparison(
    leftType: MilanoType,
    rightType: MilanoType,
    left: Expr,
    right: Expr,
  ): void {
    const leftKind = leftType.kind;
    if (leftKind.kind !== "enum") {
      if (rightType.kind.kind === "enum") {
        this.checkEnumComparison(rightType, leftType, right, left);
      }
      return;
    }
    if (rightType.kind.kind === "enum") {
      if (!MilanoType.sameKind(leftKind, rightType.kind)) {
        throw new ExprError("distinct enum types are not comparable");
      }
      return;
    }
    if (right.kind === "stringLiteral" && !leftKind.members.has(right.value)) {
      throw new ExprError(`'${right.value}' is not a member of the declared enum`);
    }
  }
}
