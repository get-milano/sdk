# Changelog

What changed for people consuming the SDK. Every release implements the
same contract version of the [specs](https://github.com/get-milano/specs);
where a release changes what the engines do rather than what they offer,
it says so.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [semantic versioning](https://semver.org): within a
major, documents, vocabularies, and integrations keep working.

## 2.0.0

A major: contract 2.0 and the `$repeat` construct, the CLI as the
producer's toolchain, and detail strings that name limits. What to change
when moving from 1.x is in [Migrating](docs/migrating.md).

### Added

- **`$repeat` on every engine.** A node of type `$repeat` (`items` array
  expression, `as` binding, template `children`) instantiates its template
  once per element; the instances take its place, referenced as `card[2]`,
  and the element and `<as>_index` are readable in the template's
  expressions and actions. 2.x documents only. The catalog sample and a
  playground example use it; see [Documents](docs/documents.md).
- **`milano schema`, `milano diff`, `milano bindings`.** The CLI ports
  the specs repository's document schema generator, vocabulary diff, and
  bindings generator, byte for byte (CI runs both over every vocabulary
  and compares); producers need neither Python nor a specs checkout. The
  four samples run their build steps through the CLI.
- **`milano init`.** Scaffolds a producer folder: a starter vocabulary, a
  first document that uses all of it, the editor schema and settings, and
  a package.json whose `check` script regenerates the schema and validates
  every document, and the files an AI agent authors from: an authoring
  skill (`.claude/skills/milano-authoring/SKILL.md`), `AGENTS.md`, and
  `CLAUDE.md`.
- **Docs.** [Producing documents](docs/producing.md), the producer's
  workflow end to end; [Migrating](docs/migrating.md); the `SchemaViolation`
  rule table and the occurrence detail table surfaced in
  [Guardrails](docs/guardrails.md), checked against the specs by
  `check-consistency`.

### Changed

- **Contract 2.0 on every engine.** A runtime declares, per major, the
  highest minor it implements (`SUPPORTED_VERSIONS`, replacing
  `SUPPORTED_MAJORS`; `MilanoInfo.contract`); a document or vocabulary
  above that is rejected typed, and `UnsupportedVersion.supported` lists
  ranges as `major.minor` strings instead of bare majors. 1.x documents
  stay accepted. The samples, docs, and playground declare 2.0.0.
- **Limit rejections name the limit.** `rejectedMutation` and
  `rejectedContextUpdate` carry the limit name as `expected`
  (`maxValueSize`, `maxNodeCount`) and the measured value as `found`; the
  node count limit is measured on the materialized tree, at build and at
  runtime.

## 1.3.0

### Added

- **`milano validate` warns about unknown keys** in contract-governed
  objects, which the gate ignores by rule.
- **The engine-pinned registry is enforced**: `check-consistency` asserts
  every engine carries a test naming each statement in the specs'
  `conformance/engine-pinned.json`; the TypeScript engine gained the two
  tests it lacked.
- **A value size limit, at the gate and at runtime.** `MilanoLimits.maxValueSize`
  (default 65,536) bounds every value entering state or context: a
  `LimitExceeded` for initial values, a rejected context update, and for
  `$set` the new `rejectedMutation` occurrence, which also ends the action
  list. Closes the runtime-limit promise Foundations made. A Swift host
  switching exhaustively over `MilanoOccurrence.Kind` gains one case to
  handle; the conformance harnesses honor a vector's `config.limits`.
- **A Compose Desktop sample**, `samples/compose-desktop`: the same
  demos and documents on the JVM through Compose Multiplatform, consuming
  the engine's JVM target from source.
- **`@get-milano/cli`**: `milano validate <documents> --vocabulary <file>`
  runs documents through the engine's gate on the producer's side, with
  the typed error on rejection, `--json` reports, and `validate()` for
  build scripts.
- **The bindings goldens compile against every engine in CI**
  (`scripts/verify-bindings.mjs`), typed record wrappers included.
- **Occurrences carry detail**: `MilanoOccurrence` gains optional `name`,
  `expected`, and `found`.
- **`synthesizedState` is public on every engine**; the samples use it
  instead of a copy that mis-synthesized enum, array, and record state.

### Changed

- **Object members are walked in lexicographic key order on every engine**
  (document model spec, Validation): which defect a multi-defect document
  reported first was random on Swift, whose parser keeps no key order.
- **CI checks out the specs at the suite release the SDK is held to**
  (`SPECS_RELEASE`, 1.3.1), never at `main`; the README names it and the
  consistency check keeps the four places in agreement.
- **Resolution is incremental on every engine.** An update re-evaluates
  only what reads a changed key and keeps untouched subtrees as they
  were; an update that changes no value notifies nobody. Observable only
  as arithmetic reports no longer repeating, pinned by the suite.
- **The sample apps refuse URLs that are not `https` with a host**,
  completing `openUrl` with failure. Samples only.

### Fixed

- **Unknown keys inside type descriptors are ignored on every engine**, per
  the tolerance rule; all three rejected them. Vector:
  `gate-unknown-keys-ignored`.
- **The Compose engine's tests rerun when the conformance suite changes**;
  the vectors were not a Gradle input, so a changed suite replayed a stale
  pass locally.
- **`metadata` must be a JSON object on every engine**; any other shape
  is `MalformedDocument`, as hosts read it as a map.
- **`if` branches must agree on optionality on every engine**; the
  TypeScript engine widened the result to `T?` instead.
- **The Compose engine copies the registry at creation**, so later
  registrations no longer change an existing engine.
- **The Compose quick path synthesizes enum state** instead of crashing.
- **An empty node `id` is a `MalformedDocument` on every engine.**
- **The release tag stamps the TypeScript engine's version** alongside
  Swift and Kotlin.
- Documentation: the `result` root is listed, the expression-length limit
  is stated in Unicode scalars, and the coverage page reads its test
  counts from the runners.

## 1.2.1

### Fixed

- **Both packages export their own `package.json`.** An `exports` map is a
  closed list, and this subpath was not on it, so a tool reading the
  manifest of an installed Milano package (a version probe, a bundler
  plugin, a documentation generator) failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than getting the file, which was
  in the tarball all along. Additive: nothing that worked before changes.

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
