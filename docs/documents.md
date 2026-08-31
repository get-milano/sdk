---
title: Writing documents
nav_order: 7
---

# Writing documents

A practical guide for document producers. The normative definition is the [document model specification](https://github.com/get-milano/specs); this page covers what you need to write working documents against an app's vocabulary.

## The envelope

```json
{
  "version": "2.1.0",
  "context": { "userName": "string" },
  "state": { "consent": "bool" },
  "vocabulary": { "name": "shop", "min": "1.2.0" },
  "root": { "type": "Column", "id": "content", "children": [] },
  "on": { "appear": [ { "action": "trackImpression" } ] },
  "watch": { "amount": [ { "action": "$set", "key": "fee", "value": { "$expr": "$round(state.amount * 1.5) / 100.0" } } ] },
  "metadata": { "campaign": "summer-2026" }
}
```

- `version` (required): the contract version, `major.minor.patch`. An engine declares, per major, the highest minor it implements (2.1 and 1.0 today) and rejects a document above that with `UnsupportedVersion` naming the supported ranges; the patch never matters. The declared version also gates what the document may use: a document declaring `2.0.0` that carries a 2.1 feature (`key` on a `$repeat`, the top-level `on` or `watch`, the `failure` root, a numeric function, an array action, a host function) is a `SchemaViolation` with rule `contract-feature` naming the feature and the version it needs, identically on every engine. Declare the lowest version whose features the document uses, the same discipline as `vocabulary.min`.
- `context` (optional): declares the names and types of values the host injects. Context is read-only to the document and can change while the view is on screen.
- `state` (optional): declares the names and types of the view's state. Initial values come from the host's state data provider; the document itself never contains values.
- `vocabulary` (optional): the vocabulary this document requires, by name and minimum version; a mismatched engine fails the build instead of rendering with the wrong semantics. Documents never declare actions or components: every name a document may use comes from the app's vocabulary, possibly narrowed or overridden per surface by the builder.
- `root` (required): the single root node.
- `on` (optional, contract 2.1): lifecycle bindings, action lists run when the host signals that the view came on screen (`appear`) or left it (`disappear`). See [Lifecycle](#lifecycle).
- `watch` (optional, contract 2.1): watch bindings, action lists run when a mutation changes a state key. See [Watch](#watch).
- `metadata` (optional): opaque to the engine, for your pipeline's use.

## Types

`string`, `int`, `bool`, `double`, enums, arrays, and records, each with an optional variant (`?` on primitives, `"optional": true` on the rest). An `int` value satisfies a `double` declaration (it is canonicalized); a `double` never satisfies `int`. Records have strict shape: unknown fields are errors, missing optional fields read as null.

An **enum** is a closed set of named values: `{"enum": ["overlay", "card", "strip"]}`. Use one wherever a property really means "one of these", not free text: layouts, roles, alignments, tones. The payoff is that typos fail at validation instead of falling back silently in a renderer:

- A literal outside the members is an error, in properties, action parameters, and even comparisons: `state.layout == 'centre'` is caught at the gate.
- Supplied state and context, context updates, event payloads, and completion results all validate membership at their boundaries.
- An enum value is still a string at runtime, and it widens wherever a string is expected (`$concat('layout: ', state.layout)` works); a plain string expression is never accepted where the enum is declared.
- The generated document schema turns members into editor autocomplete, and generated bindings turn them into real Swift/Kotlin enums.

Adding a member to a published vocabulary is an additive (minor) change; removing or renaming one is breaking.

## Nodes

```json
{
  "type": "TextField",
  "id": "email",
  "properties": {
    "label": "Email",
    "value": { "$expr": "state.email" }
  },
  "on": {
    "change": [ { "action": "$set", "key": "email", "value": { "$expr": "event" } } ]
  },
  "children": []
}
```

- `type` must exist in the vocabulary. `id` gives the node a stable reference, used in reports.
- A property value is either a literal or an expression, marked by the single-key wrapper `{ "$expr": "..." }`. Either way it must type-check against the property's declared type at the gate.
- `on` binds event names (declared in the vocabulary for that component) to lists of actions, run in order. If the event declares a payload type, the payload is available in expressions as `event`.
- `children` is allowed only on components the vocabulary marks as accepting children.

## Lists with `$repeat`

A list whose length is data uses the `$repeat` construct (contract 2.0): the document carries one template, and the engine instantiates it once per element of an array expression.

```json
{
  "type": "$repeat",
  "id": "rows",
  "items": { "$expr": "state.rows" },
  "as": "row",
  "children": [
    {
      "type": "Card",
      "id": "card",
      "properties": { "title": { "$expr": "row.name" } },
      "on": { "tap": [ { "action": "openUrl", "url": { "$expr": "row.url" } } ] }
    }
  ]
}
```

- `items` is an expression typing to a non-optional array. `as` names the element inside the template, and `<as>_index` is its zero-based position as an `int`; both are readable in every property, action, and nested `$repeat` of the template, in the construct's own `key`, and nowhere else.
- The construct is transparent: the instances take its place in the parent's children, in element order. An empty array renders nothing.
- An instance is referenced by its template's reference plus its identity per enclosing repeat. Without `key`, the identity is the element index: `card[2]`, or `line[2][0]` when nested. With `key` (contract 2.1), an expression of a non-optional `string`, `int`, or enum type over the template's roots, it is the key's rendering: `card[abc]`. Reports, emissions, and the React binding's keys use these references, so a keyed instance keeps its identity when the array is reordered, grown, or shrunk, and an emission from it binds the element whose key matches at dispatch time; an emission naming an identity that no longer exists is an `invalidEmission`. Give any list whose elements move, appear, or disappear a `key`.
- Keys are distinct within one materialization. Two elements rendering the same key are a data defect: at build a `SchemaViolation` (`repeat`, `distinct key`), at runtime a `$set` or context update that would produce one is rejected whole and reported.
- A `$repeat` carries only `type`, `id`, `items`, `as`, `key`, and `children`. It is never the root, and `as` must be a fresh identifier (`state`, `context`, `event`, `result`, `failure`, and any enclosing binding are taken). Each rule is a `SchemaViolation` with rule `repeat`.
- The node count limit is measured on the materialized tree. At build it is a `LimitExceeded`; at runtime a `$set` or a context update that would grow the tree past it is rejected whole and reported (`rejectedMutation` or `rejectedContextUpdate`, with `maxNodeCount` as `expected`).
- Only documents declaring `2.x` can use it; a `1.x` document with a `$repeat` is a `SchemaViolation` (`construct`).

The catalog sample is one `$repeat` over `state.items`, keyed on each item's `id`, with the items supplied by the state data provider.

Where does list data live? State is for what the document itself mutates, whole-key through `$set` or one element at a time through the array actions below (a cart, a checklist, rows the user edits); a collection the host owns and refreshes (an inbox, a feed, search results) belongs in context, updated through a `MilanoContextHandle`, since the provider is consulted once at build. The catalog uses state because its items are its own.

## Choosing a subtree with `$if`

Contract 2.1. `$repeat` answers "one per element"; `$if` answers "this or that". It takes a bool expression and two node lists, and materializes one of them in its own place:

```json
{
  "type": "$if",
  "condition": { "$expr": "$isEmpty(state.items)" },
  "then": [ { "type": "Text", "properties": { "text": "Nothing yet" } } ],
  "else": [ { "type": "$repeat", "id": "row", "items": { "$expr": "state.items" },
              "as": "item", "children": [ "..." ] } ]
}
```

That is the empty-list case, and it is the one most views need: a list with nothing in it renders nothing, so the message that says so has to come from somewhere.

Leave `else` out and the construct materializes nothing when the condition is false, which is how a document says *only when*.

**`$if` and `visible` are different tools.** A `visible` property is a component's own, declared by your vocabulary, and it hides a node that is still there. `$if` decides whether the node exists at all, and it works for every component, including one whose vocabulary declares no `visible`. Use `visible` to keep a node's place; use `$if` to choose between two different things, or to leave one out entirely.

Three rules are worth knowing:

- **Both branches are validated**, whichever one a build takes. A typo in the branch you are not looking at fails the build, so a condition flipping at runtime never reveals a document the gate has not seen. Ids are unique across both branches for the same reason.
- **Only the taken branch is resolved**, exactly as only the taken branch of the `$if` *function* is evaluated, so the other branch produces no reports and costs nothing against the node count limit.
- It carries no `properties`, no `on`, and no `id`: it renders nothing itself, and the nodes in its branches carry their own.

## Choosing among many with `$switch`

Contract 2.1. `$if` asks a yes-or-no question of a subtree; `$switch` asks which of a closed set, keyed on an enum:

```json
{
  "type": "$switch",
  "subject": { "$expr": "state.status" },
  "cases": {
    "ok":     [ { "type": "Badge", "properties": { "label": "Ready", "tone": "info" } } ],
    "late":   [ { "type": "Badge", "properties": { "label": "Running late", "tone": "warning" } } ],
    "failed": [ { "type": "Badge", "properties": { "label": "Failed", "tone": "danger" } } ]
  }
}
```

**Every member must be covered**, by a case or by a `default`. That is the reason to reach for it over nested `$if`s: add a member to the enum and the build fails naming the one you missed, instead of the view rendering nothing where a badge should be. Write `default` when you only care about some members and mean it for the rest.

It follows `$if` in everything else: never the root, no `properties`, `on`, or `id`, every branch validated whichever one a build takes, only the chosen branch resolved, and ids unique across all of them. A node inside a branch is pathed `root/children[2]/cases[late][0]`, so a report names the member it came from.

**`$switch` chooses nodes; the lookup chooses values.** For a label, a tone, or an icon name, `context.labels[state.status]` in [Expressions](expressions) is shorter and carries the same exhaustiveness guarantee. Reach for `$switch` when the branches differ in *shape*, not just in text.

## Actions

Six built-ins, plus custom actions:

| Action | Fields | Meaning |
|---|---|---|
| `$set` | `key`, `value` | Writes one state key. Visibility is whole-key and ordered: readers see the value or they do not, never a partial |
| `$append` | `key`, `value` | Contract 2.1. Adds one element at the end of an array-typed state key; `value` is typed as the element |
| `$remove` | `key`, `at` | Contract 2.1. Removes the element at a zero-based `int` index |
| `$update` | `key`, `at`, `field`, `value` | Contract 2.1. Replaces one field of the record element at `at`; everything else is unchanged |
| `$sequence` | `actions` | Runs a list of actions in order, without awaiting async completions |
| `$when` | `condition`, `then`, `else` | Conditional branch; `condition` is a bool expression; `else` is optional |

**Editing a collection.** The three array actions are how a document changes a list it owns without replacing it whole. Inside a `$repeat` template, `<as>_index` is the element's position at the moment of the tap, keyed or not, so a row edits or removes itself with it:

```json
{
  "type": "$repeat", "id": "rows", "items": { "$expr": "state.items" }, "as": "item", "key": { "$expr": "item.id" },
  "children": [
    { "type": "Checkbox", "id": "done", "properties": { "label": { "$expr": "item.name" }, "checked": { "$expr": "item.done" } },
      "on": { "change": [ { "action": "$update", "key": "items", "at": { "$expr": "item_index" }, "field": "done", "value": { "$expr": "event" } } ] } },
    { "type": "Button", "id": "remove", "properties": { "label": "Remove", "enabled": true },
      "on": { "tap": [ { "action": "$remove", "key": "items", "at": { "$expr": "item_index" } } ] } }
  ]
}
```

The target must be a declared, non-optional array (records for `$update`, with a declared `field`); every value is a declared position, so an `int` fits a `double` element and a member literal fits an enum field. The array an action produces follows every `$set` rule: the value size limit on the whole array, the node count on the tree it re-materializes, distinct keys in every keyed `$repeat`, and the no-change rule (an `$update` that leaves the field equal changes nothing). An index outside the array is a rejected mutation at runtime (`index in range`), assigns nothing, and ends the action list.

A custom action names an action granted to the surface (declared in the vocabulary, possibly narrowed or overridden by the builder) and provides its parameters, each a literal or an expression. Binding an action outside the granted set fails at the gate:

```json
{
  "action": "submitContact",
  "email": { "$expr": "$trim(state.email)" },
  "onSuccess": [ { "action": "$set", "key": "submitted", "value": true } ],
  "onFailure": [ { "action": "$set", "key": "failed", "value": true } ]
}
```

Custom actions dispatch to the host's action handler. The handler is asynchronous; when it completes, the `onSuccess` or `onFailure` follow-ups run. Both are optional.

**Completion results.** An action declared with a `result` type (in the vocabulary or by the builder) hands its handler's returned value back to the document: inside that action's `onSuccess` list, the `result` expression root holds the value, typed exactly as declared. The contact form uses this to show the confirmation number the (simulated) backend answers with:

```json
{
  "action": "submitContact",
  "email": { "$expr": "$trim(state.email)" },
  "onSuccess": [
    { "action": "$set", "key": "confirmation", "value": { "$expr": "result" } },
    { "action": "$set", "key": "submitted", "value": true }
  ]
}
```

`result` is scoped: it exists only inside `onSuccess` of an action that declares a result, rebinds at each nesting, and is never available in `onFailure`. A returned value that does not match the declaration is an invalid completion: neither branch runs and the occurrence is reported, so a buggy handler cannot smuggle an ill-typed value into state.

### Failure payloads

Contract 2.1. An action declared with a `failure` type hands the value its handler failed with back to the document, exactly as `result` does for success: inside that action's `onFailure` list, the `failure` root holds the value, typed as declared. The typical declaration is an enum of reasons, so the document decides the wording:

```json
{
  "action": "submitContact",
  "email": { "$expr": "$trim(state.email)" },
  "onSuccess": [ { "action": "$set", "key": "submitted", "value": true } ],
  "onFailure": [
    {
      "action": "$set",
      "key": "error",
      "value": { "$expr": "$if(failure == 'invalidEmail', 'That address was not accepted.', 'We could not reach the server.')" }
    }
  ]
}
```

The rules mirror `result`, missing value included: a failure completion with no value is `null`, which satisfies an optional `failure` declaration and violates a non-optional one (an invalid completion, neither branch runs). A handler that may fail with an ordinary error therefore needs either an optional declaration or a mapping of every error to a declared value; the samples map. An action declaring no `failure` keeps the 2.0 rule: a value on a failure is invalid. How a handler attaches the payload is in [Creating a bridge](bridge#the-action-funnel).

## Form patterns

The patterns the sample apps use, all expressible without host code:

**Conditional visibility.** Drive a `visible` property from context:

```json
"visible": { "$expr": "context.marketingConsentRequired" }
```

**Gated submission.** Enable the submit button, and guard the action, with the same expression over state:

```json
"enabled": { "$expr": "state.consent && !$isEmpty($trim(state.email))" }
```

**Announced updates.** A message a sighted user sees appear should also be heard; when the vocabulary declares it, one optional property does it (see [Accessibility](accessibility)):

```json
"liveRegion": "polite"
```

**Expression-driven errors.** An `error` property that computes its own message:

```json
"error": { "$expr": "$if(state.touched && $isEmpty($trim(state.email)), 'Email is required', '')" }
```

**In flight.** A `submitting` flag set before the custom action and cleared in both follow-ups, so the button disables while the handler runs and the document never dispatches twice:

```json
"tap": [
  { "action": "$set", "key": "submitting", "value": true },
  { "action": "submitContact", "email": { "$expr": "state.email" },
    "onSuccess": [ { "action": "$set", "key": "submitting", "value": false } ],
    "onFailure": [ { "action": "$set", "key": "submitting", "value": false } ] }
]
```

**Rounding money.** Keep amounts as numbers and round at the edge: `$str($round(state.amount * 100.0) / 100.0)`; bound a percentage with `$min($max(state.percent, 0.0), 100.0)`. Locale formatting (separators, currency symbols) belongs in the renderer.

## Lifecycle

Contract 2.1. The host tells a view when it comes on screen and when it leaves; the document binds action lists to either signal at the top level, next to `root`:

```json
"on": {
  "appear": [ { "action": "track", "event": "appeared", "surface": "interstitial" } ],
  "disappear": [ { "action": "track", "event": "disappeared", "surface": "interstitial" } ]
}
```

- Only `appear` and `disappear` exist; any other key is a `SchemaViolation` (`event-binding`, `lifecycle event`).
- The signals carry no payload: `event` is not a root inside these bindings. `result` and `failure` bind inside custom actions' follow-ups as everywhere else.
- `appear` runs every time the view comes on screen, not once: a screen the user leaves and returns to appears again. A second `appear` before any `disappear` is ignored, as is any signal after teardown.
- Custom actions bound here need the same declarations and the same handler as anywhere else. A rejected `$set` from a lifecycle binding is reported with no node.

`MilanoHost` delivers the signals on every toolkit from the toolkit's own presentation callbacks; a host that awaits `build()` and places the view itself calls `view.appear()` and `view.disappear()`. The interstitial sample tracks its own impressions this way, and "mark as read when opened" is the same shape.

## Watch

Contract 2.1. A document reacts to its own data by binding action lists to changes of a state key, at the top level next to `root`:

```json
"watch": {
  "amount": [ { "action": "$set", "key": "fee", "value": { "$expr": "$round(state.amount * 1.5) / 100.0" } } ],
  "query": [ { "action": "search", "text": { "$expr": "state.query" }, "onSuccess": [ { "action": "$set", "key": "results", "value": { "$expr": "result" } } ] } ]
}
```

- A key's list runs whenever a mutation (`$set` or an array action, from an event, a lifecycle signal, or a completion's follow-up) changes that key's value; an assignment that leaves it equal runs nothing, and so do context updates, the initial build, and a replacement.
- It runs **as part of the mutation**, synchronously, before the next action of the list that changed the key: the actions after it see what the watch assigned. It reads the new value as `state.<key>`; there is no payload, so `event` is not a root inside. `result` and `failure` bind inside custom actions' follow-ups as everywhere else.
- **A watch never triggers a watch.** Mutations made by a watch list, or by the follow-ups of a custom action it dispatched, run no watch, whatever key they change. Derive values from the keys the user changes, never from each other: `fee` from `amount`, not `total` from `fee` from `amount`. There is no cascade and no loop, by rule.
- A rejected mutation inside a watch list ends the watch list only; the list that triggered it continues. A custom action dispatched from a watch is anchored to no node.
- Every key must be declared in `state` (rule `watch`); a document declaring `2.0.0` may not carry the section (`contract-feature`).

Autosave, a live quote, a derived total, a search that follows the query: each is a watch on the key that changes plus a custom action or a `$set`.

## Rules worth knowing

- **No values in documents.** Declarations only. If you find yourself writing a user's name into a document, that value belongs in context or state.
- **All-or-nothing validation.** One schema violation anywhere and the whole document is rejected with a typed error naming the rule, the node, and what was expected versus found.
- **Limits.** Depth at most 32, at most 10,000 nodes, at most 1 MiB of document, at most 1,024 Unicode scalars per expression (an emoji counts once, whatever `string.length` says). Exceeding any is a gate error. Values entering state or context are bounded too, at 65,536 units each (a scalar per unit for strings, one plus the contents for arrays and records): at the gate as an error, at runtime as a rejected update or mutation; see [Guardrails](guardrails#limits).
- **Namespaces.** `state`, `context`, `event`, `result`, and `failure` are distinct roots; a state key never shadows a context key. A declared host function never shadows a built-in: the vocabulary may not declare one under a built-in's name.
- **Unknown root fields are ignored** within a version the engine implements, which is what lets minor versions add fields compatibly; a version above what the engine implements is rejected typed instead.

## Shipping documents

Documents are data, so shipping them safely is a pipeline problem, and every check the device performs can run earlier. [Producing documents](producing) walks the whole workflow, from `milano init` to CI; this section is the summary. The sample apps wire all of this into their builds; the pieces work anywhere, and `npx @get-milano/cli init` scaffolds a producer folder with them wired: a starter vocabulary, a first document, the editor schema, `npm run check`, and an authoring skill plus `AGENTS.md` so an AI agent working in the folder knows the rules and runs the gate.

**Validate before shipping.** `@get-milano/cli` runs documents through the full gate, the engine's own, with declared context and state synthesized (or supplied with `--context` and `--state`) so it is a single command:

```sh
npx milano validate documents/*.json --vocabulary vocabulary.json
documents/banner.json: valid
documents/form.json: SchemaViolation: schema violation (property-type) at email: expected string, found int
```

A rejected document prints the typed error the engines throw and the status is nonzero, so one command over your documents is a complete CI gate; `--json` gives tooling the report, and `validate()` from the same package does it from a build script. The four sample apps run it as a build step, so a document the engines would reject fails the build on the developer's machine. The specs repository's `tools/reference_check.py --document` does the same job in Python with no engine installed.

**Validate while authoring.** `npx milano schema vocabulary.json --out documents.schema.json` specializes the official document schema to your vocabulary: component types become an enum, properties get typed value schemas, event names constrain `on`. Commit the output next to your documents and point your editor at it (the SDK repo's `.vscode/settings.json` maps the sample documents to their generated schemas), and typos get red squiggles before anything runs. Regenerate it in the same build step as your typed bindings so it never drifts.

**Roll out with a version floor.** A document that depends on newer vocabulary declarations should say so: `"vocabulary": { "name": "shop", "min": "1.2.0" }` makes an app still holding 1.1 fail the build with a typed error instead of rendering with the wrong semantics. Publish documents for the *oldest* vocabulary you still support, and raise `min` only when you actually use the newer declarations.

**Keep a way back.** Because documents are data, rollback is trivial when you design for it: serve documents from a store that keeps the previous version, treat the gate's typed errors on the client as the signal to fall back (last-known-good document, or the native fallback surface), and alert on `SchemaViolation` in production telemetry, since it means a producer shipped something your fleet rejects wholesale. The gate failing closed is the safety net working, not the failure.
