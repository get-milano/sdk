import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoEngineError, MilanoValue } from "@get-milano/core";

import { validate } from "../src/validate.ts";
import { VALID, VOCABULARY, document } from "./fixtures.ts";

describe("validate", () => {
  it("accepts a valid document with no occurrences", async () => {
    const report = await validate({ document: VALID, vocabulary: VOCABULARY });
    assert.deepEqual(report, { valid: true, error: null, occurrences: [], warnings: [] });
  });

  it("reports the gate's typed error with its detail", async () => {
    const report = await validate({
      document: document({ type: "Text", id: "t", properties: { text: 3 } }),
      vocabulary: VOCABULARY,
    });
    assert.equal(report.valid, false);
    assert.equal(report.error?.type, "SchemaViolation");
    assert.equal(report.error?.detail["node"], "t");
    assert.equal(report.error?.detail["expected"], "string");
    assert.equal(typeof report.error?.detail["rule"], "string");
    assert.match(report.error?.message ?? "", /schema violation/);
  });

  it("reports malformed JSON as MalformedDocument", async () => {
    const report = await validate({ document: "{ not json", vocabulary: VOCABULARY });
    assert.equal(report.error?.type, "MalformedDocument");
    assert.equal(typeof report.error?.detail["detail"], "string");
  });

  it("applies the unknown-type policy: fail by default, skip on request", async () => {
    const unknown = document({ type: "Column", id: "c", children: [{ type: "Mystery", id: "m" }] });
    const failed = await validate({ document: unknown, vocabulary: VOCABULARY });
    assert.equal(failed.error?.type, "UnknownComponentType");
    assert.equal(failed.error?.detail["unknownType"], "Mystery");

    const skipped = await validate({ document: unknown, vocabulary: VOCABULARY, unknownTypes: "skip" });
    assert.equal(skipped.valid, true);
    assert.deepEqual(skipped.occurrences, [
      { kind: "unknownTypeSkipped", node: "m", name: "Mystery", expected: null, found: null },
    ]);

    const placeholder = await validate({
      document: unknown,
      vocabulary: VOCABULARY,
      unknownTypes: "placeholder",
    });
    assert.equal(placeholder.valid, true);
    assert.equal(placeholder.occurrences[0]?.kind, "unknownTypePlaceholder");
  });

  it("synthesizes declared context and state, and supplies a handler", async () => {
    const report = await validate({
      document: document(
        {
          type: "Column",
          id: "c",
          children: [
            { type: "Text", id: "t", properties: { text: { $expr: "concat(context.who, str(state.n))" } } },
            {
              type: "Button",
              id: "b",
              properties: { label: "go" },
              on: {
                tap: [
                  { action: "$set", key: "n", value: { $expr: "state.n + 1" } },
                  { action: "submit", id: "x" },
                ],
              },
            },
          ],
        },
        { context: { who: "string" }, state: { n: "int" } },
      ),
      vocabulary: VOCABULARY,
    });
    assert.deepEqual(report, { valid: true, error: null, occurrences: [], warnings: [] });
  });

  it("validates supplied context and state values against the declarations", async () => {
    const declared = document(
      { type: "Text", id: "t", properties: { text: { $expr: "context.who" } } },
      { context: { who: "string" }, state: { n: "int" } },
    );
    const wrongContext = await validate({
      document: declared,
      vocabulary: VOCABULARY,
      context: { who: MilanoValue.int(1n) },
    });
    assert.equal(wrongContext.error?.type, "SchemaViolation");
    assert.equal(wrongContext.error?.detail["rule"], "context-declaration");
    assert.equal(wrongContext.error?.detail["found"], "int");

    const wrongState = await validate({
      document: declared,
      vocabulary: VOCABULARY,
      state: { n: MilanoValue.string("one") },
    });
    assert.equal(wrongState.error?.type, "SchemaViolation");
    assert.equal(wrongState.error?.detail["rule"], "state-declaration");
  });

  it("reports arithmetic occurrences of a valid document with node and property", async () => {
    const report = await validate({
      document: document({ type: "Text", id: "t", properties: { text: { $expr: "str(1 / 0)" } } }),
      vocabulary: VOCABULARY,
    });
    assert.equal(report.valid, true);
    assert.deepEqual(report.occurrences, [
      { kind: "divisionByZero", node: "t", name: "text", expected: null, found: null },
    ]);
  });

  it("leaves a document with an unparseable context declaration to the gate", async () => {
    const report = await validate({
      document: document({ type: "Text", id: "t", properties: { text: "x" } }, { context: { who: "mystery" } }),
      vocabulary: VOCABULARY,
    });
    assert.equal(report.error?.type, "SchemaViolation");
  });

  it("warns about unknown keys in contract-governed objects, which the gate ignores", async () => {
    const report = await validate({
      document: JSON.stringify({
        version: "1.0.0",
        vocabulary: { name: "fixture", max: "2.0.0" },
        extra: 1,
        state: { n: { enum: ["a"], optinal: true } },
        root: { type: "Text", id: "t", properties: { text: "x" }, style: {} },
      }),
      vocabulary: VOCABULARY,
    });
    assert.equal(report.valid, true);
    assert.deepEqual([...report.warnings].sort(), [
      'document: unknown top-level key "extra"',
      'root: unknown envelope key "style"',
      'state.n: unknown type descriptor key "optinal"',
      'vocabulary: unknown key "max"',
    ]);
    assert.deepEqual((await validate({ document: VALID, vocabulary: VOCABULARY })).warnings, []);
  });

  it("knows the $repeat construct's own keys", async () => {
    const report = await validate({
      document: JSON.stringify({
        version: "2.0.0",
        state: { rows: { array: "string" } },
        root: {
          type: "Column",
          children: [
            {
              type: "$repeat",
              items: { $expr: "state.rows" },
              as: "row",
              each: true,
              children: [{ type: "Text", id: "t", properties: { text: { $expr: "row" } } }],
            },
          ],
        },
      }),
      vocabulary: VOCABULARY,
    });
    assert.equal(report.valid, true);
    assert.deepEqual([...report.warnings], ['root/children[0]: unknown envelope key "each"']);
  });

  it("throws for an invalid vocabulary: the setup, not the document", async () => {
    await assert.rejects(
      validate({ document: VALID, vocabulary: "{}" }),
      (error: unknown) => error instanceof MilanoEngineError,
    );
  });
});
