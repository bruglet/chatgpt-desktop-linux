# Homebrew: ChatGPT Community

This cask downloads OpenAI's official Linux RPM. It applies the community features on your computer.
It does not download an AppImage or a patched ChatGPT binary.

## First release

The initial cask is disabled until the source archive contains this adapter and both architecture jobs pass.
After this implementation reaches `main`, **Update Homebrew Cask** opens the first validated release PR.
The cask becomes available after that PR merges. Do not remove `disable!` manually.

## Install

Run these commands after the first validated release:

```bash
brew tap bruglet/chatgpt-desktop-linux https://github.com/bruglet/chatgpt-desktop-linux
brew install --cask bruglet/chatgpt-desktop-linux/chatgpt-community
codex-desktop --diagnose
```

Use Homebrew 6 with Linux `preflight_steps` and `command_wrapper` support.
The cask supports x86-64 and ARM64 Linux. Homebrew installs Node 24, Python, Rust, RPM extraction tools, and curl.
The host must provide a C linker and the desktop libraries that the official Electron payload requires.
The graphical tests use GTK 3, NSS, ALSA, and GBM on Ubuntu 24.04.

The host must permit Chromium's sandbox through unprivileged user namespaces.
The cask does not change AppArmor policies, install system packages, or disable Chromium's sandbox.
If the host blocks user namespaces, the administrator must provide a suitable host policy.

The application menu shows **ChatGPT Community**. The command is `codex-desktop`.
The payload stays inside Homebrew's Caskroom. Desktop integration uses `$XDG_DATA_HOME`, or `~/.local/share` by default.
The launcher forwards command arguments and deep-link URIs to the existing community launcher.

The cask uses the features in the pinned source's `features.json`:

- `mcp-helper-reaper`
- `node-repl-reaper`
- `tray-usage`.

Custom feature selection is outside this release. The official and community applications share the Codex profile.
Do not run both applications concurrently. An existing native `codex-desktop` command or desktop entry can conflict with this cask.
Remove the conflicting installation through its package manager before installation. Do not use `--force` to overwrite its files.

## Update and remove

Close ChatGPT before these commands:

```bash
brew update
brew upgrade --cask bruglet/chatgpt-desktop-linux/chatgpt-community
```

Ordinary upgrades include new OpenAI versions and downstream patch revisions. `--greedy` is not required.
Homebrew owns updates. The cask does not install the community updater.

The first installation compiles the MCP helper from source. Later installations reuse a verified local cache entry.
The cache key covers source files, the Cargo lockfile, architecture, compiler identity, and build flags.
An OpenAI version change alone does not rebuild the helper. A missing or corrupt cache entry causes a new build.
Homebrew cache cleanup can remove this cache. The cask never requires it for correctness.

Remove the cask with this command:

```bash
brew uninstall --cask bruglet/chatgpt-desktop-linux/chatgpt-community
```

Uninstall and `--zap` retain shared ChatGPT/Codex profiles, plugins, and conversations.
The cask does not claim ownership of those shared files.

## Installation errors

Preparation errors stop before Homebrew installs public artifacts. The cask does not bypass extraction or patch errors.
Homebrew controls rollback during upgrades. The CI lifecycle test exercises that behavior on its Homebrew version.
Homebrew can remove the current installation before a reinstall fails. Reinstall is not a transactional backup mechanism.

If reinstall fails, retain the error log. Correct the reported dependency, download, or patch problem.
Then run the installation command again. Shared profiles remain available.

## Maintainer workflow

The Homebrew files are downstream additions. Existing upstream files and workflows remain unchanged.
The AppImage release workflow remains available and independent.

`homebrew-update.yml` runs after main-branch changes, hourly, and through manual dispatch.
It binds a published source commit to the accepted pins and the current signed APT campaign.
It downloads RPMs directly from OpenAI and records their SHA-256 values.
Each architecture job compares its RPM application tree against the corresponding signed DEB payload.
The comparison covers file bytes, symlink targets, and executable permissions.
The DEB moves Electron's `LICENSE` into `usr/share/doc/chatgpt/copyright`.
The comparison verifies that relocated file against the RPM's `LICENSE`, including its bytes and executable permissions.

The validation jobs exercise the actual cask with Homebrew's sandbox enabled.
Only the disposable CI runner changes its AppArmor user-namespace restriction for the graphical test.
Client installation never changes that restriction.

After both jobs pass, automation opens `automation/homebrew-cask` and enables auto-merge.
Configure `UPSTREAM_SYNC_TOKEN` with repository Contents and Pull requests write access.
Require the two Homebrew CI architecture checks in the repository rules for automatic release PRs.
The token must trigger PR workflows. `GITHUB_TOKEN` alone cannot do this.

The cask version is `<OpenAI version>,<downstream revision>`.
The generated cask embeds the release manifest and a small bootstrap program.
The bootstrap verifies the pinned source archive before it runs the RPM adapter.
The feature engine and feature code remain in the source archive, outside the cask.
Automation uploads metadata and diagnostics only. It does not publish patched ChatGPT payloads.

Run local checks with these commands from the repository root:

```bash
python3 -m unittest discover -s packaging/homebrew -p 'test_*.py'
bash -n packaging/homebrew/*.sh
node --test launcher/start.test.js scripts/lib/linux-features.test.js scripts/patch-linux-window-ui.test.js linux-features/tray-usage/test.js linux-features/mcp-helper-reaper/test.js linux-features/node-repl-reaper/test.js
python3 packaging/homebrew/render-cask.py packaging/homebrew/release.json /tmp/chatgpt-community.rb
cmp Casks/chatgpt-community.rb /tmp/chatgpt-community.rb
git diff --check
```

`prepare.sh RPM MANIFEST OUTPUT HOMEBREW_PREFIX CACHE` prepares an absent output directory.
It writes `app/` and `integration/` only after successful preparation.
Do not run `lifecycle.sh` against a personal Homebrew installation. It requires a disposable GitHub Actions runner.

References: [reference cask](https://github.com/ublue-os/homebrew-experimental-tap/blob/main/Casks/chatgpt-linux.rb),
[upgrade and extraction bug](https://github.com/ublue-os/homebrew-experimental-tap/issues/636),
[Homebrew cask documentation](https://docs.brew.sh/Cask-Cookbook).
