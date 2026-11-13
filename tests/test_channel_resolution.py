"""Offline input normalization checks."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "channel_resolution_test_module",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CID = "UC" + "a" * 22


class ChannelResolutionInputTests(unittest.TestCase):
    def test_ids_and_handles(self):
        self.assertEqual(m.normalize_channel_input(CID), ("id", CID))
        self.assertEqual(
            m.normalize_channel_input(" @Example.Channel-1\t"),
            ("handle", "@Example.Channel-1"),
        )

    def test_supported_plain_urls(self):
        for host in [
            "youtube.com", "www.youtube.com",
            "m.youtube.com", "music.youtube.com",
        ]:
            for suffix in ["", "/"]:
                self.assertEqual(
                    m.normalize_channel_input(
                        "https://" + host + "/channel/" + CID + suffix
                    ), ("id", CID),
                )
                self.assertEqual(
                    m.normalize_channel_input(
                        "https://" + host + "/@Example" + suffix
                    ), ("handle", "@Example"),
                )

    def test_unsafe_and_unsupported_inputs_rejected(self):
        for value in [
            None, 42, "", "Example channel", "@ab",
            "@" + "a" * 31, "@example/extra", "@例子频道",
            CID + "\n", CID + "\x7f",
            "http://youtube.com/@" + "Example",
            "https://user@youtube.com/@Example",
            "https://youtube.com:443/@Example",
            "https://youtube.com.evil.example/@Example",
            "https://youtube.com/@Example?token=private",
            "https://youtube.com/@Example#fragment",
            "https://youtube.com/%40Example",
            "https://youtube.com/@Example/videos",
            "https://youtube.com/watch?v=example",
            "https://youtube.com/playlist?list=example",
            "x" * 241,
        ]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    m.normalize_channel_input(value)

    def test_batch_limits_and_detachment(self):
        source = [CID, "@Example", CID]
        result = m.normalize_channel_batch(source)
        self.assertEqual(result, (
            ("id", CID), ("handle", "@Example"), ("id", CID),
        ))
        source[0] = "changed"
        self.assertEqual(result[0], ("id", CID))
        self.assertEqual(len(m.normalize_channel_batch([CID] * 50)), 50)
        for value in [None, [], [CID] * 51, [CID, "@invalid/extra"]]:
            with self.assertRaises(ValueError):
                m.normalize_channel_batch(value)


if __name__ == "__main__":
    unittest.main()