#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$(realpath "$1")"
DEST="$(realpath -m "$2")"
mkdir -p "$DEST"
case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) exit 1 ;; esac
node "$ROOT/scripts/lib/upstream-linux-package.js" --output-dir "$DEST/deb-download" \
    --metadata "$DEST/deb.json" --key-base64 "$ROOT/assets/openai-codex-linux-repository-key.gpg.base64" \
    --arch "$arch" > "$DEST/deb-path"
node - "$MANIFEST" "$DEST/deb.json" "$arch" <<'NODE'
const fs = require('node:fs');
const [manifest, metadata, arch] = process.argv.slice(2);
const release = JSON.parse(fs.readFileSync(manifest));
const deb = JSON.parse(fs.readFileSync(metadata));
if (deb.version !== release.version) throw Error('Signed DEB version changed');
for (const key of ['sha256', 'repositoryPath']) {
  if (deb[key] !== release.campaign.packages[arch][key]) throw Error(`Signed DEB ${key} changed`);
}
NODE
url="$(node -p 'require(process.argv[1]).packages[process.argv[2]].url' "$MANIFEST" "$arch")"
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 -o "$DEST/app.rpm" "$url"
python3 "$ROOT/packaging/homebrew/support.py" verify-rpm "$DEST/app.rpm" "$MANIFEST"
mkdir "$DEST/rpm" "$DEST/deb"
rpm2cpio "$DEST/app.rpm" > "$DEST/payload.cpio"
(cd "$DEST/rpm" && cpio -idm --quiet --no-absolute-filenames --no-preserve-owner < "$DEST/payload.cpio")
dpkg-deb -x "$(cat "$DEST/deb-path")" "$DEST/deb"
python3 "$ROOT/packaging/homebrew/support.py" compare "$DEST/rpm/usr/lib/chatgpt" "$DEST/deb/usr/lib/chatgpt"
