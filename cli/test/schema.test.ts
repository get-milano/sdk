import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { documentSchema, renderSchema, specialize } from "../src/schema.ts";
import type { JsonObject } from "../src/schema.ts";

/**
 * The document schema specialized to one vocabulary: the shape the specs
 * tool's own tests pin, checked on the port. What the schema accepts and
 * rejects with a real validator is pinned in the specs repository; the
 * parity script proves the port writes the same bytes.
 */

const SPECS = process.env["MILANO_SPECS_DIR"] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../specs");

const VOCABULARY: JsonObject = {
  milano: "1.0.0",
  name: "authoring",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: {
      properties: {
        text: "string",
        size: "int?",
        weight: "double",
        hidden: "bool",
        role: { enum: ["title", "body"] },
        tone: { enum: ["warm", "cool"], optional: true },
        tags: { array: "string" },
        meta: { record: { id: "string" } },
      },
      events: { tap: null },
    },
  },
  actions: { go: { parameters: { url: "string" } } },
};

function branches(schema: JsonObject): Record<string, JsonObject> {
  const node = (schema["$defs"] as JsonObject)["node"] as JsonObject;
  const result: Record<string, JsonObject> = {};
  for (const branch of node["allOf"] as JsonObject[]) {
    const condition = ((branch["if"] as JsonObject)["properties"] as JsonObject)["type"] as JsonObject;
    result[condition["const"] as string] = branch["then"] as JsonObject;
  }
  return result;
}

function textProperties(schema: JsonObject): Record<string, JsonObject> {
  const text = branches(schema)["Text"] as JsonObject;
  return ((text["properties"] as JsonObject)["properties"] as JsonObject)["properties"] as Record<string, JsonObject>;
}

function literal(schema: JsonObject, property: string): unknown {
  return (textProperties(schema)[property]?.["anyOf"] as unknown[])[0];
}

describe("literal schemas", () => {
  const schema = specialize(documentSchema(), VOCABULARY);

  it("map scalars to JSON Schema types", () => {
    assert.deepEqual(literal(schema, "text"), { type: "string" });
    assert.deepEqual(literal(schema, "weight"), { type: "number" });
    assert.deepEqual(literal(schema, "hidden"), { type: "boolean" });
  });

  it("admit null only for optional scalars", () => {
    assert.deepEqual(literal(schema, "size"), { anyOf: [{ type: "integer" }, { type: "null" }] });
  });

  it("sort enum members so the output is stable", () => {
    assert.deepEqual(literal(schema, "role"), { enum: ["body", "title"] });
    assert.deepEqual(literal(schema, "tone"), { anyOf: [{ enum: ["cool", "warm"] }, { type: "null" }] });
  });

  it("carry the element schema of an array and leave records open", () => {
    assert.deepEqual(literal(schema, "tags"), { type: "array", items: { type: "string" } });
    assert.deepEqual(literal(schema, "meta"), { type: "object" });
  });

  it("accept an expression wrapper anywhere a value goes", () => {
    const wrapper = (textProperties(schema)["text"]?.["anyOf"] as unknown[])[1];
    assert.deepEqual(wrapper, {
      type: "object",
      required: ["$expr"],
      properties: { $expr: { type: "string", minLength: 1 } },
      additionalProperties: false,
    });
  });
});

describe("specialize", () => {
  const schema = specialize(documentSchema(), VOCABULARY);

  it("names the vocabulary it was built for and drops the official identifier", () => {
    assert.match(schema["title"] as string, /authoring@1\.0\.0/);
    assert.match(schema["description"] as string, /gate remains the source of truth/);
    assert.equal("$id" in schema, false);
  });

  it("closes the component types to a sorted enum plus the construct", () => {
    const node = (schema["$defs"] as JsonObject)["node"] as JsonObject;
    assert.deepEqual((node["properties"] as JsonObject)["type"], {
      enum: ["Column", "Text", "$if", "$repeat", "$switch"],
    });
  });

  it("emits one conditional per component in a fixed order, then the construct", () => {
    assert.deepEqual(Object.keys(branches(schema)), ["Column", "Text", "$repeat", "$if", "$switch"]);
  });

  it("requires the construct's own keys and refuses a component's", () => {
    const repeat = branches(schema)["$repeat"] as JsonObject;
    assert.deepEqual(repeat["required"], ["items", "as", "children"]);
    assert.deepEqual((repeat["properties"] as JsonObject)["properties"], { type: "object", maxProperties: 0 });
    assert.deepEqual((repeat["properties"] as JsonObject)["on"], { type: "object", maxProperties: 0 });

    const conditional = branches(schema)["$if"] as JsonObject;
    assert.deepEqual(conditional["required"], ["condition", "then"]);
    assert.deepEqual(
      (conditional["properties"] as JsonObject)["properties"],
      { type: "object", maxProperties: 0 },
    );
    assert.deepEqual((conditional["properties"] as JsonObject)["on"], { type: "object", maxProperties: 0 });

    const choice = branches(schema)["$switch"] as JsonObject;
    assert.deepEqual(choice["required"], ["subject", "cases"]);
  });

  it("rejects children on childless components only", () => {
    const text = (branches(schema)["Text"] as JsonObject)["properties"] as JsonObject;
    const column = (branches(schema)["Column"] as JsonObject)["properties"] as JsonObject;
    assert.deepEqual(text["children"], { type: "array", maxItems: 0 });
    assert.equal("children" in column, false);
  });

  it("constrains property and event names", () => {
    const text = (branches(schema)["Text"] as JsonObject)["properties"] as JsonObject;
    const column = (branches(schema)["Column"] as JsonObject)["properties"] as JsonObject;
    assert.deepEqual(((text["properties"] as JsonObject)["propertyNames"] as JsonObject)["enum"], [
      "hidden",
      "meta",
      "role",
      "size",
      "tags",
      "text",
      "tone",
      "weight",
    ]);
    assert.deepEqual(((text["on"] as JsonObject)["propertyNames"] as JsonObject)["enum"], ["tap"]);
    // A component with no events constrains `on` to nothing at all.
    assert.deepEqual(((column["on"] as JsonObject)["propertyNames"] as JsonObject)["enum"], []);
  });

  it("leaves a vocabulary with no components alone", () => {
    const bare = specialize(documentSchema(), { name: "empty", version: "1.0.0", components: {} });
    const node = (bare["$defs"] as JsonObject)["node"] as JsonObject;
    assert.equal("allOf" in node, false);
    assert.equal(typeof ((node["properties"] as JsonObject)["type"] as JsonObject)["pattern"], "string");
  });

  it("does not mutate the schema it was given", () => {
    const official = documentSchema();
    const before = JSON.stringify(official);
    specialize(official, VOCABULARY);
    assert.equal(JSON.stringify(official), before);
  });

  it("renders deterministically, as a file ending in a newline", () => {
    const first = renderSchema(VOCABULARY);
    assert.equal(first, renderSchema(VOCABULARY));
    assert.ok(first.endsWith("}\n"));
    assert.deepEqual(JSON.parse(first), schema);
  });
});

describe("the vendored document schema", () => {
  const official = join(SPECS, "schemas", "document.schema.json");
  it("is the specs repository's own, byte for byte", { skip: existsSync(official) ? false : "no specs checkout" }, () => {
    const vendored = readFileSync(new URL("../schemas/document.schema.json", import.meta.url), "utf8");
    assert.equal(vendored, readFileSync(official, "utf8"));
  });
});
