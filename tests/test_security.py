import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/"scripts"/(name+".py"))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
security=load("security_check")
prepare=load("prepare_site")
class ArtifactTests(unittest.TestCase):
    def test_blocked_paths(self):
        for path in ["subscriptions.csv","nested/export.csv",".env",".env.production","private/a.txt","Takeout/export.json","site/data/feed.json","secret.key","credentials.json"]:
            self.assertTrue(security.prohibited(path),path)
    def test_allowed_paths(self):
        for path in ["channels.json","site/app.js",".github/workflows/publish.yml"]:
            self.assertFalse(security.prohibited(path),path)
    def test_credential_detection(self):
        self.assertTrue(security.sensitive(("AI"+"za"+"x"*35).encode()))
        self.assertTrue(security.sensitive(("-----BEGIN "+"PRIVATE KEY-----").encode()))
        self.assertFalse(security.sensitive(b"ordinary title"))
    def test_unapproved_video_rejected(self):
        feed={"title":"Test","generatedAt":"today","channels":[],"videos":[{"id":"a"*11,"channelId":"UC"+"x"*22,"title":"x","publishedAt":"today","duration":""}]}
        with self.assertRaises(ValueError):prepare.validate_feed(feed,{"channels":[]})
    def test_config_mismatch_rejected(self):
        feed={"title":"Test","generatedAt":"today","channels":[{"id":"UC"+"x"*22,"title":"x"}],"videos":[]}
        with self.assertRaises(ValueError):prepare.validate_feed(feed,{"channels":[]})
    def test_exact_publish_allowlist(self):
        self.assertEqual(set(prepare.ASSETS),{"index.html","style.css","app.js","icon.svg","data/feed.json"})
if __name__=="__main__":unittest.main()
