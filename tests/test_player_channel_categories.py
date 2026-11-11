"""Player category wiring checks; interactive behavior needs browser tests."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PlayerChannelCategoryTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        self.css = (ROOT / "site/style.css").read_text(encoding="utf-8")

    def test_shared_model_and_no_playback_restart_on_assignment(self):
        block = self.js.split("function renderPlayerCategories()", 1)[1].split(
            "(function initializePlayerCategories()", 1
        )[0]
        self.assertIn("categoryState()", block)
        self.assertIn("validateCategoryData", block)
        self.assertIn("saveCategoryData();", block)
        self.assertNotIn("openPlayer(", block)
        self.assertNotIn("stopSpeedController(", block)
        self.assertNotIn('$("frame").replaceChildren', block)

    def test_helper_and_accessible_controls(self):
        self.assertIn('aria-controls="player-category-panel"', self.html)
        self.assertIn('id="player-category-heading"', self.html)
        self.assertRegex(
            self.html,
            r"Applies to every video from this channel\.<br\s*/>"
            r"\s*Local draft; save through GitHub to share\.",
        )

    def test_panel_controls_in_focus_trap(self):
        trap = self.js.split("const controls = [", 1)[1].split(
            "];", 1
        )[0]
        self.assertIn('$("player-category-toggle")', trap)
        self.assertIn('$("player-category-done")', trap)
        self.assertIn('querySelectorAll("input")', trap)
        self.assertIn("closePlayerCategories(true)", self.js)

    def test_compact_toolbar_and_vertical_panel_overflow(self):
        self.assertIn("flex-wrap:nowrap", self.css)
        self.assertIn("overflow-x:hidden", self.css)
        self.assertIn("overflow-y:auto", self.css)
        self.assertIn("#player .player-explanation", self.css)
        self.assertIn("font-size:10px", self.css)

if __name__ == "__main__":
    unittest.main()
