"""Offline inspection integration; no network or configuration writes."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_onboarding as onboarding

spec = importlib.util.spec_from_file_location(
    "inspection_onboarding_fixtures",
    ROOT / "tests/test_podcast_onboarding.py",
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class InspectionIntegrationTests(unittest.TestCase):
    def test_unknown_host_inspected_but_not_approved(self):
        config = fixtures.config()
        original = copy.deepcopy(config)
        fetch, _ = fixtures.fake(xml=fixtures.rss("new.example.org"))
        inspect = Mock(return_value={
            "status": "observed", "reason": "head_ok", "hops": []
        })
        result = onboarding.resolve(
            fixtures.APPLE, config, fetch, fixtures.NOW, inspector=inspect
        )
        self.assertEqual(result["status"], "approval_required")
        self.assertEqual(result["episodeCount"], 1)
        self.assertEqual(result["feedHost"], "feeds.example.org")
        self.assertEqual(len(result["mediaInspection"]), 1)
        inspect.assert_called_once_with("https://new.example.org/one.mp3")
        self.assertNotIn("show", result)
        self.assertEqual(config, original)

    def test_existing_approved_source_does_not_probe_audio(self):
        fetch, _ = fixtures.fake()
        inspect = Mock(side_effect=AssertionError("Unexpected HEAD"))
        result = onboarding.resolve(
            fixtures.APPLE, fixtures.config(), fetch, fixtures.NOW,
            inspector=inspect,
        )
        self.assertEqual(result["status"], "ready")
        inspect.assert_not_called()

    def test_failed_inspection_cannot_activate(self):
        fetch, _ = fixtures.fake(xml=fixtures.rss("new.example.org"))
        result = onboarding.resolve(
            fixtures.APPLE, fixtures.config(), fetch, fixtures.NOW,
            inspector=Mock(side_effect=OSError("private-error-marker")),
        )
        self.assertEqual(result["status"], "approval_required")
        self.assertEqual(
            result["mediaInspection"][0]["reason"], "inspection_failed"
        )
        self.assertNotIn("private-error-marker", str(result))

    def test_invalid_episode_not_probed(self):
        xml = fixtures.rss("new.example.org").replace(
            b"Wed, 11 Nov 2026 04:00:00 -0000", b"invalid-date"
        )
        fetch, _ = fixtures.fake(xml=xml)
        inspect = Mock()
        result = onboarding.resolve(
            fixtures.APPLE, fixtures.config(), fetch, fixtures.NOW,
            inspector=inspect,
        )
        self.assertEqual(result["status"], "review_required")
        self.assertEqual(result["reason"], "no_eligible_episodes")
        inspect.assert_not_called()

    def test_sampling_is_bounded_to_three(self):
        xml = fixtures.rss("new.example.org")
        item = xml.split(b"<item>", 1)[1].split(b"</item>", 1)[0]
        items = b"".join(
            b"<item>" + item.replace(b"<guid>one</guid>",
                ("<guid>item-" + str(i) + "</guid>").encode())
            + b"</item>"
            for i in range(10)
        )
        xml = xml.split(b"<item>", 1)[0] + items + b"</channel></rss>"
        fetch, _ = fixtures.fake(xml=xml)
        inspect = Mock(return_value={
            "status": "observed", "reason": "head_ok", "hops": []
        })
        result = onboarding.resolve(
            fixtures.APPLE, fixtures.config(), fetch, fixtures.NOW,
            inspector=inspect,
        )
        self.assertEqual(result["episodeCount"], 10)
        self.assertEqual(inspect.call_count, 3)
