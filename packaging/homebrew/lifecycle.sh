#!/usr/bin/env bash
# Run only on a disposable Homebrew CI runner.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test "${GITHUB_ACTIONS:-}" = true
test -z "${HOMEBREW_NO_SANDBOX_LINUX:-}"
brew ruby -e 'require "sandbox"; abort "Homebrew Linux sandbox unavailable" unless Sandbox.available?'
LOGS="$RUNNER_TEMP/homebrew-logs"
mkdir -p "$LOGS"
export XDG_DATA_HOME="$RUNNER_TEMP/homebrew desktop data"
profile="$RUNNER_TEMP/existing-codex"
mkdir -p "$XDG_DATA_HOME/applications" "$profile"
echo keep > "$XDG_DATA_HOME/applications/unrelated.desktop"
echo keep > "$profile/user-setting"
tap=bruglet/chatgpt-desktop-linux
token="$tap/chatgpt-community"
brew tap "$tap" "$ROOT"
cask="$(brew --repository "$tap")/Casks/chatgpt-community.rb"
cp "$ROOT/Casks/chatgpt-community.rb" "$RUNNER_TEMP/current.rb"
brew info --json=v2 --cask "$token" > "$LOGS/info.json"
if [ -n "${BASE_SHA:-}" ] && git -C "$ROOT" show "$BASE_SHA:Casks/chatgpt-community.rb" > "$RUNNER_TEMP/previous.rb" &&
    ! cmp -s "$RUNNER_TEMP/current.rb" "$RUNNER_TEMP/previous.rb"; then
    cp "$RUNNER_TEMP/previous.rb" "$cask"
    brew install --cask "$token" 2>&1 | tee "$LOGS/previous-install.log"
    old_version="$(brew info --json=v2 --cask "$token" | jq -er '.casks[0].installed')"
    old_stage="$(brew --prefix)/Caskroom/chatgpt-community/$old_version"
    touch "$old_stage/prepared/app/obsolete-file"
    cp "$RUNNER_TEMP/current.rb" "$cask"
    python3 "$ROOT/packaging/homebrew/check-outdated.py" "$token" "$LOGS/outdated.json"
    CODEX_HOME="$profile" brew upgrade --cask "$token" 2>&1 | tee "$LOGS/upgrade.log"
    test ! -e "$old_stage"
else
    brew install --cask "$token" 2>&1 | tee "$LOGS/install.log"
fi
launcher="$(brew --prefix)/bin/codex-desktop"
"$launcher" --diagnose
test -f "$profile/user-setting"
desktop="$XDG_DATA_HOME/applications/codex-desktop.desktop"
grep -Fx "Exec=\"$launcher\" %U" "$desktop"
grep -Fx 'MimeType=x-scheme-handler/codex;x-scheme-handler/codex-browser-sidebar;' "$desktop"
test -f "$XDG_DATA_HOME/icons/codex-desktop.png"
bash "$ROOT/packaging/homebrew/graphical-smoke.sh" "$launcher" \
    "$RUNNER_TEMP/graphical-home" > "$LOGS/graphical.log" 2>&1
brew uninstall --cask "$token"
test ! -e "$launcher"
test ! -e "$desktop"
test ! -e "$XDG_DATA_HOME/icons/codex-desktop.png"
test -f "$XDG_DATA_HOME/applications/unrelated.desktop"
test -f "$profile/user-setting"
