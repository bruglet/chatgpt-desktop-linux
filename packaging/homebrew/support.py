#!/usr/bin/env python3
"""RPM metadata, payload comparison, desktop integration, and local helper cache."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
import tempfile


def digest(filename):
    with open(filename, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


def machine():
    return {"x86_64": "amd64", "aarch64": "arm64"}[platform.machine()]


def tree(root):
    """Compare payload bytes, link targets, and executable bits, not ownership/time."""
    root = Path(root)
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            item = Path(directory) / name
            mode = item.lstat().st_mode
            if item.is_symlink():
                value = ["link", os.readlink(item)]
            elif stat.S_ISREG(mode):
                value = ["file", mode & 0o111, digest(item)]
            elif stat.S_ISDIR(mode):
                value = ["directory", mode & 0o111]
            else:
                raise ValueError(f"Unsupported payload entry: {item}")
            result[item.relative_to(root).as_posix()] = value
    if not result:
        raise ValueError(f"Empty payload: {root}")
    return result


def compare(left, right):
    a, b = tree(left), tree(right)
    # electron-installer-debian moves Electron's LICENSE to Debian's mandatory
    # copyright location. Compare that exact file; never ignore license bytes.
    if "LICENSE" in a and "LICENSE" not in b:
        copyright_file = Path(right).parents[1] / "share/doc/chatgpt/copyright"
        if copyright_file.is_file() and not copyright_file.is_symlink():
            b["LICENSE"] = ["file", copyright_file.stat().st_mode & 0o111, digest(copyright_file)]
    different = [key for key in sorted(a.keys() | b.keys()) if a.get(key) != b.get(key)]
    if different:
        raise ValueError("RPM/DEB payload mismatch: " + ", ".join(different[:30]))


def verify_rpm(rpm, manifest, arch):
    release = json.loads(Path(manifest).read_text())
    expected = release["packages"][arch]
    if digest(rpm) != expected["sha256"]:
        raise ValueError("RPM SHA-256 mismatch")
    rpm_arch = {"amd64": "x86_64", "arm64": "aarch64"}[arch]
    fields = run("rpm", "-qp", "--queryformat", "%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}", rpm).splitlines()
    if fields != ["chatgpt", release["version"], "1", rpm_arch]:
        raise ValueError(f"RPM identity mismatch: {fields}")
    for entry in run("rpm", "-qpl", rpm).splitlines():
        if ".." in Path(entry).parts:
            raise ValueError(f"Unsafe RPM member: {entry}")
    return release


def verify_payload(root):
    root = Path(root)
    for name in ["ChatGPT", "resources/codex", "resources/rg", "resources/codex-code-mode-host"]:
        if not (root / name).is_file() or not os.access(root / name, os.X_OK):
            raise ValueError(f"Missing executable: {name}")
    for name in ["resources/app.asar", "resources/owl-electron-app.json", "resources/owl-app.ini"]:
        if not (root / name).is_file():
            raise ValueError(f"Missing payload: {name}")


def helper_key(crate, arch, compiler, linker):
    inputs = {"format": 1, "arch": arch, "rustc": compiler, "cc": linker,
              "flags": ["--release", "--locked"], "source": tree(crate)}
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


def cached_helper_valid(entry):
    binary = Path(entry) / "codex-mcp-helper-reaper"
    checksum = Path(entry) / "sha256"
    return (binary.is_file() and not binary.is_symlink() and os.access(binary, os.X_OK)
            and checksum.is_file() and digest(binary) == checksum.read_text().strip())


def helper(crate, cache):
    crate, cache = Path(crate).resolve(), Path(cache).resolve()
    # Only build inputs enter the cache key. Cargo outputs and the OpenAI version do not.
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache, prefix="helper-source-") as source:
        source = Path(source)
        shutil.copytree(crate, source, dirs_exist_ok=True, ignore=shutil.ignore_patterns("target", ".git"))
        key = helper_key(source, machine(), run("rustc", "-vV"), run("cc", "--version"))
        entry = cache / "helpers" / key
        entry.parent.mkdir(exist_ok=True)
        with open(entry.with_suffix(".lock"), "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if cached_helper_valid(entry):
                print(f"Reusing helper {key}", file=sys.stderr)
                return entry / "codex-mcp-helper-reaper"
            if entry.exists():
                shutil.rmtree(entry)
            with tempfile.TemporaryDirectory(dir=entry.parent, prefix="build-") as temporary:
                temporary = Path(temporary)
                env = {k: v for k, v in os.environ.items()
                       if (not k.startswith(("CARGO_", "RUST"))
                           or k in ("RUSTUP_HOME", "RUSTUP_TOOLCHAIN"))
                       and k not in ("CC", "CXX", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "LDFLAGS", "AR")}
                env.update(CARGO_HOME=str(cache / "cargo"), RUSTFLAGS="")
                subprocess.run(["cargo", "build", "--locked", "--release", "--manifest-path",
                                str(source / "Cargo.toml"), "--target-dir", str(temporary / "target")],
                               env=env, cwd=source, check=True, stdout=sys.stderr)
                output = temporary / "ready"
                output.mkdir()
                binary = output / "codex-mcp-helper-reaper"
                shutil.copy2(temporary / "target/release/codex-mcp-helper-reaper", binary)
                subprocess.run([str(binary), "--help"], check=True, stdout=subprocess.DEVNULL)
                (output / "sha256").write_text(digest(binary) + "\n")
                output.rename(entry)
        return entry / "codex-mcp-helper-reaper"


def desktop_escape(value):
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r")


def exec_quote(value):
    # Desktop Entry escaping occurs before Exec argument parsing.
    escaped = "".join("\\" + char if char in '\\"`$' else char for char in str(value))
    return '"' + desktop_escape(escaped).replace("%", "%%") + '"'


def desktop(output, prefix):
    Path(output).write_text("\n".join([
        "[Desktop Entry]", "Type=Application", "Name=ChatGPT Community",
        "Comment=ChatGPT with community Linux features",
        f"Exec={exec_quote(Path(prefix) / 'bin/codex-desktop')} %U",
        "Icon=codex-desktop", "Terminal=false", "StartupWMClass=codex-desktop",
        "Categories=Development;", "MimeType=x-scheme-handler/codex;x-scheme-handler/codex-browser-sidebar;",
        "StartupNotify=true", "X-GNOME-WMClass=codex-desktop", "",
    ]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["verify-rpm", "verify-payload", "compare", "helper", "desktop"])
    parser.add_argument("args", nargs="+")
    args = parser.parse_args()
    if args.command == "verify-rpm":
        verify_rpm(*args.args, machine())
    elif args.command == "verify-payload":
        verify_payload(*args.args)
    elif args.command == "compare":
        compare(*args.args)
    elif args.command == "helper":
        print(helper(*args.args))
    elif args.command == "desktop":
        desktop(*args.args)


if __name__ == "__main__":
    main()
