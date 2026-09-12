#!/usr/bin/env bash
set -Eeuo pipefail
LAUNCHER="$(realpath "$1")"
PROFILE="$(realpath -m "$2")"
[ ! -e "$PROFILE" ] || { echo 'Graphical test requires an absent private profile' >&2; exit 1; }
mkdir -p "$PROFILE"
export HOME="$PROFILE" CODEX_HOME="$PROFILE/.codex"
export XDG_CONFIG_HOME="$PROFILE/config" XDG_CACHE_HOME="$PROFILE/cache" XDG_STATE_HOME="$PROFILE/state"
export CODEX_LINUX_DISABLE_USAGE_REPORTING=1
unset WAYLAND_DISPLAY
export XDG_SESSION_TYPE=x11
timeout --kill-after=5s 45s xvfb-run -a dbus-run-session -- bash -c '
    "$1" &
    app_pid=$!
    trap '\''kill "$app_pid" 2>/dev/null || true; wait "$app_pid" 2>/dev/null || true'\'' EXIT
    for attempt in {1..30}; do
        kill -0 "$app_pid" || exit 1
        if xdotool search --onlyvisible --class codex-desktop; then
            sleep 2
            kill -0 "$app_pid"
            exit $?
        fi
        sleep 1
    done
    echo "No visible ChatGPT Community window" >&2
    exit 1
' _ "$LAUNCHER"
