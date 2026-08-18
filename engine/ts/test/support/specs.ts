import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The specs checkout holding the conformance suite: MILANO_SPECS_DIR wins,
 * otherwise the sibling `specs` repository, the same convention the Swift
 * and Kotlin drivers use.
 */
export function specsDirectory(): string {
  const configured = process.env["MILANO_SPECS_DIR"];
  if (configured !== undefined && configured.length > 0) return configured;
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = resolve(here, "..", "..", "..", "..", "..", "specs");
  if (!existsSync(join(sibling, "conformance"))) {
    throw new Error(`specs repository not found at ${sibling}`);
  }
  return sibling;
}
