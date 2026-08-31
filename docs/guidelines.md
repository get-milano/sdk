---
title: Guidelines
nav_order: 4
---

# Guidelines

How to structure an app that consumes Milano. The sample apps in `samples/` follow every rule on this page.

## The three layers

Keep Milano behind a bridge. The recommended structure has three layers with one-way knowledge:

```
App / Environment
      |  owns engine, context handle, action routing
      v
MilanoBridge
      |  vocabulary, model initializers, renderers, registry factory
      v
DesignSystem
         pure UI components, zero Milano imports
```

- **DesignSystem** contains your visual components: banner layouts, styled text, buttons, fields, toggles. Components take plain models and closures. This layer must not import Milano; it must remain usable, previewable, and testable without a single document in sight.
- **MilanoBridge** is the only layer that knows both sides. It owns the vocabulary artifact, converts `MilanoNode` properties into design-system models, wraps design-system components in renderers, and exposes one registry factory that registers everything. In a React app this is one module (`milano-bridge.tsx` in the sample), not a package boundary, but the rule is the same.
- **App / Environment** creates the engine once, owns shared context, builds views per document, and routes custom actions to platform behavior.

## Rules that keep the seams clean

**The design system never imports Milano.** The moment a visual component reads a `MilanoNode`, you have coupled appearance to the document format and lost independent previews and reuse. Conversion belongs in the bridge, in model initializers.

**One initializer per model, next to the renderer.** Give each design-system model an initializer that takes a `MilanoNode` (or a node property set) and lives in the bridge. The renderer body then reads as: convert, delegate.

**One registry factory.** Expose a single function in the bridge that returns the fully populated registry. Engine creation fails fast with `IncompleteRegistry` when a vocabulary type has no renderer, so a single factory keeps the failure impossible to reach in a shipped app.

**One engine per vocabulary, created once.** Engines are immutable and thread-safe; share one instance. Builders are cheap and per-document.

**Route actions in one funnel.** The action handler receives every custom action from every document built by that builder. Route by `action.name` in one place, translating to host behavior (open URL, submit form, dismiss). Throw (or complete with failure) when the action fails: the document may declare `onFailure` follow-ups, and your handler's outcome drives them. When the action declares a `failure` type, fail with `MilanoActionFailure` carrying a value of that type, and map every other error to one: against a non-optional declaration a plain error is an invalid completion and neither branch runs. Send `action.dispatchId` with the request the handler makes: it is unique per dispatch across the process, so a retried request is recognizably the same dispatch. The handler is also the last capability check: the gate proved the parameters have their declared types, not that their values are safe, so validate them before acting (the samples open only `https` URLs with a host, and a real app narrows that to its own hosts) and never route an action name generically into deep links, reflection, or evaluation.

**Answer host functions from one handler, and keep them pure.** The engine's function handler is where formatting lives: money, dates, plurals, units, computed from the arguments alone. Take the locale from the call's arguments (the document passes `context.locale`), never from the process, so a locale change is a context update that re-renders and not a stale label. A handler that throws or answers the wrong type degrades one value to its zero, reported as `invalidFunctionResult`; watch that occurrence in development the way you watch `undeclaredProperty`.

**Replace, do not rebuild, when the document changes under the user.** `view.replace(document)` keeps every state key whose declaration is unchanged, so a refreshed or hot-reloaded document lands without losing what the user typed; a replacement that fails leaves the view as it was, so the failure branch is a log line, not a blank screen.

**Let the host container deliver the lifecycle.** `MilanoHost` calls `appear()` and `disappear()` on the view from the toolkit's own presentation callbacks, so a document's `appear` and `disappear` bindings run without host code. A host that awaits `build()` and places the view itself makes the same two calls from its own callbacks; a view that is never told it appeared never runs its `appear` bindings.

**Share context through a handle.** For values that change while views are on screen (user name, feature flags, consent requirements), create one `MilanoContextHandle`, pass it to every builder, and update it from your session layer. Updates are atomic and validated; views re-evaluate automatically.

**Treat documents as untrusted input.** Never assume a build succeeds. Give `MilanoHost` a real loading view and a deliberate failure branch. For optional surfaces like banners, the correct failure UI is usually nothing at all. For a screen, the pattern is a skeleton and a fallback:

- **Loading.** `MilanoHost`'s `loading` content shows while the gate validates and the state data provider is awaited. Make it the screen's skeleton (the same shapes, no data), and keep the provider fast: a document is cacheable independently of its data, so the wait is the data's, not the document's.
- **Failure.** `MilanoHost`'s `failure` content receives the typed error. Log it with its rule and node (that is the producer's bug report), and show a document you ship with the app: a second `MilanoHost` over a bundled fallback that the app's own tests build at every release, so it cannot fail. The same fallback serves an offline first launch. `replace()` then upgrades it to the real document when that arrives, keeping whatever the user did in the meantime if the declarations match.

The samples' `DemoScreen`s show the failure's rule and node in place, which is right for a demo; a shipped app shows the fallback and reports the rule.

**In React, keep the builder stable and load documents as text.** A new builder means a new build, so create it at module scope or in a `useMemo` keyed on what actually changes; passing a fresh builder every render rebuilds the view on every render. And never `import doc from "./doc.json"`: `JSON.parse` collapses `5.0` to `5`, and Milano's `int` and `double` are different types. Hand the engine the document's text and let it parse. The same trap catches data you feed a context source or a state data provider from an API response: use the SDK's own `parseJson`, which preserves the distinction, rather than the platform's JSON reader.

**Decide the unknown-type policy consciously.** `skip` keeps old app versions rendering new documents gracefully and is the right default for optional surfaces. `fail` is right when partial UI would be misleading. `placeholder` needs a registered placeholder renderer and is mostly a development aid.

## Conventions the samples use

- **Visibility.** A `visible` bool property on components, evaluated from context or state, with the renderer returning nothing when false. Conditional UI stays in the document, appearance stays in the renderer.
- **Required markers and errors.** Fields carry `required` and `error` properties; the error text is an expression, so validation messages react to state without host code.
- **Dismissal.** The vocabulary declares a `dismiss` action; the interstitial's builder installs the handler that routes it to navigation. Meaning is surface-owned: the same action name can do something else on another screen, and its signature can be overridden per builder.
- **Impressions.** The interstitial binds `track` to its `appear` and `disappear` signals, so the document itself reports when it was seen; the handler forwards to whatever tracker the app has.
- **Failure reasons.** `submitContact` declares an enum failure (`invalidEmail`, `unavailable`); the handler maps every error to one, and the document turns the reason into the message it shows. Copy stays in the document, mapping stays in the app.
- **Keyed lists.** The catalog keys its `$repeat` on each item's `id`, so a card keeps its identity when the list changes; the state data provider supplies the id with the rest of the record.

## Lint and format

- **Swift**: `swiftlint --strict` from the SDK root, over the engine, its
  tests, and the SwiftUI sample. 130 columns.
- **Kotlin**: `scripts/lint-kotlin.sh` from the SDK root, over the engine
  and both Compose samples; `--format` rewrites what it can. One script
  defines the file set, so CI and a laptop lint the same files. Note that
  ktlint does not measure the length of KDoc lines, which is how a
  229-column generated comment once went unnoticed; the generated bindings
  are length-checked by `scripts/check-consistency.mjs` instead.
- **TypeScript**: `npm run typecheck` at the SDK root. There is no
  formatter: expressions and whole documents are embedded in these sources
  as string literals, and a formatter that reflowed them would fight the
  contract rather than help it. The generated bindings are length-checked
  like the others.

## Quality gates

The engines and samples hold themselves to zero lint violations (SwiftLint, ktlint with `ktlint_official`, TypeScript `strict`) and a green conformance suite on every platform. If you extend the engines, the same gates apply: the conformance suite is the definition of done, and a spec change comes before an implementation change.
