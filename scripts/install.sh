#!/usr/bin/env bash
# Installs ClaudeStats: the status line bridge and the VS Code extension.
#
# Usage: ./scripts/install.sh [--target code|insiders|cursor] [--force]
set -euo pipefail

TARGET="code"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --force)  FORCE=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null 2>&1 || {
  echo "Node.js is required but was not found on PATH. Install Node 20 or newer, then re-run." >&2
  exit 1
}

# Under Git Bash the shell speaks POSIX paths but node.exe does not, so every path
# handed to node has to be converted first.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" | head -1)"
[ -n "$VERSION" ] || { echo "Could not read version from package.json" >&2; exit 1; }
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

[ -d "$CLAUDE_DIR" ] || {
  echo "Claude Code config directory not found at $CLAUDE_DIR." >&2
  echo "Install and sign in to Claude Code first." >&2
  exit 1
}

case "$TARGET" in
  insiders) EXTENSIONS_ROOT="$HOME/.vscode-insiders/extensions" ;;
  cursor)   EXTENSIONS_ROOT="$HOME/.cursor/extensions" ;;
  code)     EXTENSIONS_ROOT="$HOME/.vscode/extensions" ;;
  *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

echo "Installing ClaudeStats $VERSION"
echo "  Claude config : $CLAUDE_DIR"
echo "  Extensions    : $EXTENSIONS_ROOT"

# --- 1 and 2. Bridge script and status line --------------------------------
# src/setup.js is the same code the extension runs for "Set Up Claude Code Hook", so a
# source install and a Marketplace install change settings.json in exactly the same way.
SETUP_ARGS="install"
[ "$FORCE" -eq 1 ] && SETUP_ARGS="install --force"
# shellcheck disable=SC2086
CLAUDE_CONFIG_DIR="$(to_native "$CLAUDE_DIR")" node "$(to_native "$REPO_ROOT/src/setup.js")" $SETUP_ARGS

# --- 3. Extension -----------------------------------------------------------
EXTENSION_ID="awmium.claude-stats-statusbar"
EXTENSION_DIR="$EXTENSIONS_ROOT/$EXTENSION_ID-$VERSION"

if [ -d "$EXTENSION_DIR" ] && [ ! -f "$EXTENSION_DIR/.claude-stats-source-install" ]; then
  echo "" >&2
  echo "ClaudeStats $VERSION is already installed from the Marketplace at $EXTENSION_DIR." >&2
  echo "Uninstall it in VS Code first if you want to run from source instead." >&2
  exit 1
fi

# Marks a folder as written by this script, so the scripts only ever remove their own
# copies and never a Marketplace install, which VS Code manages itself.
MARKER=".claude-stats-source-install"

# The folder is named for the version, so an upgrade would otherwise leave the previous
# one behind and VS Code would load both, showing two status bar items. Copies from
# before 0.2.0 used the ID claude-stats.claude-stats and are always source installs.
if [ -d "$EXTENSIONS_ROOT" ]; then
  for old in "$EXTENSIONS_ROOT"/claude-stats.claude-stats-* "$EXTENSIONS_ROOT/$EXTENSION_ID"-*; do
    [ -d "$old" ] && [ "$old" != "$EXTENSION_DIR" ] || continue
    case "$(basename "$old")" in
      claude-stats.claude-stats-*) ;;
      *) [ -f "$old/$MARKER" ] || continue ;;
    esac
    rm -rf "$old"
    echo "  [ok] removed previous version $(basename "$old")"
  done
fi

mkdir -p "$EXTENSION_DIR/src/bridge"
for file in package.json README.md CHANGELOG.md LICENSE; do
  [ -f "$REPO_ROOT/$file" ] && cp "$REPO_ROOT/$file" "$EXTENSION_DIR/"
done
cp "$REPO_ROOT/src/extension.js" "$REPO_ROOT/src/setup.js" "$EXTENSION_DIR/src/"
cp "$REPO_ROOT/src/bridge/statusline-usage.js" "$EXTENSION_DIR/src/bridge/"
: > "$EXTENSION_DIR/$MARKER"

echo "  [ok] extension installed to $EXTENSION_DIR"

echo ""
echo "Done. Next steps:"
echo "  1. Fully quit and reopen VS Code (a window reload does not always"
echo "     pick up a newly added extension folder)."
echo "  2. Send one message in Claude Code to populate the first reading."
echo ""
