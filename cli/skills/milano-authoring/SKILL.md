---
name: milano-authoring
description: Write and change Milano vocabularies and documents in this folder. Use when asked to add or edit a screen, a document, a component, a property, an event, or an action, or when `npm run check` reports a Milano error.
---

# Authoring Milano documents

Milano renders screens from JSON documents. The app registers a **vocabulary** (component types, their properties and events, custom actions) and a renderer per type; a **document** is a tree of nodes using only what the vocabulary declares, with values that are literals or small typed expressions over `state`, `context`, event payloads, and completion values. Every document passes a **gate** before it renders: parse, version, vocabulary, limits, then every node, property, expression, and action is checked against the declarations. Nothing is guessed at runtime, so a document that passes the gate here renders in the app, and one that fails prints the same typed error the app would report.

## Workflow

1. Read `vocabulary.json` first. Every `type`, property, event, and action a document uses must be declared there, with the declared types.
2. Write or edit the document under `documents/`. One screen per file.
3. Run `npm run check`. It regenerates `documents.schema.json` (never edit that file by hand) and validates every document with the gate. Read the error: it names the node (`at <id>`), the rule, what was expected, and what was found. Fix the document, run again.
4. Changing `vocabulary.json` changes the contract with the app: add rather than remove, bump `version`, and run `npx milano diff <previous> vocabulary.json` before publishing (additive changes need a minor bump, breaking ones a major).

`npm run validate` synthesizes zero-values for declared `context` and `state`; to validate with real values, `npx milano validate documents/x.json --vocabulary vocabulary.json --context ctx.json --state st.json`.

## The document envelope

```jsonc
{
  "version": "2.1.0",                                   // required: the contract version
  "vocabulary": { "name": "shop", "min": "1.0.0" },     // optional: refuse to build on an older vocabulary
  "context": { "userName": "string" },                  // optional: what the host injects, read-only
  "state": { "taps": "int" },                           // optional: the view's state, written by $set
  "root": { "type": "Column", "children": [] },         // required: the single root node
  "on": { "appear": [ ... ], "disappear": [ ... ] },    // optional: actions run when the view comes on or leaves the screen
  "metadata": { "screen": "welcome" }                   // optional: passed through to the host untouched
}
```

Documents never contain values: `context` and `state` are declarations (name to type). The host supplies context, the state data provider supplies initial state, `$set` changes state. Declare `"version": "2.1.0"`: a document is checked under the rules of the version it declares, and using something a later version introduced (`key` on a `$repeat`, the top-level `on`, the `failure` root, `abs`/`min`/`max`/`floor`/`ceil`/`round`) in a document declaring `2.0.0` is the `contract-feature` error naming it.

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

Pure, statically typed at the gate, total at runtime. Strings inside an expression use single quotes: `{ "$expr": "$concat('Hello, ', context.userName)" }`.

**Roots**: `state.key`, `context.key` (declared keys only); `event` inside a node's `on` bindings of an event with a payload (never inside the document's lifecycle bindings, which carry none); `result` inside `onSuccess` of a custom action declaring a `result`; `failure` inside `onFailure` of a custom action declaring a `failure`; inside a `$repeat` template, the `as` name and `<as>_index`. Record fields are read with a dot, and only on a non-optional record: resolve an optional with `??` first. There is no array indexing; `$repeat` is how a document walks an array.

**Literals**: `1`, `2.5` (no exponent form), `'text'` (escapes `\'` and `\\`), `true`, `false`, `null` (only where the type is optional).

**Operators**, tightest first: `!` and unary `-`; `* / %`; `+ -` (`+` also joins two strings); `< <= > >=` (numbers only); `== !=` (same scalar type; optionals compare to `null`; arrays and records never compare); `&&`; `||`; `??` (optional on the left, its non-optional default on the right). Int arithmetic wraps at 64 bits; int division by zero yields `0` and reports; `int` meeting `double` promotes to double.

**Functions**, the contract's own, all called with a `$`: `$str(x)` scalar to string; `$int(x)` double to int (truncates); `$double(x)`; `$concat(a, b, ...)` two or more strings; `$length(x)` and `$isEmpty(x)` on a string or array; `$contains(s, sub)`, `$startsWith(s, p)`, `$endsWith(s, p)`, `$trim(s)`; `$if(c, a, b)` where both branches have exactly the same type, optionality included (write `$if(c, state.note ?? '', 'x')`, and `$if(c, value, null)` for an optional result); `$abs(x)` keeps the number's type; `$min(a, b, ...)` and `$max(a, b, ...)` take two or more numbers, int when all are int, double otherwise; `$floor(d)`, `$ceil(d)`, `$round(d)` take a double and return one (`$round` breaks ties away from zero: `$round(2.5)` is `3.0`), so `$int($round(d))` is how to get an int; `$substring(s, from, to)` clamps both indices, `$indexOf(s, needle)` answers -1 when absent, `$replace(s, needle, to)` rewrites every occurrence, `$split(s, sep)` gives an array of string and `$join(a, sep)` folds one back. No regular expressions, no case mapping.

**Host functions**: the vocabulary may declare functions the app computes (contract 2.1), under `"functions"`; call them by their bare name, with exactly the declared arguments: `formatMoney(state.cents, 'EUR', context.locale)`. The two namespaces never meet: `$name` is always one of the contract's functions above, a bare `name` always one the vocabulary declares, and neither falls back to the other. So a vocabulary may declare `round` or `concat` if that is the right name for what the app computes, and `$round` still rounds. Each argument is typed like a declared position (an `int` fits a `double` argument, a member literal fits an enum argument), and the call has exactly the declared return type (resolve an optional return with `??`). They are pure: the same arguments always give the same value, so everything they depend on (a locale, a currency) comes from `context` and is passed in. Use them for formatting and other pure computations; anything with an effect is an action.

**Typing**: a property expression must type to the declared property type; a `$set` value to the state key's type; an action parameter to its declared type; `$when` conditions and `enabled`-style bools to `bool`. A non-optional `T` is accepted where `T?` is expected, an `int` where `double` is; never the reverse.

## Actions

```jsonc
{ "action": "$set", "key": "taps", "value": { "$expr": "state.taps + 1" } }
{ "action": "$sequence", "actions": [ ... ] }
{ "action": "$when", "condition": { "$expr": "state.taps > 2" }, "then": [ ... ], "else": [ ... ] }
{ "action": "openUrl", "url": { "$expr": "$concat('https://example.com/', state.slug)" },
  "onSuccess": [ ... ], "onFailure": [ ... ] }
```

- `$set` writes one declared state key; the value is a literal or an expression of the key's type. Readers see the new value immediately, before the next action runs.
- `$append`, `$remove`, `$update` change one element of an array-typed state key (contract 2.1) and are the only way to edit a collection in place:

```jsonc
{ "action": "$append", "key": "items", "value": { "id": "c", "name": "Cornetto", "done": false } }
{ "action": "$remove", "key": "items", "at": { "$expr": "item_index" } }
{ "action": "$update", "key": "items", "at": { "$expr": "item_index" }, "field": "done", "value": true }
```

  `key` names a non-optional array in `state`; `value` types as the element (`$append`) or as the named field (`$update`, whose elements must be records); `at` is a zero-based `int`, typically `<as>_index` inside a `$repeat` template, which is the element's position at the moment of the tap. An index outside the array rejects the mutation at runtime and ends the action list; a `$update` that changes nothing changes nothing.
- A custom action names a vocabulary action and gives every non-optional parameter as a key. It runs asynchronously in the app; `onSuccess` and `onFailure` (both optional) run when it completes. If the action declares a `result` type, `result` reads the returned value inside `onSuccess`; if it declares a `failure` type, `failure` reads the value the app failed with inside `onFailure` (a plain error with no value is `null`, which only an optional `failure` declaration accepts: check the vocabulary before relying on it). Neither root exists in the other list.

## Lifecycle: the document's `on`

The app tells a view when it comes on screen and when it leaves. Bind actions to either at the top level of the document, next to `root`:

```jsonc
"on": {
  "appear": [ { "action": "$set", "key": "seen", "value": true } ],
  "disappear": [ { "action": "trackLeave" } ]
}
```

Only `appear` and `disappear` exist; there is no payload, so `event` is not available inside. `appear` runs every time the view comes on screen, not once. Custom actions bound here need the same declarations as anywhere else.

## Reacting to state: the document's `watch`

Bind actions to changes of a state key at the top level, next to `root` (contract 2.1):

```jsonc
"watch": {
  "amount": [ { "action": "$set", "key": "fee", "value": { "$expr": "$round(state.amount * 1.5) / 100.0" } } ],
  "query": [ { "action": "search", "text": { "$expr": "state.query" } } ]
}
```

A key's list runs whenever a mutation changes that key's value, as part of the mutation, before the next action of the list that changed it; it reads the new value as `state.<key>`. There is no payload, so `event` is not available. Mutations made by a watch list never trigger another watch (no cascades, no loops): compute derived values from the keys the user changes, not from each other. Every key must be declared in `state`.

## Lists: `$repeat`

A list whose length is data is one template instantiated per element of an array expression:

```jsonc
{
  "type": "$repeat",
  "id": "rows",
  "items": { "$expr": "state.rows" },     // an expression of a non-optional array type
  "as": "row",                            // binds `row` and `row_index` inside the template
  "key": { "$expr": "row.id" },           // optional: a string or int expression identifying each instance
  "children": [ { "type": "Text", "id": "name", "properties": { "text": { "$expr": "row.name" }, "role": "body" } } ]
}
```

A `$repeat` carries only `type`, `id`, `items`, `as`, `key`, `children`; it is never the root; `as` must be a fresh identifier (not `state`, `context`, `event`, `result`, `failure`, or an enclosing binding). The instances replace the construct in the parent's children; an empty array renders nothing. Without `key`, instances are referenced by position, `name[0]`, `name[1]`, nested ones `name[1][0]`; with `key`, by the key's rendering, `name[abc]`, so an instance keeps its identity when the array is reordered. Give a list whose elements move, appear, or disappear a `key`; keys must be distinct within the array (a repeated key fails the build, or rejects the update that produced it).

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
| `action-encoding` | A `$set` or array action targets an undeclared state key (`declared state key`), an array action targets a key that is not a non-optional array (`array state key`), a `$update` targets non-record elements (`record element`) or an undeclared field (`declared field`), or a parameter is missing, unknown, or ill-typed |
| `watch` | A `watch` entry names a key `state` does not declare |
| `function-handler` | The document calls a declared host function but the app installed no function handler; ask the app team |
| `action-capability` | The action is not declared in the vocabulary (or not granted to the surface) |
| `repeat` | A `$repeat` rule above was broken; the error says which (`items expression`, `array items`, `binding identifier`, `key expression`, `key type`, `distinct key`, ...) |
| `contract-feature` | The document uses something its declared `version` does not have (`expected 2.1, found key`, or `found $append`, `found watch`, or a host function's name); declare `2.1.0` |
| `context-declaration`, `state-declaration` | A declaration key is not an identifier or its descriptor is invalid |
| `LimitExceeded` | Tree depth, node count, document size, expression length, or a value's size passed the engine's limit |
| `UnsupportedVersion` | The document's `version` is above what the engine implements; use `2.1.0` |

## The vocabulary

```jsonc
{
  "milano": "2.1.0",                                    // the contract version
  "name": "shop",                                       // what documents name in "vocabulary"
  "version": "1.0.0",                                   // bump per the evolution rules
  "components": {
    "Column": { "children": true },
    "Text": { "properties": { "text": "string", "role": { "enum": ["title", "body"] } } },
    "Button": { "properties": { "label": "string", "enabled": "bool" }, "events": { "tap": null } }
  },
  "actions": {
    "openUrl": { "parameters": { "url": "string" } }    // optionally "result": <descriptor>, "failure": <descriptor>
  },
  "functions": {
    "formatMoney": { "arguments": ["int", "string"], "returns": "string" }   // host functions, contract 2.1
  }
}
```

An event's value is `null` (no payload) or a descriptor (the payload type `event` reads). A function's `arguments` is an ordered list of descriptors (at least one) and `returns` the type of its value; the name must not be one of the built-in functions. An action's `result` is the type `result` reads in `onSuccess`, its `failure` the type `failure` reads in `onFailure` (typically an enum of reasons; declare it optional when the app may fail with a plain error). `"strict": true` on a component makes undeclared properties errors. Additive changes (a component, property, event, action, parameter, result, failure, function, or enum member added) are a minor bump; anything removed, retyped (optionality included, a function's arguments or return included), made strict, or losing `children` is a major bump. Every component type needs a renderer in the app, so agree new types with the app team before documents depend on them.

## A complete example

Against the starter vocabulary above:

```json
{
  "version": "2.1.0",
  "vocabulary": { "name": "shop", "min": "1.0.0" },
  "context": { "userName": "string" },
  "state": { "taps": "int", "note": "string?", "seen": "bool", "half": "int" },
  "root": {
    "type": "Column",
    "id": "screen",
    "children": [
      { "type": "Text", "properties": { "text": { "$expr": "$concat('Hello, ', context.userName)" }, "role": "title" } },
      { "type": "Text", "properties": { "text": { "$expr": "state.note ?? 'No note yet'" }, "role": "body" } },
      {
        "type": "Button",
        "id": "tap",
        "properties": { "label": { "$expr": "$if(state.taps == 0, 'Tap me', $concat('Tapped ', $str(state.taps)))" }, "enabled": true },
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
        "properties": { "label": "Read the docs", "enabled": { "$expr": "state.taps > 0 && state.seen" } },
        "on": { "tap": { "action": "openUrl", "url": "https://get-milano.dev" } }
      },
      { "type": "Text", "properties": { "text": { "$expr": "$concat('Rounded: ', $str(state.half))" }, "role": "body" } }
    ]
  },
  "on": { "appear": [ { "action": "$set", "key": "seen", "value": true } ] },
  "watch": { "taps": [ { "action": "$set", "key": "half", "value": { "$expr": "$int($round($double(state.taps) / 2.0))" } } ] },
  "metadata": { "screen": "example" }
}
```

Reference: the guides at https://get-milano.github.io/sdk (Writing documents, Expressions) and the normative specification at https://github.com/get-milano/specs.
