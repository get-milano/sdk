---
title: User interaction analytics
nav_order: 11
---

# User interaction analytics

Milano carries a first-class stream of user interactions to your app, built for product analytics: taps, edits, submissions, impressions, focus. It is deliberately separate from `MilanoObserver`, which carries engine observability (defects and diagnostics) and nothing else. The two streams have different consumers, different volumes, and never mix: a defective emission is an occurrence, a valid one is an interaction.

Three properties define the design:

- **Optional from every direction.** Documents declare nothing for analytics, vocabularies declare nothing, and an engine created without an observer captures nothing. Turning analytics on is one constructor argument.
- **Milano is not a tracker.** Records pass through unredacted — event payloads, action parameters, document metadata — because the receiving host already owns the data. What to forward, sample, or drop is your analytics layer's decision, made in one place.
- **Unbound interactions still count.** A tap on an element the document never bound to an action reaches analytics anyway (recorded before the binding lookup), so producers never add dummy bindings just to measure engagement — while `droppedEvent` keeps its defect meaning on the observability stream.

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

Each `MilanoUserInteraction` carries the kind, the view identity (including the builder's `label`, your natural screen/surface dimension), the node reference when anchored to a node, the event or action name when one applies, and a value with the interaction's data.

## What arrives without doing anything else

The runtime captures these on its own; no renderer or document involvement:

| Kind | When | Carries |
|---|---|---|
| `viewBuilt` | A view builds successfully: the impression | The document's `metadata` (campaign tags, experiment ids) as the value |
| `viewTornDown` | Teardown, exactly once | |
| `event` | Every declared emission with a valid payload, bound or not | Event name; the payload as the value |
| `actionDispatched` | A custom action reaches the handler | Action name; the captured parameters as the value; the node whose binding dispatched it |
| `completionSucceeded` / `completionFailed` | A completion settles validly | Action name; the same source node |

That is already a full funnel: impression → tap (`event`) → submission (`actionDispatched`) → outcome (`completionSucceeded`), each anchored to the node it happened on, segmented by view label, attributed by document metadata.

## Widget signals renderers report

For signals the document does not model as events — focus, visibility, selection — renderers call one method that flows straight to the stream and never touches dispatch or state:

```swift
node.userInteraction(.focusGained)
node.userInteraction(.selectionChanged, value: .string("weekly"))
```

The widget kinds are a closed set: `tap`, `doubleTap`, `longPress`, `focusGained`, `focusLost`, `textChanged`, `toggled`, `selectionChanged` (segmented controls, pickers, tabs), `valueChanged` (sliders, steppers), `appeared`, `disappeared`, `scrolled`.

Use them for what dispatch does not see; anything modeled as a document event already arrives as `event`, so a checkbox renderer should *not* also report `toggled` — that would double-count.

The samples wire two worked examples: `LabeledTextField` reports `focusGained` / `focusLost` from its platform focus state on both platforms, and the banner renderers report `appeared` once on first display — banner impressions, for free, on every banner document ever shipped.

## Practical notes

- Records arrive on the dispatcher (main thread) for runtime-captured kinds, and on whatever thread the renderer reports from for widget kinds; hop to your tracker's queue in the sink.
- The stream is high-volume by design; sampling and filtering belong in your sink, not in documents.
- The quick-path `MilanoHost` overload does not take an interaction observer; analytics is a reason to graduate to the shared-engine architecture from [Getting started](getting-started).
- Conformance pins the runtime-captured stream (kinds, ordering, anchoring) in the specs' vector suite, so both engines produce identical records for identical inputs.
