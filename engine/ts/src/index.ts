/**
 * Milano: Document-Driven UI. Documents in, resolved trees out, validated
 * by a strict gate. This package is the contract engine: no UI toolkit, no
 * dependencies, conformant against the shared vector suite.
 */

// Values and types.
export { MilanoValue } from "./core/value.ts";
export type { MilanoValueKind } from "./core/value.ts";
export { MilanoType } from "./core/type.ts";
export type { MilanoTypeKind } from "./core/type.ts";
export { isValidIdentifier } from "./core/identifier.ts";
export { MilanoInfo } from "./core/info.ts";

/**
 * JSON bridging: hosts feed providers and context straight from API
 * responses, and the int/double distinction survives, which `JSON.parse`
 * cannot promise.
 */
export { parseJson, MilanoJsonError } from "./core/json.ts";
export { formatDouble, unicodeScalarCount, utf8ByteLength } from "./core/text.ts";

// Engine and configuration.
export { MilanoEngine, MilanoRegistry } from "./engine/engine.ts";
export type { MilanoEngineOptions } from "./engine/engine.ts";
export { MilanoVocabulary, SUPPORTED_MAJORS } from "./engine/vocabulary.ts";
export type { MilanoAction as MilanoActionDeclaration, MilanoComponent } from "./engine/vocabulary.ts";
export { defaultLimits } from "./engine/configuration.ts";
export type { MilanoLimits, MilanoUnknownTypePolicy } from "./engine/configuration.ts";

// Observability and analytics: two separate streams.
export type { MilanoObserver, MilanoOccurrence, MilanoOccurrenceKind } from "./engine/observer.ts";
export type {
  MilanoUserInteraction,
  MilanoUserInteractionKind,
  MilanoUserInteractionObserver,
} from "./engine/interaction.ts";

// Building and running a view.
export { MilanoViewBuilder } from "./runtime/builder.ts";
export { MilanoView } from "./runtime/view.ts";
export type { ViewRuntime } from "./runtime/view.ts";
export { MilanoContextHandle, StaticContextSource } from "./runtime/context-source.ts";
export type { MilanoContextSource } from "./runtime/context-source.ts";
export { inlineDispatcher } from "./runtime/dispatcher.ts";
export type { MilanoDispatcher } from "./runtime/dispatcher.ts";
export type {
  MilanoAction,
  MilanoActionHandler,
  MilanoStateDataProvider,
} from "./runtime/handlers.ts";
export { quickBuilder, synthesizedState } from "./runtime/quick-start.ts";
export type { QuickStartOptions } from "./runtime/quick-start.ts";

// The resolved tree a binding renders.
export type { ResolvedNode } from "./gate/resolver.ts";

// Typed failures.
export { MilanoBuildError, MilanoEngineError } from "./document/errors.ts";
export type { MilanoBuildErrorKind, MilanoEngineErrorKind } from "./document/errors.ts";
