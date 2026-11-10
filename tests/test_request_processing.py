import base64
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("process_channel_request", ROOT / "scripts/process_channel_request.py")
m = importlib.util.module_from_spec(spec)
with patch.object(sys, "path", [str(ROOT / "scripts")] + sys.path):
    spec.loader.exec_module(m)
A = "UC" + "a" * 22
CONFIRM = "I reviewed this channel ID and want to change the shared whitelist on all devices."

class RequestProcessingTests(unittest.TestCase):
    def event(self):
        user = {"login": "linyuli303", "id": 42029941, "type": "User"}
        return {"action": "opened", "repository": {"full_name": "linyuli303/MyTube", "default_branch": "main", "owner": dict(user)},
                "sender": dict(user), "issue": {"number": 9, "state": "open", "user": dict(user),
                "title": "[MyTube] Channel change", "updated_at": "2026-11-10T00:00:00Z",
                "body": f"### Operation\n\nAdd\n\n### Channel ID\n\n{A}\n\n### Confirmation\n\n- [x] {CONFIRM}"}}
    def transport(self, event, config=None, edited=False, conflict=False):
        calls = []
        def call(method, path, payload=None):
            calls.append((method, path, payload))
            if path.endswith("/issues/9"):
                live = copy.deepcopy(event["issue"])
                if edited: live["updated_at"] = "changed"
                return live
            if method == "GET":
                return {"type": "file", "path": "channels.json", "encoding": "base64", "sha": "file-version", "content": base64.b64encode(json.dumps(config or {"channels": []}).encode()).decode()}
            if method == "PUT" and conflict: raise RuntimeError("Conflict")
        return call, calls
    def test_only_whitelist_written_and_publish_dispatched(self):
        event = self.event(); call, calls = self.transport(event)
        m.process(event, call)
        writes = [x for x in calls if x[0] == "PUT"]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0][1], "/repos/linyuli303/MyTube/contents/channels.json")
        self.assertEqual(writes[0][2]["sha"], "file-version")
        self.assertEqual(calls[-1][1], "/repos/linyuli303/MyTube/actions/workflows/publish.yml/dispatches")
    def test_edited_issue_rejected_before_write(self):
        event = self.event(); call, calls = self.transport(event, edited=True)
        with self.assertRaises(ValueError): m.process(event, call)
        self.assertTrue(all(x[0] == "GET" for x in calls))
    def test_wrong_numeric_owner_rejected_before_api(self):
        event = self.event()
        for user in [event["sender"], event["issue"]["user"], event["repository"]["owner"]]: user["id"] = 123
        call, calls = self.transport(event)
        with self.assertRaises(ValueError): m.process(event, call)
        self.assertEqual(calls, [])
    def test_conflicting_change_does_not_dispatch(self):
        event = self.event(); call, calls = self.transport(event, conflict=True)
        with self.assertRaises(RuntimeError): m.process(event, call)
        self.assertFalse(any(x[0] == "POST" for x in calls))
    def test_noop_still_dispatches_for_recovery(self):
        event = self.event(); call, calls = self.transport(event, {"channels": [{"id": A}]})
        m.process(event, call)
        self.assertFalse(any(x[0] == "PUT" for x in calls))
        self.assertEqual(calls[-1][0], "POST")

if __name__ == "__main__": unittest.main()
