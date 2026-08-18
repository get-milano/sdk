import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoEngine, MilanoRegistry, MilanoValue } from "@get-milano/core";
import type { ReactElement } from "react";

import { MilanoNode, MilanoUnknownNode, renderNode } from "../src/node.ts";
import type { MilanoPlaceholderRenderer, MilanoRenderer } from "../src/node.ts";

const vocabulary = JSON.stringify({
  milano: "1.0.0",
  name: "react",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: {
      properties: { text: "string", note: "string?" },
      events: { tap: null, change: "string" },
    },
  },
});

const document = JSON.stringify({
  version: "1.0.0",
  root: {
    type: "Column",
    id: "root",
    children: [
      { type: "Text", id: "a", properties: { text: "first" } },
      { type: "Text", id: "b", properties: { text: "second" } },
    ],
  },
});

const StubRenderer: MilanoRenderer = () => null;
const StubPlaceholder: MilanoPlaceholderRenderer = () => null;

async function buildView() {
  const registry = new MilanoRegistry<MilanoRenderer, MilanoPlaceholderRenderer>();
  registry.register("Column", StubRenderer);
  registry.register("Text", StubRenderer);
  registry.registerPlaceholder(StubPlaceholder);
  const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
    vocabularyJson: vocabulary,
    registry,
  });
  const view = await engine.viewBuilder(document).label("test").build();
  return { view, registry };
}

describe("node materialization", () => {
  it("renders a node through its registered renderer, keyed by reference", async () => {
    const { view, registry } = await buildView();
    const element = renderNode(view, registry, view.resolvedRoot) as ReactElement;
    assert.equal(element.type, StubRenderer);
    assert.equal(element.key, "root");
  });

  it("materializes children in document order with stable keys", async () => {
    const { view, registry } = await buildView();
    const node = new MilanoNode(view, registry, view.resolvedRoot);
    const children = node.children;
    assert.equal(children.length, 2);
    assert.deepEqual(
      children.map((child) => child.key),
      ["a", "b"],
    );
    const first = children[0]?.props as { node: MilanoNode };
    assert.equal(first.node.property("text").stringValue, "first");
  });

  it("reads declared properties and absent optionals as null", async () => {
    const { view, registry } = await buildView();
    const text = view.resolvedRoot.children[0];
    assert.ok(text !== undefined);
    const node = new MilanoNode(view, registry, text);
    assert.equal(node.type, "Text");
    assert.equal(node.reference, "a");
    assert.equal(node.property("text").stringValue, "first");
    assert.ok(node.property("note").isNull);
    assert.ok(node.property("undeclared").isNull);
  });

  it("emits through the node's own reference", async () => {
    const { view, registry } = await buildView();
    const occurrences: string[] = [];
    const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
      vocabularyJson: vocabulary,
      registry,
      observer: { occurrence: (occurrence) => occurrences.push(occurrence.kind) },
    });
    const observed = await engine.viewBuilder(document).label("emit").build();
    const text = observed.resolvedRoot.children[0];
    assert.ok(text !== undefined);
    new MilanoNode(observed, registry, text).emit("tap");
    // Declared but unbound: dropped and reported, which proves the
    // emission reached dispatch with the right node reference.
    assert.deepEqual(occurrences, ["droppedEvent"]);
    void view;
  });

  it("reports widget interactions without touching dispatch", async () => {
    const registry = new MilanoRegistry<MilanoRenderer, MilanoPlaceholderRenderer>();
    registry.register("Column", StubRenderer);
    registry.register("Text", StubRenderer);
    const interactions: { kind: string; node: string | null }[] = [];
    const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
      vocabularyJson: vocabulary,
      registry,
      userInteractionObserver: {
        interaction: (interaction) =>
          interactions.push({ kind: interaction.kind, node: interaction.node }),
      },
    });
    const view = await engine.viewBuilder(document).label("analytics").build();
    const text = view.resolvedRoot.children[1];
    assert.ok(text !== undefined);
    new MilanoNode(view, registry, text).userInteraction(
      "focusGained",
      MilanoValue.string("b"),
    );
    assert.deepEqual(interactions, [
      { kind: "viewBuilt", node: null },
      { kind: "focusGained", node: "b" },
    ]);
  });

  it("routes unknown types to the placeholder renderer as data", async () => {
    const registry = new MilanoRegistry<MilanoRenderer, MilanoPlaceholderRenderer>();
    registry.register("Column", StubRenderer);
    registry.register("Text", StubRenderer);
    registry.registerPlaceholder(StubPlaceholder);
    const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
      vocabularyJson: vocabulary,
      registry,
      defaultUnknownTypePolicy: "placeholder",
    });
    const withUnknown = JSON.stringify({
      version: "1.0.0",
      root: {
        type: "Column",
        id: "root",
        children: [{ type: "Mystery", id: "m", properties: { anything: 1 } }],
      },
    });
    const view = await engine.viewBuilder(withUnknown).label("placeholder").build();
    const unknown = view.resolvedRoot.children[0];
    assert.ok(unknown !== undefined);
    const element = renderNode(view, registry, unknown) as ReactElement;
    assert.equal(element.type, StubPlaceholder);
    const props = element.props as { node: MilanoUnknownNode };
    assert.equal(props.node.type, "Mystery");
    assert.equal(props.node.reference, "m");
    // The subtree arrives as data, never as live children.
    assert.equal(props.node.subtree?.recordValue?.["type"]?.stringValue, "Mystery");
  });
});
