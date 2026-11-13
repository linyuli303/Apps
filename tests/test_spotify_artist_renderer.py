"""Artist renderer tests using a fake DOM; no browser/network/account access."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyArtistRendererTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_artist_renderer(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_artist_renderer.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("7 artist-renderer tests passed.", result.stdout)