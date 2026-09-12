import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("render_cask", Path(__file__).with_name("render-cask.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(shutil.which("brew"), "Homebrew is required to test its environment filtering")
class CaskEnvironmentTests(unittest.TestCase):
    def test_xdg_artifacts_through_homebrew(self):
        with tempfile.TemporaryDirectory() as directory:
            cask = Path(directory) / "chatgpt-community.rb"
            cask.write_text(module.render({"ready": True}))
            for value in (directory + "/desktop data", "relative/path"):
                with self.subTest(xdg_data_home=value):
                    environment = dict(os.environ, XDG_DATA_HOME=value, HOMEBREW_NO_AUTO_UPDATE="1")
                    result = subprocess.run([
                        "brew", "ruby", "-e",
                        'require "cask/cask_loader"; '
                        'c = Cask::CaskLoader::FromContentLoader.new(File.read(ARGV.fetch(0))).load(config: nil); '
                        'c.artifacts.grep(Cask::Artifact::Artifact).each { |a| puts a.target }',
                        str(cask),
                    ], env=environment, text=True, capture_output=True, check=True)
                    data_home = Path(value) if value.startswith("/") else Path.home() / ".local/share"
                    self.assertEqual(set(result.stdout.splitlines()), {
                        str(data_home / "applications/codex-desktop.desktop"),
                        str(data_home / "icons/codex-desktop.png"),
                    })
