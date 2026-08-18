import type { MilanoType } from "../core/type.ts";
import { MilanoValue } from "../core/value.ts";
import { MilanoEngine, MilanoRegistry } from "../engine/engine.ts";
import type { MilanoUserInteractionObserver } from "../engine/interaction.ts";
import type { MilanoObserver } from "../engine/observer.ts";
import type { MilanoViewBuilder } from "./builder.ts";
import type { MilanoActionHandler } from "./handlers.ts";

/**
 * The zero-value of a declaration: false, 0, 0.0, the empty string; null
 * for optionals; the alphabetically first member for an enum, which is
 * always a valid member; empty arrays; records recursed.
 */
function zeroValue(type: MilanoType): MilanoValue {
  if (type.optional) return MilanoValue.null;
  switch (type.kind.kind) {
    case "bool":
      return MilanoValue.bool(false);
    case "int":
      return MilanoValue.int(0n);
    case "double":
      return MilanoValue.double(0);
    case "string":
      return MilanoValue.string("");
    case "enum":
      return MilanoValue.string([...type.kind.members].sort()[0] as string);
    case "array":
      return MilanoValue.array([]);
    case "record": {
      const fields: Record<string, MilanoValue> = {};
      for (const [name, fieldType] of Object.entries(type.kind.fields)) {
        fields[name] = zeroValue(fieldType);
      }
      return MilanoValue.record(fields);
    }
  }
}

/** Zero-values per declaration, overridden by any supplied values. */
export function synthesizedState(
  declarations: Readonly<Record<string, MilanoType>>,
  supplied: Readonly<Record<string, MilanoValue>> = {},
): Record<string, MilanoValue> {
  const values: Record<string, MilanoValue> = {};
  for (const [key, type] of Object.entries(declarations)) {
    values[key] = supplied[key] ?? zeroValue(type);
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
