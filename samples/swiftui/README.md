# Milano SwiftUI sample

The same demos as the Compose, Compose Desktop, and React Native samples, rendered from the same documents, on iOS and macOS. What differs is only the design system doing the drawing: `DesignSystem/` is ordinary SwiftUI with no Milano in it, and `MilanoBridge/` is the one doorway between the two.

```sh
tuist generate                      # the project is generated, not committed
open MilanoSDK.xcworkspace
MILANO_SCREEN=quick-actions         # on the run scheme, opens one demo directly
```

`MILANO_SCREEN` takes any demo id (`banner`, `banner-card`, `banner-strip`, `form`, `tip-calculator`, `checkbox-gate`) plus `quickstart`, `pokemon`, `profile`, `catalog`, `quick-actions`, `embedded`, and `interstitial`. It mirrors the launch extra in the Compose sample, and it is what the screenshot automation drives.

The engine is consumed as the Swift package at the repository root, so an engine edit is in the next build with nothing to publish. Consumers depend on the tagged release instead, which resolves a prebuilt, signed XCFramework.

## What to read first

- `MilanoBridge/MilanoBridge.swift`: every component type mapped to a renderer, and nothing else.
- `MilanoBridge/GeneratedBindings.swift`: **generated**, never edited. `text.role` is an enum because the vocabulary says so, and a vocabulary change that breaks a renderer fails the compile instead of surfacing as an empty label.
- `Services/SampleEnvironment.swift`: one engine, one action handler, one analytics sink, shared by every screen.

## Build steps

Before every compile, a build phase regenerates `GeneratedBindings.swift` from `vocabulary.json` (`milano bindings`), refreshes `documents.schema.json` for editors (`milano schema`), and validates every bundled document with the gate the engines run (`milano validate`: a document the engines would reject fails the build here, with the same typed error). The three commands come from `@get-milano/cli`; inside this repository they run from the workspace build of the CLI, so `npm ci && npm run build` at the repository root comes first.

Xcode does not see a login shell's `PATH`, so a Node installed by nvm, fnm, volta, asdf, or mise is invisible to that build phase even though `node` works in every terminal. `Scripts/find-node.sh` looks in those managers' locations and explains itself when it cannot find one; if yours lives elsewhere, name it once:

```sh
echo "export MILANO_NODE=$(command -v node)" > Scripts/.xcode.env.local
```
