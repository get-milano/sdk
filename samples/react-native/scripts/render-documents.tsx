// Renders every bundled document through the app's own bridge, in Node.
//
// `validate-documents` proves the documents build; this proves the bridge
// draws them. It is also the runtime half of the generated bindings'
// verification: `npm run typecheck` proves they compile, this proves a
// renderer reading `button.label` gets the label rather than throwing.
//
// React Native's primitives are stubbed (see scripts/stubs), because the
// real ones need Metro. Nothing in the bridge notices: it passes props to
// components, and the stubs record what they were given.
import { MilanoEngine, MilanoType, MilanoValue, parseJson, synthesizedState } from "@get-milano/core";
import { MilanoRenderedView } from "@get-milano/react";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";

import { DOCUMENTS } from "../src/documents.generated.ts";
import { sampleRegistry } from "../src/milano-bridge.tsx";

// Tells React this process is a test environment, so act() does its job
// quietly instead of warning that it cannot.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vocabularyJson = DOCUMENTS["vocabulary"];

/** The document's declared context, synthesized so any document renders. */
function contextFor(text: string): Record<string, MilanoValue> {
  const declarations = parseJson(text).recordValue?.["context"]?.recordValue ?? {};
  const types: Record<string, MilanoType> = {};
  for (const [key, descriptor] of Object.entries(declarations)) {
    const parsed = MilanoType.fromDescriptor(descriptor);
    if (parsed === null) throw new Error(`undecodable context declaration: ${key}`);
    types[key] = parsed;
  }
  return synthesizedState(types);
}

async function main(): Promise<void> {
  let failures = 0;

  for (const [name, text] of Object.entries(DOCUMENTS)) {
    if (name === "vocabulary") continue;

    const engine = new MilanoEngine({
      vocabularyJson,
      registry: sampleRegistry(),
      // The banners in the sample degrade rather than fail; matching the
      // app keeps this honest about what it renders.
      defaultUnknownTypePolicy: name.startsWith("banner") ? "skip" : "fail",
    });

    try {
      const view = await engine
        .viewBuilder(text)
        .label(name)
        .context(contextFor(text))
        .stateData((declarations) => synthesizedState(declarations))
        .actionHandler(() => MilanoValue.string("rendered"))
        .build();

      // React 19 renders concurrently: without act, the tree is still
      // empty when toJSON is called.
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          createElement(MilanoRenderedView, { view, registry: engine.registry }),
        );
      });
      const tree = renderer.toJSON();
      const rendered = JSON.stringify(tree);
      if (tree === null || rendered.length < 2) {
        failures += 1;
        console.error(`FAIL ${name}: rendered nothing`);
      } else {
        const elements = (rendered.match(/"type":/g) ?? []).length;
        console.log(`ok   ${name}: ${elements} elements`);
      }
      await act(async () => renderer.unmount());
      view.teardown();
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${String(error)}`);
    }
  }

  if (failures > 0) {
    console.error(`${failures} document(s) failed to render`);
    process.exit(1);
  }
  console.log(`${Object.keys(DOCUMENTS).length - 1} documents rendered through the bridge`);
}

void main();
