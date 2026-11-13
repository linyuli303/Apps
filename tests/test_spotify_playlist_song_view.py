"""Playlist song-view tests with fake DOM; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyPlaylistSongViewTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_playlist_song_view(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_playlist_song_view.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("5 playlist-song view tests passed.", result.stdout)
