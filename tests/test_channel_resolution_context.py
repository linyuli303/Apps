"""Resolver runner-context validation; no environment secrets or network."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "resolution_context_tests",
    ROOT / "scripts/channel_resolution.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ChannelResolutionContextTests(unittest.TestCase):
    def context(self):
        return {
            "GITHUB_REPOSITORY": "linyuli303/Apps",
            "GITHUB_REPOSITORY_OWNER_ID": "42029941",
            "GITHUB_ACTOR_ID": "42029941",
            "GITHUB_TRIGGERING_ACTOR": "linyuli303",
            "GITHUB_EVENT_NAME": "issues",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": (
                "linyuli303/Apps/.github/workflows/"
                "channel-resolve.yml@refs/heads/main"
            ),
            "GITHUB_SHA": "a" * 40,
            "GITHUB_WORKFLOW_SHA": "b" * 40,
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1",
        }

    def test_expected_context_returns_only_public_provenance(self):
        context = self.context()
        context["YOUTUBE_API_KEY"] = "FAKE_SECRET"
        context["GH_TOKEN"] = "FAKE_TOKEN"
        result = m.validate_resolution_runner(context)
        self.assertEqual(result, {
            "source_sha": "a" * 40,
            "workflow_sha": "b" * 40,
            "run_id": "123",
            "run_attempt": "1",
        })
        self.assertNotIn("FAKE_SECRET", str(result))
        self.assertNotIn("FAKE_TOKEN", str(result))

    def test_wrong_runner_boundaries_rejected(self):
        replacements = {
            "GITHUB_REPOSITORY": "someone/Apps",
            "GITHUB_REPOSITORY_OWNER_ID": "999",
            "GITHUB_ACTOR_ID": "999",
            "GITHUB_TRIGGERING_ACTOR": "another-user",
            "GITHUB_EVENT_NAME": "pull_request",
            "GITHUB_REF": "refs/heads/feature",
            "GITHUB_WORKFLOW_REF": (
                "linyuli303/Apps/.github/workflows/"
                "channel-resolve.yml@refs/heads/feature"
            ),
        }
        for key, value in replacements.items():
            context = self.context()
            context[key] = value
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    m.validate_resolution_runner(context)

    def test_missing_fields_and_malformed_revisions_rejected(self):
        for key in self.context():
            context = self.context()
            del context[key]
            with self.subTest(missing=key):
                with self.assertRaises(ValueError):
                    m.validate_resolution_runner(context)

        for key in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA"):
            for value in ["", "A" * 40, "bad", None]:
                context = self.context()
                context[key] = value
                with self.assertRaises(ValueError):
                    m.validate_resolution_runner(context)

    def test_run_identifiers_are_bounded_positive_decimal_strings(self):
        for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
            for value in ["0", "-1", "01", "1\n", "9" * 21, 1, None]:
                context = self.context()
                context[key] = value
                with self.subTest(key=key, value=value):
                    with self.assertRaises(ValueError):
                        m.validate_resolution_runner(context)

        for value in [None, [], "environment"]:
            with self.assertRaises(ValueError):
                m.validate_resolution_runner(value)


if __name__ == "__main__":
    unittest.main()