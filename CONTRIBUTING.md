# Contributing

- **No em dashes**: prose in this repository never uses the em dash character, the same rule the specs repository enforces; `scripts/check-consistency.mjs` checks it.
- **Spec-first**: behavior questions are answered by [get-milano/specs](https://github.com/get-milano/specs), never invented here. Spec gaps get fixed there, with conformance vectors, before code changes land.
- **Every engine, together**: a behavior change lands in Swift, Kotlin, and TypeScript in the same change, with the conformance suite green on all three.
- **Lint gate**: `swiftlint` and `ktlint` must report zero violations, and the TypeScript packages must typecheck under `strict` (`npm run typecheck`). Interpreter-shaped functions may carry targeted, justified disables.
- **Verify locally**: `swift test` at the root; `./gradlew jvmTest assembleAndroidMain` in `engine/compose`; `npm test` and `node scripts/check-consistency.mjs` at the root; all four sample apps must build. The conformance drivers read `MILANO_SPECS_DIR`, or default to a sibling `specs` checkout.
