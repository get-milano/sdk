---
title: Producing documents
nav_order: 6
---

# Producing documents

The producer's guide: the path from an empty folder to documents an app renders, and the loop that keeps them valid as the vocabulary and the documents change. [Writing documents](documents) is the format reference; this page is the workflow and the tooling around it. Everything here runs with one package, `@get-milano/cli`, and needs neither an engine checkout nor Python.

## The two roles

A Milano deployment has a producer and an app team, and often they are different people on different schedules. The **app team** owns the vocabulary's renderers: for every component type the vocabulary declares, a component of the app's design system, registered with the engine ([Creating a bridge](bridge)). The **producer** owns the documents: the screens, banners, and forms written against that vocabulary, shipped without an app release. The vocabulary artifact, `vocabulary.json`, is the contract between the two, and everything on this page follows from treating it as one.

## Start a folder

```sh
npx @get-milano/cli init my-documents --name shop
cd my-documents && npm install && npm run check
```

`milano init` writes a working producer folder: a starter `vocabulary.json` (three components, one action), `documents/welcome.json` using every part of it, `documents.schema.json` for the editor, `.vscode/settings.json` pointing at it, a `package.json` whose scripts run the CLI, and the files an AI agent authors from (below). `npm run check` regenerates the schema and validates every document with the gate the engines run; it passes on the first run, and every change you make from here is a change to something that was valid.

When the app team already has a vocabulary, replace the starter one with theirs and run `npm run check` again: the schema follows, and `welcome.json` will tell you, with a typed error, which of its declarations the real vocabulary lacks. Delete it or rewrite it against the real components.

## The loop

1. **Edit** a document under `documents/`, one screen per file. Your editor validates as you type against `documents.schema.json`: undeclared types, misspelled properties, and mistyped literals get red squiggles.
2. **Run `npm run check`.** The schema catches shape; the gate catches everything else: expression typing, action encoding, `$repeat` rules, references to undeclared state. A rejected document prints the same typed error the app would report, with the node, the rule, what was expected, and what was found:

   ```
   documents/checkout.json: SchemaViolation: schema violation (expression) at total: expected double
   ```

   [Guardrails](guardrails#the-rules-behind-schemaviolation) lists every rule and what its `expected` and `found` mean.
3. **Commit** the document with the regenerated schema. The schema is generated, never edited; if it changed, the vocabulary changed, and that is a different kind of commit (next section).

`npm run validate` synthesizes zero-values for declared `context` and `state`. To validate with real values, the shape an expression is really evaluated against:

```sh
npx milano validate documents/checkout.json --vocabulary vocabulary.json --context ctx.json --state state.json
```

`--json` gives tooling the report, and `validate()` from the same package does the same from a build script.

**Host functions validate, but do not compute.** If the vocabulary declares
a `functions` section, documents call those functions by their bare name
(`formatMoney(state.cents, 'EUR')`), and the contract's own functions carry
a `$` (`$round`), so the two never collide. `milano validate` checks a call
the way the gate does, by its declared arity and types, and then answers it
with the zero value of its return type, because the app that computes it is
not here: an empty string, `0`, the first member of an enum. So a text
built from `formatMoney` validates while rendering as an empty amount. That
is the tool working correctly; to see real values, put the document in the
[playground](https://get-milano.dev/playground/), which answers a small
library of functions, or in the app.

## Change the vocabulary

The vocabulary is an API: every document and every registered renderer depends on it. Its `version` follows semantic versioning, and the rules are mechanical enough that a tool decides them:

```sh
npx milano diff vocabulary-1.2.0.json vocabulary.json
```

```
ADDITIVE  component Badge added
ADDITIVE  Button property tone enum gained: warning
BREAKING  Card property title type changed: "string" -> "string?"

error: 1 breaking change(s) require a MAJOR bump; got 1.2.0 -> 1.3.0
```

Adding a component, property, event, action, parameter, result, failure, function, or enum member is additive and needs a minor bump. Removing or retyping anything (optionality included, in both directions), marking a component `strict`, or revoking `children` is breaking and needs a major bump. The exit status is `1` when the bump does not match, so the command belongs in CI (recipe below).

Two habits keep vocabularies healthy. Prefer additions: a new optional property or a new enum member costs nothing to old documents, while a removal breaks every document that used it. And publish documents for the oldest vocabulary you still support, raising each document's `"vocabulary": {"min": ...}` only when it actually uses newer declarations, so an app that has not updated fails the build with a typed error instead of rendering with the wrong semantics.

New component types need a renderer before any document can use them: agree them with the app team, and hand over the vocabulary so they can regenerate their bindings:

```sh
npx milano bindings vocabulary.json --swift-out ... --kotlin-out ... --ts-out ...
```

The bindings turn the vocabulary into compiler-checked API on their side ([Creating a bridge](bridge#7-generated-typed-bindings)), which is why a vocabulary change shows up as a compiler-guided migration for them rather than a runtime surprise.

## Working with an AI agent

The scaffold carries three files for agents: `.claude/skills/milano-authoring/SKILL.md`, the contract's rules written as authoring instructions (the envelope, types, the expression language and its typing rules, actions, `$repeat`, what every gate error means and how to fix it, vocabulary evolution), in the Agent Skills format Claude Code and other skill-aware agents load; `AGENTS.md`, the short note that Codex, Cursor, Copilot and the rest read (read the vocabulary first, run `npm run check` after every change, where the rules are); and `CLAUDE.md`, which imports it.

The point is the loop, not the prose: an agent that runs `npm run check` after every edit gets the gate's typed error as feedback and converges on a valid document, because the error names the node, the rule, and the expected type. Ask for a screen, let it run the check, review the document. Every example in the skill is validated against the starter vocabulary by the CLI's own tests, so the agent is never shown a document the gate rejects.

## Continuous integration

A producer repository needs two gates: every document validates, and a vocabulary change carries the right bump. With GitHub Actions, keeping the last published vocabulary as a tag:

```yaml
name: documents
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: npm ci
      - name: Every document passes the gate
        run: npm run check
      - name: The committed schema is the vocabulary's
        run: git diff --exit-code -- documents.schema.json
      - name: The vocabulary bump matches its changes
        run: |
          previous="$(git describe --tags --abbrev=0 --match 'vocabulary-*' 2>/dev/null || true)"
          if [ -n "$previous" ]; then
            git show "$previous:vocabulary.json" > previous.json
            npx milano diff previous.json vocabulary.json
          fi
```

Tag each published vocabulary (`vocabulary-1.3.0`) when it ships, and the third step compares against it. A JSON Schema validator over `documents/*.json` with `documents.schema.json` is a fine extra, but not a substitute: the schema is the authoring-time approximation, the gate is the contract.

## Ship and roll back

Milano does not fetch documents; the app does, from wherever you serve them. Two properties of the store matter. It keeps the previous version of every document, so rolling back is serving the old file. And it serves documents per vocabulary version when the fleet is not on one version: an app declares the vocabulary it holds (`MilanoInfo` and the engine's `vocabularyName`/`vocabularyVersion`), and a document's `vocabulary.min` refuses the ones it cannot render.

On the device the gate fails closed: a rejected document is a typed error before any view exists, and the app falls back (last-known-good document, or its native surface). Alert on `SchemaViolation` in the app's telemetry: it means a producer shipped something the fleet rejects wholesale, which the CI above is there to prevent. Occurrences ([Guardrails](guardrails#observability)) are the softer signal: the user saw something reasonable, and a producer should hear about it.
