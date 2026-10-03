#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function defaultBridgePath() {
  return path.join(claudeDir(), 'usage-bridge.json');
}

function defaultAccountPath() {
  const inConfigDir = path.join(claudeDir(), '.claude.json');
  if (fs.existsSync(inConfigDir)) return inConfigDir;
  return path.join(os.homedir(), '.claude.json');
}

function readAccount(accountPath) {
  try {
    const oa = JSON.parse(fs.readFileSync(accountPath, 'utf8')).oauthAccount;
    return oa ? { accountUuid: oa.accountUuid, email: oa.emailAddress } : {};
  } catch {
    return {};
  }
}

function pct(window) {
  if (!window || typeof window.utilization !== 'number') return null;
  return Math.round(window.utilization);
}

function render(rateLimits) {
  const parts = [];
  for (const key of ['five_hour', 'seven_day']) {
    const value = pct(rateLimits && rateLimits[key]);
    if (value !== null) parts.push(value + '%');
  }
  return parts.join(' · ');
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function run(options) {
  const opts = options || {};
  const bridge = opts.bridgePath || defaultBridgePath();
  const account = opts.accountPath || defaultAccountPath();
  const now = opts.now || Date.now;

  let payload = {};
  try {
    payload = JSON.parse(opts.input) || {};
  } catch {
    payload = {};
  }

  const identity = readAccount(account);
  const record = {
    updatedAt: now(),
    accountUuid: identity.accountUuid || null,
    email: identity.email || null,
    sessionId: payload.session_id || null,
    cwd: (payload.workspace && payload.workspace.current_dir) || payload.cwd || null,
    rateLimits: payload.rate_limits || null,
  };

  try {
    writeAtomic(bridge, JSON.stringify(record));
  } catch {
    // A failed bridge write must never break the user's status line.
  }

  return { record, line: render(record.rateLimits) };
}

module.exports = { run, render, pct };

if (require.main === module) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
  });
  process.stdin.on('end', () => {
    process.stdout.write(run({ input: buffer }).line);
  });
}
