import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoType } from "../src/core/type.ts";
import { MilanoBuildError } from "../src/document/errors.ts";
import { MilanoEngineError } from "../src/document/errors.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import { MilanoContextHandle } from "../src/runtime/context-source.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * The builder's obligations, which conformance vectors cannot express:
 * what a surface must supply before a document will build, how capability
 * narrowing works through the public API, error propagation from the
 * provider, per-view policy overrides, and labels on observability.
 *
 * The Swift and Kotlin suites carry the same file; this is the third.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "contract",
  version: "1.0.0",
  components: {
    Button: { properties: { label: "string" }, events: { tap: null } },
    Text: { properties: { text: "string" } },
    Box: { children: true },
  },
  actions: { ping: {}, pong: {} },
});

function engine(observer?: (occurrence: MilanoOccurrence) => void) {
  const registry = new MilanoRegistry<string>();
  registry.register("Button", "button");
  registry.register("Text", "text");
  registry.register("Box", "box");
  return new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    ...(observer === undefined ? {} : { observer: { occurrence: observer } }),
  });
}

function document(action = "ping"): string {
  return JSON.stringify({
    version: "1.0.0",
    root: {
      type: "Button",
      id: "b",
      properties: { label: "Go" },
      on: { tap: [{ action }] },
    },
  });
}

async function buildError(builder: { build: () => Promise<MilanoView> }): Promise<MilanoBuildError> {
  try {
    await builder.build();
  } catch (error) {
    assert.ok(error instanceof MilanoBuildError, `expected a build error, got ${error}`);
    return error;
  }
  throw new Error("expected the build to fail");
}

describe("what a surface must supply", () => {
  it("refuses a document that dispatches custom actions with no handler", async () => {
    const error = await buildError(engine().viewBuilder(document()));
    assert.equal(error.rule, "action-handler");
  });

  it("needs no handler for built-in actions alone", async () => {
    const builtIn = JSON.stringify({
      version: "1.0.0",
      state: { count: "int" },
      root: {
        type: "Button",
        id: "b",
        properties: { label: "Go" },
        on: { tap: [{ action: "$set", key: "count", value: 1 }] },
      },
    });
    const view = await engine()
      .viewBuilder(builtIn)
      .stateData(() => ({ count: MilanoValue.int(0n) }))
      .build();
    view.teardown();
  });

  it("fails when a declared context key is not supplied", async () => {
    const withContext = JSON.stringify({
      version: "1.0.0",
      context: { who: "string" },
      root: { type: "Text", properties: { text: { $expr: "context.who" } } },
    });
    const error = await buildError(engine().viewBuilder(withContext));
    assert.equal(error.rule, "context-declaration");
  });

  it("fails when a document declares state and no provider was given", async () => {
    const withState = JSON.stringify({
      version: "1.0.0",
      state: { count: "int" },
      root: { type: "Text", properties: { text: { $expr: "str(state.count)" } } },
    });
    const error = await buildError(engine().viewBuilder(withState));
    assert.equal(error.rule, "state-declaration");
  });

  it("lets a provider's own error through unchanged", async () => {
    const withState = JSON.stringify({
      version: "1.0.0",
      state: { count: "int" },
      root: { type: "Text", properties: { text: { $expr: "str(state.count)" } } },
    });
    const failure = new Error("the network is down");
    await assert.rejects(
      engine()
        .viewBuilder(withState)
        .stateData(() => {
          throw failure;
        })
        .build(),
      (error: unknown) => error === failure,
    );
  });
});

describe("capability narrowing", () => {
  it("narrows the granted set with an allowlist", async () => {
    const error = await buildError(
      engine().viewBuilder(document("pong")).allowActions(["ping"]).actionHandler(() => null),
    );
    assert.equal(error.rule, "action-capability");
    assert.equal(error.found, "pong");
  });

  it("keeps what the allowlist admits", async () => {
    const view = await engine()
      .viewBuilder(document("ping"))
      .allowActions(["ping"])
      .actionHandler(() => null)
      .build();
    view.teardown();
  });

  it("adds a builder declaration to the granted set", async () => {
    const view = await engine()
      .viewBuilder(
        JSON.stringify({
          version: "1.0.0",
          root: {
            type: "Button",
            id: "b",
            properties: { label: "Go" },
            on: { tap: [{ action: "surfaceOnly", note: "hello" }] },
          },
        }),
      )
      .action("surfaceOnly", { parameters: { note: MilanoType.string() } })
      .actionHandler(() => null)
      .build();
    view.teardown();
  });

  it("lets a builder declaration override the vocabulary's signature", async () => {
    // `ping` takes no parameters in the vocabulary; this surface says it
    // takes one, and the document may then pass it.
    const view = await engine()
      .viewBuilder(
        JSON.stringify({
          version: "1.0.0",
          root: {
            type: "Button",
            id: "b",
            properties: { label: "Go" },
            on: { tap: [{ action: "ping", extra: "x" }] },
          },
        }),
      )
      .action("ping", { parameters: { extra: MilanoType.string() } })
      .actionHandler(() => null)
      .build();
    view.teardown();
  });
});

describe("per-view overrides", () => {
  it("overrides the engine's unknown-type policy", async () => {
    const unknown = JSON.stringify({
      version: "1.0.0",
      root: { type: "Box", id: "box", children: [{ type: "Mystery" }] },
    });
    // The engine defaults to fail.
    await assert.rejects(engine().viewBuilder(unknown).build());

    const occurrences: string[] = [];
    const view = await engine((occurrence) => occurrences.push(occurrence.kind))
      .viewBuilder(unknown)
      .unknownTypePolicy("skip")
      .build();
    assert.deepEqual(occurrences, ["unknownTypeSkipped"]);
    view.teardown();
  });

  it("refuses the placeholder override when the registry has no placeholder", async () => {
    try {
      await engine().viewBuilder(document()).unknownTypePolicy("placeholder").build();
      assert.fail("expected IncompleteRegistry");
    } catch (error) {
      assert.ok(error instanceof MilanoEngineError);
      assert.equal(error.type, "IncompleteRegistry");
    }
  });

  it("puts the label on every occurrence the view reports", async () => {
    const identities: string[] = [];
    const view = await engine((occurrence) => identities.push(occurrence.viewIdentity))
      .viewBuilder(document())
      .label("checkout-banner")
      .actionHandler(() => null)
      .build();
    view.emit("b", "nonexistent");
    assert.ok(identities.length > 0, "no occurrence was reported");
    for (const identity of identities) {
      assert.ok(identity.includes("checkout-banner"), `identity lost the label: ${identity}`);
    }
    view.teardown();
  });
});

describe("emissions at the edges", () => {
  async function built(): Promise<{ view: MilanoView; occurrences: string[] }> {
    const occurrences: string[] = [];
    const view = await engine((occurrence) => occurrences.push(occurrence.kind))
      .viewBuilder(document())
      .actionHandler(() => null)
      .build();
    return { view, occurrences };
  }

  it("reports an emission for a node that does not exist", async () => {
    const { view, occurrences } = await built();
    view.emit("nowhere", "tap");
    assert.deepEqual(occurrences, ["invalidEmission"]);
    view.teardown();
  });

  it("reports an emission for an undeclared event", async () => {
    const { view, occurrences } = await built();
    view.emit("b", "swipe");
    assert.deepEqual(occurrences, ["invalidEmission"]);
    view.teardown();
  });

  it("reports a payload where the event declares none", async () => {
    const { view, occurrences } = await built();
    view.emit("b", "tap", MilanoValue.string("unexpected"));
    assert.deepEqual(occurrences, ["invalidEmission"]);
    view.teardown();
  });

  it("stays silent for an emission after teardown", async () => {
    const { view, occurrences } = await built();
    view.teardown();
    occurrences.length = 0;
    view.emit("b", "tap");
    assert.deepEqual(occurrences, [], "a post-teardown emission represents no pending work");
  });
});

describe("context handles", () => {
  it("re-resolves when the handle is updated, and stops at teardown", async () => {
    const handle = new MilanoContextHandle({ who: MilanoValue.string("Ada") });
    const withContext = JSON.stringify({
      version: "1.0.0",
      context: { who: "string" },
      root: { type: "Text", id: "t", properties: { text: { $expr: "context.who" } } },
    });
    const view = await engine().viewBuilder(withContext).contextSource(handle).build();
    assert.equal(view.resolvedRoot.values["text"]?.stringValue, "Ada");

    handle.update({ who: MilanoValue.string("Grace") });
    assert.equal(view.resolvedRoot.values["text"]?.stringValue, "Grace");

    view.teardown();
    handle.update({ who: MilanoValue.string("Katherine") });
    assert.equal(
      view.resolvedRoot.values["text"]?.stringValue,
      "Grace",
      "a torn-down view kept following its context source",
    );
  });

  it("rejects an update that does not satisfy the declarations, atomically", async () => {
    const occurrences: string[] = [];
    const handle = new MilanoContextHandle({
      who: MilanoValue.string("Ada"),
      count: MilanoValue.int(1n),
    });
    const withContext = JSON.stringify({
      version: "1.0.0",
      context: { who: "string", count: "int" },
      root: { type: "Text", id: "t", properties: { text: { $expr: "context.who" } } },
    });
    const view = await engine((occurrence) => occurrences.push(occurrence.kind))
      .viewBuilder(withContext)
      .contextSource(handle)
      .build();

    handle.update({ who: MilanoValue.int(7n), count: MilanoValue.int(2n) });
    assert.deepEqual(occurrences, ["rejectedContextUpdate"]);
    assert.equal(view.resolvedRoot.values["text"]?.stringValue, "Ada");
    assert.equal(view.context["count"]?.intValue, 1n, "a rejected update applied partially");
    view.teardown();
  });
});
