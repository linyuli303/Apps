"""Offline shared snapshot packaging and frontend integration checks."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path: sys.path.insert(0, str(ROOT / "scripts"))
from shared_categories_public import package, MARKER

class SharedCategoryFrontendTests(unittest.TestCase):
    def test_snapshot_hash_filter_and_source_unchanged(self):
        cid = "UC" + "a" * 22
        raw = (json.dumps({"version":1,"categories":[{"id":"cat-0","name":"News"}],"assignments":{cid:["cat-0"]}}) + "\n").encode()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/"categories.json").write_bytes(raw)
            (root/"channels.json").write_text('{"channels":[]}',encoding="utf-8")
            result, revision = package(root, MARKER)
            self.assertEqual(revision, hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest())
            payload = json.loads(result.split("JSON.parse(",1)[1].rsplit(");",1)[0])
            snapshot = json.loads(payload)
            self.assertEqual(snapshot["model"]["assignments"], {})
            self.assertEqual((root/"categories.json").read_bytes(),raw)
            with self.assertRaises(ValueError): package(root, "no marker")

    def test_controls_and_local_draft_isolation(self):
        js = (ROOT/"site/app.js").read_text(encoding="utf-8")
        html = (ROOT/"site/index.html").read_text(encoding="utf-8")
        for name in ("category-save-shared","player-category-save","category-review","category-request-text","category-migrate-local","category-reload-published"):
            self.assertIn('id="'+name+'"', html)
        self.assertIn('approved-yt-category-draft-v2:',js)
        self.assertIn('state.baseRevision !== state.revision',js)
        self.assertIn('url.searchParams.set("category_request", payload)',js)
        self.assertNotIn("innerHTML",js)

    def test_packaging_preserves_five_assets_and_feed_schema(self):
        import prepare_site
        self.assertEqual(set(prepare_site.ASSETS), {"index.html","style.css","app.js","icon.svg","data/feed.json"})
        js=(ROOT/"site/app.js").read_text(encoding="utf-8")
        self.assertEqual(js.count(MARKER),1)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/"categories.json").write_text((ROOT/"categories.json").read_text(encoding="utf-8"),encoding="utf-8")
            (root/"channels.json").write_text('{"channels":[]}',encoding="utf-8")
            packaged,_=package(root,js)
            self.assertIn('const SHARED_CATEGORY_SNAPSHOT = JSON.parse(',packaged)

if __name__ == "__main__": unittest.main()
