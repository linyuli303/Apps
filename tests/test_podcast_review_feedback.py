"""Offline checks for safe, specific onboarding feedback."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_resolution as resolution

spec = importlib.util.spec_from_file_location(
    "feedback_fixtures", ROOT / "tests/test_podcast_requests.py"
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class ReviewFeedbackTests(unittest.TestCase):
    def test_known_reasons_use_fixed_explanations(self):
        for reason, explanation in resolution.REVIEW_REASONS.items():
            result = {"status": "review_required", "reason": reason}
            self.assertIn(explanation, resolution.review_feedback(result))

    def test_untrusted_values_are_not_echoed(self):
        for reason in ("untrusted-marker", ["untrusted-marker"], None):
            result = {
                "status": "review_required",
                "reason": reason,
                "title": "untrusted-marker",
                "error": "untrusted-marker",
            }
            message = resolution.review_feedback(result)
            self.assertNotIn("untrusted-marker", message)
            self.assertIn("No recognized diagnostic reason", message)

    def test_review_preserves_configuration_without_publication(self):
        for status in ("approval_required", "review_required"):
            event = fixtures.event()
            config = fixtures.config()
            before = copy.deepcopy(config)
            result = {"status": status, "reason": "new_media_hosts"}
            envelope = resolution.prepare(
                event, config, lambda *_: result
            )
            updated, changed, message, publish = resolution.apply_validated(
                event, config, envelope
            )
            self.assertEqual(config, before)
            self.assertEqual(updated, before)
            self.assertFalse(changed)
            self.assertFalse(publish)
            self.assertIn("No configuration or CSP permissions", message)
