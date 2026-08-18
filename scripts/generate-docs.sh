#!/usr/bin/env bash
#
# Generates the API reference for every engine into docs/libs/<lib>, the
# form the docs site publishes at get-milano.dev/sdk/libs/<lib>/.
#
#   ./scripts/generate-docs.sh [version]
#
# The version defaults to the VERSION file and is only used in titles.
# Output is generated, never committed: the release workflow builds it and
# deploys it with the rest of the site.
#
# Requires Xcode (DocC) for the Swift engine; on a machine without it, that
# one lane is skipped with a warning and the rest still run.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="${1:-$(tr -d '[:space:]' < VERSION)}"
OUT="$ROOT/docs/libs"

echo "Generating API reference for Milano $VERSION"
rm -rf "$OUT"
mkdir -p "$OUT"

# --- SwiftUI: DocC, transformed for hosting under a subpath.
if command -v xcodebuild > /dev/null 2>&1; then
  echo "==> swiftui (DocC)"
  DERIVED="$(mktemp -d)"
  xcodebuild docbuild \
    -scheme milano-sdk \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED" \
    > /dev/null
  ARCHIVE="$(find "$DERIVED" -name 'MilanoSDK.doccarchive' -print -quit)"
  [ -n "$ARCHIVE" ] || { echo "no doccarchive produced" >&2; exit 1; }
  "$(xcrun --find docc)" process-archive transform-for-static-hosting "$ARCHIVE" \
    --hosting-base-path /sdk/libs/swiftui \
    --output-path "$OUT/swiftui" \
    > /dev/null
  rm -rf "$DERIVED"

  # DocC leaves the archive root without a landing page: the index.html it
  # writes there is the app shell, and it is the one file the static-hosting
  # transform does not rewrite -- it keeps `baseUrl = "/"` while every page
  # below it gets the hosting base path. Served at /sdk/libs/swiftui/ it asks
  # for /js and /css at the domain root, gets 404s, and renders blank.
  #
  # There is nothing at the archive root to show anyway; the reference starts
  # one level down, at documentation/<module>. So replace the shell with a
  # redirect there, which also matches Dokka and TypeDoc, both of which land
  # on real content. The module is read back out of the archive rather than
  # written down here, so a rename cannot quietly restore the blank page.
  LANDING="$(cd "$OUT/swiftui/documentation" 2> /dev/null && ls -1d */ 2> /dev/null | head -1 || true)"
  [ -n "$LANDING" ] || { echo "no module under documentation/ in the doccarchive" >&2; exit 1; }
  LANDING="documentation/${LANDING%/}/"
  echo "    landing page -> $LANDING"
  # Relative, so it holds under any base path and in a local preview.
  cat > "$OUT/swiftui/index.html" <<HTML
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>MilanoSDK</title>
<meta http-equiv="refresh" content="0; url=$LANDING">
<link rel="canonical" href="$LANDING">
<script>location.replace("$LANDING" + location.search + location.hash)</script>
<p><a href="$LANDING">MilanoSDK API reference</a></p>
</html>
HTML
else
  echo "==> swiftui skipped: xcodebuild not found (Xcode is required for DocC)"
fi

# --- Compose: Dokka.
echo "==> compose (Dokka)"
(cd "$ROOT/engine/compose" && ./gradlew -PmilanoVersion="$VERSION" dokkaGeneratePublicationHtml > /dev/null)
mkdir -p "$OUT/compose"
cp -R "$ROOT/engine/compose/build/dokka/html/." "$OUT/compose/"

# --- TypeScript: TypeDoc, one run per published package.
#
# The packages are built first: @get-milano/react imports @get-milano/core
# through the workspace symlink, and the package resolves to its `dist`
# types. Without a build, TypeDoc reports the core module as missing and
# every type in the React binding degrades to `any`.
echo "==> building the packages so their types resolve"
npm run build --workspaces --if-present > /dev/null

echo "==> ts and react (TypeDoc)"
npx --no-install typedoc engine/ts/src/index.ts \
  --tsconfig engine/ts/tsconfig.json \
  --out "$OUT/ts" \
  --name "@get-milano/core $VERSION" \
  --excludeInternal \
  --hideGenerator \
  > /dev/null
npx --no-install typedoc engine/react/src/index.ts \
  --tsconfig engine/react/tsconfig.json \
  --out "$OUT/react" \
  --name "@get-milano/react $VERSION" \
  --excludeInternal \
  --hideGenerator \
  > /dev/null

echo
echo "Generated:"
du -sh "$OUT"/* 2>/dev/null || true
