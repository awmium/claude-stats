# Contributing

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

Thanks for taking a look. This is a small, deliberately boring codebase: plain CommonJS,
no dependencies, no build step, no TypeScript. Please keep it that way unless there's a
strong reason not to.

## Getting set up

```bash
git clone https://github.com/awmium/claude-stats.git
cd claude-stats
npm test
```

There is nothing to install. `npm test` runs the suite with Node's built-in test runner.

To try your changes live:

```bash
./scripts/install.sh          # macOS / Linux
.\scripts\install.ps1         # Windows
```

Then **fully quit and reopen VS Code**. The extension host loads `src/extension.js` once at
activation — editing the file on disk does nothing until it restarts. This catches
everyone at least once.

## Running the tests

```bash
npm test
```

The suite is self-contained: it points `CLAUDE_CONFIG_DIR` at a throwaway fixture
directory and stubs the `vscode` module, so it never reads your real Claude Code state and
never touches the network. It runs on Linux, macOS and Windows in CI.

If you add a test that needs the network, don't. Capture a fixture instead — there is a
real captured `/api/oauth/usage` response in `test/extension.test.js` to follow.

## Project layout

```
src/extension.js             the VS Code extension (status bar item, hover, poll, first-run prompt)
src/setup.js                 registers and removes the hook; shared by the extension and scripts
src/bridge/                  the Claude Code statusLine hook
test/                        node:test suites
scripts/                     install and uninstall, per platform
.github/                     CI, issue templates, this file, SECURITY.md
```

## House rules

**Write the failing test first.** Every behavioural change in this repo arrived that way,
including the two colour bugs and the hover-injection hardening. A PR that changes
behaviour without a test that fails before it is unlikely to be merged.

**Prove your test actually fails.** Break the fix, watch the test go red, restore it. A
passing suite is a claim about the tests, not about the code.

**No new dependencies** without discussing it in an issue first. Zero dependencies is a
feature here — it's a big part of why the security surface is auditable in one sitting.

**Keep the two data paths in sync.** Readings come either from the statusLine bridge or
from the usage poll, and they must produce identical output. A change to one almost always
needs the other.

**Don't widen what the extension reads.** It touches three files and one endpoint, all
documented in [SECURITY.md](SECURITY.md), plus `settings.json` and the bridge folder when
the user sets up or removes the hook. Adding another is a design discussion, not a PR.

**One copy of the setup logic.** `src/setup.js` is the only code that edits
`settings.json`. The extension calls it as a module and the install scripts call it as a
CLI (`node src/setup.js install [--force]`, `node src/setup.js uninstall`). Change it
there, test it in `test/setup.test.js`, and both routes follow.

## Shipping a release

ClaudeStats ships two ways: the Visual Studio Marketplace (`awmium.claude-stats-statusbar`) and this
repository's install scripts. The step-by-step publishing guide is
[PUBLISHING.md](PUBLISHING.md).

1. Bump `version` in `package.json`.
2. Add a `CHANGELOG.md` entry.
3. `npm test` green on all three platforms in CI.
4. `npx @vscode/vsce package` with no warnings, then publish as in PUBLISHING.md.
5. `git tag v0.2.1 && git push --tags`.

The installed extension folder is named for the version, so an upgrade would otherwise
leave the previous one in place and VS Code would load both. The installer removes older
folders it wrote itself (marked with `.claude-stats-source-install`) and any pre-0.2.0
`claude-stats.claude-stats-*` folder, and never a Marketplace copy. Keep that behaviour
if you touch the install scripts.

## A note on the usage endpoint

`/api/oauth/usage` is undocumented. It may change or disappear without warning. If it
does, the statusLine bridge keeps working and only the idle refresh is lost — please
preserve that property in any change you make to the polling path.
