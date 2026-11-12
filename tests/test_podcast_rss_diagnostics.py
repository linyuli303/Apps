"""Offline separation of RSS retrieval and validation failures."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_onboarding as onboarding
import podcast_resolution as resolution


class RssDiagnosticTests(unittest.TestCase):
    def test_retrieval_failure_has_fixed_reason(self):
        config = {"version": 1, "maxEpisodesPerShow": None, "shows": []}
        inspector = Mock()
        result = onboarding.resolve(
            "https://feeds.example.org/show.xml", config,
            fetcher=Mock(side_effect=OSError("private-error-marker")),
            inspector=inspector,
        )
        self.assertEqual(result["reason"], "rss_fetch_failed")
        self.assertNotIn("private-error-marker", str(result))
        self.assertIn("before XML validation", resolution.review_feedback(result))
        inspector.assert_not_called()
        self.assertEqual(config["shows"], [])

    def test_retrieved_invalid_xml_has_separate_reason(self):
        config = {"version": 1, "maxEpisodesPerShow": None, "shows": []}
        inspector = Mock()
        result = onboarding.resolve(
            "https://feeds.example.org/show.xml", config,
            fetcher=Mock(return_value=b"<rss>"),
            inspector=inspector,
        )
        self.assertEqual(result["reason"], "rss_validation_failed")
        self.assertIn("response was retrieved", resolution.review_feedback(result))
        inspector.assert_not_called()
        self.assertEqual(config["shows"], [])
