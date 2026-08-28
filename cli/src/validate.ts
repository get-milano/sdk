import {
  MilanoBuildError,
  MilanoEngine,
  MilanoRegistry,
  MilanoType,
  MilanoVocabulary,
  parseJson,
  synthesizedState,
} from "@get-milano/core";
import type {
  MilanoBuildErrorKind,
  MilanoOccurrence,
  MilanoUnknownTypePolicy,
  MilanoValue,
} from "@get-milano/core";

export interface ValidateOptions {
  /** The document, as text: `int` and `double` survive only as text. */
  readonly document: string;
  /** The vocabulary artifact, as JSON text. */
  readonly vocabulary: string;
  /** Context values; anything the document declares and this omits is synthesized. */
  readonly context?: Readonly<Record<string, MilanoValue>>;
  /** State values; anything the document declares and this omits is synthesized. */
  readonly state?: Readonly<Record<string, MilanoValue>>;
  /** Defaults to the contract default, *fail*. */
  readonly unknownTypes?: MilanoUnknownTypePolicy;
}

/** A `MilanoBuildError`, flattened: its type, message, and non-null detail. */
export interface ReportedError {
  readonly type: MilanoBuildErrorKind;
  readonly message: string;
  readonly detail: Readonly<Record<string, string | number | readonly number[]>>;
}

/** An occurrence a successful build reported, without the view identity. */
export interface ReportedOccurrence {
  readonly kind: MilanoOccurrence["kind"];
  readonly node: string | null;
  readonly name: string | null;
  readonly expected: string | null;
  readonly found: string | null;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly error: ReportedError | null;
  readonly occurrences: readonly ReportedOccurrence[];
  /**
   * Producer lint, non-normative: keys the contract does not define, in
   * the objects it governs. The gate ignores them by the tolerance rule,
   * which is exactly why a typo there is silent.
   */
  readonly warnings: readonly string[];
}

const TOP_LEVEL_KEYS = new Set(["version", "vocabulary", "context", "state", "root", "metadata"]);
const VOCABULARY_KEYS = new Set(["name", "min"]);
const ENVELOPE_KEYS = new Set(["type", "id", "properties", "children", "on"]);
const DESCRIPTOR_KEYS = new Set(["enum", "array", "record", "optional"]);

export function unknownKeyWarnings(documentText: string): string[] {
  const warnings: string[] = [];
  let document: MilanoValue;
  try {
    document = parseJson(documentText);
  } catch {
    return warnings;
  }
  const descriptor = (value: MilanoValue | undefined, where: string): void => {
    const object = value?.recordValue ?? null;
    if (object === null) return;
    for (const key of Object.keys(object)) {
      if (!DESCRIPTOR_KEYS.has(key)) warnings.push(`${where}: unknown type descriptor key "${key}"`);
    }
    descriptor(object["array"], where);
    for (const [name, field] of Object.entries(object["record"]?.recordValue ?? {})) {
      descriptor(field, `${where}.${name}`);
    }
  };
  const node = (entry: MilanoValue | undefined, path: string): void => {
    const object = entry?.recordValue ?? null;
    if (object === null) return;
    for (const key of Object.keys(object)) {
      if (!ENVELOPE_KEYS.has(key)) warnings.push(`${path}: unknown envelope key "${key}"`);
    }
    (object["children"]?.arrayValue ?? []).forEach((child, index) => {
      node(child, `${path}/children[${index}]`);
    });
  };
  const top = document.recordValue;
  if (top === null) return warnings;
  for (const key of Object.keys(top)) {
    if (!TOP_LEVEL_KEYS.has(key)) warnings.push(`document: unknown top-level key "${key}"`);
  }
  for (const key of Object.keys(top["vocabulary"]?.recordValue ?? {})) {
    if (!VOCABULARY_KEYS.has(key)) warnings.push(`vocabulary: unknown key "${key}"`);
  }
  for (const section of ["context", "state"]) {
    for (const [name, value] of Object.entries(top[section]?.recordValue ?? {})) {
      descriptor(value, `${section}.${name}`);
    }
  }
  node(top["root"], "root");
  return warnings;
}

const DETAIL_FIELDS = [
  "detail",
  "declared",
  "supported",
  "rule",
  "node",
  "expected",
  "found",
  "unknownType",
  "limit",
  "value",
  "actual",
] as const;

function describe(error: MilanoBuildError): ReportedError {
  const detail: Record<string, string | number | readonly number[]> = {};
  for (const field of DETAIL_FIELDS) {
    const value = error[field];
    if (value !== null) detail[field] = value;
  }
  return { type: error.type, message: error.message, detail };
}

/**
 * The document's declared context types, read ahead of the gate so the
 * values can be synthesized the way the quick path synthesizes state. A
 * document the gate will reject anyway yields nothing here; the gate then
 * says why, in its own terms.
 */
function declaredContext(documentText: string): Record<string, MilanoType> {
  const types: Record<string, MilanoType> = {};
  let document: MilanoValue;
  try {
    document = parseJson(documentText);
  } catch {
    return types;
  }
  const declarations = document.recordValue?.["context"]?.recordValue ?? {};
  for (const [key, descriptor] of Object.entries(declarations)) {
    const type = MilanoType.fromDescriptor(descriptor);
    if (type !== null) types[key] = type;
  }
  return types;
}

/**
 * Runs one document through the full gate: parse, version, vocabulary
 * requirement, limits, the vocabulary walk with expression typing, and
 * the data checks, with a renderer for every declared type so the
 * unknown-type policy decides exactly what it decides in an app. Declared
 * context and state are synthesized as zero-values unless supplied, and a
 * document that binds custom actions gets a handler, so a valid document
 * builds. Throws `MilanoEngineError` for an invalid vocabulary: that is
 * the producer's setup, not the document.
 */
export async function validate(options: ValidateOptions): Promise<ValidationReport> {
  const vocabulary = MilanoVocabulary.parse(options.vocabulary);
  const registry = new MilanoRegistry<true, true>();
  for (const type of Object.keys(vocabulary.components)) registry.register(type, true);
  registry.registerPlaceholder(true);

  const warnings = unknownKeyWarnings(options.document);
  const occurrences: ReportedOccurrence[] = [];
  const engine = new MilanoEngine<true, true>({
    vocabularyJson: options.vocabulary,
    registry,
    defaultUnknownTypePolicy: options.unknownTypes ?? "fail",
    observer: {
      occurrence: ({ kind, node, name, expected, found }) => {
        occurrences.push({
          kind,
          node,
          name: name ?? null,
          expected: expected ?? null,
          found: found ?? null,
        });
      },
    },
  });

  try {
    const view = await engine
      .viewBuilder(options.document)
      .context(synthesizedState(declaredContext(options.document), options.context ?? {}))
      .stateData((declarations) => synthesizedState(declarations, options.state ?? {}))
      .actionHandler(() => null)
      .build();
    view.teardown();
  } catch (error) {
    if (error instanceof MilanoBuildError) {
      return { valid: false, error: describe(error), occurrences: [], warnings };
    }
    throw error;
  }
  return { valid: true, error: null, occurrences, warnings };
}
