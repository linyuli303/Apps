"""Read-only resolution output and strict privileged-side validation. No media fetches."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from podcast_request import authorize_event, source_identity, apply_change
from build_podcasts import validate_config

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()

def prepare(event,config,resolver):
    number,data=authorize_event(event)
    if data['operation']=='Add':
        try:
            result=resolver(data['sourceUrl'],config)
        except Exception:
            result={'status':'review_required','reason':'resolution_failed'}
    else:
        result={'status':'remove'}
    return {'version':1,'issue':number,'requestDigest':digest(event['issue']),
            'configDigest':digest(config),'result':result}

def apply_validated(event,config,envelope):
    number,data=authorize_event(event)
    if (not isinstance(envelope,dict) or set(envelope)!={'version','issue','requestDigest','configDigest','result'} or
        type(envelope['version']) is not int or envelope['version']!=1 or envelope['issue']!=number or
        envelope['requestDigest']!=digest(event['issue']) or envelope['configDigest']!=digest(config)):
        raise ValueError('Resolution stale or mismatched')
    validate_config(config)
    result=envelope['result']
    if not isinstance(result,dict):raise ValueError('Invalid result')
    status=result.get('status')
    if data['operation']=='Remove':
        if result!={'status':'remove'}:raise ValueError('Removal result mismatch')
        updated,changed=apply_change(config,data)
        return updated,changed,'Removal processed. Check the separate publication run.',True
    sid=source_identity(data['sourceUrl'])
    if status=='ready':
        show=result.get('show')
        if not isinstance(show,dict) or set(show)!={'id','title','enabled','feedUrl','feedHosts','mediaHosts'} or show['id']!=sid or show['enabled'] is not True:
            raise ValueError('Invalid resolved record')
        host=urlsplit(show['feedUrl']).hostname
        if show['feedHosts']!=[host]:raise ValueError('Unexpected feed approval')
        approved={h for s in config['shows'] if s.get('enabled') for h in s.get('mediaHosts',[])}
        if not set(show['mediaHosts']).issubset(approved):raise ValueError('New media host cannot activate automatically')
        if type(result.get('episodeCount')) is not int or not 1<=result['episodeCount']<=10000:raise ValueError('Invalid episode count')
        updated=copy.deepcopy(config)
        existing=next((s for s in updated['shows'] if s['id']==sid),None)
        duplicate=next((s for s in updated['shows'] if s.get('enabled') and s.get('feedUrl')==show['feedUrl'] and s['id']!=sid),None)
        if duplicate:return config,False,'Already subscribed under another source ID. Configuration unchanged.',False
        if existing:updated['shows'][updated['shows'].index(existing)]=show
        else:updated['shows'].append(show)
        validate_config(updated)
        return updated,updated!=config,'Source validated and activated using existing media permissions. Check the separate publication run.',True
    if status=='already_subscribed':
        if not any(s['id']==result.get('showId') and s.get('enabled') for s in config['shows']):raise ValueError('Unknown duplicate')
        return config,False,'Already subscribed. No configuration change required.',False
    if status in ('approval_required','review_required'):
        # Fixed text only: never echo untrusted feed text, URLs or token values in a comment.
        message=('Additional media-host approval required. No source or CSP change was made.' if status=='approval_required'
                 else 'Source resolution needs review (HTTPS, redirects, directory availability or RSS validation). No configuration change was made.')
        return config,False,message,False
    raise ValueError('Unknown resolution status')

def decode(value):
    if not isinstance(value,str) or len(value)>64000:raise ValueError('Oversized resolution')
    raw=base64.b64decode(value,validate=True)
    if len(raw)>48000:raise ValueError('Oversized resolution')
    return json.loads(raw)

def main():
    from podcast_onboarding import resolve
    event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
    root=Path(__file__).resolve().parents[1]
    config=json.loads((root/'podcasts.json').read_text(encoding='utf-8'))
    envelope=prepare(event,config,resolve)
    encoded=base64.b64encode(json.dumps(envelope,ensure_ascii=True,separators=(',',':')).encode()).decode()
    if len(encoded)>64000:raise ValueError('Oversized resolution')
    with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as stream:stream.write('resolution='+encoded+'\n')
    # Exact host names are available in the read-only job log for review, never auto-approved.
    result=envelope['result']
    print('Onboarding result:',result.get('status'))
    for host in result.get('mediaHostsToReview',[]):
        from build_podcasts import host_name
        print('Host requiring approval:',host_name(host))

if __name__=='__main__':
    try:main()
    except Exception:
        print('Resolution stopped; no source contents or credentials logged.')
        raise SystemExit(1)
