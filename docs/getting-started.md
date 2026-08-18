---
title: Getting started
nav_order: 1
---

# Getting started

Rendering a document takes five pieces: a **vocabulary** (the JSON artifact declaring which component types and actions exist), **renderers** (your code, one per component type), an **engine** (holds vocabulary, registry, policy, and limits), a **builder** (per document, injects context, state data, and the action handler), and a **host** (shows a loading view, then the built view or the failure).

To try vocabularies, documents, and expressions before installing anything, open the [Playground](https://get-milano.dev/playground/): it runs this very engine (`@get-milano/core` from npm) in the browser, so a document that builds there builds in your app, and one that fails shows the same typed error.

## Install

### SwiftUI

A tagged release resolves to a prebuilt, signed `MilanoSDK.xcframework`, integrity-pinned by the checksum in the tag's manifest:

```swift
dependencies: [
    .package(url: "https://github.com/get-milano/sdk.git", from: "1.2.1")
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
    implementation("dev.get-milano:engine-compose:1.2.1")
}
```

Without a token, download `engine-compose-android-<version>.aar` (Android) or `engine-compose-jvm-<version>.jar` (JVM) from the [releases](https://github.com/get-milano/sdk/releases), drop it into `libs/`, and depend on it with `files(...)`; declare `kotlinx-serialization-json`, `kotlinx-coroutines-core`, and the Compose runtime yourself, since a loose artifact carries no POM.

Or build from source, as a composite build in `settings.gradle.kts`:

```kotlin
includeBuild("path/to/sdk/engine/compose")
```

A composite build is driven by *your* Gradle, not the engine's wrapper, so this path needs **Gradle 9.6 or newer**: the engine builds with AGP 9, which refuses to run on anything older. Nothing above this line is affected, because a published artifact carries no build-tool requirement; only building the engine yourself does.

### React and React Native

```sh
npm install @get-milano/react @get-milano/core
```

Two packages, the same two on every platform. `@get-milano/core` is the engine and has zero dependencies; `@get-milano/react` is the binding and imports only `react`, so the same renderer surface serves the web and React Native.

There is **no React Native package and no native code**: no autolinking, no config plugin, nothing to run before `npm install`. Milano draws nothing, so nothing about it is platform-specific; your renderers use `View` and `Text` on React Native and DOM elements on the web.

The supported range is wide because the surface is small. The binding uses `createElement` and five hooks, one of which is `useSyncExternalStore`, so the floor is **React 18** and there is no ceiling; CI mounts the packed package on each supported React major, so the range is tested rather than asserted. On React Native the supported floor is **0.85** with the new architecture, which is what the sample app runs. Older React Natives are likely to work, since nothing here touches a React Native API, but they are untested and not a promise.

React Native does impose one rule on your app, though not through Milano: **pin `react` to the exact version your `react-native` declares**, because React Native bundles a renderer compiled against one exact React build and React will not start against any other. `"react": "19.2.3"` next to `"react-native": "^0.85.3"`, never `"^19.2.3"`, and any test renderer pinned to that same exact version. A floating range resolves one patch ahead as soon as one ships, and the app fails at startup with `Incompatible React versions`.

One rule applies from the first line: **load documents and vocabularies as text**, never through `import doc from "./doc.json"`. Milano distinguishes `int` from `double` and `JSON.parse` does not, so the engine brings its own JSON reader; text is also the shape a content service hands you.

## One view first: the quick path

Before wiring the full architecture, render something with a single view. `MilanoHost` has a quick overload that takes the raw document and vocabulary (bytes on Swift, strings on Kotlin and TypeScript) plus a renderer map, and creates the engine, registry, and builder inside; declared state is synthesized as zero-values, and both engine and build failures land in your failure content:

```swift
MilanoHost(
    document: documentData,
    vocabulary: vocabularyData,
    renderers: ["Greeting": GreetingRenderer()],
    context: ["userName": .string("Ada")],
    onAction: { action in
        print("dispatched \(action.name)")
        return nil  // the completion result, for actions that declare one
    }
) {
    ProgressView()
} failure: { error in
    Text(String(describing: error))
}
```

```kotlin
MilanoHost(
    documentText = documentText,
    vocabularyJson = vocabularyJson,
    renderers = mapOf("Greeting" to GreetingRenderer()),
    context = mapOf("userName" to MilanoValue.StringValue("Ada")),
    onAction = { action ->
        Log.d("app", "dispatched ${action.name}")
        null // the completion result, for actions that declare one
    },
    loading = { CircularProgressIndicator() },
    failure = { error -> Text(error.toString()) },
)
```

{% raw %}
```tsx
<MilanoQuickHost
  document={documentText}
  vocabulary={vocabularyText}
  renderers={{ Greeting }}
  context={{ userName: MilanoValue.string("Ada") }}
  onAction={(action) => {
    console.log(`dispatched ${action.name}`);
    return null; // the completion result, for actions that declare one
  }}
  loading={<ActivityIndicator />}
  failure={(error) => <Text>{String(error)}</Text>}
/>
```
{% endraw %}

Everything `MilanoQuickHost` receives must be stable across renders (module scope or `useMemo`): a new document, vocabulary, or renderer map means a new build.

All three sample apps ship a **Quick start** screen built exactly this way: inline vocabulary, inline document, one renderer, zero setup. Use the quick path for a first integration or a simple embed; for real apps, share one engine across screens and use the builder, which is everything below.

## Render a first document

The vocabulary declares one component and one action:

```json
{
  "milano": "1.0.0",
  "name": "starter",
  "version": "1.0.0",
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
  "version": "1.0.0",
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
    registry: registry
)

let builder = engine.viewBuilder(document: documentData)
    .context(["userName": .string("Ada")])
    .actionHandler { action in
        if action.name == "openUrl" { /* route to your URL opener */ }
        return nil
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
)

val builder = engine.viewBuilder(documentText)
    .context(mapOf("userName" to MilanoValue.StringValue("Ada")))
    .actionHandler { action ->
        if (action.name == "openUrl") { /* route to your URL opener */ }
        null
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

### React and React Native

```tsx
import { MilanoEngine, MilanoValue } from "@get-milano/core";
import { createMilanoRegistry, MilanoHost } from "@get-milano/react";
import type { MilanoNodeProps } from "@get-milano/react";
import { Pressable, Text } from "react-native";

function Greeting({ node }: MilanoNodeProps) {
  return (
    <Pressable accessibilityRole="button" onPress={() => node.emit("tap")}>
      <Text>{node.property("text").stringValue ?? ""}</Text>
    </Pressable>
  );
}

const registry = createMilanoRegistry();
registry.register("Greeting", Greeting);

const engine = new MilanoEngine({ vocabularyJson: vocabularyText, registry });

const builder = engine
  .viewBuilder(documentText)
  .context({ userName: MilanoValue.string("Ada") })
  .actionHandler((action) => {
    if (action.name === "openUrl") { /* route to your URL opener */ }
    return null;
  });

export function PromoScreen() {
  return <MilanoHost builder={builder} loading={<ActivityIndicator />} failure={() => null} />;
}
```

On the web, the same imports and the same code, with DOM elements in the renderer instead of `Pressable` and `Text`. `MilanoHost` subscribes through `useSyncExternalStore` and tears the view down when it unmounts; keep the builder stable across renders, because a new builder means a new build.

The dispatcher defaults to the platform main thread on the Swift and Kotlin engines (Android's default is `MilanoMainDispatcher()`), so events and view updates serialize on the main thread without configuration; pass a dispatcher only to override the seam. The TypeScript engine inherits JavaScript's single-threaded model and serializes on the host's event loop.

The action handler's return value is the **completion result**. Returning normally completes the action with success; throwing completes it with failure. If the action's declaration includes a `result` type, return the value the document should get back (it binds the `result` expression root inside the action's `onSuccess` list); for every other action, return `nil`/`null`. The [contact form sample](samples) returns a confirmation number from `submitContact`, and the document shows it in the thank-you line, all without host UI code.

Unknown component types **fail the build by default**: a document using a type your vocabulary does not declare throws a typed error instead of rendering incompletely. Optional surfaces (promotional banners and the like) can opt into graceful degradation per engine or per builder with `unknownTypePolicy(.skip)` or `.placeholder`; keep the fail default for any surface whose meaning changes when content is missing.

## What happens at build

`build()` is asynchronous and all-or-nothing. The document is parsed and validated in full: schema, vocabulary conformance, expression type checking, limits. If the document declares `state`, your state data provider is awaited and its values are validated against the declarations. Only a document that passes every check produces a view; anything else throws one typed error. See [Guardrails](guardrails) for the full taxonomy.

## Working samples

The repository contains three complete sample apps, `samples/swiftui` (Tuist project), `samples/compose`, and `samples/react-native` (Expo), demonstrating banners with three layouts, an interstitial, a Milano view embedded between native components, a form with conditional visibility, required markers, and expression-driven errors, a screen that merges app-wide and per-screen context from a live API, a whole user-profile screen, and a catalog of tappable item cards. See them side by side, with screenshots, in [Samples](samples); they follow the architecture described in [Guidelines](guidelines).
