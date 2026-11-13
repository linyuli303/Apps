"""Runner entry-point boundaries; fake credentials, no network."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "scripts" / filename
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


helpers = load("runner_main_helpers", "channel_resolution.py")
with patch.dict(sys.modules, {"channel_resolution": helpers}):
    runner = load("runner_main_under_test", "resolve_channel_request.py")


class ChannelResolutionRunnerMainTests(unittest.TestCase):
    def execute(self, output, event, *, valid_context=True, prepare=None):
        environment = {
            "GITHUB_EVENT_PATH": str(event),
            "GH_TOKEN": "FAKE_TOKEN",
            "YOUTUBE_API_KEY": "FAKE_KEY",
        }
        log = io.StringIO()
        context_error = None if valid_context else ValueError("Rejected")

        with (
            patch.object(sys, "argv", [
                "resolve_channel_request.py", "--output", str(output)
            ]),
            patch.dict(runner.os.environ, environment, clear=True),
            patch.object(
                runner, "validate_resolution_runner",
                side_effect=context_error,
                return_value={},
            ),
            patch.object(
                runner, "authorize_resolution_event"
            ) as authorize,
            patch.object(
                runner, "prepare_review",
                side_effect=prepare,
                return_value="Advisory review\n",
            ) as review,
            patch.object(
                runner, "read_resolution_issue"
            ) as github,
            patch.object(
                runner, "request_channel_identity"
            ) as youtube,
            contextlib.redirect_stdout(log),
        ):
            result = runner.main()

        github.assert_not_called()
        youtube.assert_not_called()
        return result, log.getvalue(), authorize, review

    def test_success_writes_only_requested_advisory_file(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            event = folder / "event.json"
            event.write_text("{}", encoding="utf-8")
            output = folder / "review.txt"

            result, log, authorize, review = self.execute(output, event)
            self.assertEqual(result, 0)
            authorize.assert_called_once_with({})
            review.assert_called_once()
            self.assertEqual(
                output.read_text(encoding="utf-8"), "Advisory review\n"
            )
            self.assertEqual(
                {p.name for p in folder.iterdir()},
                {"event.json", "review.txt"},
            )
            self.assertNotIn("FAKE_TOKEN", log)
            self.assertNotIn("FAKE_KEY", log)

    def test_existing_or_unsafe_output_rejected_before_event_processing(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            event = folder / "event.json"
            event.write_text("{}", encoding="utf-8")
            existing = folder / "existing.txt"
            existing.write_text("Keep this", encoding="utf-8")

            for output in [
                existing,
                folder / "review.html",
                folder / "missing" / "review.txt",
                ROOT / "channel-resolution-output-must-not-exist.txt",
            ]:
                with self.subTest(output=output):
                    result, _, authorize, review = self.execute(output, event)
                    self.assertEqual(result, 1)
                    authorize.assert_not_called()
                    review.assert_not_called()

            self.assertEqual(
                existing.read_text(encoding="utf-8"), "Keep this"
            )

    def test_bad_context_and_malformed_events_produce_no_report(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            event = folder / "event.json"
            output = folder / "review.txt"

            # Invalid context must stop before opening the missing event file.
            result, _, authorize, review = self.execute(
                output, event, valid_context=False
            )
            self.assertEqual(result, 1)
            authorize.assert_not_called()
            review.assert_not_called()
            self.assertFalse(output.exists())

            for raw in [b"{", b"\xff", b"x" * 262145]:
                event.write_bytes(raw)
                result, _, authorize, review = self.execute(output, event)
                self.assertEqual(result, 1)
                authorize.assert_not_called()
                review.assert_not_called()
                self.assertFalse(output.exists())

    def test_resolution_failure_hides_raw_error_and_writes_no_report(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            event = folder / "event.json"
            event.write_text(json.dumps({}), encoding="utf-8")
            output = folder / "review.txt"

            result, log, _, review = self.execute(
                output, event,
                prepare=RuntimeError(
                    "PRIVATE FAKE_KEY FAKE_TOKEN provider details"
                ),
            )
            self.assertEqual(result, 1)
            review.assert_called_once()
            self.assertFalse(output.exists())
            for forbidden in ["PRIVATE", "FAKE_KEY", "FAKE_TOKEN"]:
                self.assertNotIn(forbidden, log)


if __name__ == "__main__":
    unittest.main()