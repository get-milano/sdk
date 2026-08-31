import { own } from "../core/lookup.ts";
import type { MilanoValue } from "../core/value.ts";
import { MilanoValue as Value } from "../core/value.ts";
import type { MilanoOccurrenceKind } from "../engine/observer.ts";
import { dependencies } from "../expression/dependencies.ts";
import type { EvalEnvironment, ReportDetail } from "../expression/evaluator.ts";
import { ExprEvaluator, NO_FUNCTIONS } from "../expression/evaluator.ts";
import type { DocValue } from "../document/model.ts";
import type { BuiltNode } from "./gate.ts";

/**
 * The resolved tree a binding renders: every property a value. Immutable;
 * re-resolution produces a new tree, sharing untouched subtrees.
 */
export interface ResolvedNode {
  readonly type: string;
  readonly reference: string;
  /**
   * The template node's reference and, for a `$repeat` instance, the
   * identity of each enclosing instance (an index or a key rendering,
   * outermost first), which together make `reference`. Internal: what
   * lets an emission find its template without parsing the reference.
   */
  readonly base: string;
  readonly identities: readonly string[];
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

/**
 * An occurrence raised while resolving: the kind, the node and property
 * being resolved, and, for an invalid function result, its detail (whose
 * `name` is the function's, overriding the property's).
 */
export type Report = (
  kind: MilanoOccurrenceKind,
  node: string,
  name: string,
  detail?: ReportDetail,
) => void;
type Bindings = Readonly<Record<string, MilanoValue>>;

/**
 * Two elements of a keyed `$repeat` rendering the same key: a data
 * defect. The gate reports it as a build error; at runtime the update
 * that produced it is rejected whole.
 */
export class RepeatKeyConflict extends Error {
  readonly reference: string;
  readonly key: string;

  constructor(reference: string, key: string) {
    super(`repeat ${reference} has two elements with key ${key}`);
    this.name = "RepeatKeyConflict";
    this.reference = reference;
    this.key = key;
  }
}

/**
 * A key's rendering in an instance reference (document model spec,
 * Constructs): a string verbatim, an int in decimal.
 */
export function renderKey(value: MilanoValue): string {
  return value.stringValue ?? String(value.intValue ?? "");
}

/**
 * The identity of every instance a `$repeat` materializes: the key's
 * rendering per element when it declares one, the element index
 * otherwise. Keys are distinct within one materialization.
 */
export function instanceIdentities(
  node: BuiltNode,
  reference: string,
  elements: readonly MilanoValue[],
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  env: EvalEnvironment = NO_FUNCTIONS,
): string[] {
  const spec = node.repeat;
  if (spec === null || spec.key === null || spec.key.kind !== "typedExpression") {
    return elements.map((_, index) => String(index));
  }
  const key = spec.key;
  const identities: string[] = [];
  const seen = new Set<string>();
  elements.forEach((element, index) => {
    const bound = elementBindings(spec.as, element, index, bindings);
    const identity = renderKey(evaluateProperty(key, reference, "key", state, context, report, bound, env));
    if (seen.has(identity)) throw new RepeatKeyConflict(reference, identity);
    seen.add(identity);
    identities.push(identity);
  });
  return identities;
}

function evaluateProperty(
  value: Extract<DocValue, { kind: "typedExpression" }>,
  reference: string,
  name: string,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  env: EvalEnvironment = NO_FUNCTIONS,
): MilanoValue {
  const evaluator = new ExprEvaluator(
    state,
    context,
    null,
    null,
    (kind, detail) => report(kind, reference, detail?.name ?? name, detail),
    bindings,
    null,
    env,
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
  env: EvalEnvironment = NO_FUNCTIONS,
): readonly MilanoValue[] {
  const spec = node.repeat;
  if (spec === null || spec.items.kind !== "typedExpression") return [];
  return evaluateProperty(spec.items, reference, "items", state, context, report, bindings, env).arrayValue ?? [];
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
  identities: readonly string[],
  env: EvalEnvironment,
): ResolvedNode[] {
  const spec = node.repeat;
  if (spec === null) return [];
  const instances: ResolvedNode[] = [];
  const reference = node.reference + suffixOf(identities);
  const elements = repeatElements(node, reference, state, context, report, bindings, env);
  const instanceIds = instanceIdentities(node, reference, elements, state, context, report, bindings, env);
  elements.forEach((element, index) => {
    const bound = elementBindings(spec.as, element, index, bindings);
    const instanceIdentities_ = [...identities, instanceIds[index] as string];
    for (const template of node.children) {
      // A nested construct instantiates within this element's scope.
      instances.push(
        ...materialize(template, state, context, report, bound, instanceIdentities_, env),
      );
    }
  });
  return instances;
}

/**
 * The `$if` construct (document model spec, Constructs): the condition is
 * evaluated and only the chosen branch materializes, as only the taken
 * branch of the `$if` function is evaluated. Like a repeat, the construct
 * is transparent: its branch's nodes take its place in the parent.
 */
function resolveConditional(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  identities: readonly string[],
  env: EvalEnvironment,
): ResolvedNode[] {
  const spec = node.conditional;
  if (spec === null) return [];
  const reference = node.reference + suffixOf(identities);
  if (spec.condition.kind !== "typedExpression") return [];
  const taken = evaluateProperty(
    spec.condition, reference, "condition", state, context, report, bindings, env,
  );
  const branch = taken.boolValue === true ? spec.then : spec.otherwise;
  const chosen: ResolvedNode[] = [];
  for (const child of branch) {
    chosen.push(...materialize(child, state, context, report, bindings, identities, env));
  }
  return chosen;
}

/**
 * The `$switch` construct (document model spec, Constructs): the subject
 * is evaluated and only the member's branch materializes, or the default
 * when the cases do not name it.
 */
function resolveSwitch(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  identities: readonly string[],
  env: EvalEnvironment,
): ResolvedNode[] {
  const spec = node.choice;
  if (spec === null || spec.subject.kind !== "typedExpression") return [];
  const reference = node.reference + suffixOf(identities);
  const member = evaluateProperty(
    spec.subject, reference, "subject", state, context, report, bindings, env,
  ).stringValue;
  const branch = (member === null ? undefined : own(spec.cases, member)) ?? spec.fallback ?? [];
  const chosen: ResolvedNode[] = [];
  for (const child of branch) {
    chosen.push(...materialize(child, state, context, report, bindings, identities, env));
  }
  return chosen;
}

/**
 * One document node as the nodes it materializes: itself, or, for a
 * transparent construct, however many its branch or its elements make.
 */
function materialize(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  identities: readonly string[],
  env: EvalEnvironment,
): ResolvedNode[] {
  if (node.repeat !== null) {
    return resolveRepeat(node, state, context, report, bindings, identities, env);
  }
  if (node.conditional !== null) {
    return resolveConditional(node, state, context, report, bindings, identities, env);
  }
  if (node.choice !== null) {
    return resolveSwitch(node, state, context, report, bindings, identities, env);
  }
  return [resolve(node, state, context, report, bindings, identities, env)];
}

/** The bracketed identities that make an instance reference: `[2][abc]`. */
export function suffixOf(identities: readonly string[]): string {
  let suffix = "";
  for (const identity of identities) suffix += `[${identity}]`;
  return suffix;
}

function resolveChildren(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings,
  identities: readonly string[],
  env: EvalEnvironment,
): { children: ResolvedNode[]; spans: number[] } {
  const children: ResolvedNode[] = [];
  const spans: number[] = [];
  for (const child of node.children) {
    const materialized = materialize(child, state, context, report, bindings, identities, env);
    children.push(...materialized);
    spans.push(materialized.length);
  }
  return { children, spans };
}

/**
 * The first resolution: every property expression evaluated, the whole
 * tree walked, every `$repeat` materialized. Evaluation is total;
 * division by zero and saturation report through the occurrence
 * pipeline, attributed to the owning node and property. Inside a repeat
 * instance, `identities` carries the element indices or key renderings
 * that make its reference. Throws `RepeatKeyConflict` when a keyed
 * repeat renders one key twice.
 */
export function resolve(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: Report,
  bindings: Bindings = {},
  identities: readonly string[] = [],
  env: EvalEnvironment = NO_FUNCTIONS,
): ResolvedNode {
  const reference = node.reference + suffixOf(identities);
  const values: Record<string, MilanoValue> = {};
  for (const [name, value] of Object.entries(node.properties)) {
    switch (value.kind) {
      case "literal":
        values[name] = value.value;
        break;
      case "typedExpression":
        values[name] = evaluateProperty(value, reference, name, state, context, report, bindings, env);
        break;
      case "expression":
        // Unreachable: the gate types every expression.
        break;
    }
  }
  const { children, spans } = resolveChildren(node, state, context, report, bindings, identities, env);
  return {
    type: node.type,
    reference,
    base: node.reference,
    identities,
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
  if (node.repeat !== null && node.repeat.key !== null && node.repeat.key.kind === "typedExpression") {
    const keys = dependencies(node.repeat.key.expr);
    own.set("key", keys);
    for (const key of keys) subtree.add(key);
  }
  // A construct's own expression decides which branch materializes, so a
  // change to what it reads is a change to the subtree.
  if (node.conditional !== null && node.conditional.condition.kind === "typedExpression") {
    const keys = dependencies(node.conditional.condition.expr);
    own.set("condition", keys);
    for (const key of keys) subtree.add(key);
  }
  if (node.choice !== null && node.choice.subject.kind === "typedExpression") {
    const keys = dependencies(node.choice.subject.expr);
    own.set("subject", keys);
    for (const key of keys) subtree.add(key);
  }
  // Branch nodes are indexed too, so their reads reach this subtree.
  // `refresh` addresses `children` positionally against `node.children`,
  // and these sit past that range, read only for the union.
  const branches = [
    ...(node.conditional?.then ?? []),
    ...(node.conditional?.otherwise ?? []),
    ...Object.values(node.choice?.cases ?? {}).flat(),
    ...(node.choice?.fallback ?? []),
  ];
  const children = [...node.children, ...branches].map(indexDependencies);
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
  env: EvalEnvironment = NO_FUNCTIONS,
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
      value, resolved.reference, name, state, context, report, {}, env,
    );
  }

  const children: ResolvedNode[] = [];
  const spans: number[] = [];
  let offset = 0;
  node.children.forEach((child, position) => {
    const span = resolved.spans[position] ?? 1;
    const childIndex = index.children[position] as DependencyNode;
    // Every transparent construct re-materializes wholesale: how many
    // nodes it makes is its own business, and a changed condition or
    // subject can change which nodes those are.
    if (child.repeat !== null || child.conditional !== null || child.choice !== null) {
      if (intersects(childIndex.subtree, changed)) {
        const made = materialize(child, state, context, report, {}, resolved.identities, env);
        children.push(...made);
        spans.push(made.length);
      } else {
        children.push(...resolved.children.slice(offset, offset + span));
        spans.push(span);
      }
    } else {
      children.push(
        refresh(child, childIndex, resolved.children[offset] as ResolvedNode, changed, state, context, report, env),
      );
      spans.push(1);
    }
    offset += span;
  });
  return { ...resolved, values, children, spans };
}
