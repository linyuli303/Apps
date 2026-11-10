import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("feed", Path(__file__).resolve().parents[1]/"scripts/build_feed.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
A = "UC" + "a"*22
B = "UC" + "b"*22

class FeedTests(unittest.TestCase):
    def test_empty_without_key(self):
        self.assertEqual(m.build({"channels":[]},"")["videos"],[])
    def test_key_required(self):
        with self.assertRaises(ValueError): m.build({"channels":[{"id":A}]},"")
    def test_config_validation(self):
        for value in [{"channels":[{"id":"bad"}]},{"channels":[{"handle":"https://example.com"}]},{"channels":[],"max_videos_per_channel":51}]:
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/"config.json";p.write_text(json.dumps(value))
                with self.assertRaises(ValueError):m.read_config(p)
    def test_ownership_and_playability(self):
        def request(resource, params, key):
            if resource=="channels": return {"items":[{"id":A,"snippet":{"title":"Approved"},"contentDetails":{"relatedPlaylists":{"uploads":"UUx"}}}]}
            if resource=="playlistItems": return {"items":[{"contentDetails":{"videoId":str(i)*11}} for i in range(1,6)]}
            values=[]
            for i in range(1,6):
                values.append({"id":str(i)*11,"snippet":{"channelId":B if i==2 else A,"title":"Video","publishedAt":"2026-01-01T00:00:00Z","liveBroadcastContent":"upcoming" if i==5 else "none"},"status":{"privacyStatus":"private" if i==3 else "public","embeddable":i!=4}})
            return {"items":values}
        result=m.build({"channels":[{"id":A}]},"fake",request)
        self.assertEqual([v["id"] for v in result["videos"]],["1"*11])
    def test_unknown_channel_fails(self):
        with self.assertRaises(ValueError):m.build({"channels":[{"id":A}]},"fake",lambda *args:{"items":[]})


class TakeoutTests(unittest.TestCase):
    def write_csv(self, directory, rows, header="Channel ID,Channel URL,Channel title"):
        p=Path(directory)/"subscriptions.csv"
        with p.open("w", encoding="utf-8-sig", newline="") as f:
            f.write(header+"\n")
            import csv
            csv.writer(f).writerows(rows)
        return p
    def test_bom_unicode_and_dedup(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.write_csv(d,[(A,"http://www.youtube.com/channel/"+A,"音樂, Music"),(A,"","Duplicate"),(B,"","Music Topic")])
            self.assertEqual(m.read_subscriptions(p),[{"id":A},{"id":B}])
    def test_wrong_header(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.write_csv(d,[],"Wrong header")
            with self.assertRaises(ValueError):m.read_subscriptions(p)
    def test_invalid_id_and_url(self):
        with tempfile.TemporaryDirectory() as d:
            for row in [("invalid","","Name"),(A,"https://www.youtube.com/channel/"+B,"Mismatch"),("","","Missing")]:
                p=self.write_csv(d,[row])
                with self.assertRaises(ValueError):m.read_subscriptions(p)
    def test_empty_import(self):
        with tempfile.TemporaryDirectory() as d:
            p=self.write_csv(d,[])
            with self.assertRaises(ValueError):m.read_subscriptions(p)
    def test_over_100_subscriptions(self):
        with tempfile.TemporaryDirectory() as d:
            self.write_csv(d,[("UC"+str(i).zfill(22),"","Channel") for i in range(275)])
            config=Path(d)/"channels.json"
            config.write_text(json.dumps({"subscriptions_csv":"subscriptions.csv"}))
            self.assertEqual(len(m.read_subscriptions(Path(d)/"subscriptions.csv")),275)
            with self.assertRaises(ValueError):m.read_config(config)
    def test_missing_csv(self):
        with tempfile.TemporaryDirectory() as d:
            config=Path(d)/"channels.json"
            config.write_text(json.dumps({"subscriptions_csv":"subscriptions.csv"}))
            with self.assertRaises(ValueError):m.read_config(config)
    def test_mutually_exclusive_sources(self):
        with tempfile.TemporaryDirectory() as d:
            config=Path(d)/"channels.json"
            config.write_text(json.dumps({"subscriptions_csv":"subscriptions.csv","channels":[{"id":A}]}))
            with self.assertRaises(ValueError):m.read_config(config)

class SecurityTests(unittest.TestCase):
    def test_unknown_config_and_csv_mode_rejected(self):
        for config in [{"channels":[],"api_key":"not-a-real-key"},{"subscriptions_csv":"subscriptions.csv"},{"title":"missing channels"}]:
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/"channels.json";p.write_text(json.dumps(config))
                with self.assertRaises(ValueError):m.read_config(p)
    def test_duplicate_csv_headers_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"subscriptions.csv";p.write_text("Channel ID,Channel ID\n"+A+","+A)
            with self.assertRaises(ValueError):m.read_subscriptions(p)
    def test_malformed_field_count(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"subscriptions.csv";p.write_text("Channel ID,Channel URL\n"+A+",,extra")
            with self.assertRaises(ValueError):m.read_subscriptions(p)
    def test_api_resource_restricted(self):
        with self.assertRaises(ValueError):m.api("https://example.invalid",{},"fake")
    def test_empty_config_valid(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"channels.json";p.write_text(json.dumps({"channels":[]}))
            self.assertEqual(m.read_config(p)["channels"],[])

if __name__=="__main__":unittest.main()

