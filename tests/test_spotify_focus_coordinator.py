"""Focus coordinator tests with fake views and DOM; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyFocusCoordinatorTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_focus_coordinator(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_focus_coordinator.cjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("9 focus-coordinator tests passed.", result.stdout)