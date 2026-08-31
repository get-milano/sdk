#!/usr/bin/env bash
# Lints every Kotlin source this repository owns: the engine and both
# Compose samples.
#
#   scripts/lint-kotlin.sh          report violations
#   scripts/lint-kotlin.sh --format rewrite what can be rewritten
#
# One definition of the file set, used by CI and by people, so a path
# added here is linted everywhere and a glob typed by hand cannot silently
# match nothing. Style comes from .editorconfig (ktlint_official, 130
# columns). Note that ktlint does not measure the length of KDoc lines;
# the generated bindings are checked for those by
# `scripts/check-consistency.mjs`.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v ktlint > /dev/null; then
  echo "ktlint is not on PATH: https://github.com/pinterest/ktlint/releases" >&2
  exit 127
fi

exec ktlint "$@" \
  "engine/compose/src/**/*.kt" "engine/compose/*.kts" \
  "samples/compose/app/src/**/*.kt" "samples/compose/*.kts" "samples/compose/app/*.kts" \
  "samples/compose-desktop/src/**/*.kt" "samples/compose-desktop/*.kts"
