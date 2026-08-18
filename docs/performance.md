---
title: Performance
nav_order: 9
---

# Performance

What Milano costs at build and at update, measured, plus the threading model and the working budgets we recommend. Numbers are medians from the benchmark suites the Swift and Kotlin engines ship (`PerformanceBenchmarks` in the Swift tests, `PerformanceBenchmark` in the Kotlin tests); run them on your own hardware for numbers you can budget against. The TypeScript engine ships the same benchmark (`npm run benchmark --workspace @get-milano/core`), measuring the same document shapes, so the three are comparable in method. They are not comparable as a ranking: `swift test` builds in debug, Kotlin runs on the JVM after warm-up, and Node measures a JIT that has seen the loop already. Run each on your own hardware before budgeting against it.

## Safety limits are not performance budgets

The resource limits in the document model spec (10,000 nodes, 1 MiB, 32 depth, 1,024-character expressions) are **denial-of-service bounds for untrusted input**, not supported working sizes. A document can be within every limit and still be a poor fit for an interactive surface. The budgets below are the numbers to design against.

## What runs where

| Phase | Thread |
|---|---|
| `build()`: parse, gate validation, expression typing, first resolution | The caller's; `build()` is async and safe to await off the main thread |
| State data provider | Awaited inside `build()`, runs wherever the provider runs |
| Renderer invocation, runtime observer callbacks | Main thread (the dispatcher) |
| Action handlers | Invoked asynchronously off the dispatcher; parameters are immutable data, and the completion is funneled back through the dispatcher |
| Build-time observer callbacks | The `build()` caller's thread |
| Event dispatch, built-in actions, re-resolution after an update | Main thread (the dispatcher) |
| Context update application | Posted from any thread, applied on the main thread |

The consequence: **cold build cost never blocks a frame** (await it, show the loading view), while **update cost does**: every event or context change runs its re-resolution on the main thread, so update latency is the number that matters for interaction smoothness.

## Measured baselines

Synthetic wide trees: one input field plus N text nodes, half bound to state through expressions, half literal. Cold build is parse + full gate + first resolution; update is one event dispatch (`$set` from the event payload) plus re-resolution of the whole tree. Medians, Apple M-series laptop; expect low-end phones to be several times slower.

| Nodes | Swift build | Swift update | Kotlin/JVM build | Kotlin/JVM update |
|---|---|---|---|---|
| 10 | 0.08 ms | 0.003 ms | 0.33 ms | 0.02 ms |
| 100 | 0.61 ms | 0.02 ms | 0.67 ms | 0.03 ms |
| 1,000 | 5.8 ms | 0.24 ms | 2.6 ms | 0.21 ms |
| 5,000 | 28.1 ms | 1.0 ms | 11.3 ms | 1.1 ms |

Swift numbers are release-mode (`swift test -c release`); debug builds are roughly 2 to 3 times slower. Kotlin numbers are JVM after warmup; Android (ART) sits between the two.

## Working budgets

- **v1.0's target surfaces (banners, interstitials, forms) are tens of nodes**: build well under a millisecond, updates in the tens of microseconds. Performance is not a consideration at this scale.
- **Up to ~1,000 nodes**, updates stay near 0.2 ms on a laptop; with a generous 10x device factor that still fits comfortably inside a 16 ms frame. Builds of a few milliseconds are absorbed by the loading view.
- **Above that**, measure on your slowest target device before committing. The 5,000-node update (~1 ms laptop, worst-case a few ms on device) still fits a frame, but you are spending budget the rest of your UI may want.

## How the engine currently works, and the licensed optimization

Today every engine re-resolves the **entire tree** on every update and invalidates the host once: the simplest correct implementation, and the numbers above show it is comfortably fast at v1.0's scales. If future surfaces demand more, the designed upgrade path is incremental resolution: the gate already statically resolves every expression's state and context references, so it can emit an exact dependency index, making update cost proportional to what changed rather than tree size, with node-scoped invalidation to the renderers. Because the conformance suite pins observable semantics, that rewrite is contract-invisible: any engine can adopt it independently, and the suite proves nothing changed.

## Running the benchmarks

```sh
# Swift (release mode for representative numbers)
swift test -c release --filter PerformanceBenchmarks

# Kotlin
cd engine/compose && ./gradlew jvmTest --tests "dev.getmilano.PerformanceBenchmark" -i
```

Both print a table and assert only order-of-magnitude ceilings, so CI catches regressions without flaking on runner noise.
