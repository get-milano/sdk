---
title: Getting started
nav_order: 1
---

# Getting started

Rendering a document takes five pieces: a **vocabulary** (the JSON artifact declaring which component types and actions exist), **renderers** (your code, one per component type), an **engine** (holds vocabulary, registry, policy, and limits), a **builder** (per document, injects context, state data, and the action handler), and a **host** (shows a loading view, then the built view or the failure).

To try vocabularies, documents, and expressions before installing anything, open the [Playground](https://get-milano.github.io/playground/): it validates and renders in the browser against the live specification.

## Install

### SwiftUI

A tagged release resolves to a prebuilt, signed `MilanoSDK.xcframework`, integrity-pinned by the checksum in the tag's manifest:

```swift
dependencies: [
    .package(url: "https://github.com/get-milano/sdk.git", from: "0.1.0")
]
```

To build from source instead, depend on the main branch:

```swift
dependencies: [
    .package(url: "https://github.com/get-milano/sdk.git", branch: "main")
]
```

Either way, depend on the `MilanoSDK` product.

### Compose

The binary from GitHub Packages (GitHub's Maven registry requires a token with `read:packages`, even for public packages):

```kotlin
repositories {
    maven("https://maven.pkg.github.com/get-milano/sdk") {
        credentials {
            username = providers.gradleProperty("gpr.user").get()
            password = providers.gradleProperty("gpr.token").get()
        }
    }
}
dependencies {
    implementation("dev.get-milano:engine-compose:0.1.0")
}
```

Without a token, download `engine-compose-<version>.aar` (Android) or `engine-compose-jvm-<version>.jar` (JVM) from the [releases](https://github.com/get-milano/sdk/releases), drop it into `libs/`, and depend on it with `files(...)`; declare `kotlinx-serialization-json`, `kotlinx-coroutines-core`, and the Compose runtime yourself, since a loose artifact carries no POM.

Or build from source, as a composite build in `settings.gradle.kts`:

```kotlin
includeBuild("path/to/sdk/engine/compose")
```

## Render a first document

The vocabulary declares one component and one action:

```json
{
  "milano": "0.1.0",
  "name": "starter",
  "version": "0.1.0",
  "components": {
    "Greeting": { "properties": { "text": "string" }, "events": { "tap": null } }
  },
  "actions": {
    "openUrl": { "parameters": { "url": "string" } }
  }
}
```

The document uses it:

```json
{
  "version": "0.1.0",
  "context": { "userName": "string" },
  "root": {
    "type": "Greeting",
    "id": "hello",
    "properties": { "text": { "$expr": "concat('Hello, ', context.userName)" } },
    "on": { "tap": [ { "action": "openUrl", "url": "https://get-milano.dev" } ] }
  }
}
```

### SwiftUI

```swift
import MilanoSDK
import SwiftUI

final class GreetingRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        AnyView(
            Text(node.property("text").stringValue ?? "")
                .onTapGesture { node.emit("tap") }
        )
    }
}

var registry = MilanoRegistry()
registry.register(GreetingRenderer(), for: "Greeting")

let engine = try MilanoEngine(
    vocabularyJSON: vocabularyData,
    registry: registry,
    defaultUnknownTypePolicy: .skip
)

let builder = engine.viewBuilder(document: documentData)
    .context(["userName": .string("Ada")])
    .actionHandler { action in
        if action.name == "openUrl" { /* route to your URL opener */ }
    }

struct PromoScreen: View {
    var body: some View {
        MilanoHost(builder: builder) {
            ProgressView()
        } failure: { _ in
            EmptyView()
        }
    }
}
```

### Compose

```kotlin
import dev.getmilano.*

class GreetingRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        Text(
            text = node.property("text").stringOrNull ?: "",
            modifier = Modifier.clickable { node.emit("tap") },
        )
    }
}

val registry = MilanoRegistry().apply {
    register("Greeting", GreetingRenderer())
}

val engine = MilanoEngine(
    vocabularyJson = vocabularyJson,
    registry = registry,
    defaultUnknownTypePolicy = MilanoUnknownTypePolicy.SKIP,
)

val builder = engine.viewBuilder(documentText)
    .context(mapOf("userName" to MilanoValue.StringValue("Ada")))
    .dispatcher(MilanoMainDispatcher())
    .actionHandler { action ->
        if (action.name == "openUrl") { /* route to your URL opener */ }
    }

@Composable
fun PromoScreen() {
    MilanoHost(
        builder = builder,
        loading = { CircularProgressIndicator() },
        failure = { /* decide what the screen shows instead */ },
    )
}
```

On Android, pass `MilanoMainDispatcher()` so events and view updates serialize on the main thread. On SwiftUI the main dispatcher is the default.

## What happens at build

`build()` is asynchronous and all-or-nothing. The document is parsed and validated in full: schema, vocabulary conformance, expression type checking, limits. If the document declares `state`, your state data provider is awaited and its values are validated against the declarations. Only a document that passes every check produces a view; anything else throws one typed error. See [Guardrails](guardrails) for the full taxonomy.

## Working samples

The repository contains two complete sample apps, `samples/swiftui` (Tuist project) and `samples/compose`, demonstrating banners with three layouts, an interstitial, a Milano view embedded between native components, a form with conditional visibility, required markers, and expression-driven errors, and a screen that merges app-wide and per-screen context from a live API. See them side by side, with screenshots from both platforms, in [Samples](samples); they follow the architecture described in [Guidelines](guidelines).
