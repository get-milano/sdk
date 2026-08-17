---
title: Guardrails
nav_order: 8
---

# Guardrails

Everything that can go wrong *inside Milano's mechanics* is typed, bounded, and observable. This page maps that failure surface: what fails, when, with which error, and what the engine does instead of failing after a view exists. The guarantee covers what Milano controls: document validation, registry resolution, expression typing and evaluation, dispatch, and reporting. Your own code stays ordinary code: a renderer can crash, an action handler can time out, a remote image can 404, and none of that is prevented, or caused, by Milano.

## Two failure points, two error families

Milano's own mechanics fail fast at exactly two moments, and nowhere else. Consumer code (renderers, handlers, providers) and the network live outside this boundary and fail on their own terms.

**Engine creation** validates the developer's own setup and throws:

| Error | Meaning |
|---|---|
| `InvalidVocabulary` | The vocabulary artifact violates the vocabulary schema |
| `IncompleteRegistry` | A declared component type has no registered renderer, or the policy is `placeholder` with no placeholder renderer; the error names what is missing |

These are programming errors: reachable in development, unreachable in a correctly shipped app.

**Build** validates the document and the injected data, and throws:

| Error | Meaning | Detail carried |
|---|---|---|
| `MalformedDocument` | Not valid JSON, or not a JSON object | Parser message |
| `UnsupportedVersion` | Contract major version not supported | Found version, supported majors |
| `SchemaViolation` | Any structural, typing, or declaration rule broken | Rule, node reference, expected, found |
| `UnknownComponentType` | Unknown `type` under the `fail` policy | Node reference, type name |
| `LimitExceeded` | A resource limit crossed | Which limit, limit value, found value |

State data provider errors are not translated: whatever your provider throws propagates unchanged through `build()`, so your own error types survive the trip.

Building is all-or-nothing: one error, no view, no partial UI.

## Unknown-type policies

Set a default on the engine, override per view on the builder:

- `skip`: drop the node and its subtree, keep siblings, report an occurrence. An unknown root yields a valid empty view. The forward-compatibility choice: old app versions degrade gracefully on new documents.
- `fail`: build throws `UnknownComponentType`. The right choice when partial UI would mislead.
- `placeholder`: route to the placeholder renderer with the raw subtree as data, report an occurrence. Mostly a development aid.

## Limits

Enforced at the gate, adjustable per engine, defaults fixed by the spec:

| Limit | Default |
|---|---|
| Tree depth | 32 |
| Node count | 10,000 |
| Document size | 1 MiB |
| Expression length | 1,024 characters |

## Total runtime

After the gate, the runtime does not fail; it behaves:

- Expression evaluation is total: static typing at the gate removed type errors and null dereferences; int division by zero yields 0 and a report; overflow wraps; `int()` saturates and reports.
- Events dispatch FIFO on the dispatcher; state writes are whole-key and ordered.
- An event emission arriving after teardown is silently ignored: it represents no pending work. An async completion arriving after teardown is ignored too, but reported, because it did.
- Duplicate completions of the same dispatch are guarded and reported; the first outcome wins.
- A success value that does not match the action's declared `result` type (or any value for an action declaring none, or any value on failure) is an invalid completion: consumed, neither branch runs, reported. An ill-typed handler return cannot reach state.
- Enum-typed declarations validate membership at every boundary: a non-member literal (including in a comparison) fails the gate, and a non-member arriving at runtime through a context update, emission, or completion is rejected and reported. A renderer never receives a value outside the declared members.
- Invalid emissions (an undeclared event name, a payload of the wrong type) are dropped and reported, never propagated.

## Threading

Renderers run on the main thread. Events, state writes, and view updates serialize through the `MilanoDispatcher`; the platform default is the main thread on both engines. Engines are immutable and safe to share. Action handlers run asynchronously and may hop threads freely; their completion is funneled back through the dispatcher.

## Observability

Anything the engine tolerates instead of failing is reported as an occurrence to the `MilanoObserver` you optionally pass at engine creation: skipped unknown types, placeholder routings, division-by-zero results, saturations, dropped invalid emissions. Each occurrence carries its kind, the view's identity (your builder `label` makes this readable), and the node reference when there is one.

Occurrences are reported only for views that built successfully; a failed build reports nothing and throws everything. In development, log every occurrence loudly; in production, feed them to your telemetry. An occurrence is a document quality signal: the user saw something reasonable, but a producer should hear about it. User interactions are deliberately not occurrences: product analytics flows through a separate stream ([User interaction analytics](analytics)), so telemetry stays low-volume and defect-shaped.

## What to do with all this

- Wrap `build()` failures per surface: for optional UI (banners), fail to nothing; for essential UI (a form the user came for), fail to a retry affordance by recreating the host.
- The unknown-type policy defaults to `fail`: degradation is a per-surface decision. Opt into `skip` (per builder) only for surfaces whose meaning survives a gap, like promotional banners; keep `fail` wherever missing content changes meaning: forms, consent, checkout, disclosures. Pair `skip` surfaces with occurrence telemetry so producers hear about every dropped node.
- Alert on `SchemaViolation` in production: it means a producer shipped a document your app rejected wholesale.
