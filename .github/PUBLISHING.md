# Publishing

How ClaudeStats gets onto the Visual Studio Marketplace (and, optionally, Open VSX for
Cursor and other VS Code forks). Only the maintainer, Azmir Murad, runs these steps.

The extension ID is `awmium.claude-stats-statusbar`: publisher `awmium`, name `claude-stats-statusbar` (the name `claude-stats` is taken on the Marketplace by another publisher).

## Once: create the publisher

1. Sign in at https://marketplace.visualstudio.com/manage with the Microsoft account that
   should own the listing.
2. Create a publisher with the ID **`awmium`** (it must match `publisher` in
   `package.json`) and display name **Azmir Murad** or **Awmium**.

## Once: create a Personal Access Token

1. Go to https://dev.azure.com, create an organisation if you have none, then open
   **User settings > Personal access tokens > New Token**.
2. Organization: **All accessible organizations**. Scopes: **Custom defined > Show all
   scopes > Marketplace > Manage**. Pick an expiry you'll remember.
3. Copy the token. Do not save it in this repo or paste it anywhere else.

## Once per machine: log in

```bash
npx @vscode/vsce login awmium
```

It prompts for the token and stores it in your OS credential store.

## Every release

```bash
npm test
npx @vscode/vsce ls          # check exactly what will ship
npx @vscode/vsce package     # builds claude-stats-<version>.vsix; must show no warnings
npx @vscode/vsce publish
```

Before the first publish, make sure `assets/showcase.png` is pushed to `main`: the README
references it as
`https://raw.githubusercontent.com/awmium/claude-stats/main/assets/showcase.png`, and the
Marketplace page shows a broken image until it exists.

`vsce publish` uses the `version` in `package.json`; bump it and add a `CHANGELOG.md`
entry first. The listing usually appears within a few minutes at
https://marketplace.visualstudio.com/items?itemName=awmium.claude-stats-statusbar.

To test a build locally before publishing:

```bash
code --install-extension claude-stats-<version>.vsix
```

## Optional: Open VSX (Cursor, VSCodium, Windsurf)

Cursor installs from Open VSX, not the Visual Studio Marketplace.

1. Sign in at https://open-vsx.org with GitHub and sign the Publisher Agreement in your
   profile.
2. Create an access token under **Settings > Access Tokens**.
3. Create the namespace once, then publish the same `.vsix`:

```bash
npx ovsx create-namespace awmium -p <token>
npx ovsx publish claude-stats-<version>.vsix -p <token>
```

Pass the token on the command line or as `OVSX_PAT`; don't write it to a file in the repo.
