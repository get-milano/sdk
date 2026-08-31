---
title: User interaction analytics
nav_order: 12
---

# User interaction analytics

Milano carries a first-class stream of user interactions to your app, built for product analytics: taps, edits, submissions, impressions, focus. It is deliberately separate from `MilanoObserver`, which carries engine observability (defects and diagnostics) and nothing else. The two streams have different consumers, different volumes, and never mix: a defective emission is an occurrence, a valid one is an interaction.

Three properties define the design:

- **Optional from every direction.** Documents declare nothing for analytics, vocabularies declare nothing, and an engine created without an observer captures nothing. Turning analytics on is one constructor argument.
- **Milano is not a tracker.** Records pass through unredacted (event payloads, action parameters, document metadata) because the receiving host already owns the data. What to forward, sample, or drop is your analytics layer's decision, made in one place.
- **Unbound interactions still count.** A tap on an element the document never bound to an action reaches analytics anyway (recorded before the binding lookup), so producers never add dummy bindings just to measure engagement, while `droppedEvent` keeps its defect meaning on the observability stream.

## Wiring it up

```swift
final class Analytics: MilanoUserInteractionObserver {
    func interaction(_ interaction: MilanoUserInteraction) {
        tracker.log(interaction.kind.rawValue, [
            "view": interaction.viewIdentity,
            "node": interaction.node ?? "",
            "name": interaction.name ?? ""
        ])
    }
}

let engine = try MilanoEngine(
    vocabularyJSON: data, registry: registry,
    userInteractionObserver: Analytics())
```

```kotlin
val engine = MilanoEngine(
    vocabularyJson = json,
    registry = registry,
    userInteractionObserver = { interaction ->
        tracker.log(interaction.kind.name, mapOf(
            "view" to interaction.viewIdentity,
            "node" to (interaction.node ?: ""),
            "name" to (interaction.name ?: "")))
    },
)
```

```ts
const engine = new MilanoEngine({
  vocabularyJson,
  registry,
  userInteractionObserver: {
    interaction(interaction) {
      tracker.log(interaction.kind, {
        view: interaction.viewIdentity,
        node: interaction.node ?? "",
        name: interaction.name ?? "",
      });
    },
  },
});
```

Each `MilanoUserInteraction` carries the kind, the view identity (including the builder's `label`, your natural screen/surface dimension), the node reference when anchored to a node, the event or action name when one applies, and a value with the interaction's data.

## What arrives without doing anything else

The runtime captures these on its own; no renderer or document involvement:

| Kind | When | Carries |
|---|---|---|
| `viewBuilt` | A view builds successfully | The document's `metadata` (campaign tags, experiment ids) as the value |
| `viewReplaced` | A document replacement lands | The new document's `metadata` as the value |
| `viewAppeared` / `viewDisappeared` | The host's lifecycle signal is accepted: the view came on screen, or left it. `viewAppeared` is the impression; a built view may never reach the screen | |
| `viewTornDown` | Teardown, exactly once | |
| `event` | Every declared emission with a valid payload, bound or not | Event name; the payload as the value |
| `actionDispatched` | A custom action reaches the handler | Action name; the captured parameters as the value; the node whose binding dispatched it (none for a lifecycle or watch binding); the `dispatch` number the action carries |
| `completionSucceeded` / `completionFailed` | A completion settles validly | Action name; the same source node; the same `dispatch` number; the validated result or failure payload as the value (null when the action declares none) |

That is already a full funnel: impression (`viewAppeared`) → tap (`event`) → submission (`actionDispatched`) → outcome (`completionSucceeded`, joined to its dispatch by the `dispatch` number), each anchored to the node it happened on, segmented by view label, attributed by document metadata. `dispatch` is the position of the dispatch among the view's, counting from zero; `MilanoAction.dispatchId` is the process-unique key a handler uses toward its backend, so a record and a request can be joined too.

## Which item in a list was it

Every record about a node inside a `$repeat` names the instance, not the
template: `tile[2]` for the third element, or `tile[settings]` when the
repeat carries a `key`. So a tap on a list already arrives distinguishable
from its siblings, with no work in the document.

Which of the two you get is worth knowing, because they answer different
questions. Without a `key` the reference carries the **position**; with a
`key` it carries the **identity**, the one that survives a reorder or a
removal. A keyed list therefore does not report position anywhere by
itself.

When you want the position from a keyed list, pass it as a parameter: the
template binds `<as>_index` to the element's index at dispatch time, so
the document says which slot was tapped and the record carries both.

```json
{ "action": "track", "event": "tapped", "position": { "$expr": "tile_index" } }
```

The samples' quick actions strip does exactly this, and the [worked
examples](https://get-milano.dev/specs/examples.html#quick-actions) walk the
whole document.

## Widget signals renderers report

For signals the document does not model as events (focus, visibility, selection), renderers call one method that flows straight to the stream and never touches dispatch or state:

```swift
node.userInteraction(.focusGained)
node.userInteraction(.selectionChanged, value: .string("weekly"))
```

```tsx
node.userInteraction("focusGained");
node.userInteraction("selectionChanged", MilanoValue.string("weekly"));
```

The widget kinds are a closed set: `tap`, `doubleTap`, `longPress`, `focusGained`, `focusLost`, `textChanged`, `toggled`, `selectionChanged` (segmented controls, pickers, tabs), `valueChanged` (sliders, steppers), `appeared`, `disappeared`, `scrolled`.

Use them for what dispatch does not see; anything modeled as a document event already arrives as `event`, so a checkbox renderer should *not* also report `toggled`: that would double-count.

The samples wire two worked examples: `LabeledTextField` reports `focusGained` / `focusLost` from its platform focus state on every platform, and the banner renderers report `appeared` once on first display for the banner node itself; the view-level impression needs nothing from a renderer, since `viewAppeared` is runtime-captured.

Records pass everything through: with a failure payload declared as a record carrying account details, that record is in the `completionFailed` value. Redact in the sink, where the host already decides what its tracker keeps.

## Practical notes

- Records arrive on the dispatcher (main thread) for runtime-captured kinds, and on whatever thread the renderer reports from for widget kinds; hop to your tracker's queue in the sink. In TypeScript everything arrives on the host's event loop.
- In React, the node object a renderer receives is fresh after every re-resolution. Key an impression effect on `node.reference`, not on the node itself, or an impression is reported on every state change; the React Native sample's banner renderer shows the pattern.
- The stream is high-volume by design; sampling and filtering belong in your sink, not in documents.
- The quick-path `MilanoHost` overload does not take an interaction observer on Swift and Kotlin (`MilanoQuickHost` does, in React); analytics is a reason to graduate to the shared-engine architecture from [Getting started](getting-started).
- Conformance pins the runtime-captured stream (kinds, ordering, anchoring) in the specs' vector suite, so every engine produces identical records for identical inputs.
