"""Memory-only grid control checks with fake DOM; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyGridSizeTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_grid_size_control(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/spotify_grid_size.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: 70% default", result.stdout)