"""Resolution authorization checks; no network, credentials or writes."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_authorization_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ChannelResolutionAuthorizationTests(unittest.TestCase):
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
                "body": (
                    "### Channels\n\n@Example"
                    "\n\n### Confirmation\n\n- [x] "
                    + m.RESOLUTION_CONFIRMATION
                ),
            },
        }

    def test_owner_resolution_allowed(self):
        self.assertEqual(
            m.authorize_resolution_event(self.event()),
            (7, (("handle", "@Example"),)),
        )

    def test_fixed_owner_identity_required_everywhere(self):
        for target in ["sender", "owner", "author"]:
            for changes in [
                {"id": 999},
                {"id": "42029941"},
                {"id": True},
                {"login": "another-user"},
                {"type": "Organization"},
            ]:
                event = self.event()
                user = {
                    "sender": event["sender"],
                    "owner": event["repository"]["owner"],
                    "author": event["issue"]["user"],
                }[target]
                user.update(changes)
                with self.subTest(target=target, changes=changes):
                    with self.assertRaises(ValueError):
                        m.authorize_resolution_event(event)

    def test_repository_and_issue_boundaries(self):
        mutations = [
            lambda e: e["repository"].update(full_name="someone/Apps"),
            lambda e: e["repository"].update(default_branch="other"),
            lambda e: e.update(action="edited"),
            lambda e: e["issue"].update(state="closed"),
            lambda e: e["issue"].update(title="[MyTube] Channel change"),
            lambda e: e["issue"].update(pull_request={}),
            lambda e: e["issue"].update(number=True),
            lambda e: e["issue"].update(number=0),
        ]
        for mutate in mutations:
            event = self.event()
            mutate(event)
            with self.subTest(mutation=mutate):
                with self.assertRaises(ValueError):
                    m.authorize_resolution_event(event)

    def test_missing_fields_fail_closed(self):
        for event in [
            None, {}, {"action": "opened"},
            {**self.event(), "sender": None},
            {**self.event(), "repository": []},
        ]:
            with self.assertRaises(ValueError):
                m.authorize_resolution_event(event)

    def test_valid_author_does_not_bypass_form_validation(self):
        for body in [
            "untrusted text",
            self.event()["issue"]["body"].replace("[x]", "[ ]"),
            self.event()["issue"]["body"].replace("@Example", "@bad/extra"),
        ]:
            event = self.event()
            event["issue"]["body"] = body
            with self.assertRaises(ValueError):
                m.authorize_resolution_event(event)


if __name__ == "__main__":
    unittest.main()