# Milano Compose Desktop sample

The same demos as the SwiftUI, Compose (Android), and React Native samples, rendered from the same documents, on the desktop JVM through Compose Multiplatform. What differs is only the design system doing the drawing, and here even that is nearly the Android sample's: the renderers are pure Compose, so they moved over with an image loader swapped in.

```sh
./gradlew run                       # the menu
./gradlew run --args="--screen=banner-card"
./gradlew packageDistributionForCurrentOs   # a DMG, MSI, or DEB under build/compose/binaries
```

The engine is consumed **from source** through the composite build in `settings.gradle.kts`, exactly as documented for consumers; Gradle substitutes `dev.get-milano:engine-compose` with the engine's JVM target. The engine's build also declares an Android target, so configuring it needs an Android SDK on the machine (`ANDROID_HOME`); a desktop-only consumer takes the published JVM artifact instead and needs nothing of the sort.

## What the desktop changes

- **Threading.** Nothing to configure: on the desktop JVM the engine's default dispatcher is bound to the AWT event thread, where Compose Desktop runs, which is the guarantee `MilanoMainDispatcher` gives on Android. `SampleEnvironment` sets no dispatcher.
- **Images.** No image-loading library: `RemoteImage` fetches a URL off the UI thread and draws it when it arrives. Everything else in `designsystem/` is the Android sample's code.
- **Navigation.** A window has no back gesture, so the header carries a Back button.
- **Opening URLs.** `java.awt.Desktop.browse`, behind the same `https`-with-a-host check as the other samples: the handler is the last capability check.

## Build steps

Before every compile, Gradle regenerates `GeneratedBindings.kt` from `vocabulary.json` (`milano bindings`), validates every bundled document with the gate the engines run (`milano validate`: a document the engines would reject fails the build here, with the same typed error), and refreshes `documents.schema.json` for editors (`milano schema`). The three commands come from `@get-milano/cli`; inside this repository they run from the workspace build of the CLI, so `npm ci && npm run build` at the repository root comes first.
