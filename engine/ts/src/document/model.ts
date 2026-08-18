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

/** A parsed action, per the document model spec's action encoding. */
export type ActionSpec =
  | { readonly kind: "set"; readonly key: string; readonly value: DocValue }
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
    };

/** A parsed node envelope, before vocabulary validation. */
export interface RawNode {
  readonly type: string;
  readonly id: string | null;
  readonly properties: Readonly<Record<string, DocValue>>;
  readonly children: readonly RawNode[];
  readonly events: Readonly<Record<string, readonly ActionSpec[]>>;
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
