"""Read-only owner-resolution orchestration; fake clients only."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_operation_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CID = "UC" + "a" * 22


def event():
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


class ChannelResolutionOperationTests(unittest.TestCase):
    def test_checks_before_and_after_lookup_without_mutation(self):
        submitted = event()
        original = copy.deepcopy(submitted)
        calls = []

        def get_issue(number):
            self.assertEqual(number, 7)
            calls.append("issue")
            return copy.deepcopy(submitted["issue"])

        def request(params):
            calls.append("youtube")
            self.assertEqual(params["forHandle"], "@Example")
            return {"items": [{
                "id": CID, "snippet": {"title": "Sample channel"}
            }]}

        result = m.resolve_owner_request(submitted, get_issue, request)
        self.assertEqual(calls, ["issue", "youtube", "issue"])
        self.assertEqual(result["issue_number"], 7)
        self.assertEqual(result["rows"][0]["id"], CID)
        self.assertEqual(submitted, original)
        self.assertNotIn("approved", result)

    def test_unauthorized_or_preedited_request_never_looks_up(self):
        submitted = event()
        submitted["sender"]["id"] = 999
        calls = []

        with self.assertRaises(ValueError):
            m.resolve_owner_request(
                submitted,
                lambda number: calls.append("issue"),
                lambda params: calls.append("youtube"),
            )
        self.assertEqual(calls, [])

        submitted = event()
        changed = copy.deepcopy(submitted["issue"])
        changed["updated_at"] = "2026-11-13T12:00:01Z"
        with self.assertRaises(ValueError):
            m.resolve_owner_request(
                submitted,
                lambda number: changed,
                lambda params: calls.append("youtube"),
            )
        self.assertEqual(calls, [])

    def test_edit_during_lookup_rejects_results(self):
        submitted = event()
        live = copy.deepcopy(submitted["issue"])
        calls = []

        def request(params):
            calls.append("youtube")
            live["body"] = live["body"].replace("@Example", "@Other")
            live["updated_at"] = "2026-11-13T12:00:01Z"
            return {"items": [{
                "id": CID, "snippet": {"title": "Sample channel"}
            }]}

        with self.assertRaises(ValueError):
            m.resolve_owner_request(
                submitted, lambda number: copy.deepcopy(live), request
            )
        self.assertEqual(calls, ["youtube"])

    def test_recheck_failure_exposes_no_raw_error(self):
        submitted = event()
        reads = 0

        def get_issue(number):
            nonlocal reads
            reads += 1
            if reads == 2:
                raise RuntimeError("PRIVATE TOKEN DETAILS")
            return copy.deepcopy(submitted["issue"])

        with self.assertRaisesRegex(
            ValueError, "^Resolution Issue could not be rechecked$"
        ):
            m.resolve_owner_request(
                submitted,
                get_issue,
                lambda params: {"items": [{
                    "id": CID, "snippet": {"title": "Sample channel"}
                }]},
            )


if __name__ == "__main__":
    unittest.main()