"""Playlist-song session boundaries with fake account data; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifySessionPlaylistItemTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_playlist_song_session(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_session_playlist_items.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 playlist-song session tests passed.", result.stdout)