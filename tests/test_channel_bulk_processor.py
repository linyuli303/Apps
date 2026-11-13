"""Owner channel processor checks with fake GitHub responses."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "scripts" / filename
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validation = load_module("bulk_processor_validation", "channel_request.py")
with patch.dict(sys.modules, {"channel_request": validation}):
    processor = load_module(
        "bulk_processor_under_test", "process_channel_request.py"
    )


def cid(number):
    return "UC" + str(number).zfill(22)


def bulk_body(ids):
    return (
        "### Operation\n\nAdd multiple\n\n### Channel IDs\n\n"
        + "\n".join(ids)
        + "\n\n### Confirmation\n\n- [x] "
        + validation.BULK_CONFIRMATION
    )


def event_for(body):
    user = {"login": "linyuli303", "id": 42029941, "type": "User"}
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
            "title": "[MyTube] Channel change",
            "user": dict(user),
            "body": body,
            "updated_at": "2026-11-13T12:00:00Z",
        },
    }


class FakeGitHub:
    def __init__(self, event, config, fail_write=False):
        self.live = copy.deepcopy(event["issue"])
        self.config = copy.deepcopy(config)
        self.fail_write = fail_write
        self.calls = []

    def __call__(self, method, path, payload=None):
        self.calls.append((method, path, copy.deepcopy(payload)))
        prefix = "/repos/linyuli303/Apps"

        if method == "GET" and path == prefix + "/issues/7":
            return copy.deepcopy(self.live)

        if method == "GET" and path == (
            prefix + "/contents/channels.json?ref=main"
        ):
            raw = json.dumps(self.config).encode("utf-8")
            return {
                "type": "file",
                "path": "channels.json",
                "encoding": "base64",
                "content": base64.b64encode(raw).decode("ascii"),
                "sha": "a" * 40,
            }

        if method == "PUT" and path == prefix + "/contents/channels.json":
            if self.fail_write:
                raise RuntimeError("Simulated concurrent-write failure")
            return {}

        if method == "POST" and path == (
            prefix + "/actions/workflows/publish.yml/dispatches"
        ):
            return None

        raise AssertionError("Unexpected API operation")

    def methods(self):
        return [method for method, _, _ in self.calls]


class ChannelBulkProcessorTests(unittest.TestCase):
    def test_batch_uses_one_sha_write_and_one_dispatch(self):
        event = event_for(bulk_body([cid(2), cid(1), cid(3)]))
        config = {
            "title": "MyTube",
            "max_videos_per_channel": 15,
            "channels": [{"id": cid(1)}],
        }
        fake = FakeGitHub(event, config)
        processor.process(event, call=fake)

        self.assertEqual(fake.methods(), ["GET", "GET", "PUT", "POST"])
        payload = fake.calls[2][2]
        updated = json.loads(base64.b64decode(payload["content"]))
        self.assertEqual(updated["channels"], [
            {"id": cid(1)}, {"id": cid(2)}, {"id": cid(3)}
        ])
        self.assertEqual(updated["title"], "MyTube")
        self.assertEqual(updated["max_videos_per_channel"], 15)
        self.assertEqual(payload["sha"], "a" * 40)
        self.assertEqual(payload["branch"], "main")
        self.assertEqual(fake.calls[3][2], {"ref": "main"})
        self.assertEqual(config["channels"], [{"id": cid(1)}])

    def test_noop_dispatches_once_without_write(self):
        event = event_for(bulk_body([cid(1)]))
        fake = FakeGitHub(event, {"channels": [{"id": cid(1)}]})
        processor.process(event, call=fake)
        self.assertEqual(fake.methods(), ["GET", "GET", "POST"])

    def test_live_issue_changes_stop_before_config_access(self):
        mutations = [
            lambda issue: issue.update(body=bulk_body([cid(3)])),
            lambda issue: issue.update(body=issue["body"] + "\n"),
            lambda issue: issue.update(updated_at="changed"),
            lambda issue: issue.update(state="closed"),
            lambda issue: issue["user"].update(id=999),
        ]
        for mutate in mutations:
            event = event_for(bulk_body([cid(2)]))
            fake = FakeGitHub(event, {"channels": []})
            mutate(fake.live)
            with self.subTest(mutation=mutate):
                with self.assertRaises(ValueError):
                    processor.process(event, call=fake)
                self.assertEqual(fake.methods(), ["GET"])

    def test_invalid_batch_and_unauthorized_event_make_no_calls(self):
        for invalid_body in [
            bulk_body([cid(2), cid(2)]),
            bulk_body(["@handle"]),
            bulk_body([cid(2)]).replace("[x]", "[ ]"),
        ]:
            event = event_for(invalid_body)
            fake = FakeGitHub(event, {"channels": []})
            with self.assertRaises(ValueError):
                processor.process(event, call=fake)
            self.assertEqual(fake.calls, [])

        event = event_for(bulk_body([cid(2)]))
        event["sender"]["id"] = 999
        fake = FakeGitHub(event, {"channels": []})
        with self.assertRaises(ValueError):
            processor.process(event, call=fake)
        self.assertEqual(fake.calls, [])

    def test_numeric_owner_pin_checked_before_network(self):
        event = event_for(bulk_body([cid(2)]))
        for user in [
            event["sender"],
            event["repository"]["owner"],
            event["issue"]["user"],
        ]:
            user["id"] = 12345
        fake = FakeGitHub(event, {"channels": []})
        with self.assertRaises(ValueError):
            processor.process(event, call=fake)
        self.assertEqual(fake.calls, [])

    def test_capacity_failure_produces_no_write_or_dispatch(self):
        event = event_for(bulk_body([cid(1000), cid(1001)]))
        config = {"channels": [{"id": cid(n)} for n in range(999)]}
        fake = FakeGitHub(event, config)
        with self.assertRaises(ValueError):
            processor.process(event, call=fake)
        self.assertEqual(fake.methods(), ["GET", "GET"])

    def test_failed_write_never_dispatches_publication(self):
        event = event_for(bulk_body([cid(2)]))
        fake = FakeGitHub(
            event, {"channels": []}, fail_write=True
        )
        with self.assertRaises(RuntimeError):
            processor.process(event, call=fake)
        self.assertEqual(fake.methods(), ["GET", "GET", "PUT"])

    def test_single_add_and_remove_remain_supported(self):
        for operation in ["Add", "Remove"]:
            body = (
                "### Operation\n\n" + operation
                + "\n\n### Channel ID\n\n" + cid(1)
                + "\n\n### Confirmation\n\n- [x] "
                + validation.CONFIRMATION
            )
            event = event_for(body)
            config = {
                "channels": [] if operation == "Add"
                else [{"id": cid(1)}]
            }
            fake = FakeGitHub(event, config)
            processor.process(event, call=fake)
            self.assertEqual(fake.methods(), ["GET", "GET", "PUT", "POST"])


if __name__ == "__main__":
    unittest.main()