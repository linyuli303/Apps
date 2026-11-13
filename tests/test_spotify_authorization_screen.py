"""Execute current authorization screen with fake browser/controllers."""
import json
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyAuthorizationScreenTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; authorization screen execution skipped"
    )
    def test_eight_screen_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "(function initializeSpotifyAuthorizationScreen() {"
        end = "\n})();"

        self.assertEqual(source.count(start), 1)
        first = source.index(start)
        last = source.index(end, first) + len(end)
        initializer = source[first:last].strip()

        self.assertTrue(initializer.endswith("})();"))
        self.assertNotIn("initializeTubeExtras", initializer)
        self.assertNotIn("initializeUniversalDensity", initializer)

        template = (
            ROOT / "tests/spotify_authorization_screen.js"
        ).read_text(encoding="utf-8")
        marker = "/* CURRENT_SPOTIFY_SCREEN_INITIALIZER */"
        self.assertEqual(template.count(marker), 1)

        prelude = """
let reported = false;
globalThis.document = {
  getElementById(id) {
    if (id !== "results") throw new Error("Unexpected outer DOM access");
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
    console.error("Missing screen test summary");
    process.exitCode = 1;
  }
});
"""
        declaration = "const initializer = " + json.dumps(initializer) + ";\n"
        result = subprocess.run(
            [NODE, "-"], input=prelude + template.replace(marker, declaration),
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("8 passed; 0 failed", result.stdout)
