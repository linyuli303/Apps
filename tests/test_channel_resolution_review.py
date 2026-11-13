"""Advisory identity review generation; no network or approval writes."""
import copy
import importlib.util
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_review_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

A = "UC" + "a" * 22


def row(lookup="@Example", duplicate=False):
    return {
        "kind": "handle", "lookup": lookup,
        "id": A, "title": "Sample channel",
        "url": "https://www.youtube.com/channel/" + A,
        "duplicate": duplicate,
    }


def resolution():
    return {
        "issue_number": 7,
        "issue_updated_at": "2026-11-13T12:00:00Z",
        "rows": (row(), row("@Alias", True)),
    }


class ChannelResolutionReviewTests(unittest.TestCase):
    def test_unique_ids_manual_confirmation_and_fixed_form(self):
        source = resolution()
        original = copy.deepcopy(source)
        output = m.build_resolution_review(source)

        self.assertEqual(output["channel_ids"], (A,))
        self.assertEqual(output["channel_text"], A)
        self.assertIn("@Example", output["report"])
        self.assertIn("@Alias", output["report"])
        self.assertIn("Duplicate resolved ID", output["report"])
        self.assertIn("No channels have been added", output["report"])
        self.assertFalse(output["requires_paste"])

        url = urlsplit(output["addition_url"])
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.netloc, "github.com")
        self.assertEqual(url.path, "/linyuli303/Apps/issues/new")
        fields = parse_qs(url.query)
        self.assertEqual(fields, {
            "template": ["channel-bulk-add.yml"],
            "title": ["[MyTube] Channel change"],
            "operation": ["Add multiple"],
            "channel_ids": [A],
        })
        self.assertNotIn("confirmation", fields)
        self.assertEqual(source, original)

    def test_report_does_not_use_provider_supplied_urls(self):
        source = resolution()
        source["rows"][0]["url"] = "https://untrusted.example/"
        with self.assertRaises(ValueError):
            m.build_resolution_review(source)

    def test_malformed_identity_and_duplicate_claims_rejected(self):
        for changes in [
            {"id": "bad"},
            {"title": "bad\nname"},
            {"title": ""},
            {"duplicate": True},
            {"duplicate": 0},
            {"kind": "id"},
            {"lookup": "@bad/extra"},
            {"unexpected": "field"},
        ]:
            source = resolution()
            source["rows"][0].update(changes)
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    m.build_resolution_review(source)

    def test_bounded_review_container(self):
        for changes in [
            {"issue_number": True},
            {"issue_number": 0},
            {"issue_updated_at": "bad"},
            {"rows": []},
            {"rows": [row()] * 51},
            {"unexpected": "field"},
        ]:
            source = resolution()
            source.update(changes)
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    m.build_resolution_review(source)

    def test_title_is_plain_report_data_not_markup(self):
        source = resolution()
        source["rows"][0]["title"] = "<b>Example</b>"
        output = m.build_resolution_review(source)
        self.assertIn("Title: <b>Example</b>", output["report"])
        # Report consumers must use plain text or a safely generated file,
        # not interpolate provider titles into executable HTML/Markdown.


if __name__ == "__main__":
    unittest.main()