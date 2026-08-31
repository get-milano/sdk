/**
 * Engine observability: defects and diagnostics, never user interactions.
 * Anything the engine tolerates instead of failing is reported here.
 */
export type MilanoOccurrenceKind =
  | "unknownTypeSkipped"
  | "unknownTypePlaceholder"
  | "undeclaredProperty"
  | "droppedEvent"
  | "invalidEmission"
  | "invalidCompletion"
  | "duplicateCompletion"
  | "completionAfterTeardown"
  | "completionAfterReplace"
  | "rejectedContextUpdate"
  | "rejectedMutation"
  | "divisionByZero"
  | "saturation"
  | "invalidFunctionResult";

export interface MilanoOccurrence {
  readonly kind: MilanoOccurrenceKind;
  /** Stable identity of the originating view, plus the builder's label when set. */
  readonly viewIdentity: string;
  /** The node's id or canonical path, when one applies. */
  readonly node: string | null;
  /**
   * What the occurrence is about, when one thing is: the event, action,
   * property, component type, or context key involved.
   */
  readonly name?: string | null;
  /**
   * Detail in the gate's own terms, when it applies: the declared type or
   * shape that was expected, and the kind that arrived (or `missing`).
   */
  readonly expected?: string | null;
  readonly found?: string | null;
}

export interface MilanoObserver {
  occurrence(occurrence: MilanoOccurrence): void;
}
