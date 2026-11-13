"""Artwork preference tests with fake DOM; no network or browser storage."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyArtworkPreferenceTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_artwork_preference(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_artwork_preference.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: restored checkbox reset", result.stdout)