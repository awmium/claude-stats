#!/usr/bin/env node
// Registers and removes the ClaudeStats statusLine hook in Claude Code's settings.json.
// Used by the extension (Set Up / Remove commands, first-run prompt) and by the install
// and uninstall scripts, so both routes make exactly the same change.
//
// CLI: node src/setup.js install [--force]
//      node src/setup.js uninstall
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = 'statusline-usage.js';
const BRIDGE_SOURCE = path.join(__dirname, 'bridge', MARKER);
const BACKUP_SUFFIX = '.claude-stats-backup';

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function paths(dir) {
  const root = dir || claudeDir();
  const bridgeDir = path.join(root, 'claude-stats');
  const settings = path.join(root, 'settings.json');
  return {
    claudeDir: root,
    bridgeDir,
    bridge: path.join(bridgeDir, MARKER),
    settings,
    backup: settings + BACKUP_SUFFIX,
    cache: path.join(root, 'usage-bridge.json'),
  };
}

// Forward slashes on every platform: Claude Code runs this through a shell, and on
// Windows that shell may be Git Bash, which eats backslashes.
function hookCommand(bridge) {
  return 'node "' + bridge.replace(/\\/g, '/') + '"';
}

function isOurs(statusLine) {
  return Boolean(
    statusLine && typeof statusLine.command === 'string' && statusLine.command.includes(MARKER)
  );
}

function isForeign(statusLine) {
  return Boolean(
    statusLine &&
      typeof statusLine.command === 'string' &&
      statusLine.command !== '' &&
      !isOurs(statusLine)
  );
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// An unparseable settings.json is reported, never overwritten: replacing it with {} would
// silently drop every other setting the user has.
function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, settings: {} };
    throw err;
  }
  raw = raw.replace(/^\uFEFF/, '');
  if (!raw.trim()) return { exists: true, settings: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { exists: true, settings: parsed };
    }
  } catch {
    // fall through
  }
  return { exists: true, settings: null, unreadable: true };
}

// No BOM: Claude Code discards a settings.json that starts with one.
function writeAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Windows can refuse the rename while another process holds the file open.
    try {
      fs.writeFileSync(file, data, 'utf8');
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // already gone
      }
    }
    if (!fs.existsSync(file)) throw err;
  }
}

function sameContent(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function copyBridge(p, source) {
  if (sameContent(source, p.bridge)) return false;
  fs.mkdirSync(p.bridgeDir, { recursive: true });
  const tmp = p.bridge + '.' + process.pid + '.tmp';
  fs.copyFileSync(source, tmp);
  fs.renameSync(tmp, p.bridge);
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(p.bridge, 0o755);
    } catch {
      // not fatal: the hook runs it through node, not directly
    }
  }
  return true;
}

function inspect(options) {
  const opts = options || {};
  const p = paths(opts.dir);
  const source = opts.source || BRIDGE_SOURCE;
  const result = {
    paths: p,
    claudeDirExists: isDirectory(p.claudeDir),
    settingsUnreadable: false,
    hook: 'none',
    command: null,
    bridgeInstalled: fs.existsSync(p.bridge),
    bridgeCurrent: sameContent(source, p.bridge),
  };
  const read = readSettings(p.settings);
  if (read.unreadable) {
    result.settingsUnreadable = true;
    return result;
  }
  const statusLine = read.settings.statusLine;
  if (isOurs(statusLine)) {
    result.hook = 'ours';
    result.command = statusLine.command;
  } else if (isForeign(statusLine)) {
    result.hook = 'foreign';
    result.command = statusLine.command;
  }
  return result;
}

// Mirrors the install scripts: copy the bridge, back settings.json up once, then point
// statusLine at the bridge. A statusLine that is not ours is left alone unless force is set.
function install(options) {
  const opts = options || {};
  const p = paths(opts.dir);
  const source = opts.source || BRIDGE_SOURCE;
  const steps = [];

  if (!isDirectory(p.claudeDir)) return { status: 'no-claude-dir', paths: p, steps };

  const read = readSettings(p.settings);
  if (read.unreadable) return { status: 'settings-unreadable', paths: p, steps };

  steps.push(copyBridge(p, source) ? 'bridge-installed' : 'bridge-current');

  const settings = read.settings;
  const existing = settings.statusLine;
  const expected = hookCommand(p.bridge);
  const foreign = isForeign(existing);

  if (foreign && !opts.force) {
    return { status: 'foreign', command: existing.command, paths: p, steps };
  }

  if (isOurs(existing) && existing.command === expected && existing.type === 'command') {
    return { status: 'unchanged', paths: p, steps };
  }

  if (read.exists && !fs.existsSync(p.backup)) {
    fs.copyFileSync(p.settings, p.backup);
    steps.push('settings-backed-up');
  }

  settings.statusLine = { type: 'command', command: expected, padding: 0 };
  writeAtomic(p.settings, JSON.stringify(settings, null, 2) + '\n');
  steps.push('statusline-registered');

  return {
    status: foreign ? 'replaced' : 'installed',
    replacedCommand: foreign ? existing.command : null,
    paths: p,
    steps,
  };
}

// Mirrors the uninstall scripts for the statusLine: removed only when it is ours. With
// removeFiles, the bridge and its cached reading go too, but not while a statusLine that
// is not ours is still registered, since a wrapper script may be calling the bridge.
function uninstall(options) {
  const opts = options || {};
  const p = paths(opts.dir);
  const removed = [];

  const read = readSettings(p.settings);
  if (read.unreadable) return { status: 'settings-unreadable', paths: p, removed };

  const settings = read.settings;
  let status = 'none';
  if (isOurs(settings.statusLine)) {
    delete settings.statusLine;
    writeAtomic(p.settings, JSON.stringify(settings, null, 2) + '\n');
    status = 'removed';
  } else if (isForeign(settings.statusLine)) {
    status = 'foreign';
  }

  if (opts.removeFiles && status !== 'foreign') {
    for (const target of [p.bridgeDir, p.cache]) {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(target);
      }
    }
  }

  return { status, paths: p, removed };
}

// Keeps the installed bridge in step with the extension after an update. Only touches a
// bridge whose hook is ours, so a removed or replaced hook is never brought back.
function syncBridge(options) {
  const opts = options || {};
  const info = inspect(opts);
  if (info.hook !== 'ours') return false;
  return copyBridge(info.paths, opts.source || BRIDGE_SOURCE);
}

// Claude Code runs the hook as `node ...`. VS Code's PATH can differ from a terminal's,
// so a miss here is a hint for the user, never a reason to refuse.
function nodeOnPath(envPath) {
  const dirs = String(envPath == null ? process.env.PATH || '' : envPath)
    .split(path.delimiter)
    .filter(Boolean);
  const names = process.platform === 'win32' ? ['node.exe', 'node.cmd', 'node'] : ['node'];
  return dirs.some((dir) => names.some((name) => fs.existsSync(path.join(dir, name))));
}

module.exports = {
  BRIDGE_SOURCE,
  claudeDir,
  paths,
  hookCommand,
  isOurs,
  inspect,
  install,
  uninstall,
  syncBridge,
  nodeOnPath,
};

function cli(argv) {
  const action = argv[0];
  if (action === 'install') {
    const result = install({ force: argv.includes('--force') });
    if (result.status === 'no-claude-dir') {
      console.error('Claude Code config directory not found at ' + result.paths.claudeDir + '.');
      console.error('Install and sign in to Claude Code first.');
      return 1;
    }
    if (result.status === 'settings-unreadable') {
      console.log('');
      console.log('WARNING: ' + result.paths.settings + ' is not valid JSON, so it was left untouched.');
      console.log('Fix the file and re-run the installer to register the statusLine.');
      console.log('The extension will still install, but will rely on polling only.');
      return 0;
    }
    if (result.steps.includes('bridge-installed')) console.log('  [ok] bridge installed');
    else console.log('  [ok] bridge already up to date');
    if (result.status === 'foreign') {
      console.log('');
      console.log('WARNING: you already have a statusLine configured, so it was left untouched:');
      console.log('    ' + result.command);
      console.log('');
      console.log('ClaudeStats needs that hook to receive usage data. Either:');
      console.log('  - chain the two commands yourself in a wrapper script, or');
      console.log('  - re-run this installer with --force (-Force on PowerShell) to replace it.');
      console.log('');
      console.log('The extension will still install, but will rely on polling only.');
      return 0;
    }
    if (result.steps.includes('settings-backed-up')) {
      console.log('  [ok] settings backed up to settings.json' + BACKUP_SUFFIX);
    }
    console.log(
      result.status === 'unchanged' ? '  [ok] statusLine already registered' : '  [ok] statusLine registered'
    );
    return 0;
  }
  if (action === 'uninstall') {
    const result = uninstall();
    if (result.status === 'removed') console.log('  [ok] statusLine removed');
    else if (result.status === 'settings-unreadable') {
      console.log('  [skip] settings.json is not valid JSON, left as is');
    } else if (result.status === 'foreign') {
      console.log('  [skip] statusLine is not ClaudeStats, left as is');
    } else console.log('  [skip] no ClaudeStats statusLine registered');
    return 0;
  }
  console.error('Usage: node setup.js install [--force] | uninstall');
  return 1;
}

if (require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}
