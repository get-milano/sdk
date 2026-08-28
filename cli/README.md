# @get-milano/cli

The producer's command line for [Milano](https://get-milano.dev): validates documents against a vocabulary with the very gate the engines run, so a document that passes here builds in the app, and one that fails shows the same typed error.

```sh
npm install --save-dev @get-milano/cli
npx milano validate documents/*.json --vocabulary vocabulary.json
```

```
documents/banner.json: valid
documents/form.json: SchemaViolation: schema violation (property-type) at email: expected string, found int
```

Exit status is `0` when every document is valid, `1` when at least one was rejected, and `2` for a usage error, an unreadable file, or an invalid vocabulary. A `for` loop is not needed: pass every document at once, and the status covers them all.

## Options

| Option | Meaning |
|---|---|
| `-v, --vocabulary <file>` | The vocabulary artifact (required) |
| `--context <file>` | A JSON object of context values; declared keys it omits are synthesized as zero-values |
| `--state <file>` | A JSON object of state values, likewise |
| `--unknown-types <policy>` | `fail` (the contract default), `skip`, or `placeholder`, as the app would configure it |
| `--json` | One JSON report per document on stdout, for tooling |

Validation is the full gate: parse, version, vocabulary requirement, limits, the vocabulary walk with expression typing, and the data checks against the declared context and state. Unknown keys in the objects the contract governs (the top level, the node envelope, `vocabulary`, type descriptors) are warnings on stderr: the gate ignores them by the tolerance rule, which is exactly why a typo there would otherwise be silent. A document binding custom actions gets a handler; occurrences a valid document reports at build (a skipped unknown type, a division by zero in an initial expression) are printed as notes, and are in the JSON report.

## From a build script

```ts
import { validate } from "@get-milano/cli";

const report = await validate({ document, vocabulary });
if (!report.valid) throw new Error(`${report.error.type}: ${report.error.message}`);
```

The report carries the error's type, message, and detail fields (`rule`, `node`, `expected`, `found`, `unknownType`, `limit`, ...) exactly as `MilanoBuildError` does in `@get-milano/core`.

## Versions

The CLI is released with the engines and validates with `@get-milano/core` at the same version, so what it accepts is what that release of every engine accepts. The specs repository's `tools/reference_check.py --document` does the same job in Python, with no engine installed.
