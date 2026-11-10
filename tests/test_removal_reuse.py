"""Offline regression tests for subtractive public-feed reuse."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location(
    "removal_reuse", ROOT / "scripts/reuse_public_feed.py"
)
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)

A = "UC" + "a" * 22
B = "UC" + "b" * 22
C = "UC" + "c" * 22

class RemovalReuseTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 11, 10, 12, tzinfo=dt.timezone.utc)
        self.config = {
            "title": "Test",
            "max_videos_per_channel": 15,
            "channels": [{"id": A}],
        }
        self.feed = {
            "title": "Test",
            "generatedAt": self.now.isoformat(),
            "channels": [
                {"id": A, "title": "Keep"},
                {"id": B, "title": "Remove"},
            ],
            "videos": [
                {
                    "id": "a" * 11,
                    "channelId": A,
                    "title": "Keep video",
                    "publishedAt": self.now.isoformat(),
                    "duration": "PT1M",
                    "viewCount": "123",
                },
                {
                    "id": "b" * 11,
                    "channelId": B,
                    "title": "Remove video",
                    "publishedAt": self.now.isoformat(),
                    "duration": "PT1M",
                },
            ],
        }

    def run_filter(self):
        raw = json.dumps(self.feed).encode("utf-8")
        return reuse.filter_removed_channels(raw, self.config, self.now)

    def test_removal_filters_videos_and_preserves_timestamp(self):
        result = json.loads(self.run_filter())
        self.assertEqual([c["id"] for c in result["channels"]], [A])
        self.assertEqual([v["channelId"] for v in result["videos"]], [A])
        self.assertEqual(result["generatedAt"], self.feed["generatedAt"])
        self.assertEqual(result["videos"][0]["viewCount"], "123")
        self.assertEqual(len(self.feed["channels"]), 2)

    def test_addition_rejected(self):
        self.config["channels"].append({"id": C})
        with self.assertRaises(ValueError):
            self.run_filter()

    def test_expired_snapshot_rejected_even_for_removal(self):
        self.feed["generatedAt"] = (
            self.now - dt.timedelta(hours=25)
        ).isoformat()
        with self.assertRaises(ValueError):
            self.run_filter()

    def test_invalid_removed_video_still_rejected(self):
        self.feed["videos"][1]["channelId"] = C
        with self.assertRaises(ValueError):
            self.run_filter()

    def test_unchanged_snapshot_bytes_preserved(self):
        self.config["channels"].append({"id": B})
        raw = json.dumps(self.feed).encode("utf-8")
        self.assertEqual(
            reuse.filter_removed_channels(raw, self.config, self.now), raw
        )

    def test_remove_all_channels_supported(self):
        self.config["channels"] = []
        result = json.loads(self.run_filter())
        self.assertEqual(result["channels"], [])
        self.assertEqual(result["videos"], [])
        self.assertEqual(result["generatedAt"], self.feed["generatedAt"])

if __name__ == "__main__":
    unittest.main()
