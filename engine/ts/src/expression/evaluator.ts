import { own } from "../core/lookup.ts";
import { formatDouble, trimScalars, unicodeScalarCount } from "../core/text.ts";
import { MilanoValue } from "../core/value.ts";
import type { MilanoOccurrenceKind } from "../engine/observer.ts";
import type { BinaryOp, Expr } from "./ast.ts";

const INT_MIN = -(2n ** 63n);
const INT_MAX = 2n ** 63n - 1n;
/** 2^63 exactly, the first double above the signed 64-bit range. */
const INT_MAX_EXCLUSIVE_AS_DOUBLE = 9223372036854775808;

const wrap = (value: bigint): bigint => BigInt.asIntN(64, value);

/**
 * Total evaluation: after the gate, this cannot fail. Division by zero and
 * saturation report occurrences through `report` and return defined
 * results, so evaluation always produces a value.
 */
export class ExprEvaluator {
  private readonly state: Readonly<Record<string, MilanoValue>>;
  private readonly context: Readonly<Record<string, MilanoValue>>;
  private readonly event: MilanoValue | null;
  private readonly result: MilanoValue | null;
  private readonly report: (kind: MilanoOccurrenceKind) => void;

  constructor(
    state: Readonly<Record<string, MilanoValue>>,
    context: Readonly<Record<string, MilanoValue>>,
    event: MilanoValue | null = null,
    result: MilanoValue | null = null,
    report: (kind: MilanoOccurrenceKind) => void = () => {},
  ) {
    this.state = state;
    this.context = context;
    this.event = event;
    this.result = result;
    this.report = report;
  }

  evaluate(expr: Expr): MilanoValue {
    switch (expr.kind) {
      case "nullLiteral":
        return MilanoValue.null;
      case "boolLiteral":
        return MilanoValue.bool(expr.value);
      case "intLiteral":
        return MilanoValue.int(expr.value);
      case "doubleLiteral":
        return MilanoValue.double(expr.value);
      case "stringLiteral":
        return MilanoValue.string(expr.value);

      case "root":
        // Only `event` and `result` reach evaluation as bare roots.
        if (expr.name === "event") return this.event ?? MilanoValue.null;
        if (expr.name === "result") return this.result ?? MilanoValue.null;
        return MilanoValue.null;

      case "member": {
        const base = expr.base;
        if (base.kind === "root" && base.name === "state") {
          return own(this.state, expr.field) ?? MilanoValue.null;
        }
        if (base.kind === "root" && base.name === "context") {
          return own(this.context, expr.field) ?? MilanoValue.null;
        }
        const record = this.evaluate(base).recordValue;
        return (record === null ? undefined : own(record, expr.field)) ?? MilanoValue.null;
      }

      case "call": {
        if (expr.name === "if") {
          // Lazy conditional: only the taken branch evaluates, like && ||
          // and ??, so guards suppress the reports they guard.
          const taken = this.evaluate(expr.args[0] as Expr).boolValue === true ? 1 : 2;
          return this.evaluate(expr.args[taken] as Expr);
        }
        return this.call(
          expr.name,
          expr.args.map((argument) => this.evaluate(argument)),
        );
      }

      case "unary": {
        const value = this.evaluate(expr.operand);
        if (expr.op === "not") return MilanoValue.bool(value.boolValue !== true);
        const asInt = value.intValue;
        if (asInt !== null) return MilanoValue.int(wrap(-asInt));
        const asDouble = value.doubleValue;
        if (asDouble !== null) return MilanoValue.double(-asDouble);
        return MilanoValue.null;
      }

      case "binary": {
        switch (expr.op) {
          case "and":
            // Short-circuit.
            if (this.evaluate(expr.left).boolValue !== true) return MilanoValue.bool(false);
            return MilanoValue.bool(this.evaluate(expr.right).boolValue === true);
          case "or":
            if (this.evaluate(expr.left).boolValue === true) return MilanoValue.bool(true);
            return MilanoValue.bool(this.evaluate(expr.right).boolValue === true);
          case "coalesce": {
            const left = this.evaluate(expr.left);
            return left.isNull ? this.evaluate(expr.right) : left;
          }
          default:
            return this.binary(expr.op, this.evaluate(expr.left), this.evaluate(expr.right));
        }
      }
    }
  }

  private binary(op: BinaryOp, left: MilanoValue, right: MilanoValue): MilanoValue {
    // String concatenation, which enum values join through by widening.
    if (op === "add" && left.kind === "string" && right.kind === "string") {
      return MilanoValue.string((left.stringValue as string) + (right.stringValue as string));
    }

    // Equality: promote for numeric pairs, otherwise same-type comparison.
    if (op === "equal" || op === "notEqual") {
      let equal: boolean;
      const leftInt = left.intValue;
      const rightInt = right.intValue;
      const leftDouble = left.doubleValue;
      const rightDouble = right.doubleValue;
      if (leftInt !== null && rightDouble !== null) equal = Number(leftInt) === rightDouble;
      else if (leftDouble !== null && rightInt !== null) equal = leftDouble === Number(rightInt);
      else if (leftDouble !== null && rightDouble !== null) equal = leftDouble === rightDouble;
      else equal = left.equals(right);
      return MilanoValue.bool(op === "equal" ? equal : !equal);
    }

    // Numeric operators: int with int stays int; any double promotes.
    const leftInt = left.intValue;
    const rightInt = right.intValue;
    if (leftInt !== null && rightInt !== null) {
      switch (op) {
        case "multiply":
          return MilanoValue.int(wrap(leftInt * rightInt));
        case "add":
          return MilanoValue.int(wrap(leftInt + rightInt));
        case "subtract":
          return MilanoValue.int(wrap(leftInt - rightInt));
        case "divide": {
          if (rightInt === 0n) {
            this.report("divisionByZero");
            return MilanoValue.int(0n);
          }
          // Wraps, the one case where the quotient leaves the range.
          if (leftInt === INT_MIN && rightInt === -1n) return MilanoValue.int(INT_MIN);
          return MilanoValue.int(leftInt / rightInt);
        }
        case "modulo": {
          if (rightInt === 0n) {
            this.report("divisionByZero");
            return MilanoValue.int(0n);
          }
          if (leftInt === INT_MIN && rightInt === -1n) return MilanoValue.int(0n);
          return MilanoValue.int(leftInt % rightInt);
        }
        case "less":
          return MilanoValue.bool(leftInt < rightInt);
        case "lessEqual":
          return MilanoValue.bool(leftInt <= rightInt);
        case "greater":
          return MilanoValue.bool(leftInt > rightInt);
        case "greaterEqual":
          return MilanoValue.bool(leftInt >= rightInt);
        default:
          return MilanoValue.null;
      }
    }

    const leftNumber = this.promoted(left);
    const rightNumber = this.promoted(right);
    if (leftNumber === null || rightNumber === null) return MilanoValue.null;
    switch (op) {
      case "multiply":
        return MilanoValue.double(leftNumber * rightNumber);
      case "divide":
        // IEEE: infinities and NaN, never a report.
        return MilanoValue.double(leftNumber / rightNumber);
      case "modulo":
        return MilanoValue.double(leftNumber % rightNumber);
      case "add":
        return MilanoValue.double(leftNumber + rightNumber);
      case "subtract":
        return MilanoValue.double(leftNumber - rightNumber);
      case "less":
        return MilanoValue.bool(leftNumber < rightNumber);
      case "lessEqual":
        return MilanoValue.bool(leftNumber <= rightNumber);
      case "greater":
        return MilanoValue.bool(leftNumber > rightNumber);
      case "greaterEqual":
        return MilanoValue.bool(leftNumber >= rightNumber);
      default:
        return MilanoValue.null;
    }
  }

  private promoted(value: MilanoValue): number | null {
    const asInt = value.intValue;
    if (asInt !== null) return Number(asInt);
    return value.doubleValue;
  }

  private call(name: string, args: readonly MilanoValue[]): MilanoValue {
    const first = args[0] as MilanoValue;
    switch (name) {
      case "str": {
        switch (first.kind) {
          case "bool":
            return MilanoValue.string(first.boolValue === true ? "true" : "false");
          case "int":
            return MilanoValue.string(String(first.intValue));
          case "double":
            return MilanoValue.string(formatDouble(first.doubleValue as number));
          case "string":
            return first;
          default:
            return MilanoValue.null;
        }
      }
      case "int": {
        const value = first.doubleValue;
        if (value === null) return MilanoValue.null;
        if (Number.isNaN(value)) {
          this.report("saturation");
          return MilanoValue.int(0n);
        }
        if (value >= INT_MAX_EXCLUSIVE_AS_DOUBLE) {
          this.report("saturation");
          return MilanoValue.int(INT_MAX);
        }
        if (value < -INT_MAX_EXCLUSIVE_AS_DOUBLE) {
          this.report("saturation");
          return MilanoValue.int(INT_MIN);
        }
        return MilanoValue.int(BigInt(Math.trunc(value))); // truncates toward zero
      }
      case "double": {
        const value = first.intValue;
        return value === null ? MilanoValue.null : MilanoValue.double(Number(value));
      }
      case "concat": {
        let text = "";
        for (const argument of args) text += argument.stringValue ?? "";
        return MilanoValue.string(text);
      }
      case "length": {
        const text = first.stringValue;
        if (text !== null) return MilanoValue.int(BigInt(unicodeScalarCount(text)));
        const items = first.arrayValue;
        if (items !== null) return MilanoValue.int(BigInt(items.length));
        return MilanoValue.null;
      }
      case "isEmpty": {
        const text = first.stringValue;
        if (text !== null) return MilanoValue.bool(text.length === 0);
        const items = first.arrayValue;
        if (items !== null) return MilanoValue.bool(items.length === 0);
        return MilanoValue.null;
      }
      case "contains":
      case "startsWith":
      case "endsWith": {
        const haystack = first.stringValue;
        const needle = (args[1] as MilanoValue).stringValue;
        if (haystack === null || needle === null) return MilanoValue.null;
        if (name === "startsWith") return MilanoValue.bool(haystack.startsWith(needle));
        if (name === "endsWith") return MilanoValue.bool(haystack.endsWith(needle));
        return MilanoValue.bool(haystack.includes(needle));
      }
      case "trim": {
        const text = first.stringValue;
        return text === null ? MilanoValue.null : MilanoValue.string(trimScalars(text));
      }
      default:
        return MilanoValue.null;
    }
  }
}
