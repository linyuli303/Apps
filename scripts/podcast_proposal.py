"""Pure podcast proposal generation. No network, file writes, or approval."""
import copy
import json
import re

from build_podcasts import validate_config, checked_url
from podcast_request import authorize_event, source_identity
from podcast_resolution import apply_validated, inspection_feedback


def build_proposal(event, config, envelope, js, html):
    """Return three proposed file contents after strict snapshot validation.

    Existing source records must remain unchanged. New permission candidates
    come only from validated initial hosts and successful sampled HEAD chains.
    Human review is still required before merging these changes.
    """
    _, request = authorize_event(event)
    if request["operation"] != "Add":
        raise ValueError("Only additions can produce proposals")

    # Reuse owner, Issue-snapshot and configuration-digest checks.
    _, changed, _, publish = apply_validated(event, config, envelope)
    result = envelope["result"]
    if result.get("status") != "approval_required" or changed or publish:
        raise ValueError("Not an approval-required proposal")
    inspection_feedback(result)

    candidate = result.get("candidate")
    expected = {"id", "title", "enabled", "feedUrl", "feedHosts", "mediaHosts"}
    if not isinstance(candidate, dict) or set(candidate) != expected:
        raise ValueError("Invalid candidate schema")
    if (candidate["id"] != source_identity(request["sourceUrl"])
            or candidate["enabled"] is not True):
        raise ValueError("Candidate identity mismatch")

    initial = candidate["mediaHosts"]
    if not isinstance(initial, list) or not initial:
        raise ValueError("Missing initial media hosts")
    feed_host = result.get("feedHost")
    if candidate["feedHosts"] != [feed_host]:
        raise ValueError("Feed host mismatch")
    checked_url(candidate["feedUrl"], [feed_host])

    proposed = copy.deepcopy(config)
    if any(
        show["id"] == candidate["id"]
        or show.get("feedUrl") == candidate["feedUrl"]
        for show in proposed["shows"]
    ):
        raise ValueError("Existing source cannot be replaced")
    proposed["shows"].append(copy.deepcopy(candidate))
    validate_config(proposed)

    approved = {
        host for show in config["shows"] if show.get("enabled")
        for host in show.get("mediaHosts", [])
    }
    if sorted(set(initial) - approved) != result.get("mediaHostsToReview"):
        raise ValueError("Initial-host review mismatch")

    observations = result.get("mediaInspection")
    if not isinstance(observations, list) or not 1 <= len(observations) <= 3:
        raise ValueError("Inspection required")
    required = set(initial)
    sampled_initial = set()
    for observation in observations:
        if observation["status"] != "observed" or observation["reason"] != "head_ok":
            raise ValueError("Incomplete inspection cannot produce a proposal")
        hops = observation["hops"]
        if not hops or hops[0]["host"] not in initial:
            raise ValueError("Unexpected initial inspection host")
        sampled_initial.add(hops[0]["host"])
        for index, hop in enumerate(hops):
            code = hop["httpStatus"]
            if index < len(hops) - 1 and code not in (301, 302, 303, 307, 308):
                raise ValueError("Invalid redirect chain")
            if index == len(hops) - 1 and code != 200:
                raise ValueError("Missing successful endpoint")
            host = hop["host"]
            checked_url("https://" + host + "/", [host])
            required.add(host)
    if sampled_initial != set(initial):
        raise ValueError("Every initial host needs a successful sample")
    if len(required) > 20:
        raise ValueError("Too many proposed media hosts")

    pattern = r"const allowedHosts = new Set\((\[[^\r\n]*\])\);"
    matches = list(re.finditer(pattern, js))
    if len(matches) != 1:
        raise ValueError("Unexpected player allowlist structure")
    match = matches[0]
    old_hosts = json.loads(match.group(1))
    if (not isinstance(old_hosts, list)
            or any(not isinstance(host, str) for host in old_hosts)
            or len(set(old_hosts)) != len(old_hosts)):
        raise ValueError("Invalid existing player permissions")
    for host in old_hosts:
        checked_url("https://" + host + "/", [host])
    new_hosts = old_hosts + sorted(required - set(old_hosts))
    new_js = js[:match.start(1)] + json.dumps(new_hosts) + js[match.end(1):]

    matches = list(re.finditer(r"media-src ([^;]+);", html))
    if len(matches) != 1:
        raise ValueError("Unexpected media CSP structure")
    match = matches[0]
    old_policy = match.group(1)
    tokens = old_policy.split()
    for token in tokens:
        if not re.fullmatch(
            r"https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", token
        ):
            raise ValueError("Unexpected existing media CSP")
        host = token[len("https://"):]
        checked_url("https://" + host + "/", [host])
    additions = sorted(
        {"https://" + host for host in required} - set(tokens)
    )
    new_policy = old_policy + (
        " " + " ".join(additions) if additions else ""
    )
    new_html = html[:match.start(1)] + new_policy + html[match.end(1):]

    if proposed["shows"][:-1] != config["shows"]:
        raise ValueError("Existing source records changed")
    return {
        "podcasts.json": json.dumps(proposed, ensure_ascii=True, indent=2) + "\n",
        "site/app.js": new_js,
        "site/index.html": new_html,
    }
