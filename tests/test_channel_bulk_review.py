"""Frontend batch review using synthetic IDs; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class ChannelBulkReviewTests(unittest.TestCase):
    @unittest.skipUnless(NODE, "Node.js unavailable")
    def test_batch_review(self):
        result = subprocess.run(
            [NODE, str(ROOT / "tests/channel_bulk_review.cjs")],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: bounded batch review", result.stdout)