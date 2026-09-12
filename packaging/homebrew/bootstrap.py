"""Cask bootstrap: verify pinned source before running the RPM adapter."""
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

stage = Path(__file__).resolve().parent
prefix = Path(sys.argv[1])
release = json.loads((stage / "release.json").read_text())
source = release["source"]
archive = stage / "source.tar.gz"
subprocess.run([str(prefix / "bin/curl"), "--fail", "--location", "--proto", "=https",
                "--tlsv1.2", "--retry", "3", "--output", str(archive), source["url"]], check=True)
with archive.open("rb") as stream:
    if hashlib.file_digest(stream, "sha256").hexdigest() != source["sha256"]:
        raise ValueError("Source archive SHA-256 mismatch")
source_root = stage / "source"
source_root.mkdir()
with tarfile.open(archive) as bundle:
    bundle.extractall(source_root, filter="data")
roots = list(source_root.iterdir())
if len(roots) != 1 or not roots[0].is_dir():
    raise ValueError("Expected one source archive root")
rpms = list(stage.glob("*.rpm"))
if len(rpms) != 1:
    raise ValueError("Expected one staged RPM")
env = dict(os.environ)
env["PATH"] = os.pathsep.join([str(prefix / "opt/node@24/bin"), str(prefix / "opt/python@3.14/libexec/bin"),
                              str(prefix / "bin"), "/usr/bin", "/bin"])
# Use Homebrew's sandbox-approved cache, not the user's Cargo/npm directories.
cache = Path(subprocess.check_output([str(prefix / "bin/brew"), "--cache"], text=True).strip())
# Homebrew reruns the predecessor's preflight when reverting an upgrade.
# Build in a fresh directory, keeping the prior payload until preparation succeeds.
with tempfile.TemporaryDirectory(prefix=".homebrew-bootstrap-", dir=stage) as work:
    prepared = Path(work) / "prepared"
    subprocess.run(["/bin/bash", str(roots[0] / "packaging/homebrew/prepare.sh"), str(rpms[0]),
                    str(stage / "release.json"), str(prepared), str(prefix),
                    str(cache / "chatgpt-community")], env=env, check=True)
    previous = stage / "prepared"
    if previous.is_symlink():
        raise ValueError("Prepared output must not be a symlink")
    if previous.exists():
        previous.rename(Path(work) / "previous")
    try:
        prepared.rename(previous)
    except OSError:
        backup = Path(work) / "previous"
        if backup.exists():
            backup.rename(previous)
        raise
# The installed payload and reports suffice for launch and uninstall.
shutil.rmtree(source_root)
archive.unlink()
