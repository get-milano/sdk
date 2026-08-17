---
title: Writing documents
nav_order: 6
---

# Writing documents

A practical guide for document producers. The normative definition is the [document model specification](https://github.com/get-milano/specs); this page covers what you need to write working documents against an app's vocabulary.

## The envelope

```json
{
  "version": "1.0.0",
  "context": { "userName": "string" },
  "state": { "consent": "bool" },
  "vocabulary": { "name": "shop", "min": "1.2.0" },
  "root": { "type": "Column", "id": "content", "children": [] },
  "metadata": { "campaign": "summer-2026" }
}
```

- `version` (required): the contract version, `major.minor.patch`. Engines accept documents whose major version they support.
- `context` (optional): declares the names and types of values the host injects. Context is read-only to the document and can change while the view is on screen.
- `state` (optional): declares the names and types of the view's state. Initial values come from the host's state data provider; the document itself never contains values.
- `vocabulary` (optional): the vocabulary this document requires, by name and minimum version; a mismatched engine fails the build instead of rendering with the wrong semantics. Documents never declare actions or components: every name a document may use comes from the app's vocabulary, possibly narrowed or overridden per surface by the builder.
- `root` (required): the single root node.
- `metadata` (optional): opaque to the engine, for your pipeline's use.

## Types

`string`, `int`, `bool`, `double`, enums, arrays, and records, each with an optional variant (`?` on primitives, `"optional": true` on the rest). An `int` value satisfies a `double` declaration (it is canonicalized); a `double` never satisfies `int`. Records have strict shape: unknown fields are errors, missing optional fields read as null.

An **enum** is a closed set of named values: `{"enum": ["overlay", "card", "strip"]}`. Use one wherever a property really means "one of these", not free text: layouts, roles, alignments, tones. The payoff is that typos fail at validation instead of falling back silently in a renderer:

- A literal outside the members is an error, in properties, action parameters, and even comparisons: `state.layout == 'centre'` is caught at the gate.
- Supplied state and context, context updates, event payloads, and completion results all validate membership at their boundaries.
- An enum value is still a string at runtime, and it widens wherever a string is expected (`concat('layout: ', state.layout)` works); a plain string expression is never accepted where the enum is declared.
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

## Actions

Three built-ins, plus custom actions:

| Action | Fields | Meaning |
|---|---|---|
| `$set` | `key`, `value` | Writes one state key. Visibility is whole-key and ordered: readers see the value or they do not, never a partial |
| `$sequence` | `actions` | Runs a list of actions in order, without awaiting async completions |
| `$when` | `condition`, `then`, `else` | Conditional branch; `condition` is a bool expression; `else` is optional |

A custom action names an action granted to the surface (declared in the vocabulary, possibly narrowed or overridden by the builder) and provides its parameters, each a literal or an expression. Binding an action outside the granted set fails at the gate:

```json
{
  "action": "submitContact",
  "email": { "$expr": "trim(state.email)" },
  "onSuccess": [ { "action": "$set", "key": "submitted", "value": true } ],
  "onFailure": [ { "action": "$set", "key": "failed", "value": true } ]
}
```

Custom actions dispatch to the host's action handler. The handler is asynchronous; when it completes, the `onSuccess` or `onFailure` follow-ups run. Both are optional.

**Completion results.** An action declared with a `result` type (in the vocabulary or by the builder) hands its handler's returned value back to the document: inside that action's `onSuccess` list, the `result` expression root holds the value, typed exactly as declared. The contact form uses this to show the confirmation number the (simulated) backend answers with:

```json
{
  "action": "submitContact",
  "email": { "$expr": "trim(state.email)" },
  "onSuccess": [
    { "action": "$set", "key": "confirmation", "value": { "$expr": "result" } },
    { "action": "$set", "key": "submitted", "value": true }
  ]
}
```

`result` is scoped: it exists only inside `onSuccess` of an action that declares a result, rebinds at each nesting, and is never available in `onFailure` (failures carry no data). A returned value that does not match the declaration is an invalid completion: neither branch runs and the occurrence is reported, so a buggy handler cannot smuggle an ill-typed value into state.

## Form patterns

The patterns the sample apps use, all expressible without host code:

**Conditional visibility.** Drive a `visible` property from context:

```json
"visible": { "$expr": "context.marketingConsentRequired" }
```

**Gated submission.** Enable the submit button, and guard the action, with the same expression over state:

```json
"enabled": { "$expr": "state.consent && !isEmpty(trim(state.email))" }
```

**Announced updates.** A message a sighted user sees appear should also be heard; when the vocabulary declares it, one optional property does it (see [Accessibility](accessibility)):

```json
"liveRegion": "polite"
```

**Expression-driven errors.** An `error` property that computes its own message:

```json
"error": { "$expr": "if(state.touched && isEmpty(trim(state.email)), 'Email is required', '')" }
```

## Rules worth knowing

- **No values in documents.** Declarations only. If you find yourself writing a user's name into a document, that value belongs in context or state.
- **All-or-nothing validation.** One schema violation anywhere and the whole document is rejected with a typed error naming the rule, the node, and what was expected versus found.
- **Limits.** Depth at most 32, at most 10,000 nodes, at most 1 MiB of document, at most 1,024 characters per expression. Exceeding any is a gate error.
- **Namespaces.** `state`, `context`, and `event` are distinct roots; a state key never shadows a context key.
- **Unknown root fields are ignored** by engines of the same major version, which is what lets minor versions add fields compatibly.

## Shipping documents

Documents are data, so shipping them safely is a pipeline problem, and every check the device performs can run earlier. The sample apps wire all of this into their builds; the pieces work anywhere.

**Validate before shipping.** The specs repository's reference checker doubles as a producer CLI that runs one document through the full gate, with declared context and state values synthesized so it is a single command:

```sh
python3 tools/reference_check.py --document banner.json --vocabulary vocabulary.json
banner.json: valid against examples@1.0.0
```

A rejected document prints the same typed error the engines would throw, and exits nonzero, so a `for` loop over your documents is a complete CI gate. Both sample apps run exactly that loop as a build step: a document the engines would reject fails the build on the developer's machine.

**Validate while authoring.** `tools/generate_document_schema.py` specializes the official document schema to your vocabulary: component types become an enum, properties get typed value schemas, event names constrain `on`. Commit the output next to your documents and point your editor at it (the SDK repo's `.vscode/settings.json` maps the sample documents to their generated schemas), and typos get red squiggles before anything runs. Regenerate it in the same build step as your typed bindings so it never drifts.

**Roll out with a version floor.** A document that depends on newer vocabulary declarations should say so: `"vocabulary": { "name": "shop", "min": "1.2.0" }` makes an app still holding 1.1 fail the build with a typed error instead of rendering with the wrong semantics. Publish documents for the *oldest* vocabulary you still support, and raise `min` only when you actually use the newer declarations.

**Keep a way back.** Because documents are data, rollback is trivial when you design for it: serve documents from a store that keeps the previous version, treat the gate's typed errors on the client as the signal to fall back (last-known-good document, or the native fallback surface), and alert on `SchemaViolation` in production telemetry, since it means a producer shipped something your fleet rejects wholesale. The gate failing closed is the safety net working, not the failure.
