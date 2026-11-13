"""Bounded overview loading with fake controllers; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyLatestReleaseBatchTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_latest_release_batch(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_latest_release_batch.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 latest-release batch tests passed.", result.stdout)