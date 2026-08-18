// Typed bindings from the vocabulary, the same build step the SwiftUI and
// Compose samples run. The committed output is refreshed before every
// typecheck, so it can never drift from vocabulary.json, and compiling it
// is what proves the generator's TypeScript emitter still works.
//
// The generator lives in the specs repository: a sibling checkout, or
// MILANO_SPECS_DIR.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specs = process.env["MILANO_SPECS_DIR"] ?? resolve(root, "..", "..", "..", "specs");
const generator = join(specs, "tools", "generate_bindings.py");

if (!existsSync(generator)) {
  console.error(
    `no generator at ${generator}\n` +
      "set MILANO_SPECS_DIR, or check out get-milano/specs beside the sdk",
  );
  process.exit(1);
}

const out = join(root, "src", "bindings.generated.ts");
execFileSync(
  "python3",
  [
    generator,
    join(root, "documents", "vocabulary.json"),
    "--ts-prefix",
    "Sample",
    "--ts-out",
    out,
  ],
  { stdio: "inherit" },
);
