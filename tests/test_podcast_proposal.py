"""Offline proposal guards. No network or repository writes."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from podcast_proposal import build_proposal
from podcast_resolution import prepare

spec = importlib.util.spec_from_file_location(
    "proposal_request_fixtures", ROOT / "tests/test_podcast_requests.py"
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class ProposalTests(unittest.TestCase):
    def setup_proposal(self):
        event = fixtures.event()
        config = {
            "version": 1, "maxEpisodesPerShow": None, "shows": [{
                "id": "apple-1", "title": "Existing", "enabled": True,
                "feedUrl": "https://feeds.example.org/existing",
                "feedHosts": ["feeds.example.org"],
                "mediaHosts": ["old.example.org"],
            }],
        }
        candidate = {
            "id": "apple-123456", "title": "New", "enabled": True,
            "feedUrl": "https://feeds.example.org/new",
            "feedHosts": ["feeds.example.org"],
            "mediaHosts": ["new.example.org"],
        }
        result = {
            "status": "approval_required", "reason": "new_media_hosts",
            "candidate": candidate, "episodeCount": 3,
            "feedHost": "feeds.example.org",
            "mediaHostsToReview": ["new.example.org"],
            "mediaInspection": [{
                "status": "observed", "reason": "head_ok", "hops": [
                    {"host": "new.example.org", "httpStatus": 302,
                     "setCookie": False},
                    {"host": "delivery.example.org", "httpStatus": 200,
                     "setCookie": False},
                ],
            }],
        }
        envelope = prepare(event, config, lambda *_: result)
        js = 'const allowedHosts = new Set(["old.example.org"]);'
        html = "media-src https://old.example.org; object-src 'none';"
        return event, config, envelope, js, html

    def test_additive_three_file_proposal_preserves_inputs(self):
        args = self.setup_proposal()
        before = copy.deepcopy(args)
        output = build_proposal(*args)
        self.assertEqual(set(output), {
            "podcasts.json", "site/app.js", "site/index.html"
        })
        self.assertEqual(
            json.loads(output["podcasts.json"])["shows"][:-1],
            args[1]["shows"],
        )
        for host in ("old.example.org", "new.example.org", "delivery.example.org"):
            self.assertIn(host, output["site/app.js"])
            self.assertIn("https://" + host, output["site/index.html"])
        self.assertTrue(output["site/index.html"].endswith("object-src 'none';"))
        self.assertEqual(args, before)

    def test_edited_issue_rejected(self):
        args = self.setup_proposal()
        args[0]["issue"]["updated_at"] = "edited"
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_unexpected_existing_csp_tokens_rejected(self):
        for token in (
            "https:", "https://*.example.org",
            "https://old.example.org/path",
            "https://old.example.org:443",
            "'self'",
        ):
            with self.subTest(token=token):
                args = list(self.setup_proposal())
                args[4] = "media-src " + token + "; object-src 'none';"
                with self.assertRaises(ValueError):
                    build_proposal(*args)

    def test_unsampled_initial_host_rejected(self):
        args = self.setup_proposal()
        result = args[2]["result"]
        result["candidate"]["mediaHosts"].append("second.example.org")
        result["mediaHostsToReview"].append("second.example.org")
        result["mediaHostsToReview"].sort()
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_nonredirect_intermediate_hop_rejected(self):
        args = self.setup_proposal()
        args[2]["result"]["mediaInspection"][0]["hops"][0]["httpStatus"] = 200
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_stale_config_rejected(self):
        args = list(self.setup_proposal())
        args[1]["shows"][0]["title"] = "Changed"
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_failed_inspection_rejected(self):
        args = self.setup_proposal()
        args[2]["result"]["mediaInspection"][0].update(
            status="review_required", reason="network_or_destination_failed"
        )
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_existing_record_replacement_rejected(self):
        args = self.setup_proposal()
        args[2]["result"]["candidate"]["feedUrl"] = args[1]["shows"][0]["feedUrl"]
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_wrong_candidate_identity_rejected(self):
        args = self.setup_proposal()
        args[2]["result"]["candidate"]["id"] = "apple-999"
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_source_structure_drift_rejected(self):
        args = list(self.setup_proposal())
        args[3] = "unexpected player source"
        with self.assertRaises(ValueError):
            build_proposal(*args)

    def test_unsafe_delivery_host_rejected(self):
        args = self.setup_proposal()
        args[2]["result"]["mediaInspection"][0]["hops"][-1]["host"] = "127.0.0.1"
        with self.assertRaises(ValueError):
            build_proposal(*args)
