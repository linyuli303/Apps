"""Offline tests for explicit frontend-only manual publication."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "deploy_only_selector", ROOT / "scripts/select_feed_mode.py"
)
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)

class DeployOnlyTests(unittest.TestCase):
    def test_explicit_manual_reuse_skips_refresh(self):
        for value in (True, "true"):
            diff = Mock()
            self.assertFalse(selector.needs_refresh(
                "workflow_dispatch",
                {"inputs": {"reuse_published_feed": value}},
                "a" * 40,
                diff,
            ))
            diff.assert_not_called()

    def test_default_and_false_manual_runs_refresh(self):
        for event in (
            {},
            {"inputs": {}},
            {"inputs": {"reuse_published_feed": False}},
            {"inputs": {"reuse_published_feed": "false"}},
        ):
            self.assertTrue(selector.needs_refresh(
                "workflow_dispatch", event, "a" * 40, Mock()
            ))

    def test_schedule_cannot_use_manual_override(self):
        self.assertTrue(selector.needs_refresh(
            "schedule",
            {"inputs": {"reuse_published_feed": "true"}},
            "a" * 40,
            Mock(),
        ))

    def test_workflow_exposes_boolean_option(self):
        text = (ROOT / ".github/workflows/publish.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("reuse_published_feed:", text)
        self.assertIn("type: boolean", text)
        self.assertIn("default: false", text)

if __name__ == "__main__":
    unittest.main()
