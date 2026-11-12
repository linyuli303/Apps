"""Offline checks for metadata-only browsing."""
from pathlib import Path
import sys
import unittest
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import podcasts_public as p
def without_spotify_helpers(source):
    """Exclude only the independent Spotify block, retaining podcast config."""
    start = "// Spotify authorization foundation:"
    end = (
        "// Public GitHub request forms only: "
        "no token, persistent draft or source lookup."
    )
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError("Unexpected application boundaries")
    first = source.index(start)
    last = source.index(end)
    if last <= first:
        raise ValueError("Unexpected application source order")
    return source[:first] + source[last:]


class PodcastBrowsingTests(unittest.TestCase):
    def fixture(self):
        config={'version':1,'maxEpisodesPerShow':15,'shows':[{'id':'apple-1','title':'Test','enabled':True,'feedUrl':'https://feed.example.org/rss','feedHosts':['feed.example.org'],'mediaHosts':['media.example.org']}]}
        data={'version':1,'generatedAt':'2026-11-12T00:00:00Z','shows':[{'id':'apple-1','title':'Test','status':'ok','episodeCount':1}],'episodes':[{'id':'a'*64,'showId':'apple-1','title':'Example','publishedAt':'2026-11-11T00:00:00Z','durationSeconds':100,'mediaUrl':'https://media.example.org/a.mp3','mediaType':'audio/mpeg'}]}
        return data,config
    def validate(self,data,config):
        return p.validate(data,config,datetime(2026,11,12,tzinfo=timezone.utc))
    def test_validated_playback_media_included(self):
        data,config=self.fixture()
        self.assertEqual(self.validate(data,config)['episodes'][0]['mediaUrl'],data['episodes'][0]['mediaUrl'])
    def test_unapproved_host(self):
        data,config=self.fixture();data['episodes'][0]['mediaUrl']='https://evil.example.org/a'
        with self.assertRaises(ValueError):self.validate(data,config)
    def test_stale(self):
        data,config=self.fixture();data['generatedAt']='2026-11-09T00:00:00Z'
        with self.assertRaises(ValueError):self.validate(data,config)
    def test_counts(self):
        data,config=self.fixture();data['shows'][0]['episodeCount']=2
        with self.assertRaises(ValueError):self.validate(data,config)
    def test_duplicates(self):
        data,config=self.fixture();data['episodes']*=2
        with self.assertRaises(ValueError):self.validate(data,config)
    def test_missing_catalogue(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(p.package(Path(folder),p.MARKER),p.MARKER)
    def test_no_media_or_storage(self):
        js=without_spotify_helpers((ROOT/'site/app.js').read_text(encoding='utf-8')).split('// Replaced by prepare_site.py only. Validated public media',1)[1]
        for forbidden in ('fetch(', 'localStorage', 'sessionStorage', 'innerHTML', 'createElement("img")'):
            self.assertNotIn(forbidden,js)
    def test_five_assets_retained(self):
        src=(ROOT/'scripts/prepare_site.py').read_text(encoding='utf-8')
        self.assertIn('ASSETS=("index.html","style.css","app.js","icon.svg","data/feed.json")',src)
        self.assertIn('package_podcasts(ROOT, public_js)',src)


class PodcastAllCatalogueTests(unittest.TestCase):
    fixture = PodcastBrowsingTests.fixture
    validate = PodcastBrowsingTests.validate
    def test_all_mode_packaging_over_old_limit(self):
        data,config=self.fixture()
        config['maxEpisodesPerShow']=None
        episode=data['episodes'][0]
        data['episodes']=[dict(episode,id=format(i,'064x')) for i in range(125)]
        data['shows'][0]['episodeCount']=125
        snapshot=self.validate(data,config)
        self.assertEqual(len(snapshot['episodes']),125)
        self.assertTrue(all(e['mediaUrl'].startswith('https://media.example.org/') for e in snapshot['episodes']))

    def test_all_mode_safety_bound(self):
        from unittest.mock import patch
        import build_podcasts
        data,config=self.fixture()
        config['maxEpisodesPerShow']=None
        data['shows'][0]['episodeCount']=2
        data['episodes'].append(dict(data['episodes'][0],id='b'*64))
        with patch.object(build_podcasts,'MAX_ITEMS',1):
            with self.assertRaises(ValueError):self.validate(data,config)

    def test_all_mode_count_mismatch(self):
        data,config=self.fixture()
        config['maxEpisodesPerShow']=None
        data['shows'][0]['episodeCount']=2
        with self.assertRaises(ValueError):self.validate(data,config)


class PodcastPlayerPolicyTests(unittest.TestCase):
    def test_lazy_audio_source(self):
        js=(ROOT/'site/app.js').read_text(encoding='utf-8')
        engine=without_spotify_helpers(js).split('function createPodcastPlayer(',1)[1]
        self.assertIn('audio.preload = "none"',engine)
        self.assertIn('audio.src = episode.mediaUrl',engine)
        self.assertIn('audio.crossOrigin = "anonymous"',engine)
        self.assertIn('audio.removeAttribute("crossorigin")',engine)
        self.assertNotIn('localStorage',engine)
        self.assertNotIn('sessionStorage',engine)
        self.assertNotIn('fetch(',engine)
        self.assertNotIn('innerHTML',engine)
    def test_exact_media_hosts(self):
        html=(ROOT/'site/index.html').read_text(encoding='utf-8')
        self.assertIn('media-src https://',html)
        policy=html.split('media-src ',1)[1].split(';',1)[0]
        self.assertNotIn('*',policy)
        self.assertNotIn('https: ',policy)
        self.assertNotIn('blob:',policy)
    def test_shared_player_handoff(self):
        js=(ROOT/'site/app.js').read_text(encoding='utf-8')
        self.assertIn('window.MyAppsPodcastPlayer.pauseForVideo()',js)
        self.assertIn('if (!$("player").hidden) closePlayer()',js)
    def test_repeat_and_reorder(self):
        js=(ROOT/'site/app.js').read_text(encoding='utf-8')
        engine=without_spotify_helpers(js).split('function createPodcastPlayer(',1)[1]
        self.assertIn('repeat==="one"',engine)
        self.assertIn('row.draggable=true',engine)
        self.assertIn('audio.removeAttribute("src")',engine)
        self.assertIn('from<=index||to<=index',engine)
