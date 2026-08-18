import { utf8ByteLength } from "../core/text.ts";
import { MilanoEngineError } from "../document/errors.ts";
import { MilanoViewBuilder } from "../runtime/builder.ts";
import type { MilanoLimits, MilanoUnknownTypePolicy } from "./configuration.ts";
import { defaultLimits } from "./configuration.ts";
import type { MilanoUserInteractionObserver } from "./interaction.ts";
import type { MilanoObserver } from "./observer.ts";
import { MilanoVocabulary } from "./vocabulary.ts";

/**
 * The renderer registry, generic over whatever a binding calls a renderer.
 * The core never renders, so it only enforces that the registry covers the
 * vocabulary; a React binding instantiates `R` with its component type.
 */
export class MilanoRegistry<R, P = R> {
  private readonly renderers = new Map<string, R>();
  private placeholderRenderer: P | null = null;

  register(type: string, renderer: R): this {
    this.renderers.set(type, renderer);
    return this;
  }

  registerPlaceholder(renderer: P): this {
    this.placeholderRenderer = renderer;
    return this;
  }

  renderer(type: string): R | undefined {
    return this.renderers.get(type);
  }

  get placeholder(): P | null {
    return this.placeholderRenderer;
  }

  get types(): readonly string[] {
    return [...this.renderers.keys()];
  }

  /**
   * A copy. An engine takes one at creation, so registering a renderer
   * afterwards cannot change what an existing engine renders, which is
   * what "immutable after creation" has to mean.
   */
  snapshot(): MilanoRegistry<R, P> {
    const copy = new MilanoRegistry<R, P>();
    for (const [type, renderer] of this.renderers) copy.renderers.set(type, renderer);
    if (this.placeholderRenderer !== null) copy.registerPlaceholder(this.placeholderRenderer);
    return copy;
  }
}

export interface MilanoEngineOptions<R, P = R> {
  /** The vocabulary artifact, as JSON text. */
  readonly vocabularyJson: string;
  readonly registry: MilanoRegistry<R, P>;
  /** Defaults to the contract default, *fail*. */
  readonly defaultUnknownTypePolicy?: MilanoUnknownTypePolicy;
  readonly limits?: MilanoLimits;
  /** Engine observability: defects and diagnostics. */
  readonly observer?: MilanoObserver | null;
  /** Product analytics: user interactions. */
  readonly userInteractionObserver?: MilanoUserInteractionObserver | null;
}

/**
 * The long-lived object: one vocabulary, one registry, one policy, and the
 * resource limits. Immutable after creation and safe to share; every view
 * is built from it.
 */
export class MilanoEngine<R = unknown, P = R> {
  readonly vocabulary: MilanoVocabulary;
  readonly registry: MilanoRegistry<R, P>;
  readonly defaultUnknownTypePolicy: MilanoUnknownTypePolicy;
  readonly limits: MilanoLimits;
  /** Retained for the engine's lifetime, like the other runtimes. */
  readonly observer: MilanoObserver | null;
  readonly userInteractionObserver: MilanoUserInteractionObserver | null;

  /**
   * Creation validates the vocabulary and the registry, failing fast with
   * `MilanoEngineError` on developer mistakes: `InvalidVocabulary` when the
   * artifact violates the spec, `IncompleteRegistry` when a declared
   * component type has no registered renderer.
   */
  constructor(options: MilanoEngineOptions<R, P>) {
    const vocabulary = MilanoVocabulary.parse(options.vocabularyJson);
    const policy = options.defaultUnknownTypePolicy ?? "fail";

    const missing = Object.keys(vocabulary.components)
      .filter((type) => options.registry.renderer(type) === undefined)
      .sort();
    if (policy === "placeholder" && options.registry.placeholder === null) {
      missing.push("(placeholder renderer)");
    }
    if (missing.length > 0) throw MilanoEngineError.incompleteRegistry(missing);

    this.vocabulary = vocabulary;
    this.registry = options.registry.snapshot();
    this.defaultUnknownTypePolicy = policy;
    // A frozen copy: a host that keeps its limits object and edits it
    // later must not be able to widen a running engine's bounds.
    this.limits = Object.freeze({ ...(options.limits ?? defaultLimits) });
    this.observer = options.observer ?? null;
    this.userInteractionObserver = options.userInteractionObserver ?? null;
    Object.freeze(this);
  }

  /**
   * A builder for one document, given as text or as raw bytes. With bytes,
   * the document-size limit is checked against exactly those bytes.
   */
  viewBuilder(document: string | Uint8Array): MilanoViewBuilder<R, P> {
    if (typeof document === "string") {
      return new MilanoViewBuilder<R, P>(this, document, utf8ByteLength(document));
    }
    if (typeof TextDecoder === "undefined") {
      throw new Error("TextDecoder is required to build a document from bytes");
    }
    const text = new TextDecoder("utf-8").decode(document);
    return new MilanoViewBuilder<R, P>(this, text, document.byteLength);
  }
}
