"""Executable retry-policy tests. No audio, network, or GitHub requests."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js unavailable; policy execution unverified")
class PodcastPrivacyPolicyTests(unittest.TestCase):
    def execute(self, scenario):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "function createPodcastPrivacyPolicy() {"
        end = "function createPodcastPlayer("
        self.assertEqual(source.count(start), 1)
        helper = start + source.split(start, 1)[1].split(end, 1)[0]
        script = (
            '"use strict";\n'
            'const assert = require("node:assert/strict");\n'
            + helper
            + "\nconst policy = createPodcastPrivacyPolicy();\n"
            + scenario
        )
        result = subprocess.run(
            [NODE, "-e", script],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_new_episode_starts_anonymous(self):
        self.execute("""
            const first = policy.begin("one");
            assert.equal(first.mode, "anonymous");
            assert.equal(first.position, 0);
            assert.equal(policy.shouldPlay(first), true);
            policy.fallback(first, 2, 12);
            const next = policy.begin("two");
            assert.equal(next.mode, "anonymous");
            assert.equal(next.position, 0);
            assert.equal(policy.isCurrent(first), false);
        """)

    def test_fallback_once_for_network_or_source_error(self):
        self.execute("""
            for (const code of [2, 4]) {
                const first = policy.begin("one");
                const retry = policy.fallback(first, code, 37);
                assert.equal(retry.mode, "standard");
                assert.equal(retry.position, 37);
                assert.equal(policy.shouldPlay(retry), true);
                assert.equal(policy.fallback(first, code, 37), null);
                assert.equal(policy.fallback(retry, code, 37), null);
            }
        """)

    def test_other_errors_do_not_downgrade(self):
        self.execute("""
            for (const code of [0, 1, 3, null, undefined, "2"]) {
                const first = policy.begin("one");
                assert.equal(policy.fallback(first, code, 0), null);
                assert.equal(policy.isCurrent(first), true);
                assert.equal(first.mode, "anonymous");
            }
        """)

    def test_pause_prevents_fallback(self):
        self.execute("""
            const first = policy.begin("one");
            policy.pause();
            assert.equal(policy.shouldPlay(first), false);
            assert.equal(policy.fallback(first, 2, 0), null);
            assert.equal(policy.resume(first), true);
            assert.equal(policy.shouldPlay(first), true);
        """)

    def test_close_invalidates_pending_attempt(self):
        self.execute("""
            const first = policy.begin("one");
            policy.invalidate();
            assert.equal(policy.isCurrent(first), false);
            assert.equal(policy.shouldPlay(first), false);
            assert.equal(policy.resume(first), false);
            assert.equal(policy.fallback(first, 4, 0), null);
        """)

    def test_stale_episode_cannot_retry_or_resume(self):
        self.execute("""
            const old = policy.begin("one");
            const current = policy.begin("two");
            assert.equal(policy.fallback(old, 2, 5), null);
            assert.equal(policy.resume(old), false);
            assert.equal(policy.shouldPlay(current), true);
            assert.equal(policy.isCurrent(null), false);
        """)

    def test_resume_standard_does_not_reset_retry_limit(self):
        self.execute("""
            const first = policy.begin("one");
            const retry = policy.fallback(first, 4, 10);
            policy.pause();
            assert.equal(policy.shouldPlay(retry), false);
            assert.equal(policy.resume(retry), true);
            assert.equal(policy.fallback(retry, 2, 10), null);
        """)

    def test_position_validation_and_immutable_attempts(self):
        self.execute("""
            for (const value of [-1, NaN, Infinity, "12", null]) {
                const first = policy.begin("one");
                assert.equal(policy.fallback(first, 2, value).position, 0);
            }
            const first = policy.begin("one");
            assert.equal(Object.isFrozen(first), true);
            const retry = policy.fallback(first, 2, 12.5);
            assert.equal(retry.position, 12.5);
            assert.equal(Object.isFrozen(retry), true);
            assert.throws(() => policy.begin(""));
        """)
