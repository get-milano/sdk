---
name: milano-authoring
description: Write and change Milano vocabularies and documents in this folder. Use when asked to add or edit a screen, a document, a component, a property, an event, or an action, or when `npm run check` reports a Milano error.
---

# Authoring Milano documents

Milano renders screens from JSON documents. The app registers a **vocabulary** (component types, their properties and events, custom actions) and a renderer per type; a **document** is a tree of nodes using only what the vocabulary declares, with values that are literals or small typed expressions over `state`, `context`, and event payloads. Every document passes a **gate** before it renders: parse, version, vocabulary, limits, then every node, property, expression, and action is checked against the declarations. Nothing is guessed at runtime, so a document that passes the gate here renders in the app, and one that fails prints the same typed error the app would report.

## Workflow

1. Read `vocabulary.json` first. Every `type`, property, event, and action a document uses must be declared there, with the declared types.
2. Write or edit the document under `documents/`. One screen per file.
3. Run `npm run check`. It regenerates `documents.schema.json` (never edit that file by hand) and validates every document with the gate. Read the error: it names the node (`at <id>`), the rule, what was expected, and what was found. Fix the document, run again.
4. Changing `vocabulary.json` changes the contract with the app: add rather than remove, bump `version`, and run `npx milano diff <previous> vocabulary.json` before publishing (additive changes need a minor bump, breaking ones a major).

`npm run validate` synthesizes zero-values for declared `context` and `state`; to validate with real values, `npx milano validate documents/x.json --vocabulary vocabulary.json --context ctx.json --state st.json`.

## The document envelope

```jsonc
{
  "version": "2.0.0",                                   // required: the contract version
  "vocabulary": { "name": "shop", "min": "1.0.0" },     // optional: refuse to build on an older vocabulary
  "context": { "userName": "string" },                  // optional: what the host injects, read-only
  "state": { "taps": "int" },                           // optional: the view's state, written by $set
  "root": { "type": "Column", "children": [] },         // required: the single root node
  "metadata": { "screen": "welcome" }                   // optional: passed through to the host untouched
}
```

Documents never contain values: `context` and `state` are declarations (name to type). The host supplies context, the state data provider supplies initial state, `$set` changes state. Declare `"version": "2.0.0"`.

## Nodes

```jsonc
{
  "type": "Button",                                     // a vocabulary component type
  "id": "docs",                                         // optional, unique in the document; errors and events name it
  "properties": { "label": "Read the docs", "enabled": { "$expr": "state.taps > 0" } },
  "on": { "tap": [ { "action": "openUrl", "url": "https://get-milano.dev" } ] },
  "children": []                                        // only on types declared with "children": true
}
```

- A property value is a literal or an expression, `{ "$expr": "..." }`. There is no interpolation inside plain strings: `"Hello, {name}"` is the literal text.
- Give an `id` to every node with an `on` binding and to anything you may need to find in a report.
- `on` maps a declared event name to one action or a list of actions, run in order. If the event declares a payload type, `event` reads it inside those actions.
- Properties the type does not declare are ignored and reported (an error when the type is `strict`). Do not rely on them.

## Types

Descriptors, in vocabularies and in `context`/`state` declarations:

| Descriptor | Meaning |
|---|---|
| `"string"`, `"int"`, `"double"`, `"bool"` | Scalars; `"string?"` etc. is optional (may be `null`) |
| `{ "enum": ["title", "body"] }` | One of the members; `"optional": true` for the optional form |
| `{ "array": "string" }` | Array of the element descriptor; `"optional": true` likewise |
| `{ "record": { "name": "string", "url": "string" } }` | Record with exactly these fields; `"optional": true` likewise |

An `int` is accepted where `double` is declared; never the reverse. `null` is accepted only in optional positions. An enum value is a string at runtime and is accepted where a string is expected, but a plain string is never accepted where the enum is declared, and a literal outside the members is an error even in comparisons.

## Expressions

Pure, statically typed at the gate, total at runtime. Strings inside an expression use single quotes: `{ "$expr": "concat('Hello, ', context.userName)" }`.

**Roots**: `state.key`, `context.key` (declared keys only); `event` inside `on` bindings of an event with a payload; `result` inside `onSuccess` of a custom action declaring a `result`; inside a `$repeat` template, the `as` name and `<as>_index`. Record fields are read with a dot, and only on a non-optional record: resolve an optional with `??` first. There is no array indexing; `$repeat` is how a document walks an array.

**Literals**: `1`, `2.5` (no exponent form), `'text'` (escapes `\'` and `\\`), `true`, `false`, `null` (only where the type is optional).

**Operators**, tightest first: `!` and unary `-`; `* / %`; `+ -` (`+` also joins two strings); `< <= > >=` (numbers only); `== !=` (same scalar type; optionals compare to `null`; arrays and records never compare); `&&`; `||`; `??` (optional on the left, its non-optional default on the right). Int arithmetic wraps at 64 bits; int division by zero yields `0` and reports; `int` meeting `double` promotes to double.

**Functions**, the complete set: `str(x)` scalar to string; `int(x)` double to int (truncates); `double(x)`; `concat(a, b, ...)` two or more strings; `length(x)` and `isEmpty(x)` on a string or array; `contains(s, sub)`, `startsWith(s, p)`, `endsWith(s, p)`, `trim(s)`; `if(c, a, b)` where both branches have exactly the same type, optionality included (write `if(c, state.note ?? '', 'x')`, and `if(c, value, null)` for an optional result). No regular expressions, no case mapping.

**Typing**: a property expression must type to the declared property type; a `$set` value to the state key's type; an action parameter to its declared type; `$when` conditions and `enabled`-style bools to `bool`. A non-optional `T` is accepted where `T?` is expected, an `int` where `double` is; never the reverse.

## Actions

```jsonc
{ "action": "$set", "key": "taps", "value": { "$expr": "state.taps + 1" } }
{ "action": "$sequence", "actions": [ ... ] }
{ "action": "$when", "condition": { "$expr": "state.taps > 2" }, "then": [ ... ], "else": [ ... ] }
{ "action": "openUrl", "url": { "$expr": "concat('https://example.com/', state.slug)" },
  "onSuccess": [ ... ], "onFailure": [ ... ] }
```

- `$set` writes one declared state key; the value is a literal or an expression of the key's type. Readers see the new value immediately, before the next action runs.
- A custom action names a vocabulary action and gives every non-optional parameter as a key. It runs asynchronously in the app; `onSuccess` and `onFailure` (both optional) run when it completes. If the action declares a `result` type, `result` reads the returned value inside `onSuccess`.

## Lists: `$repeat`

A list whose length is data is one template instantiated per element of an array expression:

```jsonc
{
  "type": "$repeat",
  "id": "rows",
  "items": { "$expr": "state.rows" },     // an expression of a non-optional array type
  "as": "row",                            // binds `row` and `row_index` inside the template
  "children": [ { "type": "Text", "id": "name", "properties": { "text": { "$expr": "row.name" }, "role": "body" } } ]
}
```

A `$repeat` carries only `type`, `id`, `items`, `as`, `children`; it is never the root; `as` must be a fresh identifier (not `state`, `context`, `event`, `result`, or an enclosing binding). The instances replace the construct in the parent's children; an empty array renders nothing. Instances are referenced as `name[0]`, `name[1]`, and nested ones as `name[1][0]`.

## The gate's rules, and what they mean

| Rule in the error | Fix |
|---|---|
| `UnknownComponentType` | The `type` is not in `vocabulary.json`; check spelling, or declare it (the app must register a renderer) |
| `id-uniqueness` | Two nodes share an `id` |
| `undeclared-property` | A `strict` component got a property it does not declare |
| `property-type` | A literal does not match the declared type (`expected string, found int`; `expected enum member`) |
| `expression` | The expression fails to parse or does not type to the expected type; check quotes, roots, optionality, `if` branch types |
| `event-binding` | `on` names an event the component does not declare |
| `children` | The component does not accept children |
| `action-encoding` | A `$set` targets an undeclared state key, a parameter is missing, unknown, or ill-typed |
| `action-capability` | The action is not declared in the vocabulary (or not granted to the surface) |
| `repeat` | A `$repeat` rule above was broken; the error says which (`items expression`, `array items`, `binding identifier`, ...) |
| `context-declaration`, `state-declaration` | A declaration key is not an identifier or its descriptor is invalid |
| `LimitExceeded` | Tree depth, node count, document size, expression length, or a value's size passed the engine's limit |
| `UnsupportedVersion` | The document's `version` is above what the engine implements; use `2.0.0` |

## The vocabulary

```jsonc
{
  "milano": "2.0.0",                                    // the contract version
  "name": "shop",                                       // what documents name in "vocabulary"
  "version": "1.0.0",                                   // bump per the evolution rules
  "components": {
    "Column": { "children": true },
    "Text": { "properties": { "text": "string", "role": { "enum": ["title", "body"] } } },
    "Button": { "properties": { "label": "string", "enabled": "bool" }, "events": { "tap": null } }
  },
  "actions": {
    "openUrl": { "parameters": { "url": "string" } }    // optionally "result": <descriptor>
  }
}
```

An event's value is `null` (no payload) or a descriptor (the payload type `event` reads). `"strict": true` on a component makes undeclared properties errors. Additive changes (a component, property, event, action, parameter, result, or enum member added) are a minor bump; anything removed, retyped (optionality included), made strict, or losing `children` is a major bump. Every component type needs a renderer in the app, so agree new types with the app team before documents depend on them.

## A complete example

Against the starter vocabulary above:

```json
{
  "version": "2.0.0",
  "vocabulary": { "name": "shop", "min": "1.0.0" },
  "context": { "userName": "string" },
  "state": { "taps": "int", "note": "string?" },
  "root": {
    "type": "Column",
    "id": "screen",
    "children": [
      { "type": "Text", "properties": { "text": { "$expr": "concat('Hello, ', context.userName)" }, "role": "title" } },
      { "type": "Text", "properties": { "text": { "$expr": "state.note ?? 'No note yet'" }, "role": "body" } },
      {
        "type": "Button",
        "id": "tap",
        "properties": { "label": { "$expr": "if(state.taps == 0, 'Tap me', concat('Tapped ', str(state.taps)))" }, "enabled": true },
        "on": {
          "tap": [
            { "action": "$set", "key": "taps", "value": { "$expr": "state.taps + 1" } },
            { "action": "$when", "condition": { "$expr": "state.taps >= 3" }, "then": [
              { "action": "$set", "key": "note", "value": "That is enough" }
            ] }
          ]
        }
      },
      {
        "type": "Button",
        "id": "docs",
        "properties": { "label": "Read the docs", "enabled": { "$expr": "state.taps > 0" } },
        "on": { "tap": { "action": "openUrl", "url": "https://get-milano.dev" } }
      }
    ]
  },
  "metadata": { "screen": "example" }
}
```

Reference: the guides at https://get-milano.github.io/sdk (Writing documents, Expressions) and the normative specification at https://github.com/get-milano/specs.
