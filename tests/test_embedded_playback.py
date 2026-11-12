"""Offline structural checks; browser playback requires manual verification."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class EmbeddedPlaybackTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        self.css = (ROOT / "site/style.css").read_text(encoding="utf-8")

    def test_grid_and_rss_open_embedded_player(self):
        self.assertIn(
            'card.addEventListener("click", () => openPlayer(v.id));',
            self.js,
        )
        self.assertIn(
            'title.addEventListener("click", () => openPlayer(video.id));',
            self.js,
        )

    def test_playback_validation_retained(self):
        player = self.js.split("function openPlayer(id) {", 1)[1].split(
            "function closePlayer()", 1
        )[0]
        for check in (
            "freshFeed(feed)", "safeID(id)",
            "draftAllows(video.channelId)", "feed.channels.some",
            "https://www.youtube-nocookie.com/embed/",
        ):
            self.assertIn(check, player)

    def test_catalogue_disabled_and_player_on_top(self):
        self.assertIn('$("rss-catalogue").inert = true;', self.js)
        self.assertIn('$("rss-catalogue").inert = false;', self.js)
        self.assertRegex(self.css, r"#player\.player\s*\{[^}]*z-index:100")

    def test_external_option_and_security_policy_retained(self):
        self.assertIn("Open in YouTube / App", self.html)
        self.assertIn("https://www.youtube.com/watch?v=${id}", self.js)
        self.assertIn(
            '$("official").addEventListener("click", () => {', self.js
        )
        self.assertIn(
            "frame-src https://www.youtube-nocookie.com https://open.spotify.com;", self.html
        )
        self.assertIn("script-src 'self';", self.html)

if __name__ == "__main__":
    unittest.main()
