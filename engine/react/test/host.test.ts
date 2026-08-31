import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoEngine, MilanoValue } from "@get-milano/core";
import type { MilanoAction } from "@get-milano/core";
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";

import { MilanoHost, MilanoQuickHost, MilanoRenderedView } from "../src/host.ts";
import type { MilanoReactBuilder } from "../src/host.ts";
import { createMilanoRegistry } from "../src/node.ts";
import type { MilanoNodeProps, MilanoPlaceholderRenderer, MilanoRenderer } from "../src/node.ts";

/**
 * The host's lifecycle, which the node tests cannot reach: what is on
 * screen while a build runs, what happens when the builder is swapped, and
 * what a rebuild costs. Every test here fails without its fix, mostly by
 * showing the previous document for a frame.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "host",
  version: "1.0.0",
  components: {
    Label: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: { save: {} },
});

function documentSaying(text: string, options: { readonly tap?: boolean } = {}): string {
  return JSON.stringify({
    version: "1.0.0",
    root: {
      type: "Label",
      id: "only",
      properties: { text },
      ...(options.tap === true ? { on: { tap: [{ action: "save" }] } } : {}),
    },
  });
}

/**
 * Two engines whose renderers are distinguishable, and which record every
 * render they perform. The log is what makes the swap test independent of
 * frame timing: a stale pairing shows up as engine `b` rendering document
 * `one`, whether or not that frame was ever painted.
 */
function engineRendering(
  prefix: string,
  log: string[] = [],
): MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer> {
  const Renderer = ({ node }: MilanoNodeProps) => {
    const rendered = `${prefix}:${node.property("text").stringValue ?? ""}`;
    log.push(rendered);
    return createElement("span", null, rendered);
  };
  const registry = createMilanoRegistry();
  registry.register("Label", Renderer);
  return new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
    vocabularyJson: VOCABULARY,
    registry,
  });
}

function textOf(renderer: TestRenderer.ReactTestRenderer): string {
  const json = renderer.toJSON();
  if (json === null) return "";
  const nodes = Array.isArray(json) ? json : [json];
  return nodes
    .map((node) => (typeof node === "string" ? node : (node.children ?? []).join("")))
    .join("");
}

describe("MilanoHost", () => {
  it("shows the loading content until the build resolves", async () => {
    const builder = engineRendering("a").viewBuilder(documentSaying("hello"));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoHost, { builder, loading: createElement("span", null, "loading") }),
      );
    });
    assert.equal(textOf(renderer), "a:hello");
    await act(async () => renderer.unmount());
  });

  it("never pairs the previous view with the next builder's registry", async () => {
    const log: string[] = [];
    const first = engineRendering("a", log).viewBuilder(documentSaying("one"));
    const second = engineRendering("b", log).viewBuilder(documentSaying("two"));

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(MilanoHost, { builder: first }));
    });
    assert.deepEqual(log, ["a:one"]);

    log.length = 0;
    await act(async () => {
      renderer.update(
        createElement(MilanoHost, {
          builder: second,
          loading: createElement("span", null, "loading"),
        }),
      );
    });

    // Nothing between the swap and the new view: not the old document
    // through the new engine's renderers (`b:one`), and not the old view
    // rendered again (`a:one`).
    assert.deepEqual(log, ["b:two"]);
    assert.equal(textOf(renderer), "b:two");
    await act(async () => renderer.unmount());
  });

  it("renders the failure content, and nothing else, on a rejected build", async () => {
    const builder = engineRendering("a").viewBuilder('{"version": "1.0.0", "root": {}}');
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoHost, {
          builder,
          failure: () => createElement("span", null, "failed"),
        }),
      );
    });
    assert.equal(textOf(renderer), "failed");
    await act(async () => renderer.unmount());
  });

  it("tears the view down when it unmounts", async () => {
    const kinds: string[] = [];
    const Renderer = ({ node }: MilanoNodeProps) =>
      createElement("span", null, node.property("text").stringValue ?? "");
    const registry = createMilanoRegistry();
    registry.register("Label", Renderer);
    const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
      vocabularyJson: VOCABULARY,
      registry,
      userInteractionObserver: { interaction: (i) => kinds.push(i.kind) },
    });
    const builder: MilanoReactBuilder = engine.viewBuilder(documentSaying("bye"));

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(MilanoHost, { builder }));
    });
    // The host delivers the lifecycle signals from React's own account of
    // presentation: the view appears once mounted, disappears before it is
    // torn down (runtime API spec, MilanoHost).
    assert.deepEqual(kinds, ["viewBuilt", "viewAppeared"]);
    await act(async () => renderer.unmount());
    assert.deepEqual(kinds, ["viewBuilt", "viewAppeared", "viewDisappeared", "viewTornDown"]);
  });

  it("runs the document's lifecycle bindings when it appears", async () => {
    const Renderer = ({ node }: MilanoNodeProps) =>
      createElement("span", null, node.property("text").stringValue ?? "");
    const registry = createMilanoRegistry();
    registry.register("Label", Renderer);
    const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
      vocabularyJson: VOCABULARY,
      registry,
    });
    const builder: MilanoReactBuilder = engine
      .viewBuilder(
        JSON.stringify({
          version: "2.1.0",
          state: { text: "string" },
          root: { type: "Label", id: "only", properties: { text: { $expr: "state.text" } } },
          on: { appear: [{ action: "$set", key: "text", value: "shown" }] },
        }),
      )
      .stateData(() => ({ text: MilanoValue.string("hidden") }));

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(MilanoHost, { builder }));
    });
    assert.equal(textOf(renderer), "shown");
    await act(async () => renderer.unmount());
  });
});

describe("a view the host places itself", () => {
  it("re-renders when the document is replaced under it", async () => {
    // `replace` swaps a live view's document through the gate, keeping the
    // state whose declaration is unchanged. The binding learns of it the
    // way it learns of a `$set`: through the view's own subscription, with
    // no rebuild and no new builder.
    const engine = engineRendering("a");
    const view = await engine
      .viewBuilder(
        JSON.stringify({
          version: "2.1.0",
          state: { greeting: "string" },
          root: { type: "Label", id: "only", properties: { text: { $expr: "state.greeting" } } },
        }),
      )
      .stateData(() => ({ greeting: MilanoValue.string("kept") }))
      .build();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoRenderedView, { view, registry: engine.registry }),
      );
    });
    assert.equal(textOf(renderer), "a:kept");

    await act(async () => {
      await view.replace(
        JSON.stringify({
          version: "2.1.0",
          state: { greeting: "string" },
          root: {
            type: "Label",
            id: "only",
            properties: { text: { $expr: "$concat(state.greeting, ' twice')" } },
          },
        }),
      );
    });
    // The state carried over, and the rendered output followed the swap.
    assert.equal(textOf(renderer), "a:kept twice");
    await act(async () => renderer.unmount());
  });
});

describe("MilanoQuickHost", () => {
  it("keeps the view across re-renders with a fresh action closure", async () => {
    const dispatched: string[] = [];
    const renderers = { Label: ({ node }: MilanoNodeProps) => createElement("span", null, node.property("text").stringValue ?? "") };
    const props = {
      document: documentSaying("stable", { tap: true }),
      vocabulary: VOCABULARY,
      renderers,
    };

    const kinds: string[] = [];
    const element = (round: number) =>
      createElement(MilanoQuickHost, {
        ...props,
        // A new closure every render: the common shape, and the one that
        // used to rebuild the view and reset its state.
        onAction: (action: MilanoAction) => {
          dispatched.push(`${round}:${action.name}`);
          return null;
        },
        userInteractionObserver: { interaction: (i) => kinds.push(i.kind) },
      });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(element(1));
    });
    await act(async () => renderer.update(element(2)));
    await act(async () => renderer.update(element(3)));

    // One build, not three.
    assert.deepEqual(kinds.filter((kind) => kind === "viewBuilt").length, 1);
    await act(async () => renderer.unmount());
  });

  it("surfaces an engine failure through the failure content, building once", async () => {
    let attempts = 0;
    const renderers = {
      Label: ({ node }: MilanoNodeProps) => {
        attempts += 1;
        return createElement("span", null, node.property("text").stringValue ?? "");
      },
    };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoQuickHost, {
          document: documentSaying("x"),
          vocabulary: "{ not a vocabulary",
          renderers,
          failure: (error: unknown) =>
            createElement("span", null, error instanceof Error ? "typed" : "untyped"),
        }),
      );
    });
    assert.equal(textOf(renderer), "typed");
    assert.equal(attempts, 0);
    await act(async () => renderer.unmount());
  });

  it("synthesizes declared state so a first integration needs no provider", async () => {
    const renderers = {
      Label: ({ node }: MilanoNodeProps) =>
        createElement("span", null, node.property("text").stringValue ?? ""),
    };
    const document = JSON.stringify({
      version: "1.0.0",
      state: { count: "int" },
      root: {
        type: "Label",
        id: "only",
        properties: { text: { $expr: "$concat('count=', $str(state.count))" } },
      },
    });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(MilanoQuickHost, { document, vocabulary: VOCABULARY, renderers }),
      );
    });
    assert.equal(textOf(renderer), "count=0");
    await act(async () => renderer.unmount());
  });

  it("keeps state across re-renders and updates on emission", async () => {
    const document = JSON.stringify({
      version: "1.0.0",
      state: { count: "int" },
      root: {
        type: "Label",
        id: "only",
        properties: { text: { $expr: "$concat('count=', $str(state.count))" } },
        on: { tap: [{ action: "$set", key: "count", value: { $expr: "state.count + 1" } }] },
      },
    });
    let tap: (() => void) | null = null;
    const renderers = {
      Label: ({ node }: MilanoNodeProps) => {
        tap = () => node.emit("tap");
        return createElement("span", null, node.property("text").stringValue ?? "");
      },
    };
    const element = () =>
      createElement(MilanoQuickHost, {
        document,
        vocabulary: VOCABULARY,
        renderers,
        onAction: () => null,
      });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(element());
    });
    await act(async () => {
      (tap as unknown as () => void)();
    });
    assert.equal(textOf(renderer), "count=1");

    // A parent re-render with fresh props must not restart the document.
    await act(async () => renderer.update(element()));
    assert.equal(textOf(renderer), "count=1");
    await act(async () => renderer.unmount());
  });
});
