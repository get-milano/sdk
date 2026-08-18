import { quickBuilder } from "@get-milano/core";
import type {
  MilanoActionHandler,
  MilanoObserver,
  MilanoUserInteractionObserver,
  MilanoValue,
  MilanoView,
  MilanoViewBuilder,
} from "@get-milano/core";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";
import type {
  MilanoPlaceholderRenderer,
  MilanoReactRegistry,
  MilanoRenderer,
} from "./node.ts";
import { renderNode } from "./node.ts";

/** The builder shape a React host consumes. */
export type MilanoReactBuilder = MilanoViewBuilder<MilanoRenderer, MilanoPlaceholderRenderer>;

export type MilanoViewState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly view: MilanoView;
      /** The registry that built this view; never a later builder's. */
      readonly registry: MilanoReactRegistry;
    }
  | { readonly status: "failed"; readonly error: unknown };

/**
 * Builds the view for a builder and tears it down when it is replaced or
 * unmounted. The builder must be stable across renders (module scope or
 * `useMemo`): a new builder means a new build.
 */
export function useMilanoView(builder: MilanoReactBuilder): MilanoViewState {
  const [entry, setEntry] = useState<{
    readonly builder: MilanoReactBuilder;
    readonly state: MilanoViewState;
  }>(() => ({ builder, state: { status: "loading" } }));

  // Reset during render, not in the effect: effects flush after the frame
  // is painted, so waiting for one would show the previous document, and
  // would pair its nodes with the new builder's registry.
  if (entry.builder !== builder) {
    setEntry({ builder, state: { status: "loading" } });
  }

  useEffect(() => {
    let cancelled = false;
    let built: MilanoView | null = null;

    builder.build().then(
      (view) => {
        if (cancelled) {
          view.teardown();
          return;
        }
        built = view;
        setEntry({
          builder,
          state: { status: "ready", view, registry: builder.engine.registry },
        });
      },
      (error: unknown) => {
        if (!cancelled) setEntry({ builder, state: { status: "failed", error } });
      },
    );

    return () => {
      cancelled = true;
      built?.teardown();
    };
  }, [builder]);

  return entry.builder === builder ? entry.state : { status: "loading" };
}

export interface MilanoRenderedViewProps {
  readonly view: MilanoView;
  readonly registry: MilanoReactRegistry;
}

/**
 * Renders a built view and keeps it live. Use it with `useMilanoView` when
 * the host component is not enough; `MilanoHost` is the two of them
 * together.
 *
 * The resolved root is a fresh object after every re-resolution, which is
 * exactly the snapshot `useSyncExternalStore` wants.
 */
export function MilanoRenderedView({
  view,
  registry,
}: MilanoRenderedViewProps): ReactElement | null {
  const subscribe = useCallback(
    (listener: () => void) => view.subscribe(listener),
    [view],
  );
  const snapshot = useCallback(() => view.resolvedRoot, [view]);
  const resolved = useSyncExternalStore(subscribe, snapshot, snapshot);
  return renderNode(view, registry, resolved);
}

export interface MilanoHostProps {
  /** Stable across renders: a new builder rebuilds the view. */
  readonly builder: MilanoReactBuilder;
  /** Shown while the document is validated and the state provider awaited. */
  readonly loading?: ReactNode;
  /** Shown when the build fails, with the typed error. */
  readonly failure?: (error: unknown) => ReactNode;
}

/**
 * The hosting component: builds the view, shows the loading content while
 * it builds, and renders the resolved tree through the engine's registry.
 * A failed build renders the failure content and nothing else.
 */
export function MilanoHost({
  builder,
  loading = null,
  failure,
}: MilanoHostProps): ReactNode {
  const state = useMilanoView(builder);
  if (state.status === "loading") return loading;
  if (state.status === "failed") return failure === undefined ? null : failure(state.error);
  return createElement(MilanoRenderedView, {
    view: state.view,
    registry: state.registry,
  });
}

export interface MilanoQuickHostProps {
  /** The document, as text or raw bytes. Stable across renders. */
  readonly document: string | Uint8Array;
  /** The vocabulary artifact, as JSON text. Stable across renders. */
  readonly vocabulary: string;
  /** Component type to renderer; stable across renders. */
  readonly renderers: Readonly<Record<string, MilanoRenderer>>;
  /** Stable across renders: a new object rebuilds the view. */
  readonly context?: Readonly<Record<string, MilanoValue>>;
  /**
   * Overrides for declared state; anything omitted is synthesized. Stable
   * across renders: a new object rebuilds the view, and rebuilding starts
   * the document over from its initial state.
   */
  readonly state?: Readonly<Record<string, MilanoValue>>;
  /** Free to be an inline closure: it is read through a ref. */
  readonly onAction?: MilanoActionHandler | null;
  /** Free to be an inline object: it is read through a ref. */
  readonly observer?: MilanoObserver | null;
  /** Free to be an inline object: it is read through a ref. */
  readonly userInteractionObserver?: MilanoUserInteractionObserver | null;
  readonly loading?: ReactNode;
  readonly failure?: (error: unknown) => ReactNode;
}

/**
 * The quick path: one component, no engine or registry to assemble.
 * Declared state is synthesized as zero-values, and both engine and build
 * failures land in the failure content. Use it for a first integration or
 * a simple embed; real apps share one engine across screens.
 *
 * Everything the engine is built from (document, vocabulary, renderers,
 * context, state) must be stable across renders, because a change rebuilds
 * the view and a rebuild restarts the document from its initial state. The
 * callbacks are exempt: they are read through refs, so passing an inline
 * closure costs nothing.
 */
export function MilanoQuickHost({
  document,
  vocabulary,
  renderers,
  context,
  state,
  onAction,
  observer,
  userInteractionObserver,
  loading = null,
  failure,
}: MilanoQuickHostProps): ReactNode {
  const callbacks = useRef({ onAction, observer, userInteractionObserver });
  useEffect(() => {
    callbacks.current = { onAction, observer, userInteractionObserver };
  });

  // Whether a callback was supplied is part of the engine's shape (an
  // engine with no interaction observer captures nothing), so presence is
  // a build input; the callback's identity is not.
  const hasAction = onAction !== undefined && onAction !== null;
  const hasObserver = observer !== undefined && observer !== null;
  const hasInteractionObserver =
    userInteractionObserver !== undefined && userInteractionObserver !== null;

  const built = useMemo<{ builder: MilanoReactBuilder } | { error: unknown }>(() => {
    try {
      return {
        builder: quickBuilder<MilanoRenderer, MilanoPlaceholderRenderer>({
          document,
          vocabulary,
          renderers,
          ...(context === undefined ? {} : { context }),
          ...(state === undefined ? {} : { state }),
          ...(hasAction
            ? { onAction: (action) => callbacks.current.onAction?.(action) ?? null }
            : {}),
          ...(hasObserver
            ? {
                observer: {
                  occurrence: (occurrence) =>
                    callbacks.current.observer?.occurrence(occurrence),
                },
              }
            : {}),
          ...(hasInteractionObserver
            ? {
                userInteractionObserver: {
                  interaction: (interaction) =>
                    callbacks.current.userInteractionObserver?.interaction(interaction),
                },
              }
            : {}),
        }),
      };
    } catch (error) {
      // An invalid vocabulary throws at engine creation, before any builder
      // exists: surface it through the same failure content as a build error.
      return { error };
    }
  }, [
    document,
    vocabulary,
    renderers,
    context,
    state,
    hasAction,
    hasObserver,
    hasInteractionObserver,
  ]);

  if ("error" in built) {
    return failure === undefined ? null : failure(built.error);
  }
  return createElement(MilanoHost, {
    builder: built.builder,
    loading,
    ...(failure === undefined ? {} : { failure }),
  });
}
