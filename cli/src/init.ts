import { readFileSync } from "node:fs";

import { renderSchema } from "./schema.ts";
import type { JsonObject } from "./schema.ts";

/**
 * `milano init`: a producer folder, ready to validate. A starter vocabulary,
 * a first document that uses every part of it, the editor schema, the
 * editor settings that point at it, a package.json whose scripts run the
 * CLI, a README that says what each file is for, and the files that tell
 * an AI agent how to author here: a skill with the contract's rules, an
 * AGENTS.md, and a CLAUDE.md that imports it. Everything here is data the
 * gate accepts: a test builds the scaffold and validates it, examples in
 * the skill included.
 */

/** One file of the scaffold, relative to the target directory. */
export interface ScaffoldFile {
  readonly path: string;
  readonly text: string;
}

/**
 * A vocabulary name from a directory name: a Milano identifier
 * (`[A-Za-z][A-Za-z0-9_]*`), lowercase first letter, `vocabulary` when
 * nothing usable is left.
 */
export function identifierFrom(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "").replace(/^[^A-Za-z]+/, "");
  if (cleaned.length === 0) return "vocabulary";
  return cleaned.slice(0, 1).toLowerCase() + cleaned.slice(1);
}

function vocabulary(name: string): JsonObject {
  return {
    milano: "2.0.0",
    name,
    version: "1.0.0",
    components: {
      Column: { children: true },
      Text: {
        properties: {
          text: "string",
          role: { enum: ["title", "body"] },
        },
      },
      Button: {
        properties: {
          label: "string",
          enabled: "bool",
        },
        events: { tap: null },
      },
    },
    actions: {
      openUrl: { parameters: { url: "string" } },
    },
  };
}

function welcome(name: string): JsonObject {
  return {
    version: "2.0.0",
    vocabulary: { name, min: "1.0.0" },
    context: { userName: "string" },
    state: { taps: "int" },
    root: {
      type: "Column",
      id: "welcome",
      children: [
        {
          type: "Text",
          properties: {
            text: { $expr: "concat('Hello, ', context.userName)" },
            role: "title",
          },
        },
        {
          type: "Text",
          properties: {
            text: { $expr: "concat('Tapped ', str(state.taps), ' times')" },
            role: "body",
          },
        },
        {
          type: "Button",
          id: "tap",
          properties: { label: "Tap me", enabled: true },
          on: {
            tap: [{ action: "$set", key: "taps", value: { $expr: "state.taps + 1" } }],
          },
        },
        {
          type: "Button",
          id: "docs",
          properties: { label: "Read the docs", enabled: { $expr: "state.taps > 0" } },
          on: {
            tap: [{ action: "openUrl", url: "https://get-milano.dev" }],
          },
        },
      ],
    },
    metadata: { screen: "welcome" },
  };
}

/**
 * The authoring skill shipped with the package: the contract's rules as
 * instructions, in the Agent Skills format that Claude Code and other
 * skill-aware agents load from `.claude/skills/`.
 */
export function authoringSkill(): string {
  return readFileSync(new URL("../skills/milano-authoring/SKILL.md", import.meta.url), "utf8");
}

function agentsNote(name: string): string {
  return `# ${name} documents

A Milano producer folder: \`vocabulary.json\` is the contract the app registers, \`documents/*.json\` are the screens it renders. Documents are data checked by a gate, not code.

- Read \`vocabulary.json\` before writing a document: every \`type\`, property, event, and action a document uses must be declared there.
- After every change run \`npm run check\`. It regenerates \`documents.schema.json\` (never edit that file) and validates every document with the gate the app's engine runs; a failure prints the typed error the app would report, naming the node and the rule.
- Changing \`vocabulary.json\` changes the contract with the app: additions are a minor bump, removals and retypes a major; \`npx milano diff <previous> vocabulary.json\` decides.
- The authoring rules (envelope, types, expressions, actions, \`$repeat\`, the gate's rules) are in \`.claude/skills/milano-authoring/SKILL.md\`. Read it before editing.
`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(name: string): string {
  return `# ${name} documents

A [Milano](https://get-milano.dev) producer folder: the vocabulary an app team registers, and the documents that drive its screens. Documents are data; the app renders whatever passes the gate, and this folder is where they are written and checked before they ship.

| File | What it is |
|---|---|
| \`vocabulary.json\` | The contract between producer and app: component types, their properties and events, the custom actions. The app registers a renderer per type. |
| \`documents/\` | The documents, one screen each. \`welcome.json\` uses every part of the starter vocabulary: an expression over context, state changed by a tap, a custom action. |
| \`documents.schema.json\` | The document schema specialized to this vocabulary, regenerated by \`npm run schema\`. Editors validate against it as you type. |
| \`.vscode/settings.json\` | Points VS Code at the schema for everything under \`documents/\`. |
| \`AGENTS.md\`, \`CLAUDE.md\`, \`.claude/skills/milano-authoring/SKILL.md\` | What an AI agent needs to author here: the workflow, and the contract's rules as instructions. Claude Code loads the skill and \`CLAUDE.md\`; other agents read \`AGENTS.md\`. |

## Commands

\`\`\`sh
npm install
npm run check      # regenerates the schema, then validates every document with the gate the engines run
\`\`\`

\`npm run validate\` runs the gate alone; \`npm run schema\` regenerates the schema alone. A document that passes \`validate\` builds in the app; one that fails prints the same typed error the app would report.

## Next steps

- Grow \`vocabulary.json\` as the app's design system grows, and bump its version: \`npx milano diff old.json vocabulary.json\` classifies every change and fails when the bump does not match (additive changes need a minor bump, breaking ones a major).
- The app team generates typed bindings from the same file: \`npx milano bindings vocabulary.json --swift-out ...\`, \`--kotlin-out ...\`, or \`--ts-out ...\`.
- Serve the documents from wherever the app fetches them, and keep the previous version around: the gate failing closed is the safety net.

Guides: [get-milano.github.io/sdk](https://get-milano.github.io/sdk).
`;
}

/** The scaffold for a vocabulary named `name`, pinning the CLI at `cliVersion`. */
export function scaffold(name: string, cliVersion: string): readonly ScaffoldFile[] {
  const artifact = vocabulary(name);
  return [
    { path: "vocabulary.json", text: json(artifact) },
    { path: "documents/welcome.json", text: json(welcome(name)) },
    { path: "documents.schema.json", text: renderSchema(artifact) },
    {
      path: ".vscode/settings.json",
      text: json({
        "json.schemas": [{ fileMatch: ["documents/*.json"], url: "./documents.schema.json" }],
      }),
    },
    {
      path: "package.json",
      text: json({
        name: `${name}-documents`,
        private: true,
        description: `Milano documents for the ${name} vocabulary`,
        scripts: {
          validate: "milano validate documents/*.json --vocabulary vocabulary.json",
          schema: "milano schema vocabulary.json --out documents.schema.json",
          check: "npm run schema && npm run validate",
        },
        devDependencies: { "@get-milano/cli": `^${cliVersion}` },
      }),
    },
    { path: ".gitignore", text: "node_modules/\n" },
    { path: "README.md", text: readme(name) },
    { path: "AGENTS.md", text: agentsNote(name) },
    { path: "CLAUDE.md", text: "@AGENTS.md\n" },
    { path: ".claude/skills/milano-authoring/SKILL.md", text: authoringSkill() },
  ];
}
