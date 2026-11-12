"""Validate fake token responses using current code; no network or storage."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyTokenValidationTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; token validation execution skipped"
    )
    def test_seven_token_validation_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "function validateSpotifyTokenResponse("
        end = (
            "// Public GitHub request forms only: "
            "no token, persistent draft or source lookup."
        )
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        last = source.index(end, first)
        helper = source[first:last]

        template = (
            ROOT / "tests/spotify_token_validation.js"
        ).read_text(encoding="utf-8")
        marker = "/* MYAPPS_CURRENT_SPOTIFY_TOKEN_VALIDATOR */"
        self.assertEqual(template.count(marker), 1)

        prelude = """
let reported = false;
const sink = {
  set textContent(value) {
    reported = true;
    console.log(value);
    if (!value.endsWith("7 passed; 0 failed")) process.exitCode = 1;
  }
};
globalThis.document = {
  getElementById(id) {
    if (id !== "results") throw new Error("Unexpected DOM access");
    return sink;
  }
};
"""
        script = (
            prelude + template.replace(marker, helper)
            + '\nif (!reported) throw new Error("Missing test summary");\n'
        )
        result = subprocess.run(
            [NODE, "-"], input=script, capture_output=True,
            text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("7 passed; 0 failed", result.stdout)
