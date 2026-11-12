"""Approved RSS catalogue collector. No audio/artwork requests; no deployment changes.
Explicit --fetch is required for network access. HTTP caching is not implemented.
Catalogue JSON is a generated build input, not browser storage or an audio cache.
"""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import http.client
import ipaddress
import json
from pathlib import Path
import re
import socket
import ssl
import time
from urllib.parse import urljoin, urlsplit
from xml.parsers import expat
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
MAX_ITEMS = 10000
MAX_REDIRECTS = 5

class PodcastError(ValueError):
    pass

def host_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?', value):
        raise PodcastError('Invalid approved hostname')
    if '..' in value or '.' not in value:
        raise PodcastError('Invalid approved hostname')
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return value
    raise PodcastError('IP literals are not allowed')

def checked_url(value, hosts):
    if not isinstance(value, str) or len(value) > 8192 or any(ord(c) <= 32 or ord(c) >= 127 for c in value) or '\\' in value:
        raise PodcastError('Invalid URL')
    try:
        p = urlsplit(value)
        if (p.scheme != 'https' or not p.hostname or p.username is not None or
                p.password is not None or p.port not in (None, 443) or p.fragment or
                p.hostname not in hosts):
            raise PodcastError('URL outside approved HTTPS hosts')
        host_name(p.hostname)
    except (ValueError, UnicodeError) as error:
        raise PodcastError('Invalid or unapproved HTTPS URL') from error
    return p

def validate_config(config):
    if (not isinstance(config, dict) or set(config) != {'version','maxEpisodesPerShow','shows'} or
            type(config['version']) is not int or config['version'] != 1 or
            (config['maxEpisodesPerShow'] is not None and
             (type(config['maxEpisodesPerShow']) is not int or not 1 <= config['maxEpisodesPerShow'] <= 100)) or
            not isinstance(config['shows'], list) or len(config['shows']) > 100):
        raise PodcastError('Invalid podcast configuration')
    ids = set()
    for s in config['shows']:
        # Request-created additions are inert until feed/media review.
        if isinstance(s,dict) and set(s)=={'id','title','enabled','sourceUrl'}:
            from podcast_request import source_identity
            if (s['enabled'] is not False or not isinstance(s['title'],str) or not 1<=len(s['title'])<=200 or
                    any(ord(c)<32 for c in s['title']) or s['id'] in ids or source_identity(s['sourceUrl'])!=s['id']):
                raise PodcastError('Invalid pending source')
            ids.add(s['id'])
            continue
        if (not isinstance(s, dict) or set(s) != {'id','title','enabled','feedUrl','feedHosts','mediaHosts'} or
                not isinstance(s['id'], str) or not re.fullmatch(r'(?:apple-[0-9]{1,20}|rss-[0-9a-f]{32})',s['id']) or
                s['id'] in ids or not isinstance(s['title'],str) or not 1 <= len(s['title']) <= 200 or
                any(ord(c) < 32 for c in s['title']) or type(s['enabled']) is not bool):
            raise PodcastError('Invalid show')
        ids.add(s['id'])
        for key in ('feedHosts','mediaHosts'):
            if not isinstance(s[key], list) or len(s[key]) > 20 or not all(isinstance(h,str) for h in s[key]):
                raise PodcastError('Invalid host list')
            if len(set(s[key])) != len(s[key]):
                raise PodcastError('Duplicate approved host')
            for host in s[key]:
                host_name(host)
        checked_url(s['feedUrl'],s['feedHosts'])
        if s['enabled'] and not s['mediaHosts']:
            raise PodcastError('Enabled show requires approved media hosts')
    return config

def duration_seconds(value):
    if not isinstance(value, str) or len(value) > 32:
        return None
    value = value.strip()
    if re.fullmatch(r'[0-9]+',value):
        number = int(value)
    elif re.fullmatch(r'[0-9]{1,4}:[0-9]{2}(?::[0-9]{2})?',value):
        parts = [int(p) for p in value.split(':')]
        if parts[-1] >= 60 or (len(parts) == 3 and parts[-2] >= 60):
            return None
        number = parts[0]*60 + parts[1] if len(parts) == 2 else parts[0]*3600 + parts[1]*60 + parts[2]
    else:
        return None
    return number if 0 <= number <= 7*86400 else None

def published_date(value):
    if not isinstance(value,str) or len(value) > 200:
        return None
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            # RFC email-style -0000 represents UTC with unknown local offset.
            # Do not infer a timezone for dates that omit one entirely.
            if not re.search(r"\s-0000\s*$", value):
                return None
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None

def local(tag):
    return tag.rsplit('}',1)[-1]

def field(node, name):
    for child in node:
        if local(child.tag) == name:
            return ''.join(child.itertext()).strip()
    return ''

def reject_xml(*args):
    raise PodcastError('DTD and entity declarations are forbidden')

def parse_feed(raw, show, limit, now=None):
    # None means every eligible episode supplied by this RSS response.
    # MAX_BYTES and MAX_ITEMS remain fail-closed safety boundaries, not truncation.
    if limit is not None and (type(limit) is not int or not 1 <= limit <= 100):
        raise PodcastError('Invalid episode selection limit')
    if not isinstance(raw,bytes) or len(raw) > MAX_BYTES:
        raise PodcastError('Feed exceeds size limit')
    # Reject declarations using an encoding-aware XML parser before building a tree.
    guard = expat.ParserCreate()
    guard.StartDoctypeDeclHandler = reject_xml
    guard.EntityDeclHandler = reject_xml
    guard.ExternalEntityRefHandler = reject_xml
    try:
        guard.Parse(raw,True)
        root = ET.fromstring(raw)
    except (expat.ExpatError, ET.ParseError) as error:
        raise PodcastError('Invalid XML') from error
    if local(root.tag) != 'rss':
        raise PodcastError('Expected RSS document')
    channels = [n for n in root if local(n.tag) == 'channel']
    if len(channels) != 1:
        raise PodcastError('Expected one RSS channel')
    items = [n for n in channels[0] if local(n.tag) == 'item']
    if len(items) > MAX_ITEMS:
        raise PodcastError('Too many feed items')
    now = now or datetime.now(timezone.utc)
    records, rejected = {}, 0
    for item in items:
        title = field(item,'title')
        date = published_date(field(item,'pubDate'))
        enclosure = next((n for n in item if local(n.tag) == 'enclosure' and
                          n.get('type','').lower().startswith('audio/')), None)
        if (not title or len(title) > 1000 or any(ord(c) < 32 for c in title) or
                date is None or date.timestamp() > now.timestamp()+300 or enclosure is None):
            rejected += 1
            continue
        media = enclosure.get('url','')
        try:
            checked_url(media,show['mediaHosts'])
        except PodcastError:
            rejected += 1
            continue
        guid = field(item,'guid') or media
        identity = show['id'] + '\n' + guid
        episode = {
            'id': hashlib.sha256(identity.encode('utf-8')).hexdigest(),
            'showId':show['id'], 'title':title,
            'publishedAt':date.isoformat().replace('+00:00','Z'),
            'durationSeconds':duration_seconds(field(item,'duration')),
            'mediaUrl':media,'mediaType':enclosure.get('type','').lower()[:100],
        }
        old = records.get(episode['id'])
        if old is None or episode['publishedAt'] > old['publishedAt']:
            records[episode['id']] = episode
    episodes = sorted(records.values(),key=lambda e:(e['publishedAt'],e['id']),reverse=True)[:limit]
    if not episodes:
        raise PodcastError('No eligible dated audio episodes')
    return episodes, {'items':len(items),'rejected':rejected,'eligible':len(records)}

class PinnedHTTPS(http.client.HTTPSConnection):
    """Connect only to a validated numeric IP, retaining TLS SNI and host validation."""
    def __init__(self, host, address, timeout):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address
    def connect(self):
        raw = socket.create_connection((self.address,443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw,server_hostname=self.host)
        except BaseException:
            raw.close()
            raise

def public_addresses(host):
    addresses = sorted({row[4][0] for row in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)})
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise PodcastError('Non-public feed destination')
    return addresses

def fetch_feed(url, hosts):
    # No proxy environment variables, CookieJar, credentials, cache, or media fetches.
    deadline = time.monotonic()+60
    for attempt in range(MAX_REDIRECTS+1):
        p = checked_url(url,hosts)
        addresses = public_addresses(p.hostname)
        remaining = deadline-time.monotonic()
        if remaining <= 0:
            raise PodcastError('Feed time budget exceeded')
        connection = PinnedHTTPS(p.hostname,addresses[0],min(15,remaining))
        try:
            target = p.path or '/'
            if p.query:
                target += '?' + p.query
            connection.request('GET',target,headers={
                'User-Agent':'MyApps-Podcast-Collector/1.0',
                'Accept':'application/rss+xml, application/xml, text/xml',
                'Accept-Encoding':'identity','Cache-Control':'no-store',
            })
            response = connection.getresponse()
            if response.status in (301,302,303,307,308):
                location = response.getheader('Location')
                if not location or attempt == MAX_REDIRECTS:
                    raise PodcastError('Invalid or excessive feed redirect')
                url = urljoin(url,location)
                checked_url(url,hosts)
                continue
            if response.status != 200:
                raise PodcastError('Feed HTTP request failed')
            if response.getheader('Content-Encoding','identity').lower() != 'identity':
                raise PodcastError('Unexpected compressed response')
            chunks, size = [], 0
            while True:
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise PodcastError('Feed time budget exceeded')
                if connection.sock is not None:
                    connection.sock.settimeout(min(15,remaining))
                chunk = response.read1(min(65536,MAX_BYTES+1-size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_BYTES:
                    raise PodcastError('Feed exceeds size limit')
            return b''.join(chunks)
        finally:
            connection.close()
    raise PodcastError('Too many redirects')

def collect(config, fetcher=fetch_feed, now=None):
    validate_config(config)
    now = now or datetime.now(timezone.utc)
    shows, episodes = [], []
    for s in config['shows']:
        entry = {'id':s['id'],'title':s['title'],'status':'pending','episodeCount':0}
        if s['enabled']:
            try:
                raw = fetcher(s['feedUrl'],s['feedHosts'])
                found, counts = parse_feed(raw,s,config['maxEpisodesPerShow'],now)
                episodes.extend(found)
                entry.update(status='ok',episodeCount=len(found),inspection=counts)
            except Exception:
                # Never leak a URL, token, XML fragment, or environment value into logs/output.
                entry['status'] = 'unavailable'
        shows.append(entry)
    return {'version':1,'generatedAt':now.isoformat().replace('+00:00','Z'),
            'shows':shows,'episodes':sorted(episodes,key=lambda e:(e['publishedAt'],e['id']),reverse=True)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch',action='store_true',help='Explicitly allow approved RSS requests')
    parser.add_argument('--output',type=Path,required=True,help='Generated catalogue JSON; do not commit')
    args = parser.parse_args()
    if not args.fetch:
        parser.error('Network access requires explicit --fetch')
    config = validate_config(json.loads((ROOT/'podcasts.json').read_text(encoding='utf-8')))
    # Stage 2 is deliberately not wired into publication yet.
    if args.output.exists() or args.output.is_symlink():
        parser.error('Output must be a new file')
    catalogue = collect(config)
    args.output.write_text(json.dumps(catalogue,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for show in catalogue['shows']:
        print(show['id']+' | '+show['status']+' | '+str(show['episodeCount'])+' episodes')
    return 0 if (not any(s['enabled'] for s in config['shows']) or any(s['status']=='ok' for s in catalogue['shows'])) else 1

if __name__ == '__main__':
    raise SystemExit(main())
