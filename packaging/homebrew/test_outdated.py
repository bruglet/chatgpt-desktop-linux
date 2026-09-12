import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("check_outdated", Path(__file__).with_name("check-outdated.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OutdatedTests(unittest.TestCase):
    def check_result(self, status, payload):
        result = subprocess.CompletedProcess([], status, payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(module.subprocess, "run", return_value=result):
            module.check("bruglet/chatgpt-desktop-linux/chatgpt-community", Path(directory) / "outdated.json")

    def test_expected_nonzero_status_with_update(self):
        self.check_result(1, json.dumps({"casks": [{"name": "chatgpt-community"}]}))

    def test_rejects_no_update_or_unrelated_update(self):
        for casks in ([], [{"name": "another-app"}]):
            with self.subTest(casks=casks), self.assertRaises(RuntimeError):
                self.check_result(0, json.dumps({"casks": casks}))

    def test_rejects_command_error(self):
        with self.assertRaises(RuntimeError):
            self.check_result(2, json.dumps({"casks": [{"name": "chatgpt-community"}]}))

    def test_rejects_invalid_error_output(self):
        with self.assertRaises(ValueError):
            self.check_result(1, "")
