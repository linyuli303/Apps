import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("builder",ROOT/"scripts/build_feed.py")
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class HardeningTests(unittest.TestCase):
    def test_handles_rejected(self):
        for channels in [[{"handle":"@Example"}],[{"id":"UC"+"a"*22},{"id":"UC"+"a"*22}]]:
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/"c.json";p.write_text(json.dumps({"channels":channels}))
                with self.assertRaises(ValueError):builder.read_config(p)
    def test_all_actions_immutable(self):
        text=(ROOT/".github/workflows/publish.yml").read_text()
        uses=re.findall(r"uses:\s*(\S+)",text)
        self.assertEqual(len(uses),4)
        self.assertTrue(all(re.fullmatch(r"actions/[a-z-]+@[a-f0-9]{40}",v) for v in uses))
    def test_branch_environment_guards(self):
        text=(ROOT/".github/workflows/publish.yml").read_text()
        self.assertEqual(text.count("if: github.ref == 'refs/heads/main'"),2)
        self.assertIn("environment: youtube-refresh",text)
        self.assertNotIn("pull_request_target",text)
    def test_paging_and_staleness(self):
        text=(ROOT/"site/app.js").read_text(encoding="utf-8")
        self.assertIn("visible.slice(page * PAGE_SIZE",text)
        self.assertIn("enabledIDs.has(id)",text)
        self.assertIn("MAX_FEED_AGE_MS",text)
if __name__=="__main__":unittest.main()
