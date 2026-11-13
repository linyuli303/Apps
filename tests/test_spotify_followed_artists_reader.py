"""Mocked followed-artist transport tests; no network or account access."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyFollowedArtistReaderTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_followed_artist_reader(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_followed_artists_reader.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("8 followed-artist reader tests passed.", result.stdout)