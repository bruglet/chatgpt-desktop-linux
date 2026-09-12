import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import support


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_payload_comparison_covers_links_bytes_and_executable_bits(self):
        left, right = self.root / "a", self.root / "b"
        for root in (left, right):
            root.mkdir()
            (root / "file").write_text("payload")
            (root / "link").symlink_to("file")
        support.compare(left, right)
        (right / "file").chmod(0o755)
        with self.assertRaisesRegex(ValueError, "file"):
            support.compare(left, right)
        (right / "file").chmod(0o644)
        (right / "file").write_text("changed")
        with self.assertRaises(ValueError):
            support.compare(left, right)
        (right / "file").write_text("payload")
        (right / "link").unlink()
        (right / "link").symlink_to("other")
        with self.assertRaisesRegex(ValueError, "link"):
            support.compare(left, right)

    def test_rpm_hash_and_identity_fail_closed(self):
        rpm = self.root / "app.rpm"
        rpm.write_bytes(b"rpm")
        manifest = self.root / "release.json"
        release = {"version": "1.2.3", "packages": {"amd64": {"sha256": support.digest(rpm)}}}
        manifest.write_text(json.dumps(release))
        with patch.object(support, "run", side_effect=["chatgpt\n1.2.3\n1\nx86_64", "/usr/lib/chatgpt/ChatGPT"]):
            support.verify_rpm(str(rpm), str(manifest), "amd64")
        with patch.object(support, "run", return_value="chatgpt\n1.2.3\n1\naarch64"):
            with self.assertRaisesRegex(ValueError, "identity"):
                support.verify_rpm(str(rpm), str(manifest), "amd64")
        rpm.write_bytes(b"bad")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            support.verify_rpm(str(rpm), str(manifest), "amd64")

    def test_debian_license_relocation_still_verifies_bytes(self):
        rpm = self.root / "rpm/usr/lib/chatgpt"
        deb = self.root / "deb/usr/lib/chatgpt"
        copyright_file = self.root / "deb/usr/share/doc/chatgpt/copyright"
        for directory in (rpm, deb, copyright_file.parent):
            directory.mkdir(parents=True)
        for directory in (rpm, deb):
            (directory / "ChatGPT").write_text("executable")
        (rpm / "LICENSE").write_text("license")
        copyright_file.write_text("license")
        support.compare(rpm, deb)
        copyright_file.write_text("wrong license")
        with self.assertRaisesRegex(ValueError, "LICENSE"):
            support.compare(rpm, deb)

    def test_missing_payload_rejected(self):
        with self.assertRaisesRegex(ValueError, "Missing executable"):
            support.verify_payload(self.root)

    def test_desktop_exec_quotes_special_paths(self):
        output = self.root / "app.desktop"
        support.desktop(output, '/tmp/brew space/quote"/$dollar/%percent')
        desktop = output.read_text()
        self.assertIn(' %U\n', desktop)
        self.assertIn('%%percent/bin/codex-desktop"', desktop)
        self.assertIn('\\\\"', desktop)
        self.assertIn('\\\\$', desktop)
        self.assertNotIn("--no-sandbox", desktop)

    def make_compiler(self):
        tools = self.root / "tools"
        tools.mkdir()
        for name, text in {"rustc": "rustc fixture", "cc": "cc fixture"}.items():
            (tools / name).write_text(f"#!/bin/sh\necho '{text}'\n")
            (tools / name).chmod(0o755)
        cargo = tools / "cargo"
        cargo.write_text(f'''#!{sys.executable}
import pathlib,sys,time
root = pathlib.Path({str(self.root)!r})
with (root / 'builds').open('a') as log: log.write('build\\n')
time.sleep(0.2)
if (root / 'fail').exists(): sys.exit(1)
target = pathlib.Path(sys.argv[sys.argv.index('--target-dir') + 1]) / 'release'
target.mkdir(parents=True)
binary = target / 'codex-mcp-helper-reaper'
binary.write_text('#!/bin/sh\\nexit 0\\n')
binary.chmod(0o755)
''')
        cargo.chmod(0o755)
        crate = self.root / "crate"
        (crate / "src").mkdir(parents=True)
        (crate / "Cargo.toml").write_text("manifest")
        (crate / "Cargo.lock").write_text("lock")
        (crate / "src/main.rs").write_text("source")
        return tools, crate

    def test_helper_cache_reuse_corruption_source_and_compiler_changes(self):
        tools, crate = self.make_compiler()
        cache = self.root / "cache"
        with patch.dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"]):
            first = support.helper(crate, cache)
            self.assertEqual(first, support.helper(crate, cache))
            self.assertEqual((self.root / "builds").read_text().count("build"), 1)
            first.write_text("corrupt")
            self.assertEqual(first, support.helper(crate, cache))
            self.assertEqual((self.root / "builds").read_text().count("build"), 2)
            (crate / "Cargo.lock").write_text("new lock")
            second = support.helper(crate, cache)
            self.assertNotEqual(first, second)
            (tools / "rustc").write_text("#!/bin/sh\necho new-rustc\n")
            self.assertNotEqual(second, support.helper(crate, cache))

    def test_helper_parallel_build_and_failed_build(self):
        tools, crate = self.make_compiler()
        env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"])
        command = [sys.executable, str(Path(support.__file__)), "helper", str(crate), str(self.root / "cache")]
        children = [subprocess.Popen(command, env=env, stdout=subprocess.PIPE, text=True) for _ in range(2)]
        results = [child.communicate()[0].strip() for child in children]
        self.assertEqual([child.returncode for child in children], [0, 0])
        self.assertEqual(results[0], results[1])
        self.assertEqual((self.root / "builds").read_text().count("build"), 1)
        (self.root / "fail").touch()
        (crate / "src/main.rs").write_text("changed source")
        failed = subprocess.run(command, env=env, capture_output=True)
        self.assertNotEqual(failed.returncode, 0)
        entries = [p for p in (self.root / "cache/helpers").iterdir() if p.is_dir()]
        self.assertEqual(len(entries), 1)

    def test_cache_architecture_is_part_of_identity(self):
        root = self.root / "crate"
        root.mkdir()
        (root / "source").write_text("same")
        self.assertNotEqual(support.helper_key(root, "amd64", "rust", "cc"),
                            support.helper_key(root, "arm64", "rust", "cc"))

    def test_generated_cask_keeps_sandbox_and_normal_upgrade(self):
        spec = importlib.util.spec_from_file_location("render", Path(__file__).with_name("render-cask.py"))
        renderer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(renderer)
        cask = renderer.render({"ready": True, "source": {}})
        self.assertNotIn("auto_updates", cask)
        self.assertNotIn("inreplace", cask)
        self.assertNotIn("HOMEBREW_NO_SANDBOX", cask)
        self.assertIn("command_wrapper", cask)
        self.assertIn("preflight_steps", cask)
        self.assertIn("network_access: true", cask)
        self.assertNotIn("zap trash", cask)


if __name__ == "__main__":
    unittest.main()
