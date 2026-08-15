<img src="assets/get-milano.png" alt="Milano logo" width="112" align="right">

# Milano SDK

Milano is a client-only, design-system-agnostic **Document-Driven UI (DDUI)** framework for **SwiftUI** and **Compose**. Documents describe structure and behavior; your design system draws every pixel. Milano guarantees that what reaches your renderers is validated, typed, and behaviorally identical on both platforms.

Milano is **not** server-driven UI (it never talks to a server), **not** a SaaS (nothing hosted, nothing to sign up for), and **not** a design system (it draws nothing).

The normative specifications and the conformance suite live in [get-milano/specs](https://github.com/get-milano/specs). **Both engines pass the full conformance suite; that is the definition of correct.**

Consumer documentation lives in [`docs/`](docs/index.md), published at [get-milano.github.io/sdk](https://get-milano.github.io/sdk/): getting started, philosophy, guidelines, creating a bridge, writing documents, expressions, and guardrails.

Try Milano without installing anything: the [Playground](https://get-milano.github.io/playground/) validates and renders vocabularies and documents in the browser, with live expressions and interactive actions.

Status: `0.1.0`, pre-release. The contract major is `0`: pinning behavior, expecting evolution.

## iOS (SwiftUI)

Add the package in Xcode or `Package.swift` using this repository's URL; the product is `MilanoSDK` (iOS 15+, macOS 12+, watchOS 8+, Swift 6).

```swift
let engine = try MilanoEngine(
    vocabularyJSON: vocabularyData,
    registry: registry,                  // your renderers
    defaultUnknownTypePolicy: .skip)

MilanoHost(builder: engine.viewBuilder(document: documentData)
        .context(["userName": .string("Ada")])
        .actionHandler { action in /* route it */ }) {
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

then depend on `dev.get-milano:engine-compose:0.1.0`; the composite build substitutes it. On tagged releases the same coordinate is published to GitHub Packages Maven (note: GitHub Packages requires an authenticated Gradle repository even for public packages).

```kotlin
val engine = MilanoEngine(
    vocabularyJson = vocabularyJson,
    registry = registry,                 // your renderers
    defaultUnknownTypePolicy = MilanoUnknownTypePolicy.SKIP)

MilanoHost(
    builder = engine.viewBuilder(documentJson)
        .context(mapOf("userName" to MilanoValue.StringValue("Ada")))
        .actionHandler { action -> /* route it */ }
        .dispatcher(MilanoMainDispatcher()),
    loading = { CircularProgressIndicator() },
    failure = { error -> Text(error.toString()) })
```

## Repository layout

| Path | Contents |
|---|---|
| `engine/swiftui` | The Swift engine (pure Swift 6; the root `Package.swift` points here) |
| `engine/compose` | The Kotlin engine (Kotlin Multiplatform: engine core in `commonMain`; Android + JVM targets) |
| `samples/swiftui` | iOS sample app (Tuist; run `tuist generate` there) |
| `samples/compose` | Android sample app (consumes the engine from source via the composite build) |

The samples demonstrate every v1 capability: three banner layouts, an interstitial, a Milano fragment embedded between native components, and a form with document-driven validation, all through a pure design system bridged to Milano in a single `MilanoBridge` package. That split, design system with zero Milano imports plus one bridging package, is the recommended integration architecture.

## Development

- **Spec-first.** Nothing here invents behavior. When implementation reveals a gap, the spec is fixed and a conformance vector added before the code changes. A behavioral divergence between the engines always produces a reproducing vector before its fix.
- **Lockstep.** Both engines advance one milestone at a time; the shared vectors are the finish line.
- **Conformance.** Drivers read `MILANO_SPECS_DIR` (or default to a sibling `spec` checkout). Run `swift test` at the repo root and `./gradlew jvmTest` in `engine/compose`.
- **Lint gate.** SwiftLint and ktlint (`ktlint_official`) must pass with zero violations on engines and samples.
- **Distribution.** Tags carry binaries (XCFramework on the GitHub release for SPM `binaryTarget`; AAR/KMP artifacts to GitHub Packages). `main` and every other ref are source-only: SPM consumes the root package, Gradle consumes the composite build, exactly as `samples/compose` does.

## License

Code is licensed under [Apache-2.0](LICENSE). Redistributions must retain the attribution in [NOTICE](NOTICE), per section 4(d) of the license.

The **Milano name and logo are trademarks of Ezequiel Aceto**: use them to refer to this project, not to brand forks or derivatives.
