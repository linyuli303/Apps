"""Offline checks for the new default palette."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]

class YugureThemeTests(unittest.TestCase):
    def test_first_palette_and_memory_defaults(self):
        js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        match = re.search(r"const themes = (\[.*?\]);", js, re.S)
        themes = json.loads(match.group(1))
        self.assertEqual(len(themes), 51)
        self.assertEqual(themes[0]["id"], "yugure")
        self.assertIn('selected = "yugure"', js)
        defaults = js.split("function readPreferences()", 1)[1].split(
            "readPreferences();", 1
        )[0]
        self.assertIn('mode = "light"', defaults)
        self.assertNotIn("localStorage", defaults)
        self.assertNotIn("savedTheme", defaults)

    def test_both_appearances_and_shared_variables(self):
        css = (ROOT / "site/style.css").read_text(encoding="utf-8")
        for mode in ("light", "dark"):
            match = re.search(
                r':root\[data-theme="yugure"\]'
                r'\[data-appearance="' + mode + r'"\]\{([^}]+)\}',
                css,
            )
            self.assertIsNotNone(match)
            for name in (
                "page", "surface", "canvas", "text", "muted",
                "accent", "border", "hover", "label-accent", "divider",
            ):
                self.assertIn("--" + name + ":", match.group(1))

if __name__ == "__main__":
    unittest.main()
