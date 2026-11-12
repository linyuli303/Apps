"""Source-level privacy guards; browser network checks remain necessary."""
from pathlib import Path
from html.parser import HTMLParser
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Inputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and "id" in attrs:
            self.inputs[attrs["id"]] = attrs


class PrivacyDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")

    def block(self, start, end):
        return self.js.split(start, 1)[1].split(end, 1)[0]

    def test_thumbnails_are_opt_in(self):
        parser = Inputs()
        parser.feed(self.html)
        thumbnail = parser.inputs["thumbnails"]
        self.assertNotIn("checked", thumbnail)
        self.assertEqual(thumbnail.get("autocomplete"), "off")
        self.assertIn("Thumbnails are off by", self.html)
        renderer = self.block("function render()", "function openPlayer(")
        self.assertIn('const thumbnails = $("thumbnails").checked', renderer)
        self.assertIn("if (thumbnails)", renderer)

    def test_feed_fetch_no_store_and_no_credentials(self):
        self.assertIn(
            'fetch(new URL("data/feed.json", MYAPPS_ROOT), { cache: "no-store", credentials: "omit" })',
            self.js,
        )

    def test_new_category_edits_are_memory_only(self):
        state = self.block("function categoryState()", "function categoryAllows(")
        save = self.block("function saveCategoryData()", "function renderCategoryEditor(")
        for block in (state, save):
            self.assertNotIn("localStorage", block)
            self.assertNotIn("sessionStorage", block)
        self.assertIn("validateCategoryData(state.model)", save)
        self.assertIn("Reloading loses edits", save)
        self.assertIn("Unpublished edits stay in page memory only", self.html)

    def test_category_recovery_is_explicit_and_read_only(self):
        recovery = self.block(
            '$("category-migrate-local").addEventListener("click",',
            '$("category-review-close").addEventListener',
        )
        self.assertIn("[state.key, true]", recovery)
        self.assertIn("[state.legacyKey, false]", recovery)
        self.assertIn('encodeURIComponent("/MyTube/")', recovery)
        self.assertIn(
            '["approved-yt-category-draft-v2:" + previousScope, true]',
            recovery,
        )
        self.assertIn(
            '["approved-yt-categories-v1:" + previousScope, false]',
            recovery,
        )
        self.assertIn("localStorage.getItem(key)", recovery)
        self.assertIn("confirm(", recovery)
        self.assertIn("validateCategoryData(value)", recovery)
        self.assertIn("state.baseRevision = baseRevision", recovery)
        self.assertNotIn("localStorage.setItem", recovery)
        self.assertNotIn("localStorage.removeItem", recovery)
        reset = self.block(
            '$("category-reload-published").addEventListener("click",',
            '$("category-migrate-local").addEventListener',
        )
        self.assertNotIn("localStorage", reset)

    def test_playback_preferences_do_not_persist(self):
        for start, end in (
            ("function speedState()", "function updateSpeedControls("),
            ("function setPreferredSpeed(", "function stopSpeedController("),
            ("function autoNextState()", "function nextAutoVideoID("),
            ("function playbackOptions()", "function shortVideoAllows("),
            ("(function initializePlaybackOptions()", "})();"),
        ):
            self.assertNotIn("localStorage", self.block(start, end))
        self.assertIn("skipShort:true, loop:false", self.js)

    def test_no_new_storage_system_or_cookie_api(self):
        for text in (
            "document.cookie", "cookieStore", "sessionStorage",
            "indexedDB", "serviceWorker", "caches.open",
        ):
            self.assertNotIn(text, self.js)
        self.assertNotIn("localStorage.clear(", self.js)

    def test_whitelist_remember_still_controls_writes(self):
        save = self.block("function saveDraft()", "function updateAfterEdit(")
        self.assertLess(
            save.index('if (!$("remember-draft").checked)'),
            save.index("localStorage.setItem("),
        )
        self.assertIn("return;", save.split("localStorage.setItem(", 1)[0])
        self.assertIn('id="remember-draft"', self.html)


if __name__ == "__main__":
    unittest.main()
