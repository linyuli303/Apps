"""Execute current authorization URL helpers; no network/storage/navigation."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyAuthorizationURLTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; authorization URL execution skipped"
    )
    def test_six_authorization_url_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "async function createSpotifyPKCE("
        end = (
            "// Public GitHub request forms only: "
            "no token, persistent draft or source lookup."
        )
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        last = source.index(end, first)
        helpers = source[first:last]

        template = (
            ROOT / "tests/spotify_authorization_url.js"
        ).read_text(encoding="utf-8")
        marker = "/* MYAPPS_CURRENT_SPOTIFY_AUTHORIZATION */"
        self.assertEqual(template.count(marker), 1)

        prelude = """
const crypto = require("node:crypto").webcrypto;
let reported = false;
const sink = {
  set textContent(value) {
    reported = true;
    console.log(value);
    if (!value.endsWith("6 passed; 0 failed")) process.exitCode = 1;
  }
};
globalThis.document = {
  getElementById(id) {
    if (id !== "results") throw new Error("Unexpected DOM access");
    return sink;
  }
};
process.on("beforeExit", () => {
  if (!reported) {
    console.error("Missing authorization test summary");
    process.exitCode = 1;
  }
});
"""
        result = subprocess.run(
            [NODE, "-"], input=prelude + template.replace(marker, helpers),
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 passed; 0 failed", result.stdout)
