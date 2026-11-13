"""Playlist-song reader with fake responses; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyPlaylistItemReaderTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_playlist_item_reader(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_playlist_items_reader.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Playlist-item reader checks passed.", result.stdout)