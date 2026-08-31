# Security policy

Milano treats every document as untrusted input: that is the point of the
gate. If you find a way past it, or any other vulnerability in the engines,
the CLI, or the generated bindings, please report it privately.

## Reporting

Use GitHub's private vulnerability reporting on this repository: the
**Security** tab, then **Report a vulnerability**. It reaches the
maintainer without disclosing anything publicly, and it is the only channel
that carries an advisory through to a fix and a published CVE if one is
warranted.

Please do not open a public issue for a suspected vulnerability, and please
do not test against anyone else's application.

What helps most, in rough order: the document, vocabulary, and host
configuration that reproduce it; which engine and version; what the gate
did and what you expected it to do; and whether the input has to be crafted
by hand or could arrive from a normal producer pipeline.

You should get an acknowledgement within a week. Fixes land in all three
engines together, with a conformance vector reproducing the defect, because
a behaviour that differs between engines is itself a defect here.

## What is in scope

- The gate accepting a document it should reject, or rejecting one it
  should accept, in a way that lets a document reach outside what its
  vocabulary grants.
- Evaluation escaping its own rules: a crash, a hang, unbounded memory, or
  a value reaching a renderer that the declared type forbids.
- Resource limits (depth, node count, document size, expression length,
  value size) failing to bound what they claim to bound.
- The CLI or the bindings generator executing or emitting something a
  vocabulary or document controls.

## What is not

- What a host does with an action it was handed. Milano validates that an
  action was granted and that its parameters have their declared types; it
  cannot judge the values. Opening an attacker-supplied URL is the host's
  bug, and the guides say so.
- A host function that misbehaves. It is the app's code; Milano validates
  its declared shape and nothing else.
- Documents from a source you trusted and should not have. Where documents
  come from is deliberately outside the contract.
- The sample apps' toolchains, which are demonstrations and are never
  published.

## Advisories in the sample toolchains

`npm audit` at the root reports advisories, and none of them are in
anything this repository publishes. `@get-milano/core` has no dependencies
at all; `@get-milano/react` and `@get-milano/cli` depend only on it. That
is checked, not asserted: `scripts/check-consistency.mjs` fails the build
if a published package ever grows a third-party runtime dependency.

What the advisories are in is the React Native sample's build toolchain
(Expo and Metro), which is `private: true`, never published, and only ever
run by someone building that sample. The current one is `uuid@7`, pinned
inside Expo's `@expo/config-plugins` through `xcode`, a generator of Xcode
project files. npm's own suggested remedy is to downgrade Expo by eleven
majors, and an `overrides` entry does not reach that pin, so it stays until
Expo updates. Dependabot watches the sample's toolchain as one group so an
upstream fix arrives on its own.

If you find an advisory that does affect a published package, that is a
real report and the section above is how to send it.

## Supported versions

The latest released minor of the current major receives security fixes.
Older majors do not; the [migration guide](docs/migrating.md) covers moving
forward.
