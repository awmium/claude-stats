const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Point the extension at a throwaway config directory before it is loaded, so no
// test ever reads or writes the developer's real Claude Code state.
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stats-ext-'));
process.env.CLAUDE_CONFIG_DIR = FIXTURE_DIR;

const ACCOUNT_UUID = 'account-under-test';

fs.writeFileSync(
  path.join(FIXTURE_DIR, '.claude.json'),
  JSON.stringify({
    oauthAccount: { accountUuid: ACCOUNT_UUID, emailAddress: 'dev@example.com' },
  })
);

fs.writeFileSync(
  path.join(FIXTURE_DIR, 'usage-bridge.json'),
  JSON.stringify({
    updatedAt: Date.now(),
    accountUuid: ACCOUNT_UUID,
    email: 'dev@example.com',
    sessionId: 'session-under-test',
    cwd: '/home/dev/project',
    rateLimits: {
      five_hour: { utilization: 85.0, resets_at: '2099-01-01T00:00:00Z' },
      seven_day: { utilization: 49.0, resets_at: '2099-01-02T00:00:00Z' },
    },
  })
);

class FakeMarkdownString {
  constructor() {
    this.value = '';
  }
  appendMarkdown(text) {
    this.value += text;
    return this;
  }
}

const fakeItem = { show() {}, hide() {}, dispose() {} };

const fakeVscode = {
  StatusBarAlignment: { Right: 2, Left: 1 },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  MarkdownString: FakeMarkdownString,
  window: { createStatusBarItem: () => fakeItem },
  commands: { registerCommand: () => ({ dispose() {} }) },
  workspace: {
    getConfiguration: () => ({
      // Polling stays off so the suite never touches the network.
      get: (key, fallback) => (key === 'pollWhenStale' ? false : fallback),
    }),
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const ext = require('../src/extension.js');

// Captured verbatim from a live GET /api/oauth/usage response.
const LIVE_API_RESPONSE = {
  five_hour: { utilization: 85.0, resets_at: '2026-09-03T22:30:00.320495+00:00' },
  seven_day: { utilization: 49.0, resets_at: '2026-09-05T12:00:00.320518+00:00' },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  cinder_cove: null,
  extra_usage: {
    is_enabled: true,
    monthly_limit: 300,
    used_credits: 300.0,
    utilization: 100.0,
    currency: 'USD',
  },
};

test('normalizes the live API response into the windows we display', () => {
  const windows = ext.normalize(LIVE_API_RESPONSE);
  assert.deepEqual(
    windows.map((w) => [w.label, w.percent]),
    [
      ['Session (5hr)', 85],
      ['Weekly (7 day)', 49],
    ]
  );
  assert.equal(windows[0].resetsAt, Date.parse('2026-09-03T22:30:00.320495+00:00'));
});

test('ignores null and unknown windows rather than rendering blanks', () => {
  assert.deepEqual(ext.normalize({ seven_day_opus: null, unknown_window: null }), []);
  assert.deepEqual(ext.normalize(null), []);
  assert.deepEqual(ext.normalize({}), []);
});

test('a payload of nothing but credits yields no windows', () => {
  assert.deepEqual(ext.normalize({ extra_usage: { is_enabled: true, utilization: 100 } }), []);
});

test('accepts both epoch and ISO reset stamps', () => {
  assert.equal(ext.toEpochMs(1788489506), 1788489506000);
  assert.equal(ext.toEpochMs(1788489506342), 1788489506342);
  assert.equal(ext.toEpochMs('2026-09-05T12:00:00Z'), Date.parse('2026-09-05T12:00:00Z'));
  assert.equal(ext.toEpochMs(null), null);
  assert.equal(ext.toEpochMs('not a date'), null);
});

test('formats reset distances in sensible units', () => {
  const now = Date.now();
  assert.equal(ext.relative(now + 5 * 60000), 'in 5m');
  assert.equal(ext.relative(now + 3 * 3600000), 'in 3h');
  assert.equal(ext.relative(now + 2 * 86400000), 'in 2d');
  assert.equal(ext.relative(now - 60000), 'due');
  assert.equal(ext.relative(null), null);
});

test('activate paints the status bar from the bridge file', () => {
  const disposables = [];
  ext.activate({ subscriptions: disposables });

  assert.equal(fakeItem.text, '$(pulse) 85% · 49%');
  const tooltip = fakeItem.tooltip.value;
  assert.match(tooltip, /Claude Code usage/);
  assert.match(tooltip, /Session \(5hr\)/);
  assert.match(tooltip, /Weekly \(7 day\)/);
  assert.match(tooltip, /Account: dev@example\.com/);
  assert.ok(!/undefined|NaN/.test(tooltip), 'tooltip leaked undefined/NaN: ' + tooltip);

  for (const d of disposables) if (d && d.dispose) d.dispose();
});

test('warns visually once a window crosses the warning threshold', () => {
  ext.refreshState();
  assert.equal(fakeItem.backgroundColor.id, 'statusBarItem.warningBackground');
});

test('drops cached figures when the signed-in account changes', () => {
  ext.refreshState();
  assert.ok(ext._peek().windows.length > 0, 'precondition: state populated from bridge');
  assert.ok(ext._peek().accountUuid, 'precondition: state carries an account');

  fs.writeFileSync(
    path.join(FIXTURE_DIR, '.claude.json'),
    JSON.stringify({
      oauthAccount: { accountUuid: 'a-different-account', emailAddress: 'other@example.com' },
    })
  );

  try {
    ext.refreshState();
    assert.equal(ext._peek().windows.length, 0, 'stale figures survived an account switch');
    assert.equal(fakeItem.text, '$(pulse) —');
    assert.match(fakeItem.tooltip.value, /No data yet/);
  } finally {
    fs.writeFileSync(
      path.join(FIXTURE_DIR, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: ACCOUNT_UUID, emailAddress: 'dev@example.com' },
      })
    );
  }
});

test('shows nothing rather than guessing when no bridge file exists', () => {
  const bridge = path.join(FIXTURE_DIR, 'usage-bridge.json');
  const saved = fs.readFileSync(bridge);
  fs.unlinkSync(bridge);
  ext._reset();
  try {
    ext.refreshState();
    assert.equal(fakeItem.text, '$(pulse) —');
  } finally {
    fs.writeFileSync(bridge, saved);
  }
});

function seedBridge(rateLimits, email) {
  fs.writeFileSync(
    path.join(FIXTURE_DIR, 'usage-bridge.json'),
    JSON.stringify({
      updatedAt: Date.now(),
      accountUuid: ACCOUNT_UUID,
      email: email || 'dev@example.com',
      rateLimits,
    })
  );
  ext._reset();
  ext.refreshState();
}

const NORMAL_LIMITS = {
  five_hour: { utilization: 10, resets_at: '2099-01-01T00:00:00Z' },
  seven_day: { utilization: 2, resets_at: '2099-01-02T00:00:00Z' },
};

test('an exhausted credit balance does not colour the item', () => {
  // Credits are a billing cap, not a rate limit, and never appear in the status
  // bar text. Colouring on them leaves the user with a red item and no reason for it.
  seedBridge({
    five_hour: { utilization: 9, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 31, resets_at: '2099-01-02T00:00:00Z' },
    extra_usage: { is_enabled: true, utilization: 100 },
  });
  assert.equal(fakeItem.text, '$(pulse) 9% · 31%');
  assert.ok(!/Extra usage credits/.test(fakeItem.tooltip.value));
  assert.equal(fakeItem.backgroundColor, undefined);
});

test('a hidden window never drives the colour', () => {
  seedBridge({
    five_hour: { utilization: 4, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 6, resets_at: '2099-01-02T00:00:00Z' },
    seven_day_opus: { utilization: 99, resets_at: '2099-01-03T00:00:00Z' },
  });
  assert.equal(fakeItem.text, '$(pulse) 4% · 6%');
  assert.equal(fakeItem.backgroundColor, undefined);
});

test('the session window still turns the item red at its own limit', () => {
  seedBridge({
    five_hour: { utilization: 100, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 31, resets_at: '2099-01-02T00:00:00Z' },
  });
  assert.equal(fakeItem.backgroundColor.id, 'statusBarItem.errorBackground');
});

test('the weekly window does not colour the item', () => {
  // Only the session window is actionable minute to minute; weekly sitting high is
  // normal mid-week and must not leave the item permanently coloured.
  seedBridge({
    five_hour: { utilization: 12, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 97, resets_at: '2099-01-02T00:00:00Z' },
  });
  assert.equal(fakeItem.text, '$(pulse) 12% · 97%');
  assert.equal(fakeItem.backgroundColor, undefined);
});

test('the session window warns at 80 and errors at 95', () => {
  seedBridge({
    five_hour: { utilization: 80, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 3, resets_at: '2099-01-02T00:00:00Z' },
  });
  assert.equal(fakeItem.backgroundColor.id, 'statusBarItem.warningBackground');

  seedBridge({
    five_hour: { utilization: 95, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 3, resets_at: '2099-01-02T00:00:00Z' },
  });
  assert.equal(fakeItem.backgroundColor.id, 'statusBarItem.errorBackground');

  seedBridge({
    five_hour: { utilization: 79, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 3, resets_at: '2099-01-02T00:00:00Z' },
  });
  assert.equal(fakeItem.backgroundColor, undefined);
});

test('no colour when the session window is absent', () => {
  seedBridge({
    seven_day: { utilization: 99, resets_at: '2099-01-02T00:00:00Z' },
  });
  assert.equal(fakeItem.text, '$(pulse) 99%');
  assert.equal(fakeItem.backgroundColor, undefined);
});

test('the hover trusts only this extension own command', () => {
  seedBridge(NORMAL_LIMITS);
  assert.deepEqual(
    fakeItem.tooltip.isTrusted,
    { enabledCommands: ['claudeStats.refresh'] },
    'a blanket isTrusted:true lets any interpolated text run arbitrary commands'
  );
});

test('a hostile account label cannot forge a command link', () => {
  seedBridge(NORMAL_LIMITS, '[click me](command:workbench.action.terminal.new)');
  const tooltip = fakeItem.tooltip.value;
  assert.ok(
    !/\[click me\]\(command:/.test(tooltip),
    'an injected command link survived into the hover: ' + tooltip
  );
});

test('a hostile error string cannot forge a link or break out of its line', () => {
  seedBridge(NORMAL_LIMITS);
  ext._setError('oops [x](command:evil)\ninjected row');
  const tooltip = fakeItem.tooltip.value;
  assert.ok(!/\[x\]\(command:/.test(tooltip), 'injected link survived: ' + tooltip);
  assert.ok(!/\ninjected row/.test(tooltip), 'injected newline broke out of the line');
});

// Captured from a live GET /api/oauth/usage on an account that has a per-model window.
const LIMITS_WITH_FABLE = {
  five_hour: { utilization: 10, resets_at: '2099-01-01T00:00:00Z' },
  seven_day: { utilization: 2, resets_at: '2099-01-02T00:00:00Z' },
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 10,
      severity: 'normal',
      resets_at: '2099-01-01T00:00:00Z',
      scope: null,
      is_active: true,
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 2,
      severity: 'normal',
      resets_at: '2099-01-02T00:00:00Z',
      scope: null,
      is_active: false,
    },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 7,
      severity: 'normal',
      resets_at: '2099-01-02T00:00:00Z',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null },
      is_active: false,
    },
  ],
};

const LIMITS_WITHOUT_FABLE = {
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 4,
      severity: 'normal',
      resets_at: '2099-01-01T00:00:00Z',
      scope: null,
      is_active: true,
    },
    {
      kind: 'weekly_all',
      group: 'weekly',
      percent: 9,
      severity: 'normal',
      resets_at: '2099-01-02T00:00:00Z',
      scope: null,
      is_active: false,
    },
  ],
};

test('builds rows from the server limits[] array, naming the scoped window', () => {
  assert.deepEqual(
    ext.normalize(LIMITS_WITH_FABLE).map((w) => [w.label, w.percent]),
    [
      ['Session (5hr)', 10],
      ['Weekly (7 day)', 2],
      ['Weekly Fable', 7],
    ]
  );
});

test('the row set follows the account, so a per-model window appears and disappears', () => {
  const withFable = ext.normalize(LIMITS_WITH_FABLE).map((w) => w.label);
  const withoutFable = ext.normalize(LIMITS_WITHOUT_FABLE).map((w) => w.label);
  assert.ok(withFable.includes('Weekly Fable'), 'expected the scoped window on this account');
  assert.ok(!withoutFable.includes('Weekly Fable'), 'scoped window leaked onto an account without one');
  assert.deepEqual(withoutFable, ['Session (5hr)', 'Weekly (7 day)']);
});

test('an unfamiliar limit kind still renders rather than vanishing', () => {
  const windows = ext.normalize({
    limits: [{ kind: 'monthly_experiment', percent: 12, resets_at: null, scope: null }],
  });
  assert.deepEqual(windows.map((w) => [w.label, w.percent]), [['Monthly Experiment', 12]]);
});

test('limits[] identifies the session window for colouring', () => {
  const windows = ext.normalize({
    limits: [
      { kind: 'weekly_all', percent: 99, resets_at: null, scope: null },
      { kind: 'session', percent: 3, resets_at: null, scope: null },
    ],
  });
  assert.equal(windows.find((w) => w.isSession).percent, 3);
  assert.equal(windows.filter((w) => w.isSession).length, 1);
});

test('the bridge renders per-model windows the server names for it', () => {
  seedBridge({
    five_hour: { utilization: 10, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 2, resets_at: '2099-01-02T00:00:00Z' },
    model_scoped: [{ display_name: 'Fable', utilization: 7, resets_at: '2099-01-02T00:00:00Z' }],
  });
  assert.equal(fakeItem.text, '$(pulse) 10% · 2%');
  assert.match(fakeItem.tooltip.value, /Weekly Fable/);
  assert.match(fakeItem.tooltip.value, /7%/);
});

test('the bridge shows no per-model rows when the account has none', () => {
  seedBridge({
    five_hour: { utilization: 10, resets_at: '2099-01-01T00:00:00Z' },
    seven_day: { utilization: 2, resets_at: '2099-01-02T00:00:00Z' },
    model_scoped: [],
  });
  assert.ok(!/Weekly Fable/.test(fakeItem.tooltip.value));
});

test('the organisation credit pool is never shown as a usage window', () => {
  // It is org billing state the signed-in user often cannot control, not their usage.
  const windows = ext.normalize({
    five_hour: { utilization: 5, resets_at: null },
    extra_usage: { is_enabled: true, utilization: 100 },
  });
  assert.deepEqual(windows.map((w) => w.label), ['Session (5hr)']);
});

test('a hostile model display name cannot forge a command link', () => {
  const windows = ext.normalize({
    limits: [
      {
        kind: 'weekly_scoped',
        percent: 1,
        resets_at: null,
        scope: { model: { display_name: '[x](command:workbench.action.terminal.new)' } },
      },
    ],
  });
  seedBridge({ five_hour: { utilization: 1, resets_at: null } });
  ext._setWindows(windows);
  assert.ok(
    !/\[x\]\(command:/.test(fakeItem.tooltip.value),
    'server-supplied label forged a command link: ' + fakeItem.tooltip.value
  );
});
