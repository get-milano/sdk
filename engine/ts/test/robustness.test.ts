import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoBuildError } from "../src/document/errors.ts";
import { defaultLimits } from "../src/engine/configuration.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import { MilanoContextHandle } from "../src/runtime/context-source.ts";
import type { MilanoDispatcher } from "../src/runtime/dispatcher.ts";
import type { MilanoActionHandler } from "../src/runtime/handlers.ts";
import type { MilanoView } from "../src/runtime/view.ts";

/**
 * What a host and a document can do to a view that the conformance
 * vectors cannot express: a replacement stranded behind a throwing
 * listener, a failure thrown by the other build of the package, and the
 * limits and keyed-repeat invariants on the replacement and context paths.
 */

const VOCABULARY = JSON.stringify({
  milano: "2.1.0",
  name: "robustness",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: { save: { failure: "string" } },
});

interface Built {
  readonly view: MilanoView;
  readonly occurrences: MilanoOccurrence[];
}

async function build(
  document: object,
  options: {
    readonly state?: Record<string, MilanoValue>;
    readonly maxNodeCount?: number;
    readonly dispatcher?: MilanoDispatcher;
    readonly context?: MilanoContextHandle;
    readonly handler?: MilanoActionHandler;
  } = {},
): Promise<Built> {
  const registry = new MilanoRegistry<string>();
  registry.register("Column", "column");
  registry.register("Text", "text");
  const occurrences: MilanoOccurrence[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    limits: { ...defaultLimits, maxNodeCount: options.maxNodeCount ?? defaultLimits.maxNodeCount },
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
  });
  const builder = engine.viewBuilder(JSON.stringify(document)).stateData(() => options.state ?? {});
  if (options.dispatcher !== undefined) builder.dispatcher(options.dispatcher);
  if (options.context !== undefined) builder.contextSource(options.context);
  if (options.handler !== undefined) builder.actionHandler(options.handler);
  return { view: await builder.build(), occurrences };
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function row(id: string): MilanoValue {
  return MilanoValue.record({ id: MilanoValue.string(id) });
}

function counter(extra: Record<string, unknown> = {}): object {
  return {
    version: "2.1.0",
    ...extra,
    state: { count: "int" },
    root: {
      type: "Text",
      id: "n",
      properties: { text: { $expr: "$str(state.count)" } },
      on: { tap: [{ action: "$set", key: "count", value: { $expr: "state.count + 1" } }] },
    },
  };
}

const ROWS_TYPE = { array: { record: { id: "string" } } };

/** A list of one Text per row, the key optional, `perRow` Texts each. */
function list(options: { readonly keyed?: boolean; readonly perRow?: number; readonly source?: string } = {}): object {
  const children = Array.from({ length: options.perRow ?? 1 }, (_, index) => ({
    type: "Text",
    id: `item${index}`,
    properties: { text: { $expr: "row.id" } },
    on: { tap: [{ action: "$set", key: "selected", value: { $expr: "row.id" } }] },
  }));
  const source = options.source ?? "state";
  return {
    version: "2.1.0",
    state: { rows: ROWS_TYPE, selected: "string" },
    ...(source === "context" ? { context: { rows: ROWS_TYPE } } : {}),
    root: {
      type: "Column",
      id: "list",
      children: [
        {
          type: "$repeat",
          id: "each",
          items: { $expr: `${source}.rows` },
          as: "row",
          ...(options.keyed === true ? { key: { $expr: "row.id" } } : {}),
          children,
        },
        {
          type: "Text",
          id: "reverse",
          properties: { text: "reverse" },
          on: { tap: [{ action: "$set", key: "rows", value: [{ id: "c" }, { id: "b" }, { id: "a" }] }] },
        },
      ],
    },
  };
}

describe("a replacement behind a throwing listener", () => {
  it("rejects instead of waiting on a swap the cleared queue dropped", async () => {
    const held: (() => void)[] = [];
    let holding = false;
    const dispatcher: MilanoDispatcher = {
      dispatch: (work) => {
        if (holding) held.push(work);
        else work();
      },
    };
    const { view } = await build(counter(), { state: { count: MilanoValue.int(0n) }, dispatcher });

    // The replacement's swap waits on the dispatcher; the listener releases
    // it while the view is mid-drain, so it queues behind the emission,
    // then throws and clears the queue.
    holding = true;
    const replacing = view.replace(JSON.stringify(counter({ metadata: { swapped: true } })));
    await settled();
    assert.equal(held.length, 1);
    holding = false;
    view.subscribe(() => {
      for (const work of held.splice(0)) work();
      throw new Error("host bug");
    });

    assert.throws(() => view.emit("n", "tap"), /host bug/);
    await assert.rejects(replacing, /work queue was cleared/);
    // The view is exactly as it was: the emission landed, the swap did not.
    assert.equal(view.state["count"]?.intValue, 1n);
    assert.equal(view.metadata, null);
    view.teardown();
  });
});

describe("a failure from the other build of the package", () => {
  it("binds the payload of a failure recognized by its brand, not its class", async () => {
    // What the CJS build's MilanoActionFailure looks like to the ESM view:
    // a different class carrying the same brand.
    const brand = Symbol.for("milano.actionFailure");
    class ForeignFailure extends Error {
      readonly value = MilanoValue.string("denied");
      constructor() {
        super("denied");
        Object.defineProperty(this, brand, { value: true });
      }
    }
    const { view } = await build(
      {
        version: "2.1.0",
        state: { outcome: "string" },
        root: {
          type: "Text",
          id: "t",
          properties: { text: { $expr: "state.outcome" } },
          on: {
            tap: [
              {
                action: "save",
                onFailure: [{ action: "$set", key: "outcome", value: { $expr: "$concat('failed: ', failure)" } }],
              },
            ],
          },
        },
      },
      { state: { outcome: MilanoValue.string("") }, handler: () => Promise.reject(new ForeignFailure()) },
    );
    view.emit("t", "tap");
    await settled();
    assert.equal(view.state["outcome"]?.stringValue, "failed: denied");
    view.teardown();
  });

  it("does not mistake a lookalike without the brand for a failure", async () => {
    const { view, occurrences } = await build(
      {
        version: "2.1.0",
        state: { outcome: "string" },
        root: { type: "Text", id: "t", properties: { text: "x" }, on: { tap: [{ action: "save" }] } },
      },
      {
        state: { outcome: MilanoValue.string("") },
        handler: () => Promise.reject({ value: MilanoValue.string("denied") }),
      },
    );
    view.emit("t", "tap");
    await settled();
    assert.deepEqual(occurrences.map((o) => [o.kind, o.found]), [["invalidCompletion", "null"]]);
    view.teardown();
  });
});

describe("the view's seams", () => {
  it("exposes its parsed document", async () => {
    const { view } = await build(counter(), { state: { count: MilanoValue.int(0n) } });
    assert.deepEqual(Object.keys(view.document.stateDeclarations), ["count"]);
    view.teardown();
  });

  it("cancels a context subscription offered after teardown", async () => {
    const { view } = await build(counter(), { state: { count: MilanoValue.int(0n) } });
    view.teardown();
    let cancelled = 0;
    view.attachContextSubscription(() => {
      cancelled += 1;
    });
    assert.equal(cancelled, 1);
  });

  it("keeps the first context subscription and cancels a second", async () => {
    const { view } = await build(counter(), { state: { count: MilanoValue.int(0n) } });
    const cancelled: string[] = [];
    view.attachContextSubscription(() => cancelled.push("first"));
    view.attachContextSubscription(() => cancelled.push("second"));
    assert.deepEqual(cancelled, ["second"]);
    view.teardown();
    assert.deepEqual(cancelled, ["second", "first"]);
  });
});

describe("replacing from bytes", () => {
  it("decodes UTF-8 and applies the replacement", async () => {
    const { view } = await build(counter(), { state: { count: MilanoValue.int(0n) } });
    await view.replace(new TextEncoder().encode(JSON.stringify(counter({ metadata: { bytes: true } }))));
    assert.equal(view.metadata?.recordValue?.["bytes"]?.boolValue, true);
    view.teardown();
  });

  it("says so when the platform has no TextDecoder", async () => {
    const { view } = await build(counter(), { state: { count: MilanoValue.int(0n) } });
    const platform = globalThis as unknown as { TextDecoder: unknown };
    const saved = platform.TextDecoder;
    platform.TextDecoder = undefined;
    try {
      await assert.rejects(view.replace(new Uint8Array(1)), /TextDecoder is required/);
    } finally {
      platform.TextDecoder = saved;
    }
    view.teardown();
  });
});

describe("a replacement the carried state cannot satisfy", () => {
  it("refuses a keyed repeat over carried state that repeats a key, leaving the view as it was", async () => {
    const { view } = await build(list(), {
      state: { rows: MilanoValue.array([row("a"), row("a")]), selected: MilanoValue.string("") },
    });
    const before = view.resolvedRoot;
    await assert.rejects(
      view.replace(JSON.stringify(list({ keyed: true }))),
      (error: unknown) =>
        error instanceof MilanoBuildError && error.type === "SchemaViolation" && error.found === "a",
    );
    assert.strictEqual(view.resolvedRoot, before);
    view.teardown();
  });

  it("refuses a tree past the node count limit", async () => {
    const { view } = await build(list(), {
      state: { rows: MilanoValue.array([row("a"), row("b"), row("c")]), selected: MilanoValue.string("") },
      maxNodeCount: 6,
    });
    const before = view.resolvedRoot;
    await assert.rejects(
      view.replace(JSON.stringify(list({ perRow: 2 }))),
      (error: unknown) => error instanceof MilanoBuildError && error.type === "LimitExceeded" && error.limit === "maxNodeCount",
    );
    assert.strictEqual(view.resolvedRoot, before);
    view.teardown();
  });
});

describe("a context update against the tree it would produce", () => {
  it("rejects an update past the node count limit and keeps the previous tree", async () => {
    const handle = new MilanoContextHandle({ rows: MilanoValue.array([row("a"), row("b")]) });
    const { view, occurrences } = await build(list({ source: "context" }), {
      state: { rows: MilanoValue.array([]), selected: MilanoValue.string("") },
      context: handle,
      maxNodeCount: 5,
    });
    const before = view.resolvedRoot;
    handle.update({ rows: MilanoValue.array([row("a"), row("b"), row("c"), row("d")]) });
    assert.strictEqual(view.resolvedRoot, before);
    assert.deepEqual(
      occurrences.map((o) => [o.kind, o.name, o.expected, o.found]),
      [["rejectedContextUpdate", "rows", "maxNodeCount", "6"]],
    );
    view.teardown();
  });

  it("rejects an update that would render one key twice", async () => {
    const handle = new MilanoContextHandle({ rows: MilanoValue.array([row("a"), row("b")]) });
    const { view, occurrences } = await build(list({ source: "context", keyed: true }), {
      state: { rows: MilanoValue.array([]), selected: MilanoValue.string("") },
      context: handle,
    });
    const before = view.resolvedRoot;
    handle.update({ rows: MilanoValue.array([row("a"), row("a")]) });
    assert.strictEqual(view.resolvedRoot, before);
    assert.deepEqual(
      occurrences.map((o) => [o.kind, o.expected, o.found]),
      [["rejectedContextUpdate", "distinct key", "a"]],
    );
    view.teardown();
  });
});

describe("a keyed instance's emission", () => {
  const state = {
    rows: MilanoValue.array([row("a"), row("b"), row("c")]),
    selected: MilanoValue.string(""),
  };

  it("binds the element its key names after the list was reordered", async () => {
    const { view } = await build(list({ keyed: true }), { state });
    view.emit("reverse", "tap");
    assert.deepEqual(
      view.resolvedRoot.children.map((child) => child.reference),
      ["item0[c]", "item0[b]", "item0[a]", "reverse"],
    );
    view.emit("item0[a]", "tap");
    assert.equal(view.state["selected"]?.stringValue, "a");
    view.teardown();
  });

  it("reports an emission from a key the list no longer holds", async () => {
    const { view, occurrences } = await build(list({ keyed: true }), { state });
    view.emit("item0[zzz]", "tap");
    assert.deepEqual(
      occurrences.map((o) => [o.kind, o.expected, o.found]),
      [["invalidEmission", "repeat element", "key zzz"]],
    );
    assert.equal(view.state["selected"]?.stringValue, "");
    view.teardown();
  });
});
