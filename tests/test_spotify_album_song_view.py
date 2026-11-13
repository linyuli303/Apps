"""Album song-list tests with fake DOM/controller; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyAlbumSongViewTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_album_song_view(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_album_song_view.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("5 album-song view tests passed.", result.stdout)