---
title: Home
nav_order: 0
---

# Milano SDK

Milano is a client-only, design-system-agnostic **Document-Driven UI (DDUI)** framework for **SwiftUI**, **Compose**, and **React / React Native**. A JSON document describes the structure of a piece of UI, its state and context declarations, and the actions it can request. The engine validates the document against a vocabulary you define, then renders it with **your** components. Milano never draws a pixel of its own.

This site documents the engines and how to consume them. The normative contract lives in the [specification](https://github.com/get-milano/specs): the document model, the vocabulary schema, the expression language, the runtime semantics, and the conformance suite every engine is green against.

## What the contract does

Document-driven UI of any size, with one set of mechanics:

- **Fragments in native screens.** A banner, a row of quick actions, a form embedded between native components: documents describing structure, with expressions binding text, visibility, and enablement to injected context and state.
- **Forms and flows.** Fields, required markers, validation errors, conditional visibility, a submit action with a typed result on success and a typed failure payload on failure, in-flight state, all flowing through state the host provides.
- **Whole screens.** A profile driven by context and state, a catalog or an inbox of cards repeated from data with keyed identity and edited in place, a detail page, a confirmation flow; documents that react to the host's lifecycle signals, to their own state, and that format values through functions the app provides. The sample apps ship a profile, a keyed catalog, an interstitial that tracks its appearances, and a form that turns failure reasons into messages.

## Every feature, and where it is explained

One row per capability the contract or the runtime gives you, so nothing
here is something you have to discover by reading source.

| Feature | What it is | Guide |
|---|---|---|
| Document envelope | `version`, `vocabulary`, `context`, `state`, `root`, `metadata` | [Writing documents](documents#the-envelope) |
| Types | `bool`, `int`, `double`, `string`, enums, arrays, records, optionality | [Writing documents](documents#types) |
| Nodes, properties, events | What a renderer receives and emits | [Writing documents](documents#nodes) · [Creating a bridge](bridge) |
| Expressions | Roots, operators, and the 17 `$` built-ins | [Expressions](expressions) |
| Host functions | Typed functions your app computes, called from documents | [Expressions](expressions#host-functions) · [Creating a bridge](bridge#host-functions) |
| State mutation | `$set`, and `$append` / `$remove` / `$update` for one element of a list | [Writing documents](documents#actions) |
| Sequencing and branching | `$sequence`, `$when` | [Writing documents](documents#actions) |
| Custom actions | Dispatch to your handler, with `onSuccess` / `onFailure` | [Writing documents](documents#actions) · [Creating a bridge](bridge#the-action-funnel) |
| Completion results | A typed value the handler returns, bound to `result` | [Writing documents](documents#actions) |
| Failure payloads | A typed reason the handler fails with, bound to `failure` | [Writing documents](documents#failure-payloads) |
| Dispatch identity | `dispatch` and `dispatchId`, the idempotency key | [Creating a bridge](bridge#the-action-funnel) |
| Lists | `$repeat`, and `key` for identity that survives reordering | [Writing documents](documents#lists-with-repeat) |
| Lifecycle | `appear` and `disappear` bindings, delivered by the host | [Writing documents](documents#lifecycle) · [Creating a bridge](bridge#lifecycle-signals) |
| Watch | Action lists that run when a state key changes | [Writing documents](documents#watch) |
| Document replacement | Swap a live view's document, keeping matching state | [Creating a bridge](bridge#replacing-a-document) |
| Capability grants | Narrow or extend what one surface may dispatch | [Creating a bridge](bridge#granting-capabilities-per-surface) |
| Context and state input | Context sources, handles, and the state data provider | [Guidelines](guidelines#rules-that-keep-the-seams-clean) |
| Driving a view yourself | `subscribe`, `resolvedRoot`, `dispatched`, and the calls `MilanoHost` makes for you | [Creating a bridge](bridge#driving-a-view-yourself) |
| Unknown types | Skip, fail, or placeholder, per engine and per view | [Guardrails](guardrails#unknown-type-policies) |
| Errors and occurrences | Every rule, every occurrence, and what each carries | [Guardrails](guardrails) |
| Analytics | The interaction stream, from impression to outcome | [Analytics](analytics) |
| Limits | Depth, node count, size, expression length, value size | [Guardrails](guardrails#limits) |
| Accessibility | Semantics as vocabulary design | [Accessibility](accessibility) |
| Typed bindings | Generated Swift, Kotlin, and TypeScript from a vocabulary | [Creating a bridge](bridge#7-generated-typed-bindings) |
| Producer toolchain | `milano init`, `validate`, `schema`, `diff`, `bindings` | [Producing documents](producing) |
| Vocabulary evolution | What is additive, what is breaking, and how it is checked | [Creating a bridge](bridge#growing-the-vocabulary) · [Producing documents](producing#change-the-vocabulary) |

## What Milano is not

- **Not server-driven UI.** Milano does not know or care where documents come from. Bundle them, cache them, fetch them: obtaining the document is the host's job.
- **Not a SaaS.** There is no backend, no console, no account. Milano is a library you embed.
- **Not a design system.** Milano ships zero components. Every visible element is rendered by code you register.

## The engines

| | SwiftUI | Compose | React / React Native |
|---|---|---|---|
| Language | Swift 6, strict concurrency | Kotlin Multiplatform | TypeScript, zero dependencies |
| Module | `MilanoSDK` (Swift Package) | `dev.get-milano:engine-compose` | `@get-milano/core` (npm) |
| Package | `import MilanoSDK` | `dev.getmilano` | `@get-milano/react` (the binding; no React Native package needed) |
| Runs on | iPhone, iPad, macOS, watchOS | Android, JVM | Browsers, React Native (iOS, Android), Node |

From 1.0.0 the SDK follows semantic versioning: within a major version, releases are additive. Every engine implements the same contract (contract 2.1 of the specs, which keeps every 1.x and 2.0 document valid unchanged) and passes the same conformance suite. Mechanics are identical to the bit: expression results, error taxonomy, dispatch ordering, and reporting behave the same everywhere. The TypeScript packages arrived in 1.1.0; they implement the same contract.

## Where to go next

1. [Playground](https://get-milano.dev/playground/): try vocabularies and documents in the browser, nothing to install.
2. [Getting started](getting-started): install an engine and render a first document.
3. [Samples](samples): the demo apps on every platform, with screenshots.
4. [Philosophy](philosophy): the ideas the design follows.
5. [Guidelines](guidelines): the recommended app architecture.
6. [Creating a bridge](bridge): connect Milano to your design system.
7. [Producing documents](producing): the producer's workflow, from `milano init` to CI, vocabulary evolution, and working with an AI agent.
8. [Writing documents](documents): the document format from a producer's view.
9. [Expressions](expressions): the expression language reference.
10. [Guardrails](guardrails): errors, policies, limits, and observability, with every rule and occurrence detail.
11. [Performance](performance): measured baselines, threading model, and working budgets.
12. [Accessibility](accessibility): assistive-technology semantics as vocabulary design, with the sample mappings for each platform.
13. [API reference](api-reference): the generated reference for each engine, for looking a type up once you are building.
14. [Coverage](coverage): how much of each engine its tests reach, regenerated on every docs build.
15. [User interaction analytics](analytics): the engine-captured interaction stream (impressions, taps, dispatches, outcomes) plus renderer-reported widget signals, delivered to one host sink.
16. [Migrating](migrating): what changes for consumers between major versions, by audience.

## License

The engines are licensed under Apache-2.0. Redistributions must preserve the attribution in the NOTICE file. Milano, the Milano logo, and get-milano.dev are owned by Ezequiel (Kimi) Aceto. The specification is licensed under CC BY 4.0.
