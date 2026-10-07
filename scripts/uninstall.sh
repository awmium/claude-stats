#!/usr/bin/env bash
# Removes ClaudeStats: the status line registration, the bridge, and the extension.
#
# Usage: ./scripts/uninstall.sh [--target code|insiders|cursor]
set -euo pipefail

TARGET="code"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Under Git Bash the shell speaks POSIX paths but node.exe does not.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

case "$TARGET" in
  insiders) EXTENSIONS_ROOT="$HOME/.vscode-insiders/extensions" ;;
  cursor)   EXTENSIONS_ROOT="$HOME/.cursor/extensions" ;;
  code)     EXTENSIONS_ROOT="$HOME/.vscode/extensions" ;;
  *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

# --- 1. Status line ---------------------------------------------------------
# Removed only when it is ours. Same code as the extension's "Remove Claude Code Hook".
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v node >/dev/null 2>&1; then
  CLAUDE_CONFIG_DIR="$(to_native "$CLAUDE_DIR")" node "$(to_native "$REPO_ROOT/src/setup.js")" uninstall
else
  echo "  [skip] Node.js not found, statusLine left as is"
fi

# --- 2. Bridge and cached data ---------------------------------------------
for leaf in claude-stats usage-bridge.json; do
  if [ -e "$CLAUDE_DIR/$leaf" ]; then
    rm -rf "${CLAUDE_DIR:?}/$leaf"
    echo "  [ok] removed $leaf"
  fi
done

# --- 3. Extension -----------------------------------------------------------
if [ -d "$EXTENSIONS_ROOT" ]; then
  for dir in "$EXTENSIONS_ROOT"/claude-stats.claude-stats-* "$EXTENSIONS_ROOT"/awmium.claude-stats-statusbar-*; do
    [ -d "$dir" ] || continue
    # Only copies the install script wrote; a Marketplace copy is uninstalled in VS Code.
    case "$(basename "$dir")" in
      claude-stats.claude-stats-*) ;;
      *) [ -f "$dir/.claude-stats-source-install" ] || continue ;;
    esac
    rm -rf "$dir"
    echo "  [ok] removed $(basename "$dir")"
  done
fi

echo ""
echo "ClaudeStats removed. Restart VS Code to clear the status bar item."
echo "A copy installed from the Marketplace is left in place: uninstall it from the"
echo "Extensions view in VS Code."
echo "Your original settings backup, if one was made, is at:"
echo "  $CLAUDE_DIR/settings.json.claude-stats-backup"
