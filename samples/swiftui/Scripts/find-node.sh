#!/bin/sh
# Prints the path to a Node binary, or fails with an explanation.
#
# Xcode runs a build phase with a minimal PATH inherited from however the
# app was launched, not from a login shell. A Node installed by a version
# manager (nvm, fnm, volta, asdf, mise) lives under the home directory
# and is invisible there, so `node` works in every terminal and the build
# still fails. This looks in the places those managers use.
#
# The escape hatch is MILANO_NODE: set it to a binary and nothing here is
# guessed. Xcode reads `.xcode.env` beside this script if it exists, the
# same file React Native uses, so a machine with an unusual layout can
# say so once.
set -eu

if [ -f "$(dirname "$0")/.xcode.env" ]; then
    . "$(dirname "$0")/.xcode.env"
fi
if [ -f "$(dirname "$0")/.xcode.env.local" ]; then
    . "$(dirname "$0")/.xcode.env.local"
fi

if [ -n "${MILANO_NODE:-}" ]; then
    [ -x "$MILANO_NODE" ] || {
        echo "error: MILANO_NODE is set to $MILANO_NODE, which is not an executable" >&2
        exit 1
    }
    echo "$MILANO_NODE"
    exit 0
fi

if command -v node >/dev/null 2>&1; then
    command -v node
    exit 0
fi

# Managers that install a shim, plus the two package managers.
for candidate in \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.asdf/shims/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
do
    if [ -x "$candidate" ]; then
        echo "$candidate"
        exit 0
    fi
done

# Managers that keep one directory per installed version. Without a login
# shell there is no "selected" version to read, so this takes the newest
# installed one: any Node new enough to run the CLI will do.
for root in \
    "${NVM_DIR:-$HOME/.nvm}/versions/node" \
    "${FNM_DIR:-$HOME/.local/share/fnm}/node-versions" \
    "$HOME/Library/Application Support/fnm/node-versions"
do
    [ -d "$root" ] || continue
    newest=$(ls -1 "$root" 2>/dev/null | sort -V | tail -1)
    [ -n "$newest" ] || continue
    for binary in "$root/$newest/bin/node" "$root/$newest/installation/bin/node"; do
        if [ -x "$binary" ]; then
            echo "$binary"
            exit 0
        fi
    done
done

echo "error: no Node found. The Milano CLI runs on Node, and this build step" >&2
echo "       generates the typed bindings, the editor schema, and validates" >&2
echo "       the bundled documents with it." >&2
echo "       Looked on PATH, then in nvm, fnm, volta, asdf, mise, Homebrew," >&2
echo "       and /usr/local. Xcode does not see a login shell's PATH, so a" >&2
echo "       Node that works in your terminal can still be missing here." >&2
echo "       Fix it by naming yours once, from the sample directory:" >&2
echo "         echo \"export MILANO_NODE=\$(command -v node)\" > Scripts/.xcode.env.local" >&2
exit 1
