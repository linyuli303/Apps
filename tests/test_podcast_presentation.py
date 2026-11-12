"""Source-level presentation guards; not browser or playback execution tests."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PodcastPresentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        cls.css = (ROOT / "site/style.css").read_text(encoding="utf-8")
        cls.presentation = cls.js.split(
            "  // Presentation only: never change audio, queue, speed or playback position.",
            1,
        )[1].split(
            '  $("podcast-seek").addEventListener("input",', 1
        )[0]

    def test_state_transition_does_not_modify_playback(self):
        transition = self.presentation.split(
            "  function setPodcastPresentation(", 1
        )[1].split(
            "  // Gestures belong only to title areas", 1
        )[0]
        self.assertIn('["expanded", "collapsed", "docked"]', transition)
        self.assertIn('["left", "right"]', transition)
        self.assertIn('if (presentation !== "expanded") showQueue(false)', transition)
        for forbidden in (
            "audio.", "clearSource(", "attemptPlay(", "queue=",
            "queue =", "speed =", "currentTime", ".load(",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, transition)

    def test_controls_and_existing_toggle_are_retained(self):
        for control in (
            "podcast-collapse", "podcast-expand", "podcast-dock",
            "podcast-restore", "podcast-collapse-before-dock",
            "podcast-compact-play",
        ):
            self.assertIn('"' + control + '"', self.presentation)
        self.assertIn(
            'const compactPlay = button("play", "Resume podcast", toggle)',
            self.presentation,
        )
        self.assertIn('collapse.setAttribute("aria-expanded", "true")',
                      self.presentation)
        self.assertIn('expand.setAttribute("aria-expanded", "false")',
                      self.presentation)
        self.assertIn('target.focus({preventScroll:true})', self.presentation)

    def test_swipes_are_phone_title_only_and_horizontal(self):
        gestures = self.presentation.split(
            "  function bindPodcastTitleSwipe(", 1
        )[1].split(
            "  // Observe display text only", 1
        )[0]
        for guard in (
            'dataset.deviceLayout === "phone"',
            '!event.isPrimary',
            'event.button !== 0',
            'event.target.closest("button,input,select,a,textarea,label")',
            'Math.abs(dx) < 60',
            'Math.abs(dx) < Math.abs(dy) * 1.5',
            '"pointercancel"',
            '"lostpointercapture"',
        ):
            self.assertIn(guard, gestures)
        self.assertIn(
            'bindPodcastTitleSwipe(expandedParts[0], "expanded")', gestures
        )
        self.assertIn(
            'bindPodcastTitleSwipe(compactTitle, "collapsed")', gestures
        )
        self.assertIn(
            'setPodcastPresentation("docked", dx < 0 ? "left" : "right")',
            gestures,
        )

    def test_memory_only_and_no_network_or_new_audio(self):
        for forbidden in (
            "localStorage", "sessionStorage", "fetch(", "XMLHttpRequest",
            'createElement("audio")', "new Audio(",
        ):
            self.assertNotIn(forbidden, self.presentation)
        self.assertIn(
            'setPodcastPresentation("expanded", "right", false)',
            self.presentation,
        )

    def test_hidden_controls_and_dock_recovery(self):
        self.assertIn(
            'part.hidden = presentation !== "expanded"', self.presentation
        )
        self.assertIn(
            'compact.hidden = presentation !== "collapsed"', self.presentation
        )
        self.assertIn(
            'restore.hidden = presentation !== "docked"', self.presentation
        )
        self.assertIn(
            '() => setPodcastPresentation("collapsed")', self.presentation
        )
        self.assertIn('[data-dock-side="left"]', self.css)
        self.assertIn("touch-action:pan-y pinch-zoom", self.css)

    def test_podcast_auto_next_is_unconditional_and_control_hidden(self):
        player = self.js.split(
            "function createPodcastPlayer(", 1
        )[1].split(
            "// Device layout is independent", 1
        )[0]
        ended = player.split(
            'audio.addEventListener("ended",()=>{', 1
        )[1].split(
            'for(const event of ["play","pause","loadedmetadata"', 1
        )[0]
        self.assertNotIn("podcast-auto-next", ended)
        self.assertIn("start(index+1)", ended)
        self.assertIn('repeat==="one"', ended)
        self.assertIn('repeat==="all"', ended)
        self.assertIn('message("Playlist playback finished.")', ended)
        self.assertIn(
            '$("podcast-auto-next").disabled = true;', player
        )
        self.assertIn(
            '$("podcast-auto-next").parentElement.hidden = true;', player
        )

    def test_stop_resets_presentation_without_opening_player(self):
        self.assertIn(
            '$("podcast-stop").addEventListener("click", () => {\n'
            '    setPodcastPresentation("expanded", "right", false);\n'
            '  });',
            self.presentation,
        )

    def test_compact_errors_and_play_pause_stay_synchronized(self):
        self.assertIn(
            'compactStatus.setAttribute("role", "status")', self.presentation
        )
        self.assertIn(
            'presentationObserver.observe($("podcast-playback-status")',
            self.presentation,
        )
        self.assertIn(
            '["play", "pause", "ended", "emptied"]', self.presentation
        )
        self.assertIn(
            'audio.addEventListener(event, syncPodcastPresentation)',
            self.presentation,
        )
