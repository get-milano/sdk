# Changelog

What changed for people consuming the SDK. Every release implements the
same contract version of the [specs](https://github.com/get-milano/specs);
where a release changes what the engines do rather than what they offer,
it says so.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [semantic versioning](https://semver.org): within a
major, documents, vocabularies, and integrations keep working.

## 1.2.0

### Added

- **TypeScript bindings generator.** `tools/generate_bindings.py` in the
  specs repository now emits TypeScript alongside Swift and Kotlin: a class
  per component whose getters return the declared types (never `string |
  null` where the vocabulary says non-optional), typed event emitters, and
  a discriminated union for actions whose `switch` is exhaustive. The React
  Native sample is built from it.
- **A coverage page**, [get-milano.dev/sdk/coverage](https://get-milano.dev/sdk/coverage),
  regenerated on every docs build, reporting each engine's test coverage
  through its own toolchain.
- **A TypeScript benchmark suite**, matching the Swift and Kotlin ones, so
  the performance page can speak for all three engines.

### Changed

- The Compose engine builds with **AGP 9** and **Gradle 9.7**. Consuming
  the published artifact is unaffected; building the engine from source as
  a composite build now requires Gradle 9.6 or newer.
- The published Android artifact imposes no `compileSdk` floor. The AGP 9
  migration briefly would have demanded 36 from every consumer; a CI gate
  now asserts it stays unconstrained.

- **The supported React range is now tested, not just declared.** The
  binding's peer range stays `react: >=18`, and CI mounts the packed
  package on each supported major in its own project. The floor is React
  18 because the binding subscribes through `useSyncExternalStore`. On
  React Native the supported floor is 0.85 on the new architecture, which
  is what the sample runs; nothing here imports a React Native API, so
  older releases are likely to work but are untested.

### Fixed

- The React Native sample's `card` layout draws its image above the
  content rather than behind it, and its `strip` layout draws the slim
  tinted row the other two samples draw. `strip` had no branch at all and
  fell through to the overlay, so the same document rendered as a
  full-height photo banner. The layouts are now dispatched exhaustively,
  which makes an unhandled one a compile error. Sample only; no engine
  change.
- **All three sample apps wear the Milano logo**, on the icon and on the
  launch screen. The React Native app had shipped the stock Android robot
  and Expo's placeholder splash since it was created; the other two had
  the real icon but no launch image at all. Every asset is now derived
  from two committed masters by `samples/scripts/generate-app-assets.py`,
  and a CI check compares the three so they cannot drift apart again.
- The three sample apps can be installed side by side. The React Native
  sample claimed `dev.getmilano.sample` on both platforms, the same
  identifier the SwiftUI and Compose samples use on theirs, so installing
  it replaced whichever native sample was already on the device. It is now
  `dev.getmilano.sample.reactnative`, in `app.json` and in the committed
  native projects that actually build.
- The React Native sample no longer fails to start with `Incompatible
  React versions`. Its test dependency on `react-test-renderer` carried a
  peer range that pulled `react` past the exact build react-native's
  bundled renderer was compiled against. The sample now pins `react`
  exactly, and a CI check keeps every manifest in the workspace naming the
  version react-native asks for. Sample and tooling only; the published
  binding never constrained React and still does not.

## 1.1.2

### Fixed

- Documentation and release pipeline only. No engine changes.

## 1.1.1

### Fixed

- Release pipeline only. No engine changes.

## 1.1.0

### Added

- **TypeScript and React.** Two new packages on npm: `@get-milano/core`,
  the contract engine with no dependencies and no UI toolkit, and
  `@get-milano/react`, the binding for React and React Native. Both pass
  the same 256 conformance vectors as the Swift and Kotlin engines. There
  is no React Native package: nothing about Milano is platform-specific,
  so the same binding serves the web and React Native.
- **A React Native sample app**, rendering the same documents as the
  SwiftUI and Compose samples.
- **Accessibility as vocabulary design**: optional declared properties for
  labels, hints, decorative images, and live regions, with the mappings
  each platform makes documented and demonstrated.
- **User interaction analytics**: a stream separate from engine
  observability, carrying impressions, events, dispatches, and completion
  outcomes, plus widget signals renderers report. Milano implements no
  tracker; records reach the host unredacted.
- **Enumerated types** in vocabularies, with structural identity and
  membership-checked comparison.
- **Typed completion results**: an action may declare a `result`, which
  the handler returns and the document reads as the `result` root inside
  `onSuccess`.

### Fixed

- **A throwing observer no longer wedges the work queue.** An exception
  raised by a listener left the queue marked as draining, so every later
  emission was enqueued and never run: the view went silently dead. Fixed
  in all three engines, which now release the queue however the drain
  ends.

## 1.0.0

First stable release. The contract, the conformance suite, and two
engines: SwiftUI and Compose. From here the SDK follows semantic
versioning.
