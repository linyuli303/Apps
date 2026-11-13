"""Offline resolver workflow boundaries; no Actions execution or secrets."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ChannelResolutionWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.workflow = (
            ROOT / ".github/workflows/channel-resolve.yml"
        ).read_text(encoding="utf-8")

    def test_owner_issue_and_main_gates(self):
        for required in [
            "types: [opened]",
            "github.repository == 'linyuli303/Apps'",
            "github.ref == 'refs/heads/main'",
            "github.actor_id == '42029941'",
            "github.event.issue.user.id == 42029941",
            "github.event.repository.owner.id == 42029941",
            "github.event.issue.title == '[MyTube] Resolve channels'",
            "environment: youtube-refresh",
        ]:
            self.assertIn(required, self.workflow)

    def test_explicit_read_only_permissions(self):
        self.assertRegex(self.workflow, r"(?m)^permissions: \{\}$")
        grants = re.findall(
            r"(?m)^      ([a-z-]+): (read|write)$",
            self.workflow,
        )
        self.assertEqual(
            grants, [("contents", "read"), ("issues", "read")]
        )
        self.assertNotRegex(self.workflow, r":\s*write\b")
        self.assertNotIn("process_channel_request.py", self.workflow)
        self.assertNotIn("/dispatches", self.workflow)

    def test_actions_are_sha_pinned_and_checkout_is_fixed(self):
        actions = re.findall(
            r"(?m)^\s+uses: ([^\s]+)$", self.workflow
        )
        self.assertEqual(len(actions), 3)
        for action in actions:
            self.assertRegex(action, r"^[\w./-]+@[0-9a-f]{40}$")

        self.assertIn("ref: ${{ github.sha }}", self.workflow)
        self.assertIn("persist-credentials: false", self.workflow)
        self.assertNotIn("github.head_ref", self.workflow)
        self.assertNotIn("pull_request_target", self.workflow)

    def test_credentials_only_in_resolution_step_after_tests(self):
        before, resolution_and_after = self.workflow.split(
            "      - name: Resolve identities without approving additions",
            1,
        )
        resolution, after = resolution_and_after.split(
            "      - name: Save advisory identity review", 1
        )

        for secret_reference in [
            "GH_TOKEN: ${{ github.token }}",
            "YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}",
        ]:
            self.assertNotIn(secret_reference, before)
            self.assertIn(secret_reference, resolution)
            self.assertNotIn(secret_reference, after)

        self.assertIn(
            "python -m unittest discover -s tests -v", before
        )
        self.assertIn("scripts/security_check.py", before)
        self.assertIn(
            "python scripts/resolve_channel_request.py", resolution
        )

    def test_advisory_output_is_bounded_and_not_website_content(self):
        self.assertIn(
            '${{ runner.temp }}/channel-identity-review.txt',
            self.workflow,
        )
        self.assertIn("retention-days: 1", self.workflow)
        self.assertIn("if-no-files-found: error", self.workflow)
        self.assertIn("overwrite: false", self.workflow)
        self.assertIn("timeout-minutes: 20", self.workflow)
        self.assertNotIn("upload-pages-artifact", self.workflow)
        self.assertNotIn("deploy-pages", self.workflow)
        self.assertNotIn("github.event.issue.body", self.workflow)
        self.assertIn(
            "No channels were added by this resolver.", self.workflow
        )


if __name__ == "__main__":
    unittest.main()