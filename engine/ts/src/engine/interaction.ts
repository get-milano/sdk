import type { MilanoValue } from "../core/value.ts";

/**
 * The closed union of both sources: runtime-captured records (lifecycle,
 * emissions, dispatch, completions) and renderer-reported widget
 * interactions.
 */
export type MilanoUserInteractionKind =
  // Runtime-captured: nothing required from renderers or documents.
  | "viewBuilt"
  | "viewTornDown"
  | "event"
  | "actionDispatched"
  | "completionSucceeded"
  | "completionFailed"
  // Renderer-reported: signals the document does not model as events.
  | "tap"
  | "doubleTap"
  | "longPress"
  | "focusGained"
  | "focusLost"
  | "textChanged"
  | "toggled"
  | "selectionChanged"
  | "valueChanged"
  | "appeared"
  | "disappeared"
  | "scrolled";

/**
 * One user interaction, delivered to the engine's user-interaction
 * observer. Records pass everything through unredacted: Milano implements
 * no tracker, the receiving host owns the data.
 */
export interface MilanoUserInteraction {
  readonly kind: MilanoUserInteractionKind;
  readonly viewIdentity: string;
  /** The node's id or canonical path, when anchored to a node. */
  readonly node: string | null;
  /** The event or action name, when one applies. */
  readonly name: string | null;
  /**
   * The interaction's data: the emission payload, the captured action
   * parameters, the document metadata for `viewBuilt`, or whatever a
   * renderer supplies for widget kinds.
   */
  readonly value: MilanoValue | null;
}

/**
 * The engine's product-analytics stream, separate from `MilanoObserver`,
 * which carries engine observability only.
 */
export interface MilanoUserInteractionObserver {
  interaction(interaction: MilanoUserInteraction): void;
}
