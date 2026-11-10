"""Offline structural checks for configurable refresh hours."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]

class RefreshScheduleTests(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / ".github/workflows/publish.yml").read_text(
            encoding="utf-8"
        )

    def test_each_schedule_has_an_unambiguous_hour(self):
        schedules = re.findall(r'cron: "([^"]+)"', self.text)
        self.assertEqual(
            set(schedules),
            {f"0 {hour} * * *" for hour in range(24)},
        )
        self.assertEqual(len(schedules), 24)

    def test_hour_mapping_matches_scheduled_events(self):
        match = re.search(
            r"fromJSON\('([^']+)'\)\[github\.event\.schedule\]",
            self.text,
        )
        self.assertIsNotNone(match)
        mapping = json.loads(match.group(1))
        self.assertEqual(
            mapping,
            {f"0 {hour} * * *": f"{hour:02d}" for hour in range(24)},
        )

    def test_variable_default_and_non_schedule_bypass(self):
        self.assertIn(
            "vars.YOUTUBE_REFRESH_HOURS_UTC || '09,12,18,22'",
            self.text,
        )
        self.assertIn("github.event_name != 'schedule' ||", self.text)
        self.assertIn("format(',{0},'", self.text)

if __name__ == "__main__":
    unittest.main()
