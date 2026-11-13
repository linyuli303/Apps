"""Offline form/parser contract checks; not live GitHub rendering tests."""
import importlib.util
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "channel_bulk_form_validation",
    ROOT / "scripts/channel_request.py",
)
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


class ChannelBulkFormTests(unittest.TestCase):
    def setUp(self):
        self.form = (
            ROOT / ".github/ISSUE_TEMPLATE/channel-bulk-add.yml"
        ).read_text(encoding="utf-8")

    def test_form_fields_construct_a_parser_accepted_request(self):
        fields = re.findall(
            r"^    id: ([a-z_]+)$", self.form, re.MULTILINE
        )
        labels = re.findall(
            r"^      label: (.+)$", self.form, re.MULTILINE
        )
        self.assertEqual(
            fields, ["operation", "channel_ids", "confirmation"]
        )
        self.assertEqual(
            labels, ["Operation", "Channel IDs", "Confirmation"]
        )

        operations = re.findall(
            r"^        - (?!label:)(.+)$", self.form, re.MULTILINE
        )
        self.assertEqual(operations, ["Add multiple"])

        confirmations = re.findall(
            r"^        - label: (.+)$", self.form, re.MULTILINE
        )
        self.assertEqual(
            confirmations, [validation.BULK_CONFIRMATION]
        )
        self.assertIn('title: "[MyTube] Channel change"', self.form)
        self.assertNotIn("      render:", self.form)

        ids = ["UC" + "a" * 22, "UC" + "b" * 22]
        body = (
            "### " + labels[0] + "\n\n" + operations[0]
            + "\n\n### " + labels[1] + "\n\n" + "\n".join(ids)
            + "\n\n### " + labels[2]
            + "\n\n- [x] " + confirmations[0]
        )
        self.assertEqual(
            validation.parse_additions_request(body), tuple(ids)
        )

    def test_frontend_prefill_matches_form_fields(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        matches = re.findall(
            r"^function buildMyTubeBulkRequest\(.*?^\}",
            source, re.MULTILINE | re.DOTALL,
        )
        self.assertEqual(len(matches), 1)
        builder = matches[0]
        for text in (
            'template:"channel-bulk-add.yml"',
            'title:"[MyTube] Channel change"',
            'operation:"Add multiple"',
            "channel_ids:channelText",
        ):
            self.assertIn(text, builder)

    def test_existing_workflow_keeps_owner_gates_and_test_order(self):
        workflow = (
            ROOT / ".github/workflows/channel-change.yml"
        ).read_text(encoding="utf-8")
        for text in (
            "types: [opened]",
            "github.actor_id == '42029941'",
            "github.event.issue.user.id == 42029941",
            "github.event.repository.owner.id == 42029941",
            "github.event.issue.title == '[MyTube] Channel change'",
        ):
            self.assertIn(text, workflow)

        self.assertLess(
            workflow.index("python -m unittest discover -s tests -v"),
            workflow.index("python scripts/process_channel_request.py"),
        )


if __name__ == "__main__":
    unittest.main()