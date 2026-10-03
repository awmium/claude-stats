# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-03

Initial release.

### Added

- Status bar item showing session (5hr) and weekly (7 day) plan utilization.
- Hover breakdown of each reported window with reset times, the reading's age, its source
  (session hook or poll), and the account it belongs to.
- Readings sourced from the Claude Code `statusLine` hook, with an optional poll of the
  usage endpoint when no session has reported recently.
- `ClaudeStat: Refresh Now` command, also bound to clicking the item.
- `claudeStat.pollWhenStale` and `claudeStat.staleAfterMinutes` settings.
- Windows are defined by the account, not by a hardcoded list: rows are built from the
  server's `limits[]` array (and the hook's `rate_limits.model_scoped[]`), so a per-model
  weekly budget appears under the server's own name, and an account without one shows no
  such row. An unrecognised limit kind is labelled rather than dropped.
- `CLAUDE_CONFIG_DIR` support.
- Install and uninstall scripts for VS Code, Insiders and Cursor on Windows, macOS and
  Linux. The installer backs up `settings.json`, and refuses to replace a `statusLine` it
  did not create unless `--force` is given.
- CI across Linux, macOS and Windows on Node 20 and 22.
- The installer removes any older `claude-stat.claude-stat-*` directory before writing the
  new one. The folder is named for the version, so without this an upgrade would leave the
  previous copy in place and VS Code would load both, showing two status bar items.

### Security

- The hover's `isTrusted` is scoped to this extension's single command rather than set to
  `true`, so an interpolated value cannot activate an arbitrary `command:` link.
- Every value interpolated into the hover — account email, error strings, window labels —
  is escaped, neutralising `\`, `` ` ``, `[`, `]`, `|` and newlines.
- Server-supplied window names are treated as untrusted and escaped like every other
  interpolated value.
- The OAuth access token is never written, cached, logged, or placed in a URL, and an
  expired token short-circuits before any request is made. A `401` is surfaced rather
  than triggering a refresh, so the extension never writes to the credentials file.

### Behaviour worth knowing

- Colour is driven by the **session window alone**. Weekly usage, per-model windows and
  the organisation credit pool never colour the item, so the colour always reflects the
  one limit that is actionable right now and always has a visible cause.
- Cached figures are discarded, not displayed, when the signed-in account changes. The
  item shows `—` until a reading for the new account arrives.
