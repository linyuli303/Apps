"""Execute current routing against fake DOM/history; no network or media."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyNavigationTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; navigation execution skipped"
    )
    def test_six_navigation_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "  function route() {"
        end = '  $("myapps-spotify").addEventListener("click",'
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        functions = source[first:source.index(end, first)]

        template = (ROOT / "tests/spotify_navigation.js").read_text(
            encoding="utf-8"
        )
        marker = "/* CURRENT_MYAPPS_ROUTING */"
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
        if (!value.endsWith("6 passed; 0 failed")) process.exitCode = 1;
      }
    };
  }
};
"""
        script = (
            prelude + template.replace(marker, functions)
            + '\nif (!reported) throw new Error("Missing navigation summary");\n'
        )
        result = subprocess.run(
            [NODE, "-"], input=script,
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 passed; 0 failed", result.stdout)
