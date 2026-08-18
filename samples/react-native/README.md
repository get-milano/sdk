# Milano sample app (React Native)

The same documents the SwiftUI and Compose samples render, through the same contract: three banner layouts, an interstitial, a Milano fragment embedded between native components, a form with document-driven validation and a typed completion result, the tip calculator, the checkbox gate, a screen-context demo backed by PokeAPI, a whole profile screen, and a catalog of tappable cards.

## Run

From the repository root (`sdk/`), which is the npm workspace root:

```sh
npm install
npm run build                       # builds the two @get-milano packages
npm start --workspace milano-sample-react-native
```

Then press `i` or `a`, or run `npm run ios` / `npm run android` in this directory for a native build. Metro resolves `@get-milano/*` through the workspace, so engine changes show up without publishing.

`EXPO_PUBLIC_MILANO_SCREEN=banner npm start` opens one demo directly, mirroring `MILANO_SCREEN` in the other two samples. Accepted values: any demo id (`banner`, `banner-card`, `banner-strip`, `form`, `tip-calculator`, `checkbox-gate`) plus `quickstart`, `pokemon`, `profile`, `catalog`, `embedded`, `interstitial`.

## Identity

This app is `dev.getmilano.sample.reactnative` on both platforms, distinct from the `dev.getmilano.sample` the SwiftUI and Compose samples use on theirs. It runs on both, so sharing their identifier would mean installing it replaced whichever native sample was already on the device.

Changing that identifier means changing `app.json` **and** the committed `ios/` and `android/` projects, which are what actually build. Afterwards, delete `android/build/generated/autolinking`: React Native writes the app's package into generated Java from a cached `autolinking.json`, and the task producing it does not treat the Gradle `namespace` as an input, so an otherwise correct build fails with `cannot find symbol: class BuildConfig` naming the old package.

## Layout

| Path | Contents |
|---|---|
| `documents/` | The documents and the vocabulary, byte-identical to the other samples |
| `scripts/bundle-documents.mjs` | Inlines `documents/*.json` into `src/documents.generated.ts` as **text** |
| `src/design-system.tsx` | The app's own components. Zero Milano imports |
| `src/milano-bridge.tsx` | The only doorway: node in, design system component out |
| `src/environment.ts` | One engine, the console observer and analytics sink, a builder per screen |
| `src/screens/` | The screens, each hosting one document |

That split, a design system that knows nothing about Milano plus one bridging module, is the recommended integration architecture.

## Documents are text, not imports

`npm run documents` regenerates `src/documents.generated.ts` after editing anything in `documents/`. The generated module holds each document as a **string**, and the engine parses it.

That is deliberate. Milano distinguishes `int` from `double`; `JSON.parse` does not, and collapses `20.0` to `20` on the way in. A `import doc from "./doc.json"` would have to be re-serialized before the engine could read it, and a declared `double` literal would arrive as an `int`. Text keeps the distinction, and it is the shape a real app receives from a content service anyway.
