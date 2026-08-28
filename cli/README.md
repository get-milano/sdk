# @get-milano/cli

The producer's command line for [Milano](https://get-milano.dev): five commands, one package, no Python and no checkout of the specs.

| Command | What it does |
|---|---|
| `milano init` | Scaffolds a producer folder: a starter vocabulary, a first document, the editor schema, and scripts that run the rest |
| `milano validate` | Runs documents through the very gate the engines run, so a document that passes here builds in the app |
| `milano schema` | Specializes the official document schema to your vocabulary, for editors and CI |
| `milano diff` | Classifies the changes between two versions of a vocabulary and checks the version bump |
| `milano bindings` | Generates typed Swift, Kotlin, and TypeScript bindings from a vocabulary |

```sh
npx @get-milano/cli init my-documents
cd my-documents && npm install && npm run check
```

Every command exits `0` on success, `1` when the input failed the check (a rejected document, a version bump that does not match the changes, a vocabulary that cannot be bound), and `2` for a usage error or a file that could not be read. `milano <command> --help` prints the command's options.

## init

```sh
npx @get-milano/cli init my-documents --name shop
```

```
created my-documents/vocabulary.json
created my-documents/documents/welcome.json
created my-documents/documents.schema.json
created my-documents/.vscode/settings.json
created my-documents/package.json
created my-documents/.gitignore
created my-documents/README.md
created my-documents/AGENTS.md
created my-documents/CLAUDE.md
created my-documents/.claude/skills/milano-authoring/SKILL.md

next: cd my-documents && npm install && npm run check
```

The folder is a working producer setup: `vocabulary.json` declares three components and one action, `documents/welcome.json` uses every part of it (an expression over context, state changed by a tap, a custom action), `documents.schema.json` is what `milano schema` writes for it and `.vscode/settings.json` points the editor at it, and `package.json` carries `validate`, `schema`, and `check` scripts with this CLI as a dev dependency. The README in the folder explains each file and what to do next.

The last three files are for AI agents. `.claude/skills/milano-authoring/SKILL.md` is the contract's rules written as authoring instructions (the envelope, types, expressions, actions, `$repeat`, the gate's rules and what each error means, vocabulary evolution), in the Agent Skills format that Claude Code and other skill-aware agents load; `AGENTS.md` is the short universal note (read the vocabulary first, run `npm run check` after every change, where the rules are) that Codex, Cursor, Copilot and the rest read; `CLAUDE.md` imports it. Every complete example in the skill is validated by the CLI's own tests against the starter vocabulary, so an agent is never shown a document the gate rejects.

Nothing that already exists is overwritten unless `--force` is passed; `--name` sets the vocabulary's name (default: the directory's name, as an identifier), and the directory defaults to the current one.

## validate

```sh
npm install --save-dev @get-milano/cli
npx milano validate documents/*.json --vocabulary vocabulary.json
```

```
documents/banner.json: valid
documents/form.json: SchemaViolation: schema violation (property-type) at email: expected string, found int
```

A `for` loop is not needed: pass every document at once, and the status covers them all.

| Option | Meaning |
|---|---|
| `-v, --vocabulary <file>` | The vocabulary artifact (required) |
| `--context <file>` | A JSON object of context values; declared keys it omits are synthesized as zero-values |
| `--state <file>` | A JSON object of state values, likewise |
| `--unknown-types <policy>` | `fail` (the contract default), `skip`, or `placeholder`, as the app would configure it |
| `--json` | One JSON report per document on stdout, for tooling |

Validation is the full gate: parse, version, vocabulary requirement, limits, the vocabulary walk with expression typing, and the data checks against the declared context and state. Unknown keys in the objects the contract governs (the top level, the node envelope, `vocabulary`, type descriptors) are warnings on stderr: the gate ignores them by the tolerance rule, which is exactly why a typo there would otherwise be silent. A document binding custom actions gets a handler; occurrences a valid document reports at build (a skipped unknown type, a division by zero in an initial expression) are printed as notes, and are in the JSON report.

## schema

```sh
npx milano schema vocabulary.json --out documents.schema.json
```

Component types become an enum, each property gets the schema of its declared type (or the `{"$expr": ...}` wrapper), event names constrain `on`, childless components reject `children`, and the `$repeat` construct carries its own keys. Commit the output next to your documents and point your editor at it (VS Code: `json.schemas` in `settings.json`), and typos get red squiggles before anything runs; a JSON Schema validator in CI catches the same ones. Without `--out` the schema goes to standard output.

The schema is the authoring-time approximation of the gate, never the gate: expression result types, action grants, and references to undeclared keys are only caught by `milano validate`.

## diff

```sh
npx milano diff vocabulary-1.2.0.json vocabulary.json
```

```
ADDITIVE  component Badge added
BREAKING  Button property label type changed: "string" -> "string?"

error: 1 breaking change(s) require a MAJOR bump; got 1.2.0 -> 1.3.0
```

Every change is classified per the evolution rules of the vocabulary schema spec: adding a component, property, event, action, parameter, or result is additive, as is an enum gaining members; removing, retyping (optionality included), tightening to strict, or refusing children is breaking. Additive changes need at least a minor bump, breaking ones a major, and the version must increase; the exit status is `1` when the bump does not match, so one line in CI gates publication. Semantic repurposing with an unchanged shape is undetectable by any tool; the spec forbids it in prose.

## bindings

```sh
npx milano bindings vocabulary.json \
    --swift-prefix Shop --swift-out Sources/MilanoBridge/GeneratedBindings.swift \
    --kotlin-package com.acme.shop.milano --kotlin-out app/src/main/kotlin/com/acme/shop/milano/GeneratedBindings.kt \
    --ts-prefix Shop --ts-out src/milano/bindings.ts
```

Each language is optional; pass the outputs you need. The generated file holds a wrapper per component with typed accessors (a non-optional declaration is a non-optional property, no `?? ""` fallbacks: the gate guarantees presence), typed event emitters, one nominal type per enum and record declaration site, an exhaustive action type with an `unrecognized` case for forward compatibility, and a vocabulary identity helper that refuses to run against a mismatched engine. Output is deterministic: same vocabulary and flags, same bytes. Commit the files and regenerate them in the build, as the [bridge guide](https://get-milano.github.io/sdk/bridge#7-generated-typed-bindings) shows.

| Option | Meaning |
|---|---|
| `--swift-out <file>`, `--swift-prefix <name>` | Swift output; the prefix namespaces the types (default: the capitalized vocabulary name) |
| `--kotlin-out <file>`, `--kotlin-package <name>`, `--kotlin-prefix <name>` | Kotlin output; the package is required, the prefix optional (default: none, the package namespaces) |
| `--ts-out <file>`, `--ts-prefix <name>`, `--ts-core-import <module>` | TypeScript output; the file imports `MilanoValue` from the module (default: `@get-milano/core`) |

## From a build script

```ts
import { validate, renderSchema, diffReport, generateSwift } from "@get-milano/cli";

const report = await validate({ document, vocabulary });
if (!report.valid) throw new Error(`${report.error.type}: ${report.error.message}`);

writeFileSync("documents.schema.json", renderSchema(JSON.parse(vocabulary)));
const verdict = diffReport(JSON.parse(previous), JSON.parse(vocabulary));   // .status, .stdout, .stderr
writeFileSync("GeneratedBindings.swift", generateSwift(JSON.parse(vocabulary), "Shop"));
```

The validation report carries the error's type, message, and detail fields (`rule`, `node`, `expected`, `found`, `unknownType`, `limit`, ...) exactly as `MilanoBuildError` does in `@get-milano/core`.

## The reference tools

The [specs repository](https://github.com/get-milano/specs) ships the same three generators in Python, engine-free (`tools/generate_document_schema.py`, `tools/vocabulary_diff.py`, `tools/generate_bindings.py`), and `tools/reference_check.py --document` validates like `milano validate` does. The CLI's commands are ports of them: the SDK's CI runs both over every vocabulary it has and compares the output byte for byte, so what the CLI writes is what the specs define.

## Versions

The CLI is released with the engines and validates with `@get-milano/core` at the same version, so what it accepts is what that release of every engine accepts.
