#!/usr/bin/env bash
set -Eeuo pipefail

# Resolve Homebrew's /home path to the physical /var/home path on Bazzite.
# The native-messaging bridge uses the physical script path as its entrypoint.
app_dir="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$app_dir/start-real.sh" "$@"
