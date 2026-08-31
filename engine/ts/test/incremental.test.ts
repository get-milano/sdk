import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import { dependencies } from "../src/expression/dependencies.ts";
import { parseExpression } from "../src/expression/parser.ts";
import { MilanoContextHandle } from "../src/runtime/context-source.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * Incremental resolution: an update re-evaluates only what reads a key
 * whose value changed, rebuilds only the path to those nodes, and leaves
 * every other subtree as the object it was. The conformance vector
 * `dispatch-set-independent-expression-not-reevaluated` pins the
 * observable half (no repeated arithmetic report); this pins the rest.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "incremental",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: {},
});

const DOCUMENT = JSON.stringify({
  version: "1.0.0",
  context: { who: "string" },
  state: { divisor: "int", other: "int", person: { record: { name: "string" } } },
  root: {
    type: "Column",
    id: "root",
    children: [
      { type: "Text", id: "ratio", properties: { text: { $expr: "$str(100 / state.divisor)" } } },
      { type: "Text", id: "greeting", properties: { text: { $expr: "$concat('hi ', context.who)" } } },
      { type: "Text", id: "name", properties: { text: { $expr: "state.person.name" } } },
      { type: "Column", id: "static", children: [
        { type: "Text", id: "fixed", properties: { text: "fixed" } },
      ] },
      { type: "Text", id: "buttons", properties: { text: "x" },
        on: { tap: [{ action: "$set", key: "other", value: { $expr: "state.other + 1" } }] } },
    ],
  },
});

async function build(): Promise<{
  view: MilanoView;
  occurrences: MilanoOccurrence[];
  context: MilanoContextHandle;
  notifications: () => number;
}> {
  const registry = new MilanoRegistry<string>();
  registry.register("Column", "column");
  registry.register("Text", "text");
  const occurrences: MilanoOccurrence[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
  });
  const context = new MilanoContextHandle({ who: MilanoValue.string("Ada") });
  const view = await engine
    .viewBuilder(DOCUMENT)
    .contextSource(context)
    .stateData(() => ({
      divisor: MilanoValue.int(0n),
      other: MilanoValue.int(0n),
      person: MilanoValue.record({ name: MilanoValue.string("Grace") }),
    }))
    .build();
  let count = 0;
  view.subscribe(() => {
    count += 1;
  });
  return { view, occurrences, context, notifications: () => count };
}

describe("dependency extraction", () => {
  const keys = (source: string): string[] => [...dependencies(parseExpression(source))].sort();

  it("collects state and context keys through every construct", () => {
    assert.deepEqual(
      keys("$if(state.flag, context.a ?? 'x', $str(state.n + -state.m))"),
      ["context.a", "state.flag", "state.m", "state.n"],
    );
  });

  it("treats a record field access as reading the whole key", () => {
    assert.deepEqual(keys("state.person.name"), ["state.person"]);
  });

  it("finds nothing in a literal expression", () => {
    assert.deepEqual(keys("1 + 2"), []);
  });
});

describe("incremental re-resolution", () => {
  it("re-evaluates nothing, and notifies no one, for an unrelated key", async () => {
    const { view, occurrences, notifications } = await build();
    assert.equal(occurrences.filter((o) => o.kind === "divisionByZero").length, 1);
    const before = view.resolvedRoot;
    view.emit("buttons", "tap");
    assert.equal(view.state["other"]?.intValue, 1n);
    assert.equal(occurrences.filter((o) => o.kind === "divisionByZero").length, 1);
    assert.equal(notifications(), 0);
    assert.strictEqual(view.resolvedRoot, before);
    view.teardown();
  });

  it("keeps untouched subtrees as the same objects when a sibling changes", async () => {
    const { view, context, notifications } = await build();
    const before = view.resolvedRoot;
    context.update({ who: MilanoValue.string("Grace") });
    const after = view.resolvedRoot;
    assert.notStrictEqual(after, before);
    assert.equal(after.children[1]?.values["text"]?.stringValue, "hi Grace");
    assert.strictEqual(after.children[0], before.children[0], "ratio was rebuilt");
    assert.strictEqual(after.children[3], before.children[3], "the static subtree was rebuilt");
    assert.equal(notifications(), 1);
    view.teardown();
  });

  it("does nothing for a context update that changes no value", async () => {
    const { view, context, occurrences, notifications } = await build();
    const before = view.resolvedRoot;
    context.update({ who: MilanoValue.string("Ada") });
    assert.strictEqual(view.resolvedRoot, before);
    assert.equal(notifications(), 0);
    assert.equal(occurrences.filter((o) => o.kind === "rejectedContextUpdate").length, 0);
    view.teardown();
  });

  it("re-evaluates a record field reader when the whole key is set", async () => {
    const registry = new MilanoRegistry<string>();
    registry.register("Column", "column");
    registry.register("Text", "text");
    const engine = new MilanoEngine<string>({ vocabularyJson: VOCABULARY, registry });
    const view = await engine
      .viewBuilder(
        JSON.stringify({
          version: "1.0.0",
          state: { person: { record: { name: "string" } } },
          root: {
            type: "Text",
            id: "name",
            properties: { text: { $expr: "state.person.name" } },
            on: {
              tap: [{ action: "$set", key: "person", value: { $expr: "state.person" } }],
            },
          },
        }),
      )
      .stateData(() => ({ person: MilanoValue.record({ name: MilanoValue.string("Grace") }) }))
      .build();
    let notified = 0;
    view.subscribe(() => {
      notified += 1;
    });
    // The same record value: nothing changed, nothing re-resolves.
    view.emit("name", "tap");
    assert.equal(notified, 0);
    view.teardown();
  });
});
