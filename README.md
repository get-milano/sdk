<img src="assets/get-milano.png" alt="Milano logo" width="112" align="right">

# Milano SDK

Milano is a client-only, design-system-agnostic **Document-Driven UI (DDUI)** framework for **SwiftUI**, **Compose**, and **React / React Native**. Documents describe structure and behavior; your design system draws every pixel. Milano guarantees that what reaches your renderers is validated, typed, and behaviorally identical on every platform.

Milano is **not** server-driven UI (it never talks to a server), **not** a SaaS (nothing hosted, nothing to sign up for), and **not** a design system (it draws nothing).

The normative specifications and the conformance suite live in [get-milano/specs](https://github.com/get-milano/specs). **Every engine passes the full conformance suite; that is the definition of correct.**

Consumer documentation lives in [`docs/`](docs/index.md), published at [get-milano.dev/sdk](https://get-milano.dev/sdk/): getting started, philosophy, guidelines, creating a bridge, writing documents, expressions, and guardrails.

Try Milano without installing anything: the [Playground](https://get-milano.dev/playground/) runs the published engine in the browser, with live state, expressions, dispatched actions you can complete, and both observability streams. Its source is also the worked example of the React binding.

Status: stable. From 1.0.0 the SDK follows semantic versioning: within a major version, releases are additive and documents, vocabularies, and integrations keep working. The SDK implements contract v1.0 of the [Milano specs](https://github.com/get-milano/specs).

## iOS (SwiftUI)

Add the package in Xcode or `Package.swift` using this repository's URL; the product is `MilanoSDK` (iOS 15+, macOS 12+, watchOS 8+, Swift 6).

```swift
let engine = try MilanoEngine(
    vocabularyJSON: vocabularyData,
    registry: registry,                  // your renderers
    defaultUnknownTypePolicy: .skip)

MilanoHost(builder: engine.viewBuilder(document: documentData)
        .context(["userName": .string("Ada")])
        .actionHandler { action in nil /* route it; return a declared result */ }) {
    ProgressView()
} failure: { error in
    Text(String(describing: error))
}
```

## Android (Compose)

From source (works on any ref, no credentials), in `settings.gradle.kts`:

```kotlin
includeBuild("path/to/sdk/engine/compose")
```

then depend on `dev.get-milano:engine-compose:1.2.1`; the composite build substitutes it. Your build's Gradle drives the engine's, so this path needs **Gradle 9.6 or newer** (the engine builds with AGP 9, which does not run on older Gradle). Consuming the published artifact has no such requirement. On tagged releases the same coordinate is published to GitHub Packages Maven (note: GitHub Packages requires an authenticated Gradle repository even for public packages).

```kotlin
val engine = MilanoEngine(
    vocabularyJson = vocabularyJson,
    registry = registry,                 // your renderers
    defaultUnknownTypePolicy = MilanoUnknownTypePolicy.SKIP)

MilanoHost(
    builder = engine.viewBuilder(documentJson)
        .context(mapOf("userName" to MilanoValue.StringValue("Ada")))
        .actionHandler { action -> null /* route it; return a declared result */ },
    loading = { CircularProgressIndicator() },
    failure = { error -> Text(error.toString()) })
```

## React and React Native (TypeScript)

Added in 1.1.0. Two packages on npm: `@get-milano/core` is the engine (zero dependencies, no UI toolkit) and `@get-milano/react` is the binding, which imports only `react`.

**There is no React Native package, because there is nothing React-Native-specific to ship.** No native modules, no autolinking, no config plugin: Milano draws nothing, so the same binding serves the web and React Native, and the platform primitives live in the renderers you write.

```sh
npm install @get-milano/react @get-milano/core
```

```tsx
const registry = createMilanoRegistry();  // your renderers go in here
const engine = new MilanoEngine({
  vocabularyJson,
  registry,
  defaultUnknownTypePolicy: "skip",
});

<MilanoHost
  builder={engine
    .viewBuilder(documentJson)
    .context({ userName: MilanoValue.string("Ada") })
    .actionHandler(async (action) => null /* route it; return a declared result */)}
  loading={<ActivityIndicator />}
  failure={(error) => <Text>{String(error)}</Text>}
/>;
```

Documents are loaded as **text**, never as JSON imports: Milano distinguishes `int` from `double` and `JSON.parse` does not. The engine brings its own JSON reader and double formatter for exactly that reason, and `int` is backed by `bigint`.

## Repository layout

| Path | Contents |
|---|---|
| `engine/swiftui` | The Swift engine (pure Swift 6; the root `Package.swift` points here) |
| `engine/compose` | The Kotlin engine (Kotlin Multiplatform: engine core in `commonMain`; Android + JVM targets) |
| `engine/ts` | The TypeScript engine, `@get-milano/core` (zero dependencies) |
| `engine/react` | The React binding, `@get-milano/react` |
| `samples/swiftui` | iOS sample app (Tuist; run `tuist generate` there) |
| `samples/compose` | Android sample app (consumes the engine from source via the composite build) |
| `samples/react-native` | React Native sample app (Expo; consumes the packages through the npm workspace) |

The three samples render the same documents and demonstrate every v1.0 capability and beyond: three banner layouts, an interstitial, a Milano fragment embedded between native components, a form with document-driven validation, a whole user-profile screen, and a catalog of tappable item cards, all through a pure design system bridged to Milano in a single bridging module. That split, design system with zero Milano imports plus one bridging module, is the recommended integration architecture.

## Development

- **Spec-first.** Nothing here invents behavior. When implementation reveals a gap, the spec is fixed and a conformance vector added before the code changes. A behavioral divergence between the engines always produces a reproducing vector before its fix.
- **Lockstep.** The engines advance one milestone at a time; the shared vectors are the finish line.
- **Conformance.** Drivers read `MILANO_SPECS_DIR` (or default to a sibling `specs` checkout). Run `swift test` at the repo root, `./gradlew jvmTest` in `engine/compose`, and `npm test` at the repo root for the TypeScript packages.
- **Lint gate.** SwiftLint and ktlint (`ktlint_official`) must pass with zero violations on engines and samples; the TypeScript packages typecheck under `strict` with `npm run typecheck`.
- **Distribution.** Tags carry binaries (XCFramework on the GitHub release for SPM `binaryTarget`; AAR/KMP artifacts to GitHub Packages; the two npm packages to npmjs). `main` and every other ref are source-only: SPM consumes the root package, Gradle consumes the composite build, and npm consumes the workspace, exactly as the samples do.

## License

Code is licensed under [Apache-2.0](LICENSE). Redistributions must retain the attribution in [NOTICE](NOTICE), per section 4(d) of the license.

The **Milano name and logo are owned by Ezequiel (Kimi) Aceto**: use them to refer to this project, not to brand forks or derivatives.
