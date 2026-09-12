#!/usr/bin/env python3
"""Create a release candidate from a published source commit and signed campaign."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

from support import digest, run

REPOSITORY = "https://github.com/bruglet/chatgpt-desktop-linux"


def download(url, target):
    subprocess.run(["curl", "--fail", "--location", "--proto", "=https", "--tlsv1.2",
                    "--retry", "3", "--output", str(target), url], check=True)


def input_hash(root):
    import hashlib
    result = hashlib.sha256()
    for name in sorted(run("git", "ls-files", cwd=root).splitlines()):
        if name.startswith(("Casks/", ".github/", "docs/")) or name == "packaging/homebrew/release.json":
            continue
        result.update(name.encode() + b"\0" + (root / name).read_bytes() + b"\0")
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    commit = run("git", "rev-parse", "HEAD", cwd=root)
    campaign = json.loads(run("node", "scripts/automation/upstream-linux-package-watchdog/watchdog.js", "--json", cwd=root))["release"]
    pins = json.loads((root / "nix/upstream-linux-packages.json").read_text())
    if campaign["version"] != pins["version"]:
        raise ValueError("Accepted source pins do not match the current signed campaign")
    for arch in ("amd64", "arm64"):
        for key in ("sha256", "repositoryPath"):
            if campaign["packages"][arch][key] != pins[arch][key]:
                raise ValueError(f"Signed campaign changed: {arch}/{key}")
    previous = json.loads((root / "packaging/homebrew/release.json").read_text())
    source_inputs = input_hash(root)
    if (previous.get("ready") and previous.get("sourceInputSha256") == source_inputs
            and previous.get("campaign", {}).get("releaseId") == campaign["releaseId"]):
        print("Current cask already covers this source and signed campaign")
        return
    revision = previous.get("revision", 0) + 1 if previous.get("version") == campaign["version"] else 1
    archive_url = f"{REPOSITORY}/archive/{commit}.tar.gz"
    download(archive_url, output / "source.tar.gz")
    release = {"schemaVersion": 1, "ready": True, "version": campaign["version"], "revision": revision,
               "sourceInputSha256": source_inputs, "source": {"commit": commit, "url": archive_url,
               "sha256": digest(output / "source.tar.gz")}, "campaign": campaign,
               "features": json.loads((root / "features.json").read_text()), "packages": {}}
    for arch, rpm_arch in [("amd64", "x86_64"), ("arm64", "aarch64")]:
        url = f"https://persistent.oaistatic.com/codex-app-prod/linux/rpm/{rpm_arch}/chatgpt-{release['version']}-1.{rpm_arch}.rpm"
        rpm = output / f"{arch}.rpm"
        download(url, rpm)
        release["packages"][arch] = {"url": url, "sha256": digest(rpm)}
    (output / "release.json").write_text(json.dumps(release, indent=2) + "\n")
    subprocess.run([sys.executable, str(root / "packaging/homebrew/render-cask.py"),
                    str(output / "release.json"), str(output / "chatgpt-community.rb")], check=True)


if __name__ == "__main__":
    main()
