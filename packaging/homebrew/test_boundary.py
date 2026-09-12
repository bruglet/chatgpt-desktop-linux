#!/usr/bin/env python3
"""Reject changes outside the downstream Homebrew implementation in its PRs."""
import subprocess
import sys


def verify(base):
    names = subprocess.check_output(["git", "diff", "--name-only", base, "HEAD"], text=True).splitlines()
    permitted = ("Casks/", "packaging/homebrew/", ".github/workflows/homebrew-")
    unexpected = [name for name in names if not name.startswith(permitted)]
    if unexpected:
        raise SystemExit("Homebrew PR changes protected files: " + ", ".join(unexpected))


if __name__ == "__main__":
    verify(sys.argv[1])
