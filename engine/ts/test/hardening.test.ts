import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import { MilanoBuildError } from "../src/document/errors.ts";
import { MilanoJsonError, parseJson } from "../src/core/json.ts";
import { MilanoType } from "../src/core/type.ts";
import { MilanoValue } from "../src/core/value.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * Robustness the conformance vectors cannot express, because it is about
 * JavaScript rather than about the contract: names that live on
 * `Object.prototype` are valid Milano identifiers, host code can reach
 * anything a getter hands it, and a throwing listener is a host bug the
 * engine has to survive.
 *
 * Every test here fails without its fix, with a `TypeError` or a wrong
 * answer rather than the typed error the contract promises.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "hardening",
  version: "1.0.0",
  components: {
    box: {
      properties: { label: "string?" },
      events: { tap: null },
      children: true,
    },
  },
  actions: { save: { parameters: { text: "string?" } } },
});

function engineWith(occurrences: MilanoOccurrence[] = []): MilanoEngine {
  const registry = new MilanoRegistry();
  registry.register("box", () => null);
  return new MilanoEngine({
    vocabularyJson: VOCABULARY,
    registry,
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
  });
}

function document(root: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: "1.0.0", ...extra, root });
}

async function buildFails(text: string): Promise<MilanoBuildError> {
  try {
    await engineWith().viewBuilder(text).actionHandler(() => null).build();
  } catch (error) {
    assert.ok(error instanceof MilanoBuildError, `expected a typed error, got ${error}`);
    return error;
  }
  throw new Error("expected the build to fail");
}

describe("names inherited from Object.prototype", () => {
  it("rejects a prototype-named component type as unknown", async () => {
    const error = await buildFails(document({ type: "constructor", id: "n" }));
    assert.equal(error.type, "UnknownComponentType");
    assert.equal(error.unknownType, "constructor");
  });

  it("reports a prototype-named property as undeclared", async () => {
    const occurrences: MilanoOccurrence[] = [];
    const view = await engineWith(occurrences)
      .viewBuilder(document({ type: "box", id: "n", properties: { toString: "x" } }))
      .build();
    assert.deepEqual(
      occurrences.map((occurrence) => occurrence.kind),
      ["undeclaredProperty"],
    );
    view.teardown();
  });

  it("rejects a binding to a prototype-named event", async () => {
    const error = await buildFails(
      document({ type: "box", id: "n", on: { toString: [{ action: "save" }] } }),
    );
    assert.equal(error.rule, "event-binding");
  });

  it("rejects a prototype-named action", async () => {
    const error = await buildFails(
      document({ type: "box", id: "n", on: { tap: [{ action: "constructor" }] } }),
    );
    assert.equal(error.rule, "action-capability");
  });

  it("rejects a $set to a prototype-named state key", async () => {
    const error = await buildFails(
      document(
        { type: "box", id: "n", on: { tap: [{ action: "$set", key: "toString", value: 1 }] } },
        { state: { count: "int" } },
      ),
    );
    assert.equal(error.rule, "action-encoding");
  });

  it("rejects an expression reading a prototype-named state key", async () => {
    const error = await buildFails(
      document(
        { type: "box", id: "n", properties: { label: { $expr: "state.toString" } } },
        { state: { count: "int" } },
      ),
    );
    assert.equal(error.rule, "expression");
  });

  it("drops an emission of a prototype-named event instead of throwing", async () => {
    const occurrences: MilanoOccurrence[] = [];
    const view = await engineWith(occurrences)
      .viewBuilder(document({ type: "box", id: "n" }))
      .build();
    view.emit("n", "toString", MilanoValue.string("x"));
    assert.deepEqual(
      occurrences.map((occurrence) => occurrence.kind),
      ["invalidEmission"],
    );
    view.teardown();
  });

  it("keeps a __proto__ member as data, without repointing the map", () => {
    const parsed = parseJson('{"__proto__": 1, "a": 2}');
    const record = parsed.recordValue;
    assert.ok(record !== null);
    assert.deepEqual(Object.keys(record).sort(), ["__proto__", "a"]);
    assert.equal(record["__proto__"]?.intValue, 1n);
    assert.equal(Object.getPrototypeOf(record), null);
  });

  it("treats a prototype-named record field as undeclared", () => {
    const type = MilanoType.record({ a: MilanoType.int() });
    assert.equal(type.validated(parseJson('{"a":1,"toString":2}')), null);
    assert.ok(type.validated(parseJson('{"a":1}')) !== null);
  });
});

describe("untrusted input bounds", () => {
  it("answers deep nesting with a typed error, not a stack overflow", () => {
    const deep = `${"[".repeat(6000)}1${"]".repeat(6000)}`;
    assert.throws(() => parseJson(deep), MilanoJsonError);
  });

  it("defines int() for non-finite numbers instead of throwing", () => {
    assert.equal(MilanoValue.int(Number.NaN).intValue, 0n);
    assert.equal(MilanoValue.int(Number.POSITIVE_INFINITY).intValue, 9223372036854775807n);
    assert.equal(MilanoValue.int(Number.NEGATIVE_INFINITY).intValue, -9223372036854775808n);
  });
});

describe("what the engine hands out", () => {
  it("freezes array and record payloads", () => {
    const array = MilanoValue.array([MilanoValue.int(1n)]);
    assert.throws(() => (array.arrayValue as MilanoValue[]).push(MilanoValue.int(2n)));
    const record = MilanoValue.record({ a: MilanoValue.int(1n) });
    assert.throws(() => {
      (record.recordValue as Record<string, MilanoValue>)["b"] = MilanoValue.int(2n);
    });
  });

  it("hands out copies of state and context", async () => {
    const view = await engineWith()
      .viewBuilder(
        document(
          { type: "box", id: "n", properties: { label: { $expr: "str(state.count)" } } },
          { state: { count: "int" }, context: { who: "string" } },
        ),
      )
      .context({ who: MilanoValue.string("Ada") })
      .stateData(() => ({ count: MilanoValue.int(1n) }))
      .build();

    (view.state as Record<string, MilanoValue>)["count"] = MilanoValue.int(999n);
    (view.context as Record<string, MilanoValue>)["who"] = MilanoValue.string("Mallory");
    assert.equal(view.state["count"]?.intValue, 1n);
    assert.equal(view.context["who"]?.stringValue, "Ada");
    view.teardown();
  });

  it("freezes the limits it was given", () => {
    const limits = {
      maxTreeDepth: 4,
      maxNodeCount: 10,
      maxDocumentBytes: 1000,
      maxExpressionLength: 100,
    };
    const registry = new MilanoRegistry();
    registry.register("box", () => null);
    const engine = new MilanoEngine({ vocabularyJson: VOCABULARY, registry, limits });
    limits.maxNodeCount = 1_000_000;
    assert.equal(engine.limits.maxNodeCount, 10);
  });

  it("takes a registry snapshot, so later registrations do not change it", () => {
    const registry = new MilanoRegistry();
    registry.register("box", "first");
    const engine = new MilanoEngine({ vocabularyJson: VOCABULARY, registry });
    registry.register("box", "second");
    assert.equal(engine.registry.renderer("box"), "first");
  });
});

describe("a misbehaving host", () => {
  async function counter(): Promise<MilanoView> {
    return engineWith()
      .viewBuilder(
        document(
          {
            type: "box",
            id: "n",
            properties: { label: { $expr: "str(state.count)" } },
            on: { tap: [{ action: "$set", key: "count", value: { $expr: "state.count + 1" } }] },
          },
          { state: { count: "int" } },
        ),
      )
      .stateData(() => ({ count: MilanoValue.int(0n) }))
      .build();
  }

  it("survives a listener that throws", async () => {
    const view = await counter();
    const stop = view.subscribe(() => {
      throw new Error("host bug");
    });

    assert.throws(() => view.emit("n", "tap"), /host bug/);
    assert.equal(view.state["count"]?.intValue, 1n);
    stop();

    // The view is still alive: the queue was not left wedged behind a flag
    // that the throw skipped past.
    const seen: bigint[] = [];
    view.subscribe(() => seen.push(view.state["count"]?.intValue ?? -1n));
    view.emit("n", "tap");
    view.emit("n", "tap");
    assert.deepEqual(seen, [2n, 3n]);
    view.teardown();
  });

  it("releases its listeners at teardown", async () => {
    const view = await counter();
    let notified = 0;
    view.subscribe(() => {
      notified += 1;
    });
    view.emit("n", "tap");
    assert.equal(notified, 1);
    view.teardown();
    view.emit("n", "tap");
    assert.equal(notified, 1);
  });

  it("completes a running action list even when a listener tears down", async () => {
    const dispatched: (string | null)[] = [];
    const registry = new MilanoRegistry();
    registry.register("box", () => null);
    const engine = new MilanoEngine({
      vocabularyJson: VOCABULARY,
      registry,
      // The handler runs asynchronously and its thread is unspecified, so
      // the synchronous evidence that the action was dispatched is the
      // analytics record. Swift and Kotlin pin the same claim the same way.
      userInteractionObserver: {
        interaction: (interaction) => {
          if (interaction.kind === "actionDispatched") dispatched.push(interaction.name);
        },
      },
    });
    const view = await engine
      .viewBuilder(
        document(
          {
            type: "box",
            id: "n",
            properties: { label: { $expr: "str(state.count)" } },
            on: {
              tap: [
                { action: "$set", key: "count", value: 1 },
                { action: "save", text: "after" },
                { action: "$set", key: "count", value: 42 },
              ],
            },
          },
          { state: { count: "int" } },
        ),
      )
      .stateData(() => ({ count: MilanoValue.int(0n) }))
      .actionHandler(() => null)
      .build();

    // The first $set notifies and the listener tears the view down. The
    // list still finishes: action lists are atomic, and teardown is one
    // more update that cannot land in the middle of one. Swift and Kotlin
    // behave the same way, which is the point of pinning it here.
    view.subscribe(() => view.teardown());
    view.emit("n", "tap");
    assert.deepEqual(dispatched, ["save"]);
    assert.equal(view.state["count"]?.intValue, 42n);

    // Torn down all the same: nothing after the list runs.
    view.emit("n", "tap");
    assert.deepEqual(dispatched, ["save"]);
  });
});
