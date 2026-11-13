"""Live-Issue binding with fake snapshots; no API calls or secrets."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_live_issue_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ChannelResolutionLiveIssueTests(unittest.TestCase):
    def event(self):
        user = {
            "id": 42029941,
            "login": "linyuli303",
            "type": "User",
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
                "number": 7,
                "state": "open",
                "title": m.RESOLUTION_TITLE,
                "user": dict(user),
                "updated_at": "2026-11-13T12:00:00Z",
                "body": (
                    "### Channels\n\n@Example"
                    "\n\n### Confirmation\n\n- [x] "
                    + m.RESOLUTION_CONFIRMATION
                ),
            },
        }

    def test_unchanged_live_issue_allowed_without_mutation(self):
        event = self.event()
        original = copy.deepcopy(event)
        live = copy.deepcopy(event["issue"])
        self.assertEqual(
            m.verify_resolution_live_issue(event, live),
            (7, (("handle", "@Example"),)),
        )
        self.assertEqual(event, original)
        self.assertEqual(live, original["issue"])

    def test_changed_content_revision_or_identity_rejected(self):
        mutations = [
            lambda issue: issue.update(number=8),
            lambda issue: issue.update(state="closed"),
            lambda issue: issue.update(title="[MyTube] Channel change"),
            lambda issue: issue.update(
                body=issue["body"].replace("@Example", "@Other")
            ),
            # Even semantically equivalent edits require a new request.
            lambda issue: issue.update(body=issue["body"] + "\n"),
            lambda issue: issue.update(
                updated_at="2026-11-13T12:00:01Z"
            ),
            lambda issue: issue["user"].update(id=999),
            lambda issue: issue.update(pull_request={}),
        ]
        for mutate in mutations:
            event = self.event()
            live = copy.deepcopy(event["issue"])
            mutate(live)
            with self.subTest(mutation=mutate):
                with self.assertRaises(ValueError):
                    m.verify_resolution_live_issue(event, live)

    def test_missing_revisions_and_malformed_live_issues_rejected(self):
        for revision in [None, "", 42, "not-a-revision"]:
            event = self.event()
            event["issue"]["updated_at"] = revision
            with self.assertRaises(ValueError):
                m.verify_resolution_live_issue(
                    event, copy.deepcopy(event["issue"])
                )
        for live in [None, [], {}, "issue"]:
            with self.assertRaises(ValueError):
                m.verify_resolution_live_issue(self.event(), live)

    def test_matching_live_issue_cannot_bypass_event_authorization(self):
        event = self.event()
        event["sender"]["id"] = 999
        with self.assertRaises(ValueError):
            m.verify_resolution_live_issue(
                event, copy.deepcopy(event["issue"])
            )


if __name__ == "__main__":
    unittest.main()