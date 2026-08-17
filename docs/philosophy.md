---
title: Philosophy
nav_order: 3
---

# Philosophy

The design of Milano follows a small number of ideas, applied consistently. Knowing them makes the API surface predictable: when in doubt, the engine does the thing these principles imply.

## Document-driven, not server-driven

Milano is deliberately named DDUI, not SDUI. The unit of exchange is a document; where it comes from is not Milano's concern. A document bundled in the app, cached on disk, or fetched over the network is treated identically. This keeps the engine free of networking, caching policy, and delivery concerns, and keeps those decisions where they belong: in the host.

## Structure without data

Documents carry structure and declarations, never data values. A form document declares that `state.email` is a `string`; it never contains an email address. Values are injected at build time (state data provider), at render time (context source), and at interaction time (event payloads). The consequence is cacheability: the same document bytes serve every user, every session, every locale.

## The gate: Milano's rendering never fails because building may

Every Milano check that could fail happens before a view exists: parsing, schema validation, vocabulary conformance, expression type checking, limits, state data validation. This is the construction gate, and it is all-or-nothing. A document that passes the gate renders totally as far as Milano's mechanics reach: no type errors, no null dereference, no division failures, no validation surprises after the gate. A document that does not pass produces exactly one typed error and no view. There is no half-rendered state. What the gate cannot promise is your code: renderers, action handlers, and the resources they load remain ordinary software with ordinary failure modes; the gate guarantees they receive validated, typed input, not that they succeed.

## Design-system agnostic, mechanics exact

Milano owns mechanics and stays out of appearance. What Milano fixes exactly: expression evaluation to the bit, dispatch ordering, error taxonomy, validation rules. What Milano never touches: colors, fonts, spacing, animation, layout conventions. Two apps rendering the same document can look completely different and behave identically.

## Two engines, one contract

The SwiftUI and Compose engines are independent implementations of one specification, kept honest by a shared conformance suite of executable vectors. Neither engine is the reference; the specification is. A behavior difference between the engines is by definition a bug in at least one of them.

## Toolkits, not operating systems

Milano targets SwiftUI and Compose, the UI toolkits, not iOS and Android, the operating systems. The SwiftUI engine runs wherever SwiftUI runs: iPhone, iPad, macOS, watchOS. The Compose engine is Kotlin Multiplatform and runs on Android and the JVM.

## Small closed core

The document model, the expression language, and the action set are deliberately small and closed. There are no escape hatches inside documents: no scripting, no reflection, no regular expressions, no platform calls. Anything a document cannot express is expressed by the host through custom actions and context. Growth happens by versioned contract change, not by loosening the core.

## Untrusted input as a stance

Documents are input, and input can be hostile or broken. Limits (depth, node count, size, expression length) are enforced at the gate. Malformed content produces typed errors, not crashes. Integer overflow wraps, division by zero yields a defined result and a report. The engine's failure modes are enumerable, and all of them are visible to the host.
