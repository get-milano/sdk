import type { MilanoValue } from "../core/value.ts";
import { MilanoValue as Value } from "../core/value.ts";
import type { MilanoOccurrenceKind } from "../engine/observer.ts";
import { dependencies } from "../expression/dependencies.ts";
import { ExprEvaluator } from "../expression/evaluator.ts";
import type { DocValue } from "../document/model.ts";
import type { BuiltNode } from "./gate.ts";

/**
 * The resolved tree a binding renders: every property a value. Immutable;
 * re-resolution produces a new tree, sharing untouched subtrees.
 */
export interface ResolvedNode {
  readonly type: string;
  readonly reference: string;
  readonly isPlaceholder: boolean;
  readonly rawSubtree: MilanoValue | null;
  readonly values: Readonly<Record<string, MilanoValue>>;
  readonly children: readonly ResolvedNode[];
  /**
   * Resolved children per built child, in order: one for a component
   * node, the instance count for a `$repeat`. Internal to re-resolution.
   */
  readonly spans: readonly number[];
}

type Report = (kind: MilanoOccurrenceKind, node: string, name: string) => void;
type Bindings = Readonly<Record<string, MilanoValue>>;

function evaluateProperty(
  value: Extract<DocValue, { kind: "typedExpression" }>,
  reference: string,
  name: string,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
): MilanoValue {
  const evaluator = new ExprEvaluator(
    state,
    context,
    null,
    null,
    (kind) => report(kind, reference, name),
    bindings,
  );
  const result = evaluator.evaluate(value.expr);
  // Canonicalize toward the declared type (int where double is declared).
  return value.expected.validated(result) ?? result;
}

/** The elements a `$repeat` instantiates over, right now. */
export function repeatElements(
  node: BuiltNode,
  reference: string,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
): readonly MilanoValue[] {
  const spec = node.repeat;
  if (spec === null || spec.items.kind !== "typedExpression") return [];
  return evaluateProperty(spec.items, reference, "items", state, context, report, bindings).arrayValue ?? [];
}

/** The template's bindings for one element. */
export function elementBindings(
  as: string,
  element: MilanoValue,
  index: number,
  outer: Bindings,
): Bindings {
  return { ...outer, [as]: element, [`${as}_index`]: Value.int(BigInt(index)) };
}

function resolveRepeat(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  suffix: string,
): ResolvedNode[] {
  const spec = node.repeat;
  if (spec === null) return [];
  const instances: ResolvedNode[] = [];
  const elements = repeatElements(node, node.reference + suffix, state, context, report, bindings);
  elements.forEach((element, index) => {
    const bound = elementBindings(spec.as, element, index, bindings);
    const instanceSuffix = `${suffix}[${index}]`;
    for (const template of node.children) {
      // A nested repeat instantiates within this element's scope.
      if (template.repeat !== null) {
        instances.push(...resolveRepeat(template, state, context, report, bound, instanceSuffix));
      } else {
        instances.push(resolve(template, state, context, report, bound, instanceSuffix));
      }
    }
  });
  return instances;
}

function resolveChildren(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  suffix: string,
): { children: ResolvedNode[]; spans: number[] } {
  const children: ResolvedNode[] = [];
  const spans: number[] = [];
  for (const child of node.children) {
    if (child.repeat !== null) {
      const instances = resolveRepeat(child, state, context, report, bindings, suffix);
      children.push(...instances);
      spans.push(instances.length);
    } else {
      children.push(resolve(child, state, context, report, bindings, suffix));
      spans.push(1);
    }
  }
  return { children, spans };
}

/**
 * The first resolution: every property expression evaluated, the whole
 * tree walked, every `$repeat` materialized. Evaluation is total;
 * division by zero and saturation report through the occurrence
 * pipeline, attributed to the owning node and property. Inside a repeat
 * instance, `suffix` carries the element indices that make its reference.
 */
export function resolve(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings = {},
  suffix = "",
): ResolvedNode {
  const reference = node.reference + suffix;
  const values: Record<string, MilanoValue> = {};
  for (const [name, value] of Object.entries(node.properties)) {
    switch (value.kind) {
      case "literal":
        values[name] = value.value;
        break;
      case "typedExpression":
        values[name] = evaluateProperty(value, reference, name, state, context, report, bindings);
        break;
      case "expression":
        // Unreachable: the gate types every expression.
        break;
    }
  }
  const { children, spans } = resolveChildren(node, state, context, report, bindings, suffix);
  return {
    type: node.type,
    reference,
    isPlaceholder: node.isPlaceholder,
    rawSubtree: node.rawSubtree,
    values,
    children,
    spans,
  };
}

/** Nodes in a resolved tree: the node count limit's runtime measure. */
export function countNodes(node: ResolvedNode): number {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}

/**
 * What a built subtree reads: per property, the keys its expression
 * depends on; for the subtree as a whole, their union. A `$repeat`'s
 * subtree includes what its `items` read, since every instance derives
 * from them. Built once per view, aligned with the built tree's children.
 */
export interface DependencyNode {
  readonly own: ReadonlyMap<string, ReadonlySet<string>>;
  readonly subtree: ReadonlySet<string>;
  readonly children: readonly DependencyNode[];
}

export function indexDependencies(node: BuiltNode): DependencyNode {
  const own = new Map<string, ReadonlySet<string>>();
  const subtree = new Set<string>();
  for (const [name, value] of Object.entries(node.properties)) {
    if (value.kind !== "typedExpression") continue;
    const keys = dependencies(value.expr);
    own.set(name, keys);
    for (const key of keys) subtree.add(key);
  }
  if (node.repeat !== null && node.repeat.items.kind === "typedExpression") {
    const keys = dependencies(node.repeat.items.expr);
    own.set("items", keys);
    for (const key of keys) subtree.add(key);
  }
  const children = node.children.map(indexDependencies);
  for (const child of children) for (const key of child.subtree) subtree.add(key);
  return { own, subtree, children };
}

function intersects(keys: ReadonlySet<string>, changed: ReadonlySet<string>): boolean {
  for (const key of keys) if (changed.has(key)) return true;
  return false;
}

/**
 * Re-resolution after an update: only the properties that read a changed
 * key are re-evaluated, only the path from those nodes to the root is
 * rebuilt, and an untouched subtree is returned as the very object it
 * was, so a host comparing identity sees exactly what changed. A `$repeat`
 * whose subtree reads a changed key is re-materialized whole. Returns
 * `resolved` itself when nothing under it depends on the change.
 */
export function refresh(
  node: BuiltNode,
  index: DependencyNode,
  resolved: ResolvedNode,
  changed: ReadonlySet<string>,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
): ResolvedNode {
  if (!intersects(index.subtree, changed)) return resolved;

  let values = resolved.values;
  let copied = false;
  for (const [name, keys] of index.own) {
    if (!intersects(keys, changed)) continue;
    const value = node.properties[name];
    if (value === undefined || value.kind !== "typedExpression") continue;
    if (!copied) {
      values = { ...resolved.values };
      copied = true;
    }
    (values as Record<string, MilanoValue>)[name] = evaluateProperty(
      value, resolved.reference, name, state, context, report, {},
    );
  }

  const children: ResolvedNode[] = [];
  const spans: number[] = [];
  let offset = 0;
  node.children.forEach((child, position) => {
    const span = resolved.spans[position] ?? 1;
    const childIndex = index.children[position] as DependencyNode;
    if (child.repeat !== null) {
      if (intersects(childIndex.subtree, changed)) {
        const instances = resolveRepeat(child, state, context, report, {}, "");
        children.push(...instances);
        spans.push(instances.length);
      } else {
        children.push(...resolved.children.slice(offset, offset + span));
        spans.push(span);
      }
    } else {
      children.push(
        refresh(child, childIndex, resolved.children[offset] as ResolvedNode, changed, state, context, report),
      );
      spans.push(1);
    }
    offset += span;
  });
  return { ...resolved, values, children, spans };
}
