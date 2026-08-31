import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoBuildError } from "../src/document/errors.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import { MilanoActionFailure } from "../src/runtime/handlers.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import type { MilanoUserInteraction } from "../src/engine/interaction.ts";
import { quickBuilder, synthesizedState } from "../src/runtime/quick-start.ts";
import { MilanoType } from "../src/core/type.ts";
import { zeroValueOf } from "../src/expression/evaluator.ts";
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

const FAILURE_VOCABULARY = JSON.stringify({
  milano: "2.1.0",
  name: "failures",
  version: "1.0.0",
  components: {
    Field: { properties: { value: "string" }, events: { tap: null } },
  },
  actions: {
    submit: { failure: { enum: ["limit", "offline"] } },
    lenient: { failure: "string?" },
    plain: {},
  },
});

function failureDocument(action: string): string {
  return JSON.stringify({
    version: "2.1.0",
    state: { outcome: "string" },
    root: {
      type: "Field",
      id: "f",
      properties: { value: { $expr: "state.outcome" } },
      on: {
        tap: [
          {
            action,
            onSuccess: [{ action: "$set", key: "outcome", value: "ok" }],
            onFailure: [
              {
                action: "$set",
                key: "outcome",
                value:
                  action === "plain"
                    ? "failed"
                    : action === "lenient"
                      ? { $expr: "$concat('failed: ', failure ?? 'unknown')" }
                      : { $expr: "$concat('failed: ', failure)" },
              },
            ],
          },
        ],
      },
    },
    on: { appear: [{ action: "$set", key: "outcome", value: "appeared" }] },
  });
}

async function failureHarness(
  action: string,
  handler: () => Promise<MilanoValue | null>,
): Promise<Harness> {
  const registry = new MilanoRegistry<string>();
  registry.register("Field", "field");
  const occurrences: MilanoOccurrence[] = [];
  const interactions: MilanoUserInteraction[] = [];
  const dispatched: string[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson: FAILURE_VOCABULARY,
    registry,
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
    userInteractionObserver: { interaction: (interaction) => interactions.push(interaction) },
  });
  const view = await engine
    .viewBuilder(failureDocument(action))
    .label("failures")
    .stateData((declarations) => synthesizedState(declarations))
    .actionHandler((dispatchedAction) => {
      dispatched.push(dispatchedAction.dispatchId);
      return handler();
    })
    .build();
  return { view, occurrences, interactions, dispatched };
}

describe("typed failure payloads", () => {
  it("binds a MilanoActionFailure's value to the failure root inside onFailure", async () => {
    const { view, interactions } = await failureHarness("submit", () =>
      Promise.reject(new MilanoActionFailure(MilanoValue.string("limit"))),
    );
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "failed: limit");
    const completion = interactions.find((record) => record.kind === "completionFailed");
    assert.equal(completion?.value?.stringValue, "limit");
    assert.equal(completion?.dispatch, 0);
    view.teardown();
  });

  it("treats a plain error as a failure with no payload: invalid against a non-optional declaration", async () => {
    const { view, occurrences } = await failureHarness("submit", () =>
      Promise.reject(new Error("network")),
    );
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "");
    assert.deepEqual(
      occurrences.map((occurrence) => [occurrence.kind, occurrence.expected, occurrence.found]),
      [["invalidCompletion", "enum", "null"]],
    );
    view.teardown();
  });

  it("lets a plain error run onFailure when the declaration is optional", async () => {
    const { view } = await failureHarness("lenient", () => Promise.reject(new Error("network")));
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "failed: unknown");
    view.teardown();
  });

  it("refuses a payload outside the declared enum", async () => {
    const { view, occurrences } = await failureHarness("submit", () =>
      Promise.reject(new MilanoActionFailure(MilanoValue.string("teapot"))),
    );
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "");
    assert.equal(occurrences[0]?.kind, "invalidCompletion");
    view.teardown();
  });

  it("keeps the 2.0 rule for an action declaring no failure type", async () => {
    const { view, occurrences } = await failureHarness("plain", () =>
      Promise.reject(new MilanoActionFailure(MilanoValue.string("x"))),
    );
    view.emit("f", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "");
    assert.equal(occurrences[0]?.expected, "no payload");
    view.teardown();
  });

  it("delivers the dispatch identity with the action", async () => {
    const { view, dispatched } = await failureHarness("plain", async () => null);
    view.emit("f", "tap");
    view.emit("f", "tap");
    await settled();
    assert.equal(dispatched.length, 2);
    assert.notEqual(dispatched[0], dispatched[1]);
    assert.deepEqual(view.dispatched.map((action) => action.dispatch), [0, 1]);
    view.teardown();
  });
});

describe("lifecycle signals", () => {
  it("runs the appear bindings once per acceptance and records the signals", async () => {
    const { view, interactions } = await failureHarness("plain", async () => null);
    view.appear();
    view.appear();
    assert.equal(view.state["outcome"]?.stringValue, "appeared");
    view.disappear();
    view.disappear();
    view.appear();
    assert.deepEqual(
      interactions.map((record) => record.kind),
      ["viewBuilt", "viewAppeared", "viewDisappeared", "viewAppeared"],
    );
    view.teardown();
  });

  it("ignores signals after teardown", async () => {
    const { view, interactions } = await failureHarness("plain", async () => null);
    view.teardown();
    view.appear();
    assert.deepEqual(
      interactions.map((record) => record.kind),
      ["viewBuilt", "viewTornDown"],
    );
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

describe("host functions", () => {
  const vocabulary = JSON.stringify({
    milano: "2.1.0",
    name: "functions",
    version: "1.0.0",
    components: { Field: { properties: { value: "string" }, events: { tap: null } } },
    functions: { formatMoney: { arguments: ["int", "string"], returns: "string" } },
  });
  const document = JSON.stringify({
    version: "2.1.0",
    state: { cents: "int", label: "string" },
    root: {
      type: "Field",
      id: "f",
      properties: { value: { $expr: "formatMoney(state.cents, 'EUR')" } },
      on: { tap: [{ action: "$set", key: "label", value: { $expr: "twice(state.label)" } }] },
    },
  });

  async function build(handler: ((call: { name: string; arguments: readonly MilanoValue[] }) => MilanoValue | null) | null) {
    const registry = new MilanoRegistry<string>();
    registry.register("Field", "field");
    const occurrences: MilanoOccurrence[] = [];
    const engine = new MilanoEngine<string>({
      vocabularyJson: vocabulary,
      registry,
      observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
      functionHandler: handler,
    });
    const view = await engine
      .viewBuilder(document)
      .function("twice", { arguments: [MilanoType.string()], returns: MilanoType.string() })
      .stateData(() => ({ cents: MilanoValue.int(1250n), label: MilanoValue.string("ab") }))
      .build();
    return { view, occurrences };
  }

  it("answers calls through the engine's handler, in properties and in actions", async () => {
    const calls: string[] = [];
    const { view, occurrences } = await build((call) => {
      calls.push(`${call.name}(${call.arguments.map(String).join(", ")})`);
      if (call.name === "formatMoney") return MilanoValue.string("12.50 EUR");
      return MilanoValue.string(`${call.arguments[0]?.stringValue}${call.arguments[0]?.stringValue}`);
    });
    assert.equal(view.resolvedRoot.values["value"]?.stringValue, "12.50 EUR");
    view.emit("f", "tap");
    assert.equal(view.state["label"]?.stringValue, "abab");
    assert.deepEqual(calls, ["formatMoney(1250, EUR)", "twice(ab)"]);
    assert.deepEqual(occurrences, []);
  });

  it("reports an invalid result and substitutes the zero value", async () => {
    const { view, occurrences } = await build((call) => {
      if (call.name === "formatMoney") return MilanoValue.int(1n);
      throw new Error("no twice today");
    });
    assert.equal(view.resolvedRoot.values["value"]?.stringValue, "");
    view.emit("f", "tap");
    assert.equal(view.state["label"]?.stringValue, "");
    assert.deepEqual(
      occurrences.map((occurrence) => [occurrence.kind, occurrence.node, occurrence.name, occurrence.expected, occurrence.found]),
      [
        ["invalidFunctionResult", "f", "formatMoney", "string", "int"],
        ["invalidFunctionResult", null, "twice", "string", "error"],
      ],
    );
  });

  it("refuses to build a document calling functions on an engine without a handler", async () => {
    await assert.rejects(build(null), (error: unknown) => {
      assert.ok(error instanceof MilanoBuildError);
      assert.equal(error.rule, "function-handler");
      assert.equal(error.expected, "function handler");
      return true;
    });
  });
});

describe("document replacement", () => {
  const counter = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      version: "2.1.0",
      state: { n: "int" },
      root: {
        type: "Field",
        id: "f",
        properties: { value: { $expr: "$str(state.n)" } },
        on: { tap: [{ action: "$set", key: "n", value: { $expr: "state.n + 1" } }] },
      },
      ...extra,
    });

  it("keeps state whose declaration is unchanged and asks the provider for the rest", async () => {
    const asked: string[][] = [];
    const { view, interactions } = await harness({ document: counter() });
    view.emit("f", "tap");
    const registry = new MilanoRegistry<string>();
    registry.register("Field", "field");
    const engine = new MilanoEngine<string>({ vocabularyJson: VOCABULARY, registry });
    const fresh = await engine
      .viewBuilder(counter())
      .stateData((declarations) => {
        asked.push(Object.keys(declarations));
        return synthesizedState(declarations, { extra: MilanoValue.string("!") });
      })
      .build();
    fresh.emit("f", "tap");
    fresh.emit("f", "tap");
    await fresh.replace(
      JSON.stringify({
        version: "2.1.0",
        state: { n: "int", extra: "string" },
        metadata: { swapped: true },
        root: { type: "Field", id: "g", properties: { value: { $expr: "$concat($str(state.n), state.extra)" } } },
      }),
    );
    assert.equal(fresh.resolvedRoot.values["value"]?.stringValue, "2!");
    assert.deepEqual(asked, [["n"], ["extra"]]);
    assert.equal(fresh.metadata?.recordValue?.["swapped"]?.boolValue, true);
    // The first harness view is untouched by any of this.
    assert.equal(view.resolvedRoot.values["value"]?.stringValue, "1");
    assert.equal(interactions.filter((interaction) => interaction.kind === "viewReplaced").length, 0);
  });

  it("leaves the view untouched when the replacement fails the gate", async () => {
    const { view, occurrences } = await harness({ document: counter() });
    const before = view.resolvedRoot;
    await assert.rejects(view.replace('{"version": "2.1.0", "root": {"type": "Nope"}}'), (error: unknown) => {
      assert.ok(error instanceof MilanoBuildError);
      assert.equal(error.type, "UnknownComponentType");
      return true;
    });
    assert.equal(view.resolvedRoot, before);
    assert.deepEqual(occurrences, []);
    view.emit("f", "tap");
    assert.equal(view.resolvedRoot.values["value"]?.stringValue, "1");
  });

  it("is ignored after teardown", async () => {
    const { view, interactions } = await harness({ document: counter() });
    view.teardown();
    await view.replace(counter({ metadata: { late: true } }));
    assert.deepEqual(interactions.map((interaction) => interaction.kind), ["viewBuilt", "viewTornDown"]);
    assert.equal(view.metadata, null);
  });
});

describe("watch bindings", () => {
  it("runs a key's list on every change, through the real dispatcher, never from a watch", async () => {
    const { view, dispatched } = await harness({
      document: JSON.stringify({
        version: "2.1.0",
        state: { a: "int", b: "int", c: "int" },
        root: {
          type: "Field",
          id: "f",
          properties: { value: { $expr: "$str(state.c)" } },
          on: { tap: [{ action: "$set", key: "a", value: { $expr: "state.a + 1" } }] },
        },
        watch: {
          a: [{ action: "$set", key: "b", value: { $expr: "state.a * 10" } }, { action: "plain" }],
          b: [{ action: "$set", key: "c", value: 99 }],
        },
      }),
    });
    view.emit("f", "tap");
    view.emit("f", "tap");
    assert.equal(view.state["a"]?.intValue, 2n);
    assert.equal(view.state["b"]?.intValue, 20n);
    assert.equal(view.state["c"]?.intValue, 0n);
    assert.deepEqual(dispatched, ["plain", "plain"]);
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
      properties: { text: { $expr: "$concat('Hi, ', context.who, ' ', $str(state.taps))" } },
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
    // The contract's zero for an enum is its FIRST DECLARED member, and
    // synthesis uses the same rule: the two once disagreed, synthesis
    // taking the alphabetically first, so a preview could differ from the
    // engine over one declaration. `cool` here would be the old answer.
    assert.equal(zero["tone"]?.stringValue, "warm");
    assert.equal(
      zero["tone"]?.stringValue,
      zeroValueOf(MilanoType.enumeration(["warm", "cool"])).stringValue,
      "synthesis and the contract's zero must not drift apart",
    );
    assert.deepEqual(zero["tags"]?.arrayValue, []);
    assert.equal(zero["shape"]?.recordValue?.["id"]?.stringValue, "");
    assert.ok(zero["maybe"]?.isNull, "an optional synthesizes to null");
  });
});
