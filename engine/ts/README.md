# @get-milano/core

The Milano **Document-Driven UI** contract engine, in TypeScript. Documents in, resolved trees out, validated by a strict gate before your code sees a single node.

No UI toolkit, no dependencies, no native code. This package is the engine only: it never draws. Pair it with [`@get-milano/react`](https://www.npmjs.com/package/@get-milano/react) for React and React Native, or drive it directly from any renderer you like.

The normative specifications and the conformance suite live in [get-milano/specs](https://github.com/get-milano/specs). This engine passes the full suite, the same 256 vectors the Swift and Kotlin engines pass; that is the definition of correct.

Documentation: [get-milano.dev/sdk](https://get-milano.dev/sdk/).

## Install

```sh
npm install @get-milano/core
```

ESM and CommonJS builds ship together, with types. Node 20 or newer; in the browser or React Native, any modern bundler.

## Use

```ts
import { MilanoEngine, MilanoRegistry, MilanoValue } from "@get-milano/core";

// The renderer type is yours; the core never calls it. React apps use
// createMilanoRegistry() from @get-milano/react instead.
const registry = new MilanoRegistry<MyRenderer>();
registry.register("Text", myTextRenderer);

const engine = new MilanoEngine({ vocabularyJson, registry });

const view = await engine
  .viewBuilder(documentJson)
  .context({ userName: MilanoValue.string("Ada") })
  .actionHandler(async (action) => null) // route it; return a declared result
  .build();

render(view.resolvedRoot);
const unsubscribe = view.subscribe(() => render(view.resolvedRoot));
```

`build()` either returns a fully validated view or throws a typed `MilanoBuildError`. After that, every property read is guaranteed: a declared `string` is a string, a declared enum is one of its members, and expressions have already been type-checked.

## Numbers

Milano distinguishes `int` (64-bit, wrapping) from `double`, and `JSON.parse` cannot: it collapses `5.0` to `5` and loses precision past 2^53. So this package brings its own JSON reader and its own double formatter.

- Feed documents and provider values as **text or bytes**, not as parsed objects, and the distinction survives.
- `MilanoValue.int` is backed by `bigint`. Read it with `.intValue` for the exact value, or `.numberValue` when a JavaScript number is what your renderer wants.

```ts
import { parseJson } from "@get-milano/core";

const payload = parseJson(await response.text()); // int stays int
const values = payload.recordValue ?? {};
```

## What it does not do

Milano is not server-driven UI (it never talks to a server), not a SaaS (nothing hosted), and not a design system (it draws nothing). Your components draw every pixel; documents only decide structure and behavior.

## License

[Apache-2.0](https://github.com/get-milano/sdk/blob/main/LICENSE). Redistributions must retain the attribution in [NOTICE](https://github.com/get-milano/sdk/blob/main/NOTICE).
