"""Offline API-boundary tests: no network, Git subprocesses, or real writes."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import podcast_proposal_writer as w
from podcast_proposal_binding import prepare_bound_proposal

spec = importlib.util.spec_from_file_location("writer_fixtures", ROOT / "tests/test_podcast_proposal.py")
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.event, config, self.envelope, js, html = f.ProposalTests().setup_proposal()
        self.base = "a" * 40
        self.files = {"podcasts.json": (json.dumps(config) + "\n").encode(),
                      "site/app.js": js.encode(), "site/index.html": html.encode()}
        manifest, proposed = prepare_bound_proposal(self.event, self.envelope, self.base, self.files)
        self.bundle = {"version": 1, "manifest": manifest, "proposed": proposed,
                       "checks": {"tests": {"ran": 325, "skipped": 7},
                                  "security": "passed", "whitespace": "passed"}}
        self.calls = []
        self.change_main_at = None
        self.live_checks = 0
        self.edited = False
        self.job_success = True
        self.run_sha = self.base

    def api(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        p = w.PREFIX
        if method == "GET":
            if path.endswith("/actions/runs/12"):
                return {"id": 12, "run_attempt": 1, "event": "issues", "head_branch": "main",
                        "head_sha": self.run_sha, "path": ".github/workflows/podcast-change.yml",
                        "repository": {"full_name": w.REPO}, "actor": {"id": w.OWNER_ID},
                        "triggering_actor": {"id": w.OWNER_ID}}
            if "/jobs?" in path:
                return {"total_count": 1, "jobs": [{"name": "proposal-preflight", "status": "completed",
                         "conclusion": "success" if self.job_success else "failure",
                         "head_sha": self.base, "run_id": 12}]}
            if "/issues/" in path:
                live = copy.deepcopy(self.event["issue"])
                if self.edited:
                    live["updated_at"] = "edited"
                return live
            if path.endswith("/git/ref/heads/main"):
                self.live_checks += 1
                return {"ref": "refs/heads/main", "object": {"type": "commit", "sha":
                        "f" * 40 if self.change_main_at == self.live_checks else self.base}}
            if "/git/ref/heads/podcast-proposal/" in path:
                branch = path.split("/git/ref/heads/", 1)[1]
                return {"ref": "refs/heads/" + branch,
                        "object": {"type": "commit", "sha": "d" * 40}}
            if "/contents/" in path:
                name = path.split("/contents/", 1)[1].split("?", 1)[0]
                data = self.files[name]
                return {"type": "file", "path": name, "encoding": "base64",
                        "content": base64.b64encode(data).decode(),
                        "sha": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()}
            if "/git/commits/" in path:
                return {"sha": self.base, "tree": {"sha": "b" * 40}}
        if method == "POST":
            if path.endswith("/git/trees"):
                return {"sha": "c" * 40}
            if path.endswith("/git/commits"):
                return {"sha": "d" * 40, "tree": {"sha": "c" * 40}, "parents": [{"sha": self.base}]}
            if path.endswith("/git/refs"):
                return {"ref": payload["ref"], "object": {"sha": payload["sha"]}}
            if path.endswith("/pulls"):
                return {"number": 20}
        raise AssertionError("Unexpected API operation")

    def run_writer(self, digest=None):
        raw = json.dumps(self.bundle).encode()
        return w.process(self.event, self.envelope, raw,
                         digest or hashlib.sha256(raw).hexdigest(), "12", "1", self.api)

    def assert_no_writes(self):
        self.assertFalse(any(method != "GET" for method, _, _ in self.calls))

    def test_draft_pr_only_and_exact_tree(self):
        self.assertEqual(self.run_writer(), 20)
        writes = [(path, payload) for method, path, payload in self.calls if method == "POST"]
        self.assertEqual([path.rsplit("/", 1)[-1] for path, _ in writes],
                         ["trees", "commits", "refs", "pulls"])
        self.assertEqual({entry["path"] for entry in writes[0][1]["tree"]}, set(w.PATHS))
        self.assertEqual(writes[0][1]["base_tree"], "b" * 40)
        self.assertTrue(writes[-1][1]["draft"])
        self.assertEqual(writes[-1][1]["base"], "main")
        self.assertNotEqual(writes[2][1]["ref"], "refs/heads/main")
        self.assertIn("7 skipped", writes[-1][1]["body"])

    def test_digest_tampering_no_api(self):
        with self.assertRaises(ValueError):
            self.run_writer("0" * 64)
        self.assertEqual(self.calls, [])

    def test_unauthorized_no_api(self):
        self.event["sender"]["id"] = 1
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assertEqual(self.calls, [])

    def test_failed_job_no_writes(self):
        self.job_success = False
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_run_sha_mismatch_no_writes(self):
        self.run_sha = "f" * 40
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_edited_live_issue_no_writes(self):
        self.edited = True
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_stale_main_no_writes(self):
        self.change_main_at = 1
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_concurrent_main_before_objects_no_writes(self):
        self.change_main_at = 2
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_concurrent_main_before_branch_no_branch(self):
        self.change_main_at = 3
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assertFalse(any(path.endswith(("/git/refs", "/pulls")) for _, path, _ in self.calls))

    def test_concurrent_main_before_pr_no_pr(self):
        self.change_main_at = 4
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assertFalse(any(path.endswith("/pulls") for _, path, _ in self.calls))

    def test_changed_proposal_no_writes(self):
        self.bundle["proposed"]["site/app.js"] += "\n// tampered"
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_changed_base_bytes_no_writes(self):
        self.files["site/app.js"] += b"\n"
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_forged_test_summary_no_writes(self):
        self.bundle["checks"]["tests"]["ran"] = True
        with self.assertRaises(ValueError):
            self.run_writer()
        self.assert_no_writes()

    def test_duplicate_json_rejected_without_api(self):
        raw = b'{"version":1,"version":1}'
        with self.assertRaises(ValueError):
            w.process(self.event, self.envelope, raw, hashlib.sha256(raw).hexdigest(), "12", "1", self.api)
        self.assertEqual(self.calls, [])

    def test_changed_proposal_branch_no_pr(self):
        original = self.api

        def changed_branch(method, path, payload=None):
            result = original(method, path, payload)
            if method == "GET" and "/git/ref/heads/podcast-proposal/" in path:
                result["object"]["sha"] = "f" * 40
            return result

        raw = json.dumps(self.bundle).encode()
        with self.assertRaisesRegex(ValueError, "^Proposal branch changed$"):
            w.process(
                self.event, self.envelope, raw,
                hashlib.sha256(raw).hexdigest(), "12", "1", changed_branch,
            )
        self.assertFalse(any(
            method == "POST" and path.endswith("/pulls")
            for method, path, _ in self.calls
        ))

    def test_api_failure_not_retried(self):
        original = self.api
        def fail(method, path, payload=None):
            if method == "POST" and path.endswith("/git/refs"):
                self.calls.append((method, path, payload))
                raise RuntimeError("fixture")
            return original(method, path, payload)
        raw = json.dumps(self.bundle).encode()
        with self.assertRaises(RuntimeError):
            w.process(self.event, self.envelope, raw, hashlib.sha256(raw).hexdigest(), "12", "1", fail)
        self.assertEqual(sum(path.endswith("/git/refs") for _, path, _ in self.calls), 1)
        self.assertFalse(any(path.endswith("/pulls") for _, path, _ in self.calls))
