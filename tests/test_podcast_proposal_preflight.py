"""Offline preflight mechanics using small disposable committed fixtures.

These tests do not represent a production proposal or browser/network proof.
"""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_proposal_preflight as p

spec = importlib.util.spec_from_file_location(
    "preflight_proposal_fixtures", ROOT / "tests/test_podcast_proposal.py"
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class PreflightUnitTests(unittest.TestCase):
    def test_environment_does_not_inherit_secrets_or_git_overrides(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {
            "GH_TOKEN": "fixture", "GITHUB_TOKEN": "fixture",
            "UNEXPECTED_SECRET": "fixture", "GIT_CONFIG_COUNT": "1",
            "PYTHONPATH": "untrusted", "NODE_OPTIONS": "untrusted",
        }):
            env = p.isolated_environment(Path(temp) / "home")
            for key in ("GH_TOKEN", "GITHUB_TOKEN", "UNEXPECTED_SECRET",
                        "GIT_CONFIG_COUNT", "PYTHONPATH", "NODE_OPTIONS"):
                self.assertNotIn(key, env)
            self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")

    def test_summary_records_windows_line_endings(self):
        self.assertEqual(p.unittest_summary(
            b"Ran 12 tests in 0.012s\r\n\r\nOK (skipped=7)\r\n"
        ), {"ran": 12, "skipped": 7})
        self.assertEqual(p.unittest_summary(
            b"Ran 1 test in 0.001s\r\n\r\nOK\r\n"
        ), {"ran": 1, "skipped": 0})

    def test_summary_records_skips(self):
        self.assertEqual(p.unittest_summary(
            b"Ran 12 tests in 0.012s\n\nOK (skipped=7)\n"
        ), {"ran": 12, "skipped": 7})
        self.assertEqual(p.unittest_summary(b"Ran 1 test in 0.001s\nOK\n"),
                         {"ran": 1, "skipped": 0})

    def test_missing_or_failed_summary_rejected(self):
        for raw in (b"", b"Ran 0 tests in 0.0s\nOK\n",
                    b"Ran 2 tests in 0.1s\nFAILED (failures=1)\n",
                    b"Ran 1 test in 0.1s\nOK\nOK\n"):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                p.unittest_summary(raw)

    def test_archive_rejects_unsafe_paths_and_links_before_writing(self):
        for name, kind in (("../escape", tarfile.REGTYPE),
                           ("/escape", tarfile.REGTYPE),
                           (".git/config", tarfile.REGTYPE),
                           ("folder\\escape", tarfile.REGTYPE),
                           ("C:/escape", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                data = io.BytesIO()
                with tarfile.open(fileobj=data, mode="w") as stream:
                    safe = tarfile.TarInfo("safe.txt")
                    safe.size = 2
                    stream.addfile(safe, io.BytesIO(b"ok"))
                    bad = tarfile.TarInfo(name)
                    bad.type = kind
                    bad.linkname = "outside"
                    stream.addfile(bad)
                with self.assertRaises(ValueError):
                    p.extract_snapshot(data.getvalue(), Path(temp))
                self.assertEqual(list(Path(temp).iterdir()), [])


@unittest.skipUnless(shutil.which("git"), "Git unavailable")
class PreflightIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="MyApps-preflight-test-")
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.root = self.parent / "source"
        self.root.mkdir()
        self.env = p.isolated_environment(self.parent / "home")
        self.git = shutil.which("git")
        self.run_git("init", "--quiet", "--template=", "--initial-branch=main")
        self.run_git("config", "user.name", "Fixture")
        self.run_git("config", "user.email", "fixture@invalid.example")
        self.run_git("config", "commit.gpgsign", "false")
        self.run_git("config", "core.autocrlf", "false")
        event, config, envelope, js, html = fixtures.ProposalTests().setup_proposal()
        self.event, self.envelope = event, envelope
        files = {
            "podcasts.json": json.dumps(config) + "\n",
            "site/app.js": js,
            "site/index.html": html,
            "scripts/security_check.py": "print('Fixture security check only')\n",
            "tests/test_fixture.py": "import unittest\nclass Fixture(unittest.TestCase):\n    def test_ok(self):\n        self.assertTrue(True)\n",
        }
        for relative, text in files.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))
        self.commit()
        self.output = self.parent / "result.json"

    def run_git(self, *args):
        return p.command([self.git, *args], self.root, self.env)

    def commit(self):
        self.run_git("add", "--all")
        self.run_git("commit", "--quiet", "-m", "Fixture")
        self.sha = self.run_git("rev-parse", "HEAD").decode().strip()

    def run_preflight(self):
        return p.preflight(self.root, self.event, self.envelope, self.sha, self.output)

    def test_roundtrip_no_source_changes_and_no_github_calls(self):
        before = {str(path.relative_to(self.root)): path.read_bytes()
                  for path in self.root.rglob("*") if path.is_file()
                  and ".git" not in path.relative_to(self.root).parts}
        checks = self.run_preflight()
        self.assertEqual(checks["tests"], {"ran": 1, "skipped": 0})
        bundle = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(bundle["manifest"]["baseSha"], self.sha)
        self.assertEqual(set(bundle["proposed"]), set(p.PATHS))
        self.assertFalse(self.run_git("status", "--porcelain=v1"))
        self.assertFalse(self.run_git("remote"))
        for relative, content in before.items():
            self.assertEqual((self.root / relative).read_bytes(), content)

    def test_dirty_checkout_rejected_without_bundle(self):
        (self.root / "site/app.js").write_bytes(b"pending change")
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_untracked_implementation_rejected_without_bundle(self):
        (self.root / "pending.py").write_bytes(b"# pending")
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_wrong_commit_rejected(self):
        self.sha = "b" * 40
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_changed_issue_rejected(self):
        self.event["issue"]["updated_at"] = "edited"
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_existing_output_not_overwritten(self):
        self.output.write_bytes(b"existing")
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertEqual(self.output.read_bytes(), b"existing")

    def test_output_inside_source_rejected(self):
        self.output = self.root / "result.json"
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_failed_tests_no_bundle(self):
        (self.root / "tests/test_fixture.py").write_bytes(
            b"import unittest\nclass Fixture(unittest.TestCase):\n    def test_fail(self):\n        self.fail('fixture')\n"
        )
        self.commit()
        with self.assertRaisesRegex(ValueError, "^Preflight tests command failed$"):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_failed_security_no_bundle(self):
        (self.root / "scripts/security_check.py").write_bytes(b"raise SystemExit(1)\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "^Preflight security command failed$"):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_check_mutates_proposal_no_bundle(self):
        (self.root / "scripts/security_check.py").write_bytes(
            b"from pathlib import Path\nPath('site/app.js').write_text('changed')\n"
        )
        self.commit()
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_check_changes_unrelated_file_no_bundle(self):
        (self.root / "scripts/security_check.py").write_bytes(
            b"from pathlib import Path\nPath('unexpected.txt').write_text('changed')\n"
        )
        self.commit()
        with self.assertRaises(ValueError):
            self.run_preflight()
        self.assertFalse(self.output.exists())

    def test_check_cannot_see_inherited_token(self):
        (self.root / "scripts/security_check.py").write_bytes(
            b"import os\nassert 'GH_TOKEN' not in os.environ\nassert 'UNEXPECTED_SECRET' not in os.environ\n"
        )
        self.commit()
        with patch.dict(os.environ, {"GH_TOKEN": "fixture", "UNEXPECTED_SECRET": "fixture"}):
            self.run_preflight()
        self.assertTrue(self.output.exists())
