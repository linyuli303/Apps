"""Offline guards for the read-only resolver / privileged apply boundary."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import podcast_resolution as p
spec=importlib.util.spec_from_file_location('request_fixtures',ROOT/'tests/test_podcast_requests.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

class ResolutionTests(unittest.TestCase):
    def ready(self):
        c=fixture.config()
        show={'id':'apple-1','title':'Existing','enabled':True,'feedUrl':'https://feeds.example.org/one','feedHosts':['feeds.example.org'],'mediaHosts':['audio.example.org']}
        c['shows']=[show]
        e=fixture.event()
        record=dict(show,id='apple-123456',title='New',feedUrl='https://feeds.example.org/new')
        result={'status':'ready','show':record,'episodeCount':4}
        envelope=p.prepare(e,c,lambda *_:result)
        return e,c,envelope
    def test_activation(self):
        e,c,r=self.ready();updated,changed,msg,publish=p.apply_validated(e,c,r)
        self.assertTrue(changed);self.assertTrue(publish)
        self.assertEqual(len(updated['shows']),2)
        self.assertEqual(len(c['shows']),1)
    def test_stale_config(self):
        e,c,r=self.ready();c['shows'][0]['title']='Changed'
        with self.assertRaises(ValueError):p.apply_validated(e,c,r)
    def test_edited_issue(self):
        e,c,r=self.ready();e['issue']['updated_at']='Changed'
        with self.assertRaises(ValueError):p.apply_validated(e,c,r)
    def test_unapproved_host(self):
        e,c,r=self.ready();r['result']['show']['mediaHosts']=['new.example.org']
        with self.assertRaises(ValueError):p.apply_validated(e,c,r)
    def test_wrong_identity(self):
        e,c,r=self.ready();r['result']['show']['id']='apple-999'
        with self.assertRaises(ValueError):p.apply_validated(e,c,r)
    def test_review_does_not_write_or_publish(self):
        e,c,r=self.ready();r['result']={'status':'approval_required','mediaHostsToReview':['new.example.org']}
        updated,changed,msg,publish=p.apply_validated(e,c,r)
        self.assertFalse(changed);self.assertFalse(publish);self.assertEqual(updated,c)
    def test_removal_without_resolution_network(self):
        e=fixture.event({'operation':'Remove','showId':'apple-1'});c=fixture.config()
        def forbidden(*args):raise AssertionError('network')
        r=p.prepare(e,c,forbidden)
        self.assertEqual(r['result'],{'status':'remove'})
    def test_decode_limits(self):
        for value in ('!'*10,'a'*64001):
            with self.assertRaises(ValueError):p.decode(value)
    def test_resolver_failure_review(self):
        def fail(*args):raise OSError('details not published')
        r=p.prepare(fixture.event(),fixture.config(),fail)
        self.assertEqual(r['result']['status'],'review_required')
    def test_readonly_job(self):
        w=(ROOT/'.github/workflows/podcast-change.yml').read_text(encoding='utf-8')
        read=w.split('  resolve:',1)[1].split('  apply:',1)[0]
        self.assertNotIn('GH_TOKEN',read);self.assertNotIn('contents: write',read)
        self.assertIn('needs: resolve',w)
    def test_inactive_not_in_filter(self):
        j=(ROOT/'site/app.js').read_text(encoding='utf-8')
        self.assertIn('if (show.status === "ok") $("podcast-show").append',j)
