import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { main } from "../src/cli.ts";
import { VALID, VOCABULARY, document } from "./fixtures.ts";

const INVALID = document({ type: "Text", id: "t", properties: { text: 3 } });

function files(): { vocabulary: string; valid: string; invalid: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "milano-cli-"));
  const paths = {
    dir,
    vocabulary: join(dir, "vocabulary.json"),
    valid: join(dir, "valid.json"),
    invalid: join(dir, "invalid.json"),
  };
  writeFileSync(paths.vocabulary, VOCABULARY);
  writeFileSync(paths.valid, VALID);
  writeFileSync(paths.invalid, INVALID);
  return paths;
}

async function cli(...argv: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const status = await main(argv, {
    readFile: (path) => readFile(path, "utf8"),
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { status, stdout, stderr };
}

describe("milano validate", () => {
  it("exits 0 and names each valid document", async () => {
    const { vocabulary, valid } = files();
    const result = await cli("validate", valid, "--vocabulary", vocabulary);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${valid}: valid\n`);
    assert.equal(result.stderr, "");
  });

  it("exits 1 and reports the typed error on stderr for a rejected document", async () => {
    const { vocabulary, valid, invalid } = files();
    const result = await cli("validate", valid, invalid, "-v", vocabulary);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, `${valid}: valid\n`);
    assert.ok(result.stderr.startsWith(`${invalid}: SchemaViolation: `), result.stderr);
  });

  it("prints occurrences of a valid document as notes", async () => {
    const { dir, vocabulary } = files();
    const path = join(dir, "skipped.json");
    writeFileSync(path, document({ type: "Column", id: "c", children: [{ type: "Mystery", id: "m" }] }));
    const result = await cli("validate", path, "-v", vocabulary, "--unknown-types", "skip");
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${path}: valid\n  unknownTypeSkipped at m (Mystery)\n`);
  });

  it("emits one JSON report per document with --json", async () => {
    const { vocabulary, valid, invalid } = files();
    const result = await cli("validate", valid, invalid, "-v", vocabulary, "--json");
    assert.equal(result.status, 1);
    const reports = JSON.parse(result.stdout) as { file: string; valid: boolean; error: { type: string } | null }[];
    assert.deepEqual(
      reports.map((report) => [report.file, report.valid, report.error?.type ?? null]),
      [
        [valid, true, null],
        [invalid, false, "SchemaViolation"],
      ],
    );
  });

  it("reads context and state files and rejects ones that are not objects", async () => {
    const { dir, vocabulary } = files();
    const path = join(dir, "declared.json");
    writeFileSync(
      path,
      document(
        { type: "Text", id: "t", properties: { text: { $expr: "concat(context.who, str(state.n))" } } },
        { context: { who: "string" }, state: { n: "int" } },
      ),
    );
    const context = join(dir, "context.json");
    writeFileSync(context, JSON.stringify({ who: "Ada" }));
    const state = join(dir, "state.json");
    writeFileSync(state, JSON.stringify({ n: 3 }));
    assert.equal((await cli("validate", path, "-v", vocabulary, "--context", context, "--state", state)).status, 0);

    const wrongShape = join(dir, "list.json");
    writeFileSync(wrongShape, "[1]");
    const result = await cli("validate", path, "-v", vocabulary, "--context", wrongShape);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /context values must be a JSON object/);

    writeFileSync(wrongShape, "{ nope");
    assert.equal((await cli("validate", path, "-v", vocabulary, "--state", wrongShape)).status, 2);
  });

  it("prints unknown-key warnings on stderr without changing the verdict", async () => {
    const { dir, vocabulary } = files();
    const path = join(dir, "typo.json");
    writeFileSync(path, document({ type: "Text", id: "t", properties: { text: "x" }, styl: 1 }));
    const result = await cli("validate", path, "-v", vocabulary);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, `${path}: warning: root: unknown envelope key "styl"\n`);
    assert.equal(result.stdout, `${path}: valid\n`);
  });

  it("exits 2 with usage for a bad command line", async () => {
    const { vocabulary, valid } = files();
    for (const argv of [
      [],
      ["frobnicate"],
      ["validate"],
      ["validate", valid],
      ["validate", valid, "-v", vocabulary, "--unknown-types", "maybe"],
      ["validate", valid, "-v", vocabulary, "--bogus"],
    ]) {
      const result = await cli(...argv);
      assert.equal(result.status, 2, argv.join(" "));
      assert.match(result.stderr, /^milano: /);
    }
    assert.match((await cli()).stderr, /usage: milano validate/);
  });

  it("exits 2 for an unreadable file or an invalid vocabulary", async () => {
    const { dir, vocabulary, valid } = files();
    const missing = await cli("validate", join(dir, "absent.json"), "-v", vocabulary);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /absent\.json/);

    const broken = join(dir, "vocabulary-broken.json");
    writeFileSync(broken, "{}");
    const invalid = await cli("validate", valid, "-v", broken);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /invalid vocabulary/);
  });

  it("answers --help and --version", async () => {
    const help = await cli("--help");
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: milano validate/);
    const version = await cli("--version");
    assert.equal(version.status, 0);
    assert.match(version.stdout, /^milano \d+\.\d+\.\d+/);
  });

  it("runs as an executable", () => {
    const { vocabulary, valid } = files();
    const bin = new URL("../src/bin.ts", import.meta.url).pathname;
    const output = execFileSync(process.execPath, [bin, "validate", valid, "-v", vocabulary], {
      encoding: "utf8",
    });
    assert.equal(output, `${valid}: valid\n`);
  });
});
