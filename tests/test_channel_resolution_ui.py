"""Local frontend lookup UI regression tests; no live requests."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class ChannelResolutionUITests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_lookup_ui(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/channel_resolution_ui.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: lookup UI", result.stdout)