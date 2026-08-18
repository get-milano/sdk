/**
 * The closed set of typed errors the gate can throw, with the structured
 * detail each carries. Every error also carries a non-normative message.
 */
export type MilanoBuildErrorKind =
  | "MalformedDocument"
  | "UnsupportedVersion"
  | "SchemaViolation"
  | "UnknownComponentType"
  | "LimitExceeded";

export class MilanoBuildError extends Error {
  readonly type: MilanoBuildErrorKind;
  /** Location of the defect, when determinable (MalformedDocument). */
  readonly detail: string | null;
  /** The declared version and the runtime's supported majors. */
  readonly declared: string | null;
  readonly supported: readonly number[] | null;
  /** The rule violated, and its expected/found detail (SchemaViolation). */
  readonly rule: string | null;
  readonly node: string | null;
  readonly expected: string | null;
  readonly found: string | null;
  /** The unknown type name (UnknownComponentType). */
  readonly unknownType: string | null;
  /** The limit's name, its configured value, and the actual (LimitExceeded). */
  readonly limit: string | null;
  readonly value: number | null;
  readonly actual: number | null;

  private constructor(
    type: MilanoBuildErrorKind,
    message: string,
    fields: Partial<{
      detail: string;
      declared: string;
      supported: readonly number[];
      rule: string;
      node: string | null;
      expected: string | null;
      found: string | null;
      unknownType: string;
      limit: string;
      value: number;
      actual: number;
    }>,
  ) {
    super(message);
    this.name = "MilanoBuildError";
    this.type = type;
    this.detail = fields.detail ?? null;
    this.declared = fields.declared ?? null;
    this.supported = fields.supported ?? null;
    this.rule = fields.rule ?? null;
    this.node = fields.node ?? null;
    this.expected = fields.expected ?? null;
    this.found = fields.found ?? null;
    this.unknownType = fields.unknownType ?? null;
    this.limit = fields.limit ?? null;
    this.value = fields.value ?? null;
    this.actual = fields.actual ?? null;
  }

  /** Input is not well-formed JSON or violates envelope structure. */
  static malformedDocument(detail: string): MilanoBuildError {
    return new MilanoBuildError("MalformedDocument", `malformed document: ${detail}`, {
      detail,
    });
  }

  /** Declared major is outside the runtime's supported set. */
  static unsupportedVersion(declared: string, supported: readonly number[]): MilanoBuildError {
    return new MilanoBuildError(
      "UnsupportedVersion",
      `unsupported contract version ${declared}; supported majors: ${supported.join(", ")}`,
      { declared, supported },
    );
  }

  /** Vocabulary, typing, action encoding, event, id, or namespace rules violated. */
  static schemaViolation(
    rule: string,
    node: string | null = null,
    expected: string | null = null,
    found: string | null = null,
  ): MilanoBuildError {
    return new MilanoBuildError(
      "SchemaViolation",
      `schema violation (${rule}) at ${node ?? "-"}: expected ${expected ?? "-"}, found ${found ?? "-"}`,
      { rule, node, expected, found },
    );
  }

  /** A type not declared in the vocabulary, under the *fail* policy. */
  static unknownComponentType(node: string, unknownType: string): MilanoBuildError {
    return new MilanoBuildError(
      "UnknownComponentType",
      `unknown component type ${unknownType} at ${node}`,
      { node, unknownType },
    );
  }

  /** A resource limit exceeded at the gate. */
  static limitExceeded(limit: string, value: number, actual: number): MilanoBuildError {
    return new MilanoBuildError(
      "LimitExceeded",
      `limit ${limit} exceeded: ${actual} over ${value}`,
      { limit, value, actual },
    );
  }
}

/**
 * Developer mistakes found before any document is processed: an invalid
 * vocabulary artifact, or a registry that does not cover it.
 */
export type MilanoEngineErrorKind = "InvalidVocabulary" | "IncompleteRegistry";

export class MilanoEngineError extends Error {
  readonly type: MilanoEngineErrorKind;
  readonly rule: string | null;
  readonly detail: string | null;
  readonly missing: readonly string[] | null;

  private constructor(
    type: MilanoEngineErrorKind,
    message: string,
    fields: Partial<{ rule: string; detail: string; missing: readonly string[] }>,
  ) {
    super(message);
    this.name = "MilanoEngineError";
    this.type = type;
    this.rule = fields.rule ?? null;
    this.detail = fields.detail ?? null;
    this.missing = fields.missing ?? null;
  }

  static invalidVocabulary(rule: string, detail: string): MilanoEngineError {
    return new MilanoEngineError(
      "InvalidVocabulary",
      `invalid vocabulary (${rule}): ${detail}`,
      { rule, detail },
    );
  }

  static incompleteRegistry(missing: readonly string[]): MilanoEngineError {
    return new MilanoEngineError(
      "IncompleteRegistry",
      `incomplete registry, missing: ${missing.join(", ")}`,
      { missing },
    );
  }
}
