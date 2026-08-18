import { isValidIdentifier } from "./identifier.ts";
import { emptyRecord, own, recordFrom } from "./lookup.ts";
import { MilanoValue } from "./value.ts";

/**
 * A type from the document type system: bool, int, double, string, enum
 * over named members, array of T, or record with named typed fields; each
 * optionally optional.
 */
export type MilanoTypeKind =
  | { readonly kind: "bool" }
  | { readonly kind: "int" }
  | { readonly kind: "double" }
  | { readonly kind: "string" }
  | { readonly kind: "enum"; readonly members: ReadonlySet<string> }
  | { readonly kind: "array"; readonly element: MilanoType }
  | { readonly kind: "record"; readonly fields: Readonly<Record<string, MilanoType>> };

export class MilanoType {
  readonly kind: MilanoTypeKind;
  readonly optional: boolean;

  constructor(kind: MilanoTypeKind, optional = false) {
    this.kind = kind;
    this.optional = optional;
    Object.freeze(this);
  }

  static bool(optional = false): MilanoType {
    return new MilanoType({ kind: "bool" }, optional);
  }

  static int(optional = false): MilanoType {
    return new MilanoType({ kind: "int" }, optional);
  }

  static double(optional = false): MilanoType {
    return new MilanoType({ kind: "double" }, optional);
  }

  static string(optional = false): MilanoType {
    return new MilanoType({ kind: "string" }, optional);
  }

  /**
   * A closed set of member strings. Two enum types are the same exactly
   * when their member sets are equal: enum identity is structural, like
   * records.
   */
  static enumeration(members: Iterable<string>, optional = false): MilanoType {
    return new MilanoType({ kind: "enum", members: new Set(members) }, optional);
  }

  static array(element: MilanoType, optional = false): MilanoType {
    return new MilanoType({ kind: "array", element }, optional);
  }

  static record(
    fields: Readonly<Record<string, MilanoType>>,
    optional = false,
  ): MilanoType {
    return new MilanoType({ kind: "record", fields: recordFrom(fields) }, optional);
  }

  /** The name used in error details: the kind, with `?` when optional. */
  get name(): string {
    return this.optional ? `${this.kind.kind}?` : this.kind.kind;
  }

  /**
   * Parses a JSON type descriptor:
   * - a primitive name string, with a trailing `?` for optional (`"int"`, `"string?"`)
   * - `{"enum": [<member>...], "optional": <bool>}`
   * - `{"array": <descriptor>, "optional": <bool>}`
   * - `{"record": {<field>: <descriptor>}, "optional": <bool>}`
   */
  static fromDescriptor(descriptor: MilanoValue): MilanoType | null {
    const asString = descriptor.stringValue;
    if (asString !== null) {
      const optional = asString.endsWith("?");
      const name = optional ? asString.slice(0, -1) : asString;
      switch (name) {
        case "bool":
          return MilanoType.bool(optional);
        case "int":
          return MilanoType.int(optional);
        case "double":
          return MilanoType.double(optional);
        case "string":
          return MilanoType.string(optional);
        default:
          return null;
      }
    }

    const object = descriptor.recordValue;
    if (object === null) return null;

    let optional = false;
    const optionalEntry = object["optional"];
    if (optionalEntry !== undefined) {
      const flag = optionalEntry.boolValue;
      if (flag === null) return null;
      optional = flag;
    }

    const keys = Object.keys(object);
    const enumEntry = object["enum"];
    if (enumEntry !== undefined) {
      const members = enumEntry.arrayValue;
      if (members === null || members.length === 0) return null;
      if (!keys.every((key) => key === "enum" || key === "optional")) return null;
      const names = new Set<string>();
      for (const member of members) {
        const name = member.stringValue;
        if (name === null || !isValidIdentifier(name) || names.has(name)) return null;
        names.add(name);
      }
      return MilanoType.enumeration(names, optional);
    }

    const arrayEntry = object["array"];
    if (arrayEntry !== undefined) {
      if (!keys.every((key) => key === "array" || key === "optional")) return null;
      const element = MilanoType.fromDescriptor(arrayEntry);
      return element === null ? null : MilanoType.array(element, optional);
    }

    const recordEntry = object["record"];
    if (recordEntry !== undefined) {
      const fieldDescriptors = recordEntry.recordValue;
      if (fieldDescriptors === null) return null;
      if (!keys.every((key) => key === "record" || key === "optional")) return null;
      const fields = emptyRecord<MilanoType>();
      for (const [name, fieldDescriptor] of Object.entries(fieldDescriptors)) {
        if (!isValidIdentifier(name)) return null;
        const fieldType = MilanoType.fromDescriptor(fieldDescriptor);
        if (fieldType === null) return null;
        fields[name] = fieldType;
      }
      return MilanoType.record(fields, optional);
    }

    return null;
  }

  /**
   * Validates a value against this type and returns its canonical form,
   * or `null` on mismatch.
   *
   * Rules, identical in every runtime:
   * - `null` is valid only for optional types.
   * - An `int` value is accepted where `double` is declared and is
   *   canonicalized to `double`, mirroring expression promotion. A
   *   `double` value never satisfies an `int` declaration.
   * - An `enum` declaration is satisfied only by one of its members.
   * - Records must match their declared shape exactly: missing
   *   non-optional fields and undeclared fields are mismatches, and a
   *   missing optional field canonicalizes to `null`.
   */
  validated(value: MilanoValue): MilanoValue | null {
    if (value.isNull) return this.optional ? MilanoValue.null : null;

    switch (this.kind.kind) {
      case "bool":
        return value.kind === "bool" ? value : null;
      case "int":
        return value.kind === "int" ? value : null;
      case "double": {
        if (value.kind === "double") return value;
        const asInt = value.intValue;
        return asInt === null ? null : MilanoValue.double(Number(asInt));
      }
      case "string":
        return value.kind === "string" ? value : null;
      case "enum": {
        const member = value.stringValue;
        if (member === null) return null;
        return this.kind.members.has(member) ? value : null;
      }
      case "array": {
        const items = value.arrayValue;
        if (items === null) return null;
        const element = this.kind.element;
        const canonical: MilanoValue[] = [];
        for (const item of items) {
          const validated = element.validated(item);
          if (validated === null) return null;
          canonical.push(validated);
        }
        return MilanoValue.array(canonical);
      }
      case "record": {
        const entries = value.recordValue;
        if (entries === null) return null;
        const fields = this.kind.fields;
        for (const key of Object.keys(entries)) {
          if (own(fields, key) === undefined) return null; // undeclared field
        }
        const canonical = emptyRecord<MilanoValue>();
        for (const [name, fieldType] of Object.entries(fields)) {
          const fieldValue = own(entries, name) ?? MilanoValue.null;
          const validated = fieldType.validated(fieldValue);
          if (validated === null) return null;
          canonical[name] = validated;
        }
        return MilanoValue.record(canonical);
      }
    }
  }

  equals(other: MilanoType): boolean {
    if (this.optional !== other.optional) return false;
    return MilanoType.sameKind(this.kind, other.kind);
  }

  /** Kind equality, member-aware for enums and structural for records. */
  static sameKind(left: MilanoTypeKind, right: MilanoTypeKind): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === "enum" && right.kind === "enum") {
      if (left.members.size !== right.members.size) return false;
      for (const member of left.members) {
        if (!right.members.has(member)) return false;
      }
      return true;
    }
    if (left.kind === "array" && right.kind === "array") {
      return left.element.equals(right.element);
    }
    if (left.kind === "record" && right.kind === "record") {
      const leftNames = Object.keys(left.fields);
      const rightNames = Object.keys(right.fields);
      if (leftNames.length !== rightNames.length) return false;
      return leftNames.every((name) => {
        const counterpart = own(right.fields, name);
        const mine = own(left.fields, name);
        return counterpart !== undefined && mine !== undefined && mine.equals(counterpart);
      });
    }
    return true;
  }
}
