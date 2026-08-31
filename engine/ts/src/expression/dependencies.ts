import type { Expr } from "./ast.ts";

/**
 * The state and context keys an expression reads, as `state.<key>` and
 * `context.<key>`. A record field access counts as reading the whole key:
 * `state.address.city` depends on `state.address`. Computed once per
 * expression at build; it is what lets an update re-evaluate only what
 * reads a key whose value changed.
 */
export function dependencies(expr: Expr, into: Set<string> = new Set()): Set<string> {
  switch (expr.kind) {
    case "member":
      if (
        expr.base.kind === "root" &&
        (expr.base.name === "state" || expr.base.name === "context")
      ) {
        into.add(`${expr.base.name}.${expr.field}`);
      } else {
        dependencies(expr.base, into);
      }
      break;
    case "lookup":
      dependencies(expr.base, into);
      dependencies(expr.key, into);
      break;
    case "call":
      for (const argument of expr.args) dependencies(argument, into);
      break;
    case "unary":
      dependencies(expr.operand, into);
      break;
    case "binary":
      dependencies(expr.left, into);
      dependencies(expr.right, into);
      break;
    default:
      break;
  }
  return into;
}
