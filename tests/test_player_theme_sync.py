"""Structural checks; shared appearance needs browser verification."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PlayerThemeSyncTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        self.css = (ROOT / "site/style.css").read_text(encoding="utf-8")

    def test_title_retained_for_accessibility(self):
        self.assertIn('aria-labelledby="playing-title"', self.html)
        self.assertIn('id="playing-title"', self.html)
        self.assertIn('player-title-accessible', self.html)
        self.assertIn('clip-path:inset(50%)', self.css)

    def test_both_controls_use_shared_controller(self):
        self.assertIn('function changeAppearance(value)', self.js)
        self.assertIn('changeAppearance(appearance.value)', self.js)
        self.assertIn('changeAppearance($("player-appearance").value)', self.js)
        self.assertIn('$("player-appearance").value = mode', self.js)
        self.assertIn('if (mode === "system") apply()', self.js)

    def test_selector_in_focus_trap_and_native_arrows_preserved(self):
        trap = self.js.split("const controls = [", 1)[1].split(
            "];", 1
        )[0]
        self.assertIn('$("player-appearance")', trap)
        self.assertIn(
            '!["IFRAME", "SELECT", "INPUT", "TEXTAREA"].includes(',
            self.js,
        )

    def test_no_separate_player_theme_storage(self):
        self.assertNotIn('localStorage.setItem("player-', self.js)
        palette = self.js.split('const themeKey =', 1)[1].split(
            '// RSS-style catalogue.', 1
        )[0]
        self.assertNotIn('localStorage', palette)
        self.assertIn('Selection lasts until this page reloads.', palette)
        self.assertIn('id="player-appearance"', self.html)
        self.assertIn('#frame.frame:fullscreen', self.css)

if __name__ == "__main__":
    unittest.main()
