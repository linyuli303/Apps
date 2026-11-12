"""Execute current Connect lifecycle with fake dependencies; no network."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyConnectLifecycleTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; Connect lifecycle execution skipped"
    )
    def test_eight_connect_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "async function createSpotifyPKCE("
        end = (
            "// Public GitHub request forms only: "
            "no token, persistent draft or source lookup."
        )
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        helpers = source[first:source.index(end, first)]

        template = (ROOT / "tests/spotify_connect_lifecycle.js").read_text(
            encoding="utf-8"
        )
        marker = "/* CURRENT_SPOTIFY_CONNECT_HELPERS */"
        self.assertEqual(template.count(marker), 1)

        prelude = """
let reported = false;
globalThis.document = {
  getElementById(id) {
    if (id !== "results") throw new Error("Unexpected DOM access");
    return {
      set textContent(value) {
        reported = true;
        console.log(value);
        if (!value.endsWith("8 passed; 0 failed")) process.exitCode = 1;
      }
    };
  }
};
process.on("beforeExit", () => {
  if (!reported) {
    console.error("Missing Connect test summary");
    process.exitCode = 1;
  }
});
"""
        result = subprocess.run(
            [NODE, "-"], input=prelude + template.replace(marker, helpers),
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("8 passed; 0 failed", result.stdout)
