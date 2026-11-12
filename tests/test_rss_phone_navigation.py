"""Static phone RSS guards; not browser or gesture execution tests."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RSSPhoneNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "site/style.css").read_text(encoding="utf-8")

    def test_phone_uses_full_width_sequential_panels(self):
        styles = self.css.split(
            "/* Phone RSS sequential full-width panels v1. */", 1
        )[1]
        self.assertIn("--rss-width:var(--rss-region-width)", styles)
        self.assertIn("width:var(--rss-region-width)", styles)
        self.assertIn("visibility:hidden", styles)
        self.assertIn("pointer-events:none", styles)

    def test_phone_disables_hover_and_focus_preview(self):
        for condition in (
            'event.pointerType === "mouse" && state.pinned === null &&',
            'state.pinned === null && !state.suppressPreview &&',
        ):
            tail = self.js.split(condition, 1)[1]
            self.assertIn(
                'dataset.deviceLayout !== "phone"', tail.split("{", 1)[0]
            )

    def test_accessible_back_and_close_controls(self):
        self.assertIn(
            'detailClose.setAttribute("aria-label", "Close RSS catalogue")',
            self.js,
        )
        self.assertIn(
            '$("rss-back").setAttribute("aria-label", "Back to channels")',
            self.js,
        )
        self.assertIn(
            'detailClose.addEventListener("click", () => setOpen(false))',
            self.js,
        )
        self.assertIn('panel.inert = id !== null &&', self.js)
        self.assertIn(
            '$("rss-back").focus({preventScroll:true})', self.js
        )

    def test_left_swipe_has_phone_direction_and_scroll_guards(self):
        gesture = self.js.split(
            "// Phone gestures navigate catalogue views only, never start playback.",
            1,
        )[1].split(
            '$("rss-search").addEventListener', 1
        )[0]
        for guard in (
            'dataset.deviceLayout === "phone"',
            "!event.isPrimary",
            "event.button !== 0",
            "state.active !== start.active",
            "dx > -60",
            "Math.abs(dx) < Math.abs(dy) * 1.5",
            '"pointercancel"',
            '"lostpointercapture"',
        ):
            self.assertIn(guard, gesture)
        self.assertIn('$("rss-back").click()', gesture)
        self.assertIn("setOpen(false)", gesture)
        self.assertNotIn("openPlayer(", gesture)
        self.assertIn("touch-action:pan-y pinch-zoom", self.css)

    def test_swipe_suppresses_pointer_click_not_keyboard(self):
        self.assertIn(
            "event.detail !== 0 && performance.now() < suppressRSSClickUntil",
            self.js,
        )
        self.assertIn("event.stopImmediatePropagation()", self.js)
        self.assertIn(
            "suppressRSSClickUntil = performance.now() + 500", self.js
        )
