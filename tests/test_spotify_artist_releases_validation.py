"""Artist-release metadata tests with fake data; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyArtistReleaseValidationTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_artist_release_validation(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_artist_releases_validation.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(
            "9 artist-release validation tests passed.", result.stdout
        )