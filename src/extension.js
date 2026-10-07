const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const setup = require('./setup');

const VERSION = require('../package.json').version;

const USAGE_HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

let item;
let state = emptyState();
let pollInFlight = false;

// Paths are resolved per call rather than at load, so CLAUDE_CONFIG_DIR is honoured
// and tests can point the whole extension at a fixture directory.
function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function bridgePath() {
  return path.join(claudeDir(), 'usage-bridge.json');
}

function credentialsPath() {
  return path.join(claudeDir(), '.credentials.json');
}

function accountPath() {
  const inConfigDir = path.join(claudeDir(), '.claude.json');
  if (fs.existsSync(inConfigDir)) return inConfigDir;
  return path.join(os.homedir(), '.claude.json');
}

function emptyState() {
  return { windows: [], updatedAt: 0, email: null, accountUuid: null, source: null, error: null };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function currentAccount() {
  const account = readJson(accountPath());
  const oa = account && account.oauthAccount;
  return oa ? { uuid: oa.accountUuid, email: oa.emailAddress } : { uuid: null, email: null };
}

function toEpochMs(resetsAt) {
  if (resetsAt == null) return null;
  if (typeof resetsAt === 'number') return resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
  const parsed = Date.parse(resetsAt);
  return Number.isNaN(parsed) ? null : parsed;
}

// Labels for the flat per-window keys the statusLine hook sends.
const WINDOW_LABELS = {
  five_hour: 'Session (5hr)',
  seven_day: 'Weekly (7 day)',
  seven_day_opus: 'Opus (7 day)',
  seven_day_sonnet: 'Sonnet (7 day)',
};

// Labels for the kinds the server's own limits[] array uses.
const LIMIT_KIND_LABELS = {
  session: 'Session (5hr)',
  weekly_all: 'Weekly (7 day)',
};

function titleCase(text) {
  return String(text)
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function scopedName(entry) {
  const model = entry.scope && entry.scope.model;
  return (model && model.display_name) || null;
}

// An unrecognised kind is labelled rather than dropped, so a window the server adds
// later still shows up instead of silently going missing.
function labelForLimit(entry) {
  const name = scopedName(entry);
  if (entry.kind === 'weekly_scoped' && name) return 'Weekly ' + name;
  if (LIMIT_KIND_LABELS[entry.kind]) return LIMIT_KIND_LABELS[entry.kind];
  return name ? titleCase(entry.kind) + ' ' + name : titleCase(entry.kind);
}

function fromLimits(limits) {
  const windows = [];
  for (const entry of limits) {
    if (!entry || typeof entry.percent !== 'number') continue;
    windows.push({
      isSession: entry.kind === 'session',
      label: labelForLimit(entry),
      percent: Math.round(entry.percent),
      resetsAt: toEpochMs(entry.resets_at),
    });
  }
  return windows;
}

function fromRateLimits(rateLimits) {
  const windows = [];
  for (const key of Object.keys(WINDOW_LABELS)) {
    const w = rateLimits[key];
    if (!w || typeof w.utilization !== 'number') continue;
    windows.push({
      isSession: key === 'five_hour',
      label: WINDOW_LABELS[key],
      percent: Math.round(w.utilization),
      resetsAt: toEpochMs(w.resets_at),
    });
  }
  // Per-model weekly windows, named by the server. Absent on accounts that have none.
  if (Array.isArray(rateLimits.model_scoped)) {
    for (const w of rateLimits.model_scoped) {
      if (!w || typeof w.utilization !== 'number' || !w.display_name) continue;
      windows.push({
        isSession: false,
        label: 'Weekly ' + w.display_name,
        percent: Math.round(w.utilization),
        resetsAt: toEpochMs(w.resets_at),
      });
    }
  }
  return windows;
}

// The server's limits[] is the curated list the Claude Code panel itself renders, so it
// is preferred wherever present; the hook's flat keys are the fallback. Organisation
// credit balances are deliberately excluded from both: that is billing state, not usage.
function normalize(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.limits) && payload.limits.length) return fromLimits(payload.limits);
  return fromRateLimits(payload);
}

function loadFromBridge() {
  const record = readJson(bridgePath());
  if (!record) return null;
  const account = currentAccount();
  // A record stamped with a different account belongs to another sign-in, not this one.
  if (record.accountUuid && account.uuid && record.accountUuid !== account.uuid) return null;
  const windows = normalize(record.rateLimits);
  if (!windows.length) return null;
  return {
    windows,
    updatedAt: record.updatedAt || 0,
    email: record.email || account.email,
    accountUuid: record.accountUuid || account.uuid || null,
    source: 'session',
  };
}

function ageMinutes(updatedAt) {
  return (Date.now() - updatedAt) / 60000;
}

function relative(ms) {
  if (ms == null) return null;
  const delta = ms - Date.now();
  if (delta <= 0) return 'due';
  const minutes = Math.round(delta / 60000);
  if (minutes < 60) return 'in ' + minutes + 'm';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return 'in ' + hours + 'h';
  return 'in ' + Math.round(hours / 24) + 'd';
}

function fetchUsage() {
  return new Promise((resolve, reject) => {
    const credentials = readJson(credentialsPath());
    const oauth = credentials && credentials.claudeAiOauth;
    if (!oauth || !oauth.accessToken) return reject(new Error('not signed in'));
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) return reject(new Error('token expired'));

    // The token is held for this request only, never stored or logged.
    const request = https.request(
      {
        hostname: USAGE_HOST,
        path: USAGE_PATH,
        method: 'GET',
        timeout: 8000,
        headers: {
          Authorization: 'Bearer ' + oauth.accessToken,
          'anthropic-beta': OAUTH_BETA,
          'Content-Type': 'application/json',
          'User-Agent': 'claude-stats/' + VERSION,
        },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            return reject(new Error('HTTP ' + response.statusCode));
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function poll() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const body = await fetchUsage();
    const windows = normalize(body);
    if (windows.length) {
      const account = currentAccount();
      state = {
        windows,
        updatedAt: Date.now(),
        email: account.email,
        accountUuid: account.uuid,
        source: 'api',
        error: null,
      };
    }
  } catch (err) {
    state.error = err.message;
  } finally {
    pollInFlight = false;
    paint();
  }
}

function refreshState() {
  // Figures cached from a previous sign-in must be dropped, not shown, after an account switch.
  const signedInAs = currentAccount().uuid;
  if (state.accountUuid && signedInAs && state.accountUuid !== signedInAs) {
    state = emptyState();
  }
  const fromBridge = loadFromBridge();
  if (fromBridge && fromBridge.updatedAt >= state.updatedAt) {
    state = Object.assign({}, fromBridge, { error: null });
  }
  const config = vscode.workspace.getConfiguration('claudeStats');
  const staleAfter = config.get('staleAfterMinutes', 10);
  const stale = !state.windows.length || ageMinutes(state.updatedAt) > staleAfter;
  if (config.get('pollWhenStale', true) && stale) {
    poll();
  }
  paint();
}

// A trusted MarkdownString can run `command:` links. Everything interpolated into the
// hover is therefore neutralised first, so no value from disk or the network can forge one.
function safeText(value) {
  return String(value == null ? '' : value)
    .replace(/[\\`[\]|]/g, '\\$&')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
}

function buildTooltip() {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = { enabledCommands: ['claudeStats.refresh'] };
  md.supportHtml = false;
  md.appendMarkdown('**Claude Code usage**\n\n');
  if (!state.windows.length) {
    md.appendMarkdown(
      state.error
        ? 'No data — ' + safeText(state.error) + '.\n\n'
        : 'No data yet. Start a Claude Code session.\n\n'
    );
  } else {
    md.appendMarkdown('| Window | Used | Resets |\n| :-- | --: | :-- |\n');
    for (const w of state.windows) {
      md.appendMarkdown(
        '| ' + safeText(w.label) + ' | ' + w.percent + '% | ' + (relative(w.resetsAt) || '—') + ' |\n'
      );
    }
    const age = Math.round(ageMinutes(state.updatedAt));
    const via = state.source === 'api' ? 'polled' : 'from session';
    md.appendMarkdown('\n_' + (age < 1 ? 'just now' : age + 'm ago') + ' · ' + via + '_\n\n');
  }
  if (state.email) {
    md.appendMarkdown('_Account: ' + safeText(state.email) + '_\n\n');
  }
  if (state.error && state.windows.length) {
    md.appendMarkdown('_Last refresh failed: ' + safeText(state.error) + '_\n\n');
  }
  md.appendMarkdown('[Refresh now](command:claudeStats.refresh)');
  return md;
}

function paint() {
  if (!item) return;
  if (!state.windows.length) {
    item.text = '$(pulse) —';
    item.backgroundColor = undefined;
  } else {
    const shown = state.windows.slice(0, 2);
    item.text = '$(pulse) ' + shown.map((w) => w.percent + '%').join(' · ');
    // Only the session window colours the item. Weekly sits high for days at a time and
    // credits are an org billing pool, so neither is actionable in the moment.
    const session = state.windows.find((w) => w.isSession);
    if (session && session.percent >= 95) {
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (session && session.percent >= 80) {
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      item.backgroundColor = undefined;
    }
  }
  item.tooltip = buildTooltip();
  item.show();
}

const REPO_URL = 'https://github.com/awmium/claude-stats';
const LEGACY_ID = 'claude-stats.claude-stats';
const PROMPTED_KEY = 'claudeStats.setupPromptedVersion';
const REMOVED_KEY = 'claudeStats.hookRemovedByUser';
const LEGACY_WARNED_KEY = 'claudeStats.legacyWarnedVersion';
const WRAPPER_FED_DAYS = 7;

function openLink(anchor) {
  return vscode.env.openExternal(vscode.Uri.parse(REPO_URL + anchor));
}

// A foreign statusLine that still produces fresh readings is a wrapper calling our bridge,
// so there is nothing to set up.
function wrapperFeedsBridge() {
  const record = readJson(bridgePath());
  return Boolean(record && record.updatedAt && Date.now() - record.updatedAt < WRAPPER_FED_DAYS * 86400000);
}

async function runSetup(context, force) {
  const store = context && context.globalState;
  let result;
  try {
    result = setup.install({ force });
  } catch (err) {
    vscode.window.showErrorMessage('ClaudeStats could not set up the hook: ' + err.message);
    return result;
  }
  const where = result.paths.claudeDir;
  switch (result.status) {
    case 'installed':
    case 'replaced':
    case 'unchanged': {
      if (store) await store.update(REMOVED_KEY, false);
      let message =
        result.status === 'unchanged'
          ? 'The ClaudeStats hook is already set up in Claude Code.'
          : 'ClaudeStats is now hooked into Claude Code. Send one message in Claude Code for the first reading.';
      if (!setup.nodeOnPath()) {
        message +=
          ' Claude Code runs the hook with node, which was not found on the PATH VS Code sees. If the status bar stays on a dash, install Node 20 or newer.';
      }
      vscode.window.showInformationMessage(message);
      break;
    }
    case 'no-claude-dir':
      vscode.window.showWarningMessage(
        'Claude Code config directory not found at ' + where + '. Install and sign in to Claude Code first, then run "ClaudeStats: Set Up Claude Code Hook".'
      );
      break;
    case 'settings-unreadable':
      vscode.window.showErrorMessage(
        result.paths.settings + ' is not valid JSON, so ClaudeStats left it untouched. Fix the file, then run "ClaudeStats: Set Up Claude Code Hook" again.'
      );
      break;
    case 'foreign': {
      const choice = await vscode.window.showWarningMessage(
        'You already have a Claude Code status line, and Claude Code allows only one.',
        {
          modal: true,
          detail:
            'Current statusLine: ' + result.command + '\n\n' +
            'ClaudeStats left it untouched. To keep both, point statusLine at a small wrapper script that passes Claude Code\'s input to both commands (the README shows one). ' +
            'Or replace it: your original settings.json is kept as settings.json.claude-stats-backup.',
        },
        'Replace anyway',
        'Show wrapper example'
      );
      if (choice === 'Replace anyway') return runSetup(context, true);
      if (choice === 'Show wrapper example') openLink('#already-using-a-custom-status-line');
      break;
    }
  }
  return result;
}

async function removeHook(context) {
  const store = context && context.globalState;
  let result;
  try {
    result = setup.uninstall({ removeFiles: true });
  } catch (err) {
    vscode.window.showErrorMessage('ClaudeStats could not remove the hook: ' + err.message);
    return result;
  }
  if (result.status === 'settings-unreadable') {
    vscode.window.showErrorMessage(result.paths.settings + ' is not valid JSON, so ClaudeStats left it untouched.');
    return result;
  }
  if (store) await store.update(REMOVED_KEY, true);
  if (result.status === 'removed') {
    vscode.window.showInformationMessage(
      'Removed the ClaudeStats hook from Claude Code. Run "ClaudeStats: Set Up Claude Code Hook" to add it back.'
    );
  } else if (result.status === 'foreign') {
    vscode.window.showInformationMessage(
      'Your Claude Code status line is not the ClaudeStats hook, so it was left as is.'
    );
  } else {
    vscode.window.showInformationMessage('No ClaudeStats hook is registered with Claude Code.');
  }
  return result;
}

// Asks at most once per version, and never again after the user removed the hook on
// purpose. The command stays available either way.
async function offerSetup(context) {
  let info;
  try {
    info = setup.inspect();
  } catch {
    return;
  }
  if (!info.claudeDirExists) return;
  if (info.hook === 'ours') {
    try {
      setup.syncBridge();
    } catch {
      // A failed sync leaves the previous bridge running, which still works.
    }
    return;
  }
  if (info.hook === 'foreign' && wrapperFeedsBridge()) return;

  const store = context && context.globalState;
  if (!store) return;
  if (store.get(REMOVED_KEY)) return;
  if (store.get(PROMPTED_KEY) === VERSION) return;
  await store.update(PROMPTED_KEY, VERSION);

  const choice = await vscode.window.showInformationMessage(
    'ClaudeStats needs to register a small status line hook with Claude Code. Set up now?',
    'Set up',
    'Not now',
    'Learn more'
  );
  if (choice === 'Set up') await runSetup(context, false);
  else if (choice === 'Learn more') openLink('#how-it-works');
}

// A copy installed from source before 0.2.0 has a different extension ID, so VS Code runs
// it alongside this one and the user sees two status bar items.
async function warnAboutLegacyCopy(context) {
  const ownId = context && context.extension && context.extension.id;
  if (!vscode.extensions || ownId === LEGACY_ID) return;
  const legacy = vscode.extensions.getExtension(LEGACY_ID);
  if (!legacy) return;
  const store = context.globalState;
  if (store) {
    if (store.get(LEGACY_WARNED_KEY) === VERSION) return;
    await store.update(LEGACY_WARNED_KEY, VERSION);
  }
  const choice = await vscode.window.showWarningMessage(
    'An older ClaudeStats installed from source (' + LEGACY_ID + ') is also running, so you will see two status bar items. Remove the old copy?',
    'Remove old copy',
    'Not now'
  );
  if (choice !== 'Remove old copy') return;
  const folder = legacy.extensionPath;
  if (!/^claude-stats\.claude-stats-/.test(path.basename(folder))) {
    vscode.window.showWarningMessage('ClaudeStats did not recognise the old copy at ' + folder + ', so it was left alone.');
    return;
  }
  try {
    fs.rmSync(folder, { recursive: true, force: true });
  } catch (err) {
    vscode.window.showErrorMessage('Could not remove ' + folder + ': ' + err.message);
    return;
  }
  const reload = await vscode.window.showInformationMessage(
    'Removed the old copy. Reload the window to drop its status bar item.',
    'Reload Window'
  );
  if (reload === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
}

function activate(context) {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.name = 'Claude Usage';
  item.command = 'claudeStats.refresh';
  context.subscriptions.push(item);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeStats.refresh', () => poll()),
    vscode.commands.registerCommand('claudeStats.setup', () => runSetup(context, false)),
    vscode.commands.registerCommand('claudeStats.removeHook', () => removeHook(context))
  );

  // Watch the directory, not the file: an atomic write replaces the inode and drops a file watch.
  try {
    const watcher = fs.watch(claudeDir(), (_event, filename) => {
      if (filename === 'usage-bridge.json') refreshState();
    });
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // The interval below is the fallback when the directory cannot be watched.
  }

  const timer = setInterval(refreshState, 60000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  refreshState();

  // Onboarding never blocks activation or the first paint.
  Promise.resolve().then(() => warnAboutLegacyCopy(context)).catch(() => {});
  Promise.resolve().then(() => offerSetup(context)).catch(() => {});
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  offerSetup,
  runSetup,
  removeHook,
  normalize,
  relative,
  toEpochMs,
  refreshState,
  _peek: () => state,
  _reset: () => {
    state = emptyState();
  },
  _setError: (message) => {
    state.error = message;
    paint();
  },
  _setWindows: (windows) => {
    state.windows = windows;
    paint();
  },
};
