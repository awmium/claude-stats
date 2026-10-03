const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, render } = require('../src/bridge/statusline-usage.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stats-'));
}

const SAMPLE = JSON.stringify({
  session_id: 'abc-123',
  workspace: { current_dir: '/home/dev/project' },
  rate_limits: {
    five_hour: { utilization: 85.4, resets_at: '2026-09-03T22:30:00Z' },
    seven_day: { utilization: 49, resets_at: '2026-09-05T12:00:00Z' },
    seven_day_opus: null,
  },
});

test('writes a bridge record with rounded utilization', () => {
  const dir = tmpdir();
  const bridgePath = path.join(dir, 'usage-bridge.json');
  const accountPath = path.join(dir, 'account.json');
  fs.writeFileSync(
    accountPath,
    JSON.stringify({ oauthAccount: { accountUuid: 'uuid-1', emailAddress: 'dev@example.com' } })
  );

  const { line } = run({ input: SAMPLE, bridgePath, accountPath, now: () => 1000 });

  const record = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
  assert.equal(record.updatedAt, 1000);
  assert.equal(record.accountUuid, 'uuid-1');
  assert.equal(record.email, 'dev@example.com');
  assert.equal(record.sessionId, 'abc-123');
  assert.equal(record.cwd, '/home/dev/project');
  assert.equal(record.rateLimits.five_hour.utilization, 85.4);
  assert.equal(line, '85% · 49%');
});

test('survives malformed stdin without throwing', () => {
  const dir = tmpdir();
  const bridgePath = path.join(dir, 'usage-bridge.json');
  const { line } = run({
    input: 'not json at all',
    bridgePath,
    accountPath: path.join(dir, 'missing.json'),
  });
  const record = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
  assert.equal(record.rateLimits, null);
  assert.equal(record.accountUuid, null);
  assert.equal(line, '');
});

test('survives empty stdin', () => {
  const dir = tmpdir();
  const bridgePath = path.join(dir, 'usage-bridge.json');
  const { line } = run({ input: '', bridgePath, accountPath: path.join(dir, 'missing.json') });
  assert.equal(line, '');
  assert.ok(fs.existsSync(bridgePath));
});

test('renders only the windows that are present', () => {
  assert.equal(render({ five_hour: { utilization: 7 } }), '7%');
  assert.equal(render({ seven_day: { utilization: 12 } }), '12%');
  assert.equal(render(null), '');
  assert.equal(render({ five_hour: null, seven_day: null }), '');
});

test('creates the bridge directory if absent', () => {
  const dir = tmpdir();
  const bridgePath = path.join(dir, 'nested', 'deep', 'usage-bridge.json');
  run({ input: SAMPLE, bridgePath, accountPath: path.join(dir, 'missing.json') });
  assert.ok(fs.existsSync(bridgePath));
});
