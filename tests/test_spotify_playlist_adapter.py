"""Execute playlist adapter with fake transport; no account/network access."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


class SpotifyPlaylistAdapterTests(unittest.TestCase):
    @unittest.skipUnless(
        NODE, "Node.js unavailable; playlist adapter execution skipped"
    )
    def test_eight_playlist_adapter_scenarios(self):
        source = (ROOT / "site/app.js").read_text(encoding="utf-8")
        start = "async function readSpotifyPlaylistPage("
        end = (
            "// Public GitHub request forms only: "
            "no token, persistent draft or source lookup."
        )
        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        helper = source[first:source.index(end, first)]

        template = (ROOT / "tests/spotify_playlist_adapter.js").read_text(
            encoding="utf-8"
        )
        marker = "/* CURRENT_SPOTIFY_PLAYLIST_ADAPTER */"
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
    console.error("Missing playlist test summary");
    process.exitCode = 1;
  }
});
"""
        result = subprocess.run(
            [NODE, "-"], input=prelude + template.replace(marker, helper),
            capture_output=True, text=True, encoding="utf-8", timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("8 passed; 0 failed", result.stdout)
