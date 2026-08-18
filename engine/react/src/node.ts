import { MilanoRegistry, MilanoValue } from "@get-milano/core";
import type {
  MilanoUserInteractionKind,
  MilanoView,
  ResolvedNode,
} from "@get-milano/core";
import { createElement } from "react";
import type { ComponentType, ReactElement } from "react";

/** What a renderer receives: one resolved node. */
export interface MilanoNodeProps {
  readonly node: MilanoNode;
}

/** A renderer is a React component for one declared component type. */
export type MilanoRenderer = ComponentType<MilanoNodeProps>;

export interface MilanoUnknownNodeProps {
  readonly node: MilanoUnknownNode;
}

/**
 * The placeholder renderer is a distinct component: it receives the
 * unknown node's raw subtree as data, never as live children.
 */
export type MilanoPlaceholderRenderer = ComponentType<MilanoUnknownNodeProps>;

/** The registry a React host renders from. */
export type MilanoReactRegistry = MilanoRegistry<MilanoRenderer, MilanoPlaceholderRenderer>;

/**
 * A registry typed for React. `new MilanoRegistry()` infers `unknown` for
 * its renderer type, which then fails to satisfy `MilanoHost`; this pins
 * both parameters so the ordinary path just compiles.
 */
export function createMilanoRegistry(): MilanoReactRegistry {
  return new MilanoRegistry<MilanoRenderer, MilanoPlaceholderRenderer>();
}

/**
 * A resolved node, ready to render: typed property reads, materialized
 * children with stable identity, and the emission surface.
 */
export class MilanoNode {
  private readonly view: MilanoView;
  private readonly registry: MilanoReactRegistry;
  private readonly resolved: ResolvedNode;

  constructor(view: MilanoView, registry: MilanoReactRegistry, resolved: ResolvedNode) {
    this.view = view;
    this.registry = registry;
    this.resolved = resolved;
  }

  /** The component type name. */
  get type(): string {
    return this.resolved.type;
  }

  /** The node's id, or canonical path when no id is declared. */
  get reference(): string {
    return this.resolved.reference;
  }

  /**
   * The resolved value of a declared property. Because the gate
   * type-checked everything, reading with the declared type's accessor
   * always succeeds; an absent optional is null.
   */
  property(name: string): MilanoValue {
    return this.resolved.values[name] ?? MilanoValue.null;
  }

  /**
   * The node's materialized children, ready to place. Each carries its
   * node reference as the React key, so identity survives re-resolution.
   * Always empty for types that do not declare children.
   */
  get children(): ReactElement[] {
    const rendered: ReactElement[] = [];
    for (const child of this.resolved.children) {
      const element = renderNode(this.view, this.registry, child);
      if (element !== null) rendered.push(element);
    }
    return rendered;
  }

  /**
   * Emits a declared event into dispatch; invalid emissions are dropped
   * and reported.
   */
  emit(event: string, payload: MilanoValue | null = null): void {
    this.view.emit(this.resolved.reference, event, payload);
  }

  /**
   * Reports a widget interaction to the engine's user-interaction stream,
   * for signals the document does not model as events (focus, visibility,
   * selection). Never touches dispatch or state.
   */
  userInteraction(
    kind: MilanoUserInteractionKind,
    value: MilanoValue | null = null,
  ): void {
    this.view.userInteraction(kind, this.resolved.reference, value);
  }
}

/** An unknown node routed to the placeholder renderer, as data. */
export class MilanoUnknownNode {
  readonly type: string;
  readonly reference: string;
  /** The node's whole subtree, verbatim, never as live children. */
  readonly subtree: MilanoValue | null;

  constructor(resolved: ResolvedNode) {
    this.type = resolved.type;
    this.reference = resolved.reference;
    this.subtree = resolved.rawSubtree;
  }
}

/**
 * Renders one resolved node through the registry. The engine guarantees
 * registry coverage, so a missing renderer is unreachable rather than a
 * runtime hazard; it renders nothing if the guarantee is ever bypassed.
 */
export function renderNode(
  view: MilanoView,
  registry: MilanoReactRegistry,
  resolved: ResolvedNode,
): ReactElement | null {
  if (resolved.isPlaceholder) {
    const placeholder = registry.placeholder;
    if (placeholder === null) return null;
    return createElement(placeholder, {
      key: resolved.reference,
      node: new MilanoUnknownNode(resolved),
    });
  }
  const renderer = registry.renderer(resolved.type);
  if (renderer === undefined) return null;
  return createElement(renderer, {
    key: resolved.reference,
    node: new MilanoNode(view, registry, resolved),
  });
}
