"""Validate an optional generated catalogue for explicit podcast playback.
Validated media URLs are public; raw RSS and publisher descriptions are excluded.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import re

MARKER = 'const PODCAST_PUBLIC_SNAPSHOT = null;'

def validate(data, config, now=None):
    from build_podcasts import validate_config, MAX_ITEMS
    validate_config(config)
    if not isinstance(data,dict) or set(data) != {'version','generatedAt','shows','episodes'} or type(data['version']) is not int or data['version'] != 1:
        raise ValueError('Invalid catalogue')
    def date(value):
        if not isinstance(value,str) or len(value)>100:
            raise ValueError('Invalid date')
        result=datetime.fromisoformat(value.replace('Z','+00:00'))
        if result.tzinfo is None: raise ValueError('Timezone required')
        return result
    generated=date(data['generatedAt'])
    now=now or datetime.now(timezone.utc)
    if not -300 <= (now-generated).total_seconds() <= 86400:
        raise ValueError('Catalogue stale or future')
    approved={s['id']:s for s in config['shows']}
    per_show_limit = MAX_ITEMS if config['maxEpisodesPerShow'] is None else config['maxEpisodesPerShow']
    if not isinstance(data['shows'],list) or len(data['shows']) != len(approved) or not isinstance(data['episodes'],list) or len(data['episodes']) > len(approved)*per_show_limit:
        raise ValueError('Invalid catalogue lists')
    shows, status={}, {}
    for s in data['shows']:
        if not isinstance(s,dict) or set(s) not in ({'id','title','status','episodeCount'},{'id','title','status','episodeCount','inspection'}):
            raise ValueError('Invalid show record')
        key=s['id']
        if key not in approved or key in shows or s['title'] != approved[key]['title'] or s['status'] not in ('ok','pending','unavailable') or type(s['episodeCount']) is not int:
            raise ValueError('Unapproved show')
        if not 0 <= s['episodeCount'] <= per_show_limit or (s['status'] != 'ok' and s['episodeCount'] != 0) or (s['status']=='ok' and (not approved[key]['enabled'] or not s['episodeCount'])):
            raise ValueError('Invalid show status/count')
        shows[key]={k:s[k] for k in ('id','title','status','episodeCount')}
        status[key]=s['status']
    seen=set(); episodes=[]; counts={key:0 for key in shows}
    for e in data['episodes']:
        if not isinstance(e,dict) or set(e) != {'id','showId','title','publishedAt','durationSeconds','mediaUrl','mediaType'}:
            raise ValueError('Invalid episode schema')
        if not isinstance(e['id'],str) or not re.fullmatch('[0-9a-f]{64}',e['id']) or e['id'] in seen or e['showId'] not in shows or status[e['showId']]!='ok':
            raise ValueError('Invalid episode identity')
        if not isinstance(e['title'],str) or not 1<=len(e['title'])<=1000 or any(ord(ch)<32 for ch in e['title']):
            raise ValueError('Invalid episode title')
        if date(e['publishedAt']).timestamp()>generated.timestamp()+300:
            raise ValueError('Future episode')
        duration=e['durationSeconds']
        if duration is not None and (type(duration) is not int or not 0<=duration<=604800):
            raise ValueError('Invalid duration')
        # Validate media too, even though browsing does not expose or request it.
        from build_podcasts import checked_url
        checked_url(e['mediaUrl'],approved[e['showId']]['mediaHosts'])
        if not isinstance(e['mediaType'],str) or not e['mediaType'].startswith('audio/') or len(e['mediaType'])>100:
            raise ValueError('Invalid media type')
        seen.add(e['id']); counts[e['showId']]+=1
        episodes.append({k:e[k] for k in ('id','showId','title','publishedAt','durationSeconds','mediaUrl','mediaType')})
    if any(counts[key]!=show['episodeCount'] for key,show in shows.items()):
        raise ValueError('Episode counts differ')
    return {'version':1,'generatedAt':data['generatedAt'],'shows':list(shows.values()),'episodes':episodes}

def package(root, source):
    path=Path(root)/'site/data/podcasts.json'
    if path.is_symlink() or path.parent.is_symlink(): raise ValueError('Symlink catalogue')
    if not path.exists(): return source
    if source.count(MARKER)!=1: raise ValueError('Missing podcast marker')
    if not path.is_file() or path.stat().st_size>5000000: raise ValueError('Catalogue size')
    config=json.loads((Path(root)/'podcasts.json').read_text(encoding='utf-8'))
    snapshot=validate(json.loads(path.read_text(encoding='utf-8')),config)
    # Escape text-sensitive characters before inserting JSON as a JS literal.
    encoded=json.dumps(snapshot,ensure_ascii=True,separators=(',',':'))
    for ch in '<>&': encoded=encoded.replace(ch,'\\u'+format(ord(ch),'04x'))
    return source.replace(MARKER,'const PODCAST_PUBLIC_SNAPSHOT = '+encoded+';',1)
