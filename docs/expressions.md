---
title: Expressions
nav_order: 7
---

# Expressions

Expressions bind document properties and action parameters to state, context, and event payloads. The language is deliberately small: pure, total, statically typed at the gate, and specified to the bit so both engines produce identical results. This page is the working reference; the [specification](https://github.com/get-milano/specs) is normative.

## The marker

An expression appears wherever a value can, wrapped as a single-key object:

```json
{ "$expr": "state.consent && !isEmpty(trim(state.email))" }
```

Anything not wrapped is a literal. There is no string interpolation and no expression syntax inside plain strings.

## References

Three reserved roots, and only these:

- `state.key` reads a declared state key.
- `context.key` reads a declared context key.
- `event` reads the payload of the event being handled, only inside `on` bindings of events that declare a payload type.

Record fields are read with a dot. Field access requires a non-optional record; resolve optionals with `??` first. This rule is checked at the gate, which is what makes null dereference impossible at runtime. There is no array indexing in v1.

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

The complete v1 set. All functions are pure, and all arguments are evaluated.

| Function | Signature | Notes |
|---|---|---|
| `str(x)` | scalar to string | Locale-independent; doubles use the Milano-defined format, never the platform default |
| `int(x)` | double to int | Truncates toward zero, saturates at int64 bounds, reports saturation |
| `double(x)` | int to double | Round-to-nearest |
| `concat(a, b, ...)` | strings to string | Two or more arguments |
| `length(x)` | string or array to int | Strings count Unicode scalars |
| `isEmpty(x)` | string or array to bool | |
| `contains(s, sub)` | string, string to bool | Literal scalar comparison, no normalization |
| `startsWith(s, p)` | string, string to bool | |
| `endsWith(s, p)` | string, string to bool | |
| `trim(s)` | string to string | Removes Unicode White_Space characters at both ends, from a fixed shared table |
| `if(c, a, b)` | bool, T, T to T | Both branches type-check to the same T; both are evaluated |

There are no regular expressions and no case-mapping functions in v1. Validation beyond these functions belongs to the producer or the host; case rules are locale matters and belong to renderers.

## Typing and totality

Every expression has a static type, determined at the gate. A property expression must type-check to the property's declared type; a mismatch is a `SchemaViolation` before any view exists. A non-optional `T` is accepted wherever `T?` is expected; the reverse never holds. The practical idiom for an optional result is `if(condition, value, null)`.

After the gate, evaluation is total: no type errors, no null dereference, no failures. The conformance suite exercises every boundary above, on both engines.
