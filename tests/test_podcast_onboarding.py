from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
"""Offline onboarding tests; fake directory/RSS responses, never network."""
import json
import unittest
from datetime import datetime, timezone
import podcast_onboarding as p

APPLE='https://podcasts.apple.com/at/podcast/die-openai-story/id1814608156'
FEED='https://feeds.example.org/old-series.xml'
NOW=datetime(2026,11,12,tzinfo=timezone.utc)

def config():
    return {'version':1,'maxEpisodesPerShow':None,'shows':[{
        'id':'apple-1','title':'Existing','enabled':True,
        'feedUrl':'https://feeds.example.org/first.xml','feedHosts':['feeds.example.org'],
        'mediaHosts':['audio.example.org']} ]}

def rss(host='audio.example.org',title='Die OpenAI Story'):
    return ('<rss><channel><title>'+title+'</title><item><title>Episode one</title>'
            '<guid>one</guid><pubDate>Wed, 11 Nov 2026 04:00:00 -0000</pubDate>'
            '<enclosure url="https://'+host+'/one.mp3" type="audio/mpeg"/>'
            '</item></channel></rss>').encode()

def fake(feed=FEED,xml=None):
    calls=[]
    def fetch(url,hosts):
        calls.append(url)
        if url.startswith('https://itunes.apple.com/'):
            return json.dumps({'results':[{'collectionId':1814608156,'kind':'podcast','feedUrl':feed}]}).encode()
        return xml if xml is not None else rss()
    return fetch,calls

class OnboardingTests(unittest.TestCase):
    def test_apple_storefront_and_old_path(self):
        fetch,calls=fake();result=p.resolve(APPLE,config(),fetch,NOW)
        self.assertEqual(result['status'],'ready')
        self.assertEqual(result['show']['title'],'Die OpenAI Story')
        self.assertEqual(result['show']['feedUrl'],FEED)
        self.assertIn('country=at',calls[0])
        self.assertEqual(len(calls),2)
    def test_direct_rss(self):
        fetch,calls=fake();result=p.resolve(FEED,config(),fetch,NOW)
        self.assertEqual(result['status'],'ready')
        self.assertTrue(result['show']['id'].startswith('rss-'))
        self.assertEqual(calls,[FEED])
    def test_unknown_media_host_needs_approval(self):
        fetch,_=fake(xml=rss('new.example.org'));result=p.resolve(APPLE,config(),fetch,NOW)
        self.assertEqual(result['status'],'approval_required')
        self.assertEqual(result['mediaHostsToReview'],['new.example.org'])
        self.assertNotIn('show',result)
    def test_no_audio_requests(self):
        fetch,calls=fake();p.resolve(APPLE,config(),fetch,NOW)
        self.assertFalse(any('audio.example.org' in u for u in calls))
    def test_http_feed_requires_review(self):
        fetch,calls=fake(feed='http://feeds.example.org/rss')
        self.assertEqual(p.resolve(APPLE,config(),fetch,NOW)['reason'],'rss_requires_https_review')
        self.assertEqual(len(calls),1)
    def test_duplicate(self):
        c=config();c['shows'][0]['feedUrl']=FEED
        fetch,calls=fake();self.assertEqual(p.resolve(APPLE,c,fetch,NOW)['status'],'already_subscribed')
        self.assertEqual(len(calls),1)
    def test_unsafe_input(self):
        for value in (APPLE+'?i=123','http://feeds.example.org/rss','https://user:pass@feeds.example.org/rss','https://127.0.0.1/rss'):
            with self.assertRaises(ValueError):p.input_source(value)
    def test_entity_feed_rejected(self):
        fetch,_=fake(xml=b'<!DOCTYPE rss [<!ENTITY x "unsafe">]><rss><channel/></rss>')
        self.assertEqual(p.resolve(APPLE,config(),fetch,NOW)['status'],'review_required')
    def test_original_config_unchanged(self):
        c=config();before=json.dumps(c,sort_keys=True);fetch,_=fake();p.resolve(APPLE,c,fetch,NOW)
        self.assertEqual(before,json.dumps(c,sort_keys=True))
