// Stamps a release version into the TypeScript packages: each package's
// own version, every `@get-milano/*` dependency range between them, and
// the engine's MilanoInfo. The equivalent of the sed stamps the Swift and
// Kotlin lanes run, kept here because three files must agree.
//
//   node scripts/stamp-version.mjs 1.1.0
//
// Idempotent, and it fails loudly if a file changed shape, so a silent
// half-stamped publish is impossible.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
