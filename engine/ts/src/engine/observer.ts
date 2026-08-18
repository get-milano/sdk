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
  | "rejectedContextUpdate"
  | "divisionByZero"
  | "saturation";

export interface MilanoOccurrence {
  readonly kind: MilanoOccurrenceKind;
  /** Stable identity of the originating view, plus the builder's label when set. */
  readonly viewIdentity: string;
  /** The node's id or canonical path, when one applies. */
  readonly node: string | null;
}

export interface MilanoObserver {
  occurrence(occurrence: MilanoOccurrence): void;
}
