// Packs the publishable packages, installs the tarballs into a scratch
// project, and uses them. The tarball is what consumers receive, and
// until this existed nothing ever executed one: a wrong `exports` map, a
// missing entry in `files`, or a build that never ran would all have
// shipped and failed on `npm install` instead of in CI.
//
//   node scripts/verify-package.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "milano-package-"));

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

try {
  // Build first: the tarball ships `dist`, and packing a stale or absent
  // build is exactly the failure this is here to catch.
  run("npm", ["run", "build"]);

  const tarballs = {};
  for (const workspace of ["@get-milano/core", "@get-milano/react"]) {
    run("npm", ["pack", "--workspace", workspace, "--pack-destination", scratch]);
  }
  for (const file of readdirSync(scratch)) {
    if (file.startsWith("get-milano-core-")) tarballs.core = join(scratch, file);
    if (file.startsWith("get-milano-react-")) tarballs.react = join(scratch, file);
  }
  if (tarballs.core === undefined || tarballs.react === undefined) {
    throw new Error("npm pack produced no tarballs");
  }

  const project = join(scratch, "consumer");
  run("mkdir", ["-p", project]);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "consumer", private: true, type: "module", version: "1.0.0" }, null, 2),
  );

  // Installed the way a consumer installs them, from the tarballs, with
  // react present because the binding declares it as a peer.
  run("npm", ["install", "--no-audit", "--no-fund", tarballs.core, tarballs.react, "react"], project);

  // ESM: build a document end to end through the published entry point.
  writeFileSync(
    join(project, "esm.mjs"),
    `
import { MilanoEngine, MilanoRegistry, MilanoValue, MilanoInfo } from "@get-milano/core";
import { createMilanoRegistry, MilanoHost, MilanoRenderedView } from "@get-milano/react";
import assert from "node:assert/strict";

const vocabulary = JSON.stringify({
  milano: "1.0.0", name: "packaged", version: "1.0.0",
  components: { Text: { properties: { text: "string" } } }, actions: {},
});
const registry = createMilanoRegistry();
registry.register("Text", () => null);
const engine = new MilanoEngine({ vocabularyJson: vocabulary, registry });
const view = await engine
  .viewBuilder(JSON.stringify({
    version: "1.0.0",
    context: { who: "string" },
    root: { type: "Text", id: "t", properties: { text: { $expr: "concat('hi ', context.who)" } } },
  }))
  .context({ who: MilanoValue.string("Ada") })
  .build();
assert.equal(view.resolvedRoot.values.text.stringValue, "hi Ada");
view.teardown();

assert.equal(typeof MilanoInfo.version, "string");
assert.equal(typeof MilanoHost, "function");
assert.equal(typeof MilanoRenderedView, "function");
assert.ok(new MilanoRegistry() instanceof MilanoRegistry);
console.log("esm ok");
`,
  );

  // CJS: the other half of the exports map, which nothing else exercises.
  writeFileSync(
    join(project, "cjs.cjs"),
    `
const assert = require("node:assert/strict");
const core = require("@get-milano/core");
const react = require("@get-milano/react");
assert.equal(typeof core.MilanoEngine, "function");
assert.equal(core.MilanoValue.string("x").stringValue, "x");
assert.equal(typeof react.MilanoHost, "function");
console.log("cjs ok");
`,
  );

  // The types have to resolve too: a package whose "types" path is wrong
  // is unusable in TypeScript while looking fine in JavaScript.
  writeFileSync(
    join(project, "types.ts"),
    `
import { MilanoEngine, type MilanoValue } from "@get-milano/core";
import { createMilanoRegistry, type MilanoNodeProps } from "@get-milano/react";

export function use(props: MilanoNodeProps): MilanoValue {
  return props.node.property("text");
}
export const registry = createMilanoRegistry();
export const engineType: typeof MilanoEngine = MilanoEngine;
`,
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022", module: "ESNext", moduleResolution: "bundler",
          lib: ["ES2022", "DOM"], strict: true, noEmit: true, skipLibCheck: true, jsx: "react-jsx",
        },
        include: ["types.ts"],
      },
      null,
      2,
    ),
  );

  console.log(run("node", ["esm.mjs"], project).trim());
  console.log(run("node", ["cjs.cjs"], project).trim());
  run("npm", ["install", "--no-audit", "--no-fund", "typescript", "@types/react"], project);
  run("npx", ["tsc", "--noEmit"], project);
  console.log("types ok");
  console.log("the packed tarballs install, import and typecheck");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
