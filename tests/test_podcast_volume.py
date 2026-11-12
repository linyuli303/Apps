"""Structural volume guards; browser verification is also required."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PodcastVolumeTests(unittest.TestCase):
    def setUp(self):
        js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.player = js.split("function createPodcastPlayer(", 1)[1].split(
            "function initializePodcastConfiguration(", 1
        )[0]
        self.controls = self.player.split(
            "// Volume is page-memory only;", 1
        )[1].split('  $("podcast-seek")', 1)[0]

    def test_accessible_controls_and_initial_volume(self):
        for expected in (
            'mute.id = "podcast-mute"',
            'volume.id = "podcast-volume"',
            'volumeLabel.htmlFor = "podcast-volume"',
            'volume.min = "0"',
            'volume.max = "100"',
            'volume.value = "100"',
            'setAttribute("aria-valuetext"',
            'setAttribute("aria-pressed"',
            'next,rate,volumeGroup',
        ):
            self.assertIn(expected, self.controls)

    def test_native_volume_sync_and_previous_level(self):
        for expected in (
            "let lastAudibleVolume = 1",
            "silent ? lastAudibleVolume : 0",
            "Number.isFinite(level)",
            "audio.volume = level",
            "audio.muted = level === 0",
            'audio.addEventListener("volumechange", syncVolume)',
            "Math.abs(audio.volume - level)",
        ):
            self.assertIn(expected, self.controls)

    def test_controls_do_not_start_media_or_persist(self):
        for forbidden in (
            "localStorage", "sessionStorage", "fetch(",
            "audio.play(", "audio.src", "audio.load(",
        ):
            self.assertNotIn(forbidden, self.controls)
        self.assertIn('audio.preload = "none"', self.player)
