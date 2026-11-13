"""Fixed-origin resolver transport tests; no real requests or secrets."""
import importlib.util
import json
from email.message import Message
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_transport_tests", ROOT / "scripts/channel_resolution.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Response:
    def __init__(self, url):
        self.url = url
        self.status = 200
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"
        self.raw = json.dumps({"items": []}).encode()
        self.closed = False
        self.read_size = None

    def geturl(self):
        return self.url

    def read(self, size):
        self.read_size = size
        return self.raw[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True


class Client:
    def __init__(self, change=None):
        self.calls = []
        self.change = change
        self.response = None

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        self.response = Response(request.full_url)
        if self.change:
            self.change(self.response)
        return self.response


class ChannelResolutionTransportTests(unittest.TestCase):
    def params(self):
        return {"part": "snippet", "maxResults": 1, "forHandle": "@Example"}

    def test_fixed_endpoint_key_header_and_bounds(self):
        client = Client()
        result = m.request_channel_identity(
            self.params(), "FAKE_KEY", opener=client
        )
        self.assertEqual(result, {"items": []})
        self.assertEqual(len(client.calls), 1)
        request, timeout = client.calls[0]
        url = urlsplit(request.full_url)
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.netloc, "www.googleapis.com")
        self.assertEqual(url.path, "/youtube/v3/channels")
        self.assertEqual(parse_qs(url.query), {
            "part": ["snippet"], "maxResults": ["1"],
            "forHandle": ["@Example"],
        })
        self.assertNotIn("FAKE_KEY", request.full_url)
        headers = {k.lower(): v for k, v in request.header_items()}
        self.assertEqual(headers["x-goog-api-key"], "FAKE_KEY")
        self.assertNotIn("cookie", headers)
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(timeout, 15)
        self.assertEqual(client.response.read_size, 262145)
        self.assertTrue(client.response.closed)

    def test_id_filter_supported(self):
        cid = "UC" + "a" * 22
        client = Client()
        m.request_channel_identity({
            "part": "snippet", "maxResults": 1, "id": cid,
        }, "FAKE_KEY", opener=client)
        query = parse_qs(urlsplit(client.calls[0][0].full_url).query)
        self.assertEqual(query["id"], [cid])
        self.assertNotIn("forHandle", query)

    def test_invalid_inputs_never_reach_transport(self):
        invalid_params = [
            None, {}, {**self.params(), "id": "UC" + "a" * 22},
            {**self.params(), "extra": "unsafe"},
            {**self.params(), "part": "contentDetails"},
            {**self.params(), "maxResults": True},
            {**self.params(), "forHandle": "@bad/extra"},
        ]
        for params in invalid_params:
            client = Client()
            with self.subTest(params=params):
                with self.assertRaises(ValueError):
                    m.request_channel_identity(
                        params, "FAKE_KEY", opener=client
                    )
                self.assertEqual(client.calls, [])

        for key in [None, "", "bad\nkey", "with space", "非ASCII", "x" * 257]:
            client = Client()
            with self.assertRaises(ValueError):
                m.request_channel_identity(self.params(), key, opener=client)
            self.assertEqual(client.calls, [])

    def test_bad_responses_are_closed_and_never_retried(self):
        def wrong_type(response):
            response.headers.replace_header("Content-Type", "text/html")

        mutations = [
            lambda r: setattr(r, "status", 302),
            lambda r: setattr(r, "status", 403),
            lambda r: setattr(r, "status", 429),
            lambda r: setattr(r, "url", "https://untrusted.example/"),
            lambda r: setattr(r, "raw", b"x" * 262145),
            lambda r: setattr(r, "raw", b"\xff"),
            lambda r: setattr(r, "raw", b"{"),
            lambda r: setattr(r, "raw", b"[]"),
            wrong_type,
        ]
        for mutation in mutations:
            client = Client(mutation)
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(
                    RuntimeError, "^YouTube channel lookup unavailable$"
                ):
                    m.request_channel_identity(
                        self.params(), "FAKE_KEY", opener=client
                    )
                self.assertEqual(len(client.calls), 1)
                self.assertTrue(client.response.closed)

    def test_raw_transport_errors_are_hidden(self):
        class FailingClient:
            calls = 0

            def open(self, request, timeout):
                self.calls += 1
                raise RuntimeError("PRIVATE FAKE_KEY provider details")

        client = FailingClient()
        with self.assertRaisesRegex(
            RuntimeError, "^YouTube channel lookup unavailable$"
        ):
            m.request_channel_identity(
                self.params(), "FAKE_KEY", opener=client
            )
        self.assertEqual(client.calls, 1)


if __name__ == "__main__":
    unittest.main()