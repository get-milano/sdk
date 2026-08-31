---
title: Expressions
nav_order: 8
---

# Expressions

Expressions bind document properties and action parameters to state, context, and event payloads. The language is deliberately small: pure, total, statically typed at the gate, and specified to the bit so every engine produces identical results. This page is the working reference; the [specification](https://github.com/get-milano/specs) is normative.

## The marker

An expression appears wherever a value can, wrapped as a single-key object:

```json
{ "$expr": "state.consent && !$isEmpty($trim(state.email))" }
```

Anything not wrapped is a literal. There is no string interpolation and no expression syntax inside plain strings.

## References

Five reserved roots, plus the names a `$repeat` binds:

- `state.key` reads a declared state key.
- `context.key` reads a declared context key.
- `event` reads the payload of the event being handled, only inside `on` bindings of events that declare a payload type.
- `result` reads the value the action handler returned, only inside the `onSuccess` bindings of a custom action that declares a `result` type. It rebinds at each nesting (inside a nested action's `onSuccess` it is that action's result) and is never available in `onFailure`.
- `failure` reads the value the action handler failed with, only inside the `onFailure` bindings of a custom action that declares a `failure` type, under the same rules as `result`: exactly the declared type, rebinding at each nesting, never available in `onSuccess`. See [Failure payloads](documents#failure-payloads).
- Inside a `$repeat` template, the construct's `as` name reads the current element and `<as>_index` its position, in property expressions, the construct's `key`, and the template's actions; see [Lists with `$repeat`](documents#lists-with-repeat).
- `event` is never available inside the document's lifecycle bindings (`appear`, `disappear`): those signals carry no payload.

Record fields are read with a dot. Field access requires a non-optional record; resolve optionals with `??` first. This rule is checked at the gate, which is what makes null dereference impossible at runtime. There is no array indexing in contract 2.1; `$repeat` is how a document walks an array, and the array actions are how it edits one.

## Literals

`int` (decimal digits), `double` (digits with a decimal point, no exponent form), `string` (single-quoted, `\'` and `\\` escapes), `true`, `false`, and `null` (valid only where the expected type is optional). An int literal outside the 64-bit range is rejected at the gate.

## Operators

Tightest first; parentheses group. Binary operators associate left except `??`, which associates right.

| Level | Operators | Notes |
|---|---|---|
| 1 | `!`, unary `-` | bool; int or double |
| 2 | `*` `/` `%` | numeric |
| 3 | `+` `-` | numeric; `+` also concatenates when both sides are strings |
| 4 | `<` `<=` `>` `>=` | numeric only |
| 5 | `==` `!=` | scalars of the same type after promotion; optionals comparable to `null`; arrays and records are not comparable |
| 6 | `&&` | short-circuit |
| 7 | `\|\|` | short-circuit |
| 8 | `??` | left optional T, right T, result T |

## Numeric behavior

- When `int` meets `double`, the int is promoted to double and the operation is a double operation.
- Int arithmetic is 64-bit two's complement and wraps on overflow. Division truncates toward zero; `%` takes the sign of the dividend.
- Int division or modulo by zero yields `0` and reports an occurrence to the observer. Evaluation never fails.
- Double arithmetic is IEEE 754 binary64: division by zero gives infinities, `0.0/0.0` gives NaN, NaN compares unequal to everything.

## Functions

The complete set in contract 2.1, every one called through the contract's `$` namespace, the same one as `$set` and `$repeat`. All functions are pure. Arguments are evaluated eagerly, except `$if`, which evaluates only the taken branch, like `&&`, `||`, and `??`. The six numeric functions arrived with contract 2.1: a document must declare `2.1.0` to call them, or the gate refuses it with the `contract-feature` rule naming the function, sigil included (`$abs`).

| Function | Signature | Notes |
|---|---|---|
| `$str(x)` | scalar to string | Locale-independent; doubles use the Milano-defined format, never the platform default |
| `$int(x)` | double to int | Truncates toward zero, saturates at int64 bounds, reports saturation |
| `$double(x)` | int to double | Round-to-nearest |
| `$concat(a, b, ...)` | strings to string | Two or more arguments |
| `$length(x)` | string or array to int | Strings count Unicode scalars |
| `$isEmpty(x)` | string or array to bool | |
| `$contains(s, sub)` | string, string to bool | Literal scalar comparison, no normalization |
| `$startsWith(s, p)` | string, string to bool | |
| `$endsWith(s, p)` | string, string to bool | |
| `$trim(s)` | string to string | Removes Unicode White_Space characters at both ends, from a fixed shared table |
| `$substring(s, from, to)` | string, int, int to string | The scalars from `from` up to `to`, both clamped to the string, so no index is out of range; `from` at or past `to` gives `''` |
| `$indexOf(s, needle)` | string, string to int | The first occurrence as a scalar index, `-1` when absent, `0` for an empty needle |
| `$replace(s, needle, to)` | string, string, string to string | Every non-overlapping occurrence, left to right; an empty needle returns `s` |
| `$split(s, sep)` | string, string to array of string | At least one element always; adjacent separators give empty ones; an empty separator returns one element |
| `$join(a, sep)` | array of string, string to string | The elements with the separator between them; an empty array gives `''` |
| `$if(c, a, b)` | bool, T, T to T | Both branches type-check to exactly the same T, optionality included (resolve a `T?` branch with `??` first; a single `null` branch makes the result `T?`); only the taken branch is evaluated |
| `$abs(x)` | int to int; double to double | The magnitude, keeping the type. Ints wrap: the minimum int stays itself, with no report. Doubles follow IEEE 754: `$abs(-0.0)` is `0.0`, NaN stays NaN |
| `$min(a, b, ...)` | numbers to number | Two or more arguments; int when every argument is int, double otherwise. The result starts as the first argument and is replaced by each later one that is strictly less, so ties keep the leftmost (`$min(0.0, -0.0)` is `0.0`); a NaN anywhere makes the result NaN |
| `$max(a, b, ...)` | numbers to number | As `$min`, with strictly greater |
| `$floor(d)` | double to double | The greatest integral double not above `d`: `$floor(-0.5)` is `-1.0`, `$floor(-0.0)` is `-0.0`; NaN and infinities pass through |
| `$ceil(d)` | double to double | The least integral double not below `d`: `$ceil(-0.5)` is `-0.0` |
| `$round(d)` | double to double | The nearest integral double, ties away from zero: `$round(2.5)` is `3.0`, `$round(-2.5)` is `-3.0`, `$round(-0.4)` is `-0.0`. Never the platform's rounding, whose tie rule differs by language |

## Reading a record by a code

Contract 2.1. `record[key]` picks a field with an enum, so a code becomes a label without a chain of comparisons:

```json
"context": { "statusLabels": { "record": { "ok": "string", "late": "string", "failed": "string" } } },
{ "$expr": "context.statusLabels[state.status]" }
```

The rule that earns it is not the brevity. The enum's members and the record's fields must be **the same set**, so the lookup can never miss at runtime, and adding a member to the enum later fails the build until the record covers it. The `$if` chain it replaces has no such property: its last `else` quietly absorbs every member added after it was written, and the view shows the wrong label with nothing to report.

The key must be an enum. A `string` key is refused, because a string cannot be checked against the fields and the check is the whole point. Every field must share one type, which is the lookup's type.

The mapping is usually data the host already has, which is also where localized strings live: pass it as context and the document stays free of copy.

The string functions are total like the numeric ones: `$substring` clamps rather than failing on an index outside the string and `$indexOf` answers `-1` rather than failing on an absent needle, so neither reports anything. The two guards that look like special cases keep results bounded by their inputs: an empty needle in `$replace` matches at every position, and an empty separator in `$split` would give one element per scalar, so each returns its subject instead. Indices count Unicode scalars, as `$length` does, so a surrogate pair is one position and a slice never splits one.

Masking is what they are for: `$concat('•••• •••• •••• ', $substring(n, $length(n) - 4, $length(n)))` shows the last four digits of a card, and `$join($split(csv, ','), ' / ')` turns a list that arrived as text into a sentence. The card detail demo in the samples does both.

The rounding functions take exactly a double, like `$int()` and `$double()` take exactly their type: `$round(1)` is a `SchemaViolation`. A `$` name the contract does not define, and a built-in's name written without an argument list (`$trim`), are `expression` violations. They return doubles, so `$int($round(d))` is how a document gets an integer, with `int`'s saturation rules. Money in minor units is the idiom: `$str($round(state.amount * 100.0) / 100.0)`.

There are no regular expressions and no case-mapping functions among the built-ins. Validation beyond these functions belongs to the producer or the host; case rules and number, date, and currency formats are locale matters, which is what host functions are for.

## Host functions

Contract 2.1. A vocabulary (or a builder, per surface) declares functions the app computes; a document calls them exactly like built-ins:

```json
"functions": {
  "formatMoney": { "arguments": ["int", "string", "string"], "returns": "string" },
  "relativeDate": { "arguments": ["int", "string"], "returns": "string" }
}
```

```json
{ "$expr": "$concat('Total: ', formatMoney(state.cents, 'EUR', context.locale))" }
```

- **Naming.** A host function is called by its bare name; the contract's own functions carry the `$`. The namespaces are separate and neither falls back to the other, so a vocabulary may declare `round`, `concat`, or any other built-in's name and get its own function beside the contract's. It is also why adding a built-in in a later minor can never invalidate a vocabulary.
- **Typing.** A call takes exactly the declared number of arguments; each is a declared position (an `int` fits a `double` argument, a member literal fits an enum argument, a non-optional fits an optional) and the call has exactly the declared return type. An optional return is resolved with `??`. An unknown name is the `expression` rule; a call in a document declaring `2.0.0` is `contract-feature` naming the function.
- **Purity.** A host function is pure over its arguments: the same arguments always give the same value, for as long as the engine lives. Everything it depends on arrives as an argument, so a locale, a currency, a time zone come from `context` and are passed in; a change to them is an ordinary context update, and the call re-evaluates like any expression reading that key. The engine may evaluate a call as often as it needs and may cache by arguments; a function that reads ambient state instead is stale silently.
- **Invalid results.** A handler that throws, or answers a value outside the declared return type, is reported as `invalidFunctionResult` (the function's name, the declared type, and what arrived, or `error`), and the call evaluates to the zero value of the return type: `false`, `0`, `0.0`, `''`, the first declared member of an enum, `[]`, a record of zero values, `null` for any optional. Evaluation stays total. A function that may have no answer declares an optional return and answers `null`.
- **Where.** Anywhere an expression goes: properties, `$set` values, action parameters, `$when` conditions, `$repeat` items and keys. The engine's function handler answers synchronously on the main thread, so a function is a pure computation, never a fetch; anything with an effect is an action. How the app installs the handler is in [Creating a bridge](bridge#host-functions).

## Typing and totality

Every expression has a static type, determined at the gate. A property expression must type-check to the property's declared type; a mismatch is a `SchemaViolation` before any view exists. A non-optional `T` is accepted wherever `T?` is expected, and an `int` expression wherever a `double` is declared (it is promoted at evaluation); neither holds in reverse. The practical idiom for an optional result is `$if(condition, value, null)`; to combine an optional with a non-optional inside `if`, resolve the optional first: `$if(c, state.note ?? '', 'x')`.

After the gate, evaluation is total: no type errors, no null dereference, no failures. The conformance suite exercises every boundary above, on every engine.
