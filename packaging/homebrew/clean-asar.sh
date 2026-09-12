#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$(realpath "$1")"
WORK_DIR="$(mktemp -d)"
. "$SCRIPT_DIR/scripts/lib/install-helpers.sh"
. "$SCRIPT_DIR/scripts/lib/asar-patch.sh"
export CODEX_LINUX_FEATURES_CONFIG="$WORK_DIR/features.json"
printf '{"enabled":[]}\n' > "$CODEX_LINUX_FEATURES_CONFIG"
before="$(sha256sum "$APP/resources/app.asar")"
patch_asar "$APP"
test "$before" = "$(sha256sum "$APP/resources/app.asar")"
