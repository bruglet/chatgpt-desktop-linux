#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve Homebrew's /home path to the physical /var/home path on Bazzite.
# The native-messaging bridge uses the physical script path as its entrypoint.
app_dir="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
integrations="$app_dir/.codex-linux/homebrew-integrations.mjs"
node="$app_dir/resources/cua_node/bin/node"
if [[ "${1:-}" == --cleanup-integrations ]]; then
    shift
    case "$#:${1:-}" in
        0:) exec "$node" "$integrations" "$app_dir" preview ;;
        1:--apply) exec "$node" "$integrations" "$app_dir" apply ;;
        *) printf 'Usage: codex-desktop --cleanup-integrations [--apply]\n' >&2; exit 2 ;;
    esac
fi

# A retired feature no longer has a prelaunch hook to maintain its companion.
case "${1:-}" in
    --diagnose|-h|--help) ;;
    *)
        if [[ ! -d "$app_dir/.codex-linux/features/global-dictation-gnome/extension" ]]; then
            "$node" "$integrations" "$app_dir" retired >&2 || true
        fi
        ;;
esac

exec "$app_dir/start-real.sh" "$@"
