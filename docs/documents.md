---
title: Writing documents
nav_order: 6
---

# Writing documents

A practical guide for document producers. The normative definition is the [document model specification](https://github.com/get-milano/specs); this page covers what you need to write working documents against an app's vocabulary.

## The envelope

```json
{
  "version": "0.1.0",
  "context": { "userName": "string" },
  "state": { "consent": "bool" },
  "actions": { "dismiss": {} },
  "root": { "type": "Column", "id": "content", "children": [] },
  "metadata": { "campaign": "summer-2026" }
}
```

- `version` (required): the contract version, `major.minor.patch`. Engines accept documents whose major version they support.
- `context` (optional): declares the names and types of values the host injects. Context is read-only to the document and can change while the view is on screen.
- `state` (optional): declares the names and types of the view's state. Initial values come from the host's state data provider; the document itself never contains values.
- `actions` (optional): document-local action declarations, same shape as vocabulary actions. A local name colliding with a global one is rejected. Components can never be declared locally.
- `root` (required): the single root node.
- `metadata` (optional): opaque to the engine, for your pipeline's use.

## Types

`string`, `int`, `bool`, `double`, arrays, and records, each with an optional variant marked `?`. An `int` value satisfies a `double` declaration (it is canonicalized); a `double` never satisfies `int`. Records have strict shape: unknown fields are errors, missing optional fields read as null.

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

A custom action names a declared action (global or document-local) and provides its parameters, each a literal or an expression:

```json
{
  "action": "submitContact",
  "email": { "$expr": "trim(state.email)" },
  "onSuccess": [ { "action": "$set", "key": "submitted", "value": true } ],
  "onFailure": [ { "action": "$set", "key": "failed", "value": true } ]
}
```

Custom actions dispatch to the host's action handler. The handler is asynchronous; when it completes, the `onSuccess` or `onFailure` follow-ups run. Both are optional.

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
