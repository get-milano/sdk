---
title: Home
nav_order: 0
---

# Milano SDK

Milano is a client-only, design-system-agnostic **Document-Driven UI (DDUI)** framework for **SwiftUI** and **Compose**. A JSON document describes the structure of a piece of UI, its state and context declarations, and the actions it can request. The engine validates the document against a vocabulary you define, then renders it with **your** components. Milano never draws a pixel of its own.

This site documents the engines and how to consume them. The normative contract lives in the [specification](https://github.com/get-milano/specs): the document model, the vocabulary schema, the expression language, the runtime semantics, and the conformance suite both engines are green against.

## What v1 does

- **Banners and interstitials.** Documents describing promotional or informational surfaces, rendered with your components, with expressions binding text and visibility to injected context.
- **Simple forms.** Documents defining fields, required markers, validation errors, conditional visibility, and a submit action, with all values flowing through state the host provides.

## What Milano is not

- **Not server-driven UI.** Milano does not know or care where documents come from. Bundle them, cache them, fetch them: obtaining the document is the host's job.
- **Not a SaaS.** There is no backend, no console, no account. Milano is a library you embed.
- **Not a design system.** Milano ships zero components. Every visible element is rendered by code you register.

## The two engines

| | SwiftUI | Compose |
|---|---|---|
| Language | Swift 6, strict concurrency | Kotlin Multiplatform |
| Module | `MilanoSDK` (Swift Package) | `dev.get-milano:engine-compose` |
| Package | `import MilanoSDK` | `dev.getmilano` |
| Runs on | iPhone, iPad, macOS, watchOS | Android, JVM |

Both engines implement the same contract and pass the same conformance suite. Mechanics are identical to the bit: expression results, error taxonomy, dispatch ordering, and reporting behave the same on both platforms.

## Where to go next

1. [Playground](https://get-milano.github.io/playground/): try vocabularies and documents in the browser, nothing to install.
2. [Getting started](getting-started): install an engine and render a first document.
3. [Samples](samples): the demo apps on both platforms, with screenshots.
4. [Philosophy](philosophy): the ideas the design follows.
5. [Guidelines](guidelines): the recommended app architecture.
6. [Creating a bridge](bridge): connect Milano to your design system.
7. [Writing documents](documents): the document format from a producer's view.
8. [Expressions](expressions): the expression language reference.
9. [Guardrails](guardrails): errors, policies, limits, and observability.

## License

The engines are licensed under Apache-2.0. Redistributions must preserve the attribution in the NOTICE file. Milano, the Milano logo, and get-milano.dev are trademarks of Ezequiel Aceto. The specification is licensed under CC BY 4.0.
