# ClaudeStat

[![test](https://github.com/awmium/claude-stat/actions/workflows/test.yml/badge.svg)](https://github.com/awmium/claude-stat/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Your Claude Code plan usage, live in the VS Code status bar.

```
                                             ⏻ 10% · 2%
```

Hover for the breakdown:

| Window | Used | Resets |
| :-- | --: | :-- |
| Session (5hr) | 10% | in 3h |
| Weekly (7 day) | 2% | in 6d |
| Weekly Fable | 0% | in 6d |

Which windows appear is decided by your account, not by ClaudeStat. Per-model windows
show up with the server's own name for them, and accounts that do not have one simply do
not get the row.

The item turns amber past 80% and red past 95%, driven by the **session window alone** —
the one limit that's actionable right now. Weekly usage sits high for days at a time and
would otherwise leave the item permanently coloured.

**It costs nothing in tokens.** Nothing here calls a model.
See [Does this use my tokens?](#does-this-use-my-tokens)

---

## Requirements

- **Claude Code**, signed in on a subscription plan (Pro, Max, or Team)
- **Node.js 20+** on your `PATH`
- **VS Code 1.85+**, VS Code Insiders, or Cursor

API-key users — and Bedrock / Vertex / Foundry — have no plan rate limits, so there's
nothing for this to show.

---

## Install

```bash
git clone https://github.com/awmium/claude-stat.git
cd claude-stat
./scripts/install.sh           # macOS / Linux
```

```powershell
.\scripts\install.ps1          # Windows
```

Then **fully quit and reopen VS Code**. A window reload doesn't reliably pick up a newly
added extension folder.

The status bar shows `—` until your next Claude Code message, because the first reading
arrives through the statusLine hook.

### Options

| Flag | Purpose |
| :-- | :-- |
| `--target insiders` / `-Target Insiders` | Install into VS Code Insiders |
| `--target cursor` / `-Target Cursor` | Install into Cursor |
| `--force` / `-Force` | Replace an existing `statusLine` (see below) |

### If you already use a custom status line

Claude Code allows exactly one `statusLine` command. The installer detects an existing one,
**leaves it alone**, and tells you. To keep both, point `statusLine` at a wrapper that
feeds stdin to each in turn:

```bash
#!/usr/bin/env bash
input=$(cat)
printf '%s' "$input" | node ~/.claude/claude-stat/statusline-usage.js > /dev/null
printf '%s' "$input" | your-existing-statusline
```

Or re-run with `--force` to hand the hook to ClaudeStat.

---

## How it works

Two pieces, because neither alone is enough.

**1. The bridge** — `~/.claude/claude-stat/statusline-usage.js`

Claude Code's `statusLine` hook runs a command of your choosing and pipes it a JSON blob
describing the live session. That blob carries a `rate_limits` object with your
utilization and reset time per window. The bridge writes it to
`~/.claude/usage-bridge.json` and echoes the two headline percentages back to stdout, so
your Claude Code status line stays useful too.

This is the authoritative source: the numbers come from the session itself, so they always
describe the account that session is actually running as.

**2. The extension** — watches that file and renders it

It also polls `GET /api/oauth/usage` when the bridge goes stale, because the hook only
fires while a session is active. Without the poll the reading would freeze exactly when
you stop working — which is when you most want to check it.

### Which windows appear

Row definitions come from the server, never from a hardcoded list. The usage endpoint
returns a `limits[]` array naming each window the account actually has — session, weekly,
and any per-model weekly budget with its own display name. The statusLine hook carries the
same information as `rate_limits.model_scoped[]`. ClaudeStat renders whatever is in there,
so a window added to your plan appears without an update, and switching to an account
without it drops the row.

### Account switching

Claude Code holds one signed-in account at a time. Every bridge record is stamped with the
account that produced it, and the extension compares that stamp against whoever is signed
in now. On a mismatch it shows `—` and refetches, rather than displaying the previous
account's numbers.

Showing nothing is correct here. A stale figure that looks live is worse than no figure.

---

## Configuration

| Setting | Default | What it does |
| :-- | :-- | :-- |
| `claudeStat.pollWhenStale` | `true` | Fetch from the usage endpoint when no session has reported recently. Set `false` to keep the extension fully offline and credential-free. |
| `claudeStat.staleAfterMinutes` | `10` | How old a session reading may get before polling kicks in. |

`CLAUDE_CONFIG_DIR` is respected if you've relocated your Claude Code config.

Command: **ClaudeStat: Refresh Now** (also the status bar item's click action).

---

## Privacy and credentials

Short version: it reads three local files, calls one endpoint, stores no credentials, and
sends no telemetry. [SECURITY.md](.github/SECURITY.md) documents every path and header.

- **Nothing is stored.** The bridge file holds percentages, reset times and your account
  identity — no token, no conversation content.
- **The access token** is read into memory for a single request and discarded. Never
  written, cached, logged, or put in a URL. On `401` it gives up rather than refreshing,
  because refreshing would mean writing to your credentials file.
- **One network call**, to the same endpoint Claude Code itself polls hourly. No
  telemetry, no analytics, no third-party dependencies.
- **Opt out entirely** with `claudeStat.pollWhenStale: false` — then it touches no
  credentials at all.

---

## Does this use my tokens?

No. Tokens are consumed by inference calls to `/v1/messages`, and nothing here makes one.

- The bridge is a Node process that reads stdin and writes a file. It runs during a
  session you were already having and adds no request to it.
- The extension is a file watcher and a status bar item.
- The poll hits a metadata endpoint that *reports* your limits. It doesn't draw against
  them.

---

## Troubleshooting

**The status bar item never appears.**
Quit VS Code completely rather than reloading — it scans the extensions folder at startup.
If it still does not appear, check whether VS Code loaded it at all: `Ctrl+Shift+P` →
**Developer: Show Running Extensions**, and look for ClaudeStat. If it is missing,
confirm the folder exists:

```bash
ls ~/.vscode/extensions/claude-stat.claude-stat-*
```

and re-run the installer if it does not.

**I changed the code and nothing happened.**
The extension host loads `src/extension.js` once at activation. Editing it on disk changes
nothing until VS Code restarts.

**It shows `—` and never populates.**
Send one message in Claude Code. If it stays empty, check the hook is registered:

```bash
node -e "const o=require('os');console.log(require(o.homedir()+'/.claude/settings.json').statusLine)"
```

**It shows `—` right after switching accounts.**
Intentional. It clears on the next message or poll.

**The hover says `HTTP 401`.**
Your OAuth token expired. Using Claude Code refreshes it.

**The hover is empty on an API key / Bedrock / Vertex.**
Plan limits only exist for subscription accounts.

---

## Uninstall

```bash
./scripts/uninstall.sh         # macOS / Linux
.\scripts\uninstall.ps1        # Windows
```

Removes the extension, the bridge, the cached reading, and the `statusLine` entry — but
only if that entry is ClaudeStat's. Your original `settings.json` is backed up to
`settings.json.claude-stat-backup` on first install.

---

## Development

```bash
npm test
```

31 tests, no network, no dependencies, no build step. They run against a throwaway
`CLAUDE_CONFIG_DIR` fixture and a stubbed `vscode` module, so your real Claude Code state
is never read or written. CI covers Linux, macOS and Windows on Node 20 and 22.

```
src/extension.js             the VS Code extension
src/bridge/                  the Claude Code statusLine hook
test/                        node:test suites
scripts/                     install and uninstall, per platform
.github/                     CI, issue templates, contributing, security
```

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) before opening a PR, and [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) for how we work together.

---

## Known limitations

- **A window the server does not report cannot be shown.** Everything rendered comes
  from the account's own `limits[]` (or the hook's equivalent); there is no inference.
- **The statusLine hook only fires during a live session**, so the bridge alone goes
  stale. The poll covers that; disabling it brings the staleness back.
- **`/api/oauth/usage` is undocumented** and may change without notice. If it does, the
  bridge keeps working and only the idle refresh is lost.
- **Organisation credit balances are not displayed.** On Team plans the "extra usage"
  pool is org-level billing state you may not control, so it's deliberately excluded.
- **No automated UI test.** The extension's logic is covered against a stubbed `vscode`
  API; whether VS Code renders it correctly is verified by hand.

---

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with, endorsed by, or supported by Anthropic.
