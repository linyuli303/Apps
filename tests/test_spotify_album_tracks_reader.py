"""Album-track transport tests with synthetic responses; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyAlbumTrackReaderTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_album_track_reader(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_album_tracks_reader.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Album-track reader checks passed.", result.stdout)