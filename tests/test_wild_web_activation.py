"""Wild Wild Web activation and collection-isolation regression checks."""
from pathlib import Path
import copy
import json
import re
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_podcasts as collector


class WildWebActivationTests(unittest.TestCase):
    def configuration(self):
        return json.loads(
            (ROOT / "podcasts.json").read_text(encoding="utf-8")
        )

    def test_exact_source(self):
        config = self.configuration()
        collector.validate_config(config)
        matches = [
            show for show in config["shows"]
            if show["id"] == "apple-1574676417"
        ]
        self.assertEqual(matches, [{
            "id": "apple-1574676417",
            "title": "Wild Wild Web - Geschichten aus dem Internet",
            "enabled": True,
            "feedUrl": "https://feeds.br.de/wild-wild-web/feed.xml",
            "feedHosts": ["feeds.br.de"],
            "mediaHosts": ["media.neuland.br.de"],
        }])

    def test_explicit_player_and_csp_permissions(self):
        expected = {"media.neuland.br.de", "cdn-storage.br.de"}
        js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        match = re.search(
            r"const allowedHosts = new Set\((\[[^\r\n]*\])\);", js
        )
        self.assertIsNotNone(match)
        self.assertTrue(expected.issubset(json.loads(match.group(1))))
        html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        policy = re.search(r"media-src ([^;]+);", html).group(1).split()
        self.assertTrue(
            {"https://" + host for host in expected}.issubset(policy)
        )
        self.assertFalse(any("*" in token for token in policy))
        self.assertNotIn("https:", policy)

    def test_new_feed_failure_does_not_discard_other_success(self):
        full = self.configuration()
        new = next(
            show for show in full["shows"]
            if show["id"] == "apple-1574676417"
        )
        existing = next(
            show for show in full["shows"]
            if show["enabled"] and show["id"] != new["id"]
        )
        config = dict(full, shows=copy.deepcopy([existing, new]))
        original = copy.deepcopy(config)

        def fetch(url, hosts):
            if url == new["feedUrl"]:
                raise OSError("Simulated new-source failure")
            return b"offline fixture"

        episode = {"id": "fixture", "publishedAt": "2026-11-12T00:00:00Z"}
        with patch.object(
            collector, "parse_feed",
            return_value=([episode], {"items": 1, "rejected": 0, "eligible": 1}),
        ):
            result = collector.collect(config, fetcher=fetch)

        statuses = {show["id"]: show["status"] for show in result["shows"]}
        self.assertEqual(statuses[existing["id"]], "ok")
        self.assertEqual(statuses[new["id"]], "unavailable")
        self.assertEqual(result["episodes"], [episode])
        self.assertEqual(config, original)
