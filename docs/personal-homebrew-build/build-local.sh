#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 4 ]; then
    echo 'Usage: build-local.sh VERIFIED_RPM FEATURES_JSON OUTPUT_DIR CACHE_DIR' >&2
    exit 2
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rpm="$(realpath "$1")"
features="$(realpath "$2")"
output="$(realpath -m "$3")"
cache="$(realpath -m "$4")"
mkdir -p "$(dirname "$output")" "$cache"
temp_root="$(mktemp -d "$(dirname "$output")/.personal-build.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT

git clone --local --no-hardlinks --quiet "$repo_root" "$temp_root/source"
cp "$features" "$temp_root/source/features.json"
python3 - "$repo_root/packaging/homebrew/release.json" "$features" "$temp_root/release.json" <<'PY'
import json
import sys
from pathlib import Path
release = json.loads(Path(sys.argv[1]).read_text())
release['features'] = json.loads(Path(sys.argv[2]).read_text())
release['ready'] = False
Path(sys.argv[3]).write_text(json.dumps(release, indent=2) + '\n')
PY

export CARGO_TARGET_DIR="$cache/cargo-target"
if node -e 'process.exit(JSON.parse(require("node:fs").readFileSync(process.argv[1])).enabled.includes("computer-use-linux") ? 0 : 1)' "$features"; then
    cargo build --locked --release --manifest-path "$temp_root/source/Cargo.toml" \
        -p codex-computer-use-linux --bin codex-computer-use-linux --bin codex-computer-use-cosmic
    export CODEX_COMPUTER_USE_BINARY_SOURCE="$CARGO_TARGET_DIR/release/codex-computer-use-linux"
    export CODEX_COMPUTER_USE_COSMIC_BINARY_SOURCE="$CARGO_TARGET_DIR/release/codex-computer-use-cosmic"
fi
if node -e 'const e=JSON.parse(require("node:fs").readFileSync(process.argv[1])).enabled;process.exit(e.includes("record-and-replay")||e.includes("chronicle-skysight") ? 0 : 1)' "$features"; then
    cargo build --locked --release --manifest-path "$temp_root/source/Cargo.toml" \
        -p codex-record-replay-linux
    export CODEX_RECORD_REPLAY_LINUX_SOURCE="$CARGO_TARGET_DIR/release/codex-record-replay-linux"
fi
bash "$temp_root/source/packaging/homebrew/prepare.sh" \
    "$rpm" "$temp_root/release.json" "$output" "$(brew --prefix)" "$cache"
