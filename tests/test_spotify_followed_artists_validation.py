"""Run followed-artist validation with fake data; no network or account access."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyFollowedArtistValidationTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_followed_artist_validation(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_followed_artists_validation.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(
            "9 followed-artist validation tests passed.", result.stdout
        )