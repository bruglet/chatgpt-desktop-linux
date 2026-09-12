#!/usr/bin/env bash
# Run only on a disposable Homebrew CI runner; never against a personal profile.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$(realpath "$1")"
test "${GITHUB_ACTIONS:-}" = true
test -z "${HOMEBREW_NO_SANDBOX_LINUX:-}"
brew ruby -e 'require "sandbox"; abort "Homebrew Linux sandbox unavailable" unless Sandbox.available?'
LOGS="$RUNNER_TEMP/homebrew-logs"
mkdir -p "$LOGS"
export XDG_DATA_HOME="$RUNNER_TEMP/homebrew desktop data"
mkdir -p "$XDG_DATA_HOME/applications"
echo keep > "$XDG_DATA_HOME/applications/unrelated.desktop"
tap=bruglet/chatgpt-desktop-linux
token="$tap/chatgpt-community"
brew tap "$tap" "$ROOT"
TAP_DIR="$(brew --repository "$tap")"
python3 "$ROOT/packaging/homebrew/render-cask.py" "$MANIFEST" "$TAP_DIR/Casks/chatgpt-community.rb"
brew style "$TAP_DIR/Casks/chatgpt-community.rb"
brew info --json=v2 --cask "$token" > "$LOGS/info.json"
# Exercise OpenAI-version selection with older cask metadata and the same verified
# RPM. This fixture does not advertise or retain an obsolete production release.
cp "$TAP_DIR/Casks/chatgpt-community.rb" "$RUNNER_TEMP/current.rb"
python3 - "$MANIFEST" "$TAP_DIR/Casks/chatgpt-community.rb" <<'PY'
import json,sys
from pathlib import Path
r=json.load(open(sys.argv[1])); p=Path(sys.argv[2]); text=p.read_text()
old=r['version'].split('.'); old[-1]=str(int(old[-1])-1)
text=text.replace(f'version "{r["version"]},{r["revision"]}"', f'version "{".".join(old)},{r["revision"]}"')
text=text.replace('#{version.csv.first}',r['version'])
# Reproduce the old sandbox's premature file-as-directory creation. The new
# adapter extracts into its own fresh directory, so this cannot obstruct it.
text=text.replace('  preflight_steps do\n', '  preflight_steps do\n    mkdir_p "usr/share/applications/chatgpt.desktop"\n')
p.write_text(text)
PY
brew install --cask "$token" 2>&1 | tee "$LOGS/install.log"
cp "$RUNNER_TEMP/current.rb" "$TAP_DIR/Casks/chatgpt-community.rb"
brew outdated --cask --json=v2 "$token" > "$LOGS/upstream-outdated.json"
python3 - "$LOGS/upstream-outdated.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['casks'], 'Ordinary upgrade skipped OpenAI version'
PY
brew upgrade --cask "$token" 2>&1 | tee "$LOGS/upstream-upgrade.log"
"$(brew --prefix)/bin/codex-desktop" --diagnose
test -f "$XDG_DATA_HOME/applications/codex-desktop.desktop"
test -f "$XDG_DATA_HOME/icons/codex-desktop.png"
version="$(python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(str(r["version"])+","+str(r["revision"]))' "$MANIFEST")"
app="$(brew --prefix)/Caskroom/chatgpt-community/$version/prepared/app"
cp "$app/.codex-linux/patch-report.json" "$LOGS/patch-report.json"
cp "$MANIFEST" "$LOGS/release.json"

bash "$ROOT/packaging/homebrew/graphical-smoke.sh" "$(brew --prefix)/bin/codex-desktop" \
    "$RUNNER_TEMP/graphical-home" > "$LOGS/graphical.log" 2>&1

# A downstream-only revision must appear in ordinary outdated/upgrade results.
python3 - "$MANIFEST" "$RUNNER_TEMP/revision.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); r['revision'] += 1
json.dump(r,open(sys.argv[2],'w'))
PY
python3 "$ROOT/packaging/homebrew/render-cask.py" "$RUNNER_TEMP/revision.json" "$TAP_DIR/Casks/chatgpt-community.rb"
brew outdated --cask --json=v2 "$token" > "$LOGS/outdated.json"
python3 - "$LOGS/outdated.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['casks'], 'Ordinary upgrade skipped downstream revision'
PY
brew upgrade --cask "$token" 2>&1 | tee "$LOGS/upgrade.log"
grep -F 'Reusing helper' "$LOGS/upgrade.log"
"$(brew --prefix)/bin/codex-desktop" --diagnose
brew reinstall --cask "$token" 2>&1 | tee "$LOGS/reinstall.log"
"$(brew --prefix)/bin/codex-desktop" --diagnose

# A preparation failure during upgrade must retain the previously working app.
cp "$TAP_DIR/Casks/chatgpt-community.rb" "$RUNNER_TEMP/good.rb"
python3 - "$RUNNER_TEMP/revision.json" "$RUNNER_TEMP/failure.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); r['revision'] += 1
json.dump(r,open(sys.argv[2],'w'))
PY
python3 "$ROOT/packaging/homebrew/render-cask.py" "$RUNNER_TEMP/failure.json" "$TAP_DIR/Casks/chatgpt-community.rb"
python3 - "$TAP_DIR/Casks/chatgpt-community.rb" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
p.write_text(p.read_text().replace('  preflight_steps do\n', '  preflight_steps do\n    run "/usr/bin/false"\n'))
PY
if brew upgrade --cask "$token" > "$LOGS/failed-upgrade.log" 2>&1; then
    echo 'Injected preparation failure unexpectedly succeeded' >&2
    exit 1
fi
"$(brew --prefix)/bin/codex-desktop" --diagnose
test -f "$XDG_DATA_HOME/applications/codex-desktop.desktop"
cp "$RUNNER_TEMP/good.rb" "$TAP_DIR/Casks/chatgpt-community.rb"
brew uninstall --cask "$token"
test ! -e "$(brew --prefix)/bin/codex-desktop"
test ! -e "$XDG_DATA_HOME/applications/codex-desktop.desktop"
test -f "$XDG_DATA_HOME/applications/unrelated.desktop"
