# Homebrew: ChatGPT Community

This cask installs a prebuilt ChatGPT Community archive on x86-64 or ARM64 Linux.

## Install

```bash
brew tap bruglet/chatgpt-desktop-linux https://github.com/bruglet/chatgpt-desktop-linux
brew install --cask bruglet/chatgpt-desktop-linux/chatgpt-community
codex-desktop --diagnose
```

Use Homebrew 6 with Linux `preflight_steps` and `command_wrapper` support.
Homebrew verifies and extracts the archive. The host needs the desktop libraries
required by Electron.
The graphical tests use GTK 3, NSS, ALSA, and GBM on Ubuntu 24.04.

The host must permit Chromium's sandbox through unprivileged user namespaces.
The cask does not change AppArmor policies, install system packages, or disable Chromium's sandbox.
If the host blocks user namespaces, the administrator must provide a suitable host policy.

The application menu shows **ChatGPT Community**. The command is `codex-desktop`.
The payload stays inside Homebrew's Caskroom. Desktop integration uses `$XDG_DATA_HOME`, or `~/.local/share` by default.
The launcher forwards command arguments and deep-link URIs to the existing community launcher.

The cask uses the pinned source's `packaging/homebrew/features.json`. This is
the fork's cask feature selection. Normal Homebrew updates keep that selection.

- `mcp-helper-reaper`
- `node-repl-reaper`
- `pet-overlay`
- `computer-use-linux`
- `flatpak-chrome-native-messaging`
- `record-and-replay`
- `agent-workspace`
- `community-features-in-gui-settings`
- `global-dictation`
- `global-dictation-gnome`
- `wayland-global-shortcuts`
- `appshots`
- `start-minimized-to-tray`
- `model-picker-default-presets`

Record & Replay also enables its required Chronicle/Skysight dependency.
The Default model slider uses these presets in order: 6 Luna High, 6.1 Terra
Low, Medium and High, then 6.1 Sol Medium, High and Xhigh. Sol Medium remains
the default. There is no feature-defined preset limit; this build uses seven
positions. Models unavailable to the account are omitted, and upstream effort
visibility settings still apply.
CI builds and bundles the native helpers.
A new cask release requires successful validation on both architectures.

Agent Workspaces appears in Settings. Install its separate backend (version
0.6.0 or newer) from that page and run its diagnostics to check host dependencies.
The feature catalog appears in Settings → General and shows build inclusion.
Start Minimized to Tray adds switches in Settings → General; enable the desired
switch there after updating. AppShots adds window capture to the composer and
requires a working screenshot tool and window-control backend on the host.

The GNOME dictation companion supports GNOME Shell 45–50. After the first launch,
log out and back in, then enable it explicitly:

```bash
gnome-extensions enable global-dictation-gnome@chatgpt-community.local
```

Restart the app after enabling the extension. The global shortcuts use the
desktop portal and may need consent from your desktop session.

The official and community applications share the Codex profile.
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

The first prebuilt release upgrades the RPM-based cask in place. Homebrew replaces
the previous versioned app tree and keeps the user profile.

### Clean up desktop integrations

Preview the integration paths before uninstalling:

```bash
codex-desktop --cleanup-integrations
```

Close ChatGPT, then use `codex-desktop --cleanup-integrations --apply` to
remove the GNOME dictation companion if its ownership record and helper path
match this cask. Edited or ambiguous copies are preserved. You may need to
log out and back in before GNOME Shell unloads the extension. On an ordinary
upgrade that drops the companion, the next app launch cleans up its verified
copy once the old app version is gone.

The preview also reports the Agent Workspaces skill, Computer Use GNOME
extension, and Flatpak Chrome manifest and recovery record. Those locations
can be shared with other installs. The cleanup does not change them.

After upgrading, try starting ChatGPT Community while Flatpak Chrome stays
open. If the extension stays disconnected, toggle it off and back on at
`chrome://extensions` to request a new native connection without closing your
tabs. The official extension controls automatic retries.

### Uninstall

Remove the cask with this command:

```bash
brew uninstall --cask bruglet/chatgpt-desktop-linux/chatgpt-community
```

Uninstall and `--zap` retain shared ChatGPT/Codex profiles, plugins, and conversations.
The cask does not claim ownership of those shared files.

## Installation errors

Homebrew verifies the download before installing the app and controls rollback during upgrades.
Homebrew can remove the current installation before a reinstall fails. Reinstall is not a transactional backup mechanism.

If reinstall fails, retain the error log. Correct the reported download or installation problem.
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

CI builds and launches the extracted archives on both architectures. After it
publishes the archives and reads their GitHub asset digests, automation opens
`automation/homebrew-cask` with the pinned URLs and hashes. The PR checks
exercise the published cask with Homebrew sandboxing enabled. Only the disposable
CI runners adjust AppArmor for graphical tests.

Configure `UPSTREAM_SYNC_TOKEN` with repository Contents and Pull requests write access.
Require the two Homebrew CI architecture checks in the repository rules for automatic release PRs.
The token must trigger PR workflows. `GITHUB_TOKEN` alone cannot do this.

The cask version is `<OpenAI version>,<downstream revision>`.
The archives contain `prepared/app`. Each release includes `SHA256SUMS` and
`release.json` under the tag
`homebrew-<OpenAI version>-<downstream revision>-<source commit>`. Homebrew
generates the desktop entry using its local prefix.

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
