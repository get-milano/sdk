---
title: Creating a bridge
nav_order: 5
---

# Creating a bridge

The bridge is the layer that makes Milano yours: it declares the vocabulary, converts nodes into your models, and wraps your components as renderers. This page builds one, step by step. The complete versions live in `samples/swiftui/Sources/MilanoBridge`, `samples/compose` (`milanobridge` package), and `samples/react-native/src/milano-bridge.tsx`.

## 1. Declare the vocabulary

The vocabulary is a JSON artifact listing every component type and action your app understands, with typed properties and events. It is the contract between your app and everyone producing documents for it.

```json
{
  "milano": "2.0.0",
  "name": "myapp",
  "version": "2.0.0",
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
      "result": "string",
      "failure": { "enum": ["invalidEmail", "unavailable"] }
    }
  },
  "functions": {
    "formatMoney": { "arguments": ["int", "string", "string"], "returns": "string" }
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
- Declare a `failure` type when documents should know why an action failed: usually an enum of reasons the document turns into copy. Your handler fails with a value of that type (below), and the document reads it as `failure` inside `onFailure`. Declare it optional if the handler may also fail with a plain error, since against a non-optional declaration a payload-less failure is an invalid completion. A vocabulary declaring `failure` needs `"milano": "2.1.0"`.
- Declare a `function` for every pure computation documents need from the app: formatting money, dates, plurals, anything that is a value in and a value out. `arguments` is an ordered list of types (at least one), `returns` the value's type. Pass the locale in as an argument (from context) rather than reading it in the handler: functions must be pure over their arguments (see [Host functions](#host-functions)). A vocabulary declaring `functions` needs `"milano": "2.1.0"`. Any identifier is a legal name, a built-in's included: documents call the contract's functions with a `$` (`$round`) and yours by their bare name (`round`), so the two can never collide.

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

`property(_:)` returns a `MilanoValue`; the typed accessors (`stringValue`, `boolValue`, and friends on Swift and TypeScript; `stringOrNull`, `boolOrNull`, and friends on Kotlin) return nil for a different type. Absent optional properties come through as null, so defaulting with `??` (or `?:`) is the normal pattern.

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

And in React, where a renderer is an ordinary component that receives one resolved node:

```tsx
import type { MilanoNodeProps } from "@get-milano/react";

function BannerRenderer({ node }: MilanoNodeProps) {
  if (!(node.property("visible").boolValue ?? true)) return null;
  return (
    <BannerView imageUrl={node.property("backgroundImageUrl").stringValue ?? undefined}>
      {node.children}
    </BannerView>
  );
}

function ButtonRenderer({ node }: MilanoNodeProps) {
  return (
    <PrimaryButton
      label={node.property("label").stringValue ?? ""}
      enabled={node.property("enabled").boolValue ?? true}
      onPress={() => node.emit("tap")}
    />
  );
}
```

`node.children` arrives already materialized and keyed by node reference, so a container places it directly and identity survives re-resolution. Integer properties are `bigint` (`.intValue`); use `.numberValue` where a JavaScript number is what the component wants.

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

```tsx
export function milanoRegistry() {
  // createMilanoRegistry pins the renderer types; a bare
  // `new MilanoRegistry()` infers `unknown` and will not satisfy MilanoHost.
  const registry = createMilanoRegistry();
  registry.register("Banner", BannerRenderer);
  registry.register("Text", TextRenderer);
  registry.register("Button", ButtonRenderer);
  return registry;
}
```

Engine creation verifies the registry covers the whole vocabulary and throws `IncompleteRegistry` naming what is missing, so a gap surfaces at startup, not at render time.

## 6. Placeholders, if you want them

Under the `placeholder` unknown-type policy, unknown component types route to a placeholder renderer, which receives the type name, the node reference, and the raw subtree as data (never as live children). Register it with `registerPlaceholder`; creating an engine with the `placeholder` policy and no placeholder renderer is an `IncompleteRegistry` error.

## 7. Generated typed bindings

The vocabulary is machine-readable, so the bridge does not have to be stringly-typed. `milano bindings` from [`@get-milano/cli`](https://www.npmjs.com/package/@get-milano/cli) turns the artifact into compiler-checked API for Swift, Kotlin, and TypeScript: node wrappers whose accessors carry the gate's guarantees in the type system (a declared non-optional property is a non-optional Swift/Kotlin property, no `?? ""` fallbacks), typed event emitters, an exhaustive action type with an `unrecognized` case for forward compatibility, and a vocabulary identity helper that refuses to run against a mismatched engine.

```sh
npx milano bindings vocabulary.json \
    --swift-prefix Shop  --swift-out  Sources/MilanoBridge/GeneratedBindings.swift \
    --kotlin-package com.acme.shop.milano --kotlin-out app/src/main/kotlin/.../GeneratedBindings.kt \
    --ts-prefix Shop --ts-out src/milano/bindings.ts
```

`--swift-prefix` namespaces the Swift types (`ShopButtonNode`, `ShopAction`) since Swift has no packages; `--kotlin-package` places the Kotlin file, with an optional `--kotlin-prefix` for teams that prefer prefixed class names over import aliases. Output is deterministic: same artifact, same bytes. The command is a port of the specs repository's `tools/generate_bindings.py`, which stays the reference (the SDK's CI compares both byte for byte), so a producer without Node can run the Python instead.

A bridge model then reads `button.label` instead of `node.property("label").stringValue ?? ""`, and the action funnel becomes an exhaustive `switch` over a sealed type: a typo is a compile error, and a vocabulary change turns into a compiler-guided migration instead of a grep.

Enums and records each get one nominal type per declaration site. A record-typed property, event payload, action parameter, or result comes back as a wrapper (`ShopCardPayload`, `ShopOrderCart`) with a typed accessor per field, the declared optionality, and a memberwise constructor for building one to emit or return; a record inside a record, or an array of records, nests the same way (`ShopCardPayloadOwner`, `ShopCartLinesItem`). The wrapper holds the `MilanoValue` it was built from, so nothing is lost for code that wants the raw value.

The TypeScript output is the same idea in the language's own terms: a class per component whose getters return `string`, `bigint`, `boolean` and your enums as string-literal unions (never `string | null` where the vocabulary says non-optional), typed `emitTap()`-style methods, and a discriminated union for actions:

```ts
const button = new ShopButtonNode(node);   // node: the binding's MilanoNode
button.label;                              // string, not string | null
button.emitTap();

switch (shopAction(action).kind) {         // exhaustive: a missing arm is a compile error
  case "openUrl": ...
  case "unrecognized": ...
}
```

The generated file imports only `@get-milano/core` and describes the node structurally, so it works with the React binding and with any other host wrapper.

### As a build step

Commit the generated file and let the build refresh it, so it can never drift from the vocabulary. The four sample apps wire it this way, together with `milano schema` and `milano validate`, so one build step keeps bindings, editor schema, and documents in line. (Inside this repository the samples run the workspace build of the CLI, `cli/dist/bin.js`, after `npm ci && npm run build` at the root; a project of your own runs `npx milano`.)

Gradle (`app/build.gradle.kts`), running before every compile with input/output tracking so it is cached when nothing changed:

```kotlin
val generateMilanoBindings by tasks.registering(Exec::class) {
    inputs.file("src/main/assets/vocabulary.json")
    outputs.file("src/main/kotlin/com/acme/shop/milano/GeneratedBindings.kt")
    commandLine(
        "npx", "milano", "bindings", "src/main/assets/vocabulary.json",
        "--kotlin-package", "com.acme.shop.milano",
        "--kotlin-out", "src/main/kotlin/com/acme/shop/milano/GeneratedBindings.kt",
    )
}

tasks.named("preBuild") { dependsOn(generateMilanoBindings) }
```

npm, as part of the typecheck, which is how `samples/react-native` wires it:

```json
{
  "scripts": {
    "bindings": "milano bindings documents/vocabulary.json --ts-prefix Shop --ts-out src/milano/bindings.ts",
    "typecheck": "npm run bindings && tsc --noEmit"
  }
}
```

Xcode, as a pre-build script phase (via Tuist's `scripts: [.pre(...)]`, or Build Phases in a plain project; script sandboxing must be off for phases that write into the source tree: `ENABLE_USER_SCRIPT_SANDBOXING = NO`):

```sh
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"   # Xcode's PATH has no Node
npx milano bindings "$SRCROOT/Resources/vocabulary.json" \
    --swift-prefix Shop \
    --swift-out "$SRCROOT/Sources/MilanoBridge/GeneratedBindings.swift"
```

For CI honesty, add a check that the committed file matches the vocabulary: regenerate and `git diff --exit-code`. This repository does exactly that for the React Native sample, which doubles as the emitter's test: the generated file is compiled by the sample's own typecheck, so a generator that emits something uncompilable fails CI rather than reaching you.

## Granting capabilities per surface

The vocabulary is the app's full catalogue of actions and functions. A
builder can narrow it, or add to it, for one surface only, which is what
makes the declarations a capability manifest rather than a global API:

```swift
let builder = try engine.viewBuilder(document: text)
    // This surface may dispatch nothing but these two, whatever the
    // document asks for; anything else fails the build.
    .allowActions(["openUrl", "dismiss"])
    // Declared here, not in the vocabulary: an action only this screen has.
    .action("rateApp", parameters: ["stars": MilanoType(.int)])
    // The same name, a different shape, on this surface alone.
    .action("share", parameters: ["url": MilanoType(.string), "campaign": MilanoType(.string)])
    // A function this screen needs and the rest of the app does not.
    .function("formatDistance", arguments: [MilanoType(.double)], returns: MilanoType(.string))
```

```kotlin
val builder = engine.viewBuilder(text)
    .allowActions(listOf("openUrl", "dismiss"))
    .action("rateApp", parameters = mapOf("stars" to MilanoType(MilanoType.Kind.Int)))
    .function(
        "formatDistance",
        listOf(MilanoType(MilanoType.Kind.Double)),
        MilanoType(MilanoType.Kind.Text),
    )
```

```ts
const builder = engine
  .viewBuilder(text)
  .allowActions(["openUrl", "dismiss"])
  .action("rateApp", { parameters: { stars: MilanoType.int() } })
  .function("formatDistance", { arguments: [MilanoType.double()], returns: MilanoType.string() });
```

- **The allowlist narrows.** With one installed, a document binding any
  action outside it fails the build with `action-capability` naming the
  action. Built-in actions (`$set`, `$when`, the array actions) are
  contract, not capabilities, and are always available. A builder that
  calls nothing grants the whole vocabulary.
- **Declarations add or override.** A name absent from the vocabulary
  becomes available on this surface; a name already there takes the new
  shape here only. That is how one action name means "share a product" on
  one screen and "share a receipt" on another, each typed for its own
  parameters, with one handler per surface interpreting it.
- **Functions work the same way**, minus the allowlist: a function is a
  computation, not a capability, so there is nothing to revoke. The
  engine's single function handler answers whatever any surface declares.
- **Why bother.** A document is untrusted input. The gate can prove an
  action was granted and that its parameters have the declared types; the
  allowlist is how a surface says which of the app's powers a document may
  reach at all, so a promotional banner cannot dispatch `deleteAccount`
  even if someone writes a document that tries.

## The action funnel

The handler receives a `MilanoAction`: the name, the captured parameters, the view identity, and the dispatch identity, `dispatch` (the position among the view's dispatches, from zero) and `dispatchId` (unique across every dispatch of every view in the process). Send `dispatchId` with the request the handler makes; a retry carrying the same id is recognizably the same dispatch to a backend that dedupes.

Success is a normal return, whose value is the declared `result` (or `nil`/`null`). Failure is a throw. To fail with the declared `failure` payload, throw the SDK's failure type with the value; any other error is a failure with no payload:

```swift
case .submitContact(let email, _, _, _):
    guard email.contains("@") else {
        throw MilanoActionFailure(.string(ShopSubmitContactFailure.invalidEmail.rawValue))
    }
```

```kotlin
is ShopAction.SubmitContact -> {
    if (!decoded.email.contains("@")) {
        throw MilanoActionFailure(MilanoValue.StringValue(SubmitContactFailure.InvalidEmail.value))
    }
}
```

```ts
case "submitContact":
  if (!email.includes("@")) throw new MilanoActionFailure(MilanoValue.string("invalidEmail"));
```

The generated bindings give each enum or record failure site a nominal type, so the value is spelled from the declaration rather than typed by hand.

## Lifecycle signals

`MilanoHost` delivers `appear` and `disappear` to the view from the toolkit's own callbacks (`onAppear`/`onDisappear` on SwiftUI, a `DisposableEffect` on Compose, an effect on React), so a document's lifecycle bindings need nothing from the bridge. A host that awaits `build()` and places the view itself calls `view.appear()` when it comes on screen and `view.disappear()` when it leaves; both are idempotent in the sense the spec fixes (a redundant signal is ignored), so wiring them to a screen's own lifecycle callbacks is safe.

## Host functions

Formatting is the usual reason to want one: money, dates, plurals, units. The rules are locale matters that do not belong in a document, and Milano will not guess them, so the app computes them and documents call in. Three steps.

**Declare it in the vocabulary**, with its argument types in order and what it returns:

```json
"functions": {
  "formatMoney": { "arguments": ["int", "string", "string"], "returns": "string" }
}
```

**Install one handler on the engine.** It answers every declared function by name, for every view that engine builds. It receives a `MilanoFunctionCall` (`name`, and `arguments` in declared order, each already of its declared type) and returns a `MilanoValue`, which the runtime validates against the declared `returns`:

```swift
let engine = try MilanoEngine(
    vocabularyJson: vocabulary,
    registry: MilanoBridge.registry(),
    functionHandler: MilanoClosureFunctionHandler { call in
        switch call.name {
        case "formatMoney":
            let formatter = NumberFormatter()
            formatter.numberStyle = .currency
            formatter.currencyCode = call.arguments[1].stringValue ?? "EUR"
            formatter.locale = Locale(identifier: call.arguments[2].stringValue ?? "en")
            let amount = Decimal(call.arguments[0].intValue ?? 0) / 100
            return .string(formatter.string(from: amount as NSDecimalNumber) ?? "")
        default:
            return .null
        }
    }
)
```

```kotlin
val engine = MilanoEngine(vocabulary, registry, functionHandler = MilanoFunctionHandler { call ->
    when (call.name) {
        "formatMoney" -> MilanoValue.StringValue(
            NumberFormat.getCurrencyInstance(Locale.forLanguageTag(call.arguments[2].stringOrNull ?: "en"))
                .apply { currency = Currency.getInstance(call.arguments[1].stringOrNull ?: "EUR") }
                .format((call.arguments[0].longOrNull ?: 0L) / 100.0),
        )
        else -> MilanoValue.Null
    }
})
```

```ts
const engine = new MilanoEngine({
  vocabularyJson: vocabulary,
  registry,
  functionHandler: (call) => {
    if (call.name === "formatMoney") {
      const [cents, currency, locale] = call.arguments;
      return MilanoValue.string(
        new Intl.NumberFormat(locale.stringValue ?? "en", { style: "currency", currency: currency.stringValue ?? "EUR" })
          .format(Number(cents.intValue ?? 0n) / 100),
      );
    }
    return MilanoValue.null;
  },
});
```

**Call it from a document** by its bare name, wherever an expression goes:

```json
{ "$expr": "$concat('Total: ', formatMoney(state.cents, 'EUR', context.locale))" }
```

The gate checks the call against the declaration, so a wrong argument count or type fails the build, not the screen. The contract's own functions carry a `$` (`$concat` here), so your names never collide with them: a vocabulary may declare `round` beside `$round`.

Three rules worth keeping in mind. The handler runs on the main thread during resolution, so it must be fast and must not block or touch the view. A thrown error or a value of the wrong type is an invalid function result, reported as `invalidFunctionResult` and replaced by the zero value of the return type, so a bug in it degrades one label rather than a screen. And a function must be pure over its arguments, which is why the locale above is passed in from context rather than read inside the handler: the engine may call it whenever a dependency changes, and a value that drifts on its own would go stale silently.

A builder may add a function for its surface with `function(name, arguments:, returns:)`; the same handler answers it. A document calling a declared function on an engine created without a handler fails at build (`function-handler`). While a producer is still writing documents there is no app to ask, so `milano validate` answers every declared function with the zero value of its return type: the call is fully type-checked, and only the formatting is missing (see [Producing documents](producing#the-loop)).

## Replacing a document

A view is bound to one document at a time, but not for its lifetime: `view.replace(document)` (contract 2.1) runs the new document through the same gate under the same builder configuration, keeps every state key whose declaration is unchanged, asks the state data provider for the rest (once, with exactly those keys), and swaps. It throws what `build()` throws, and on a throw the view is exactly as it was: same document, same state, still serviceable. Identity, dispatch numbering, and the appeared state persist; completions of dispatches made before the swap are dropped and reported. Hot reload in development, a document refreshed from the network, and a preview editor all use it instead of tearing down and rebuilding, which would lose what the user typed:

```swift
try await view.replace(document: freshDocumentText)
```

```kotlin
view.replace(freshDocumentText)
```

```ts
await view.replace(freshDocumentText);
```

## Driving a view yourself

`MilanoHost` builds the view, places it, delivers the lifecycle signals,
and tears it down. A host that would rather own that (a custom container,
a screen that decides placement, a test) awaits `build()` and takes on
four small jobs, and gets four read-only windows in return:

| Member | What it is for |
|---|---|
| `appear()` / `disappear()` | Tell the view it is on screen, so its lifecycle bindings run and `viewAppeared` is recorded. Nobody else will |
| `subscribe(listener)` | Called after every re-resolution; returns a cancellation. This is how a host knows to redraw. The React binding subscribes for you, and the SwiftUI and Compose views observe internally, so you need this only when you render the tree yourself |
| `teardown()` | The view stops participating: late completions are dropped and reported, and the context subscription is cancelled |
| `resolvedRoot` | The current tree, a new object identity after each change, which is what a host renders |
| `state`, `context`, `metadata` | Copies of what the view holds right now: useful for diagnostics, never a way to write. `$set` is the only writer |
| `dispatched` | The custom actions this view has dispatched, in order, as plain data. A test seam and a debugging aid; production code reacts in the action handler, not here |

```ts
const view = await builder.build();
const stop = view.subscribe(() => render(view.resolvedRoot));
view.appear();
// ...later
view.disappear();
stop();
view.teardown();
```

Nothing here is required to ship: if you use `MilanoHost`, it makes these
calls at the right moments and you can ignore the whole table.

## Growing the vocabulary

Adding a component type, an action, a parameter, a `result`, a `failure`, or a function is additive: extend the artifact, add the renderer or the handler arm, register it. Old documents ignore new types. Removing or retyping is breaking for documents that use it, so treat the vocabulary like the API it is: version it, and prefer additions. `npx milano diff old.json new.json` classifies every change and fails when the version bump does not match (additive changes need a minor bump, breaking ones a major), so publication can be gated on it in CI.
