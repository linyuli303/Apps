"""Static workflow boundary regressions; not an Actions/YAML validator."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProposalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.workflow = (
            ROOT / ".github/workflows/podcast-change.yml"
        ).read_text(encoding="utf-8")
        parts = re.split(
            r"^  ([a-z][a-z-]*):\n", self.workflow.split("\njobs:\n", 1)[1], flags=re.MULTILINE
        )
        self.jobs = dict(zip(parts[1::2], parts[2::2]))
        self.assertEqual(set(self.jobs), {
            "resolve", "apply", "proposal-preflight", "proposal-writer",
        })

    def test_all_jobs_use_fixed_owner_main_and_exact_checkout(self):
        for name, job in self.jobs.items():
            with self.subTest(job=name):
                for gate in (
                    "github.repository == 'linyuli303/Apps'",
                    "github.ref == 'refs/heads/main'",
                    "github.actor_id == '42029941'",
                    "github.event.issue.user.id == 42029941",
                    "github.event.repository.owner.id == 42029941",
                ):
                    self.assertIn(gate, job)
                self.assertEqual(job.count("ref: ${{ github.sha }}"), 1)
                self.assertEqual(job.count("persist-credentials: false"), 1)

    def test_resolution_outputs_drive_separate_routes(self):
        resolve = self.jobs["resolve"]
        self.assertIn(
            "status: ${{ steps.resolve.outputs.status }}", resolve
        )
        self.assertIn(
            "needs.resolve.outputs.status != 'approval_required'",
            self.jobs["apply"],
        )
        for name in ("proposal-preflight", "proposal-writer"):
            self.assertIn(
                "needs.resolve.outputs.status == 'approval_required'",
                self.jobs[name],
            )
        self.assertIn(
            "needs: [resolve, proposal-preflight]",
            self.jobs["proposal-writer"],
        )
        self.assertIn(
            "needs.proposal-preflight.result == 'success'",
            self.jobs["proposal-writer"],
        )

    def test_read_only_jobs_have_no_explicit_write_tokens(self):
        for name in ("resolve", "proposal-preflight"):
            job = self.jobs[name]
            with self.subTest(job=name):
                self.assertIn("      contents: read", job)
                self.assertNotIn(": write", job)
                self.assertNotIn("GH_TOKEN", job)
                self.assertNotIn("secrets.", job)

    def test_preflight_binds_successful_bundle(self):
        job = self.jobs["proposal-preflight"]
        self.assertIn("    name: proposal-preflight", job)
        self.assertIn('--base-sha "$GITHUB_SHA"', job)
        self.assertIn('--output "$RUNNER_TEMP/podcast-proposal.json"', job)
        self.assertIn(
            "bundle_sha256: ${{ steps.bundle.outputs.sha256 }}", job
        )
        self.assertIn("hashlib.sha256(raw).hexdigest()", job)
        self.assertLess(
            job.index("python scripts/podcast_proposal_preflight.py"),
            job.index("hashlib.sha256(raw).hexdigest()"),
        )
        self.assertLess(
            job.index("hashlib.sha256(raw).hexdigest()"),
            job.index("uses: actions/upload-artifact@"),
        )
        self.assertIn("if-no-files-found: error", job)

    def test_same_run_attempt_artifact_and_trusted_digest(self):
        name = "podcast-proposal-${{ github.run_id }}-${{ github.run_attempt }}"
        for key in ("proposal-preflight", "proposal-writer"):
            self.assertIn("name: " + name, self.jobs[key])
        writer = self.jobs["proposal-writer"]
        self.assertIn(
            "PODCAST_PREFLIGHT_SHA256: "
            "${{ needs.proposal-preflight.outputs.bundle_sha256 }}",
            writer,
        )
        self.assertIn(
            "path: ${{ runner.temp }}/podcast-proposal-input", writer
        )
        self.assertNotIn("run-id:", writer)
        self.assertNotIn("github-token:", writer)

    def test_writer_token_only_in_writer_step(self):
        writer = self.jobs["proposal-writer"]
        permissions = writer.split("    permissions:\n", 1)[1].split(
            "    steps:\n", 1
        )[0]
        self.assertEqual(
            {line.strip() for line in permissions.splitlines() if line.strip()},
            {"contents: write", "pull-requests: write", "actions: read"},
        )
        self.assertEqual(writer.count("GH_TOKEN:"), 1)
        step = writer.split(
            "      - name: Revalidate and create owner-review draft PR only",
            1,
        )[1]
        self.assertIn("GH_TOKEN: ${{ github.token }}", step)
        self.assertIn("run: python scripts/podcast_proposal_writer.py", step)
        self.assertNotIn("unittest", step)
        self.assertNotIn("publish.yml", writer)
        self.assertNotIn("process_podcast_request.py", writer)
        self.assertNotIn("pull_request_target", self.workflow)

    def test_existing_apply_processor_remains_separate(self):
        apply = self.jobs["apply"]
        self.assertIn("run: python scripts/process_podcast_request.py", apply)
        self.assertNotIn("podcast_proposal_writer.py", apply)
        for name in ("proposal-preflight", "proposal-writer"):
            self.assertNotIn(
                "process_podcast_request.py", self.jobs[name]
            )
