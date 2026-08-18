// Stamps a release version into the TypeScript packages: each package's
// own version, every `@get-milano/*` dependency range between them, and
// the engine's MilanoInfo. The equivalent of the sed stamps the Swift and
// Kotlin lanes run, kept here because three files must agree.
//
//   node scripts/stamp-version.mjs 1.1.0
//
// Idempotent, and it fails loudly if a file changed shape, so a silent
// half-stamped publish is impossible.
//
// CI-only. release.yml runs this in a runner that builds, tests, and
// publishes, then is discarded; the stamp never reaches main. Run by hand,
// it does the same edit to your working tree, and the result looks
// identical to a passing commit until check-consistency.mjs notices
// info.ts carries a real version instead of the development placeholder
// (this happened twice: once from the original run, once from someone
// re-running it after the first fix). Set MILANO_ALLOW_LOCAL_STAMP=1 to
// stamp locally anyway, e.g. to inspect the output before a release.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.CI !== "true" && process.env.MILANO_ALLOW_LOCAL_STAMP !== "1") {
  console.error(
    "stamp-version.mjs is meant to run inside release.yml's CI runner, not locally.\n" +
      "Running it here edits your working tree the same way, and the stamp will\n" +
      "look like a normal commit until check-consistency.mjs flags info.ts as\n" +
      "carrying a real version instead of the development placeholder.\n\n" +
      "To bump a released version, edit VERSION by hand and run\n" +
      "check-consistency.mjs to find everything else that needs updating.\n\n" +
      "To run this anyway (e.g. to inspect the stamped output before a release),\n" +
      "set MILANO_ALLOW_LOCAL_STAMP=1.",
  );
  process.exit(1);
}

const version = process.argv[2];
if (version === undefined || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`usage: node scripts/stamp-version.mjs <version>, got: ${version ?? "(nothing)"}`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["engine/ts", "engine/react"];

for (const directory of packages) {
  const path = join(root, directory, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = version;
  for (const field of ["dependencies", "peerDependencies"]) {
    const block = manifest[field];
    if (block === undefined) continue;
    for (const name of Object.keys(block)) {
      if (name.startsWith("@get-milano/")) block[name] = `^${version}`;
    }
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`stamped ${directory} at ${version}`);
}

const infoPath = join(root, "engine/ts/src/core/info.ts");
const info = readFileSync(infoPath, "utf8");
const stamped = info.replace(/version: "[^"]*"/, `version: "${version}"`);
if (!stamped.includes(`version: "${version}"`)) {
  console.error("version stamp failed; info.ts changed shape");
  process.exit(1);
}
writeFileSync(infoPath, stamped);
console.log(`stamped engine/ts/src/core/info.ts at ${version}`);
