import type { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";
import type { Expr } from "../expression/ast.ts";

/**
 * A document value: a literal of the type system, an unchecked expression
 * (the `$expr` wrapper, straight from parsing), or a gate-checked
 * expression carrying its AST and the declared type it must produce.
 */
export type DocValue =
  | { readonly kind: "literal"; readonly value: MilanoValue }
  | { readonly kind: "expression"; readonly source: string }
  | {
      readonly kind: "typedExpression";
      readonly source: string;
      readonly expr: Expr;
      readonly expected: MilanoType;
    };

/** The three array actions (contract 2.1), by their `$` names. */
export type ArrayActionName = "$append" | "$remove" | "$update";

/** A parsed action, per the document model spec's action encoding. */
export type ActionSpec =
  | { readonly kind: "set"; readonly key: string; readonly value: DocValue }
  /**
   * An array action as parsed, before the gate: every parameter as the
   * document carried it (null when absent), plus the keys the action does
   * not take. The gate replaces it by one of the three validated kinds.
   */
  | {
      readonly kind: "arrayAction";
      readonly name: ArrayActionName;
      readonly key: string | null;
      readonly at: DocValue | null;
      readonly field: string | null;
      /** The kind of a `field` that is present but not a string. */
      readonly fieldFound: string | null;
      readonly value: DocValue | null;
      readonly extra: readonly string[];
    }
  | { readonly kind: "append"; readonly key: string; readonly value: DocValue }
  | { readonly kind: "remove"; readonly key: string; readonly at: DocValue }
  | {
      readonly kind: "update";
      readonly key: string;
      readonly at: DocValue;
      readonly field: string;
      readonly value: DocValue;
    }
  | { readonly kind: "sequence"; readonly actions: readonly ActionSpec[] }
  | {
      readonly kind: "when";
      readonly condition: DocValue;
      readonly then: readonly ActionSpec[];
      readonly otherwise: readonly ActionSpec[];
    }
  | {
      readonly kind: "custom";
      readonly name: string;
      readonly parameters: Readonly<Record<string, DocValue>>;
      readonly onSuccess: readonly ActionSpec[];
      readonly onFailure: readonly ActionSpec[];
      /** Declared success result type, resolved by the gate; null until then. */
      readonly result: MilanoType | null;
      /** Declared failure payload type, resolved by the gate; null until then. */
      readonly failure: MilanoType | null;
    };

/**
 * The `$repeat` construct's own keys, as parsed: `items` (a value, which
 * the gate requires to be an array expression), `as` (the binding name),
 * and `key` (contract 2.1: a value the gate requires to be a string or int
 * expression). Null where the document omitted them; the gate reports.
 */
export interface RepeatSpec {
  readonly items: DocValue | null;
  readonly as: string | null;
  readonly key: DocValue | null;
}

/**
 * The `$if` construct's own keys, as parsed. Branches are node lists, and
 * `else` absent is different from `else` empty: absent means the document
 * says nothing happens, empty is an encoding violation.
 */
export interface ConditionalSpec {
  readonly condition: DocValue | null;
  readonly then: readonly RawNode[] | null;
  readonly otherwise: readonly RawNode[] | null;
  /** Keys the construct does not declare, so the gate can name one. */
  readonly undeclared: readonly string[];
}

/**
 * The `$switch` construct's own keys, as parsed: the enum subject and one
 * node list per member, plus the list every uncovered member takes.
 */
export interface SwitchSpec {
  readonly subject: DocValue | null;
  readonly cases: Readonly<Record<string, readonly RawNode[]>> | null;
  readonly fallback: readonly RawNode[] | null;
  readonly hasFallback: boolean;
  /** Keys the construct does not declare, so the gate can name one. */
  readonly undeclared: readonly string[];
}

/** A parsed node envelope, before vocabulary validation. */
export interface RawNode {
  readonly type: string;
  readonly id: string | null;
  readonly properties: Readonly<Record<string, DocValue>>;
  readonly children: readonly RawNode[];
  readonly events: Readonly<Record<string, readonly ActionSpec[]>>;
  /** Present exactly when `type` is `$repeat`. */
  readonly repeat: RepeatSpec | null;
  /** Present exactly when `type` is `$if`. */
  readonly conditional: ConditionalSpec | null;
  /** Present exactly when `type` is `$switch`. */
  readonly choice: SwitchSpec | null;
  /** The node's whole subtree as raw data, kept for the placeholder policy. */
  readonly raw: MilanoValue;
}

/**
 * The document's optional vocabulary requirement, checked at the gate
 * against the engine's vocabulary (name equality, version at least min).
 */
export interface VocabularyRequirement {
  readonly name: string;
  readonly min: string | null;
}

/** A parsed document: structure and declarations only, never data values. */
export interface ParsedDocument {
  readonly versionString: string;
  readonly major: number;
  readonly minor: number;
  readonly vocabularyRequirement: VocabularyRequirement | null;
  readonly contextDeclarations: Readonly<Record<string, MilanoType>>;
  readonly stateDeclarations: Readonly<Record<string, MilanoType>>;
  readonly root: RawNode;
  /**
   * The document's lifecycle bindings (contract 2.1), as parsed: signal
   * name to action list. The gate rules on the names.
   */
  readonly lifecycle: Readonly<Record<string, readonly ActionSpec[]>>;
  /** Whether the document carried an `on` section at all, for gating. */
  readonly hasLifecycle: boolean;
  /**
   * The document's watch bindings (contract 2.1), as parsed: state key to
   * action list. The gate rules on the keys.
   */
  readonly watch: Readonly<Record<string, readonly ActionSpec[]>>;
  readonly hasWatch: boolean;
  readonly metadata: MilanoValue | null;
}

/** Parses "major.minor.patch" into a comparable triple; null when malformed. */
export function parseSemver(text: string): [number, number, number] | null {
  const parts = text.split(".");
  if (parts.length !== 3) return null;
  const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((value) => Number.isNaN(value))) return null;
  return [numbers[0] as number, numbers[1] as number, numbers[2] as number];
}

export function compareSemver(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return 0;
}
