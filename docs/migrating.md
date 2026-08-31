---
title: Migrating
nav_order: 15
---

# Migrating

What changes for consumers between major versions of the SDK, by audience. Within a major, releases are additive and nothing here applies; the [changelog](https://github.com/get-milano/sdk/blob/main/CHANGELOG.md) has the full list of changes per release.

## 2.0 to 2.1

SDK 2.1.0 implements contract 2.1 of the specs, a superset of 2.0: every 2.0 document and vocabulary stays valid with the same meaning, and nothing in the engine API is removed or retyped. This is a minor release.

### Producers

- **Nothing to change** for existing documents. A document declaring `"version": "2.0.0"` builds under 2.1 engines exactly as before.
- **Built-in functions are called with a `$`.** `$str(x)` is now `$str(x)`, and so are the other sixteen: `$int`, `$double`, `$concat`, `$length`, `$isEmpty`, `$contains`, `$startsWith`, `$endsWith`, `$trim`, `$if`, `$abs`, `$min`, `$max`, `$floor`, `$ceil`, `$round`. A document written for 1.x or 2.0 that calls one bare now fails the gate with rule `expression` instead of rendering, and the fix is mechanical. A bare name in call position now means a host function the vocabulary declares; in exchange, a vocabulary may declare a function under any name at all, `round` and `concat` included, and a later contract minor can add built-ins without invalidating one.
- **To use the additions**, declare `"version": "2.1.0"`: `key` on a `$repeat`, the top-level `on` with `appear` and `disappear`, the top-level `watch`, the `failure` root, `abs`, `min`, `max`, `floor`, `ceil`, `round`, the array actions `$append`, `$remove`, `$update`, and every host function the vocabulary declares. A 2.0 document carrying any of them is a `SchemaViolation` with rule `contract-feature`, naming the feature and `2.1`, on every engine. See [Writing documents](documents) and [Expressions](expressions#host-functions).
- A vocabulary that declares a `failure` type or a `functions` section needs `"milano": "2.1.0"`; adding either is an additive change (`milano diff` says so, and classifies function changes: removing one or changing its arguments or return is breaking).

### App teams

- **`MilanoAction` gains `dispatch` and `dispatchId`**, and `MilanoUserInteraction` gains `dispatch`; the interaction kinds gain `viewAppeared`, `viewDisappeared`, and `viewReplaced`, the occurrence kinds `completionAfterReplace` and `invalidFunctionResult`. A Swift host switching exhaustively over either `Kind` has cases to add.
- **`MilanoEngine` takes a function handler** when the vocabulary or a builder declares host functions: one synchronous `MilanoFunctionHandler` answering every declared function by name. A document calling one on an engine without a handler fails at build (`function-handler`). Engines whose vocabularies declare no functions need nothing.
- **`MilanoView.replace(document)`** swaps a live view's document through the gate, keeping state whose declaration is unchanged; a failed replacement leaves the view untouched. Hosts that rebuilt on every document change can keep the user's state instead.
- **`rejectedMutation` may expect `index in range`** (an array action's index outside the array), with the index as `found`.
- **`MilanoActionFailure`** is how a handler fails with a payload; a plain throw still fails, now as a failure with no payload, which is invalid against a non-optional `failure` declaration. Handlers for actions that never declare `failure` need no change.
- **Lifecycle delivery** is automatic through `MilanoHost`. Hosts that await `build()` and place the view themselves call `view.appear()` and `view.disappear()`; without them, a document's lifecycle bindings never run, and `viewAppeared` is never recorded.
- **`$repeat` instance references** may now carry a key rendering instead of an index (`card[abc]`); code that parsed references as integers (rare, and never encouraged) sees strings. A rejected mutation or context update can now name `distinct key` as `expected`.
- **The `children` violation's `found` detail is `children`**; it was the node type on every engine. Tests matching the old detail need the new one.
- The bindings generator emits a nominal type per failure site and documents both outcomes on the action; regenerate as part of the build, as before.

## 1.x to 2.0

SDK 2.0.0 implements contract 2.0 of the specs, a superset of 1.0: every 1.x document and vocabulary stays valid with the same meaning. The breaking changes are on the engine API and in the detail strings, not in what documents say.

### Producers

- **Nothing to change** for existing documents. A document declaring `"version": "1.0.0"` builds under 2.0 engines exactly as before.
- **To use `$repeat`**, declare `"version": "2.0.0"`; a `1.x` document carrying a `$repeat` node is rejected at the gate (`SchemaViolation`, rule `construct`). Lists were previously unrolled by the producer, one node per item; with `$repeat` the document carries one template and the host supplies the items as an array in state or context. See [Lists with `$repeat`](documents#lists-with-repeat).
- **Tooling** moved into `@get-milano/cli`: `milano schema`, `milano diff`, and `milano bindings` replace `generate_document_schema.py`, `vocabulary_diff.py`, and `generate_bindings.py` with the same flags and byte-identical output, and `milano init` scaffolds a folder. The Python tools remain in the specs repository for anyone without Node. See [Producing documents](producing).

### App teams

- **Version awareness.** Engines declare the highest minor they implement per major: `SUPPORTED_VERSIONS` (`{1: 0, 2: 0}`; Swift `MilanoGate.supportedVersions`) replaces `SUPPORTED_MAJORS`, and `MilanoInfo.contract` names the contract (`"2.0"`). A document above the ceiling is `UnsupportedVersion`; its `supported` field now lists ranges as `major.minor` strings (`["1.0", "2.0"]`) instead of bare majors, so code that read it as numbers needs updating.
- **Limit rejections name the limit.** `rejectedMutation` and `rejectedContextUpdate` past a limit carry the limit's name as `expected` (`maxValueSize`, `maxNodeCount`) and the measured size or count as `found`, where 1.x carried the limit's value as `expected`. Telemetry or tests that matched the old detail strings need the new ones; the full table is in [Guardrails](guardrails#occurrence-detail).
- **Node count at runtime.** The node count limit is measured on the materialized tree: at build it is `LimitExceeded` as before, and a `$set` or a context update that would grow a `$repeat` past it is now rejected whole and reported (`rejectedMutation` or `rejectedContextUpdate` with `maxNodeCount`), where 1.x had no runtime growth to bound.
- **`$repeat` instances in the tree.** A renderer sees the instances, not the construct: a `$repeat`'s instances take its place among the parent's children, referenced as the template's reference plus an index (`card[2]`, nested `line[2][0]`). Renderers that key children by reference get distinct keys per instance; code that walked a document's node tree by structure (rare) sees the materialized tree instead. Emissions from an instance use the instance reference, and one from an index that no longer exists is an `invalidEmission` (`expected: repeat element`).
- **Object member order.** The gate visits JSON object members in lexicographic key order (since specs 1.3.1, implemented in SDK 1.3.0), so which of several defects a document reports first no longer depends on the serializer. Tests asserting a first error on a multi-defect document may see a different one.

### Projects that copied the samples' build steps

The samples' Gradle tasks, Xcode script phase, and React Native scripts run the Milano CLI instead of the Python tools from a specs checkout: `milano bindings`, `milano schema`, and `milano validate`. A project that copied the 1.x steps keeps working (the Python tools still exist); to switch, replace each `python3 "$SPECS_DIR/tools/..."` with the matching `npx milano ...` command and drop the checkout, as in [Creating a bridge](bridge#as-a-build-step). Xcode's script phases have no Node on their `PATH`; extend it in the phase, as the sample does. Inside the SDK repository itself, the samples run the workspace build of the CLI, so `npm ci && npm run build` at the root precedes a sample build.

### Playground

The playground's examples declare `2.0.0` and include a `$repeat` list; it runs on `@get-milano/core` and `@get-milano/react` 2.0.0. A playground pinned to 1.x packages cannot build those examples, which is expected.

### What did not change

The vocabulary schema, the expression language (no new functions or operators), the action encoding, the occurrence kinds (no kind was added or removed), the renderer contract (`MilanoNode`, `MilanoRenderer`), the builder surface, and every 1.x conformance vector, which the 2.0 engines still pass.
