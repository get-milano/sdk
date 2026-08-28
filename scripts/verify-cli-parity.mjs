#!/usr/bin/env node
// The CLI reproduces the specs tools byte for byte.
//
// `milano schema`, `milano diff`, and `milano bindings` are ports of the
// specs repository's generate_document_schema.py, vocabulary_diff.py, and
// generate_bindings.py. The Python is the reference, and stays in the
// specs repository, engine-free; this runs both over every vocabulary in
// the specs checkout (each suite's, and the bindings fixture) and the
// sample vocabulary, and compares what they write and what they print,
// exit status included. A port that drifts from its reference fails here.
//
//   node scripts/verify-cli-parity.mjs
//
// The specs checkout is found the way the conformance harnesses find it:
// MILANO_SPECS_DIR, or the sibling checkout. python3 must be on PATH.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specs = process.env["MILANO_SPECS_DIR"] ?? resolve(root, "..", "specs");
const tools = join(specs, "tools");
const cli = join(root, "cli", "dist", "bin.js");

if (!existsSync(join(tools, "generate_bindings.py"))) {
  console.error(`specs checkout not found at ${specs}; set MILANO_SPECS_DIR`);
  process.exit(2);
}
if (!existsSync(cli)) {
  spawnSync("npm", ["run", "build", "--workspace", "cli"], { cwd: root, stdio: "inherit" });
}

const vocabularies = [
  ...readdirSync(join(specs, "conformance"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(specs, "conformance", entry.name, "vocabulary.json"))
    .filter((path) => existsSync(path)),
  join(tools, "testdata", "bindings_fixture.json"),
  join(root, "samples", "swiftui", "Resources", "vocabulary.json"),
];

const scratch = mkdtempSync(join(tmpdir(), "milano-parity-"));
let failures = 0;
let comparisons = 0;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: scratch, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function python(tool, ...args) {
  return run("python3", [join(tools, tool), ...args]);
}

function milano(...args) {
  return run(process.execPath, [cli, ...args]);
}

function compare(what, expected, actual) {
  comparisons += 1;
  if (expected === actual) return;
  failures += 1;
  console.error(`FAIL ${what}`);
  const left = String(expected).split("\n");
  const right = String(actual).split("\n");
  for (let line = 0; line < Math.max(left.length, right.length); line += 1) {
    if (left[line] !== right[line]) {
      console.error(`  line ${line + 1}\n    python: ${left[line] ?? "<end>"}\n    milano: ${right[line] ?? "<end>"}`);
      break;
    }
  }
}

function file(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// schema and bindings: the files written, plus the exit status.
for (const [index, vocabulary] of vocabularies.entries()) {
  const label = vocabulary.replace(`${specs}/`, "specs/").replace(`${root}/`, "");
  const py = join(scratch, `py-${index}`);
  const ts = join(scratch, `ts-${index}`);

  compare(
    `${label}: schema exit status`,
    python("generate_document_schema.py", vocabulary, "--out", `${py}.schema.json`).status,
    milano("schema", vocabulary, "--out", `${ts}.schema.json`).status,
  );
  compare(`${label}: schema`, file(`${py}.schema.json`), file(`${ts}.schema.json`));

  const flagSets = [
    ["--swift-prefix", "Fx", "--kotlin-package", "com.example.fixture", "--ts-prefix", "Fx"],
    ["--kotlin-package", "com.example.parity", "--kotlin-prefix", "Px", "--ts-core-import", "../core"],
  ];
  for (const [variant, flags] of flagSets.entries()) {
    const outs = (base) => ["--swift-out", `${base}.${variant}.swift`, "--kotlin-out", `${base}.${variant}.kt`, "--ts-out", `${base}.${variant}.ts`];
    compare(
      `${label}: bindings exit status (flag set ${variant})`,
      python("generate_bindings.py", vocabulary, ...flags, ...outs(py)).status,
      milano("bindings", vocabulary, ...flags, ...outs(ts)).status,
    );
    for (const extension of ["swift", "kt", "ts"]) {
      compare(`${label}: bindings ${extension} (flag set ${variant})`, file(`${py}.${variant}.${extension}`), file(`${ts}.${variant}.${extension}`));
    }
  }
}

// diff: every ordered pair, itself included, comparing everything printed.
for (const old of vocabularies) {
  for (const next of vocabularies) {
    const label = `diff ${old.split("/").slice(-2).join("/")} -> ${next.split("/").slice(-2).join("/")}`;
    const expected = python("vocabulary_diff.py", old, next);
    const actual = milano("diff", old, next);
    compare(`${label}: exit status`, expected.status, actual.status);
    compare(`${label}: stdout`, expected.stdout, actual.stdout);
    compare(`${label}: stderr`, expected.stderr, actual.stderr);
  }
}

if (failures > 0) {
  console.error(`verify-cli-parity: ${failures} of ${comparisons} comparisons differ`);
  process.exit(1);
}
console.log(`verify-cli-parity: ${comparisons} comparisons over ${vocabularies.length} vocabularies, identical`);
