// Validates every bundled document against the sample vocabulary, with the
// real engine, before the app ever runs. The SwiftUI and Compose samples run
// the specs' validation CLI as a build step; this is the same gate, run from
// the engine the app itself uses.
//
// Renderers are stubs: the gate never calls them, it only requires the
// registry to cover the vocabulary. What is being checked is the documents:
// schema, vocabulary conformance, expression typing, limits.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MilanoEngine,
  MilanoRegistry,
  MilanoType,
  MilanoValue,
  parseJson,
  synthesizedState,
} from "@get-milano/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const documents = join(root, "documents");
const vocabularyJson = readFileSync(join(documents, "vocabulary.json"), "utf8");

const registry = new MilanoRegistry();
for (const type of Object.keys(JSON.parse(vocabularyJson).components)) {
  registry.register(type, () => null);
}

const engine = new MilanoEngine({ vocabularyJson, registry });

/** The document's declared context, synthesized as zero-values. */
function contextFor(text) {
  const declarations = parseJson(text).recordValue?.["context"]?.recordValue ?? {};
  const types = {};
  for (const [key, descriptor] of Object.entries(declarations)) {
    const type = MilanoType.fromDescriptor(descriptor);
    if (type === null) throw new Error(`undecodable context declaration: ${key}`);
    types[key] = type;
  }
  return synthesizedState(types);
}

const names = readdirSync(documents)
  .filter((file) => file.endsWith(".json") && file !== "vocabulary.json")
  .map((file) => file.replace(/\.json$/, ""))
  .sort();

let failures = 0;
for (const name of names) {
  const text = readFileSync(join(documents, `${name}.json`), "utf8");
  try {
    const view = await engine
      .viewBuilder(text)
      .context(contextFor(text))
      .stateData((declarations) => synthesizedState(declarations))
      .actionHandler(() => MilanoValue.string("validated"))
      .label(name)
      .build();
    view.teardown();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error}`);
  }
}

if (failures > 0) {
  console.error(`${failures} document(s) rejected`);
  process.exit(1);
}
console.log(`${names.length} documents validated`);
