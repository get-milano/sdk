import type { MilanoValue } from "../core/value.ts";
import type { MilanoOccurrenceKind } from "../engine/observer.ts";
import { dependencies } from "../expression/dependencies.ts";
import { ExprEvaluator } from "../expression/evaluator.ts";
import type { DocValue } from "../document/model.ts";
import type { BuiltNode } from "./gate.ts";

/** A node with every property expression evaluated: what renderers see. */
export interface ResolvedNode {
  readonly type: string;
  readonly reference: string;
  readonly isPlaceholder: boolean;
  readonly rawSubtree: MilanoValue | null;
  readonly values: Readonly<Record<string, MilanoValue>>;
  readonly children: readonly ResolvedNode[];
}

type Report = (kind: MilanoOccurrenceKind, node: string, name: string) => void;

function evaluateProperty(
  value: Extract<DocValue, { kind: "typedExpression" }>,
  reference: string,
  name: string,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
): MilanoValue {
  const evaluator = new ExprEvaluator(state, context, null, null, (kind) =>
    report(kind, reference, name),
  );
  const result = evaluator.evaluate(value.expr);
  // Canonicalize toward the declared type (int where double is declared).
  return value.expected.validated(result) ?? result;
}

/**
 * The first resolution: every property expression evaluated, the whole
 * tree walked. Evaluation is total; division by zero and saturation
 * report through the occurrence pipeline, attributed to the owning node
 * and property.
 */
export function resolve(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
): ResolvedNode {
  const values: Record<string, MilanoValue> = {};
  for (const [name, value] of Object.entries(node.properties)) {
    switch (value.kind) {
      case "literal":
        values[name] = value.value;
        break;
      case "typedExpression":
        values[name] = evaluateProperty(value, node.reference, name, state, context, report);
        break;
      case "expression":
        // Unreachable: the gate types every expression.
        break;
    }
  }
  return {
    type: node.type,
    reference: node.reference,
    isPlaceholder: node.isPlaceholder,
    rawSubtree: node.rawSubtree,
    values,
    children: node.children.map((child) => resolve(child, state, context, report)),
  };
}

/**
 * What a built subtree reads: per property, the keys its expression
 * depends on; for the subtree as a whole, their union. Built once per view,
 * aligned with the built tree's children, so an update knows which nodes
 * to revisit without walking the rest.
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
 * was, so a host comparing identity sees exactly what changed. Returns
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
      value, node.reference, name, state, context, report,
    );
  }

  const children = node.children.map((child, position) =>
    refresh(
      child,
      index.children[position] as DependencyNode,
      resolved.children[position] as ResolvedNode,
      changed,
      state,
      context,
      report,
    ),
  );
  return { ...resolved, values, children };
}
