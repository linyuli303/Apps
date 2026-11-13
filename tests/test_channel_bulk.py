"""Pure bulk channel-addition checks; no network or writes."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "channel_request_bulk_tests", ROOT / "scripts/channel_request.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def cid(number):
    return "UC" + str(number).zfill(22)


class ChannelBulkTests(unittest.TestCase):
    def test_batch_preserves_order_settings_and_input(self):
        config = {
            "title": "MyTube",
            "max_videos_per_channel": 15,
            "channels": [{"id": cid(1)}],
        }
        original = copy.deepcopy(config)
        result, changed = m.apply_additions(
            config, [cid(3), cid(1), cid(2)]
        )
        self.assertTrue(changed)
        self.assertEqual(result["channels"], [
            {"id": cid(1)}, {"id": cid(3)}, {"id": cid(2)}
        ])
        self.assertEqual(result["title"], "MyTube")
        self.assertEqual(result["max_videos_per_channel"], 15)
        self.assertEqual(config, original)
        result["channels"][0]["id"] = cid(99)
        self.assertEqual(config, original)

    def test_existing_batch_is_idempotent(self):
        config = {"channels": [{"id": cid(1)}]}
        result, changed = m.apply_additions(config, [cid(1)])
        self.assertFalse(changed)
        self.assertEqual(result, config)
        self.assertIsNot(result, config)

    def test_invalid_batch_never_mutates_config(self):
        config = {"channels": [{"id": cid(1)}]}
        original = copy.deepcopy(config)
        for batch in [
            None, [], cid(2), (cid(2),),
            [cid(2), cid(2)],
            [cid(2), "invalid"],
            [cid(2), "@handle"],
            [cid(2), "https://www.youtube.com/channel/" + cid(3)],
            [cid(2), None],
            [cid(2), cid(3) + "\n"],
            [cid(n) for n in range(51)],
        ]:
            with self.subTest(batch=str(batch)[:80]):
                with self.assertRaises(ValueError):
                    m.apply_additions(config, batch)
                self.assertEqual(config, original)

    def test_fifty_entries_allowed(self):
        result, changed = m.apply_additions(
            {"channels": []}, [cid(n) for n in range(50)]
        )
        self.assertTrue(changed)
        self.assertEqual(len(result["channels"]), 50)

    def test_capacity_is_checked_for_the_whole_batch(self):
        config = {
            "channels": [{"id": cid(n)} for n in range(999)]
        }
        original = copy.deepcopy(config)

        with self.assertRaises(ValueError):
            m.apply_additions(config, [cid(1000), cid(1001)])
        self.assertEqual(config, original)

        result, changed = m.apply_additions(
            config, [cid(1), cid(1000)]
        )
        self.assertTrue(changed)
        self.assertEqual(len(result["channels"]), 1000)
        self.assertEqual(config, original)

        result, changed = m.apply_additions(result, [cid(1)])
        self.assertFalse(changed)
        self.assertEqual(len(result["channels"]), 1000)

    def test_invalid_configuration_rejected(self):
        for config in [
            {"channels": [{"id": "bad"}]},
            {"channels": [{"id": cid(1)}, {"id": cid(1)}]},
            {"channels": [], "unexpected": True},
            {"channels": [], "max_videos_per_channel": True},
        ]:
            with self.subTest(config=config):
                with self.assertRaises(ValueError):
                    m.apply_additions(config, [cid(2)])


class ChannelBulkParsingTests(unittest.TestCase):
    def body(self, ids=None):
        if ids is None:
            ids = [cid(1), cid(2)]
        return (
            "### Operation\n\nAdd multiple\n\n"
            "### Channel IDs\n\n" + "\n".join(ids) +
            "\n\n### Confirmation\n\n- [x] " + m.BULK_CONFIRMATION
        )

    def test_valid_batch_and_crlf(self):
        expected = (cid(1), cid(2))
        self.assertEqual(m.parse_additions_request(self.body()), expected)
        self.assertEqual(
            m.parse_additions_request(
                self.body().replace("\n", "\r\n")
            ), expected
        )

    def test_fifty_ids_and_surrounding_horizontal_space(self):
        ids = [cid(n) for n in range(50)]
        self.assertEqual(
            m.parse_additions_request(self.body(ids)), tuple(ids)
        )
        self.assertEqual(
            m.parse_additions_request(self.body([" " + cid(1) + "\t"])),
            (cid(1),)
        )

    def test_malformed_unconfirmed_or_extra_content_rejected(self):
        valid = self.body()
        for value in [
            None,
            "x" * 4097,
            valid.replace("[x]", "[ ]"),
            valid.replace("Add multiple", "Remove"),
            valid.replace("Add multiple", "Add"),
            valid + "\n### Extra\ntext",
            valid + "\n" + valid,
            valid.replace(m.BULK_CONFIRMATION, "I agree"),
        ]:
            with self.subTest(value=str(value)[:80]):
                with self.assertRaises(ValueError):
                    m.parse_additions_request(value)

    def test_invalid_ids_duplicates_and_oversized_batches_rejected(self):
        for ids in [
            [],
            [cid(1), cid(1)],
            [cid(1), "" , cid(2)],
            ["@handle"],
            ["https://www.youtube.com/channel/" + cid(1)],
            [cid(1) + ", " + cid(2)],
            ["```", cid(1), "```"],
            [cid(n) for n in range(51)],
        ]:
            with self.subTest(ids=str(ids)[:80]):
                with self.assertRaises(ValueError):
                    m.parse_additions_request(self.body(ids))

    def test_single_request_parser_still_rejects_bulk_form(self):
        with self.assertRaises(ValueError):
            m.parse_request(self.body())


class ChannelBulkAuthorizationTests(unittest.TestCase):
    def event(self):
        user = {
            "login": "linyuli303",
            "id": 42029941,
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
                "title": "[MyTube] Channel change",
                "user": dict(user),
                "body": ChannelBulkParsingTests().body(),
            },
        }

    def test_bulk_owner_request_allowed(self):
        self.assertEqual(
            m.authorize_event(self.event(), bulk=True),
            (7, "Add multiple", (cid(1), cid(2))),
        )

    def test_bulk_requires_explicit_trusted_mode(self):
        with self.assertRaises(ValueError):
            m.authorize_event(self.event())
        with self.assertRaises(ValueError):
            m.authorize_event(self.event(), bulk="true")

    def test_wrong_identity_repository_and_request_state_rejected(self):
        mutations = [
            lambda e: e["sender"].update(id=999),
            lambda e: e["issue"]["user"].update(id=999),
            lambda e: e["sender"].update(login="another-user"),
            lambda e: e["repository"]["owner"].update(type="Organization"),
            lambda e: e["repository"].update(full_name="someone/Apps"),
            lambda e: e["repository"].update(default_branch="other"),
            lambda e: e.update(action="edited"),
            lambda e: e["issue"].update(state="closed"),
            lambda e: e["issue"].update(title="[MyTube] Other"),
            lambda e: e["issue"].update(pull_request={}),
        ]
        for mutate in mutations:
            event = self.event()
            mutate(event)
            with self.subTest(event=event):
                with self.assertRaises(ValueError):
                    m.authorize_event(event, bulk=True)

    def test_confirmation_and_batch_validation_still_required(self):
        for body in [
            ChannelBulkParsingTests().body().replace("[x]", "[ ]"),
            ChannelBulkParsingTests().body([cid(1), cid(1)]),
            ChannelBulkParsingTests().body(["@handle"]),
        ]:
            event = self.event()
            event["issue"]["body"] = body
            with self.subTest(body=body):
                with self.assertRaises(ValueError):
                    m.authorize_event(event, bulk=True)


if __name__ == "__main__":
    unittest.main()