import { own } from "../core/lookup.ts";
import {
  formatDouble,
  scalarIndexOf,
  scalarSlice,
  trimScalars,
  unicodeScalarCount,
} from "../core/text.ts";
import type { MilanoType } from "../core/type.ts";
import { MilanoValue } from "../core/value.ts";
import type { MilanoOccurrenceKind } from "../engine/observer.ts";
import type { MilanoFunction } from "../engine/vocabulary.ts";
import type { MilanoFunctionHandler } from "../runtime/handlers.ts";
import type { BinaryOp, Expr } from "./ast.ts";

/**
 * The detail an evaluation report may carry: an invalid function result
 * names the function, the declared return type, and what arrived.
 */
export interface ReportDetail {
  readonly name: string;
  readonly expected: string;
  readonly found: string;
}

export type EvaluationReport = (kind: MilanoOccurrenceKind, detail?: ReportDetail) => void;

/**
 * What an evaluation needs to call host functions: the surface's
 * declarations and the engine's handler (null when none is installed,
 * which the gate rules out for any document that calls one).
 */
export interface EvalEnvironment {
  readonly functions: Readonly<Record<string, MilanoFunction>>;
  readonly handler: MilanoFunctionHandler | null;
}

export const NO_FUNCTIONS: EvalEnvironment = Object.freeze({ functions: {}, handler: null });

/**
 * The zero value of a declared type (expression spec, Host functions):
 * what an invalid function result evaluates to, so evaluation stays
 * total. Optionals are null; an enum is its first declared member.
 */
export function zeroValueOf(type: MilanoType): MilanoValue {
  if (type.optional) return MilanoValue.null;
  switch (type.kind.kind) {
    case "bool":
      return MilanoValue.bool(false);
    case "int":
      return MilanoValue.int(0n);
    case "double":
      return MilanoValue.double(0);
    case "string":
      return MilanoValue.string("");
    case "enum": {
      const first = type.kind.members.values().next();
      return MilanoValue.string(first.done ? "" : first.value);
    }
    case "array":
      return MilanoValue.array([]);
    case "record": {
      const fields: Record<string, MilanoValue> = {};
      for (const [name, fieldType] of Object.entries(type.kind.fields)) {
        fields[name] = zeroValueOf(fieldType);
      }
      return MilanoValue.record(fields);
    }
  }
}

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
/**
 * An int64 index brought into the number domain for slicing. Anything
 * outside a plausible string length clamps at the ends, which is what the
 * contract asks for anyway: substring clamps both indices.
 */
function clampIndex(value: bigint): number {
  if (value < 0n) return -1;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

export class ExprEvaluator {
  private readonly state: Readonly<Record<string, MilanoValue>>;
  private readonly context: Readonly<Record<string, MilanoValue>>;
  private readonly event: MilanoValue | null;
  private readonly result: MilanoValue | null;
  private readonly failure: MilanoValue | null;
  /** `$repeat` bindings in scope: the element and its index, by name. */
  private readonly bindings: Readonly<Record<string, MilanoValue>>;
  private readonly report: EvaluationReport;
  private readonly env: EvalEnvironment;

  constructor(
    state: Readonly<Record<string, MilanoValue>>,
    context: Readonly<Record<string, MilanoValue>>,
    event: MilanoValue | null = null,
    result: MilanoValue | null = null,
    report: EvaluationReport = () => {},
    bindings: Readonly<Record<string, MilanoValue>> = {},
    failure: MilanoValue | null = null,
    env: EvalEnvironment = NO_FUNCTIONS,
  ) {
    this.state = state;
    this.context = context;
    this.event = event;
    this.result = result;
    this.report = report;
    this.bindings = bindings;
    this.failure = failure;
    this.env = env;
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

      case "root": {
        // Bare roots: a `$repeat` binding, or `event` and `result`.
        const bound = own(this.bindings, expr.name);
        if (bound !== undefined) return bound;
        if (expr.name === "event") return this.event ?? MilanoValue.null;
        if (expr.name === "result") return this.result ?? MilanoValue.null;
        if (expr.name === "failure") return this.failure ?? MilanoValue.null;
        return MilanoValue.null;
      }

      case "lookup": {
        // An enum value is its member string, and the gate proved the
        // record has a field of exactly that name.
        const record = this.evaluate(expr.base).recordValue;
        const member = this.evaluate(expr.key).stringValue;
        if (record === null || member === null) return MilanoValue.null;
        return own(record, member) ?? MilanoValue.null;
      }
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
        if (expr.name === "$if") {
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
    if (!name.startsWith("$")) {
      const declared = own(this.env.functions, name);
      return declared === undefined ? MilanoValue.null : this.hostCall(name, args, declared);
    }
    // A const, so the cases narrow it for the helpers below.
    const builtin = name.slice(1);
    switch (builtin) {
      case "abs": {
        // Two's complement: the minimum int negates to itself, no report.
        const asInt = first.intValue;
        if (asInt !== null) return MilanoValue.int(wrap(asInt < 0n ? -asInt : asInt));
        const asDouble = first.doubleValue;
        // IEEE magnitude: abs(-0.0) is 0.0, NaN stays NaN.
        return asDouble === null ? MilanoValue.null : MilanoValue.double(Math.abs(asDouble));
      }
      case "min":
      case "max":
        return extremum(builtin, args);
      case "floor":
      case "ceil":
      case "round": {
        const value = first.doubleValue;
        return value === null ? MilanoValue.null : MilanoValue.double(roundDouble(builtin, value));
      }
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
        if (builtin === "startsWith") return MilanoValue.bool(haystack.startsWith(needle));
        if (builtin === "endsWith") return MilanoValue.bool(haystack.endsWith(needle));
        return MilanoValue.bool(haystack.includes(needle));
      }
      case "trim": {
        const text = first.stringValue;
        return text === null ? MilanoValue.null : MilanoValue.string(trimScalars(text));
      }
      case "substring": {
        const text = first.stringValue;
        const from = (args[1] as MilanoValue).intValue;
        const to = (args[2] as MilanoValue).intValue;
        if (text === null || from === null || to === null) return MilanoValue.null;
        // Clamped in the number domain: the indices are int64, so they can
        // sit far outside anything Array.prototype.slice would accept.
        return MilanoValue.string(scalarSlice(text, clampIndex(from), clampIndex(to)));
      }
      case "indexOf": {
        const text = first.stringValue;
        const needle = (args[1] as MilanoValue).stringValue;
        if (text === null || needle === null) return MilanoValue.null;
        return MilanoValue.int(BigInt(scalarIndexOf(text, needle)));
      }
      case "replace": {
        const text = first.stringValue;
        const needle = (args[1] as MilanoValue).stringValue;
        const replacement = (args[2] as MilanoValue).stringValue;
        if (text === null || needle === null || replacement === null) return MilanoValue.null;
        // An empty needle matches at every position; returning the subject
        // is what keeps the result bounded by its input.
        return MilanoValue.string(needle === "" ? text : text.split(needle).join(replacement));
      }
      case "split": {
        const text = first.stringValue;
        const separator = (args[1] as MilanoValue).stringValue;
        if (text === null || separator === null) return MilanoValue.null;
        // An empty separator would give one element per scalar, unbounded
        // in the value size; one element is the answer.
        const pieces = separator === "" ? [text] : text.split(separator);
        return MilanoValue.array(pieces.map((piece) => MilanoValue.string(piece)));
      }
      case "join": {
        const items = first.arrayValue;
        const separator = (args[1] as MilanoValue).stringValue;
        if (items === null || separator === null) return MilanoValue.null;
        const pieces: string[] = [];
        for (const item of items) {
          const piece = item.stringValue;
          if (piece === null) return MilanoValue.null;
          pieces.push(piece);
        }
        return MilanoValue.string(pieces.join(separator));
      }
      default:
        return MilanoValue.null;
    }
  }

  /**
   * A host function call (expression spec, Host functions): the arguments
   * promoted to their declared types, the handler asked synchronously,
   * its answer validated against the declared return. A mismatch or a
   * throw is an invalid function result: reported, and the zero value of
   * the return type stands in, so evaluation stays total.
   */
  private hostCall(name: string, args: readonly MilanoValue[], declared: MilanoFunction): MilanoValue {
    const promoted = args.map(
      (value, index) => declared.arguments[index]?.validated(value) ?? value,
    );
    const invalid = (found: string): MilanoValue => {
      this.report("invalidFunctionResult", { name, expected: declared.returns.name, found });
      return zeroValueOf(declared.returns);
    };
    const handler = this.env.handler;
    if (handler === null) return invalid("error");
    let answer: MilanoValue;
    try {
      answer = handler({ name, arguments: promoted }) ?? MilanoValue.null;
    } catch {
      return invalid("error");
    }
    const validated = declared.returns.validated(answer);
    return validated === null ? invalid(answer.kind) : validated;
  }
}

/**
 * min and max per the expression spec: the first argument, replaced by
 * each later one that is strictly less (min) or greater (max), so ties
 * keep the leftmost and min(0.0, -0.0) is 0.0; all int stays int, any
 * double promotes every argument; a NaN anywhere is NaN. Never the
 * platform's Math.min, which orders signed zeros and NaN its own way.
 */
function extremum(name: "min" | "max", args: readonly MilanoValue[]): MilanoValue {
  const ints = args.map((argument) => argument.intValue);
  if (ints.every((value) => value !== null)) {
    let best = ints[0] as bigint;
    for (const value of ints.slice(1) as bigint[]) {
      if (name === "min" ? value < best : value > best) best = value;
    }
    return MilanoValue.int(best);
  }
  const doubles = args.map((argument) => argument.numberValue ?? Number.NaN);
  if (doubles.some((value) => Number.isNaN(value))) return MilanoValue.double(Number.NaN);
  let best = doubles[0] as number;
  for (const value of doubles.slice(1)) {
    if (name === "min" ? value < best : value > best) best = value;
  }
  return MilanoValue.double(best);
}

/**
 * floor, ceil, and round per the expression spec, IEEE 754 doubles in and
 * out: non-finite values pass through, round breaks ties away from zero
 * (never Math.round, which rounds half toward positive infinity), and a
 * zero result keeps the argument's sign, so ceil(-0.5) and round(-0.4)
 * are -0.0.
 */
function roundDouble(name: "floor" | "ceil" | "round", value: number): number {
  if (!Number.isFinite(value)) return value;
  let result: number;
  if (name === "floor") result = Math.floor(value);
  else if (name === "ceil") result = Math.ceil(value);
  else {
    const truncated = Math.trunc(value);
    result = Math.abs(value - truncated) >= 0.5 ? truncated + (value > 0 ? 1 : -1) : truncated;
  }
  // Math.ceil(-0.5) is already -0, Math.trunc(-0.4) too; the sign is
  // forced anyway so no platform quirk can lose it.
  return result === 0 ? (value < 0 || Object.is(value, -0) ? -0 : 0) : result;
}
