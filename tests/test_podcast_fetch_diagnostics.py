"""Offline retrieval diagnostics: fixed categories, no error disclosure."""
import contextlib
import io
from pathlib import Path
import ssl
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from podcast_resolution import diagnostic_fetch


class FetchDiagnosticTests(unittest.TestCase):
    def test_success_is_returned_unchanged(self):
        payload = b"test-response"
        with patch("build_podcasts.fetch_feed", return_value=payload) as fetch:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = diagnostic_fetch(
                    "https://feeds.example.org/rss", ["feeds.example.org"]
                )
        self.assertIs(result, payload)
        self.assertEqual(output.getvalue(), "")
        fetch.assert_called_once_with(
            "https://feeds.example.org/rss", ["feeds.example.org"]
        )

    def test_fixed_categories_preserve_original_failure(self):
        cases = (
            (OSError("PRIVATE-MARKER"), "Network connection failure"),
            (TimeoutError("PRIVATE-MARKER"), "Network timeout"),
            (ssl.SSLCertVerificationError("PRIVATE-MARKER"),
             "TLS certificate verification failed"),
            (ValueError("Feed HTTP request failed"),
             "Server returned a non-200 HTTP response"),
            (ValueError("Invalid or unapproved HTTPS URL"),
             "HTTPS URL or redirect-host check failed"),
            (ValueError("PRIVATE-MARKER"), "Retrieval validation failed"),
        )
        for error, expected in cases:
            with self.subTest(category=expected):
                output = io.StringIO()
                with patch("build_podcasts.fetch_feed", side_effect=error) as fetch:
                    with contextlib.redirect_stdout(output):
                        with self.assertRaises(type(error)) as caught:
                            diagnostic_fetch(
                                "https://feeds.example.org/PRIVATE-URL",
                                ["feeds.example.org"],
                            )
                self.assertIs(caught.exception, error)
                self.assertIn("RSS retrieval diagnostic: " + expected,
                              output.getvalue())
                self.assertNotIn("PRIVATE-MARKER", output.getvalue())
                self.assertNotIn("PRIVATE-URL", output.getvalue())
                self.assertEqual(fetch.call_count, 1)

    def test_directory_stage_has_no_raw_error(self):
        output = io.StringIO()
        with patch("build_podcasts.fetch_feed",
                   side_effect=OSError("PRIVATE-MARKER")):
            with contextlib.redirect_stdout(output):
                with self.assertRaises(OSError):
                    diagnostic_fetch(
                        "https://itunes.apple.com/lookup", ["itunes.apple.com"]
                    )
        self.assertIn("Apple directory retrieval diagnostic:", output.getvalue())
        self.assertNotIn("PRIVATE-MARKER", output.getvalue())
