"""Offline checks for clean-URL entry-page rendering."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import prepare_site as prepare


class CleanUrlPackagingTests(unittest.TestCase):

    def test_prepare_writes_exact_seven_file_artifact(self):
        import contextlib
        import io
        import json
        import shutil
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = root / "site"
            (site / "data").mkdir(parents=True)
            for name in ("index.html", "style.css", "app.js", "icon.svg"):
                shutil.copyfile(ROOT / "site" / name, site / name)
            for name in ("channels.json", "categories.json"):
                shutil.copyfile(ROOT / name, root / name)

            config = json.loads(
                (root / "channels.json").read_text(encoding="utf-8")
            )
            # Synthetic offline fixture, never a production feed.
            fixture = {
                "title": config.get("title", "My Channels"),
                "generatedAt": "2026-11-12T00:00:00Z",
                "channels": [
                    {"id": channel["id"], "title": "Offline test channel"}
                    for channel in config["channels"]
                ],
                "videos": [],
            }
            (site / "data/feed.json").write_text(
                json.dumps(fixture), encoding="utf-8"
            )
            with patch.object(prepare, "ROOT", root):
                with contextlib.redirect_stdout(io.StringIO()):
                    prepare.prepare()

            output = root / "_site"
            actual = {
                item.relative_to(output).as_posix()
                for item in output.rglob("*") if item.is_file()
            }
            self.assertEqual(actual, set(prepare.PUBLIC_ASSETS))
            base = (output / "index.html").read_text(encoding="utf-8")
            for name in prepare.ENTRY_PAGES:
                nested = (output / name).read_text(encoding="utf-8")
                self.assertEqual(nested.replace('"../', '"'), base)
            self.assertEqual(
                (output / "data/feed.json").read_bytes(),
                (site / "data/feed.json").read_bytes(),
            )
            self.assertFalse((output / "categories.json").exists())
            self.assertFalse((output / "podcasts.json").exists())

    def test_exact_public_boundary(self):
        self.assertEqual(set(prepare.PUBLIC_ASSETS), {
            "index.html", "style.css", "app.js", "icon.svg",
            "data/feed.json", "MyTube/index.html",
            "MyPodcasts/index.html",
        })
        self.assertEqual(len(prepare.PUBLIC_ASSETS), 7)

    def test_shared_shell_and_nested_assets(self):
        html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        root = prepare.render_entry(html, "testrevision")
        nested = prepare.render_entry(html, "testrevision", "../")
        self.assertEqual(nested.replace('"../', '"'), root)
        self.assertIn('src="../app.js?v=shared-categories-testrevision"', nested)
        self.assertIn('href="../style.css?v=', nested)
        self.assertIn('href="../icon.svg"', nested)
        self.assertIn('src="../icon.svg"', nested)
        self.assertIn("base-uri 'none'", nested)
        self.assertNotIn("<base ", nested)

    def test_unexpected_shell_fails_closed(self):
        html = (ROOT / "site/index.html").read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            prepare.render_entry(html.replace('src="icon.svg"', 'src="other.svg"'), "x")
        with self.assertRaises(ValueError):
            prepare.render_entry(html, "x", "../../")
