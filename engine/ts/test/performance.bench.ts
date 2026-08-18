// The same benchmark the Swift and Kotlin engines ship: cold build and
// update latency across tree sizes, medians printed as a table.
//
//   npm run benchmark --workspace @get-milano/core
//
// Not part of `npm test`: it measures rather than asserts, and a machine
// under load would fail a threshold for reasons that have nothing to do
// with the engine. The numbers belong in docs/performance, produced on a
// machine whose specification is stated.
import { MilanoEngine, MilanoRegistry } from "../src/engine/engine.ts";
import { MilanoValue } from "../src/core/value.ts";
import type { MilanoDispatcher } from "../src/runtime/dispatcher.ts";
import type { MilanoView } from "../src/runtime/view.ts";

const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "benchmark",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" } },
    Field: { properties: { value: "string" }, events: { change: "string" } },
  },
  actions: {},
});

/** Holds work until pumped, so an update's cost can be measured whole. */
class PumpDispatcher implements MilanoDispatcher {
  private readonly queue: (() => void)[] = [];

  dispatch(work: () => void): void {
    this.queue.push(work);
  }

  pump(): void {
    while (this.queue.length > 0) (this.queue.shift() as () => void)();
  }
}

/**
 * A wide tree: one Field plus `nodes` Texts, every other Text bound to
 * state.value through an expression, the rest literal. Identical in shape
 * to the Swift and Kotlin benchmarks, so the numbers are comparable.
 */
function document(nodes: number): string {
  const children: string[] = [
    '{"type": "Field", "id": "field", "properties": {"value": {"$expr": "state.value"}},' +
      ' "on": {"change": [{"action": "$set", "key": "value", "value": {"$expr": "event"}}]}}',
  ];
  for (let index = 0; index < nodes; index += 1) {
    children.push(
      index % 2 === 0
        ? '{"type": "Text", "properties": {"text": {"$expr": "concat(\'v\', state.value)"}}}'
        : `{"type": "Text", "properties": {"text": "static ${index}"}}`,
    );
  }
  return (
    '{"version": "1.0.0", "state": {"value": "string"},' +
    ` "root": {"type": "Column", "id": "root", "children": [${children.join(",")}]}}`
  );
}

function median(samples: readonly number[]): number {
  return [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)] as number;
}

async function main(): Promise<void> {
  const registry = new MilanoRegistry<string>();
  for (const type of ["Column", "Text", "Field"]) registry.register(type, type);
  const engine = new MilanoEngine<string>({ vocabularyJson: VOCABULARY, registry });

  const rows: [number, number, number][] = [];
  for (const nodes of [10, 100, 1000, 5000]) {
    const text = document(nodes);
    const iterations = nodes >= 1000 ? 5 : 25;

    async function build(): Promise<{ view: MilanoView; pump: PumpDispatcher }> {
      const pump = new PumpDispatcher();
      const view = await engine
        .viewBuilder(text)
        .dispatcher(pump)
        .stateData(() => ({ value: MilanoValue.string("0") }))
        .build();
      return { view, pump };
    }

    // One warm-up, so the first sample is not paying for lazy compilation.
    (await build()).view.teardown();

    const buildSamples: number[] = [];
    for (let index = 0; index < iterations; index += 1) {
      const start = performance.now();
      const { view } = await build();
      buildSamples.push(performance.now() - start);
      view.teardown();
    }

    // The update path: one emission, one $set, a full re-resolution.
    const { view, pump } = await build();
    let tick = 0;
    const update = (): void => {
      tick += 1;
      view.emit("field", "change", MilanoValue.string(String(tick)));
      pump.pump();
    };
    update();

    const updateSamples: number[] = [];
    for (let index = 0; index < iterations; index += 1) {
      const start = performance.now();
      update();
      updateSamples.push(performance.now() - start);
    }
    view.teardown();

    rows.push([nodes, median(buildSamples), median(updateSamples)]);
  }

  console.log("nodes | cold build (ms) | update (ms)");
  for (const [nodes, build, update] of rows) {
    console.log(
      `${String(nodes).padStart(5)} | ${build.toFixed(3).padStart(15)} | ${update
        .toFixed(3)
        .padStart(11)}`,
    );
  }
}

void main();
