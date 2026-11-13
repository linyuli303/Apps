"""Artwork rendering integration using fake DOM; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyArtworkRenderingTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_artwork_rendering(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_artwork_rendering.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: thumbnail rendering integration", result.stdout)