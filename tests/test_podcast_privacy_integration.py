"""Execute 13 fake-media scenarios against current application functions."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class PodcastPrivacyIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; fake-media execution unverified locally"
    )
    def test_current_playback_against_twelve_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        template = (
            ROOT / "tests/podcast_privacy_integration.js"
        ).read_text(encoding="utf-8")

        def section(start, end):
            self.assertEqual(source.count(start), 1)
            self.assertEqual(source.count(end), 1)
            first = source.index(start)
            last = source.index(end, first + len(start))
            return source[first:last]

        functions = "\n".join((
            section(
                "function createPodcastPrivacyPolicy() {",
                "function createPodcastPlayer(",
            ),
            section(
                "  const privacyPolicy = createPodcastPrivacyPolicy();",
                "  function start(i) {",
            ),
            section(
                "  function toggle() {",
                "  function selectEpisode(e) {",
            ),
        ))
        marker = "/* MYAPPS_CURRENT_PLAYBACK_FUNCTIONS */"
        self.assertEqual(template.count(marker), 1)

        # The browser harness reports through one DOM text sink.
        # Supply only that sink under Node; no browser or media access.
        prelude = """
const resultSink = {
  set textContent(value) {
    console.log(value);
    if (!value.endsWith("13 passed; 0 failed")) process.exitCode = 1;
  }
};
globalThis.document = {
  getElementById(id) {
    if (id !== "results") throw new Error("Unexpected DOM access");
    return resultSink;
  }
};
"""
        script = prelude + template.replace(marker, functions)
        result = subprocess.run(
            [NODE, "-e", script],
            capture_output=True, text=True, encoding="utf-8", timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("13 passed; 0 failed", result.stdout)
