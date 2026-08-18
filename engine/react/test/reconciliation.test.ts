import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoEngine, MilanoValue } from "@get-milano/core";
import { act, createElement, useEffect, useRef, useState } from "react";
import TestRenderer from "react-test-renderer";

import { MilanoRenderedView } from "../src/host.ts";
import { createMilanoRegistry } from "../src/node.ts";
import type { MilanoNodeProps } from "../src/node.ts";

/**
 * Re-resolution produces a fresh tree on every state change, so the
 * binding keys each element by its node reference. If that ever regressed,
 * React would unmount and remount the subtree instead of updating it: a
 * text field would lose focus and its cursor on every keystroke, a
 * scrolled list would jump to the top, and an animation would restart.
 * None of that shows up in a snapshot, so it is checked directly here.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "reconcile",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Field: { properties: { label: "string" }, events: { change: "string" } },
    Text: { properties: { text: "string" } },
  },
  actions: {},
});

const DOCUMENT = JSON.stringify({
  version: "1.0.0",
  state: { count: "int", label: "string" },
  root: {
    type: "Column",
    id: "root",
    children: [
      { type: "Field", id: "field", properties: { label: { $expr: "state.label" } },
        on: { change: [{ action: "$set", key: "label", value: { $expr: "event" } }] } },
      { type: "Text", id: "readout", properties: { text: { $expr: "str(state.count)" } } },
    ],
  },
});

/** Counts mounts, so a remount is visible even when the output matches. */
const mounts: string[] = [];
/** Per-instance state that only survives if React keeps the instance. */
let fieldInstance = 0;

function Field({ node }: MilanoNodeProps) {
  const instance = useRef(0);
  if (instance.current === 0) {
    fieldInstance += 1;
    instance.current = fieldInstance;
  }
  const [typed, setTyped] = useState("untouched");
  useEffect(() => {
    mounts.push(`field:${instance.current}`);
  }, []);
  // Exposed so the test can drive it the way a keystroke would.
  handles.type = (value: string) => {
    setTyped(value);
    node.emit("change", MilanoValue.string(value));
  };
  return createElement(
    "input",
    null,
    `${node.property("label").stringValue ?? ""}|${typed}|#${instance.current}`,
  );
}

function Text({ node }: MilanoNodeProps) {
  useEffect(() => {
    mounts.push("text");
  }, []);
  return createElement("span", null, node.property("text").stringValue ?? "");
}

function Column({ node }: MilanoNodeProps) {
  return createElement("div", null, node.children);
}

const handles: { type?: (value: string) => void } = {};

function registry() {
  const created = createMilanoRegistry();
  created.register("Column", Column);
  created.register("Field", Field);
  created.register("Text", Text);
  return created;
}

function textOf(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe("re-resolution keeps component identity", () => {
  it("preserves renderer state across a state change", async () => {
    mounts.length = 0;
    fieldInstance = 0;
    const created = registry();
    const engine = new MilanoEngine({ vocabularyJson: VOCABULARY, registry: created });
    const view = await engine
      .viewBuilder(DOCUMENT)
      .stateData(() => ({ count: MilanoValue.int(0n), label: MilanoValue.string("start") }))
      .build();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoRenderedView, { view, registry: created }),
      );
    });
    assert.ok(textOf(renderer).includes("start|untouched|#1"));
    assert.deepEqual(mounts, ["field:1", "text"]);

    // A keystroke: local component state changes, and the document's
    // state changes with it, forcing a re-resolution of the whole tree.
    await act(async () => {
      handles.type?.("hello");
    });

    const after = textOf(renderer);
    assert.ok(after.includes("hello|hello|#1"), `state was lost across re-resolution: ${after}`);
    assert.deepEqual(
      mounts,
      ["field:1", "text"],
      "a component remounted: keys are not stable across re-resolution",
    );

    await act(async () => renderer.unmount());
    view.teardown();
  });

  it("does not remount siblings when one node's properties change", async () => {
    mounts.length = 0;
    fieldInstance = 0;
    const created = registry();
    const engine = new MilanoEngine({ vocabularyJson: VOCABULARY, registry: created });
    const view = await engine
      .viewBuilder(DOCUMENT)
      .stateData(() => ({ count: MilanoValue.int(0n), label: MilanoValue.string("start") }))
      .build();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoRenderedView, { view, registry: created }),
      );
    });
    const mountedOnce = [...mounts];

    await act(async () => {
      handles.type?.("typing");
    });
    assert.deepEqual(mounts, mountedOnce, "the sibling remounted on an unrelated change");

    await act(async () => renderer.unmount());
    view.teardown();
  });

  it("renders the resolved values, not a stale snapshot", async () => {
    const created = registry();
    const engine = new MilanoEngine({ vocabularyJson: VOCABULARY, registry: created });
    const view = await engine
      .viewBuilder(DOCUMENT)
      .stateData(() => ({ count: MilanoValue.int(7n), label: MilanoValue.string("start") }))
      .build();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoRenderedView, { view, registry: created }),
      );
    });
    assert.ok(textOf(renderer).includes("7"));

    await act(async () => renderer.unmount());
    view.teardown();
  });
});
