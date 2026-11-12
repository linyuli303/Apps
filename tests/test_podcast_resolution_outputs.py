"""Offline resolver CLI output tests. No network or GitHub writes."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_resolution as resolution


class ResolutionOutputTests(unittest.TestCase):
    def invoke(self, status):
        with tempfile.TemporaryDirectory() as temp:
            event = Path(temp) / "event.json"
            output = Path(temp) / "output.txt"
            event.write_text("{}", encoding="utf-8")
            envelope = {"result": {"status": status}}
            env = {
                "GITHUB_EVENT_PATH": str(event),
                "GITHUB_OUTPUT": str(output),
            }
            with patch.dict(os.environ, env), \
                    patch.object(resolution, "prepare", return_value=envelope), \
                    patch.object(resolution, "review_feedback", return_value=""), \
                    patch("podcast_onboarding.resolve") as resolver, \
                    patch("builtins.print"):
                if status == "unexpected":
                    with self.assertRaisesRegex(
                        ValueError, "^Unexpected resolution status$"
                    ):
                        resolution.main()
                    self.assertFalse(output.exists())
                    resolver.assert_not_called()
                    return

                resolution.main()
                resolver.assert_not_called()

            lines = output.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 2)
            self.assertTrue(lines[0].startswith("resolution="))
            self.assertEqual(
                resolution.decode(lines[0].split("=", 1)[1]), envelope
            )
            self.assertEqual(lines[1], "status=" + status)

    def test_supported_statuses_emit_matching_envelope_and_status(self):
        for status in (
            "ready", "already_subscribed", "approval_required",
            "review_required", "remove",
        ):
            with self.subTest(status=status):
                self.invoke(status)

    def test_unknown_status_writes_no_outputs(self):
        self.invoke("unexpected")
