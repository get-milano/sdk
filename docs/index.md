---
title: Home
nav_order: 0
---

# Milano SDK

Milano is a client-only, design-system-agnostic **Document-Driven UI (DDUI)** framework for **SwiftUI**, **Compose**, and **React / React Native**. A JSON document describes the structure of a piece of UI, its state and context declarations, and the actions it can request. The engine validates the document against a vocabulary you define, then renders it with **your** components. Milano never draws a pixel of its own.

This site documents the engines and how to consume them. The normative contract lives in the [specification](https://github.com/get-milano/specs): the document model, the vocabulary schema, the expression language, the runtime semantics, and the conformance suite every engine is green against.

## What the contract does

- **Banners and interstitials.** Documents describing promotional or informational surfaces, rendered with your components, with expressions binding text and visibility to injected context.
- **Simple forms.** Documents defining fields, required markers, validation errors, conditional visibility, and a submit action, with all values flowing through state the host provides.
- **Whole screens beyond those targets.** The same mechanics carry user profile screens, and intermediate screens like a catalog, whose structure changes more often than their components. The sample apps ship both: a profile screen driven by context and state, and a catalog of tappable item cards, one `$repeat` over the items the host supplies, whose taps open each item's page through `openUrl`.

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

From 1.0.0 the SDK follows semantic versioning: within a major version, releases are additive. Every engine implements the same contract (contract 2.0 of the specs, which keeps every 1.x document valid unchanged) and passes the same conformance suite. Mechanics are identical to the bit: expression results, error taxonomy, dispatch ordering, and reporting behave the same everywhere. The TypeScript packages arrived in 1.1.0; they implement the same contract.

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
13. [Coverage](coverage): how much of each engine its tests reach, regenerated on every docs build.
14. [User interaction analytics](analytics): the engine-captured interaction stream (impressions, taps, dispatches, outcomes) plus renderer-reported widget signals, delivered to one host sink.
15. [Migrating](migrating): what changes for consumers between major versions, by audience.

## License

The engines are licensed under Apache-2.0. Redistributions must preserve the attribution in the NOTICE file. Milano, the Milano logo, and get-milano.dev are owned by Ezequiel (Kimi) Aceto. The specification is licensed under CC BY 4.0.
