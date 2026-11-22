#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$(realpath "$1")"
PAYLOAD_DIR="$(realpath -m "$2")"
WORK="$(mktemp -d "$RUNNER_TEMP/homebrew-build.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
LOGS="$RUNNER_TEMP/homebrew-logs"
mkdir -p "$PAYLOAD_DIR" "$LOGS"

bash "$ROOT/packaging/homebrew/verify-candidate.sh" "$MANIFEST" "$WORK/equivalence"
bash "$ROOT/packaging/homebrew/clean-asar.sh" "$WORK/equivalence/rpm/usr/lib/chatgpt"
mv "$WORK/equivalence/app.rpm" "$WORK/app.rpm"
rm -rf -- "$WORK/equivalence"
bash "$ROOT/packaging/homebrew/prepare.sh" "$WORK/app.rpm" "$MANIFEST" "$WORK/prepared" "$(brew --prefix)" "$(brew --cache)"

archive="$PAYLOAD_DIR/chatgpt-community-linux-$(dpkg --print-architecture).tar.gz"
tar -czf "$archive" --sort=name --owner=0 --group=0 --numeric-owner -C "$WORK" prepared/app
rm -rf -- "$WORK/prepared"
tar -xzf "$archive" -C "$WORK"
app="$WORK/prepared/app"
cmp "$MANIFEST" "$app/.codex-linux/homebrew-release.json"
cp "$app/.codex-linux/patch-report.json" "$LOGS/patch-report.json"
"$app/start.sh" --diagnose
bash "$ROOT/packaging/homebrew/graphical-smoke.sh" "$app/start.sh" \
    "$RUNNER_TEMP/payload-graphical-home" > "$LOGS/payload-graphical.log" 2>&1
