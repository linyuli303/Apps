"""Owner-only configuration writes. Does not fetch unreviewed podcast URLs."""
import base64
import json
import os
from pathlib import Path
from podcast_request import authorize_event, apply_change, REPO, OWNER_ID
from process_channel_request import github

def process(event,call=github,resolution=None):
    number,data=authorize_event(event)
    def check_live():
        live=call('GET',f'/repos/{REPO}/issues/{number}')
        checked=dict(event);checked['issue']=live
        if authorize_event(checked)!=(number,data) or live.get('body')!=event['issue'].get('body') or live.get('updated_at')!=event['issue'].get('updated_at'):
            raise ValueError('Request edited, closed or unauthorized')
    check_live()
    record=call('GET',f'/repos/{REPO}/contents/podcasts.json?ref=main')
    if record.get('type')!='file' or record.get('path')!='podcasts.json' or record.get('encoding')!='base64' or not isinstance(record.get('sha'),str):
        raise ValueError('Unexpected configuration')
    encoded=record.get('content','')
    if not isinstance(encoded,str) or len(encoded)>1000000:raise ValueError('Configuration size')
    raw=base64.b64decode(encoded.replace('\n',''),validate=True)
    if len(raw)>500000:raise ValueError('Configuration size')
    config=json.loads(raw.decode('utf-8'))
    if resolution is None:
        # Compatibility path for existing offline tests; production main always requires an envelope.
        updated,changed=apply_change(config,data)
        feedback=None
        publish=True
    else:
        from podcast_resolution import apply_validated
        updated,changed,feedback,publish=apply_validated(event,config,resolution)
    # Reauthorize immediately before the SHA-aware write; never interpolate issue text into a shell.
    check_live()
    if changed:
        content=(json.dumps(updated,ensure_ascii=True,indent=2)+'\n').encode('utf-8')
        call('PUT',f'/repos/{REPO}/contents/podcasts.json',{
            'message':f'Apply owner podcast request #{number}',
            'content':base64.b64encode(content).decode('ascii'),'sha':record['sha'],'branch':'main'})
    # Explicitly preserve YouTube feed reuse on podcast configuration publication.
    if publish:
        call('POST',f'/repos/{REPO}/actions/workflows/publish.yml/dispatches',{'ref':'main','inputs':{'reuse_published_feed':'true'}})
    if feedback:
        call('POST',f'/repos/{REPO}/issues/{number}/comments',{'body':feedback})
    print('Podcast request processed. Check Issue feedback and any separate publication run.')

def main():
    try:
        if os.environ.get('GITHUB_REPOSITORY')!=REPO or os.environ.get('GITHUB_ACTOR_ID')!=str(OWNER_ID) or os.environ.get('GITHUB_REF')!='refs/heads/main':
            raise ValueError('Unauthorized runner context')
        from podcast_resolution import decode
        resolution=decode(os.environ['PODCAST_RESOLUTION'])
        process(json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8')),resolution=resolution)
        return 0
    except Exception:
        print('Podcast request stopped. No request bodies, URLs or credentials logged. Check owner authorization, unchanged issue and concurrent edits. If commit succeeded but dispatch failed, manually publish with YouTube feed reuse selected.')
        return 1

if __name__=='__main__':raise SystemExit(main())
