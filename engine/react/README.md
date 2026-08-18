# @get-milano/react

Milano **Document-Driven UI** for React: the host component, the renderer surface, and node materialization.

This package imports only `react`. It draws nothing and knows nothing about the DOM or about React Native, so the same binding serves the web and mobile; the platform primitives live in the renderers you write.

The engine itself is [`@get-milano/core`](https://www.npmjs.com/package/@get-milano/core). React Native apps install these same two packages: there is no React Native package, because there is nothing React-Native-specific to ship. No native modules, no autolinking, no config plugin.

Documentation: [get-milano.dev/sdk](https://get-milano.dev/sdk/).

## Install

```sh
npm install @get-milano/react @get-milano/core
```

React 18 or newer (peer). On React Native, 0.85 with the new architecture and React 19 is what the sample app runs; nothing here uses a React Native API, so older versions are a support statement rather than a technical bound.

## A renderer

A renderer is an ordinary component that receives one resolved node. Read declared properties, draw with your design system, emit declared events.

```tsx
import type { MilanoNodeProps } from "@get-milano/react";

function TextRenderer({ node }: MilanoNodeProps) {
  return <p>{node.property("text").stringValue ?? ""}</p>;
}

function ButtonRenderer({ node }: MilanoNodeProps) {
  return (
    <button
      disabled={!(node.property("enabled").boolValue ?? true)}
      onClick={() => node.emit("tap")}
    >
      {node.property("label").stringValue ?? ""}
    </button>
  );
}
```

Containers place `node.children`, already materialized and keyed by node reference, so identity survives re-resolution:

```tsx
const Column = ({ node }: MilanoNodeProps) => <div className="column">{node.children}</div>;
```

## Hosting a document

```tsx
import { createMilanoRegistry, MilanoHost } from "@get-milano/react";
import { MilanoEngine, MilanoValue } from "@get-milano/core";

// createMilanoRegistry pins the renderer types for React; a bare
// `new MilanoRegistry()` infers `unknown` and will not satisfy MilanoHost.
const registry = createMilanoRegistry();
registry.register("Column", Column);
registry.register("Text", TextRenderer);
registry.register("Button", ButtonRenderer);

const engine = new MilanoEngine({ vocabularyJson, registry });

// The builder must be stable across renders: a new builder means a new build.
const builder = useMemo(
  () =>
    engine
      .viewBuilder(documentJson)
      .context({ userName: MilanoValue.string("Ada") })
      .actionHandler(async (action) => null),
  [documentJson],
);

<MilanoHost
  builder={builder}
  loading={<Spinner />}
  failure={(error) => <Failure detail={String(error)} />}
/>;
```

`MilanoHost` builds the view, subscribes through `useSyncExternalStore`, and tears the view down when it unmounts. Swapping the builder shows the loading content until the new view is ready: the previous document is never rendered through the new builder's registry.

For a first integration, `MilanoQuickHost` takes a document, a vocabulary, and a map of renderers, and assembles the rest for you. Everything it builds the engine from must be stable across renders, because a change rebuilds the view and a rebuild restarts the document from its initial state; the callbacks (`onAction`, `observer`, `userInteractionObserver`) are exempt, so inline closures cost nothing.

If you need the pieces separately, `useMilanoView` gives you the build state and `MilanoRenderedView` renders and subscribes to a built view.

## Analytics

Renderers report widget signals the document does not model as events, and they reach the host's user-interaction observer without touching dispatch or state:

```tsx
<input
  onFocus={() => node.userInteraction("focusGained")}
  onChange={(e) => node.emit("change", MilanoValue.string(e.target.value))}
/>
```

Milano implements no tracker: records arrive unredacted and the host decides what to keep.

## License

[Apache-2.0](https://github.com/get-milano/sdk/blob/main/LICENSE). Redistributions must retain the attribution in [NOTICE](https://github.com/get-milano/sdk/blob/main/NOTICE).
