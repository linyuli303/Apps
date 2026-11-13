"""Read-only GitHub Issue transport tests; no network or real credentials."""
import importlib.util
import json
from email.message import Message
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_github_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Response:
    def __init__(self, url):
        self.url = url
        self.status = 200
        self.headers = Message()
        self.headers["Content-Type"] = "application/json"
        self.raw = json.dumps({"number": 7, "body": "Sample"}).encode()
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
    def __init__(self, mutation=None):
        self.calls = []
        self.mutation = mutation
        self.response = None

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        self.response = Response(request.full_url)
        if self.mutation:
            self.mutation(self.response)
        return self.response


class ChannelResolutionGitHubTests(unittest.TestCase):
    def test_fixed_get_endpoint_credentials_and_response_bounds(self):
        client = Client()
        result = m.read_resolution_issue(7, "FAKE_TOKEN", opener=client)
        self.assertEqual(result["number"], 7)
        self.assertEqual(len(client.calls), 1)
        request, timeout = client.calls[0]
        self.assertEqual(
            request.full_url,
            "https://api.github.com/repos/linyuli303/Apps/issues/7",
        )
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertNotIn("FAKE_TOKEN", request.full_url)
        headers = {k.lower(): v for k, v in request.header_items()}
        self.assertEqual(headers["authorization"], "Bearer FAKE_TOKEN")
        self.assertNotIn("cookie", headers)
        self.assertEqual(timeout, 15)
        self.assertEqual(client.response.read_size, 262145)
        self.assertTrue(client.response.closed)

    def test_invalid_arguments_never_reach_transport(self):
        for number in [True, 0, -1, "7", 10000000000]:
            client = Client()
            with self.assertRaises(ValueError):
                m.read_resolution_issue(number, "FAKE_TOKEN", opener=client)
            self.assertEqual(client.calls, [])

        for token in [None, "", "bad\nvalue", "with space", "x" * 8193]:
            client = Client()
            with self.assertRaises(ValueError):
                m.read_resolution_issue(7, token, opener=client)
            self.assertEqual(client.calls, [])

    def test_invalid_responses_fail_closed_without_retries(self):
        def wrong_type(response):
            response.headers.replace_header("Content-Type", "text/html")

        for mutation in [
            lambda r: setattr(r, "status", 302),
            lambda r: setattr(r, "status", 403),
            lambda r: setattr(r, "url", "https://untrusted.example/"),
            lambda r: setattr(r, "raw", b"x" * 262145),
            lambda r: setattr(r, "raw", b"\xff"),
            lambda r: setattr(r, "raw", b"{"),
            lambda r: setattr(r, "raw", b"[]"),
            lambda r: setattr(r, "raw", b'{"number":8}'),
            lambda r: setattr(r, "raw", b'{"number":true}'),
            wrong_type,
        ]:
            client = Client(mutation)
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(
                    RuntimeError, "^Resolution Issue unavailable$"
                ):
                    m.read_resolution_issue(7, "FAKE_TOKEN", opener=client)
                self.assertEqual(len(client.calls), 1)
                self.assertTrue(client.response.closed)

    def test_transport_errors_do_not_expose_credentials(self):
        class FailingClient:
            calls = 0

            def open(self, request, timeout):
                self.calls += 1
                raise RuntimeError("PRIVATE FAKE_TOKEN DETAILS")

        client = FailingClient()
        with self.assertRaisesRegex(
            RuntimeError, "^Resolution Issue unavailable$"
        ):
            m.read_resolution_issue(7, "FAKE_TOKEN", opener=client)
        self.assertEqual(client.calls, 1)


if __name__ == "__main__":
    unittest.main()