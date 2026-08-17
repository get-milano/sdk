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
- **MilanoBridge** is the only layer that knows both sides. It owns the vocabulary artifact, converts `MilanoNode` properties into design-system models, wraps design-system components in renderers, and exposes one registry factory that registers everything.
- **App / Environment** creates the engine once, owns shared context, builds views per document, and routes custom actions to platform behavior.

## Rules that keep the seams clean

**The design system never imports Milano.** The moment a visual component reads a `MilanoNode`, you have coupled appearance to the document format and lost independent previews and reuse. Conversion belongs in the bridge, in model initializers.

**One initializer per model, next to the renderer.** Give each design-system model an initializer that takes a `MilanoNode` (or a node property set) and lives in the bridge. The renderer body then reads as: convert, delegate.

**One registry factory.** Expose a single function in the bridge that returns the fully populated registry. Engine creation fails fast with `IncompleteRegistry` when a vocabulary type has no renderer, so a single factory keeps the failure impossible to reach in a shipped app.

**One engine per vocabulary, created once.** Engines are immutable and thread-safe; share one instance. Builders are cheap and per-document.

**Route actions in one funnel.** The action handler receives every custom action from every document built by that builder. Route by `action.name` in one place, translating to host behavior (open URL, submit form, dismiss). Throw (or complete with failure) when the action fails: the document may declare `onFailure` follow-ups, and your handler's outcome drives them.

**Share context through a handle.** For values that change while views are on screen (user name, feature flags, consent requirements), create one `MilanoContextHandle`, pass it to every builder, and update it from your session layer. Updates are atomic and validated; views re-evaluate automatically.

**Treat documents as untrusted input.** Never assume a build succeeds. Give `MilanoHost` a real loading view and a deliberate failure branch. For optional surfaces like banners, the correct failure UI is usually nothing at all.

**Decide the unknown-type policy consciously.** `skip` keeps old app versions rendering new documents gracefully and is the right default for optional surfaces. `fail` is right when partial UI would be misleading. `placeholder` needs a registered placeholder renderer and is mostly a development aid.

## Conventions the samples use

- **Visibility.** A `visible` bool property on components, evaluated from context or state, with the renderer returning nothing when false. Conditional UI stays in the document, appearance stays in the renderer.
- **Required markers and errors.** Fields carry `required` and `error` properties; the error text is an expression, so validation messages react to state without host code.
- **Dismissal.** The vocabulary declares a `dismiss` action; the interstitial's builder installs the handler that routes it to navigation. Meaning is surface-owned: the same action name can do something else on another screen, and its signature can be overridden per builder.

## Quality gates

The engines and samples hold themselves to zero lint violations (SwiftLint, ktlint with `ktlint_official`) and a green conformance suite on both platforms. If you extend the engines, the same gates apply: the conformance suite is the definition of done, and a spec change comes before an implementation change.
