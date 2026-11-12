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


# Fixed messages only: never echo resolver exceptions or publisher text.
REVIEW_REASONS = {
    "directory_match_unavailable": "Apple directory returned no unique matching show.",
    "directory_lookup_failed": "Apple directory lookup failed or returned an invalid response.",
    "missing_rss_url": "No usable RSS URL was returned.",
    "rss_requires_https_review": "The RSS URL failed the approved HTTPS URL checks.",
    "rss_fetch_or_validation_failed": "RSS retrieval or XML/source validation failed.",
    "rss_fetch_failed": "RSS retrieval failed before XML validation. HTTPS, public-destination, redirect, HTTP response, size, or network checks may have stopped it.",
    "rss_validation_failed": "An RSS response was retrieved, but XML or source-structure validation failed.",
    "no_eligible_episodes": "RSS episode validation did not produce a usable catalogue.",
    "new_media_hosts": "The source requires additional initial media-host approval.",
    "resolution_failed": "Source resolution could not complete.",
}

def review_feedback(result):
    reason = result.get("reason")
    explanation = (
        REVIEW_REASONS.get(reason, "No recognized diagnostic reason was provided.")
        if isinstance(reason, str)
        else "No recognized diagnostic reason was provided."
    )
    heading = (
        "Additional media-host approval required."
        if result.get("status") == "approval_required"
        else "Source resolution needs review."
    )
    return (
        heading + "\n\nReason: " + explanation
        + "\n\nNo configuration or CSP permissions were changed. "
        "No publication was requested. Existing enabled sources were left unchanged."
    )


def inspection_feedback(result):
    """Render bounded diagnostic observations, never permission approval."""
    observations = result.get("mediaInspection")
    if observations is None:
        return ""
    import re

    def safe_host(value):
        if (not isinstance(value, str) or len(value) > 253
                or not re.fullmatch(
                    r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", value
                )):
            raise ValueError("Invalid inspection host")
        from build_podcasts import host_name
        host_name(value)
        if any(not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label
        ) for label in value.split(".")):
            raise ValueError("Invalid inspection hostname label")
        return value

    reasons = {
        "head_ok": "HEAD reached HTTP 200",
        "redirect_loop": "Redirect loop",
        "unsafe_url": "Destination failed HTTPS URL checks",
        "time_limit": "Inspection time limit reached",
        "head_http_error": "HEAD response was not HTTP 200",
        "missing_redirect": "Redirect location missing",
        "redirect_limit": "Redirect limit reached",
        "network_or_destination_failed": "Network or public-destination check failed",
        "inspection_failed": "Inspection could not complete",
    }
    count = result.get("episodeCount")
    hosts = result.get("mediaHostsToReview")
    if (type(count) is not int or not 1 <= count <= 10000
            or not isinstance(hosts, list) or not 1 <= len(hosts) <= 20
            or not isinstance(observations, list)
            or not 1 <= len(observations) <= 3):
        raise ValueError("Invalid inspection report")

    lines = [
        "",
        "",
        "### Read-only media inspection",
        "",
        "Eligible episodes: " + str(count),
        "Feed host: `" + safe_host(result.get("feedHost")) + "`",
        "New initial media hosts requiring approval: "
        + ", ".join("`" + safe_host(host) + "`" for host in hosts),
        "",
    ]
    for index, observation in enumerate(observations, 1):
        if not isinstance(observation, dict):
            raise ValueError("Invalid inspection observation")
        status = observation.get("status")
        reason = observation.get("reason")
        hops = observation.get("hops")
        if (status not in ("observed", "review_required")
                or not isinstance(reason, str) or reason not in reasons
                or (status == "observed") != (reason == "head_ok")
                or not isinstance(hops, list) or len(hops) > 6):
            raise ValueError("Invalid inspection observation")
        if status == "observed" and (
            not hops or not isinstance(hops[-1], dict)
            or hops[-1].get("httpStatus") != 200
        ):
            raise ValueError("Invalid successful inspection")
        lines.append("Sample " + str(index) + ": " + reasons[reason] + ".")
        for hop in hops:
            if not isinstance(hop, dict):
                raise ValueError("Invalid inspection hop")
            code = hop.get("httpStatus")
            cookie = hop.get("setCookie")
            if (type(code) is not int or not 100 <= code <= 599
                    or type(cookie) is not bool):
                raise ValueError("Invalid inspection hop")
            lines.append(
                "- `" + safe_host(hop.get("host")) + "`: HTTP "
                + str(code) + "; Set-Cookie header observed: "
                + ("yes" if cookie else "no") + "."
            )
        lines.append("")
    lines.extend([
        "HEAD requests only; no audio response bodies were read.",
        "Observed hosts are candidates, not approved permissions.",
        "Browser playback has not been verified. Samples do not cover every "
        "episode or guarantee cookie-free/ad-free playback.",
    ])
    return "\n".join(lines)


def diagnostic_fetch(url, hosts):
    """Preserve fetch behavior; log only fixed diagnostic categories."""
    import socket
    import ssl
    import http.client
    from build_podcasts import fetch_feed

    try:
        return fetch_feed(url, hosts)
    except Exception as error:
        stage = (
            "Apple directory"
            if hosts == ["itunes.apple.com"]
            else "RSS"
        )
        if isinstance(error, ssl.SSLCertVerificationError):
            category = "TLS certificate verification failed"
        elif isinstance(error, ssl.SSLError):
            category = "TLS connection failed"
        elif isinstance(error, socket.gaierror):
            category = "DNS lookup failed"
        elif isinstance(error, TimeoutError):
            category = "Network timeout"
        elif isinstance(error, http.client.HTTPException):
            category = "HTTP protocol failure"
        elif isinstance(error, OSError):
            import errno
            category = {
                errno.ENETUNREACH: "Network unreachable",
                errno.EHOSTUNREACH: "Host unreachable",
                errno.ECONNREFUSED: "Connection refused",
                errno.ECONNRESET: "Connection reset",
                errno.ECONNABORTED: "Connection aborted",
                errno.ETIMEDOUT: "Network timeout",
            }.get(error.errno, "Network connection failure")
        elif isinstance(error, ValueError):
            # Match only known collector messages; never print raw errors.
            category = {
                "Non-public feed destination": "Public-IP safety check failed",
                "Invalid or unapproved HTTPS URL": "HTTPS URL or redirect-host check failed",
                "Invalid or excessive feed redirect": "Redirect limit or missing location",
                "Feed HTTP request failed": "Server returned a non-200 HTTP response",
                "Unexpected compressed response": "Unsupported response compression",
                "Feed exceeds size limit": "RSS size limit exceeded",
                "Feed time budget exceeded": "Retrieval time budget exceeded",
            }.get(str(error), "Retrieval validation failed")
        else:
            category = "Unexpected retrieval failure"
        print(stage + " retrieval diagnostic: " + category)
        raise

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
        return config,False,review_feedback(result)+inspection_feedback(result),False
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
    from functools import partial
    from podcast_media_inspection import inspect_chain
    envelope=prepare(event,config,partial(resolve, fetcher=diagnostic_fetch, inspector=inspect_chain))
    encoded=base64.b64encode(json.dumps(envelope,ensure_ascii=True,separators=(',',':')).encode()).decode()
    if len(encoded)>64000:raise ValueError('Oversized resolution')
    with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as stream:stream.write('resolution='+encoded+'\n')
    # Exact host names are available in the read-only job log for review, never auto-approved.
    result=envelope['result']
    print('Onboarding result:',result.get('status'))
    if result.get('status') in ('approval_required', 'review_required'):
        print(review_feedback(result))
    for host in result.get('mediaHostsToReview',[]):
        from build_podcasts import host_name
        print('Host requiring approval:',host_name(host))

if __name__=='__main__':
    try:main()
    except Exception:
        print('Resolution stopped; no source contents or credentials logged.')
        raise SystemExit(1)
