/**
 * The single representation for every value crossing a Milano boundary:
 * resolved properties into renderers, event payloads out of them, action
 * parameters into handlers, context and state values in from the host.
 *
 * Mirrors the document type system exactly: bool, int (64-bit), double
 * (IEEE 754 binary64), string, array, record, null.
 *
 * Integers are `bigint`, never `number`: the contract's int is 64-bit
 * signed with wrapping arithmetic, and a JS number cannot represent the
 * range exactly. `numberValue` is the ergonomic reader for the ordinary
 * small-integer case.
 */
import { own, recordFrom } from "./lookup.ts";

export type MilanoValueKind =
  | "null"
  | "bool"
  | "int"
  | "double"
  | "string"
  | "array"
  | "record";

const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;

export class MilanoValue {
  readonly kind: MilanoValueKind;
  private readonly payload: unknown;

  private constructor(kind: MilanoValueKind, payload: unknown) {
    this.kind = kind;
    this.payload = payload;
    Object.freeze(this);
  }

  static readonly null: MilanoValue = new MilanoValue("null", undefined);

  static bool(value: boolean): MilanoValue {
    return new MilanoValue("bool", value);
  }

  /**
   * A 64-bit signed integer. Values outside the range wrap, so an int
   * value is always a valid Int64 by construction, as it is on the other
   * runtimes where the type itself enforces the range.
   *
   * A non-finite number has no integer to wrap, a case the statically
   * typed runtimes cannot even express: NaN becomes 0 and each infinity
   * saturates, exactly as the `int()` expression builtin defines it.
   */
  static int(value: bigint | number): MilanoValue {
    if (typeof value === "number" && !Number.isFinite(value)) {
      if (Number.isNaN(value)) return new MilanoValue("int", 0n);
      const saturated = value > 0 ? INT64_MAX : INT64_MIN;
      return new MilanoValue("int", saturated);
    }
    const wide = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
    return new MilanoValue("int", BigInt.asIntN(64, wide));
  }

  static double(value: number): MilanoValue {
    return new MilanoValue("double", value);
  }

  static string(value: string): MilanoValue {
    return new MilanoValue("string", value);
  }

  // Payloads are frozen, not only copied: the gate resolves a literal
  // once and hands the same value to every renderer on every resolution,
  // so a renderer that mutated an array or record it was handed would
  // corrupt the document for the view's lifetime.
  static array(values: readonly MilanoValue[]): MilanoValue {
    return new MilanoValue("array", Object.freeze(values.slice()));
  }

  static record(values: Readonly<Record<string, MilanoValue>>): MilanoValue {
    return new MilanoValue("record", Object.freeze(recordFrom(values)));
  }

  get isNull(): boolean {
    return this.kind === "null";
  }

  get boolValue(): boolean | null {
    return this.kind === "bool" ? (this.payload as boolean) : null;
  }

  get intValue(): bigint | null {
    return this.kind === "int" ? (this.payload as bigint) : null;
  }

  get doubleValue(): number | null {
    return this.kind === "double" ? (this.payload as number) : null;
  }

  /**
   * An int or double as a JS number, for renderers reading counts and
   * measures. Exact for every value a UI realistically carries; ints
   * beyond 2^53 lose precision, and `intValue` stays exact for those.
   */
  get numberValue(): number | null {
    if (this.kind === "int") return Number(this.payload as bigint);
    if (this.kind === "double") return this.payload as number;
    return null;
  }

  get stringValue(): string | null {
    return this.kind === "string" ? (this.payload as string) : null;
  }

  get arrayValue(): readonly MilanoValue[] | null {
    return this.kind === "array" ? (this.payload as readonly MilanoValue[]) : null;
  }

  get recordValue(): Readonly<Record<string, MilanoValue>> | null {
    return this.kind === "record"
      ? (this.payload as Readonly<Record<string, MilanoValue>>)
      : null;
  }

  equals(other: MilanoValue): boolean {
    if (this === other) return true;
    if (this.kind !== other.kind) return false;
    switch (this.kind) {
      case "null":
        return true;
      case "bool":
      case "int":
      case "double":
      case "string":
        // IEEE comparison for doubles, matching the value semantics of the
        // other runtimes: NaN is never equal to itself.
        return this.payload === other.payload;
      case "array": {
        const left = this.payload as readonly MilanoValue[];
        const right = other.payload as readonly MilanoValue[];
        return (
          left.length === right.length &&
          left.every((item, index) => item.equals(right[index] as MilanoValue))
        );
      }
      case "record": {
        const left = this.payload as Record<string, MilanoValue>;
        const right = other.payload as Record<string, MilanoValue>;
        const leftKeys = Object.keys(left);
        if (leftKeys.length !== Object.keys(right).length) return false;
        return leftKeys.every((key) => {
          const counterpart = own(right, key);
          const mine = own(left, key);
          return counterpart !== undefined && mine !== undefined && mine.equals(counterpart);
        });
      }
    }
  }

  /** Debugging only; never a contract format. */
  toString(): string {
    switch (this.kind) {
      case "null":
        return "null";
      case "array":
        return `[${(this.payload as readonly MilanoValue[]).join(", ")}]`;
      case "record": {
        const entries = Object.entries(this.payload as Record<string, MilanoValue>)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        return `{${entries}}`;
      }
      default:
        return String(this.payload);
    }
  }
}
