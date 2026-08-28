import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
    writeFile: (path, text) => writeFile(path, text, "utf8"),
    exists: (path) => access(path).then(() => true, () => false),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
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
    assert.match((await cli()).stderr, /usage: milano <command>/);
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
    assert.match(help.stdout, /^usage: milano <command>/);
    const validateHelp = await cli("validate", "--help");
    assert.equal(validateHelp.status, 0);
    assert.match(validateHelp.stdout, /^usage: milano validate/);
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

describe("milano schema", () => {
  it("writes the vocabulary's document schema and names the file", async () => {
    const { vocabulary, dir } = files();
    const out = join(dir, "documents.schema.json");
    const result = await cli("schema", vocabulary, "--out", out);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `generated ${out}\n`);
    assert.equal(result.stderr, "");
    const schema = JSON.parse(readFileSync(out, "utf8")) as { $defs: { node: { properties: { type: unknown } } } };
    assert.deepEqual(schema.$defs.node.properties.type, { enum: ["Button", "Column", "Text", "$repeat"] });
  });

  it("prints the schema when no output is named", async () => {
    const { vocabulary } = files();
    const result = await cli("schema", vocabulary);
    assert.equal(result.status, 0);
    assert.match((JSON.parse(result.stdout) as { title: string }).title, /fixture@1\.0\.0/);
    assert.ok((await cli("schema", "--help")).stdout.startsWith("usage: milano schema"));
  });

  it("exits 2 without a vocabulary, with two, or with one that is not JSON", async () => {
    const { vocabulary, dir } = files();
    assert.equal((await cli("schema")).status, 2);
    assert.equal((await cli("schema", vocabulary, vocabulary)).status, 2);
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    const result = await cli("schema", broken);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^milano: .*broken\.json: /);
    writeFileSync(broken, "[]");
    assert.match((await cli("schema", broken)).stderr, /a vocabulary artifact is a JSON object/);
  });
});

describe("milano diff", () => {
  function versions(version: string): { old: string; next: string } {
    const { vocabulary, dir } = files();
    const artifact = JSON.parse(VOCABULARY) as { version: string; components: Record<string, unknown> };
    artifact.version = version;
    artifact.components["Badge"] = { properties: { text: "string" } };
    const next = join(dir, "next.json");
    writeFileSync(next, JSON.stringify(artifact));
    return { old: vocabulary, next };
  }

  it("passes a matching bump with the verdict on stdout", async () => {
    const { old, next } = versions("1.1.0");
    const result = await cli("diff", old, next);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "ADDITIVE  component Badge added\nverdict: ok (0 breaking, 1 additive)\n");
    assert.equal(result.stderr, "");
  });

  it("fails a mismatched bump with the problems on stderr", async () => {
    const { old, next } = versions("1.0.0");
    const result = await cli("diff", old, next);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "ADDITIVE  component Badge added\n\n");
    assert.match(result.stderr, /^error: version did not increase: 1\.0\.0 -> 1\.0\.0\nerror: 1 additive change/);
  });

  it("exits 2 with usage unless given exactly two vocabularies", async () => {
    const { vocabulary } = files();
    assert.equal((await cli("diff", vocabulary)).status, 2);
    assert.equal((await cli("diff", vocabulary, vocabulary, vocabulary)).status, 2);
    assert.ok((await cli("diff", "-h")).stdout.startsWith("usage: milano diff"));
  });
});

describe("milano bindings", () => {
  it("writes every language asked for and names each file", async () => {
    const { vocabulary, dir } = files();
    const outs = { swift: join(dir, "B.swift"), kotlin: join(dir, "B.kt"), ts: join(dir, "b.ts") };
    const result = await cli(
      "bindings", vocabulary,
      "--swift-prefix", "Fx", "--swift-out", outs.swift,
      "--kotlin-package", "com.example.fixture", "--kotlin-out", outs.kotlin,
      "--ts-prefix", "Fx", "--ts-out", outs.ts,
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `generated ${outs.swift}\ngenerated ${outs.kotlin}\ngenerated ${outs.ts}\n`);
    for (const path of Object.values(outs)) {
      assert.ok(readFileSync(path, "utf8").startsWith('// Generated from vocabulary "fixture" 1.0.0'), path);
    }
    assert.ok(readFileSync(outs.swift, "utf8").includes("public enum FxAction {"));
    assert.ok(readFileSync(outs.kotlin, "utf8").includes("package com.example.fixture"));
  });

  it("defaults the prefixes to the capitalized vocabulary name", async () => {
    const { vocabulary, dir } = files();
    const out = join(dir, "b.ts");
    assert.equal((await cli("bindings", vocabulary, "--ts-out", out)).status, 0);
    assert.ok(readFileSync(out, "utf8").includes("export type FixtureAction ="));
  });

  it("refuses Kotlin without a package, and nothing to do", async () => {
    const { vocabulary, dir } = files();
    const kotlin = await cli("bindings", vocabulary, "--kotlin-out", join(dir, "B.kt"));
    assert.equal(kotlin.status, 2);
    assert.equal(kotlin.stderr, "milano: --kotlin-out requires --kotlin-package\n");
    const nothing = await cli("bindings", vocabulary);
    assert.equal(nothing.status, 2);
    assert.equal(nothing.stderr, "milano: nothing to do: pass --swift-out, --kotlin-out and/or --ts-out\n");
    assert.equal((await cli("bindings")).status, 2);
    assert.equal((await cli("bindings", vocabulary, vocabulary, "--ts-out", join(dir, "b.ts"))).status, 2);
    assert.ok((await cli("bindings", "--help")).stdout.startsWith("usage: milano bindings"));
  });

  it("exits 1 for a vocabulary that cannot be bound", async () => {
    const { dir } = files();
    const colliding = join(dir, "colliding.json");
    writeFileSync(
      colliding,
      JSON.stringify({
        milano: "1.0.0", name: "clash", version: "1.0.0",
        components: { Box: { properties: { tone: { enum: ["warm", "Warm"] } } } },
        actions: {},
      }),
    );
    const result = await cli("bindings", colliding, "--ts-out", join(dir, "b.ts"));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^milano: enum at \('property', 'Box', 'tone'\) has members that collide/);
  });
});

describe("milano init", () => {
  it("scaffolds a producer folder named after the directory and says what comes next", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "milano-init-")), "shop-content");
    const result = await cli("init", dir);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const created = result.stdout.split("\n").filter((line) => line.startsWith("created ")).map((line) => line.slice(8));
    assert.deepEqual(
      created.map((path) => path.slice(dir.length + 1)),
      [
        "vocabulary.json", "documents/welcome.json", "documents.schema.json", ".vscode/settings.json",
        "package.json", ".gitignore", "README.md", "AGENTS.md", "CLAUDE.md", ".claude/skills/milano-authoring/SKILL.md",
      ],
    );
    assert.ok(result.stdout.endsWith(`\nnext: cd ${dir} && npm install && npm run check\n`));
    const vocabulary = JSON.parse(readFileSync(join(dir, "vocabulary.json"), "utf8")) as { name: string };
    assert.equal(vocabulary.name, "shopcontent");
    // The scaffold validates with the gate, through the CLI's own command.
    const check = await cli("validate", join(dir, "documents", "welcome.json"), "-v", join(dir, "vocabulary.json"));
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stderr, "");
  });

  it("takes a name, defaults to the current directory, and refuses to overwrite without --force", async () => {
    const dir = mkdtempSync(join(tmpdir(), "milano-init-"));
    const first = await cli("init", dir, "--name", "catalog");
    assert.equal(first.status, 0);
    assert.match(readFileSync(join(dir, "package.json"), "utf8"), /"name": "catalog-documents"/);
    const again = await cli("init", dir, "--name", "catalog");
    assert.equal(again.status, 1);
    assert.match(again.stderr, /vocabulary\.json exists; pass --force to overwrite/);
    assert.equal(again.stdout, "");
    writeFileSync(join(dir, "README.md"), "mine");
    const forced = await cli("init", dir, "--name", "catalog", "--force");
    assert.equal(forced.status, 0);
    assert.match(readFileSync(join(dir, "README.md"), "utf8"), /^# catalog documents/);
  });

  it("exits 2 for a name that is not an identifier, extra arguments, and shows its help", async () => {
    const dir = mkdtempSync(join(tmpdir(), "milano-init-"));
    const bad = await cli("init", dir, "--name", "2fast");
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--name must be an identifier/);
    assert.equal((await cli("init", dir, dir)).status, 2);
    assert.ok((await cli("init", "--help")).stdout.startsWith("usage: milano init"));
  });
});
