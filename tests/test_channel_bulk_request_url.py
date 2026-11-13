"""Bulk request URL generation; no network or browser navigation."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class ChannelBulkRequestURLTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_bulk_request_url(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/channel_bulk_request_url.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: fixed GitHub destination", result.stdout)