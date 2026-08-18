import type { MilanoValue } from "../core/value.ts";
import type { MilanoOccurrenceKind } from "../engine/observer.ts";
import { ExprEvaluator } from "../expression/evaluator.ts";
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

/**
 * Full re-evaluation: every resolution walks the whole tree. Evaluation is
 * total; division by zero and saturation report through the occurrence
 * pipeline, attributed to the owning node.
 */
export function resolve(
  node: BuiltNode,
  state: Readonly<Record<string, MilanoValue>>,
  context: Readonly<Record<string, MilanoValue>>,
  report: (kind: MilanoOccurrenceKind, node: string) => void,
): ResolvedNode {
  const values: Record<string, MilanoValue> = {};
  for (const [name, value] of Object.entries(node.properties)) {
    switch (value.kind) {
      case "literal":
        values[name] = value.value;
        break;
      case "typedExpression": {
        const evaluator = new ExprEvaluator(state, context, null, null, (kind) =>
          report(kind, node.reference),
        );
        const result = evaluator.evaluate(value.expr);
        // Canonicalize toward the declared type (int where double is declared).
        values[name] = value.expected.validated(result) ?? result;
        break;
      }
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
