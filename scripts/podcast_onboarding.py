"""Reusable podcast onboarding resolver (not yet wired into production).
Uses the existing pinned-public-IP HTTPS fetcher. Never requests audio.
No GitHub token, repository writes, cookie jar or persistent cache.
"""
import json
import re
from urllib.parse import urlsplit
from xml.parsers import expat
import xml.etree.ElementTree as ET
from build_podcasts import (fetch_feed, checked_url, host_name, parse_feed,
                            reject_xml, local, field, validate_config)

APPLE_HOST = 'itunes.apple.com'

class ReviewRequired(ValueError):
    pass

def input_source(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 2048 or
            any(ord(c) <= 32 or ord(c) >= 127 for c in value) or '\\' in value):
        raise ValueError('invalid_source')
    p = urlsplit(value)
    if (p.scheme != 'https' or not p.hostname or p.username is not None or
            p.password is not None or p.port not in (None,443) or p.query or p.fragment):
        raise ValueError('public_https_source_required')
    host_name(p.hostname)
    if p.hostname == 'podcasts.apple.com':
        match = re.fullmatch(r'/(?:(?P<country>[a-z]{2})/)?podcast/(?:[^/]+/)?id(?P<id>[0-9]{1,20})/?', p.path)
        if not match:
            raise ValueError('apple_show_link_required')
        return {'kind':'apple','appleId':match['id'],'country':match['country'] or 'us'}
    if not p.path or p.path == '/':
        raise ValueError('rss_path_required')
    return {'kind':'rss','url':value}

def resolve(source, config, fetcher=fetch_feed, now=None):
    """Return an actionable result; never write configuration or expand CSP.

    Existing enabled shows define approved initial media hosts. Feed redirects to
    another host stop for explicit review; the fetcher does not silently trust them.
    This stage validates RSS enclosures, NOT untested downstream audio redirects.
    """
    validate_config(config)
    parsed = input_source(source)
    if parsed['kind'] == 'apple':
        sid = 'apple-' + parsed['appleId']
        lookup = ('https://itunes.apple.com/lookup?id=' + parsed['appleId'] +
                  '&country=' + parsed['country'] + '&entity=podcast')
        try:
            raw = fetcher(lookup, [APPLE_HOST])
            if len(raw) > 1000000:
                raise ValueError('directory_size')
            results = json.loads(raw).get('results', [])
            if not isinstance(results,list):
                raise ValueError('directory_schema')
            matches = [r for r in results if isinstance(r,dict) and
                       str(r.get('collectionId')) == parsed['appleId'] and r.get('kind') == 'podcast']
            if len(matches) != 1:
                return {'status':'review_required','reason':'directory_match_unavailable','showId':sid}
            feed = matches[0].get('feedUrl')
        except (OSError, ValueError):
            return {'status':'review_required','reason':'directory_lookup_failed','showId':sid}
    else:
        import hashlib
        feed = parsed['url']
        sid = 'rss-' + hashlib.sha256(feed.encode('ascii')).hexdigest()[:32]

    if not isinstance(feed,str):
        return {'status':'review_required','reason':'missing_rss_url','showId':sid}
    # Do not silently downgrade or automatically rewrite HTTP-only directory URLs.
    try:
        host = urlsplit(feed).hostname
        checked_url(feed,[host])
    except (ValueError, TypeError):
        return {'status':'review_required','reason':'rss_requires_https_review','showId':sid}
    for show in config['shows']:
        if show.get('enabled') and (show['id']==sid or show.get('feedUrl')==feed):
            return {'status':'already_subscribed','showId':show['id']}
    try:
        raw = fetcher(feed,[host])
        guard=expat.ParserCreate()
        guard.StartDoctypeDeclHandler=reject_xml
        guard.EntityDeclHandler=reject_xml
        guard.ExternalEntityRefHandler=reject_xml
        guard.Parse(raw,True)
        root=ET.fromstring(raw)
        if local(root.tag)!='rss':
            raise ValueError('rss_required')
        channels=[n for n in root if local(n.tag)=='channel']
        if len(channels)!=1:
            raise ValueError('channel_required')
        title=field(channels[0],'title')
        if not title or len(title)>200 or any(ord(c)<32 for c in title):
            raise ValueError('invalid_title')
        observed=set()
        for item in channels[0]:
            if local(item.tag)!='item':continue
            for enclosure in item:
                if local(enclosure.tag)!='enclosure' or not enclosure.get('type','').lower().startswith('audio/'):
                    continue
                url=enclosure.get('url','')
                media_host=urlsplit(url).hostname
                checked_url(url,[media_host])
                observed.add(media_host)
        if not observed:
            raise ValueError('no_audio_enclosures')
    except (OSError, ValueError, expat.ExpatError, ET.ParseError):
        return {'status':'review_required','reason':'rss_fetch_or_validation_failed','showId':sid}
    approved={h for s in config['shows'] if s.get('enabled') for h in s.get('mediaHosts',[])}
    unknown=sorted(observed-approved)
    if unknown:
        return {'status':'approval_required','reason':'new_media_hosts','showId':sid,
                'title':title,'mediaHostsToReview':unknown}
    record={'id':sid,'title':title,'enabled':True,'feedUrl':feed,
            'feedHosts':[host],'mediaHosts':sorted(observed)}
    try:
        episodes,counts=parse_feed(raw,record,config['maxEpisodesPerShow'],now)
    except ValueError:
        return {'status':'review_required','reason':'no_eligible_episodes','showId':sid,'title':title}
    return {'status':'ready','show':record,'episodeCount':len(episodes),'inspection':counts,
            'mediaPolicy':'existing_initial_hosts_only; downstream redirects still enforced by CSP'}
