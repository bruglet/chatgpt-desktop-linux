#!/usr/bin/env bash
set -Eeuo pipefail

# Prepare a private candidate. Homebrew alone installs the public artifacts.
if [ "$#" -ne 5 ]; then
    echo 'Usage: prepare.sh RPM MANIFEST OUTPUT HOMEBREW_PREFIX CACHE' >&2
    exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RPM="$(realpath "$1")"
MANIFEST="$(realpath "$2")"
OUTPUT="$(realpath -m "$3")"
BREW_PREFIX="$(realpath -m "$4")"
CACHE="$(realpath -m "$5")"
ARCH="$(uname -m)"
CODEX_APP_ID=codex-desktop
CODEX_APP_DISPLAY_NAME='ChatGPT Community'
export CODEX_LINUX_FEATURES_CONFIG="$SCRIPT_DIR/features.json"
export CODEX_LINUX_SOURCE_REMOTE=https://github.com/bruglet/chatgpt-desktop-linux
export CODEX_LINUX_SOURCE_COMMIT
CODEX_LINUX_SOURCE_COMMIT="$(node -p 'require(process.argv[1]).source.commit' "$MANIFEST")"
SUPPORT="$SCRIPT_DIR/packaging/homebrew/support.py"

[ ! -e "$OUTPUT" ] && [ ! -L "$OUTPUT" ] || { echo "Output already exists: $OUTPUT" >&2; exit 1; }
python3 "$SUPPORT" verify-rpm "$RPM" "$MANIFEST"
node - "$MANIFEST" "$CODEX_LINUX_FEATURES_CONFIG" <<'NODE'
const fs = require('node:fs');
const [release, features] = process.argv.slice(2).map(p => JSON.parse(fs.readFileSync(p)));
if (JSON.stringify(release.features) !== JSON.stringify(features)) throw Error('Feature configuration differs from release');
NODE
mkdir -p "$(dirname "$OUTPUT")" "$CACHE"
WORK_DIR="$(mktemp -d "$(dirname "$OUTPUT")/.homebrew-prepare.XXXXXX")"
. "$SCRIPT_DIR/scripts/lib/install-helpers.sh"
. "$SCRIPT_DIR/scripts/lib/asar-patch.sh"
. "$SCRIPT_DIR/scripts/lib/linux-features.sh"
INSTALL_DIR="$WORK_DIR/prepared/app"
UPSTREAM_PACKAGE_ROOT="$WORK_DIR/rpm"
UPSTREAM_APP_DIR="$UPSTREAM_PACKAGE_ROOT/usr/lib/chatgpt"
export UPSTREAM_PACKAGE_ROOT UPSTREAM_APP_DIR
mkdir -p "$UPSTREAM_PACKAGE_ROOT" "$INSTALL_DIR"
rpm2cpio "$RPM" > "$WORK_DIR/payload.cpio"
(cd "$UPSTREAM_PACKAGE_ROOT" && cpio -idm --quiet --no-absolute-filenames --no-preserve-owner < "$WORK_DIR/payload.cpio")
python3 "$SUPPORT" verify-payload "$UPSTREAM_APP_DIR"
cp -a "$UPSTREAM_APP_DIR/." "$INSTALL_DIR/"

# Keep npm's executable resolution local and locked, including the existing npx calls.
export npm_config_cache="$CACHE/npm"
export npm_config_offline=false
npm ci --ignore-scripts --no-audit --no-fund --prefix "$SCRIPT_DIR/packaging/homebrew"
export npm_config_offline=true
cd "$SCRIPT_DIR/packaging/homebrew"
export CODEX_MCP_HELPER_REAPER_SOURCE
CODEX_MCP_HELPER_REAPER_SOURCE="$(python3 "$SUPPORT" helper "$SCRIPT_DIR/linux-features/mcp-helper-reaper/reaper" "$CACHE")"
CODEX_PATCH_REPORT_JSON="$WORK_DIR/patch-report.json"
patch_asar "$INSTALL_DIR"
node "$SCRIPT_DIR/packaging/homebrew/verify-report.js" "$CODEX_PATCH_REPORT_JSON"
run_linux_feature_stage_hooks "$UPSTREAM_APP_DIR"

sed -e 's/__CODEX_LINUX_APP_ID__/codex-desktop/g' \
    -e 's/__CODEX_LINUX_APP_DISPLAY_NAME__/ChatGPT Community/g' \
    "$SCRIPT_DIR/launcher/start.sh.template" > "$INSTALL_DIR/start.sh"
chmod 0755 "$INSTALL_DIR/start.sh"
mkdir -p "$INSTALL_DIR/.codex-linux" "$WORK_DIR/prepared/integration"
cp "$SCRIPT_DIR/assets/codex-linux.png" "$INSTALL_DIR/.codex-linux/codex-desktop.png"
cp "$SCRIPT_DIR/assets/codex-linux.png" "$INSTALL_DIR/resources/icon-chatgpt.png"
cp "$SCRIPT_DIR/assets/codex-linux.png" "$WORK_DIR/prepared/integration/codex-desktop.png"
cp "$CODEX_PATCH_REPORT_JSON" "$INSTALL_DIR/.codex-linux/patch-report.json"
cp "$MANIFEST" "$INSTALL_DIR/.codex-linux/homebrew-release.json"
node - "$SCRIPT_DIR" "$INSTALL_DIR" "$RPM" "$MANIFEST" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [repoDir, installDir, upstreamPackagePath, manifest] = process.argv.slice(2);
const release = JSON.parse(fs.readFileSync(manifest));
const architecture = process.arch === 'x64' ? 'amd64' : 'arm64';
const { buildInfo } = require(path.join(repoDir, 'scripts/lib/build-info.js'));
const info = buildInfo({repoDir, upstreamPackagePath, appId: 'codex-desktop',
  appDisplayName: 'ChatGPT Community', upstreamMetadata: {
    package: 'chatgpt', version: release.version, architecture,
    repository: 'https://persistent.oaistatic.com/codex-app-prod/linux/rpm',
    repositoryPath: new URL(release.packages[architecture].url).pathname,
  }});
info.packageProfile = {id: 'homebrew', label: 'Homebrew', packageManager: 'brew',
  format: 'cask', notes: 'Updates are managed by Homebrew'};
for (const file of ['resources/codex-linux-build-info.json', '.codex-linux/build-info.json']) {
  fs.writeFileSync(path.join(installDir, file), JSON.stringify(info, null, 2) + '\n');
}
NODE
python3 "$SUPPORT" desktop "$WORK_DIR/prepared/integration/codex-desktop.desktop" "$BREW_PREFIX"
python3 "$SUPPORT" verify-payload "$INSTALL_DIR"
test -x "$INSTALL_DIR/.codex-linux/mcp-helper-reaper/codex-mcp-helper-reaper"
test -x "$INSTALL_DIR/.codex-linux/node-repl-reaper.sh"
mv "$WORK_DIR/prepared" "$OUTPUT"
