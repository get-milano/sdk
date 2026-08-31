import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MilanoValue } from "../src/core/value.ts";
import { MilanoBuildError } from "../src/document/errors.ts";
import { defaultLimits } from "../src/engine/configuration.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoUserInteraction } from "../src/engine/interaction.ts";

/**
 * Statements from the specs' engine-pinned registry
 * (conformance/engine-pinned.json): normative, but not expressible as a
 * vector, so each engine pins them by a test naming the id. The SDK's
 * consistency check asserts the ids appear here.
 */

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "pinned",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: { work: {} },
});

function engine(interactions: MilanoUserInteraction[] = []): MilanoEngine<string> {
  const registry = new MilanoRegistry<string>();
  registry.register("Column", "column");
  registry.register("Text", "text");
  return new MilanoEngine<string>({
    vocabularyJson: VOCABULARY,
    registry,
    userInteractionObserver: { interaction: (interaction) => interactions.push(interaction) },
  });
}

describe("engine-pinned statements", () => {
  // engine-pinned: teardown-during-action-list
  it("runs an action list to completion when teardown lands mid-list", async () => {
    const interactions: MilanoUserInteraction[] = [];
    const view = await engine(interactions)
      .viewBuilder(
        JSON.stringify({
          version: "1.0.0",
          state: { a: "int" },
          root: {
            type: "Text",
            id: "t",
            properties: { text: { $expr: "$str(state.a)" } },
            on: {
              tap: [
                { action: "$set", key: "a", value: 1 },
                { action: "work" },
                { action: "$set", key: "a", value: 42 },
              ],
            },
          },
        }),
      )
      .stateData(() => ({ a: MilanoValue.int(0n) }))
      .actionHandler(async () => null)
      .build();

    // The first $set re-resolves and notifies, which tears the view down.
    // The rest of the list still runs: the custom action dispatches (its
    // analytics record is the synchronous evidence) and the trailing $set
    // applies.
    view.subscribe(() => view.teardown());
    view.emit("t", "tap");
    assert.equal(view.state["a"]?.intValue, 42n);
    assert.deepEqual(
      interactions.map((record) => record.kind),
      ["viewBuilt", "event", "viewTornDown", "actionDispatched"],
    );
  });

  // engine-pinned: dispatch-id-unique-across-views
  it("mints dispatch ids no two dispatches share, across views with the same label", async () => {
    const document = JSON.stringify({
      version: "1.0.0",
      root: { type: "Text", id: "t", properties: { text: "x" }, on: { tap: [{ action: "work" }] } },
    });
    const ids = new Set<string>();
    let deliveries = 0;
    for (let round = 0; round < 3; round += 1) {
      const view = await engine()
        .viewBuilder(document)
        .label("shared-label")
        .actionHandler(async (action) => {
          ids.add(action.dispatchId);
          deliveries += 1;
          return null;
        })
        .build();
      view.emit("t", "tap");
      view.emit("t", "tap");
      // Two views with one label share an identity and a dispatch number
      // sequence; the id still tells every dispatch apart.
      assert.deepEqual(view.dispatched.map((action) => action.dispatch), [0, 1]);
      assert.equal(view.dispatched[0]?.viewIdentity, "shared-label");
      view.teardown();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deliveries, 6);
    assert.equal(ids.size, 6);
  });

  // engine-pinned: replace-provider-failure-propagates
  it("leaves the view untouched when the provider fails during a replacement", async () => {
    const interactions: MilanoUserInteraction[] = [];
    let calls = 0;
    const view = await engine(interactions)
      .viewBuilder(
        JSON.stringify({
          version: "2.1.0",
          state: { a: "int" },
          root: { type: "Text", id: "t", properties: { text: { $expr: "$str(state.a)" } } },
        }),
      )
      .stateData(() => {
        calls += 1;
        if (calls > 1) throw new Error("provider down");
        return { a: MilanoValue.int(7n) };
      })
      .build();
    const before = view.resolvedRoot;
    await assert.rejects(
      view.replace(
        JSON.stringify({
          version: "2.1.0",
          state: { a: "int", b: "string" },
          root: { type: "Text", id: "u", properties: { text: { $expr: "state.b" } } },
        }),
      ),
      /provider down/,
    );
    assert.equal(view.resolvedRoot, before);
    assert.equal(view.state["a"]?.intValue, 7n);
    assert.deepEqual(interactions.map((interaction) => interaction.kind), ["viewBuilt"]);
    // Still serviceable: a replacement that carries everything over lands.
    await view.replace(
      JSON.stringify({
        version: "2.1.0",
        state: { a: "int" },
        root: { type: "Text", id: "u", properties: { text: { $expr: "$concat('a', $str(state.a))" } } },
      }),
    );
    assert.equal(view.resolvedRoot.values["text"]?.stringValue, "a7");
    assert.equal(calls, 2);
  });

  // engine-pinned: default-limits-node-count-and-document-size
  it("holds the default node count and document size at their exact boundaries", async () => {
    assert.equal(defaultLimits.maxNodeCount, 10_000);
    assert.equal(defaultLimits.maxDocumentBytes, 1_048_576);

    const wide = (nodes: number): string =>
      `{"version": "1.0.0", "root": {"type": "Column", "children": [${Array.from(
        { length: nodes - 1 },
        () => `{"type": "Text", "properties": {"text": "x"}}`,
      ).join(",")}]}}`;
    const buildError = async (document: string): Promise<MilanoBuildError | null> => {
      try {
        (await engine().viewBuilder(document).build()).teardown();
        return null;
      } catch (error) {
        if (error instanceof MilanoBuildError) return error;
        throw error;
      }
    };

    assert.equal(await buildError(wide(10_000)), null);
    const overNodes = await buildError(wide(10_001));
    assert.equal(overNodes?.limit, "maxNodeCount");
    assert.equal(overNodes?.actual, 10_001);

    // Insignificant whitespace pads a small document to the byte boundary;
    // the size check runs on raw bytes, before parsing.
    const core = `{"version": "1.0.0", "root": {"type": "Text", "properties": {"text": "x"}}}`;
    const padded = core + " ".repeat(1_048_576 - core.length);
    assert.equal(await buildError(padded), null);
    const overBytes = await buildError(`${padded} `);
    assert.equal(overBytes?.limit, "maxDocumentBytes");
    assert.equal(overBytes?.actual, 1_048_577);
  });
});
