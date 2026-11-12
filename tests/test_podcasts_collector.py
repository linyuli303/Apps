"""Offline podcast collector tests: never request feeds or media."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('podcast_collector',ROOT/'scripts/build_podcasts.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
NOW = datetime(2026,11,12,tzinfo=timezone.utc)
SHOW = {'id':'apple-1','title':'Test','enabled':True,'feedUrl':'https://feeds.example.org/rss',
        'feedHosts':['feeds.example.org'],'mediaHosts':['audio.example.org']}

def rss(items):
    return ('<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>'+items+'</channel></rss>').encode()

def item(title='Episode',guid='one',date='Wed, 11 Nov 2026 12:00:00 GMT',url='https://audio.example.org/a.mp3',duration='01:02:03'):
    return ('<item><title>'+title+'</title><guid>'+guid+'</guid><pubDate>'+date+
            '</pubDate><itunes:duration>'+duration+'</itunes:duration><enclosure url="'+url+
            '" type="audio/mpeg"/></item>')

class PodcastCollectorTests(unittest.TestCase):
    def config(self,shows=None):
        return {'version':1,'maxEpisodesPerShow':15,'shows':[SHOW.copy()] if shows is None else shows}
    def test_config(self):
        self.assertIs(p.validate_config(self.config())['shows'][0]['enabled'],True)
    def test_config_rejects_bad_limit(self):
        for n in (True,0,101):
            c=self.config(); c['maxEpisodesPerShow']=n
            with self.assertRaises(p.PodcastError): p.validate_config(c)
    def test_config_rejects_duplicate_show(self):
        with self.assertRaises(p.PodcastError): p.validate_config(self.config([SHOW,SHOW]))
    def test_duration_formats(self):
        for value,want in [('2217',2217),('32:56',1976),('01:03:19',3799),('0',0)]:
            self.assertEqual(p.duration_seconds(value),want)
    def test_invalid_duration(self):
        for value in ('1:99','1:99:00','NaN','-1','999999999',None):
            self.assertIsNone(p.duration_seconds(value))
    def test_dates(self):
        self.assertIsNotNone(p.published_date('Wed, 11 Nov 2026 12:00:00 GMT'))
        self.assertIsNone(p.published_date('nonsense'))
        self.assertIsNone(p.published_date('11 Nov 2026 12:00:00'))
    def test_negative_zero_timezone(self):
        date = p.published_date("Wed, 11 Nov 2026 04:00:00 -0000")
        self.assertEqual(
            date, datetime(2026, 11, 11, 4, tzinfo=timezone.utc)
        )
        self.assertIsNone(
            p.published_date("Wed, 11 Nov 2026 04:00:00")
        )
        episodes, _ = p.parse_feed(
            rss(item(date="Wed, 11 Nov 2026 04:00:00 -0000")),
            SHOW, 15, NOW,
        )
        self.assertEqual(
            episodes[0]["publishedAt"], "2026-11-11T04:00:00Z"
        )

    def test_url_boundary(self):
        for url in ('http://audio.example.org/a','https://evil.example.org/a',
                    'https://user:pass@audio.example.org/a','https://audio.example.org:444/a',
                    'https://audio.example.org/a#x','https://audio.example.org/evil\n',
                    'https://audio.example.org\\@evil.example.org/a'):
            with self.assertRaises(p.PodcastError): p.checked_url(url,SHOW['mediaHosts'])
    def test_public_dns(self):
        with patch.object(p.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(p.PodcastError): p.public_addresses('feeds.example.org')
    def test_parse(self):
        episodes,stats=p.parse_feed(rss(item()),SHOW,15,NOW)
        self.assertEqual(len(episodes),1)
        self.assertEqual(episodes[0]['durationSeconds'],3723)
        self.assertEqual(len(episodes[0]['id']),64)
        self.assertEqual(stats['rejected'],0)
    def test_title_not_interpreted_as_html(self):
        episodes,_=p.parse_feed(rss(item(title='&lt;script&gt;not executed&lt;/script&gt;')),SHOW,15,NOW)
        self.assertEqual(episodes[0]['title'],'<script>not executed</script>')
    def test_duplicate_and_limit(self):
        raw=rss(item()+item()+item(guid='two'))
        episodes,stats=p.parse_feed(raw,SHOW,1,NOW)
        self.assertEqual(stats['eligible'],2)
        self.assertEqual(len(episodes),1)
    def test_newest_sort(self):
        episodes,_=p.parse_feed(rss(item(guid='old',date='Tue, 10 Nov 2026 12:00:00 GMT')+item(guid='new')),SHOW,15,NOW)
        self.assertGreater(episodes[0]['publishedAt'],episodes[1]['publishedAt'])
    def test_unsafe_media_and_future_rejected(self):
        raw=rss(item(url='http://audio.example.org/a.mp3')+item(date='Fri, 13 Nov 2026 12:00:00 GMT'))
        with self.assertRaises(p.PodcastError): p.parse_feed(raw,SHOW,15,NOW)
    def test_dtd_and_utf16_rejected(self):
        raw='<!DOCTYPE rss [<!ENTITY x "bad">]><rss><channel/></rss>'
        for encoding in ('utf-8','utf-16'):
            with self.assertRaises(p.PodcastError): p.parse_feed(raw.encode(encoding),SHOW,15,NOW)
    def test_malformed_xml(self):
        with self.assertRaises(p.PodcastError): p.parse_feed(b'<rss>',SHOW,15,NOW)
    def test_oversize(self):
        with patch.object(p,'MAX_BYTES',10):
            with self.assertRaises(p.PodcastError): p.parse_feed(rss(item()),SHOW,15,NOW)
    def test_collection_no_media_request(self):
        calls=[]
        def fetch(url,hosts):
            calls.append(url); return rss(item())
        c=p.collect(self.config(),fetcher=fetch,now=NOW)
        self.assertEqual(calls,[SHOW['feedUrl']])
        self.assertEqual(c['shows'][0]['status'],'ok')
    def test_disabled_source_not_contacted(self):
        s=dict(SHOW,enabled=False)
        def forbidden(*args): raise AssertionError('Must not fetch')
        c=p.collect(self.config([s]),fetcher=forbidden,now=NOW)
        self.assertEqual(c['shows'][0]['status'],'pending')
    def test_failure_visible_without_error_leak(self):
        def fail(*args): raise RuntimeError('secret input contents')
        c=p.collect(self.config(),fetcher=fail,now=NOW)
        self.assertEqual(c['shows'][0]['status'],'unavailable')
        self.assertNotIn('secret',str(c))
    def test_checked_redirect_blocks_before_second_connection(self):
        class Response:
            status=302
            def getheader(self,key,default=None): return 'https://evil.example.org/rss'
        class Connection:
            def __init__(self,*args): pass
            def request(self,*args,**kwargs): pass
            def getresponse(self): return Response()
            def close(self): pass
        with patch.object(p,'public_addresses',return_value=['8.8.8.8']),patch.object(p,'PinnedHTTPS',Connection):
            with self.assertRaises(p.PodcastError): p.fetch_feed(SHOW['feedUrl'],SHOW['feedHosts'])
