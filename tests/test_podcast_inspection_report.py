"""Offline validation of diagnostic Issue report rendering."""
import copy
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_resolution as resolution


def sample():
    return {
        "episodeCount": 89,
        "feedHost": "feeds.example.org",
        "mediaHostsToReview": ["audio.example.org"],
        "mediaInspection": [{
            "status": "observed",
            "reason": "head_ok",
            "hops": [{
                "host": "audio.example.org",
                "httpStatus": 200,
                "setCookie": False,
            }],
        }],
    }


class InspectionReportTests(unittest.TestCase):
    def test_reports_observations_not_approval(self):
        report = resolution.inspection_feedback(sample())
        self.assertIn("Eligible episodes: 89", report)
        self.assertIn("audio.example.org", report)
        self.assertIn("HTTP 200", report)
        self.assertIn("not approved permissions", report)
        self.assertIn("Browser playback has not been verified", report)

    def test_title_urls_and_errors_are_not_echoed(self):
        result = sample()
        result.update(title="untrusted-marker", error="untrusted-marker",
                      url="https://example.org/untrusted-marker")
        report = resolution.inspection_feedback(result)
        self.assertNotIn("untrusted-marker", report)
        self.assertNotIn("https://", report)

    def test_invalid_hosts_fail_closed(self):
        for host in ("example.org` @someone", "127.0.0.1",
                     "https://example.org", "bad..example.org"):
            result = sample()
            result["feedHost"] = host
            with self.assertRaises(ValueError):
                resolution.inspection_feedback(result)

    def test_bounds_and_types_fail_closed(self):
        changes = (
            {"episodeCount": True},
            {"episodeCount": 10001},
            {"mediaInspection": sample()["mediaInspection"] * 4},
            {"mediaHostsToReview": ["audio.example.org"] * 21},
        )
        for change in changes:
            result = sample()
            result.update(change)
            with self.assertRaises(ValueError):
                resolution.inspection_feedback(result)

    def test_raw_reason_is_not_echoed(self):
        result = sample()
        result["mediaInspection"][0]["reason"] = "untrusted-marker"
        with self.assertRaises(ValueError):
            resolution.inspection_feedback(result)

    def test_report_does_not_mutate_result(self):
        result = sample()
        original = copy.deepcopy(result)
        resolution.inspection_feedback(result)
        self.assertEqual(result, original)

    def test_missing_inspection_keeps_existing_behavior(self):
        self.assertEqual(resolution.inspection_feedback({}), "")
