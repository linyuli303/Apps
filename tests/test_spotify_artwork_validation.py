"""Artwork URL selection with synthetic metadata; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyArtworkValidationTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_artwork_validation(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_artwork_validation.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("5 artwork validation tests passed.", result.stdout)