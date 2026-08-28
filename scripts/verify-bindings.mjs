#!/usr/bin/env node
// Compiles the bindings generator's goldens against the engines.
//
// The generator lives in the specs repository, whose tests are pure
// Python: they pin the generated text but cannot compile it, since that
// repository stays engine-free. This is where the other half happens.
// Each lane takes the committed golden for one language
// (specs/tools/testdata/expected_bindings.*) and compiles it against the
// engine it targets, so a generator change that stops compiling fails
// here, and an engine change that breaks the bindings' contract fails
// here too. The samples compile their own generated bindings as well,
// but their vocabulary does not reach every construct; the fixture does.
//
//   node scripts/verify-bindings.mjs typescript swift kotlin
//
// The specs checkout is found the way the conformance harnesses find it:
// MILANO_SPECS_DIR, or the sibling checkout.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specs = process.env["MILANO_SPECS_DIR"] ?? resolve(root, "..", "specs");
const goldens = resolve(specs, "tools", "testdata");

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function typescript() {
  // The golden imports @get-milano/core; a scratch project maps that name
  // onto the package's published shape (its built declarations, the same
  // ones a consumer compiles against) under the engine's own compiler
  // options.
  const declarations = resolve(root, "engine/ts/dist/types/index.d.ts");
  if (!existsSync(declarations)) run("npm", ["run", "build", "--workspace", "engine/ts"]);
  const scratch = mkdtempSync(join(tmpdir(), "milano-bindings-"));
  const golden = join(scratch, "expected_bindings.ts");
  copyFileSync(join(goldens, "expected_bindings.ts"), golden);
  writeFileSync(
    join(scratch, "tsconfig.json"),
    JSON.stringify(
      {
        extends: resolve(root, "engine/ts/tsconfig.json"),
        compilerOptions: {
          paths: { "@get-milano/core": [declarations] },
        },
        include: [],
        files: [golden],
      },
      null,
      2,
    ),
  );
  run(resolve(root, "node_modules/.bin/tsc"), ["-p", join(scratch, "tsconfig.json")]);
}

function swift() {
  run("swift", ["build"]);
  run("swiftc", [
    "-typecheck",
    "-I", resolve(root, ".build/debug/Modules"),
    join(goldens, "expected_bindings.swift"),
  ]);
}

function kotlin() {
  // engine/compose/build.gradle.kts stages the golden into the JVM test
  // sources; compiling them is the check.
  run(resolve(root, "engine/compose/gradlew"), ["compileTestKotlinJvm", "-q"], resolve(root, "engine/compose"));
}

const lanes = { typescript, swift, kotlin };
const requested = process.argv.slice(2);
if (requested.length === 0 || requested.some((lane) => !(lane in lanes))) {
  console.error(`usage: node scripts/verify-bindings.mjs <${Object.keys(lanes).join("|")}>...`);
  process.exit(2);
}
if (!existsSync(goldens)) {
  console.error(`specs checkout not found at ${specs}; set MILANO_SPECS_DIR`);
  process.exit(2);
}
for (const lane of requested) {
  console.log(`verify-bindings: ${lane}`);
  lanes[lane]();
}
console.log(`verify-bindings: ${requested.join(", ")} compiled`);
