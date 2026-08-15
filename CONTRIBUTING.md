# Contributing

- **Spec-first**: behavior questions are answered by [get-milano/specs](https://github.com/get-milano/specs), never invented here. Spec gaps get fixed there, with conformance vectors, before code changes land.
- **Both engines, together**: a behavior change lands in Swift and Kotlin in the same change, with the conformance suite green on both.
- **Lint gate**: `swiftlint` and `ktlint` must report zero violations. Interpreter-shaped functions may carry targeted, justified disables.
- **Verify locally**: `swift test` at the root; `./gradlew jvmTest assembleRelease` in `engine/compose`; both sample apps must build.
