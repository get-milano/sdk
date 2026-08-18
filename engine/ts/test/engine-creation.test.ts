import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import { MilanoVocabulary, SUPPORTED_MAJORS } from "../src/engine/vocabulary.ts";
import { MilanoEngineError } from "../src/document/errors.ts";

/**
 * Engine creation: the developer-mistake surface, checked the way the
 * Swift and Kotlin suites check it. Conformance vectors describe what a
 * valid vocabulary does; nothing in the suite describes what happens when
 * the artifact itself is wrong, so each rejection is pinned here with the
 * rule it reports.
 */

const VALID = JSON.stringify({
  milano: "1.0.0",
  name: "creation",
  version: "1.0.0",
  components: {
    Text: { properties: { text: "string" }, events: { tap: null } },
    Box: { children: true },
  },
  actions: { go: { parameters: { url: "string" } } },
});

function registry(types: readonly string[] = ["Text", "Box"]): MilanoRegistry<string> {
  const created = new MilanoRegistry<string>();
  for (const type of types) created.register(type, `renderer:${type}`);
  return created;
}

/** The typed error a bad artifact produces, or null if it was accepted. */
function creation(vocabularyJson: string): MilanoEngineError | null {
  try {
    new MilanoEngine({ vocabularyJson, registry: registry() });
    return null;
  } catch (error) {
    assert.ok(error instanceof MilanoEngineError, `expected a typed error, got ${error}`);
    return error;
  }
}

describe("engine creation", () => {
  it("accepts a well-formed vocabulary and exposes what it holds", () => {
    const engine = new MilanoEngine({ vocabularyJson: VALID, registry: registry() });
    assert.equal(engine.vocabulary.name, "creation");
    assert.equal(engine.vocabulary.version, "1.0.0");
    assert.deepEqual(Object.keys(engine.vocabulary.components).sort(), ["Box", "Text"]);
    assert.deepEqual(Object.keys(engine.vocabulary.actions), ["go"]);
    assert.equal(engine.defaultUnknownTypePolicy, "fail");
  });

  it("refuses a registry that does not cover the vocabulary, naming what is missing", () => {
    const error = (() => {
      try {
        new MilanoEngine({ vocabularyJson: VALID, registry: registry(["Text"]) });
        return null;
      } catch (thrown) {
        return thrown as MilanoEngineError;
      }
    })();
    assert.ok(error !== null);
    assert.equal(error.type, "IncompleteRegistry");
    assert.deepEqual(error.missing, ["Box"]);
  });

  it("refuses the placeholder policy without a placeholder renderer", () => {
    try {
      new MilanoEngine({
        vocabularyJson: VALID,
        registry: registry(),
        defaultUnknownTypePolicy: "placeholder",
      });
      assert.fail("expected IncompleteRegistry");
    } catch (error) {
      assert.ok(error instanceof MilanoEngineError);
      assert.equal(error.type, "IncompleteRegistry");
      assert.deepEqual(error.missing, ["(placeholder renderer)"]);
    }
  });

  it("accepts the placeholder policy once a placeholder renderer exists", () => {
    const created = registry();
    created.registerPlaceholder("placeholder");
    const engine = new MilanoEngine({
      vocabularyJson: VALID,
      registry: created,
      defaultUnknownTypePolicy: "placeholder",
    });
    assert.equal(engine.defaultUnknownTypePolicy, "placeholder");
  });
});

describe("invalid vocabularies are rejected with the rule they broke", () => {
  const cases: readonly [string, string, string][] = [
    ["{ nope", "json", "malformed JSON"],
    ["[]", "structure", "a JSON array rather than an object"],
    [JSON.stringify({ name: "x", version: "1.0.0", components: {} }), "milano", "no contract version"],
    [
      JSON.stringify({ milano: "1", name: "x", version: "1.0.0", components: {} }),
      "milano",
      "a contract version that is not major.minor.patch",
    ],
    [
      JSON.stringify({ milano: "0.1.0", name: "x", version: "1.0.0", components: {} }),
      "milano-version",
      "an unsupported contract major",
    ],
    [
      JSON.stringify({ milano: "1.0.0", name: "1bad", version: "1.0.0", components: {} }),
      "name",
      "a name that is not an identifier",
    ],
    [
      JSON.stringify({ milano: "1.0.0", name: "x", version: "1", components: {} }),
      "version",
      "a vocabulary version that is not major.minor.patch",
    ],
    [
      JSON.stringify({ milano: "1.0.0", name: "x", version: "1.0.0" }),
      "components",
      "no components section",
    ],
    [
      JSON.stringify({ milano: "1.0.0", name: "x", version: "1.0.0", components: { "1Bad": {} } }),
      "component-name",
      "a component name that is not an identifier",
    ],
  ];

  for (const [artifact, rule, description] of cases) {
    it(`rejects ${description}`, () => {
      const error = creation(artifact);
      assert.ok(error !== null, `${description} was accepted`);
      assert.equal(error.type, "InvalidVocabulary");
      assert.equal(error.rule, rule);
      assert.ok((error.detail ?? "").length > 0, "the rejection carries no detail");
    });
  }

  it("names the contract majors it supports", () => {
    const error = creation(
      JSON.stringify({ milano: "9.0.0", name: "x", version: "1.0.0", components: {} }),
    );
    assert.ok(error !== null);
    assert.equal(error.rule, "milano-version");
    assert.ok(error.detail?.includes(SUPPORTED_MAJORS.join(", ")));
  });
});

describe("MilanoVocabulary.parse", () => {
  it("reads declarations into typed shapes", () => {
    const vocabulary = MilanoVocabulary.parse(VALID);
    const text = vocabulary.components["Text"];
    assert.ok(text !== undefined);
    assert.equal(text.properties["text"]?.name, "string");
    assert.ok("tap" in text.events);
    assert.equal(text.children, false);
    assert.equal(vocabulary.components["Box"]?.children, true);
    assert.equal(vocabulary.actions["go"]?.parameters["url"]?.name, "string");
    assert.equal(vocabulary.actions["go"]?.result, null);
  });

  it("reads a declared completion result", () => {
    const vocabulary = MilanoVocabulary.parse(
      JSON.stringify({
        milano: "1.0.0",
        name: "results",
        version: "1.0.0",
        components: {},
        actions: { submit: { parameters: {}, result: "string" } },
      }),
    );
    assert.equal(vocabulary.actions["submit"]?.result?.name, "string");
  });

  it("rejects an undecodable property descriptor", () => {
    try {
      MilanoVocabulary.parse(
        JSON.stringify({
          milano: "1.0.0",
          name: "x",
          version: "1.0.0",
          components: { A: { properties: { p: "nonsense" } } },
        }),
      );
      assert.fail("expected InvalidVocabulary");
    } catch (error) {
      assert.ok(error instanceof MilanoEngineError);
      assert.equal(error.type, "InvalidVocabulary");
    }
  });
});
