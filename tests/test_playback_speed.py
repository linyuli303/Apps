"""Structural speed-control checks; live rates require browser testing."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PlaybackSpeedTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")

    def test_range_and_presets(self):
        self.assertIn('min="0.25" max="2" step="0.25"', self.html)
        self.assertIn("index <= 8", self.js)
        self.assertIn("const value = index / 4", self.js)
        self.assertNotIn('new Option("Custom", "custom")', self.js)
        self.assertIn("normalizePlaybackSpeed", self.js)

    def test_preference_and_actual_rate_are_distinct(self):
        for method in (
            "getAvailablePlaybackRates", "getPlaybackRate", "setPlaybackRate"
        ):
            self.assertIn(method, self.js)
        speed = self.js.split("function speedState()", 1)[1].split(
            "function updateSpeedControls()", 1
        )[0]
        self.assertIn("preferred: 1", speed)
        self.assertNotIn("localStorage", speed)
        self.assertIn("Selected speed unavailable; playing", self.js)
        self.assertNotIn("Waiting for player confirmation.", self.js)
        report = self.js.split("function reportPlaybackSpeed()", 1)[1].split(
            "function applyPreferredSpeed()", 1
        )[0]
        self.assertNotIn("`Playing ${actual}x.", report)
        self.assertIn('state.stored\n        ? ""', report)
        self.assertIn("stopSpeedController();", self.js)

    def test_csp_expansion_is_scoped(self):
        self.assertIn("script-src 'self';", self.html)
        self.assertIn(
            "script-src-elem 'self' https://www.youtube.com/iframe_api "
            "https://www.youtube.com/s/player/ "
            "https://s.ytimg.com/yts/jsbin/;",
            self.html,
        )
        self.assertIn(
            "frame-src https://www.youtube-nocookie.com;", self.html
        )
        self.assertNotIn("'unsafe-inline'", self.html)
        self.assertNotIn("'unsafe-eval'", self.html)
        self.assertIn('enablejsapi: "1"', self.js)

    def test_speed_controls_in_focus_trap(self):
        trap = self.js.split("const controls = [", 1)[1].split(
            "];", 1
        )[0]
        self.assertIn('$("speed-preset")', trap)
        self.assertIn('$("speed-slider")', trap)

if __name__ == "__main__":
    unittest.main()
