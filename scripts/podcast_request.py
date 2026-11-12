"""Pure owner podcast request validation; additions remain pending, never fetched."""
import copy
import hashlib
import json
import re
from urllib.parse import urlsplit
from build_podcasts import validate_config, host_name

TITLE = '[MyApps] Podcast change'
CONFIRMATION = 'I reviewed this public podcast request and understand that additions remain pending until source and media-host approval.'
OWNER_ID = 42029941
REPO = 'linyuli303/Apps'

def source_identity(value):
    if not isinstance(value,str) or not 1<=len(value)<=2048 or any(ord(c)<=32 or ord(c)>=127 for c in value) or '\\' in value:
        raise ValueError('Invalid source URL')
    p=urlsplit(value)
    if p.scheme!='https' or not p.hostname or p.username is not None or p.password is not None or p.port not in (None,443) or p.query or p.fragment:
        raise ValueError('Use a plain public HTTPS link with no query, credentials or fragment')
    host_name(p.hostname)
    if p.hostname=='podcasts.apple.com':
        match=re.fullmatch(r'/(?:[a-z]{2}/)?podcast/(?:[^/]+/)?id([0-9]{1,20})/?',p.path)
        if not match:raise ValueError('Use an Apple show link, not an episode link')
        return 'apple-'+match.group(1)
    if not p.path or p.path=='/':raise ValueError('RSS source path required')
    return 'rss-'+hashlib.sha256(value.encode('ascii')).hexdigest()[:32]

def parse_request(body):
    if not isinstance(body,str) or len(body)>6000:raise ValueError('Invalid request')
    body=body.replace('\r\n','\n').strip()
    pattern=(r'### Podcast request\n+```json\n([^`]+)\n```\n+'
             r'### Confirmation\n+- \[x\] '+re.escape(CONFIRMATION))
    match=re.fullmatch(pattern,body)
    if not match:raise ValueError('Use the reviewed request form')
    def unique(pairs):
        result={}
        for k,v in pairs:
            if k in result:raise ValueError('Duplicate field')
            result[k]=v
        return result
    data=json.loads(match.group(1),object_pairs_hook=unique)
    if not isinstance(data,dict) or data.get('operation') not in ('Add','Remove'):raise ValueError('Invalid operation')
    if data['operation']=='Add':
        if set(data)!={'operation','sourceUrl'}:raise ValueError('Invalid addition fields')
        source_identity(data['sourceUrl'])
    else:
        if set(data)!={'operation','showId'} or not isinstance(data['showId'],str) or not re.fullmatch(r'(?:apple-[0-9]{1,20}|rss-[0-9a-f]{32})',data['showId']):
            raise ValueError('Invalid removal')
    return data

def authorize_event(event):
    if not isinstance(event,dict) or event.get('action')!='opened':raise ValueError('Unauthorized event')
    repo=event.get('repository',{});issue=event.get('issue',{});sender=event.get('sender',{})
    if not all(isinstance(v,dict) for v in (repo,issue,sender)):raise ValueError('Invalid event')
    owner=repo.get('owner',{});author=issue.get('user',{})
    if not isinstance(owner,dict) or not isinstance(author,dict):raise ValueError('Invalid owner')
    if (repo.get('full_name')!=REPO or repo.get('default_branch')!='main' or
        any(type(u.get('id')) is not int or u.get('id')!=OWNER_ID or u.get('login')!='linyuli303' or u.get('type')!='User' for u in (owner,author,sender)) or
        'pull_request' in issue or issue.get('state')!='open' or type(issue.get('number')) is not int or issue['number']<=0 or issue.get('title')!=TITLE):
        raise ValueError('Unauthorized issue')
    return issue['number'],parse_request(issue.get('body'))

def apply_change(config,data):
    validate_config(config)
    result=copy.deepcopy(config)
    if data['operation']=='Remove':
        result['shows']=[s for s in result['shows'] if s['id']!=data['showId']]
    else:
        source=data['sourceUrl'];sid=source_identity(source)
        if not any(s['id']==sid or s.get('sourceUrl')==source or s.get('feedUrl')==source for s in result['shows']):
            if len(result['shows'])>=100:raise ValueError('Show limit reached')
            result['shows'].append({'id':sid,'title':'Pending source: '+urlsplit(source).hostname+' ('+sid+')','enabled':False,'sourceUrl':source})
    validate_config(result)
    return result,result!=config
