"""Song metadata validation with fake records; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyTrackMetadataTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_track_metadata(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_track_metadata.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: reduced immutable track data", result.stdout)