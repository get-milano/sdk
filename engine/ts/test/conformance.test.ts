import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseJson } from "../src/core/json.ts";
import { MilanoType } from "../src/core/type.ts";
import { MilanoValue } from "../src/core/value.ts";
import { MilanoBuildError, MilanoEngineError } from "../src/document/errors.ts";
import type { MilanoUnknownTypePolicy } from "../src/engine/configuration.ts";
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import type { MilanoUserInteraction } from "../src/engine/interaction.ts";
import type { MilanoOccurrence } from "../src/engine/observer.ts";
import type { ResolvedNode } from "../src/gate/resolver.ts";
import { MilanoContextHandle } from "../src/runtime/context-source.ts";
import type { MilanoDispatcher } from "../src/runtime/dispatcher.ts";
import { stringifyMilanoValue } from "./support/json-writer.ts";
import { specsDirectory } from "./support/specs.ts";

type Record_ = Readonly<Record<string, MilanoValue>>;

/** The harness serialization seam: work queues until pumped. */
class PumpDispatcher implements MilanoDispatcher {
  private readonly queue: (() => void)[] = [];

  dispatch(work: () => void): void {
    this.queue.push(work);
  }

  pump(): void {
    while (this.queue.length > 0) (this.queue.shift() as () => void)();
  }
}

/** Completions are scripted by steps, never by the handler. */
const neverCompletingHandler = (): Promise<MilanoValue | null> =>
  new Promise<MilanoValue | null>(() => {});

function snapshot(node: ResolvedNode): MilanoValue {
  const fields: Record<string, MilanoValue> = {
    type: MilanoValue.string(node.type),
    reference: MilanoValue.string(node.reference),
  };
  if (node.isPlaceholder) fields["placeholder"] = MilanoValue.bool(true);
  if (Object.keys(node.values).length > 0) {
    fields["properties"] = MilanoValue.record(node.values);
  }
  if (node.children.length > 0) {
    fields["children"] = MilanoValue.array(node.children.map(snapshot));
  }
  return MilanoValue.record(fields);
}

/** Subset match, per the suite's conventions. */
function matches(produced: Record_, expected: Record_): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const counterpart = produced[key];
    return counterpart !== undefined && counterpart.equals(value);
  });
}

function errorFields(error: unknown): Record<string, MilanoValue> {
  const fields: Record<string, MilanoValue> = {};
  if (error instanceof MilanoBuildError) {
    fields["type"] = MilanoValue.string(error.type);
    if (error.rule !== null) fields["rule"] = MilanoValue.string(error.rule);
    if (error.node !== null) fields["node"] = MilanoValue.string(error.node);
    if (error.expected !== null) fields["expected"] = MilanoValue.string(error.expected);
    if (error.found !== null) fields["found"] = MilanoValue.string(error.found);
    if (error.declared !== null) fields["declared"] = MilanoValue.string(error.declared);
    if (error.unknownType !== null) {
      fields["unknownType"] = MilanoValue.string(error.unknownType);
    }
    if (error.limit !== null) fields["limit"] = MilanoValue.string(error.limit);
    if (error.value !== null) fields["value"] = MilanoValue.int(BigInt(error.value));
    if (error.actual !== null) fields["actual"] = MilanoValue.int(BigInt(error.actual));
    if (error.supported !== null) {
      fields["supported"] = MilanoValue.array(
        error.supported.map((major) => MilanoValue.int(BigInt(major))),
      );
    }
  }
  return fields;
}

const asRecord = (value: MilanoValue | undefined): Record_ | null =>
  value?.recordValue ?? null;

async function runVector(
  name: string,
  vector: Record_,
  vocabularyJson: string,
  vocabularyTypes: readonly string[],
): Promise<void> {
  const registry = new MilanoRegistry<string>();
  for (const type of vocabularyTypes) registry.register(type, `stub:${type}`);
  registry.registerPlaceholder("stub:placeholder");

  const config = asRecord(vector["config"]) ?? {};
  const policy =
    (asRecord(vector["config"])?.["unknownTypePolicy"]?.stringValue as
      | MilanoUnknownTypePolicy
      | undefined) ?? "fail";

  const occurrences: MilanoOccurrence[] = [];
  const interactions: MilanoUserInteraction[] = [];
  const engine = new MilanoEngine<string>({
    vocabularyJson,
    registry,
    defaultUnknownTypePolicy: policy,
    observer: { occurrence: (occurrence) => occurrences.push(occurrence) },
    userInteractionObserver: {
      interaction: (interaction) => interactions.push(interaction),
    },
  });

  const documentText =
    vector["documentText"]?.stringValue ??
    stringifyMilanoValue(vector["document"] as MilanoValue);

  const pump = new PumpDispatcher();
  const builder = engine.viewBuilder(documentText).label(name).dispatcher(pump);

  // The surface's action grants, per the vector's config.
  const actionsConfig = asRecord(config["actions"]);
  if (actionsConfig !== null) {
    const allowed = actionsConfig["allow"]?.arrayValue;
    if (allowed !== undefined && allowed !== null) {
      builder.allowActions(allowed.map((item) => item.stringValue as string));
    }
    const declared = asRecord(actionsConfig["declare"]);
    if (declared !== null) {
      for (const [actionName, declaration] of Object.entries(declared)) {
        const fields = declaration.recordValue ?? {};
        const parameters: Record<string, MilanoType> = {};
        for (const [parameter, descriptor] of Object.entries(
          asRecord(fields["parameters"]) ?? {},
        )) {
          const type = MilanoType.fromDescriptor(descriptor);
          if (type !== null) parameters[parameter] = type;
        }
        const resultDescriptor = fields["result"];
        builder.action(actionName, {
          parameters,
          result:
            resultDescriptor === undefined
              ? null
              : MilanoType.fromDescriptor(resultDescriptor),
        });
      }
    }
  }

  builder.actionHandler(neverCompletingHandler);

  const contextHandle = new MilanoContextHandle(asRecord(vector["context"]) ?? {});
  builder.contextSource(contextHandle);

  const suppliedState = asRecord(vector["state"]);
  if (suppliedState !== null) builder.stateData(() => suppliedState);

  const expect = asRecord(vector["expect"]) as Record_;
  const expectedError = asRecord(expect["error"]);

  let view;
  try {
    view = await builder.build();
  } catch (error) {
    if (expectedError === null) {
      if (error instanceof MilanoBuildError || error instanceof MilanoEngineError) {
        assert.fail(`${name}: unexpected build error ${error.message}`);
      }
      throw error;
    }
    assert.ok(
      matches(errorFields(error), expectedError),
      `${name}: error mismatch, got ${JSON.stringify(
        Object.fromEntries(
          Object.entries(errorFields(error)).map(([key, value]) => [key, String(value)]),
        ),
      )}`,
    );
    return;
  }

  assert.equal(expectedError, null, `${name}: expected an error, build succeeded`);

  // Steps: events, context updates, completions, teardown.
  for (const step of vector["steps"]?.arrayValue ?? []) {
    const fields = step.recordValue as Record_;
    const event = asRecord(fields["event"]);
    if (event !== null) {
      view.emit(
        event["node"]?.stringValue as string,
        event["name"]?.stringValue as string,
        event["payload"] ?? null,
      );
      pump.pump();
      continue;
    }
    const update = asRecord(fields["contextUpdate"]);
    if (update !== null) {
      contextHandle.update(update);
      pump.pump();
      continue;
    }
    if (fields["teardown"] !== undefined) {
      view.teardown();
      pump.pump();
      continue;
    }
    const completion = asRecord(fields["complete"]);
    if (completion !== null) {
      const index = Number(completion["dispatch"]?.intValue ?? 0n);
      const success = completion["outcome"]?.stringValue === "success";
      const payload = completion["payload"] ?? null;
      pump.dispatch(() => view.complete(index, success, payload));
      pump.pump();
    }
  }

  const expectedView = expect["view"];
  if (expectedView !== undefined) {
    assert.ok(
      snapshot(view.resolvedRoot).equals(expectedView),
      `${name}: resolved tree mismatch, got ${snapshot(view.resolvedRoot)}`,
    );
  }

  const expectedState = asRecord(expect["state"]);
  if (expectedState !== null) {
    assert.ok(
      MilanoValue.record(view.state).equals(MilanoValue.record(expectedState)),
      `${name}: state mismatch, got ${MilanoValue.record(view.state)}`,
    );
  }

  const expectedDispatched = expect["dispatched"]?.arrayValue;
  if (expectedDispatched !== undefined && expectedDispatched !== null) {
    assert.equal(
      view.dispatched.length,
      expectedDispatched.length,
      `${name}: dispatch count`,
    );
    expectedDispatched.forEach((expectedItem, index) => {
      const record = view.dispatched[index];
      assert.ok(record !== undefined);
      const produced: Record<string, MilanoValue> = {
        action: MilanoValue.string(record.name),
        parameters: MilanoValue.record(record.parameters),
      };
      assert.ok(
        matches(produced, expectedItem.recordValue as Record_),
        `${name}: dispatched ${index} mismatch`,
      );
    });
  }

  const expectedOccurrences = expect["occurrences"]?.arrayValue;
  if (expectedOccurrences !== undefined && expectedOccurrences !== null) {
    assert.equal(
      occurrences.length,
      expectedOccurrences.length,
      `${name}: occurrence count, got ${occurrences.map((item) => item.kind).join(", ")}`,
    );
    expectedOccurrences.forEach((expectedItem, index) => {
      const occurrence = occurrences[index];
      assert.ok(occurrence !== undefined);
      const produced: Record<string, MilanoValue> = {
        kind: MilanoValue.string(occurrence.kind),
      };
      if (occurrence.node !== null) produced["node"] = MilanoValue.string(occurrence.node);
      assert.ok(
        matches(produced, expectedItem.recordValue as Record_),
        `${name}: occurrence ${index} mismatch, got ${occurrence.kind}`,
      );
    });
  }

  const expectedInteractions = expect["interactions"]?.arrayValue;
  if (expectedInteractions !== undefined && expectedInteractions !== null) {
    assert.equal(
      interactions.length,
      expectedInteractions.length,
      `${name}: interaction count, got ${interactions.map((item) => item.kind).join(", ")}`,
    );
    expectedInteractions.forEach((expectedItem, index) => {
      const interaction = interactions[index];
      assert.ok(interaction !== undefined);
      const produced: Record<string, MilanoValue> = {
        kind: MilanoValue.string(interaction.kind),
      };
      if (interaction.node !== null) produced["node"] = MilanoValue.string(interaction.node);
      if (interaction.name !== null) produced["name"] = MilanoValue.string(interaction.name);
      if (interaction.value !== null) produced["value"] = interaction.value;
      assert.ok(
        matches(produced, expectedItem.recordValue as Record_),
        `${name}: interaction ${index} mismatch, got ${interaction.kind}`,
      );
    });
  }
}

describe("the conformance suite", () => {
  it("passes every vector", async () => {
    const conformance = join(specsDirectory(), "conformance");
    const suites = readdirSync(conformance).filter((entry) =>
      statSync(join(conformance, entry)).isDirectory(),
    );
    assert.ok(suites.length > 0, "no conformance suites found");

    let executed = 0;
    for (const suite of suites) {
      const directory = join(conformance, suite);
      const vocabularyJson = readFileSync(join(directory, "vocabulary.json"), "utf8");
      const vocabularyTypes = Object.keys(
        (parseJson(vocabularyJson).recordValue as Record_)["components"]
          ?.recordValue as Record_,
      );

      const files = readdirSync(directory)
        .filter((file) => file.endsWith(".json") && file !== "vocabulary.json")
        .sort();

      for (const file of files) {
        const vector = parseJson(readFileSync(join(directory, file), "utf8"))
          .recordValue as Record_;
        const name = vector["name"]?.stringValue as string;
        await runVector(name, vector, vocabularyJson, vocabularyTypes);
        executed += 1;
      }
    }
    assert.ok(executed >= 250, `expected the full suite, ran ${executed}`);
    console.log(`      conformance: ${executed} vectors`);
  });
});
