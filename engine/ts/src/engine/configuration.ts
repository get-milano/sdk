/**
 * What a document using an unknown component type does: fail the build,
 * skip the node and its subtree, or route it to a placeholder renderer.
 * The contract default is fail; degradation is a per-surface decision.
 */
export type MilanoUnknownTypePolicy = "fail" | "skip" | "placeholder";

/**
 * Denial-of-service bounds for untrusted input, not supported working
 * sizes. Configurable per engine; the defaults are the contract's.
 */
export interface MilanoLimits {
  readonly maxTreeDepth: number;
  readonly maxNodeCount: number;
  readonly maxDocumentBytes: number;
  /** Counted in Unicode scalars. */
  readonly maxExpressionLength: number;
}

export const defaultLimits: MilanoLimits = Object.freeze({
  maxTreeDepth: 32,
  maxNodeCount: 10_000,
  maxDocumentBytes: 1_048_576,
  maxExpressionLength: 1_024,
});
