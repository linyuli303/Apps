"""Runner integration with fake clients; no secrets or network."""
import copy
import importlib.util
from pathlib import Path
import sys
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


resolution = load("runner_resolution_helpers", "channel_resolution.py")
with patch.dict(sys.modules, {"channel_resolution": resolution}):
    runner = load("resolution_runner_tests", "resolve_channel_request.py")


class ChannelResolutionRunnerTests(unittest.TestCase):
    def context(self):
        return {
            "GITHUB_REPOSITORY": "linyuli303/Apps",
            "GITHUB_REPOSITORY_OWNER_ID": "42029941",
            "GITHUB_ACTOR_ID": "42029941",
            "GITHUB_TRIGGERING_ACTOR": "linyuli303",
            "GITHUB_EVENT_NAME": "issues",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": (
                "linyuli303/Apps/.github/workflows/"
                "channel-resolve.yml@refs/heads/main"
            ),
            "GITHUB_SHA": "a" * 40,
            "GITHUB_WORKFLOW_SHA": "b" * 40,
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
        }

    def event(self):
        user = {
            "id": 42029941, "login": "linyuli303", "type": "User"
        }
        return {
            "action": "opened",
            "repository": {
                "full_name": "linyuli303/Apps",
                "default_branch": "main",
                "owner": dict(user),
            },
            "sender": dict(user),
            "issue": {
                "number": 7, "state": "open",
                "title": resolution.RESOLUTION_TITLE,
                "user": dict(user),
                "updated_at": "2026-11-13T12:00:00Z",
                "body": (
                    "### Channels\n\n@Example"
                    "\n\n### Confirmation\n\n- [x] "
                    + resolution.RESOLUTION_CONFIRMATION
                ),
            },
        }

    def test_success_returns_advisory_report_and_exact_id_link(self):
        event = self.event()
        calls = []
        cid = "UC" + "c" * 22

        def get_issue(number):
            calls.append("issue")
            return copy.deepcopy(event["issue"])

        def request(params):
            calls.append("youtube")
            return {"items": [{
                "id": cid, "snippet": {"title": "Sample channel"}
            }]}

        report = runner.prepare_review(
            self.context(), event, get_issue, request
        )
        self.assertEqual(calls, ["issue", "youtube", "issue"])
        self.assertIn("No channels have been added", report)
        self.assertIn("Sample channel", report)
        self.assertIn(cid, report)
        self.assertIn("channel-bulk-add.yml", report)
        self.assertIn("Workflow run: 123", report)
        self.assertNotIn("confirmation=", report)

    def test_invalid_context_or_owner_prevents_client_calls(self):
        calls = []
        context = self.context()
        context["GITHUB_REF"] = "refs/heads/feature"
        with self.assertRaises(ValueError):
            runner.prepare_review(
                context, self.event(),
                lambda number: calls.append("issue"),
                lambda params: calls.append("youtube"),
            )
        self.assertEqual(calls, [])

        event = self.event()
        event["sender"]["id"] = 999
        with self.assertRaises(ValueError):
            runner.prepare_review(
                self.context(), event,
                lambda number: calls.append("issue"),
                lambda params: calls.append("youtube"),
            )
        self.assertEqual(calls, [])

    def test_failed_lookup_returns_no_review(self):
        event = self.event()
        with self.assertRaises(ValueError):
            runner.prepare_review(
                self.context(), event,
                lambda number: copy.deepcopy(event["issue"]),
                lambda params: {"items": []},
            )


if __name__ == "__main__":
    unittest.main()