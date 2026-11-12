"""Offline HEAD-inspection tests; no actual network requests."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from podcast_media_inspection import inspect_chain


class Response:
    def __init__(self, status, location=None):
        self.status = status
        self.location = location

    def getheader(self, name):
        return self.location if name == "Location" else None

    def read(self, *args):
        raise AssertionError("Audio body must not be read")


class Connection:
    def __init__(self, response):
        self.response = response
        self.requests = []
        self.closed = False

    def request(self, method, target, headers):
        self.requests.append((method, target, headers))
        if method != "HEAD":
            raise AssertionError("Only HEAD is allowed")

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


class MediaInspectionTests(unittest.TestCase):
    def run_chain(self, responses):
        connections = [Connection(response) for response in responses]
        factory = Mock(side_effect=connections)
        addresses = Mock(return_value=["93.184.216.34"])
        result = inspect_chain(
            "https://audio.example.org/episode?public=value",
            addresses=addresses, connection_factory=factory,
            clock=lambda: 0,
        )
        return result, connections, addresses

    def test_redirect_checks_each_host_and_reads_no_body(self):
        result, connections, addresses = self.run_chain([
            Response(302, "https://delivery.example.org/audio"),
            Response(200),
        ])
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["reason"], "head_ok")
        self.assertEqual(
            [call.args[0] for call in addresses.call_args_list],
            ["audio.example.org", "delivery.example.org"],
        )
        self.assertTrue(all(connection.closed for connection in connections))
        self.assertTrue(all(
            request[0] == "HEAD"
            for connection in connections for request in connection.requests
        ))
        self.assertNotIn("public=value", str(result))
        self.assertNotIn("/audio", str(result))

    def test_unsafe_redirect_rejected_before_connection(self):
        for destination in (
            "http://delivery.example.org/audio",
            "https://127.0.0.1/audio",
            "https://user:password@delivery.example.org/audio",
        ):
            result, connections, addresses = self.run_chain([
                Response(302, destination)
            ])
            self.assertEqual(result["reason"], "unsafe_url")
            self.assertEqual(addresses.call_count, 1)
            self.assertTrue(connections[0].closed)

    def test_non_public_destination_fails_closed(self):
        factory = Mock()
        result = inspect_chain(
            "https://audio.example.org/file",
            addresses=Mock(side_effect=ValueError("private destination")),
            connection_factory=factory,
        )
        self.assertEqual(result["status"], "review_required")
        factory.assert_not_called()
        self.assertNotIn("private destination", str(result))

    def test_no_get_fallback_on_head_failure(self):
        result, connections, _ = self.run_chain([Response(405)])
        self.assertEqual(result["reason"], "head_http_error")
        self.assertEqual(len(connections[0].requests), 1)

    def test_redirect_bound(self):
        result, connections, _ = self.run_chain([
            Response(302, "https://audio.example.org/hop" + str(i))
            for i in range(6)
        ])
        self.assertEqual(result["reason"], "redirect_limit")
        self.assertEqual(len(result["hops"]), 6)
        self.assertTrue(all(connection.closed for connection in connections))
