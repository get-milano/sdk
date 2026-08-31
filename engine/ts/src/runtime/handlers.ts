import type { MilanoType } from "../core/type.ts";
import type { MilanoValue } from "../core/value.ts";

/** A dispatched custom action, delivered as data. */
export interface MilanoAction {
  readonly name: string;
  readonly parameters: Readonly<Record<string, MilanoValue>>;
  readonly viewIdentity: string;
  /**
   * The dispatch's position among the view's custom action dispatches,
   * counting from zero in delivery order (state and actions spec, Dispatch
   * identity). Deterministic; the conformance suite pins it.
   */
  readonly dispatch: number;
  /**
   * A string unique among every dispatch of every view in the process,
   * whatever the views' labels; its format is opaque. The host's
   * idempotency key toward whatever the handler calls.
   */
  readonly dispatchId: string;
}

/**
 * The failure a handler throws (or rejects with) to fail a dispatch with a
 * payload: the value is validated against the action's declared `failure`
 * type and bound to the `failure` root inside `onFailure`. Any other
 * thrown error is a failure with no payload.
 */
export class MilanoActionFailure extends Error {
  readonly value: MilanoValue | null;

  constructor(value: MilanoValue | null = null, message = "action failed") {
    super(message);
    this.name = "MilanoActionFailure";
    this.value = value;
  }
}

/**
 * An asynchronous receiver of custom actions: one funnel per view.
 * Resolving is success, and the resolved value, validated against the
 * action's declared `result` type, binds the `result` root inside
 * `onSuccess`; resolve `null` for actions declaring no result. Rejecting
 * is failure: with a `MilanoActionFailure`, its value is the failure
 * payload, validated against the declared `failure` type and bound to the
 * `failure` root inside `onFailure`; with anything else, the failure
 * carries no payload. Completion-exactly-once holds by construction.
 */
export type MilanoActionHandler = (
  action: MilanoAction,
) => Promise<MilanoValue | null> | MilanoValue | null;

/**
 * A host function call (expression spec, Host functions): the declared
 * function's name and its evaluated arguments, in declared order, each
 * already of its declared type.
 */
export interface MilanoFunctionCall {
  readonly name: string;
  readonly arguments: readonly MilanoValue[];
}

/**
 * The engine's synchronous resolver of host functions, one for every
 * view and every surface's declarations. Invoked on the thread evaluating
 * the expression, during resolution and action evaluation: it must be
 * fast, must not block, must not touch the view, and must be pure over
 * its arguments (vocabulary schema spec, Function declarations). The value
 * is validated against the declared `returns`; a mismatch or a throw is
 * an invalid function result, reported and replaced by the zero value of
 * the return type. Returning `null` is the null value.
 */
export type MilanoFunctionHandler = (call: MilanoFunctionCall) => MilanoValue | null;

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
