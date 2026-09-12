import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "stage"
        self.stage.mkdir()
        (self.stage / "bootstrap.py").write_text(Path(__file__).with_name("bootstrap.py").read_text())
        (self.stage / "official.rpm").write_bytes(b"rpm")
        self.prefix = self.root / "brew prefix"
        (self.prefix / "bin").mkdir(parents=True)
        (self.prefix / "bin/curl").write_text(
            '#!/bin/sh\nwhile [ "$1" != "--output" ]; do shift; done\ncp "$3" "$2"\n')
        (self.prefix / "bin/curl").chmod(0o755)
        (self.prefix / "bin/brew").write_text(f"#!/bin/sh\nprintf '%s\\n' '{self.root}/cache'\n")
        (self.prefix / "bin/brew").chmod(0o755)

    def bundle(self, adapter=b'#!/bin/bash\nmkdir -p "$3/integration"\n'):
        archive = self.root / "source.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            entry = tarfile.TarInfo("source/packaging/homebrew/prepare.sh")
            entry.size = len(adapter)
            bundle.addfile(entry, io.BytesIO(adapter))
        release = {"source": {"url": str(archive), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}}
        (self.stage / "release.json").write_text(json.dumps(release))
        return archive

    def run_bootstrap(self):
        return subprocess.run([sys.executable, str(self.stage / "bootstrap.py"), str(self.prefix)],
                              capture_output=True, text=True)

    def test_valid_source_and_old_desktop_directory_do_not_collide(self):
        self.bundle()
        # The reported Homebrew bug created this path as a directory before extraction.
        (self.stage / "usr/share/applications/chatgpt.desktop").mkdir(parents=True)
        result = self.run_bootstrap()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.stage / "prepared/integration").is_dir())
        self.assertFalse((self.stage / "source").exists())

    def test_rollback_reprepares_existing_payload(self):
        self.bundle(b'#!/bin/bash\ntest ! -e "$3" || exit 1\nmkdir -p "$3/integration"\n')
        first = self.run_bootstrap()
        self.assertEqual(first.returncode, 0, first.stderr)
        (self.stage / "prepared/stale").write_text("old")
        second = self.run_bootstrap()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertTrue((self.stage / "prepared/integration").is_dir())
        self.assertFalse((self.stage / "prepared/stale").exists())

    def test_failed_repreparation_preserves_previous_payload(self):
        self.bundle(b'#!/bin/bash\nmkdir -p "$3"\nexit 42\n')
        previous = self.stage / "prepared"
        previous.mkdir()
        (previous / "keep").write_text("previous payload")
        result = self.run_bootstrap()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((previous / "keep").read_text(), "previous payload")
        self.assertEqual(list(self.stage.glob(".homebrew-bootstrap-*")), [])

    def test_source_checksum_failure_never_runs_adapter(self):
        archive = self.bundle()
        archive.write_bytes(b"wrong source")
        result = self.run_bootstrap()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256 mismatch", result.stderr)
        self.assertFalse((self.stage / "prepared").exists())

    def test_download_failure_never_runs_adapter(self):
        self.bundle().unlink()
        result = self.run_bootstrap()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.stage / "prepared").exists())

    def test_adapter_failure_never_installs_public_artifacts(self):
        self.bundle(b"#!/bin/bash\nexit 42\n")
        result = self.run_bootstrap()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.stage / "prepared").exists())
        self.assertFalse((self.prefix / "bin/codex-desktop").exists())

    def test_bad_archive_never_runs_adapter(self):
        archive = self.bundle()
        archive.write_bytes(b"not a tar")
        r = json.loads((self.stage / "release.json").read_text())
        r["source"]["sha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        (self.stage / "release.json").write_text(json.dumps(r))
        result = self.run_bootstrap()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.stage / "prepared").exists())


if __name__ == "__main__":
    unittest.main()
