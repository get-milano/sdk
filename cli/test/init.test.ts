import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authoringSkill, identifierFrom, scaffold } from "../src/init.ts";
import { renderSchema } from "../src/schema.ts";
import { validate } from "../src/validate.ts";

/**
 * The scaffold is a producer folder that works on the first run: its
 * document passes the gate against its vocabulary, its schema is the one
 * `milano schema` would write, and its scripts name the CLI that wrote it.
 */

function file(name: string): string {
  const found = scaffold("shop", "2.0.0").find((entry) => entry.path === name);
  assert.ok(found, name);
  return found.text;
}

describe("the scaffold", () => {
  it("validates with the gate, with no warnings and no occurrences", async () => {
    const report = await validate({
      document: file("documents/welcome.json"),
      vocabulary: file("vocabulary.json"),
      context: {},
      state: {},
    });
    assert.deepEqual(report, { valid: true, error: null, occurrences: [], warnings: [] });
  });

  it("uses every part of the starter vocabulary", () => {
    const document = file("documents/welcome.json");
    const vocabulary = JSON.parse(file("vocabulary.json")) as {
      components: Record<string, unknown>;
      actions: Record<string, unknown>;
    };
    for (const type of Object.keys(vocabulary.components)) assert.ok(document.includes(`"type": "${type}"`), type);
    for (const action of Object.keys(vocabulary.actions)) assert.ok(document.includes(`"action": "${action}"`), action);
    assert.ok(document.includes("$set"));
    assert.ok(document.includes("$expr"));
  });

  it("carries the schema milano schema would write, and settings that point at it", () => {
    assert.equal(file("documents.schema.json"), renderSchema(JSON.parse(file("vocabulary.json"))));
    assert.deepEqual(JSON.parse(file(".vscode/settings.json")), {
      "json.schemas": [{ fileMatch: ["documents/*.json"], url: "./documents.schema.json" }],
    });
  });

  it("pins the CLI that wrote it and runs it from scripts", () => {
    const manifest = JSON.parse(file("package.json")) as {
      name: string;
      private: boolean;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    assert.equal(manifest.name, "shop-documents");
    assert.equal(manifest.private, true);
    assert.equal(manifest.devDependencies["@get-milano/cli"], "^2.0.0");
    assert.deepEqual(Object.keys(manifest.scripts), ["validate", "schema", "check"]);
    for (const script of ["validate", "schema"]) assert.match(manifest.scripts[script] ?? "", /^milano /);
  });

  it("names the vocabulary throughout and ends every file with a newline", () => {
    for (const entry of scaffold("shop", "2.0.0")) assert.ok(entry.text.endsWith("\n"), entry.path);
    assert.match(file("README.md"), /^# shop documents/);
    assert.match(file("documents/welcome.json"), /"name": "shop"/);
  });
});

describe("the agent files", () => {
  it("ship the skill, an AGENTS.md, and a CLAUDE.md that imports it", () => {
    assert.equal(file(".claude/skills/milano-authoring/SKILL.md"), authoringSkill());
    assert.match(file("AGENTS.md"), /^# shop documents\n/);
    assert.match(file("AGENTS.md"), /npm run check/);
    assert.match(file("AGENTS.md"), /\.claude\/skills\/milano-authoring\/SKILL\.md/);
    assert.equal(file("CLAUDE.md"), "@AGENTS.md\n");
  });

  it("the skill has the frontmatter agents index it by", () => {
    const skill = authoringSkill();
    assert.match(skill, /^---\nname: milano-authoring\ndescription: .+\n---\n/);
    assert.equal(skill.includes("\u2014"), false, "no em dashes");
  });

  it("every complete document in the skill passes the gate against the starter vocabulary", async () => {
    const vocabulary = file("vocabulary.json");
    const documents = [...authoringSkill().matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] as string);
    assert.ok(documents.length >= 1, "the skill carries at least one complete example");
    for (const document of documents) {
      const report = await validate({ document, vocabulary, context: {}, state: {} });
      assert.deepEqual(report, { valid: true, error: null, occurrences: [], warnings: [] }, document.slice(0, 80));
    }
  });
});

describe("identifierFrom", () => {
  it("makes a Milano identifier out of a directory name", () => {
    assert.equal(identifierFrom("shop"), "shop");
    assert.equal(identifierFrom("Shop-Content"), "shopContent");
    assert.equal(identifierFrom("my documents"), "mydocuments");
    assert.equal(identifierFrom("2fast"), "fast");
    assert.equal(identifierFrom("---"), "vocabulary");
    assert.equal(identifierFrom(""), "vocabulary");
  });
});
