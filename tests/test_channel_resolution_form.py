"""Resolution form/parser contract; no live GitHub rendering or requests."""
import importlib.util
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_form_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ChannelResolutionFormTests(unittest.TestCase):
    def setUp(self):
        self.form = (
            ROOT / ".github/ISSUE_TEMPLATE/channel-resolve.yml"
        ).read_text(encoding="utf-8")

    def test_form_matches_lookup_parser(self):
        fields = re.findall(
            r"^    id: ([a-z_]+)$", self.form, re.MULTILINE
        )
        labels = re.findall(
            r"^      label: (.+)$", self.form, re.MULTILINE
        )
        confirmations = re.findall(
            r"^        - label: (.+)$", self.form, re.MULTILINE
        )
        self.assertEqual(fields, ["channels", "confirmation"])
        self.assertEqual(labels, ["Channels", "Confirmation"])
        self.assertEqual(confirmations, [m.RESOLUTION_CONFIRMATION])
        self.assertIn('title: "' + m.RESOLUTION_TITLE + '"', self.form)
        self.assertNotIn("      render:", self.form)

        body = (
            "### " + labels[0] + "\n\n@Example"
            "\n\n### " + labels[1]
            + "\n\n- [x] " + confirmations[0]
        )
        self.assertEqual(
            m.parse_resolution_request(body),
            (("handle", "@Example"),),
        )

    def test_lookup_is_separate_from_addition_forms(self):
        bulk_form = (
            ROOT / ".github/ISSUE_TEMPLATE/channel-bulk-add.yml"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'title: "[MyTube] Channel change"', bulk_form
        )
        self.assertNotEqual(
            m.RESOLUTION_TITLE, "[MyTube] Channel change"
        )
        self.assertIn(
            "Resolution does not approve or add channels.", self.form
        )

    def test_existing_writer_does_not_accept_resolution_title(self):
        workflow = (
            ROOT / ".github/workflows/channel-change.yml"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "github.event.issue.title == '[MyTube] Channel change'",
            workflow,
        )
        self.assertNotIn(m.RESOLUTION_TITLE, workflow)


if __name__ == "__main__":
    unittest.main()