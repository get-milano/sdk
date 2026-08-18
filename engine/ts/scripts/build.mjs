// Writes the per-format package.json markers so Node reads each dist
// folder with the right module system. No bundler involved.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
for (const [folder, type] of [
  ["esm", "module"],
  ["cjs", "commonjs"],
]) {
  mkdirSync(join(dist, folder), { recursive: true });
  writeFileSync(join(dist, folder, "package.json"), `${JSON.stringify({ type }, null, 2)}\n`);
}
