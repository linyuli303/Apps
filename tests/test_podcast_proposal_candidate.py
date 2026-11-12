"""Proposal candidates never confer production approval."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_onboarding as onboarding
import podcast_resolution as resolution

def fixture(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tests" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

feeds = fixture("proposal_feed_fixtures", "test_podcast_onboarding.py")
requests = fixture("proposal_request_fixtures", "test_podcast_requests.py")


class ProposalCandidateTests(unittest.TestCase):
    def candidate(self):
        config = feeds.config()
        fetch, _ = feeds.fake(xml=feeds.rss("new.example.org"))
        result = onboarding.resolve(feeds.APPLE, config, fetch, feeds.NOW)
        return config, result

    def test_candidate_has_validated_source_identity(self):
        config, result = self.candidate()
        self.assertEqual(result["status"], "approval_required")
        candidate = result["candidate"]
        self.assertEqual(candidate["id"], "apple-1814608156")
        self.assertEqual(candidate["feedUrl"], feeds.FEED)
        self.assertEqual(candidate["feedHosts"], ["feeds.example.org"])
        self.assertEqual(candidate["mediaHosts"], ["new.example.org"])
        self.assertNotIn("show", result)
        preview = copy.deepcopy(config)
        preview["shows"].append(candidate)
        onboarding.validate_config(preview)

    def test_candidate_cannot_activate_through_existing_apply(self):
        config, result = self.candidate()
        before = copy.deepcopy(config)
        event = requests.event({
            "operation": "Add", "sourceUrl": feeds.APPLE,
        })
        envelope = resolution.prepare(event, config, lambda *_: result)
        updated, changed, feedback, publish = resolution.apply_validated(
            event, config, envelope
        )
        self.assertEqual(updated, before)
        self.assertEqual(config, before)
        self.assertFalse(changed)
        self.assertFalse(publish)
        self.assertIn("approval required", feedback)

    def test_existing_approved_source_keeps_ready_path(self):
        fetch, _ = feeds.fake()
        result = onboarding.resolve(
            feeds.APPLE, feeds.config(), fetch, feeds.NOW
        )
        self.assertEqual(result["status"], "ready")
        self.assertNotIn("candidate", result)
