#!/usr/bin/env bash
# Removes ClaudeStat: the status line registration, the bridge, and the extension.
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
SETTINGS="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS" ]; then
  SETTINGS="$(to_native "$SETTINGS")" node -e "
    const fs = require('fs');
    const file = process.env.SETTINGS;
    let settings;
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { process.exit(0); }
    const cmd = (settings.statusLine && settings.statusLine.command) || '';
    if (cmd.includes('statusline-usage.js')) {
      delete settings.statusLine;
      fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
      console.log('  [ok] statusLine removed');
    } else {
      console.log('  [skip] statusLine is not ClaudeStat, left as is');
    }
  "
fi

# --- 2. Bridge and cached data ---------------------------------------------
for leaf in claude-stat usage-bridge.json; do
  if [ -e "$CLAUDE_DIR/$leaf" ]; then
    rm -rf "${CLAUDE_DIR:?}/$leaf"
    echo "  [ok] removed $leaf"
  fi
done

# --- 3. Extension -----------------------------------------------------------
if [ -d "$EXTENSIONS_ROOT" ]; then
  for dir in "$EXTENSIONS_ROOT"/claude-stat.claude-stat-*; do
    [ -d "$dir" ] || continue
    rm -rf "$dir"
    echo "  [ok] removed $(basename "$dir")"
  done
fi

echo ""
echo "ClaudeStat removed. Restart VS Code to clear the status bar item."
echo "Your original settings backup, if one was made, is at:"
echo "  $CLAUDE_DIR/settings.json.claude-stat-backup"
