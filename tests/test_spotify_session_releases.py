"""Release-session boundaries with fake dependencies; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifySessionReleaseTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_release_session_boundaries(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_session_releases.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("10 release-session tests passed.", result.stdout)