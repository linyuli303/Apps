"""Release panel tests with fake DOM and controller; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyReleaseRendererTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_release_renderer(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_release_renderer.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 release-renderer tests passed.", result.stdout)