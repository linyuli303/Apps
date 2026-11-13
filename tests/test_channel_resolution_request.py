"""Resolution Issue parsing only; no authorization, network or writes."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_request_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CID = "UC" + "a" * 22


def body(values=None):
    if values is None:
        values = ["@Example", CID]
    return (
        "### Channels\n\n" + "\n".join(values)
        + "\n\n### Confirmation\n\n- [x] "
        + m.RESOLUTION_CONFIRMATION
    )


class ChannelResolutionRequestTests(unittest.TestCase):
    def test_valid_mixed_inputs_and_crlf(self):
        expected = (("handle", "@Example"), ("id", CID))
        self.assertEqual(m.parse_resolution_request(body()), expected)
        self.assertEqual(
            m.parse_resolution_request(body().replace("\n", "\r\n")),
            expected,
        )
        self.assertEqual(
            m.parse_resolution_request(body([
                "https://www.youtube.com/@Example",
                "https://www.youtube.com/channel/" + CID,
            ])),
            expected,
        )

    def test_lookup_duplicates_preserved_for_identity_review(self):
        self.assertEqual(
            m.parse_resolution_request(body(["@Example", "@Example"])),
            (("handle", "@Example"), ("handle", "@Example")),
        )
        self.assertEqual(
            len(m.parse_resolution_request(body(["@Example"] * 50))),
            50,
        )

    def test_confirmation_and_exact_form_required(self):
        valid = body()
        for value in [
            None,
            "x" * 16001,
            valid.replace("[x]", "[ ]"),
            valid.replace(m.RESOLUTION_CONFIRMATION, "I approve"),
            valid + "\n### Extra\ntext",
            valid + "\n" + valid,
            valid.replace("### Channels", "### Channel IDs"),
        ]:
            with self.subTest(value=str(value)[:80]):
                with self.assertRaises(ValueError):
                    m.parse_resolution_request(value)

    def test_invalid_or_oversized_batches_rejected(self):
        for values in [
            [],
            ["@Example", "", CID],
            ["Example channel name"],
            ["@bad/extra"],
            ["https://youtube.com/@Example?token=private"],
            ["```", "@Example", "```"],
            ["- @Example"],
            ["@Example"] * 51,
        ]:
            with self.subTest(values=str(values)[:80]):
                with self.assertRaises(ValueError):
                    m.parse_resolution_request(body(values))


if __name__ == "__main__":
    unittest.main()