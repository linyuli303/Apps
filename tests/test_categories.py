"""Category integration checks; interactive behavior also needs browser tests."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CategoryTests(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "site/app.js").read_text(encoding="utf-8")
        self.html = (ROOT / "site/index.html").read_text(encoding="utf-8")

    def test_filters_both_views_without_replacing_approval(self):
        self.assertIn("categoryAllows(v.channelId)", self.js)
        self.assertIn("categoryAllows(channel.id)", self.js)
        self.assertIn("draftAllows(v.channelId)", self.js)

    def test_modal_and_backup_controls(self):
        for name in (
            "category-editor", "category-menu",
            "category-import", "category-export",
        ):
            self.assertIn('id="' + name + '"', self.html)
        self.assertIn("dialog.showModal()", self.js)
        self.assertIn("No channels or videos will be deleted.", self.js)

    def test_persistence_and_stable_assignments(self):
        self.assertIn("approved-yt-categories-v1:", self.js)
        self.assertIn("category.name = input.value.trim()", self.js)
        self.assertIn("tags.includes(selected)", self.js)
        self.assertNotIn("innerHTML", self.js)

    @unittest.skipUnless(shutil.which("node"), "Node.js unavailable")
    def test_javascript_syntax(self):
        result = subprocess.run(
            [shutil.which("node"), "--check", str(ROOT / "site/app.js")],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(shutil.which("node"), "Node.js unavailable")
    def test_backup_validation(self):
        start = self.js.index("function validateCategoryData(value) {")
        end = self.js.index("function categoryState()", start)
        program = self.js[start:end] + r"""
const good={
  version:1,
  categories:[{id:'cat-a',name:'News'}],
  assignments:{['UC'+'a'.repeat(22)]:['cat-a']}
};
validateCategoryData(good);
const cases=[
  {...good,version:2},
  {...good,categories:[{id:'cat-a',name:'Uncategorized'}]},
  {...good,categories:[...good.categories,{id:'cat-b',name:'news'}]},
  {...good,assignments:{bad:['cat-a']}},
  {...good,assignments:{['UC'+'a'.repeat(22)]:['cat-missing']}}
];
for(const value of cases){
  let rejected=false;
  try{validateCategoryData(value)}catch{rejected=true}
  if(!rejected)process.exit(1);
}
"""
        result = subprocess.run(
            [shutil.which("node"), "-e", program],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

if __name__ == "__main__":
    unittest.main()
