#!/usr/bin/env python3
"""Require an available cask update, including Homebrew's expected exit status 1."""
import json
from pathlib import Path
import subprocess
import sys


def check(token, output):
    result = subprocess.run(
        ["brew", "outdated", "--cask", "--json=v2", token],
        text=True, stdout=subprocess.PIPE, check=False,
    )
    Path(output).write_text(result.stdout)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"brew outdated failed with exit status {result.returncode}")
    casks = json.loads(result.stdout)["casks"]
    if not any(cask["name"] == token.rsplit("/", 1)[-1] for cask in casks):
        raise RuntimeError(f"Ordinary upgrade skipped {token}")


if __name__ == "__main__":
    check(*sys.argv[1:])
