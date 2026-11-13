"""Resolution orchestration using fake API responses; no secrets/network."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "channel_resolution_lookup_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

A = "UC" + "a" * 22
B = "UC" + "b" * 22


def response(cid=A, title="Sample channel"):
    return {
        "items": [{
            "id": cid,
            "snippet": {"title": title},
            "external_url": "https://untrusted.example/",
        }],
        "nextPageToken": "DO NOT FOLLOW",
    }


class ChannelResolutionLookupTests(unittest.TestCase):
    def test_fixed_parameters_and_resolved_duplicate_detection(self):
        calls = []

        def request(params):
            calls.append(dict(params))
            if params.get("forHandle") == "@Other":
                return response(B)
            return response(A)

        result = m.resolve_channel_batch(
            ["@Example", "@Alias", "@Example", A, "@Other"],
            request,
        )
        self.assertEqual(len(calls), 4)
        self.assertEqual(calls[0], {
            "part": "snippet", "maxResults": 1,
            "forHandle": "@Example",
        })
        self.assertEqual(calls[2], {
            "part": "snippet", "maxResults": 1, "id": A,
        })
        self.assertEqual(
            [row["duplicate"] for row in result],
            [False, True, True, True, False],
        )
        self.assertEqual(result[0]["url"],
                         "https://www.youtube.com/channel/" + A)
        self.assertNotIn("untrusted.example", str(result))
        self.assertNotIn("nextPageToken", str(result))

    def test_all_input_syntax_checked_before_any_lookup(self):
        calls = []
        with self.assertRaises(ValueError):
            m.resolve_channel_batch(
                ["@Example", "@bad/extra"],
                lambda params: calls.append(params),
            )
        self.assertEqual(calls, [])

    def test_invalid_or_unresolved_response_stops_batch(self):
        for invalid in [
            None, {}, {"items": []},
            {"items": [response()["items"][0]] * 2},
            {"items": [None]},
            response("bad"),
            response(A, ""),
            response(A, "bad\nname"),
            response(A, "x" * 301),
        ]:
            calls = []

            def request(params):
                calls.append(params)
                return invalid

            with self.subTest(response=invalid):
                with self.assertRaises(ValueError):
                    m.resolve_channel_batch(["@Example", "@Other"], request)
                self.assertEqual(len(calls), 1)

    def test_immutable_id_must_match_response(self):
        with self.assertRaises(ValueError):
            m.resolve_channel_batch([A], lambda params: response(B))

    def test_raw_errors_are_hidden_without_retries(self):
        calls = []

        def request(params):
            calls.append(params)
            raise RuntimeError("SECRET FIXTURE DETAILS")

        with self.assertRaisesRegex(ValueError, "^Channel lookup failed$"):
            m.resolve_channel_batch(["@Example"], request)
        self.assertEqual(len(calls), 1)

    def test_results_are_detached_and_unicode_titles_preserved(self):
        original = response(A, " 示例频道 ")
        result = m.resolve_channel_batch(["@Example"],
                                        lambda params: original)
        original["items"][0]["snippet"]["title"] = "Changed"
        self.assertEqual(result[0]["title"], "示例频道")
        self.assertEqual(set(result[0]), {
            "kind", "lookup", "id", "title", "url", "duplicate",
        })

    def test_maximum_batch_is_bounded(self):
        calls = []

        def request(params):
            calls.append(params)
            return response()

        values = ["@Demo" + str(i) for i in range(50)]
        result = m.resolve_channel_batch(values, request)
        self.assertEqual(len(calls), 50)
        self.assertEqual(len(result), 50)
        self.assertEqual(sum(not row["duplicate"] for row in result), 1)


if __name__ == "__main__":
    unittest.main()