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

/**
 * Elements for the documents whose point is a `$repeat`. Synthesized
 * state gives a declared array its zero value, the empty array, so the
 * template renders nothing and the renderers inside it are never
 * exercised: without these, a broken Icon or Card renderer passes here.
 */
const ELEMENTS: Readonly<Record<string, Record<string, MilanoValue>>> = {
  "quick-actions": {
    actions: MilanoValue.array([
      MilanoValue.record({
        id: MilanoValue.string("profile"),
        label: MilanoValue.string("Profile"),
        icon: MilanoValue.string("person"),
        screen: MilanoValue.string("profile"),
      }),
      MilanoValue.record({
        id: MilanoValue.string("catalog"),
        label: MilanoValue.string("Catalog"),
        icon: MilanoValue.string("list"),
        screen: MilanoValue.string("catalog"),
      }),
    ]),
    lastTapped: MilanoValue.int(-1n),
  },
  catalog: {
    items: MilanoValue.array([
      MilanoValue.record({
        id: MilanoValue.string("bulbasaur"),
        name: MilanoValue.string("Bulbasaur"),
        blurb: MilanoValue.string("Grass and poison."),
        imageUrl: MilanoValue.string("https://example.com/1.png"),
        url: MilanoValue.string("https://example.com/bulbasaur"),
      }),
    ]),
    hidden: MilanoValue.int(0n),
  },
};

/**
 * Which documents declare an array in state, and so need elements before
 * anything inside their `$repeat` renders. Synthesized state gives a
 * declared array its zero value, the empty array, so a document missing
 * from ELEMENTS renders its template zero times and this script reports a
 * cheerful "ok" over a tree that never exercised the renderers inside it.
 * Opting in silently was how the catalog and the quick actions strip both
 * went uncovered; this makes leaving one out a failure.
 */
function needsElements(text: string): readonly string[] {
  const declarations = parseJson(text).recordValue?.["state"]?.recordValue ?? {};
  return Object.entries(declarations)
    .filter(([, descriptor]) => MilanoType.fromDescriptor(descriptor)?.kind.kind === "array")
    .map(([key]) => key);
}

/**
 * Context for documents whose content is context, not markup. Synthesized
 * context is the zero value of each declared type, so a card whose number
 * arrives that way renders an empty mask and proves nothing about the
 * masking it exists to demonstrate.
 */
const CONTEXT: Readonly<Record<string, Record<string, MilanoValue>>> = {
  "card-detail": {
    cardNumber: MilanoValue.string("4111111111111111"),
    cardHolder: MilanoValue.string("Ada Lovelace"),
    expiry: MilanoValue.string("0929"),
    cvv: MilanoValue.string("123"),
    capabilities: MilanoValue.string("Contactless, Online, ATM"),
    cardStatus: MilanoValue.string("frozen"),
    statusLabels: MilanoValue.record({
      active: MilanoValue.string("Active"),
      frozen: MilanoValue.string("Frozen"),
      expired: MilanoValue.string("Expired"),
    }),
  },
};

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
      // The app's host functions, answered here as the app answers them.
      functionHandler: (call) =>
        call.name === "formatMoney"
          ? MilanoValue.string(`${(call.arguments[0]?.numberValue ?? 0).toFixed(2)} ${call.arguments[1]?.stringValue ?? "EUR"}`)
          : null,
    });

    const arrays = needsElements(text);
    const supplied = Object.keys(ELEMENTS[name] ?? {});
    const missing = arrays.filter((key) => !supplied.includes(key));
    if (missing.length > 0) {
      failures += 1;
      console.error(
        `FAIL ${name}: declares ${missing.join(", ")} as an array with no elements in ELEMENTS, ` +
          "so its $repeat would render nothing and prove nothing",
      );
      continue;
    }

    try {
      const view = await engine
        .viewBuilder(text)
        .label(name)
        .context({ ...contextFor(text), ...CONTEXT[name] })
        .stateData((declarations) => ({ ...synthesizedState(declarations), ...ELEMENTS[name] }))
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
