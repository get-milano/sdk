---
title: Creating a bridge
nav_order: 5
---

# Creating a bridge

The bridge is the layer that makes Milano yours: it declares the vocabulary, converts nodes into your models, and wraps your components as renderers. This page builds one, step by step. The complete versions live in `samples/swiftui/Sources/MilanoBridge` and `samples/compose` (`milanobridge` package).

## 1. Declare the vocabulary

The vocabulary is a JSON artifact listing every component type and action your app understands, with typed properties and events. It is the contract between your app and everyone producing documents for it.

```json
{
  "milano": "1.0.0",
  "name": "myapp",
  "version": "1.0.0",
  "components": {
    "Banner": {
      "properties": { "backgroundImageUrl": "string", "visible": "bool" },
      "children": true
    },
    "Text": { "properties": { "text": "string" } },
    "Button": {
      "properties": { "label": "string", "enabled": "bool" },
      "events": { "tap": null }
    }
  },
  "actions": {
    "openUrl": { "parameters": { "url": "string" } },
    "submitContact": {
      "parameters": { "email": "string" },
      "result": "string"
    }
  }
}
```

Rules of thumb:

- Name properties for meaning (`backgroundImageUrl`), not for appearance (`blueHeader`). Appearance belongs to your renderers.
- Declare a variant-valued property as an enum, never as a free string: `"layout": {"enum": ["overlay", "card", "strip"], "optional": true}`. The gate then rejects non-members at validation time, and the bindings generator gives your renderer an exhaustive `switch`/`when` instead of string matching with a silent `default`. The sample vocabulary's `Banner.layout`, `Banner.contentAlignment`, and `Text.role` are all enums.
- Give an event a payload type only when the interaction produces a value (`"change": "string"` for a text field); use `null` for plain triggers.
- Declare shared actions here. Documents never declare actions; a surface that needs an extra action, or the same name with a different shape, declares it on its builder (`.action(name, parameters:, result:)`).
- Declare optional accessibility properties (a label, a decorative flag, a live-region politeness) alongside the visual ones, and map them in your renderers; see [Accessibility](accessibility) for the pattern and the sample's worked set.
- Declare a `result` type when the handler answers with a value documents need back: a confirmation number, a created id, a server-assigned URL. Your handler returns that value on success, and the document reads it as `result` inside `onSuccess`. Actions without a `result` complete as plain signals; the handler returns `nil`/`null`.

## 2. Keep the design system pure

The component itself takes a plain model and closures, and knows nothing about Milano:

```swift
struct BannerModel {
    let backgroundImageUrl: URL?
    let isVisible: Bool
}

struct BannerView<Content: View>: View {
    let model: BannerModel
    @ViewBuilder let content: () -> Content
    // layout and styling only
}
```

## 3. Convert nodes with model initializers

Conversion lives in the bridge, as an initializer per model:

```swift
import MilanoSDK

extension BannerModel {
    init(node: MilanoNode) {
        self.init(
            backgroundImageUrl: node.property("backgroundImageUrl").stringValue.flatMap(URL.init(string:)),
            isVisible: node.property("visible").boolValue ?? true
        )
    }
}
```

`property(_:)` returns a `MilanoValue`; the typed accessors (`stringValue`, `boolValue`, and friends on Swift; `stringOrNull`, `boolOrNull`, and friends on Kotlin) return nil for a different type. Absent optional properties come through as null, so defaulting with `??` (or `?:`) is the normal pattern.

## 4. Wrap components as renderers

A renderer converts and delegates. Children arrive as ready-to-place views with stable identities:

```swift
final class BannerRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        let model = BannerModel(node: node)
        guard model.isVisible else { return AnyView(EmptyView()) }
        return AnyView(BannerView(model: model) {
            ForEach(node.children) { $0 }
        })
    }
}
```

Interactions go back through `emit`. The payload must match the event's declared type:

```swift
final class ButtonRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        AnyView(PrimaryButton(
            label: node.property("label").stringValue ?? "",
            enabled: node.property("enabled").boolValue ?? true,
            onTap: { node.emit("tap") }
        ))
    }
}
```

The same shape in Compose, where a renderer is a `@Composable` function on an interface:

```kotlin
class BannerRenderer : MilanoRenderer {
    @Composable
    override fun Render(node: MilanoNode) {
        val model = bannerModel(node)
        if (!model.isVisible) return
        BannerView(model) {
            node.children.forEach { key(it.key) { it.Render() } }
        }
    }
}
```

Renderers are invoked on the main thread, and re-invoked when state or context changes; keep them cheap and free of side effects.

## 5. Expose one registry factory

```swift
enum MilanoBridge {
    static func registry() -> MilanoRegistry {
        var registry = MilanoRegistry()
        registry.register(BannerRenderer(), for: "Banner")
        registry.register(TextRenderer(), for: "Text")
        registry.register(ButtonRenderer(), for: "Button")
        return registry
    }
}
```

```kotlin
fun milanoRegistry(): MilanoRegistry =
    MilanoRegistry().apply {
        register("Banner", BannerRenderer())
        register("Text", TextRenderer())
        register("Button", ButtonRenderer())
    }
```

Engine creation verifies the registry covers the whole vocabulary and throws `IncompleteRegistry` naming what is missing, so a gap surfaces at startup, not at render time.

## 6. Placeholders, if you want them

Under the `placeholder` unknown-type policy, unknown component types route to a placeholder renderer, which receives the type name, the node reference, and the raw subtree as data (never as live children). Register it with `registerPlaceholder`; creating an engine with the `placeholder` policy and no placeholder renderer is an `IncompleteRegistry` error.

## 7. Generated typed bindings

The vocabulary is machine-readable, so the bridge does not have to be stringly-typed. `tools/generate_bindings.py` in the [specs repository](https://github.com/get-milano/specs) turns the artifact into compiler-checked API for both platforms: node wrappers whose accessors carry the gate's guarantees in the type system (a declared non-optional property is a non-optional Swift/Kotlin property, no `?? ""` fallbacks), typed event emitters, an exhaustive action type with an `unrecognized` case for forward compatibility, and a vocabulary identity helper that refuses to run against a mismatched engine.

```sh
python3 tools/generate_bindings.py vocabulary.json \
    --swift-prefix Shop  --swift-out  Sources/MilanoBridge/GeneratedBindings.swift \
    --kotlin-package com.acme.shop.milano --kotlin-out app/src/main/kotlin/.../GeneratedBindings.kt
```

`--swift-prefix` namespaces the Swift types (`ShopButtonNode`, `ShopAction`) since Swift has no packages; `--kotlin-package` places the Kotlin file, with an optional `--kotlin-prefix` for teams that prefer prefixed class names over import aliases. Output is deterministic: same artifact, same bytes.

A bridge model then reads `button.label` instead of `node.property("label").stringValue ?? ""`, and the action funnel becomes an exhaustive `switch` over a sealed type: a typo is a compile error, and a vocabulary change turns into a compiler-guided migration instead of a grep.

### As a build step

Commit the generated file and let the build refresh it, so it can never drift from the vocabulary. Both sample apps wire it this way (the samples resolve the specs checkout at `../../../specs` because of the repository layout; adjust the path to where your checkout lives).

Gradle (`app/build.gradle.kts`), running before every compile with input/output tracking so it is cached when nothing changed:

```kotlin
val generateMilanoBindings by tasks.registering(Exec::class) {
    val specsDir = System.getenv("MILANO_SPECS_DIR") ?: rootDir.resolve("../specs").canonicalPath
    inputs.file("src/main/assets/vocabulary.json")
    inputs.file("$specsDir/tools/generate_bindings.py")
    outputs.file("src/main/kotlin/com/acme/shop/milano/GeneratedBindings.kt")
    commandLine(
        "python3", "$specsDir/tools/generate_bindings.py", "src/main/assets/vocabulary.json",
        "--kotlin-package", "com.acme.shop.milano",
        "--kotlin-out", "src/main/kotlin/com/acme/shop/milano/GeneratedBindings.kt",
    )
}

tasks.named("preBuild") { dependsOn(generateMilanoBindings) }
```

Xcode, as a pre-build script phase (via Tuist's `scripts: [.pre(...)]`, or Build Phases in a plain project; script sandboxing must be off for phases that write into the source tree: `ENABLE_USER_SCRIPT_SANDBOXING = NO`):

```sh
SPECS_DIR="${MILANO_SPECS_DIR:-$SRCROOT/../specs}"
python3 "$SPECS_DIR/tools/generate_bindings.py" "$SRCROOT/Resources/vocabulary.json" \
    --swift-prefix Shop \
    --swift-out "$SRCROOT/Sources/MilanoBridge/GeneratedBindings.swift"
```

For CI honesty, add a check that the committed file matches the vocabulary: regenerate and `git diff --exit-code`.

## Growing the vocabulary

Adding a component type or action is additive: extend the artifact, add the renderer, register it. Old documents ignore new types. Removing or retyping is breaking for documents that use it, so treat the vocabulary like the API it is: version it, and prefer additions.
