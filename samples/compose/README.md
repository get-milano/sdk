# Milano Compose sample

The same demos as the SwiftUI, Compose Desktop, and React Native samples, rendered from the same documents, on Android. What differs is only the design system doing the drawing: `designsystem/` is ordinary Compose with no Milano in it, and `milanobridge/` is the one doorway between the two.

```sh
./gradlew :app:assembleDebug        # build
./gradlew :app:installDebug         # onto a device or emulator
adb shell am start -n dev.getmilano.sample/.MainActivity \
    -e milano_screen quick-actions  # open one demo directly
```

The launch extra takes any demo id (`banner`, `banner-card`, `banner-strip`, `form`, `tip-calculator`, `checkbox-gate`) plus `quickstart`, `pokemon`, `profile`, `catalog`, `quick-actions`, `embedded`, and `interstitial`. It mirrors `MILANO_SCREEN` in the SwiftUI and Compose Desktop samples, and it is what the screenshot automation drives.

The engine is consumed **from source** through the composite build in `settings.gradle.kts`, exactly as documented for consumers: Gradle substitutes `dev.get-milano:engine-compose` with the engine in this repository, so an engine edit is in the next build with nothing to publish. Because your build drives the engine's, this path needs **Gradle 9.6 or newer**; consuming the published artifact from Maven Central has no such requirement.

## What to read first

- `milanobridge/MilanoBridge.kt`: every component type mapped to a renderer, and nothing else.
- `milanobridge/GeneratedBindings.kt`: **generated**, never edited. `button.label` is a `String` because the vocabulary says so, and a vocabulary change that breaks a renderer fails the compile instead of surfacing as an empty label.
- `environment/SampleEnvironment.kt`: one engine, one action handler, one analytics sink, shared by every screen.

## Build steps

Before every compile, Gradle regenerates `GeneratedBindings.kt` from `vocabulary.json` (`milano bindings`), validates every bundled document with the gate the engines run (`milano validate`: a document the engines would reject fails the build here, with the same typed error), and refreshes `documents.schema.json` for editors (`milano schema`). The three commands come from `@get-milano/cli`; inside this repository they run from the workspace build of the CLI, so `npm ci && npm run build` at the repository root comes first.

Android Studio does not see a login shell's `PATH`, so a Node installed by nvm, fnm, volta, asdf, or mise can be invisible to those build steps even though `node` works in every terminal. The build looks in those managers' locations itself; if yours lives elsewhere, set `MILANO_NODE` to it.
