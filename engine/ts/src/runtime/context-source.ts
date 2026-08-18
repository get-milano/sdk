import type { MilanoValue } from "../core/value.ts";

/**
 * Supplies and updates context values. Milano validates each change
 * atomically; an invalid update is rejected whole and reported.
 * `subscribe` returns a cancellation, invoked by the runtime at teardown
 * so a source never retains callbacks for views that are gone.
 */
export interface MilanoContextSource {
  readonly current: Readonly<Record<string, MilanoValue>>;
  subscribe(onUpdate: (values: Readonly<Record<string, MilanoValue>>) => void): () => void;
}

/**
 * The standard context source: create it with initial values, push updates
 * whenever they arrive.
 */
export class MilanoContextHandle implements MilanoContextSource {
  private values: Record<string, MilanoValue>;
  private readonly subscribers = new Map<
    number,
    (values: Readonly<Record<string, MilanoValue>>) => void
  >();
  private nextToken = 0;

  constructor(initial: Readonly<Record<string, MilanoValue>>) {
    this.values = { ...initial };
  }

  get current(): Readonly<Record<string, MilanoValue>> {
    return this.values;
  }

  subscribe(
    onUpdate: (values: Readonly<Record<string, MilanoValue>>) => void,
  ): () => void {
    const token = this.nextToken;
    this.nextToken += 1;
    this.subscribers.set(token, onUpdate);
    return () => {
      this.subscribers.delete(token);
    };
  }

  /** Merges the given values over the current ones and notifies views. */
  update(newValues: Readonly<Record<string, MilanoValue>>): void {
    this.values = { ...this.values, ...newValues };
    const snapshot = this.values;
    for (const subscriber of [...this.subscribers.values()]) subscriber(snapshot);
  }
}

/** A fixed context source for hosts with nothing to update. */
export class StaticContextSource implements MilanoContextSource {
  readonly current: Readonly<Record<string, MilanoValue>>;

  constructor(values: Readonly<Record<string, MilanoValue>>) {
    this.current = { ...values };
  }

  subscribe(): () => void {
    return () => {};
  }
}
