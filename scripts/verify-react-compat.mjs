// Runs the published binding against every React major it claims to
// support, from the packed tarballs, in a project that shares nothing
// with this workspace.
//
//   node scripts/verify-react-compat.mjs
//
// `peerDependencies: { react: ">=18" }` is a promise, and until this
// existed it was an untested one: the workspace installs exactly one
// React, so every test ran against that single version and React 18 was
// a claim nobody had ever executed. The floor is real (the binding
// subscribes through `useSyncExternalStore`, added in 18), so it is worth
// proving rather than asserting.
//
// React Native is deliberately absent. The binding imports no React
// Native API, so what decides whether a given react-native works is only
// which React it ships: 0.69 and newer ship 18 or later, and that is the
// whole compatibility story. Installing a react-native here would test
// Metro, not Milano.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "milano-react-compat-"));

// The floor, and every stable major above it. A new React major belongs
// here the day it ships: the run either passes, which is the support
// statement, or fails with the API that moved.
const MAJORS = ["18", "19"];

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A host mounted for real, driven through an event, and read back. The
// same file runs unchanged on every major, so anything that breaks is the
// binding meeting that React, not the test meeting it: `act` comes from
// the test renderer rather than from `react`, which only exports it from
// 19 onwards.
const SMOKE = `
import assert from "node:assert/strict";
import { createElement } from "react";
import TestRenderer from "react-test-renderer";
import { MilanoValue } from "@get-milano/core";
import { MilanoQuickHost } from "@get-milano/react";

const vocabulary = JSON.stringify({
  milano: "1.0.0", name: "compat", version: "1.0.0",
  components: {
    Column: { children: true },
    Label: { properties: { text: "string" } },
    Field: { properties: { value: "string" }, events: { change: "string" } },
  },
  actions: {},
});

const document = JSON.stringify({
  version: "1.0.0",
  state: { name: "string" },
  root: { type: "Column", id: "root", children: [
    { type: "Label", id: "greeting",
      properties: { text: { $expr: "concat('hi ', state.name)" } } },
    { type: "Field", id: "field", properties: { value: { $expr: "state.name" } },
      on: { change: [{ action: "$set", key: "name", value: { $expr: "event" } }] } },
  ] },
});

let field;
const renderers = {
  Column: ({ node }) => createElement("column", null, node.children),
  Label: ({ node }) => createElement("label", null, node.property("text").stringValue),
  Field: ({ node }) => { field = node; return createElement("field", null); },
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mounting is what exercises useSyncExternalStore: the store subscription
// is how a state change reaches the tree at all. The build is a promise,
// so the mount is awaited: an act that does not flush it leaves the host
// showing its loading content.
let renderer;
await TestRenderer.act(async () => {
  renderer = TestRenderer.create(createElement(MilanoQuickHost, {
    document, vocabulary, renderers,
    state: { name: MilanoValue.string("Ada") },
  }));
});

const text = () => JSON.stringify(renderer.toJSON());
assert.ok(text().includes("hi Ada"), \`expression did not resolve: \${text()}\`);

// An event, a $set, and a re-resolution the subscription has to deliver.
await TestRenderer.act(async () => { field.emit("change", MilanoValue.string("Grace")); });
assert.ok(text().includes("hi Grace"), \`state change did not reach the tree: \${text()}\`);

await TestRenderer.act(async () => { renderer.unmount(); });
console.log("ok");
`;

try {
  run("npm", ["run", "build"]);
  for (const workspace of ["@get-milano/core", "@get-milano/react"]) {
    run("npm", ["pack", "--workspace", workspace, "--pack-destination", scratch]);
  }
  const tarballs = readdirSync(scratch)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => join(scratch, file));
  if (tarballs.length !== 2) throw new Error(`expected two tarballs, packed ${tarballs.length}`);

  const failures = [];
  for (const major of MAJORS) {
    const project = join(scratch, `react-${major}`);
    mkdirSync(project);
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({ name: `compat-${major}`, private: true, type: "module", version: "1.0.0" }),
    );
    writeFileSync(join(project, "smoke.mjs"), SMOKE);

    // The test renderer has to match React exactly, for the same reason
    // React Native's bundled one does.
    let resolved = "?";
    try {
      run(
        "npm",
        [
          "install", "--no-audit", "--no-fund", "--silent",
          ...tarballs,
          `react@^${major}`,
          `react-test-renderer@^${major}`,
        ],
        project,
      );
      resolved = run("node", ["-p", "require('react/package.json').version"], project).trim();
      run("node", ["smoke.mjs"], project);
      console.log(`ok   React ${resolved}: mounts, resolves, and updates`);
    } catch (error) {
      const detail = [error.stdout, error.stderr, error.message]
        .filter(Boolean)
        .join("\n")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(-4)
        .join("\n      ");
      console.error(`FAIL React ${major} (${resolved}):\n      ${detail}`);
      failures.push(major);
    }
  }

  console.log();
  if (failures.length > 0) {
    console.error(`the binding does not run on React ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`the binding runs on React ${MAJORS.join(" and ")}, which is every major it claims`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
