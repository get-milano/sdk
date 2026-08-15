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
  "milano": "0.1.0",
  "name": "myapp",
  "version": "0.1.0",
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
    "openUrl": { "parameters": { "url": "string" } }
  }
}
```

Rules of thumb:

- Name properties for meaning (`backgroundImageUrl`), not for appearance (`blueHeader`). Appearance belongs to your renderers.
- Give an event a payload type only when the interaction produces a value (`"change": "string"` for a text field); use `null` for plain triggers.
- Declare shared actions here. Actions used by a single document can be declared inside that document instead; a local declaration colliding with a global name is rejected at the gate.

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
            backgroundImageUrl: node.property("backgroundImageUrl").stringValue.flatMap(URL.init),
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
            node.children.forEach { it.Render() }
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

## Growing the vocabulary

Adding a component type or action is additive: extend the artifact, add the renderer, register it. Old documents ignore new types. Removing or retyping is breaking for documents that use it, so treat the vocabulary like the API it is: version it, and prefer additions.
