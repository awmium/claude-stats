const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Never let a test fall through to the developer's real ~/.claude.
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stats-setup-env-'));

const setup = require('../src/setup.js');

const SETUP_CLI = path.join(__dirname, '..', 'src', 'setup.js');

function configDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stats-setup-'));
}

function readSettings(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
}

function writeSettings(dir, value) {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(value, null, 2));
}

const FOREIGN = { type: 'command', command: 'bash ~/my-statusline.sh', padding: 1 };

test('setup copies the bridge and registers it as the statusLine', () => {
  const dir = configDir();
  writeSettings(dir, { model: 'opus', permissions: { allow: ['Bash(ls)'] } });

  const result = setup.install({ dir });

  assert.equal(result.status, 'installed');
  const bridge = path.join(dir, 'claude-stats', 'statusline-usage.js');
  assert.ok(
    fs.readFileSync(bridge).equals(fs.readFileSync(setup.BRIDGE_SOURCE)),
    'bridge is not a copy of the source'
  );
  const settings = readSettings(dir);
  assert.deepEqual(settings.statusLine, {
    type: 'command',
    command: 'node "' + bridge.replace(/\\/g, '/') + '"',
    padding: 0,
  });
  assert.equal(settings.model, 'opus', 'other settings must survive');
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
});

test('the hook command uses forward slashes on every platform', () => {
  assert.equal(
    setup.hookCommand('C:\\Users\\dev\\.claude\\claude-stats\\statusline-usage.js'),
    'node "C:/Users/dev/.claude/claude-stats/statusline-usage.js"'
  );
});

test('setup backs settings.json up once, before its first change', () => {
  const dir = configDir();
  writeSettings(dir, { model: 'opus' });
  const original = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');

  setup.install({ dir });
  const backup = path.join(dir, 'settings.json.claude-stats-backup');
  assert.equal(fs.readFileSync(backup, 'utf8'), original);

  writeSettings(dir, { model: 'sonnet' });
  setup.install({ dir });
  assert.equal(fs.readFileSync(backup, 'utf8'), original, 'a later run overwrote the original backup');
});

test('setup creates settings.json when there is none, without a backup', () => {
  const dir = configDir();
  const result = setup.install({ dir });
  assert.equal(result.status, 'installed');
  assert.ok(readSettings(dir).statusLine);
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json.claude-stats-backup')));
});

test('setup is idempotent', () => {
  const dir = configDir();
  writeSettings(dir, { model: 'opus' });
  setup.install({ dir });
  const settingsFile = path.join(dir, 'settings.json');
  const first = fs.readFileSync(settingsFile, 'utf8');
  const firstMtime = fs.statSync(settingsFile).mtimeMs;

  const again = setup.install({ dir });

  assert.equal(again.status, 'unchanged');
  assert.deepEqual(again.steps, ['bridge-current']);
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), first);
  assert.equal(fs.statSync(settingsFile).mtimeMs, firstMtime, 'an unchanged setup rewrote settings.json');
});

test('setup writes settings.json atomically and leaves no temp files', () => {
  const dir = configDir();
  writeSettings(dir, { model: 'opus' });
  setup.install({ dir });
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  const bridgeLeftovers = fs.readdirSync(path.join(dir, 'claude-stats')).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(bridgeLeftovers, []);
});

test('setup refuses to replace a statusLine it did not create', () => {
  const dir = configDir();
  writeSettings(dir, { statusLine: FOREIGN });
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');

  const result = setup.install({ dir });

  assert.equal(result.status, 'foreign');
  assert.equal(result.command, FOREIGN.command);
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json.claude-stats-backup')));
});

test('force replaces a foreign statusLine, backing the original up first', () => {
  const dir = configDir();
  writeSettings(dir, { statusLine: FOREIGN });

  const result = setup.install({ dir, force: true });

  assert.equal(result.status, 'replaced');
  assert.equal(result.replacedCommand, FOREIGN.command);
  assert.ok(setup.isOurs(readSettings(dir).statusLine));
  const backup = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json.claude-stats-backup'), 'utf8'));
  assert.deepEqual(backup.statusLine, FOREIGN);
});

test('a hook of ours pointing at an old path is updated without force', () => {
  const dir = configDir();
  writeSettings(dir, { statusLine: { type: 'command', command: 'node "/old/place/statusline-usage.js"' } });
  const result = setup.install({ dir });
  assert.equal(result.status, 'installed');
  assert.match(readSettings(dir).statusLine.command, /claude-stats\/statusline-usage\.js"$/);
});

test('an unreadable settings.json is reported and never overwritten', () => {
  const dir = configDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ "model": "opus", oops }');

  assert.equal(setup.install({ dir }).status, 'settings-unreadable');
  assert.equal(setup.install({ dir, force: true }).status, 'settings-unreadable');
  assert.equal(setup.uninstall({ dir }).status, 'settings-unreadable');
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ "model": "opus", oops }');
});

test('a settings.json with a BOM is read rather than treated as broken', () => {
  const dir = configDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), '\uFEFF' + JSON.stringify({ model: 'opus' }));
  assert.equal(setup.install({ dir }).status, 'installed');
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!raw.startsWith('\uFEFF'), 'a BOM makes Claude Code discard settings.json');
  assert.equal(JSON.parse(raw).model, 'opus');
});

test('setup refuses when the Claude Code config directory does not exist', () => {
  const dir = path.join(configDir(), 'not-there');
  const result = setup.install({ dir });
  assert.equal(result.status, 'no-claude-dir');
  assert.ok(!fs.existsSync(dir), 'setup created a config directory Claude Code never made');
});

test('setup never touches the credentials file', () => {
  const dir = configDir();
  const credentials = path.join(dir, '.credentials.json');
  fs.writeFileSync(credentials, '{"claudeAiOauth":{"accessToken":"fixture"}}');
  const before = fs.statSync(credentials).mtimeMs;
  setup.install({ dir });
  setup.uninstall({ dir, removeFiles: true });
  assert.equal(fs.readFileSync(credentials, 'utf8'), '{"claudeAiOauth":{"accessToken":"fixture"}}');
  assert.equal(fs.statSync(credentials).mtimeMs, before);
});

test('removal deletes only our statusLine and keeps every other setting', () => {
  const dir = configDir();
  writeSettings(dir, { model: 'opus' });
  setup.install({ dir });

  const result = setup.uninstall({ dir });

  assert.equal(result.status, 'removed');
  assert.deepEqual(readSettings(dir), { model: 'opus' });
});

test('removal leaves a foreign statusLine and the bridge alone', () => {
  const dir = configDir();
  setup.install({ dir });
  writeSettings(dir, { statusLine: FOREIGN });
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');

  const result = setup.uninstall({ dir, removeFiles: true });

  assert.equal(result.status, 'foreign');
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
  assert.ok(
    fs.existsSync(path.join(dir, 'claude-stats', 'statusline-usage.js')),
    'a wrapper may still call the bridge'
  );
});

test('removal with removeFiles takes the bridge and cached reading too', () => {
  const dir = configDir();
  setup.install({ dir });
  fs.writeFileSync(path.join(dir, 'usage-bridge.json'), '{}');

  const result = setup.uninstall({ dir, removeFiles: true });

  assert.equal(result.status, 'removed');
  assert.ok(!fs.existsSync(path.join(dir, 'claude-stats')));
  assert.ok(!fs.existsSync(path.join(dir, 'usage-bridge.json')));
});

test('removal when nothing is registered changes nothing', () => {
  const dir = configDir();
  writeSettings(dir, { model: 'opus' });
  const before = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.equal(setup.uninstall({ dir }).status, 'none');
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), before);
});

test('inspect reports none, ours and foreign', () => {
  const dir = configDir();
  assert.equal(setup.inspect({ dir }).hook, 'none');
  setup.install({ dir });
  const ours = setup.inspect({ dir });
  assert.equal(ours.hook, 'ours');
  assert.ok(ours.bridgeInstalled && ours.bridgeCurrent);
  writeSettings(dir, { statusLine: FOREIGN });
  assert.equal(setup.inspect({ dir }).hook, 'foreign');
});

test('syncBridge refreshes a stale bridge only while the hook is ours', () => {
  const dir = configDir();
  const source = path.join(configDir(), 'statusline-usage.js');
  fs.writeFileSync(source, '// version one\n');
  setup.install({ dir, source });
  const bridge = path.join(dir, 'claude-stats', 'statusline-usage.js');

  fs.writeFileSync(source, '// version two\n');
  assert.equal(setup.syncBridge({ dir, source }), true);
  assert.equal(fs.readFileSync(bridge, 'utf8'), '// version two\n');
  assert.equal(setup.syncBridge({ dir, source }), false, 'an identical bridge was copied again');

  writeSettings(dir, { statusLine: FOREIGN });
  fs.writeFileSync(source, '// version three\n');
  assert.equal(setup.syncBridge({ dir, source }), false);
  assert.equal(fs.readFileSync(bridge, 'utf8'), '// version two\n');
});

test('syncBridge does not bring back a hook the user removed', () => {
  const dir = configDir();
  setup.install({ dir });
  setup.uninstall({ dir, removeFiles: true });
  assert.equal(setup.syncBridge({ dir }), false);
  assert.ok(!fs.existsSync(path.join(dir, 'claude-stats')));
});

test('CLAUDE_CONFIG_DIR decides where setup writes', () => {
  const dir = configDir();
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const result = setup.install();
    assert.equal(result.paths.claudeDir, dir);
    assert.ok(fs.existsSync(path.join(dir, 'claude-stats', 'statusline-usage.js')));
    assert.ok(setup.isOurs(readSettings(dir).statusLine));
    assert.equal(setup.uninstall().status, 'removed');
  } finally {
    process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

function cli(dir, args) {
  return spawnSync(process.execPath, [SETUP_CLI, ...args], {
    env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir }),
    encoding: 'utf8',
  });
}

test('the CLI the install scripts call registers, refuses and removes', () => {
  const dir = configDir();
  let run = cli(dir, ['install']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[ok\] statusLine registered/);
  assert.ok(setup.isOurs(readSettings(dir).statusLine));

  run = cli(dir, ['uninstall']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[ok\] statusLine removed/);

  writeSettings(dir, { statusLine: FOREIGN });
  run = cli(dir, ['install']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /left untouched/);
  assert.deepEqual(readSettings(dir).statusLine, FOREIGN);

  run = cli(dir, ['install', '--force']);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(setup.isOurs(readSettings(dir).statusLine));
});

test('the CLI fails clearly when Claude Code is not set up', () => {
  const run = cli(path.join(configDir(), 'missing'), ['install']);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /config directory not found/);
});
