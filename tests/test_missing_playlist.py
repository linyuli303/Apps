import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location(
    "feed_missing_playlist",
    Path(__file__).resolve().parents[1] / "scripts/build_feed.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

A = "UC" + "a" * 22
B = "UC" + "b" * 22


class MissingPlaylistTests(unittest.TestCase):
    def test_missing_playlist_keeps_channel_and_continues(self):
        playlist_calls = []

        def request(resource, params, key):
            if resource == "channels":
                cid = params["id"]
                return {
                    "items": [{
                        "id": cid,
                        "snippet": {"title": "Approved"},
                        "contentDetails": {
                            "relatedPlaylists": {"uploads": "UU" + cid[2:]}
                        },
                    }]
                }
            if resource == "playlistItems":
                playlist_calls.append(params["playlistId"])
                if params["playlistId"] == "UU" + A[2:]:
                    raise m.UploadsPlaylistNotFound("Uploads playlist not found")
                return {"items": []}
            self.fail("Unexpected API operation")

        with patch("sys.stdout", new_callable=io.StringIO) as output:
            result = m.build(
                {"channels": [{"id": A}, {"id": B}]},
                "fake-test-key",
                request,
            )

        self.assertEqual([c["id"] for c in result["channels"]], [A, B])
        self.assertEqual(result["videos"], [])
        self.assertEqual(playlist_calls, ["UU" + A[2:], "UU" + B[2:]])
        self.assertIn("Warning: uploads playlist unavailable", output.getvalue())
        self.assertNotIn("fake-test-key", output.getvalue())

    def test_other_playlist_failure_still_stops_build(self):
        def request(resource, params, key):
            if resource == "channels":
                return {
                    "items": [{
                        "id": A,
                        "snippet": {"title": "Approved"},
                        "contentDetails": {
                            "relatedPlaylists": {"uploads": "UU" + A[2:]}
                        },
                    }]
                }
            raise RuntimeError("Simulated unrelated API failure")

        with patch("sys.stdout", new_callable=io.StringIO):
            with self.assertRaisesRegex(
                RuntimeError, "Simulated unrelated API failure"
            ):
                m.build({"channels": [{"id": A}]}, "fake-test-key", request)

    def call_api_with_error(self, resource, status, body):
        error = urllib.error.HTTPError(
            "https://www.googleapis.com/youtube/v3/" + resource,
            status,
            "Simulated HTTP error",
            {},
            io.BytesIO(body),
        )
        with patch.object(m.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = error
            return m.api(resource, {}, "fake-test-key")

    def test_exact_missing_playlist_error_is_classified(self):
        body = json.dumps({
            "error": {"errors": [{"reason": "playlistNotFound"}]}
        }).encode("utf-8")

        with self.assertRaises(m.UploadsPlaylistNotFound):
            self.call_api_with_error("playlistItems", 404, body)

    def test_other_errors_are_not_classified_as_missing_playlist(self):
        missing = json.dumps({
            "error": {"errors": [{"reason": "playlistNotFound"}]}
        }).encode("utf-8")
        other = json.dumps({
            "error": {"errors": [{"reason": "otherReason"}]}
        }).encode("utf-8")

        cases = [
            ("channels", 404, missing),
            ("videos", 404, missing),
            ("playlistItems", 403, missing),
            ("playlistItems", 404, other),
            ("playlistItems", 404, b"not JSON"),
            ("playlistItems", 404, b"{}"),
            ("playlistItems", 404, b"x" * 65_537),
        ]
        for resource, status, body in cases:
            with self.subTest(resource=resource, status=status, body_size=len(body)):
                with self.assertRaises(RuntimeError) as caught:
                    self.call_api_with_error(resource, status, body)
                self.assertNotIsInstance(
                    caught.exception, m.UploadsPlaylistNotFound
                )


if __name__ == "__main__":
    unittest.main()