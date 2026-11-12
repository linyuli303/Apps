"""Offline scoped connection failover and collector-default guards."""
import errno
from pathlib import Path
import ssl
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_podcasts as collector
from podcast_onboarding_network import connect_with_failover


class OnboardingNetworkTests(unittest.TestCase):
    def test_unreachable_address_tries_next_without_request(self):
        first = Mock()
        first.connect.side_effect = OSError(errno.ENETUNREACH, "unreachable")
        second = Mock()
        factory = Mock(side_effect=[first, second])
        result = connect_with_failover(
            "feeds.example.org", ["2606:4700:4700::1111", "1.1.1.1"], 15,
            factory=factory, clock=lambda: 0,
        )
        self.assertIs(result, second)
        first.close.assert_called_once()
        second.connect.assert_called_once()
        first.request.assert_not_called()
        second.request.assert_not_called()
        self.assertTrue(all(
            call.args[0] == "feeds.example.org"
            for call in factory.call_args_list
        ))

    def test_other_failures_do_not_try_another_address(self):
        errors = (
            ssl.SSLCertVerificationError("certificate failure"),
            TimeoutError("timeout"),
            OSError(errno.ECONNREFUSED, "refused"),
            OSError(errno.ECONNRESET, "reset"),
        )
        for error in errors:
            with self.subTest(error=type(error).__name__):
                connection = Mock()
                connection.connect.side_effect = error
                factory = Mock(return_value=connection)
                with self.assertRaises(type(error)) as caught:
                    connect_with_failover(
                        "feeds.example.org", ["1.1.1.1", "8.8.8.8"], 15,
                        factory=factory, clock=lambda: 0,
                    )
                self.assertIs(caught.exception, error)
                self.assertEqual(factory.call_count, 1)
                connection.close.assert_called_once()

    def test_all_addresses_checked_before_connection(self):
        factory = Mock()
        with self.assertRaises(ValueError):
            connect_with_failover(
                "feeds.example.org", ["1.1.1.1", "127.0.0.1"], 15,
                factory=factory,
            )
        factory.assert_not_called()

    def test_attempt_count_is_bounded(self):
        connection = Mock()
        connection.connect.side_effect = OSError(errno.EHOSTUNREACH, "unreachable")
        factory = Mock(return_value=connection)
        with self.assertRaises(OSError):
            connect_with_failover(
                "feeds.example.org", ["1.1.1.1"] * 12, 15,
                factory=factory, clock=lambda: 0,
            )
        self.assertEqual(factory.call_count, 8)

    def test_expired_budget_prevents_connection(self):
        factory = Mock()
        with self.assertRaises(TimeoutError):
            connect_with_failover(
                "feeds.example.org", ["1.1.1.1"], 1,
                factory=factory, clock=Mock(side_effect=[0, 2]),
            )
        factory.assert_not_called()

    def test_default_collector_still_uses_first_address_only(self):
        connection = Mock()
        error = OSError(errno.ENETUNREACH, "unreachable")
        connection.request.side_effect = error
        with (
            patch.object(collector, "public_addresses",
                         return_value=["1.1.1.1", "8.8.8.8"]),
            patch.object(collector, "PinnedHTTPS",
                         return_value=connection) as factory,
        ):
            with self.assertRaises(OSError) as caught:
                collector.fetch_feed(
                    "https://feeds.example.org/rss", ["feeds.example.org"]
                )
        self.assertIs(caught.exception, error)
        self.assertEqual(factory.call_count, 1)
        self.assertEqual(factory.call_args.args[1], "1.1.1.1")
        connection.close.assert_called_once()
