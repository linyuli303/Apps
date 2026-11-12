import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "channel_request", Path(__file__).resolve().parents[1] / "scripts/channel_request.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
A, B = "UC" + "a" * 22, "UC" + "b" * 22

def body(operation="Add", cid=A):
    return f"### Operation\n\n{operation}\n\n### Channel ID\n\n{cid}\n\n### Confirmation\n\n- [x] {m.CONFIRMATION}"

class ChannelRequestTests(unittest.TestCase):
    def test_valid_form(self):
        for operation in ["Add", "Remove"]:
            self.assertEqual(m.parse_request(body(operation)), (operation, A))
            self.assertEqual(m.parse_request(body(operation).replace("\n", "\r\n")), (operation, A))
    def test_invalid_form_rejected(self):
        for value in [body(cid="@handle"), body(cid="https://www.youtube.com/channel/" + A),
                      body(operation="$(echo unsafe)"), body().replace("[x]", "[ ]"),
                      body() + "\n### Extra\ntext", body() + "\n" + body(), "x" * 4097, None]:
            with self.subTest(value=str(value)[:70]):
                with self.assertRaises(ValueError): m.parse_request(value)
    def test_add_preserves_settings_and_input(self):
        config = {"title": "My subscriptions", "max_videos_per_channel": 15, "channels": [{"id": A}]}
        result, changed = m.apply_change(config, "Add", B)
        self.assertTrue(changed)
        self.assertEqual(result["channels"], [{"id": A}, {"id": B}])
        self.assertEqual(result["title"], config["title"])
        self.assertEqual(result["max_videos_per_channel"], 15)
        self.assertEqual(config["channels"], [{"id": A}])
    def test_remove_only_requested_id(self):
        result, changed = m.apply_change({"channels": [{"id": A}, {"id": B}]}, "Remove", A)
        self.assertTrue(changed)
        self.assertEqual(result, {"channels": [{"id": B}]})
    def test_noop_is_idempotent(self):
        config = {"channels": [{"id": A}]}
        for operation, cid in [("Add", A), ("Remove", B)]:
            result, changed = m.apply_change(config, operation, cid)
            self.assertFalse(changed)
            self.assertEqual(result, config)
    def test_invalid_config_rejected(self):
        for config in [{"channels": [{"handle": "@test"}]}, {"channels": [{"id": A}, {"id": A}]},
                       {"channels": [], "unexpected": True}, {"channels": [], "max_videos_per_channel": True},
                       {"channels": [{"id": "invalid"}]}, {"channels": "invalid"}]:
            with self.assertRaises(ValueError): m.apply_change(config, "Add", B)
    def test_limit_enforced(self):
        config = {"channels": [{"id": "UC" + str(i).zfill(22)} for i in range(1000)]}
        with self.assertRaises(ValueError): m.apply_change(config, "Add", A)
    def test_invalid_operation_rejected(self):
        for operation, cid in [("Delete", A), ("Add", "bad"), ("Remove", None)]:
            with self.assertRaises(ValueError): m.apply_change({"channels": []}, operation, cid)


class ChannelAuthorizationTests(unittest.TestCase):
    def event(self):
        user = {"login": "linyuli303", "id": 12345, "type": "User"}
        return {
            "action": "opened",
            "repository": {"full_name": "linyuli303/Apps", "default_branch": "main", "owner": dict(user)},
            "sender": dict(user),
            "issue": {"number": 7, "state": "open", "title": "[MyTube] Channel change",
                      "user": dict(user), "body": body()},
        }
    def test_owner_request_allowed(self):
        self.assertEqual(m.authorize_event(self.event()), (7, "Add", A))
    def test_other_author_or_sender_rejected(self):
        for target in ["sender", "author"]:
            event = self.event()
            user = event["sender"] if target == "sender" else event["issue"]["user"]
            user["id"] = 999
            with self.assertRaises(ValueError): m.authorize_event(event)
    def test_wrong_repository_or_branch_rejected(self):
        for key, value in [("full_name", "someone/MyTube"), ("default_branch", "other")]:
            event = self.event(); event["repository"][key] = value
            with self.assertRaises(ValueError): m.authorize_event(event)
    def test_edits_and_closed_requests_rejected(self):
        event = self.event(); event["action"] = "edited"
        with self.assertRaises(ValueError): m.authorize_event(event)
        event = self.event(); event["issue"]["state"] = "closed"
        with self.assertRaises(ValueError): m.authorize_event(event)
    def test_pull_requests_and_bad_bodies_rejected(self):
        event = self.event(); event["issue"]["pull_request"] = {}
        with self.assertRaises(ValueError): m.authorize_event(event)
        event = self.event(); event["issue"]["body"] = "untrusted text"
        with self.assertRaises(ValueError): m.authorize_event(event)
    def test_missing_event_fields_rejected(self):
        for value in [None, {}, {"action": "opened"}]:
            with self.assertRaises(ValueError): m.authorize_event(value)

if __name__ == "__main__":
    unittest.main()
