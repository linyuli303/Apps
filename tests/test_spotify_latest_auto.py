"""Automatic overview loading with fake DOM/controllers; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyLatestAutoTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_automatic_loading(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_latest_auto.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 automatic-loading tests passed.", result.stdout)