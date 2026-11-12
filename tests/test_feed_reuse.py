"""Offline coverage for quota-saving feed selection and reuse."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

def load(name):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "scripts" / (name + ".py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

selector = load("select_feed_mode")
reuse = load("reuse_public_feed")

class FeedModeTests(unittest.TestCase):
    def setUp(self):
        self.head = "b" * 40
        self.event = {
            "before": "a" * 40,
            "after": self.head,
            "ref": "refs/heads/main",
        }

    def test_frontend_push_reuses(self):
        diff = Mock(return_value={"site/app.js", "site/style.css", "site/index.html"})
        self.assertFalse(
            selector.needs_refresh("push", self.event, self.head, diff)
        )

    def test_clean_url_packaging_push_reuses(self):
        changed = {
            "scripts/prepare_site.py",
            "scripts/select_feed_mode.py",
            "site/app.js",
            "tests/test_clean_url_packaging.py",
            "tests/test_privacy_defaults.py",
            "tests/test_feed_reuse.py",
        }
        self.assertNotIn("scripts/prepare_site.py", selector.FEED_INPUTS)
        self.assertIn("channels.json", selector.FEED_INPUTS)
        self.assertIn("scripts/build_feed.py", selector.FEED_INPUTS)
        self.assertFalse(selector.needs_refresh(
            "push", self.event, self.head, Mock(return_value=changed)
        ))

    def test_apps_cutover_collects_before_reuse(self):
        self.assertEqual(
            reuse.PUBLIC_FEED,
            "https://linyuli303.github.io/Apps/data/feed.json",
        )
        self.assertIn("scripts/reuse_public_feed.py", selector.FEED_INPUTS)
        changed = {
            "scripts/reuse_public_feed.py",
            "scripts/prepare_site.py",
            "scripts/select_feed_mode.py",
            "site/app.js",
            "site/index.html",
        }
        self.assertTrue(selector.needs_refresh(
            "push", self.event, self.head, Mock(return_value=changed)
        ))

    def test_all_feed_inputs_refresh(self):
        for path in selector.FEED_INPUTS:
            self.assertTrue(selector.needs_refresh(
                "push", self.event, self.head, Mock(return_value={path})
            ))

    def test_manual_and_scheduled_runs_refresh(self):
        for event_name in ("workflow_dispatch", "schedule"):
            diff = Mock()
            self.assertTrue(selector.needs_refresh(
                event_name, {}, self.head, diff
            ))
            diff.assert_not_called()

    def test_missing_history_refreshes(self):
        self.assertTrue(selector.needs_refresh(
            "push", self.event, self.head, Mock(side_effect=RuntimeError())
        ))
        self.assertTrue(selector.needs_refresh(
            "push", {}, self.head, Mock()
        ))

class PublicFeedReuseTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 11, 10, 12, tzinfo=dt.timezone.utc)
        self.cid = "UC" + "x" * 22
        self.config = {
            "title": "Test",
            "max_videos_per_channel": 15,
            "channels": [{"id": self.cid}],
        }
        self.feed = {
            "title": "Test",
            "generatedAt": self.now.isoformat(),
            "channels": [{"id": self.cid, "title": "Channel"}],
            "videos": [{
                "id": "a" * 11,
                "channelId": self.cid,
                "title": "Video",
                "publishedAt": self.now.isoformat(),
                "duration": "PT1M",
            }],
        }

    def check_feed(self):
        raw = json.dumps(self.feed).encode("utf-8")
        return reuse.validate_snapshot(raw, self.config, self.now)

    def test_valid_timestamp_preserved(self):
        result = self.check_feed()
        self.assertEqual(result["generatedAt"], self.feed["generatedAt"])

    def test_expired_future_and_naive_timestamps_rejected(self):
        for value in (
            (self.now - dt.timedelta(hours=25)).isoformat(),
            (self.now + dt.timedelta(minutes=6)).isoformat(),
            "2026-11-10T12:00:00",
        ):
            self.feed["generatedAt"] = value
            with self.assertRaises(ValueError):
                self.check_feed()

    def test_whitelist_and_title_mismatch_rejected(self):
        self.config["channels"] = []
        with self.assertRaises(ValueError):
            self.check_feed()
        self.config["channels"] = [{"id": self.cid}]
        self.config["title"] = "Different"
        with self.assertRaises(ValueError):
            self.check_feed()

    def test_duplicates_and_limit_rejected(self):
        self.feed["videos"] *= 2
        with self.assertRaises(ValueError):
            self.check_feed()
        self.feed["videos"][1] = dict(self.feed["videos"][1], id="b" * 11)
        self.config["max_videos_per_channel"] = 1
        with self.assertRaises(ValueError):
            self.check_feed()

    def test_network_error_has_no_output_or_api_fallback(self):
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        with TemporaryDirectory() as folder:
            with (
                patch.object(reuse, "ROOT", Path(folder)),
                patch.object(reuse, "read_config", return_value=self.config),
                patch.object(reuse, "download", side_effect=OSError()),
            ):
                self.assertEqual(reuse.main(), 1)
                self.assertFalse((Path(folder) / "site/data/feed.json").exists())

    def test_workflow_preserves_pins_and_secret_scope(self):
        text = (ROOT / ".github/workflows/publish.yml").read_text(encoding="utf-8")
        self.assertIn("steps.feed-mode.outputs.refresh == 'false'", text)
        self.assertIn("steps.feed-mode.outputs.refresh == 'true'", text)
        self.assertEqual(text.count("${{ secrets.YOUTUBE_API_KEY }}"), 1)
        self.assertIn("fetch-depth: 0", text)

if __name__ == "__main__":
    unittest.main()
