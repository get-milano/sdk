---
title: Guardrails
nav_order: 9
---

# Guardrails

Everything that can go wrong *inside Milano's mechanics* is typed, bounded, and observable. This page maps that failure surface: what fails, when, with which error, and what the engine does instead of failing after a view exists. The guarantee covers what Milano controls: document validation, registry resolution, expression typing and evaluation, dispatch, and reporting. Your own code stays ordinary code: a renderer can crash, an action handler can time out, a remote image can 404, and none of that is prevented, or caused, by Milano.

## Two failure points, two error families

Milano's own mechanics fail fast at exactly two moments, and nowhere else. Consumer code (renderers, handlers, providers) and the network live outside this boundary and fail on their own terms.

**Engine creation** validates the developer's own setup and throws:

| Error | Meaning |
|---|---|
| `InvalidVocabulary` | The vocabulary artifact violates the vocabulary schema, or declares a feature its `milano` version does not have (a `failure` payload below 2.1: rule `contract-feature`) |
| `IncompleteRegistry` | A declared component type has no registered renderer, or the policy is `placeholder` with no placeholder renderer; the error names what is missing |

These are programming errors: reachable in development, unreachable in a correctly shipped app.

**Build** validates the document and the injected data, and throws:

| Error | Meaning | Detail carried |
|---|---|---|
| `MalformedDocument` | Not valid JSON, or not a JSON object | Parser message |
| `UnsupportedVersion` | Declared version above what the engine implements, by major or by minor | Declared version; supported ranges as `major.minor` (`"1.0"`, `"2.1"`) |
| `SchemaViolation` | Any structural, typing, or declaration rule broken | Rule, node reference, expected, found |
| `UnknownComponentType` | Unknown `type` under the `fail` policy | Node reference, type name |
| `LimitExceeded` | A resource limit crossed | Which limit, limit value, found value |

State data provider errors are not translated: whatever your provider throws propagates unchanged through `build()`, so your own error types survive the trip.

Building is all-or-nothing: one error, no view, no partial UI.

## The rules behind SchemaViolation

The `rule` strings a `SchemaViolation` may carry are contract, pinned by the conformance suite, and so is the detail each carries (an absent cell is `null`):

| Rule | Violation | `node` | `expected` | `found` |
|---|---|---|---|---|
| `construct` | A node `type` begins with the reserved `$` prefix and names no construct the document's contract version admits | the node | `component type` | the type name |
| `contract-feature` | The document uses a feature (a construct key, a document section, an expression root, a function, a host function, a built-in action) that a later minor of its declared major introduced | the node, when the feature sits in one | the `major.minor` that introduced the feature (`2.1`) | the feature's name as a document spells it (`key`, `on`, `watch`, `failure`, `$abs`, `$append`, a declared function's bare name, ...) |
| `repeat` | A `$repeat` violates its encoding: at the root, carrying properties or bindings, without a template, `items` missing, a literal, or not a non-optional array, `as` missing, reserved, or shadowing an enclosing binding, `key` a literal or of the wrong type, or two elements rendering the same key | the node | the requirement: `child position`, `items expression`, `array items`, `template`, `binding identifier`, `distinct binding`, `key expression`, `key type`, `distinct key` | what was found |
| `conditional` | An `$if` violates its encoding: at the root, carrying `properties`, `on`, or `id`, an undeclared key, a missing or non-expression `condition`, a branch that is not a non-empty node list, or a `condition` that is not a non-optional `bool` | the node | the requirement: `not the root`, `no properties`, `no on`, `no id`, `declared key`, `condition expression`, `then branch`, `else branch`, `bool condition` | what was found |
| `switch` | A `$switch` violates its encoding: at the root, carrying `properties`, `on`, or `id`, an undeclared key, a missing or non-expression `subject`, no `cases`, a case naming a non-member, a branch that is not a non-empty node list, a `subject` that is not a non-optional `enum`, or a member that neither a case nor a `default` covers | the node | the requirement: `not the root`, `no properties`, `no on`, `no id`, `declared key`, `subject expression`, `cases`, `enum subject`, `declared member`, `case branch`, `default branch`, `every member or a default` | what was found |
| `id-uniqueness` | A node `id` appears more than once in the document | the repeated id | | the id |
| `children` | A node carries `children` but its component type does not accept them | the node | `no children` | `children` |
| `undeclared-property` | An undeclared property on a `strict` component type | the node | | the property name |
| `property-type` | A literal property value does not match the declared type | the node | the declared type, or `enum member` | the literal's kind, or the non-member string |
| `event-binding` | A node's `on` entry names an event the component type does not declare, or the document's `on` entry names a signal that is not `appear` or `disappear` | the node; none for the document's | `declared event`, or `lifecycle event` | the event or signal name |
| `expression` | An expression fails to parse or type-check against the expected type | the node; none in a lifecycle or watch list | the type the position expects | |
| `action-encoding` | A built-in or custom action violates its encoding: unknown or missing parameters, ill-typed values, an undeclared or unsuitable target of `$set`, `$append`, `$remove`, or `$update` | the node; none in a lifecycle or watch list | `declared state key`, `array state key`, `record element`, `declared field`, `declared parameter`, or the name of the missing required parameter | the undeclared key, field, or parameter; none for a missing one |
| `action-capability` | A custom action outside the surface's granted set | the node | `granted action` | the action name |
| `vocabulary-requirement` | The document's declared vocabulary requirement is not met by the engine's vocabulary | | the required name, or `>=` the required minimum | the held name or version |
| `context-declaration` | A context declaration is malformed (non-identifier key, invalid descriptor) or a supplied context value does not match it | | `identifier`, the missing key, or the declared type | the malformed key, or the value's kind |
| `state-declaration` | A state declaration is malformed (non-identifier key, invalid descriptor), a provided state value does not match it, or the document declares state and the surface configured no state data provider | | `identifier`, the declared type, or `state data provider` | the malformed key, or the value's kind (`null` when the provider omitted a required value) |
| `watch` | A `watch` entry names a key the document's `state` section does not declare | | `declared state key` | the key |
| `action-handler` | The document binds custom actions and the surface configured no action handler (raised by the builder at build, before dispatch exists) | | `action handler` | |
| `function-handler` | The document calls host functions and the engine configured no function handler (raised at build, before any evaluation) | | `function handler` | |

## Unknown-type policies

Set a default on the engine, override per view on the builder:

- `skip`: drop the node and its subtree, keep siblings, report an occurrence. An unknown root yields a valid empty view. The forward-compatibility choice: old app versions degrade gracefully on new documents.
- `fail`: build throws `UnknownComponentType`. The right choice when partial UI would mislead.
- `placeholder`: route to the placeholder renderer with the raw subtree as data, report an occurrence. Mostly a development aid.

## Limits

Adjustable per engine (`MilanoLimits`), defaults fixed by the spec:

| Limit | Default | Where |
|---|---|---|
| Tree depth | 32 | Gate |
| Node count | 10,000 | Gate |
| Document size | 1 MiB | Gate |
| Expression length | 1,024 Unicode scalars | Gate |
| Value size | 65,536 | Gate and runtime |

The first four bound the document, which the gate fixes for the view's lifetime. Values are not fixed at the gate, so the value size limit applies wherever a value enters state or context: initial context and state values (`LimitExceeded` at the gate), every context update (rejected whole, reported as `rejectedContextUpdate` naming the key, the limit, and the size found), and every `$set` (nothing assigned, reported as `rejectedMutation` anchored to the dispatching node, and the action list ends there: later actions of that dispatch do not run, earlier mutations stay). Without it, `$set s = $concat(state.s, state.s)` doubles a string per tap. A value's size is one for a scalar or null, one per Unicode scalar for a string, and one plus the contents for an array or a record (`MilanoValue.size`); event payloads and completion results are not bounded, since whatever a document keeps from them passes through `$set`.

Expression length and string sizes are counted in Unicode scalars, never UTF-16 code units or grapheme clusters: an emoji is one, whatever JavaScript's `string.length` or Swift's `count` says. The conformance suite pins every limit's boundary at a configured value.

## Total runtime

After the gate, the runtime does not fail; it behaves:

- Expression evaluation is total: static typing at the gate removed type errors and null dereferences; int division by zero yields 0 and a report; overflow wraps; `$int()` saturates and reports.
- Events dispatch FIFO on the dispatcher; state writes are whole-key and ordered. The array actions (`$append`, `$remove`, `$update`) produce a whole new array and go through exactly the `$set` path: same limits, same distinct-key rule, same no-change rule. An index outside the array is a rejected mutation (`expected` `index in range`, `found` the index) that assigns nothing and ends the action list.
- A watch list runs as part of the mutation that changed its key, before the next action of the list that applied it. Mutations made inside a watch list never trigger a watch, so there is no cascade and no loop to guard against; a rejection inside a watch list ends the watch list only.
- Host functions are pure over their arguments and answered synchronously by the engine's handler. An answer that does not match the declared return type, or a handler that throws, is reported (`invalidFunctionResult`) and evaluates to the zero value of the return type, so evaluation stays total.
- A document replacement is a build: it lands whole or not at all. A failed replacement leaves the view exactly as it was; a completion of a dispatch made before a successful replacement is dropped and reported (`completionAfterReplace`).
- An event emission arriving after teardown is silently ignored: it represents no pending work. An async completion arriving after teardown is ignored too, but reported, because it did. A lifecycle signal after teardown, or a redundant one (a second `appear` before any `disappear`), is ignored silently: it carries no work.
- Duplicate completions of the same dispatch are guarded and reported; the first outcome wins.
- A success value that does not match the action's declared `result` type (or any value for an action declaring none) is an invalid completion: consumed, neither branch runs, reported. A failure payload follows the same rule against the declared `failure` type: a value where none is declared, a mismatched value, or a missing value against a non-optional declaration (a plain error from the handler is a missing value) is invalid. An ill-typed handler outcome cannot reach state.
- A `$set` or a context update that would give a keyed `$repeat` two elements with the same key is rejected whole and reported (`rejectedMutation` or `rejectedContextUpdate`, `expected` `distinct key`), like one past a limit.
- Enum-typed declarations validate membership at every boundary: a non-member literal (including in a comparison) fails the gate, and a non-member arriving at runtime through a context update, emission, or completion is rejected and reported. A renderer never receives a value outside the declared members.
- Invalid emissions (an undeclared event name, a payload of the wrong type) are dropped and reported, never propagated.

## Threading

Renderers run on the main thread. Events, state writes, and view updates serialize through the `MilanoDispatcher`; the platform default is the main thread on the Swift and Kotlin engines, and the host's event loop in TypeScript, which is single-threaded by construction. Engines are immutable and safe to share. Action handlers run asynchronously and may hop threads freely; their completion is funneled back through the dispatcher.

## Observability

Anything the engine tolerates instead of failing is reported as an occurrence to the `MilanoObserver` you optionally pass at engine creation: skipped unknown types, placeholder routings, division-by-zero results, saturations, dropped invalid emissions. Each occurrence carries its kind, the view's identity (your builder `label` makes this readable), the node reference when there is one, and, when they apply, a `name` (the event, action, property, component type, or context key involved) and `expected` and `found` detail in the gate's own terms: a rejected context update names the key, its declared type, and what arrived; a dropped event names the event; an invalid completion names the action and the declared result type.

Occurrences are reported only for views that built successfully; a failed build reports nothing and throws everything. In development, log every occurrence loudly; in production, feed them to your telemetry. An occurrence is a document quality signal: the user saw something reasonable, but a producer should hear about it. User interactions are deliberately not occurrences: product analytics flows through a separate stream ([User interaction analytics](analytics)), so telemetry stays low-volume and defect-shaped.

## Occurrence detail

`MilanoOccurrence` kinds are the closed union of everything the specs report. What each carries, beyond the view identity, is fixed and pinned by the conformance suite; absent cells are `null`, type names are spelled as the document model spells them, and value kinds as `MilanoValue` names them:

| Kind | `node` | `name` | `expected` | `found` |
|---|---|---|---|---|
| `unknownTypeSkipped`, `unknownTypePlaceholder` | the node | the type name | | |
| `undeclaredProperty` | the node | the property name | | |
| `droppedEvent` | the node | the event name | | |
| `invalidEmission` | the node as emitted | the event name | `declared event`, the declared payload type, `no payload`, or `repeat element` | `unknown node`, `undeclared event`, the payload's kind, `index N` or `key K` for a `$repeat` instance that no longer exists, or `null` |
| `invalidCompletion` | | the action name | the declared result or failure type, `no result` (a success value for an action declaring none), or `no payload` (a value on a failure for an action declaring no failure type) | the value's kind, `null` when missing |
| `duplicateCompletion`, `completionAfterTeardown`, `completionAfterReplace` | | the action name | | |
| `rejectedContextUpdate` | | the key (the last checked, for a node count or repeated key rejection) | the declared type, the limit's name (`maxValueSize`, `maxNodeCount`), or `distinct key` | the value's kind, `missing`, the size, the count, or the repeated key |
| `rejectedMutation` | the node whose binding dispatched; none for a lifecycle or watch binding | the state key | the limit's name (`maxValueSize`, `maxNodeCount`), `distinct key`, or `index in range` | the size, the count, the repeated key, or the index |
| `divisionByZero`, `saturation` | the node being resolved; none during action evaluation | the property being resolved; none otherwise | | |
| `invalidFunctionResult` | the node being resolved; none during action evaluation | the function name | the declared return type | the value's kind, or `error` when the handler threw |

Both tables are the specs' own ([document model](https://github.com/get-milano/specs/blob/main/01-document-model.md), [runtime API](https://github.com/get-milano/specs/blob/main/06-runtime-api.md)); the SDK's consistency check fails the build when a rule or a kind exists in one place and not the other.

## What to do with all this

- Wrap `build()` failures per surface: for optional UI (banners), fail to nothing; for essential UI (a form the user came for), fail to a retry affordance by recreating the host.
- The unknown-type policy defaults to `fail`: degradation is a per-surface decision. Opt into `skip` (per builder) only for surfaces whose meaning survives a gap, like promotional banners; keep `fail` wherever missing content changes meaning: forms, consent, checkout, disclosures. Pair `skip` surfaces with occurrence telemetry so producers hear about every dropped node.
- Alert on `SchemaViolation` in production: it means a producer shipped a document your app rejected wholesale.
