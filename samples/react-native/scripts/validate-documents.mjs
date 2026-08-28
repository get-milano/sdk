// Validates every bundled document against the sample vocabulary before
// the app ever runs, through `milano validate` from @get-milano/cli: the
// gate the app's own engine runs, so a document the engine would reject
// fails here with the same typed error. The SwiftUI and Compose samples
// run the same command as a build step.
//
// Inside this repository the CLI is the workspace package, built by
// `npm run build` at the repository root; a consumer project runs
// `npx milano validate`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const documents = join(root, "documents");
const cli = resolve(root, "..", "..", "cli", "dist", "bin.js");

if (!existsSync(cli)) {
  console.error(`Milano CLI not built at ${cli}: run npm ci && npm run build at the repository root`);
  process.exit(1);
}

const files = readdirSync(documents)
  .filter((name) => name.endsWith(".json") && name !== "vocabulary.json")
  .sort()
  .map((name) => join(documents, name));

execFileSync(process.execPath, [cli, "validate", ...files, "--vocabulary", join(documents, "vocabulary.json")], {
  stdio: "inherit",
});
console.log(`${files.length} documents validated`);
