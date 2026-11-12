"""Offline request authorization, pending additions, SHA-aware writes and UI guards."""
import base64
import copy
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import podcast_request as p
import process_podcast_request as processor
import build_podcasts as collector

SOURCE='https://podcasts.apple.com/de/podcast/example/id123456'
def body(data):
    return '### Podcast request\n\n```json\n'+json.dumps(data)+'\n```\n\n### Confirmation\n\n- [x] '+p.CONFIRMATION

def event(data=None):
    owner={'login':'linyuli303','id':42029941,'type':'User'}
    return {'action':'opened','repository':{'full_name':p.REPO,'default_branch':'main','owner':owner.copy()},'sender':owner.copy(),
            'issue':{'number':5,'title':p.TITLE,'state':'open','user':owner.copy(),'body':body(data or {'operation':'Add','sourceUrl':SOURCE}),'updated_at':'unchanged'}}
def config():
    return {'version':1,'maxEpisodesPerShow':None,'shows':[]}

class PodcastRequestTests(unittest.TestCase):
    def test_valid_add(self):
        self.assertEqual(p.authorize_event(event())[1]['operation'],'Add')
    def test_owner_pinned(self):
        for who in ('sender',):
            e=event();e[who]['id']=1
            with self.assertRaises(ValueError):p.authorize_event(e)
    def test_author_owner_and_repo(self):
        for where,key,value in [('user','id',1),('owner','id',1)]:
            e=event();(e['issue'] if where=='user' else e['repository'])[where][key]=value
            with self.assertRaises(ValueError):p.authorize_event(e)
        e=event();e['repository']['full_name']='other/repo'
        with self.assertRaises(ValueError):p.authorize_event(e)
    def test_closed_or_pr(self):
        for change in ({'state':'closed'},{'pull_request':{}},{'title':'wrong'}):
            e=event();e['issue'].update(change)
            with self.assertRaises(ValueError):p.authorize_event(e)
    def test_unconfirmed(self):
        with self.assertRaises(ValueError):p.parse_request(body({'operation':'Add','sourceUrl':SOURCE}).replace('[x]','[ ]'))
    def test_duplicate_json_field(self):
        value=body({'operation':'Remove','showId':'apple-1'}).replace('"operation": "Remove"','"operation":"Remove","operation":"Add"')
        with self.assertRaises(ValueError):p.parse_request(value)
    def test_private_or_ambiguous_url_forms(self):
        for value in ('http://feeds.example.org/rss','https://user:pass@feeds.example.org/rss','https://feeds.example.org/rss?token=x','https://feeds.example.org/rss#x','https://127.0.0.1/rss',SOURCE+'?i=123'):
            with self.assertRaises(ValueError):p.source_identity(value)
    def test_rss_identity(self):
        self.assertTrue(p.source_identity('https://feeds.example.org/show.xml').startswith('rss-'))
    def test_add_inert_no_media_permissions(self):
        updated,changed=p.apply_change(config(),{'operation':'Add','sourceUrl':SOURCE})
        self.assertTrue(changed);show=updated['shows'][0]
        self.assertIs(show['enabled'],False)
        self.assertNotIn('mediaHosts',show);self.assertNotIn('feedUrl',show)
        def forbidden(*args):raise AssertionError('Pending source fetched')
        result=collector.collect(updated,fetcher=forbidden)
        self.assertEqual(result['shows'][0]['status'],'pending')
    def test_noop_add(self):
        data={'operation':'Add','sourceUrl':SOURCE}
        updated,_=p.apply_change(config(),data)
        self.assertFalse(p.apply_change(updated,data)[1])
    def test_removal(self):
        updated,_=p.apply_change(config(),{'operation':'Add','sourceUrl':SOURCE})
        result,changed=p.apply_change(updated,{'operation':'Remove','showId':'apple-123456'})
        self.assertTrue(changed);self.assertEqual(result['shows'],[])
    def test_noop_removal(self):
        self.assertFalse(p.apply_change(config(),{'operation':'Remove','showId':'apple-1'})[1])
    def test_pending_cannot_be_enabled(self):
        updated,_=p.apply_change(config(),{'operation':'Add','sourceUrl':SOURCE})
        updated['shows'][0]['enabled']=True
        with self.assertRaises(ValueError):collector.validate_config(updated)

class PodcastProcessorTests(unittest.TestCase):
    def fake(self,e,edited=False):
        calls=[];count=[0]
        def call(method,path,payload=None):
            calls.append((method,path,payload))
            if method=='GET' and '/issues/' in path:
                count[0]+=1;live=copy.deepcopy(e['issue'])
                if edited and count[0]==2:live['updated_at']='edited'
                return live
            if method=='GET':return {'type':'file','path':'podcasts.json','encoding':'base64','sha':'a'*40,'content':base64.b64encode(json.dumps(config()).encode()).decode()}
            return None
        return call,calls
    def test_write_only_config_and_reuse_dispatch(self):
        e=event();call,calls=self.fake(e);processor.process(e,call)
        writes=[c for c in calls if c[0]=='PUT']
        self.assertEqual(len(writes),1);self.assertTrue(writes[0][1].endswith('/contents/podcasts.json'))
        self.assertEqual(writes[0][2]['sha'],'a'*40)
        self.assertEqual(calls[-1][2],{'ref':'main','inputs':{'reuse_published_feed':'true'}})
    def test_live_rechecked_before_write(self):
        e=event();call,calls=self.fake(e,edited=True)
        with self.assertRaises(ValueError):processor.process(e,call)
        self.assertFalse(any(c[0] in ('PUT','POST') for c in calls))
    def test_unauthorized_no_api_calls(self):
        e=event();e['sender']['id']=1;call,calls=self.fake(e)
        with self.assertRaises(ValueError):processor.process(e,call)
        self.assertEqual(calls,[])

class PodcastConfigUITests(unittest.TestCase):
    def test_no_browser_credentials_or_storage(self):
        js=(ROOT/'site/app.js').read_text(encoding='utf-8').split('function initializePodcastConfiguration(shows)',1)[1]
        for forbidden in ('fetch(', 'localStorage','sessionStorage','innerHTML','GH_TOKEN'):
            self.assertNotIn(forbidden,js)
        self.assertIn('podcast-change.yml',js);self.assertIn('window.open(',js)
    def test_workflow_narrow(self):
        workflow=(ROOT/'.github/workflows/podcast-change.yml').read_text(encoding='utf-8')
        self.assertIn("github.actor_id == '42029941'",workflow)
        self.assertIn('ref: main',workflow);self.assertIn('persist-credentials: false',workflow)
        self.assertEqual(workflow.count('GH_TOKEN:'),1)
        self.assertNotIn('github.event.issue.body',workflow)
        self.assertNotIn('YOUTUBE_API_KEY',workflow)


class PodcastEmptyLibraryTests(unittest.TestCase):
    def test_empty_library_collects_without_fetch(self):
        def forbidden(*args):raise AssertionError('Unexpected fetch')
        result=collector.collect(config(),fetcher=forbidden)
        self.assertEqual(result['shows'],[])
        self.assertEqual(result['episodes'],[])
