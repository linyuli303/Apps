"""Frontend lookup-request preparation; no network or navigation."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class ChannelResolutionFrontendTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_resolution_request_preparation(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/channel_resolution_request.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: bounded handle inputs", result.stdout)