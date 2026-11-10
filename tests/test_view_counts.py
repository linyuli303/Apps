"""Offline tests: real view counts, legacy feeds and request batching."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

def load(name):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "scripts" / (name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

builder = load("build_feed")
prepare = load("prepare_site")
reuse = load("reuse_public_feed")
CID = "UC" + "x" * 22

class ViewCountTests(unittest.TestCase):
    def build_sample(self, statistics):
        calls = []
        def request(resource, params, key):
            calls.append((resource, params))
            if resource == "channels":
                return {"items": [{
                    "id": CID,
                    "snippet": {"title": "Channel"},
                    "contentDetails": {
                        "relatedPlaylists": {"uploads": "UUexample"}
                    },
                }]}
            if resource == "playlistItems":
                return {"items": [{
                    "contentDetails": {"videoId": "a" * 11}
                }]}
            return {"items": [{
                "id": "a" * 11,
                "snippet": {
                    "channelId": CID,
                    "title": "Video",
                    "publishedAt": "2026-01-01T00:00:00Z",
                },
                "status": {"privacyStatus": "public", "embeddable": True},
                "contentDetails": {"duration": "PT1M"},
                "statistics": statistics,
            }]}
        config = {
            "title": "Test",
            "channels": [{"id": CID}],
            "max_videos_per_channel": 15,
        }
        return builder.build(config, "fake", request), config, calls

    def test_count_collected_without_extra_requests(self):
        feed, config, calls = self.build_sample({"viewCount": "123456"})
        self.assertEqual(feed["videos"][0]["viewCount"], "123456")
        self.assertEqual(
            [resource for resource, params in calls],
            ["channels", "playlistItems", "videos"],
        )
        self.assertIn("statistics", calls[-1][1]["part"].split(","))
        self.assertTrue(prepare.validate_feed(feed, config))

    def test_missing_and_invalid_statistics_are_unavailable(self):
        for statistics in ({}, None, {"viewCount": "-1"},
                           {"viewCount": 123}, {"viewCount": "x"}):
            feed, config, calls = self.build_sample(statistics)
            self.assertEqual(feed["videos"][0]["viewCount"], "")

    def test_legacy_and_new_snapshots_reusable(self):
        feed, config, calls = self.build_sample({"viewCount": "0"})
        for legacy in (False, True):
            candidate = copy.deepcopy(feed)
            if legacy:
                candidate["videos"][0].pop("viewCount")
            now = dt.datetime.fromisoformat(candidate["generatedAt"])
            result = reuse.validate_snapshot(
                json.dumps(candidate).encode("utf-8"), config, now
            )
            self.assertEqual(result, candidate)

    def test_invalid_counts_and_unknown_fields_rejected(self):
        feed, config, calls = self.build_sample({"viewCount": "123"})
        for invalid in (-1, 123, None, True, "-1", "1.5", "1e6", "9" * 21):
            candidate = copy.deepcopy(feed)
            candidate["videos"][0]["viewCount"] = invalid
            with self.assertRaises(ValueError):
                prepare.validate_feed(candidate, config)
        feed["videos"][0]["unexpected"] = ""
        with self.assertRaises(ValueError):
            prepare.validate_feed(feed, config)

if __name__ == "__main__":
    unittest.main()
