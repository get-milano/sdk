import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * The `$repeat` construct beyond what the vectors pin: how instances
 * behave under incremental resolution (identity kept when nothing they
 * read changed, re-materialized whole otherwise) and the shape of the
 * resolved tree a binding sees.
 */

const VOCABULARY = JSON.stringify({
  milano: "2.0.0",
  name: "repeat",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: {},
});

const ROWS = MilanoValue.array([
  MilanoValue.record({ name: MilanoValue.string("Alpha") }),
  MilanoValue.record({ name: MilanoValue.string("Beta") }),
]);

async function build(document: object): Promise<{ view: MilanoView; occurrences: MilanoOccurrence[] }> {
  const registry = new MilanoRegistry<string>();
  registry.register("Column", "column");
  registry.register("Text", "text");
  const occurrences: MilanoOccurrence[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
  });
  const view = await engine
    .viewBuilder(JSON.stringify(document))
    .stateData(() => ({ rows: ROWS, prefix: MilanoValue.string(""), other: MilanoValue.int(0n) }))
    .build();
  return { view, occurrences };
}

const DOCUMENT = {
  version: "2.0.0",
  state: { rows: { array: { record: { name: "string" } } }, prefix: "string", other: "int" },
  root: {
    type: "Column",
    id: "list",
    children: [
      { type: "Text", id: "head", properties: { text: "head" } },
      {
        type: "$repeat",
        id: "each",
        items: { $expr: "state.rows" },
        as: "row",
        children: [{ type: "Text", id: "name", properties: { text: { $expr: "$concat(state.prefix, row.name)" } } }],
      },
      {
        type: "Text",
        id: "control",
        properties: { text: "x" },
        on: {
          tap: [{ action: "$set", key: "other", value: { $expr: "state.other + 1" } }],
        },
      },
      {
        type: "Text",
        id: "prefixer",
        properties: { text: "x" },
        on: { tap: [{ action: "$set", key: "prefix", value: "> " }] },
      },
    ],
  },
};

describe("$repeat under incremental resolution", () => {
  it("materializes instances in place of the construct, with the parent's spans", async () => {
    const { view } = await build(DOCUMENT);
    const root = view.resolvedRoot;
    assert.deepEqual(
      root.children.map((child) => child.reference),
      ["head", "name[0]", "name[1]", "control", "prefixer"],
    );
    assert.deepEqual([...root.spans], [1, 2, 1, 1]);
    assert.equal(root.children[1]?.values["text"]?.stringValue, "Alpha");
    view.teardown();
  });

  it("keeps instance identity when nothing they read changed", async () => {
    const { view } = await build(DOCUMENT);
    const before = view.resolvedRoot;
    view.emit("control", "tap");
    assert.equal(view.state["other"]?.intValue, 1n);
    // Nothing reads `other`: the tree is the same object.
    assert.strictEqual(view.resolvedRoot, before);
    view.teardown();
  });

  it("re-materializes every instance when something they read changed", async () => {
    const { view } = await build(DOCUMENT);
    const before = view.resolvedRoot;
    view.emit("prefixer", "tap");
    const after = view.resolvedRoot;
    assert.notStrictEqual(after, before);
    assert.equal(after.children[1]?.values["text"]?.stringValue, "> Alpha");
    assert.equal(after.children[2]?.values["text"]?.stringValue, "> Beta");
    // Siblings outside the repeat kept their identity.
    assert.strictEqual(after.children[0], before.children[0]);
    assert.strictEqual(after.children[3], before.children[3]);
    view.teardown();
  });

  it("dispatches an instance emission with the element bound", async () => {
    const { view, occurrences } = await build({
      ...DOCUMENT,
      root: {
        type: "Column",
        id: "list",
        children: [
          {
            type: "$repeat",
            id: "each",
            items: { $expr: "state.rows" },
            as: "row",
            children: [
              {
                type: "Text",
                id: "name",
                properties: { text: { $expr: "row.name" } },
                on: { tap: [{ action: "$set", key: "prefix", value: { $expr: "$concat(row.name, $str(row_index))" } }] },
              },
            ],
          },
        ],
      },
    });
    view.emit("name[1]", "tap");
    assert.equal(view.state["prefix"]?.stringValue, "Beta1");
    view.emit("name[7]", "tap");
    assert.deepEqual(
      occurrences.map((o) => [o.kind, o.node, o.expected, o.found]),
      [["invalidEmission", "name[7]", "repeat element", "index 7"]],
    );
    view.teardown();
  });
});
