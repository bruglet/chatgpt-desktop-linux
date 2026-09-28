#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$(realpath "$1")"
WORK_DIR="$(mktemp -d)"
. "$SCRIPT_DIR/scripts/lib/install-helpers.sh"
. "$SCRIPT_DIR/scripts/lib/asar-patch.sh"
export CODEX_LINUX_FEATURES_CONFIG="$WORK_DIR/features.json"
printf '{"enabled":[]}\n' > "$CODEX_LINUX_FEATURES_CONFIG"
export CODEX_PATCH_REPORT_JSON="$WORK_DIR/patch-report.json"
before="$(sha256sum "$APP/resources/app.asar")"
patch_asar "$APP"
node "$SCRIPT_DIR/packaging/homebrew/verify-report.js" "$CODEX_PATCH_REPORT_JSON"
core_descriptors="$(node - "$SCRIPT_DIR/scripts/patches/runner.js" <<'NODE'
const { corePatchDescriptors } = require(process.argv[2]);
process.stdout.write(String(corePatchDescriptors().length));
NODE
)"
if [ "$core_descriptors" -eq 0 ]; then
    test "$before" = "$(sha256sum "$APP/resources/app.asar")"
fi
