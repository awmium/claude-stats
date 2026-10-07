# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-07

First Visual Studio Marketplace release.

### Added

- The extension sets up its own Claude Code hook, so a Marketplace install works without
  cloning the repo. On first start a single non-modal notification asks to register it
  (Set up / Not now / Learn more), at most once per version and never again after you
  remove the hook on purpose.
- `ClaudeStats: Set Up Claude Code Hook` and `ClaudeStats: Remove Claude Code Hook`
  commands.
- Setup makes the same change as the install script: the bridge is copied to
  `~/.claude/claude-stats/`, `settings.json` is backed up once to
  `settings.json.claude-stats-backup`, and `statusLine` is pointed at the bridge.
  `CLAUDE_CONFIG_DIR` is honoured. A `statusLine` that is not ours is left alone; the
  extension explains the wrapper option and offers a confirmed **Replace anyway**.
- The installed bridge is kept in step with the extension after an update, but only while
  the registered hook is still ours.
- A warning, with an offer to remove it, when a pre-0.2.0 source install
  (`claude-stats.claude-stats`) is running next to this copy.
- Marketplace packaging: icon, gallery banner, keywords, categories and a `.vscodeignore`
  that ships only the runtime files.

### Changed

- Publisher is now `awmium`, so the extension ID is `awmium.claude-stats-statusbar`. Source installs
  go to `awmium.claude-stats-statusbar-<version>` and the installer removes any old
  `claude-stats.claude-stats-*` folder.
- The install and uninstall scripts now call `src/setup.js` for the `settings.json`
  change, the same code the extension runs, instead of their own inline copies.
- The installers only remove extension folders they created (marked with
  `.claude-stats-source-install`), never a Marketplace copy, and refuse to overwrite a
  Marketplace copy of the same version.
- `settings.json` is written atomically, through a temporary file and a rename.
- The poll's `User-Agent` carries the real version instead of a fixed `0.1.0`.

### Fixed

- An unparseable `settings.json` is reported and left untouched. Previously the shell installer
  replaced it with a file holding only the `statusLine`, dropping every other setting.
- The PowerShell installer no longer deletes the folder it is about to reinstall when the
  home path is in 8.3 short form.

## [0.1.0] - 2026-10-03

Initial release.

### Added

- Status bar item showing session (5hr) and weekly (7 day) plan utilization.
- Hover breakdown of each reported window with reset times, the reading's age, its source
  (session hook or poll), and the account it belongs to.
- Readings sourced from the Claude Code `statusLine` hook, with an optional poll of the
  usage endpoint when no session has reported recently.
- `ClaudeStats: Refresh Now` command, also bound to clicking the item.
- `claudeStats.pollWhenStale` and `claudeStats.staleAfterMinutes` settings.
- Windows are defined by the account, not by a hardcoded list: rows are built from the
  server's `limits[]` array (and the hook's `rate_limits.model_scoped[]`), so a per-model
  weekly budget appears under the server's own name, and an account without one shows no
  such row. An unrecognised limit kind is labelled rather than dropped.
- `CLAUDE_CONFIG_DIR` support.
- Install and uninstall scripts for VS Code, Insiders and Cursor on Windows, macOS and
  Linux. The installer backs up `settings.json`, and refuses to replace a `statusLine` it
  did not create unless `--force` is given.
- CI across Linux, macOS and Windows on Node 20 and 22.
- The installer removes any older `claude-stats.claude-stats-*` directory before writing the
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
