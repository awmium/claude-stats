# Security

ClaudeStats reads local Claude Code state and, optionally, makes one authenticated request
to Anthropic. This document states exactly what it touches, so you can audit it before you
trust it. The whole extension is ~250 lines of dependency-free JavaScript — please read it.

## What it reads

| Path | Why | Written? |
| :-- | :-- | :-- |
| `~/.claude/usage-bridge.json` | The cached reading from the statusLine hook | Written by the bridge only |
| `~/.claude.json` → `oauthAccount` | Account UUID and email, to label the hover and detect account switches | Never |
| `~/.claude/.credentials.json` → `claudeAiOauth.accessToken` | Bearer token for the optional usage poll | Never |

`CLAUDE_CONFIG_DIR` is honoured if you have relocated your Claude Code config.

## What it sends

Exactly one request, and only when `claudeStats.pollWhenStale` is enabled and the cached
reading has gone stale:

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <your Claude Code OAuth token>
anthropic-beta: oauth-2025-04-20
```

This is the same endpoint Claude Code itself polls. There are **no other network calls**,
no telemetry, no analytics, no crash reporting, and no third-party dependencies that could
add any.

## Handling of the access token

- Read into a local variable, used as one header, discarded when the request completes.
- Never written to disk, never cached in memory between polls, never logged, never placed
  in a URL or query string, never included in an error message.
- If the token is expired (`expiresAt` in the past) the request is not attempted at all.
- On `401` the extension gives up and shows the error. It will **not** attempt a refresh,
  because refreshing would mean writing to your credentials file.

**To disable all credential access**, set `claudeStats.pollWhenStale` to `false`. The
extension then reads only the bridge file and makes no network calls whatsoever.

## What the bridge file contains

```json
{ "updatedAt": 0, "accountUuid": "...", "email": "...", "sessionId": "...",
  "cwd": "...", "rateLimits": { } }
```

Percentages, reset times, and enough account identity to detect a sign-in change. **No
token, and no conversation content.** It lives in your own `~/.claude` directory and is
never transmitted anywhere.

## Hover injection

The status bar hover is a trusted `MarkdownString`, which means `command:` links inside it
are clickable. Two measures prevent an untrusted value from forging one:

1. `isTrusted` is scoped to a single command (`claudeStats.refresh`), not set to `true`.
2. Every interpolated value — account email, error strings, window labels — is passed
   through an escaper that neutralises `\`, `` ` ``, `[`, `]`, `|` and newlines.

Both are covered by tests in `test/extension.test.js`.

## What the installer changes

- Copies the bridge to `~/.claude/claude-stats/statusline-usage.js`.
- Sets `statusLine` in `~/.claude/settings.json`, after backing the file up to
  `settings.json.claude-stats-backup`. If you already have a `statusLine` that is not
  ClaudeStats's, the installer **leaves it alone** and tells you; `--force` is required to
  replace it.
- Copies the extension into your VS Code extensions directory.

It requests no elevation and writes nothing outside your home directory.

## Reporting a vulnerability

Please open a private security advisory through the repository's Security tab rather than
a public issue. Include the version, your OS, and the smallest reproduction you can manage.
