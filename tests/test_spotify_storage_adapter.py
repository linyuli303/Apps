"""Execute storage adapter against fake browser objects; no real storage."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyStorageAdapterTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; storage adapter execution skipped"
    )
    def test_six_adapter_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "const MYAPPS_SPOTIFY_CONFIG ="
        end = (
            "// Public GitHub request forms only: "
            "no token, persistent draft or source lookup."
        )
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        helpers = source[first:source.index(end, first)]

        template = (ROOT / "tests/spotify_storage_adapter.js").read_text(
            encoding="utf-8"
        )
        marker = "/* CURRENT_SPOTIFY_STORAGE_ADAPTER_HELPERS */"
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
        if (!value.endsWith("6 passed; 0 failed")) process.exitCode = 1;
      }
    };
  }
};
"""
        script = (
            prelude + template.replace(marker, helpers)
            + '\nif (!reported) throw new Error("Missing adapter summary");\n'
        )
        result = subprocess.run(
            [NODE, "-e", script],
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("6 passed; 0 failed", result.stdout)
