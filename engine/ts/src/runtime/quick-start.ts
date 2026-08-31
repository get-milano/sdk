import type { MilanoType } from "../core/type.ts";
import { MilanoValue } from "../core/value.ts";
import { MilanoEngine, MilanoRegistry } from "../engine/engine.ts";
import type { MilanoUserInteractionObserver } from "../engine/interaction.ts";
import type { MilanoObserver } from "../engine/observer.ts";
import { zeroValueOf } from "../expression/evaluator.ts";
import type { MilanoViewBuilder } from "./builder.ts";
import type { MilanoActionHandler } from "./handlers.ts";

/**
 * Zero-values per declaration, overridden by any supplied values. The
 * zero is the contract's own (`zeroValueOf`), so a synthesized value is
 * the same value an invalid function result of that type would produce.
 * Enums are why that matters: this once took the alphabetically first
 * member while the contract takes the first declared, so a preview could
 * differ from the engine over the same declaration.
 */
export function synthesizedState(
  declarations: Readonly<Record<string, MilanoType>>,
  supplied: Readonly<Record<string, MilanoValue>> = {},
): Record<string, MilanoValue> {
  const values: Record<string, MilanoValue> = {};
  for (const [key, type] of Object.entries(declarations)) {
    values[key] = supplied[key] ?? zeroValueOf(type);
  }
  return values;
}

export interface QuickStartOptions<R> {
  /** The document, as text or raw bytes. */
  readonly document: string | Uint8Array;
  /** The vocabulary artifact, as JSON text. */
  readonly vocabulary: string;
  readonly renderers: Readonly<Record<string, R>>;
  readonly context?: Readonly<Record<string, MilanoValue>>;
  /** Overrides for declared state; anything omitted is synthesized. */
  readonly state?: Readonly<Record<string, MilanoValue>>;
  readonly onAction?: MilanoActionHandler | null;
  readonly observer?: MilanoObserver | null;
  readonly userInteractionObserver?: MilanoUserInteractionObserver | null;
}

/**
 * The quick path's construction: engine, registry, and builder in one
 * call, with declared state synthesized as zero-values so a first
 * integration is a single component. The full architecture (a shared
 * engine, explicit providers) remains the shape for real apps.
 */
export function quickBuilder<R, P = R>(options: QuickStartOptions<R>): MilanoViewBuilder<R, P> {
  const registry = new MilanoRegistry<R, P>();
  for (const [type, renderer] of Object.entries(options.renderers)) {
    registry.register(type, renderer);
  }
  const engine = new MilanoEngine<R, P>({
    vocabularyJson: options.vocabulary,
    registry,
    observer: options.observer ?? null,
    userInteractionObserver: options.userInteractionObserver ?? null,
  });
  const builder = engine
    .viewBuilder(options.document)
    .context(options.context ?? {})
    .stateData((declarations) => synthesizedState(declarations, options.state ?? {}));
  if (options.onAction !== undefined && options.onAction !== null) {
    builder.actionHandler(options.onAction);
  }
  return builder;
}
