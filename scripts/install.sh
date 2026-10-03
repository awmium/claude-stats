#!/usr/bin/env bash
# Installs ClaudeStat: the status line bridge and the VS Code extension.
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

echo "Installing ClaudeStat $VERSION"
echo "  Claude config : $CLAUDE_DIR"
echo "  Extensions    : $EXTENSIONS_ROOT"

# --- 1. Bridge script -------------------------------------------------------
BRIDGE_DIR="$CLAUDE_DIR/claude-stat"
BRIDGE_TARGET="$BRIDGE_DIR/statusline-usage.js"
mkdir -p "$BRIDGE_DIR"
cp "$REPO_ROOT/src/bridge/statusline-usage.js" "$BRIDGE_TARGET"
chmod +x "$BRIDGE_TARGET"
echo "  [ok] bridge installed"

# --- 2. Register the status line -------------------------------------------
SETTINGS="$CLAUDE_DIR/settings.json"
SKIP_STATUSLINE=0

SETTINGS_NATIVE="$(to_native "$SETTINGS")"

if [ -f "$SETTINGS" ]; then
  EXISTING="$(SETTINGS="$SETTINGS_NATIVE" node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync(process.env.SETTINGS,'utf8').replace(/^﻿/,''));
      process.stdout.write((s.statusLine && s.statusLine.command) || '');
    } catch { process.stdout.write(''); }
  ")"
  case "$EXISTING" in
    ""|*statusline-usage.js*) ;;
    *)
      if [ "$FORCE" -eq 0 ]; then
        echo ""
        echo "WARNING: you already have a statusLine configured, so it was left untouched:"
        echo "    $EXISTING"
        echo ""
        echo "ClaudeStat needs that hook to receive usage data. Either:"
        echo "  - chain the two commands yourself in a wrapper script, or"
        echo "  - re-run this installer with --force to replace it."
        echo ""
        echo "The extension will still install, but will rely on polling only."
        SKIP_STATUSLINE=1
      fi
      ;;
  esac
fi

if [ "$SKIP_STATUSLINE" -eq 0 ]; then
  if [ -f "$SETTINGS" ] && [ ! -f "$SETTINGS.claude-stat-backup" ]; then
    cp "$SETTINGS" "$SETTINGS.claude-stat-backup"
    echo "  [ok] settings backed up to settings.json.claude-stat-backup"
  fi
  BRIDGE_TARGET="$(to_native "$BRIDGE_TARGET")" SETTINGS="$SETTINGS_NATIVE" node -e "
    const fs = require('fs');
    const file = process.env.SETTINGS;
    let settings = {};
    if (fs.existsSync(file)) {
      try { settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch {}
    }
    settings.statusLine = {
      type: 'command',
      command: 'node \"' + process.env.BRIDGE_TARGET + '\"',
      padding: 0,
    };
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  "
  echo "  [ok] statusLine registered"
fi

# --- 3. Extension -----------------------------------------------------------
EXTENSION_DIR="$EXTENSIONS_ROOT/claude-stat.claude-stat-$VERSION"

# The folder is named for the version, so an upgrade would otherwise leave the previous
# one behind and VS Code would load both, showing two status bar items.
if [ -d "$EXTENSIONS_ROOT" ]; then
  for old in "$EXTENSIONS_ROOT"/claude-stat.claude-stat-*; do
    if [ -d "$old" ] && [ "$old" != "$EXTENSION_DIR" ]; then
      rm -rf "$old"
      echo "  [ok] removed previous version $(basename "$old")"
    fi
  done
fi

mkdir -p "$EXTENSION_DIR/src"
for file in package.json README.md LICENSE; do
  [ -f "$REPO_ROOT/$file" ] && cp "$REPO_ROOT/$file" "$EXTENSION_DIR/"
done
cp "$REPO_ROOT/src/extension.js" "$EXTENSION_DIR/src/"

echo "  [ok] extension installed to $EXTENSION_DIR"

echo ""
echo "Done. Next steps:"
echo "  1. Fully quit and reopen VS Code (a window reload does not always"
echo "     pick up a newly added extension folder)."
echo "  2. Send one message in Claude Code to populate the first reading."
echo ""
