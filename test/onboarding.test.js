const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// A throwaway config directory, so the first-run flow never touches real Claude Code state.
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stats-onboarding-'));
process.env.CLAUDE_CONFIG_DIR = FIXTURE_DIR;

const SETTINGS = path.join(FIXTURE_DIR, 'settings.json');
const FOREIGN = { type: 'command', command: 'bash ~/my-statusline.sh' };

const shown = [];
let answers = [];

function respond(kind) {
  return (message, ...rest) => {
    const options = rest.filter((r) => typeof r === 'string');
    const modal = rest.some((r) => r && typeof r === 'object' && r.modal);
    shown.push({ kind, message, options, modal });
    return Promise.resolve(answers.shift());
  };
}

const opened = [];
let legacyExtension;

const fakeVscode = {
  StatusBarAlignment: { Right: 2, Left: 1 },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  MarkdownString: class {
    constructor() {
      this.value = '';
    }
    appendMarkdown(text) {
      this.value += text;
      return this;
    }
  },
  Uri: { parse: (value) => ({ value }) },
  env: { openExternal: (uri) => opened.push(uri.value) },
  extensions: { getExtension: (id) => (id === 'claude-stats.claude-stats' ? legacyExtension : undefined) },
  window: {
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    showInformationMessage: respond('info'),
    showWarningMessage: respond('warning'),
    showErrorMessage: respond('error'),
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: () => {} },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (key === 'pollWhenStale' ? false : fallback) }),
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const ext = require('../src/extension.js');
const setup = require('../src/setup.js');
const VERSION = require('../package.json').version;

function memento(initial) {
  const values = Object.assign({}, initial);
  return {
    values,
    get: (key) => values[key],
    update: (key, value) => {
      values[key] = value;
      return Promise.resolve();
    },
  };
}

function context(initial) {
  return { subscriptions: [], globalState: memento(initial), extension: { id: 'awmium.claude-stats-statusbar' } };
}

const PROMPT = 'ClaudeStats needs to register a small status line hook with Claude Code. Set up now?';

beforeEach(() => {
  shown.length = 0;
  opened.length = 0;
  answers = [];
  legacyExtension = undefined;
  fs.rmSync(SETTINGS, { force: true });
  fs.rmSync(path.join(FIXTURE_DIR, 'settings.json.claude-stats-backup'), { force: true });
  fs.rmSync(path.join(FIXTURE_DIR, 'claude-stats'), { recursive: true, force: true });
  fs.rmSync(path.join(FIXTURE_DIR, 'usage-bridge.json'), { force: true });
});

test('first run shows one non-modal prompt with the three choices', async () => {
  const ctx = context();
  await ext.offerSetup(ctx);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].message, PROMPT);
  assert.deepEqual(shown[0].options, ['Set up', 'Not now', 'Learn more']);
  assert.equal(shown[0].modal, false);
});

test('"Set up" registers the hook', async () => {
  answers = ['Set up'];
  await ext.offerSetup(context());
  assert.equal(setup.inspect().hook, 'ours');
  assert.match(shown[1].message, /hooked into Claude Code/);
});

test('"Not now" is not asked again until the next version', async () => {
  const ctx = context();
  answers = ['Not now'];
  await ext.offerSetup(ctx);
  await ext.offerSetup(ctx);
  await ext.offerSetup(ctx);
  assert.equal(shown.length, 1, 'the prompt nagged within one version');
  assert.equal(setup.inspect().hook, 'none');

  ctx.globalState.values['claudeStats.setupPromptedVersion'] = '0.1.0';
  await ext.offerSetup(ctx);
  assert.equal(shown.length, 2, 'a new version should ask once more');
});

test('dismissing the prompt counts as asked', async () => {
  const ctx = context();
  answers = [undefined];
  await ext.offerSetup(ctx);
  await ext.offerSetup(ctx);
  assert.equal(shown.length, 1);
  assert.equal(ctx.globalState.values['claudeStats.setupPromptedVersion'], VERSION);
});

test('"Learn more" opens the readme and changes nothing', async () => {
  answers = ['Learn more'];
  await ext.offerSetup(context());
  assert.equal(opened.length, 1);
  assert.match(opened[0], /github\.com\/awmium\/claude-stats/);
  assert.ok(!fs.existsSync(SETTINGS));
});

test('no prompt when the hook is already ours, and the bridge is kept in sync', async () => {
  setup.install();
  const bridge = path.join(FIXTURE_DIR, 'claude-stats', 'statusline-usage.js');
  fs.writeFileSync(bridge, '// an older bridge\n');

  await ext.offerSetup(context());

  assert.equal(shown.length, 0);
  assert.ok(fs.readFileSync(bridge).equals(fs.readFileSync(setup.BRIDGE_SOURCE)), 'bridge not refreshed');
});

test('no prompt when a foreign wrapper is already feeding the bridge', async () => {
  fs.writeFileSync(SETTINGS, JSON.stringify({ statusLine: FOREIGN }));
  fs.writeFileSync(path.join(FIXTURE_DIR, 'usage-bridge.json'), JSON.stringify({ updatedAt: Date.now() }));
  await ext.offerSetup(context());
  assert.equal(shown.length, 0);
});

test('a foreign statusLine is refused, explained, and replaced only on confirm', async () => {
  fs.writeFileSync(SETTINGS, JSON.stringify({ statusLine: FOREIGN }));

  answers = [undefined];
  await ext.runSetup(context(), false);
  assert.equal(shown[0].kind, 'warning');
  assert.equal(shown[0].modal, true);
  assert.deepEqual(shown[0].options, ['Replace anyway', 'Show wrapper example']);
  assert.deepEqual(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).statusLine, FOREIGN);

  answers = ['Replace anyway'];
  await ext.runSetup(context(), false);
  assert.equal(setup.inspect().hook, 'ours');
  const backup = JSON.parse(fs.readFileSync(SETTINGS + '.claude-stats-backup', 'utf8'));
  assert.deepEqual(backup.statusLine, FOREIGN);
});

test('removing the hook stops the prompt for good, and setting it up again re-enables it', async () => {
  const ctx = context();
  await ext.runSetup(ctx, false);
  await ext.removeHook(ctx);
  assert.equal(setup.inspect().hook, 'none');
  assert.ok(!fs.existsSync(path.join(FIXTURE_DIR, 'claude-stats')));

  ctx.globalState.values['claudeStats.setupPromptedVersion'] = '0.1.0';
  shown.length = 0;
  await ext.offerSetup(ctx);
  assert.equal(shown.length, 0, 'prompted after the user removed the hook on purpose');

  await ext.runSetup(ctx, false);
  assert.equal(ctx.globalState.values['claudeStats.hookRemovedByUser'], false);
});

test('a source-installed copy under the old ID is flagged once per version', async () => {
  legacyExtension = { extensionPath: path.join(FIXTURE_DIR, 'claude-stats.claude-stats-0.1.0') };
  setup.install();
  const ctx = context();
  answers = ['Not now'];
  ext.activate(ctx);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  ext.activate(ctx);
  await new Promise((resolve) => setImmediate(resolve));
  const warnings = shown.filter((s) => /older ClaudeStats/.test(s.message));
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].options, ['Remove old copy', 'Not now']);
  for (const d of ctx.subscriptions) if (d && d.dispose) d.dispose();
});
