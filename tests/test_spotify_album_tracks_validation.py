"""Album-track page validation with synthetic metadata; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyAlbumTrackValidationTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_album_track_page(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_album_tracks_validation.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: album song order", result.stdout)