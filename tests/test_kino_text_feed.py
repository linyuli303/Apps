"""Structural checks; actual playback/fullscreen needs browser testing."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class KinoTextFeedTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        self.css = (ROOT / "site/style.css").read_text(encoding="utf-8")

    def test_text_feed_has_no_placeholder_images(self):
        renderer = self.js.split("function render() {", 1)[1].split(
            "function openOfficialVideo", 1
        )[0]
        self.assertIn('classList.toggle("plain-feed", !thumbnails)', renderer)
        self.assertIn("if (thumbnails)", renderer)
        self.assertNotIn('"icon.svg"', renderer)
        self.assertIn('"text-feed-views"', renderer)
        self.assertIn("visible.slice(page * PAGE_SIZE", renderer)

    def test_title_and_controls_follow_video(self):
        player = self.html.split('id="player"', 1)[1]
        self.assertLess(player.index('id="frame"'), player.index('id="playing-title"'))
        self.assertLess(player.index('id="playing-title"'), player.index('id="kino-toggle"'))

    def test_fullscreen_targets_only_video_frame(self):
        self.assertIn('await frame.requestFullscreen();', self.js)
        self.assertIn('if (document.fullscreenElement) return;', self.js)
        self.assertIn('#frame.frame:fullscreen', self.css)

    def test_kino_and_new_controls_in_keyboard_trap(self):
        self.assertIn('$("player").classList.add("kino");', self.js)
        trap = self.js.split("const controls = [", 1)[1].split("];", 1)[0]
        self.assertIn('$("kino-toggle")', trap)
        self.assertIn('$("player-fullscreen")', trap)
        self.assertIn('aria-pressed', self.html)

if __name__ == "__main__":
    unittest.main()
