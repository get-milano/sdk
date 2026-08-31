import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoBuildError } from "../src/document/errors.ts";
import { defaultLimits } from "../src/engine/configuration.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import { MilanoContextHandle } from "../src/runtime/context-source.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * The value size limit: the document model's one runtime bound, applied
 * wherever a value enters state or context. The conformance suite pins
 * the observable behavior at a configured limit; this pins the metric on
 * every value shape, the default, and the shape of the list stop through
 * nested action constructs.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "limits",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: {},
});

describe("MilanoValue.size", () => {
  it("counts scalars as one and strings per Unicode scalar", () => {
    assert.equal(MilanoValue.null.size, 1);
    assert.equal(MilanoValue.bool(true).size, 1);
    assert.equal(MilanoValue.int(9007199254740993n).size, 1);
    assert.equal(MilanoValue.double(2.5).size, 1);
    assert.equal(MilanoValue.string("").size, 0);
    assert.equal(MilanoValue.string("abcdefg\u{1F600}").size, 8);
  });

  it("counts arrays and records as one plus their contents", () => {
    assert.equal(MilanoValue.array([]).size, 1);
    assert.equal(MilanoValue.array([MilanoValue.string("ab"), MilanoValue.string("cd")]).size, 5);
    const record = MilanoValue.record({
      a: MilanoValue.array([MilanoValue.int(1n), MilanoValue.int(2n)]),
      b: MilanoValue.string("xyz"),
    });
    assert.equal(record.size, 1 + 3 + 3);
  });

  it("defaults to the document model's 65,536", () => {
    assert.equal(defaultLimits.maxValueSize, 65_536);
  });
});

async function build(
  document: string,
  state: Record<string, MilanoValue>,
  context: MilanoContextHandle | null = null,
): Promise<{ view: MilanoView; occurrences: MilanoOccurrence[] }> {
  const registry = new MilanoRegistry<string>();
  registry.register("Column", "column");
  registry.register("Text", "text");
  const occurrences: MilanoOccurrence[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    limits: { ...defaultLimits, maxValueSize: 8 },
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
  });
  const builder = engine.viewBuilder(document).stateData(() => state);
  if (context !== null) builder.contextSource(context);
  const view = await builder.build();
  return { view, occurrences };
}

describe("the value size limit at runtime", () => {
  it("stops the list at a rejected $set, through $sequence and $when", async () => {
    const { view, occurrences } = await build(
      JSON.stringify({
        version: "1.0.0",
        state: { s: "string", n: "int" },
        root: {
          type: "Text",
          id: "t",
          properties: { text: { $expr: "state.s" } },
          on: {
            tap: [
              { action: "$set", key: "n", value: { $expr: "state.n + 1" } },
              {
                action: "$when",
                condition: true,
                then: [
                  {
                    action: "$sequence",
                    actions: [{ action: "$set", key: "s", value: { $expr: "$concat(state.s, state.s)" } }],
                  },
                  { action: "$set", key: "n", value: { $expr: "state.n + 10" } },
                ],
              },
              { action: "$set", key: "n", value: { $expr: "state.n + 100" } },
            ],
          },
        },
      }),
      { s: MilanoValue.string("abcde"), n: MilanoValue.int(0n) },
    );
    view.emit("t", "tap");
    assert.equal(view.state["s"]?.stringValue, "abcde");
    assert.equal(view.state["n"]?.intValue, 1n);
    assert.deepEqual(
      occurrences.map((o) => [o.kind, o.node, o.name, o.expected, o.found]),
      [["rejectedMutation", "t", "s", "maxValueSize", "10"]],
    );
    view.teardown();
  });

  it("accepts a $set exactly at the limit and rejects one past it", async () => {
    const { view, occurrences } = await build(
      JSON.stringify({
        version: "1.0.0",
        state: { s: "string" },
        root: {
          type: "Text",
          id: "t",
          properties: { text: { $expr: "state.s" } },
          on: { tap: [{ action: "$set", key: "s", value: { $expr: "$concat(state.s, 'x')" } }] },
        },
      }),
      { s: MilanoValue.string("abcdefg") },
    );
    view.emit("t", "tap");
    assert.equal(view.state["s"]?.stringValue, "abcdefgx");
    view.emit("t", "tap");
    assert.equal(view.state["s"]?.stringValue, "abcdefgx");
    assert.equal(occurrences.filter((o) => o.kind === "rejectedMutation").length, 1);
    view.teardown();
  });

  it("rejects a context update whole and keeps the previous values", async () => {
    const handle = new MilanoContextHandle({ who: MilanoValue.string("Ada"), n: MilanoValue.int(1n) });
    const { view, occurrences } = await build(
      JSON.stringify({
        version: "1.0.0",
        context: { who: "string", n: "int" },
        root: { type: "Text", id: "t", properties: { text: { $expr: "$concat(context.who, $str(context.n))" } } },
      }),
      {},
      handle,
    );
    handle.update({ who: MilanoValue.string("a very long name"), n: MilanoValue.int(2n) });
    assert.equal(view.resolvedRoot.values["text"]?.stringValue, "Ada1");
    assert.deepEqual(
      occurrences.map((o) => [o.kind, o.name, o.expected, o.found]),
      [["rejectedContextUpdate", "who", "maxValueSize", "16"]],
    );
    view.teardown();
  });

  it("refuses initial values past the limit at the gate", async () => {
    await assert.rejects(
      build(
        JSON.stringify({
          version: "1.0.0",
          state: { s: "string" },
          root: { type: "Text", id: "t", properties: { text: { $expr: "state.s" } } },
        }),
        { s: MilanoValue.string("nine char") },
      ),
      (error: unknown) =>
        error instanceof MilanoBuildError &&
        error.type === "LimitExceeded" &&
        error.limit === "maxValueSize" &&
        error.value === 8 &&
        error.actual === 9,
    );
  });
});
