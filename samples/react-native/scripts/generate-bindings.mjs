// Typed bindings from the vocabulary, the same build step the SwiftUI and
// Compose samples run. The committed output is refreshed before every
// typecheck, so it can never drift from vocabulary.json, and compiling it
// is what proves the generator's TypeScript emitter still works.
//
// The generator is `milano bindings` from @get-milano/cli. Inside this
// repository the CLI is the workspace package, built by `npm run build` at
// the repository root; a consumer project runs `npx milano bindings`.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "..", "..", "cli", "dist", "bin.js");

if (!existsSync(cli)) {
  console.error(`Milano CLI not built at ${cli}: run npm ci && npm run build at the repository root`);
  process.exit(1);
}

execFileSync(
  process.execPath,
  [
    cli,
    "bindings",
    join(root, "documents", "vocabulary.json"),
    "--ts-prefix",
    "Sample",
    "--ts-out",
    join(root, "src", "bindings.generated.ts"),
  ],
  { stdio: "inherit" },
);
