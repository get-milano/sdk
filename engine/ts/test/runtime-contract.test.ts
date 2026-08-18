import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import type { MilanoUserInteraction } from "../src/engine/interaction.ts";
import { quickBuilder, synthesizedState } from "../src/runtime/quick-start.ts";
import { MilanoType } from "../src/core/type.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * The runtime's host-facing contracts: typed completion results, the two
 * observability streams, and the quick path. The Swift and Kotlin suites
 * cover these in CompletionResultTests, UserInteractionTests and
 * QuickStartTests; this is the third engine catching up.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "runtime",
  version: "1.0.0",
  components: {
    Field: { properties: { value: "string" }, events: { change: "string", tap: null } },
  },
  actions: {
    submit: { parameters: { value: "string" }, result: "string" },
    plain: {},
  },
});

interface Harness {
  readonly view: MilanoView;
  readonly occurrences: MilanoOccurrence[];
  readonly interactions: MilanoUserInteraction[];
  readonly dispatched: string[];
}

async function harness(options: {
  readonly document: string;
  readonly complete?: (value: MilanoValue | null) => MilanoValue | null | Promise<MilanoValue | null>;
} ): Promise<Harness> {
  const registry = new MilanoRegistry<string>();
  registry.register("Field", "field");
  const occurrences: MilanoOccurrence[] = [];
  const interactions: MilanoUserInteraction[] = [];
  const dispatched: string[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
    userInteractionObserver: { interaction: (interaction) => interactions.push(interaction) },
  });
  const view = await engine
    .viewBuilder(options.document)
    .label("runtime")
    .stateData((declarations) => synthesizedState(declarations))
    .actionHandler((action) => {
      dispatched.push(action.name);
      return options.complete === undefined
        ? null
        : options.complete(action.parameters["value"] ?? null);
    })
    .build();
  return { view, occurrences, interactions, dispatched };
}

/** Lets the handler's promise and the completion it triggers settle. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const RESULT_DOCUMENT = JSON.stringify({
  version: "1.0.0",
  state: { value: "string", outcome: "string" },
  root: {
    type: "Field",
    id: "f",
    properties: { value: { $expr: "state.outcome" } },
    on: {
      tap: [
        {
          action: "submit",
          value: "payload",
          onSuccess: [{ action: "$set", key: "outcome", value: { $expr: "result" } }],
          onFailure: [{ action: "$set", key: "outcome", value: "failed" }],
        },
      ],
    },
  },
});

describe("typed completion results", () => {
  it("binds the handler's value to the result root inside onSuccess", async () => {
    const { view } = await harness({
      document: RESULT_DOCUMENT,
      complete: () => MilanoValue.string("MC-42"),
    });
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "MC-42");
    view.teardown();
  });

  it("runs onFailure, with no result bound, when the handler rejects", async () => {
    const { view } = await harness({
      document: RESULT_DOCUMENT,
      complete: () => Promise.reject(new Error("no")),
    });
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "failed");
    view.teardown();
  });

  it("reports an invalid completion when a declared result is missing", async () => {
    const { view, occurrences } = await harness({
      document: RESULT_DOCUMENT,
      complete: () => null,
    });
    view.emit("f", "tap");
    await settled();
    assert.ok(
      occurrences.some((occurrence) => occurrence.kind === "invalidCompletion"),
      "a null for a declared result should be invalid",
    );
    // Neither branch ran: the completion was consumed.
    assert.equal(view.state["outcome"]?.stringValue, "");
    view.teardown();
  });

  it("reports an invalid completion when the value has the wrong type", async () => {
    const { view, occurrences } = await harness({
      document: RESULT_DOCUMENT,
      complete: () => MilanoValue.int(7n),
    });
    view.emit("f", "tap");
    await settled();
    assert.ok(occurrences.some((occurrence) => occurrence.kind === "invalidCompletion"));
    view.teardown();
  });

  it("reports a value returned for an action declaring no result", async () => {
    const document = JSON.stringify({
      version: "1.0.0",
      root: {
        type: "Field",
        id: "f",
        properties: { value: "x" },
        on: { tap: [{ action: "plain" }] },
      },
    });
    const { view, occurrences } = await harness({
      document,
      complete: () => MilanoValue.string("unasked for"),
    });
    view.emit("f", "tap");
    await settled();
    assert.ok(occurrences.some((occurrence) => occurrence.kind === "invalidCompletion"));
    view.teardown();
  });
});

describe("the analytics stream", () => {
  it("carries the whole funnel without any document involvement", async () => {
    const { view, interactions } = await harness({
      document: RESULT_DOCUMENT,
      complete: () => MilanoValue.string("ok"),
    });
    view.emit("f", "tap");
    await settled();
    view.teardown();

    const kinds = interactions.map((interaction) => interaction.kind);
    assert.deepEqual(kinds, [
      "viewBuilt",
      "event",
      "actionDispatched",
      "completionSucceeded",
      "viewTornDown",
    ]);

    const dispatchedRecord = interactions.find((i) => i.kind === "actionDispatched");
    assert.equal(dispatchedRecord?.name, "submit");
    assert.equal(dispatchedRecord?.node, "f", "the dispatch is anchored to the node that caused it");
    assert.equal(
      dispatchedRecord?.value?.recordValue?.["value"]?.stringValue,
      "payload",
      "the captured parameters travel with the record",
    );
  });

  it("records a failed completion as such", async () => {
    const { view, interactions } = await harness({
      document: RESULT_DOCUMENT,
      complete: () => Promise.reject(new Error("no")),
    });
    view.emit("f", "tap");
    await settled();
    assert.ok(interactions.some((interaction) => interaction.kind === "completionFailed"));
    view.teardown();
  });

  it("records an emission that no binding consumes", async () => {
    const document = JSON.stringify({
      version: "1.0.0",
      root: { type: "Field", id: "f", properties: { value: "x" } },
    });
    const { view, interactions, occurrences } = await harness({ document });
    view.emit("f", "change", MilanoValue.string("typed"));
    // Analytics sees it; observability calls it a dropped event. The two
    // streams disagree on purpose.
    assert.ok(interactions.some((i) => i.kind === "event" && i.name === "change"));
    assert.ok(occurrences.some((o) => o.kind === "droppedEvent"));
    view.teardown();
  });

  it("carries the document's metadata on the impression", async () => {
    const document = JSON.stringify({
      version: "1.0.0",
      metadata: { campaign: "spring" },
      root: { type: "Field", id: "f", properties: { value: "x" } },
    });
    const { view, interactions } = await harness({ document });
    const built = interactions.find((interaction) => interaction.kind === "viewBuilt");
    assert.equal(built?.value?.recordValue?.["campaign"]?.stringValue, "spring");
    view.teardown();
  });

  it("is inert when no observer was given", async () => {
    const registry = new MilanoRegistry<string>();
    registry.register("Field", "field");
    const engine = new MilanoEngine<string>({ vocabularyJson: VOCABULARY, registry });
    const view = await engine
      .viewBuilder(
        JSON.stringify({
          version: "1.0.0",
          root: { type: "Field", id: "f", properties: { value: "x" } },
        }),
      )
      .build();
    // Nothing to assert but the absence of a crash: the runtime must not
    // assume an observer exists.
    view.userInteraction("tap", "f");
    view.emit("f", "tap");
    view.teardown();
  });
});

describe("the quick path", () => {
  const QUICK_VOCABULARY = JSON.stringify({
    milano: "1.0.0",
    name: "quick",
    version: "1.0.0",
    components: { Greeting: { properties: { text: "string" }, events: { tap: null } } },
    actions: { celebrate: {} },
  });

  const QUICK_DOCUMENT = JSON.stringify({
    version: "1.0.0",
    context: { who: "string" },
    state: { taps: "int", note: "string", ratio: "double", on: "bool" },
    root: {
      type: "Greeting",
      id: "hello",
      properties: { text: { $expr: "concat('Hi, ', context.who, ' ', str(state.taps))" } },
      on: { tap: [{ action: "$set", key: "taps", value: { $expr: "state.taps + 1" } }] },
    },
  });

  it("synthesizes every declared state key as its zero value", async () => {
    const builder = quickBuilder<string>({
      document: QUICK_DOCUMENT,
      vocabulary: QUICK_VOCABULARY,
      renderers: { Greeting: "greeting" },
      context: { who: MilanoValue.string("Ada") },
    });
    const view = await builder.build();
    assert.equal(view.state["taps"]?.intValue, 0n);
    assert.equal(view.state["note"]?.stringValue, "");
    assert.equal(view.state["ratio"]?.doubleValue, 0);
    assert.equal(view.state["on"]?.boolValue, false);
    assert.equal(view.resolvedRoot.values["text"]?.stringValue, "Hi, Ada 0");
    view.teardown();
  });

  it("lets supplied values override the synthesis", async () => {
    const view = await quickBuilder<string>({
      document: QUICK_DOCUMENT,
      vocabulary: QUICK_VOCABULARY,
      renderers: { Greeting: "greeting" },
      context: { who: MilanoValue.string("Ada") },
      state: { taps: MilanoValue.int(41n) },
    }).build();
    assert.equal(view.state["taps"]?.intValue, 41n);
    assert.equal(view.state["note"]?.stringValue, "", "unsupplied keys are still synthesized");
    view.teardown();
  });

  it("surfaces an invalid vocabulary at construction, not at build", () => {
    assert.throws(() =>
      quickBuilder<string>({
        document: QUICK_DOCUMENT,
        vocabulary: "{ not a vocabulary",
        renderers: { Greeting: "greeting" },
      }),
    );
  });

  it("covers every declared kind, including enums and records", () => {
    const zero = synthesizedState({
      flag: MilanoType.bool(),
      count: MilanoType.int(),
      ratio: MilanoType.double(),
      label: MilanoType.string(),
      tone: MilanoType.enumeration(["warm", "cool"]),
      tags: MilanoType.array(MilanoType.string()),
      shape: MilanoType.record({ id: MilanoType.string() }),
      maybe: MilanoType.string(true),
    });
    assert.equal(zero["flag"]?.boolValue, false);
    assert.equal(zero["count"]?.intValue, 0n);
    assert.equal(zero["ratio"]?.doubleValue, 0);
    assert.equal(zero["label"]?.stringValue, "");
    // The alphabetically first member is always a legal member.
    assert.equal(zero["tone"]?.stringValue, "cool");
    assert.deepEqual(zero["tags"]?.arrayValue, []);
    assert.equal(zero["shape"]?.recordValue?.["id"]?.stringValue, "");
    assert.ok(zero["maybe"]?.isNull, "an optional synthesizes to null");
  });
});
