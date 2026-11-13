"""Playlist song-page validation with synthetic metadata; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyPlaylistItemValidationTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_playlist_item_page(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_playlist_items_validation.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Playlist-item validation checks passed.", result.stdout)