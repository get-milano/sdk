import type { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";

/** A dispatched custom action, delivered as data. */
export interface MilanoAction {
  readonly name: string;
  readonly parameters: Readonly<Record<string, MilanoValue>>;
  readonly viewIdentity: string;
}

/**
 * An asynchronous receiver of custom actions: one funnel per view.
 * Resolving is success, and the resolved value, validated against the
 * action's declared `result` type, binds the `result` root inside
 * `onSuccess`; resolve `null` for actions declaring no result. Rejecting
 * is failure. Completion-exactly-once holds by construction.
 */
export type MilanoActionHandler = (
  action: MilanoAction,
) => Promise<MilanoValue | null> | MilanoValue | null;

/**
 * The async source of initial state values: the declared shape in, values
 * out. Awaited during build; its errors propagate to the build caller
 * unchanged.
 */
export type MilanoStateDataProvider = (
  declarations: Readonly<Record<string, MilanoType>>,
) =>
  | Promise<Readonly<Record<string, MilanoValue>>>
  | Readonly<Record<string, MilanoValue>>;
