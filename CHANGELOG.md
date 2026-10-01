# Changelog

What changed for people consuming the SDK. Every release implements the
same contract version of the [specs](https://github.com/get-milano/specs);
where a release changes what the engines do rather than what they offer,
it says so.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [semantic versioning](https://semver.org): within a
major, documents, vocabularies, and integrations keep working.

## 2.1.0

Contract 2.1 on every engine, a superset of 2.0: every 2.0 document and
vocabulary stays valid with the same meaning. Additive for consumers; what
to declare and what to switch on is in [Migrating](docs/migrating.md).

### Added

- **Keyed `$repeat` instances.** A `key` expression (a non-optional
  string, int, or enum over the template's roots) replaces the element
  index in the instance's reference (`card[abc]`), so a row keeps its
  identity, its React key, and its analytics anchor when the list is
  reordered; an emission from a keyed instance binds the element whose
  key matches at dispatch time. Repeated keys are a data defect: a
  `SchemaViolation` (`repeat`, `distinct key`) at build, a rejected
  mutation or context update at runtime. The catalog sample keys its
  cards on the item id.
- **Typed failure payloads.** An action may declare a `failure` type in
  the vocabulary or on the builder (`action(name, failure:)`); a handler
  fails with a payload by throwing `MilanoActionFailure(value)` (a
  rejection with it in TypeScript), and the value, validated like a
  result, binds the `failure` root inside `onFailure`. Any other error is
  a failure with no payload, which only an optional declaration accepts.
  The contact form sample declares an enum of reasons and turns them into
  messages in the document; the generated bindings type the failure sites
  and document them on the action.
- **Lifecycle bindings.** A document's top-level `on` binds action lists
  to `appear` and `disappear`. `MilanoHost` on every toolkit delivers
  the signals from the toolkit's own presentation callbacks (SwiftUI's
  `onAppear`, a Compose `DisposableEffect`, a React effect); a host that
  awaits `build()` and places the view itself calls `view.appear()` and
  `view.disappear()`. Redundant and post-teardown signals are ignored.
  Two analytics kinds, `viewAppeared` and `viewDisappeared`, make the
  impression what it says. The interstitial sample tracks both.
- **Dispatch identity.** `MilanoAction` carries `dispatch`, the
  zero-based number of the dispatch among the view's, and `dispatchId`,
  a string unique across every dispatch of every view in the process
  (engine-pinned `dispatch-id-unique-across-views`): the idempotency key
  a handler sends with its request. `actionDispatched`,
  `completionSucceeded`, and `completionFailed` records carry the number
  in a new `dispatch` field, and completion records carry the validated
  result or failure payload as their value.
- **Numeric functions** `abs`, `min`, `max`, `floor`, `ceil`, `round`,
  specified to the bit and identical on every engine: wrapping `abs`,
  leftmost-wins extrema with NaN propagation, ties away from zero, signed
  zeros preserved. The tip calculator sample rounds with them.
- **Array actions.** `$append` (`key`, `value`), `$remove` (`key`, `at`),
  and `$update` (`key`, `at`, `field`, `value`) change one element of an
  array-typed state key under exactly the rules of `$set`; an index
  outside the array is a rejected mutation (`index in range`) that ends
  the action list. Inside a `$repeat`, `<as>_index` is the element's
  position at dispatch, so a row edits or removes itself.
- **Watch bindings.** A top-level `watch` section binds action lists to
  changes of a state key; the list runs as part of the mutation, before
  the next action, and a watch never triggers a watch, so derived values
  and reactions (autosave, a live quote, a search following its query)
  need no host side channel. An undeclared key is the new `watch` rule.
- **Host functions.** A vocabulary's `functions` section (or
  `builder.function(...)`) declares typed, pure functions the app
  computes; documents call them like built-ins, the gate types the calls,
  and the engine's new synchronous `MilanoFunctionHandler` answers them.
  A mismatched or thrown result is `invalidFunctionResult` and the zero
  value of the return type; a document calling one on an engine without
  a handler is the `function-handler` rule. Formatting money and dates
  through the host's locale APIs is the use case; the samples do.
- **Document replacement.** `MilanoView.replace(document)` swaps a live
  view's document through the gate: state whose declaration is unchanged
  carries over, the provider supplies the rest, a failed replacement
  leaves the view untouched, identity and dispatch numbering persist,
  pending completions of the old document are dropped as
  `completionAfterReplace`, and a `viewReplaced` record is contributed.
  Engine-pinned: `replace-provider-failure-propagates`.
- **`contract-feature` rule.** A document is checked under the rules of
  the `major.minor` it declares: a 2.0 document using a 2.1 feature (`key`,
  `on`, `failure`, a numeric function) is a `SchemaViolation` naming the
  feature and the version it needs, identically on every engine, instead
  of silently ignored on some. A vocabulary declaring `milano` below 2.1
  may not declare `failure` (`InvalidVocabulary`, `contract-feature`).
- **CLI and skill.** `milano schema` admits `key` and the lifecycle
  section, `milano diff` classifies `failure` like `result`, `milano
  bindings` emits the failure sites, `milano init` scaffolds 2.1, and the
  authoring skill teaches every addition.
- **READMEs for the Compose and SwiftUI samples.** The two most likely
  starting points were the two without first-run instructions: how to
  build and run, how to open one demo directly, what to read first, what
  the build steps generate, and what to do when the IDE cannot see Node.

- **Synthesized state and the contract's zero agreed at last.**
  `synthesizedState` had its own copy of the zero-value rule and took an
  enum's *alphabetically first* member, while the contract takes the
  *first declared*, so a previewed value could differ from what the same
  declaration produces in the engine. All three engines now use the
  contract's own zero, and each has a test asserting the two cannot drift
  apart again. Only enums are affected, and only where declaration order
  is not alphabetical.
- **`MilanoType.enumeration(_:)` keeps an enum's declared order.** The
  zero value reads that order, so a constructor taking an unordered set
  cannot answer for it: Swift's lost the order before the initializer saw
  it, and Kotlin's accepted any `Set`, including one that does not keep
  insertion order. Both now offer a constructor taking the members in
  declaration order, which is what TypeScript's already did. A type built
  the old way still resolves deterministically, alphabetically, and says
  so.

- **Lookups and the `$switch` construct on every engine.** Two answers to
  the same question, a code and what it means: `context.labels[state.status]`
  picks a value, `$switch` picks a subtree, and both are exhaustive, so a
  member added to an enum later fails the build rather than rendering the
  wrong label or nothing at all. The expression grammar, the gate, and the
  resolver of all three engines handle them, `milano schema` admits the
  construct, and `milano validate` knows its keys. The card detail sample
  shows both: a status label from a lookup, and advice beneath it chosen
  by a switch.

- **An emission from inside a construct's branch reached nothing.** The
  runtime indexes a document's event bindings by walking `children`, and a
  branch's nodes are not reached that way, so a button inside one reported
  `invalidEmission` and did nothing: the catalog's Hide stopped working
  the moment its list moved into an `$if`. Two more walks had the same
  shape: the dependency index, so a state change never re-materialized a
  branch, and the raw depth and node-count walk, which a subtree hidden in
  a branch escaped entirely. All three are fixed in all three engines, and
  two step vectors pin the dispatch that broke.

- **The `$if` construct on every engine.** Conditional structure, which
  until now was a `visible` property each vocabulary had to declare: a
  component whose vocabulary omitted one could not be left out, and no
  document could choose between two subtrees. The parser, gate, and
  resolver of all three engines handle it, `milano schema` admits it, and
  `milano validate` knows its keys. The samples' catalog uses it for the
  case that needed it: hide every item and the list now says so instead
  of leaving a bare heading.

- **Five string functions on every engine.** `$substring`, `$indexOf`,
  `$replace`, `$split`, and `$join`, implemented in the TypeScript,
  Swift, and Kotlin engines against 261 new conformance vectors. Indices
  count Unicode scalars in all three, which is the part that differs by
  platform: JavaScript and Kotlin index UTF-16 natively, so both convert.
- **A nested `Column` no longer eats the row it sits in.** `Column` gains
  `width` (`fill`, `content`): the container filled the width
  unconditionally, so the three columns inside the card detail's row each
  claimed all of it and the expiry and CVV were squeezed out on Compose.
  The default stays `fill`, which is what a screen's root column wants,
  so no existing document changes. Same shape as the `padding` fix: a
  column nested inside a tile or a row is not a screen, and the document
  is what says so.

- **A card detail demo in all four samples.** A card whose number,
  expiry, and CVV are masked until an eye control is held: the masking is
  the document's own work over values in context, so the host hands the
  card over once and never a pre-masked copy. It exercises all five new
  functions, and the reveal is bound to `pressStart` and `pressEnd` on a
  new `IconButton`, a control whose point is the press rather than a tap.
- **A quick actions demo in all four samples.** A horizontal strip of
  tiles from one keyed `$repeat`: each tap records the tapped tile's
  position through the repeat's `<as>_index` binding, writes the same
  number to state so it is visible on screen, and asks the host to open a
  screen. The samples' `examples` vocabulary moves to 1.4.0 for it, all
  additive: an `Icon` component with an enum `name`, a `navigate` action
  with an enum `screen`, and `track` gains a `tapped` event member and an
  optional `position`. Every sample draws the same six icon names its own
  way, so one document renders as SF Symbols, Material icons, or emoji.
  The tile states its look rather than drawing it: `Card` gains `style`
  (`surface`, `plain`) for a region that is tappable without being a
  filled surface, `Icon` gains `container` (`plain`, `circle`) for an icon
  shown inside something, `Text.role` gains `caption`, and `Row` gains
  `alignment` (`top`, `center`, `bottom`), `horizontalPadding`, and
  `scrolls`; `Column` gains `padding`. Top alignment is what keeps a strip
  readable when labels wrap to different heights: centring them leaves the
  icons on different lines. [Analytics](docs/analytics.md) explains
  when a list reports position and when it reports identity.

### Fixed

- **A declaration key that is not an identifier was reported as a bad type
  descriptor.** `{"context": {"$x": "string"}}` failed with `expected` `type
  descriptor` in every engine, though the descriptor was fine and the rule
  tables promise `identifier` for the key. The two defects are now
  distinguished: a bad key names `identifier`, a bad descriptor names `type
  descriptor`. No document that built before fails now, and none that failed
  builds; only the detail changed.
- **A string that is not a member of a declared enum was reported as a type
  mismatch.** A `tone` of `"warn"` against `{"enum": ["info", "warning",
  "danger"]}` said `expected` `enum`, `found` `string`, which is true and
  useless: it hides which string was rejected. Property literals and supplied
  context and state values now report `enum member` and the rejected string,
  as the document model spec's rule tables say. Occurrences are unchanged:
  `rejectedContextUpdate` and `rejectedStateUpdate` carry the declared type,
  which is what the runtime spec specifies for them.
- **Swift visited document declarations in dictionary order.** The
  validation rules require every object's members to be visited in
  lexicographic key order, so that a serializer reordering keys cannot
  change which defect is reported; Swift's `Dictionary` has no order at
  all, so a document with two malformed declarations could fail either
  way, and differently between runs. It now sorts, as the TypeScript and
  Kotlin engines already did.

- **Generated files were drift-checked for one sample out of four.** CI
  compared only the React Native bindings, because that is the one file a
  CI job happened to regenerate; a stale committed `GeneratedBindings.kt`,
  `GeneratedBindings.swift`, or `documents.schema.json` was invisible.
  `check-consistency` now regenerates all of them from each vocabulary and
  compares bytes, which needs neither Xcode nor Gradle and so covers every
  sample whether or not anything built it.

- **The render smoke test could pass over a template it never rendered.**
  A document declaring an array in state gets the empty array from
  synthesized state, so its `$repeat` renders nothing and the script still
  reported "ok". Both documents that use one had gone uncovered that way.
  A document that declares an array and supplies no elements is now a
  failure, naming the key.

- **The React Native sample would not bundle.** Metro was configured with
  `disableHierarchicalLookup`, to guarantee one copy of React. That flag
  also stops Metro looking inside a package's own `node_modules`, where
  npm nests what it cannot hoist, so `expo` importing its own
  `expo-modules-core` failed to resolve and no iOS or Android bundle
  built. Hierarchical lookup is back on, and the React singleton is now
  checked by `scripts/check-consistency.mjs`, where a second copy fails
  the build instead of being prevented by a resolver rule that broke
  unrelated packages.

- **A wide row pushed a whole screen off the viewport.** A `Row` was as
  wide as its children wanted, and the SwiftUI column was sized by its
  widest child, so a strip of tiles that did not fit made the entire
  column wider than the screen. A vertical `ScrollView` centres content it
  cannot fit, so every line on the screen was clipped at both ends, not
  just the row. Columns now occupy the width they are given, and a `Row`
  with `scrolls` scrolls horizontally instead of overflowing. Verified on
  an iPhone 17 simulator, before and after.

- **The React Native sample rendered stale documents.**
  `src/documents.generated.ts` is what the app bundles, and nothing
  regenerated or compared it: an edited document could ship as the old
  text while the sample's own render smoke test kept passing against the
  stale copy. `npm test` now rebundles first, the way `npm run typecheck`
  already regenerates the bindings, and `check-consistency` compares the
  bundle against the JSON on disk.

- **The samples find Node when the IDE cannot.** Xcode and Android Studio
  inherit the PATH of whatever launched them, not a login shell's, so a
  Node installed by nvm, fnm, volta, asdf, or mise was invisible to the
  build step that regenerates the bindings and validates the documents:
  the SwiftUI sample failed with "node is not on PATH" and the Compose
  ones with "A problem occurred starting process 'command 'node''", both
  on machines where `node` works in every terminal. All three now look
  where those managers install, and `MILANO_NODE` names one explicitly.

- **`replace()` no longer waits forever behind a throwing listener.** A
  host listener that throws clears the view's work queue, as it always did
  and still does; a replacement whose swap was queued behind it was
  discarded without settling, so `await view.replace(...)` never returned.
  It now rejects, with the view exactly as it was. The TypeScript and
  Kotlin engines changed; Swift's closures cannot throw there.
- **A typed failure thrown by the other build of the TypeScript package is
  recognized.** The ESM and CommonJS builds each hold their own
  `MilanoActionFailure`, so a handler loaded through one that failed a view
  built by the other lost its payload to an `instanceof` check, which an
  action declaring a `failure` type reported as an invalid completion. The
  engine now checks a brand both copies carry.

### Changed

- **Built-in functions are called with a `$`.** `$str`, `$int`, `$double`,
  `$concat`, `$length`, `$isEmpty`, `$contains`, `$startsWith`,
  `$endsWith`, `$trim`, `$if`, `$abs`, `$min`, `$max`, `$floor`, `$ceil`,
  `$round`. A bare name in call position is a host function the vocabulary
  or builder declares, so a vocabulary may now declare `round` or
  `concat` and keep both, and the contract can add built-ins later without
  invalidating anyone's declarations. A document that calls a built-in
  bare fails the gate with rule `expression`; the fix is mechanical, and
  [Migrating](docs/migrating.md) lists the seventeen names. `BUILTIN_FUNCTIONS`
  and the vocabulary's built-in-name rejection are removed from every
  engine.

- **The scope is document-driven UI, not two surfaces.** The docs no
  longer present banners, interstitials, and forms as what the contract
  targets; they are the worked examples. Nothing about them changed.
- **Engines declare 1.0 and 2.1.** `SUPPORTED_VERSIONS` is `{1: 0, 2: 1}`,
  `MilanoInfo.contract` is `"2.1"`, and `UnsupportedVersion.supported`
  reads `["1.0", "2.1"]`.
- **`MilanoUserInteraction` gains `dispatch`** and three kinds
  (`viewAppeared`, `viewDisappeared`, `viewReplaced`); `MilanoOccurrence`
  gains `completionAfterReplace` and `invalidFunctionResult`. A Swift host
  switching exhaustively over either `Kind` has cases to add.
- **The Compose engine is published to Maven Central.** Android and JVM
  consumers resolve `dev.get-milano:engine-compose` with nothing but
  `mavenCentral()`; Gradle picks the `-android` or `-jvm` variant. Releases
  carry a sources jar, a javadoc jar built from the Dokka reference, and a
  PGP signature per artifact. GitHub Packages keeps receiving every release
  and the release page keeps carrying a loose AAR and JAR, so nothing that
  worked stops working; they are simply no longer the documented path.
  Snapshots go to Central's snapshot repository between releases; the
  snapshot repository has to be declared explicitly, as
  [Getting started](docs/getting-started.md) shows.
- **Package metadata completed.** All three packages now declare `bugs`
  (npm renders the Issues link from it), and `@get-milano/react` declares
  the Node floor the other two already did. `check-consistency` now fails
  if a published package grows a third-party runtime dependency or drops
  any of that metadata.
- **Generated bindings wrap what would overflow.** The doc comments
  describing an action's `result` and `failure`, and the declarations that
  render long (a union arm, a decode case, a record accessor, a factory
  signature), used to be emitted on one line, past the 130-column limit
  the generated Swift and Kotlin are linted against and with nothing at all
  checking the TypeScript. `milano bindings` now wraps both, byte for byte
  with the specs' generator, in a form ktlint accepts; regenerate and the
  diff is formatting only.
- **A `children` violation's `found` detail is `children`**, as the specs
  table always said; every engine reported the node type. Pinned by the
  regenerated order suite, which now states `found`.
- The samples' vocabulary is `examples 1.2.0` (`submitContact` gains a
  failure enum, `track` is added); their documents declare `2.1.0`.

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
