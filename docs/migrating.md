---
title: Migrating
nav_order: 15
---

# Migrating

What changes for consumers between major versions of the SDK, by audience. Within a major, releases are additive and nothing here applies; the [changelog](https://github.com/get-milano/sdk/blob/main/CHANGELOG.md) has the full list of changes per release.

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
