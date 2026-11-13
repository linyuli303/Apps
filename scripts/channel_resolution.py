"""Read-only channel resolution, bounded API clients and advisory review generation."""
import re

CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}")
HANDLE = re.compile(r"@[A-Za-z0-9_.-]{3,30}")
CHANNEL_URL = re.compile(
    r"https://(?:www\.|m\.|music\.)?youtube\.com/"
    r"(channel/UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9_.-]{3,30})/?"
)


def normalize_channel_input(value):
    """Return (kind, lookup value); syntax does not establish identity."""
    if not isinstance(value, str) or len(value) > 240:
        raise ValueError("Invalid channel lookup input")

    # Permit surrounding ordinary spaces/tabs, not hidden control characters.
    if any(ord(char) < 32 and char != "\t" for char in value):
        raise ValueError("Invalid channel lookup input")
    if "\x7f" in value:
        raise ValueError("Invalid channel lookup input")

    value = value.strip(" \t")
    if CHANNEL_ID.fullmatch(value):
        return "id", value
    if HANDLE.fullmatch(value):
        return "handle", value

    match = CHANNEL_URL.fullmatch(value)
    if not match:
        raise ValueError("Use an immutable ID, supported @handle, or plain HTTPS channel URL")

    path = match.group(1)
    if path.startswith("channel/"):
        return "id", path[len("channel/"):]
    return "handle", path


def normalize_channel_batch(values):
    """Validate all entries before returning a bounded detached batch.

    Preserve duplicates for explicit review after identity resolution.
    """
    if not isinstance(values, list) or not 1 <= len(values) <= 50:
        raise ValueError("Use between 1 and 50 entries")
    return tuple(normalize_channel_input(value) for value in values)


def resolve_channel_batch(values, request):
    """Resolve a bounded batch using an injected read-only API client.

    request receives only fixed channels.list parameters.
    It must manage credentials and transport separately.
    No partial resolution is returned on failure.
    """
    normalized = normalize_channel_batch(values)
    if not callable(request):
        raise ValueError("Invalid resolution client")

    cache = {}
    seen_ids = set()
    resolved = []

    for kind, lookup in normalized:
        cache_key = (kind, lookup)
        if cache_key not in cache:
            params = {
                "part": "snippet",
                "maxResults": 1,
                "id" if kind == "id" else "forHandle": lookup,
            }
            try:
                response = request(dict(params))
            except Exception:
                # Never expose transport errors, credentials or response bodies.
                raise ValueError("Channel lookup failed") from None

            if (not isinstance(response, dict)
                    or not isinstance(response.get("items"), list)
                    or len(response["items"]) != 1):
                raise ValueError("Channel lookup did not return one identity")

            item = response["items"][0]
            if not isinstance(item, dict):
                raise ValueError("Invalid resolved channel")
            cid = item.get("id")
            snippet = item.get("snippet")
            title = snippet.get("title") if isinstance(snippet, dict) else None

            if (not isinstance(cid, str)
                    or not CHANNEL_ID.fullmatch(cid)
                    or (kind == "id" and cid != lookup)
                    or not isinstance(title, str)
                    or not title.strip()
                    or len(title) > 300
                    or any(ord(char) < 32 or ord(char) == 127 for char in title)):
                raise ValueError("Invalid resolved channel identity")

            cache[cache_key] = (cid, title.strip())

        cid, title = cache[cache_key]
        duplicate = cid in seen_ids
        seen_ids.add(cid)
        resolved.append({
            "kind": kind,
            "lookup": lookup,
            "id": cid,
            "title": title,
            "url": "https://www.youtube.com/channel/" + cid,
            "duplicate": duplicate,
        })

    return tuple(resolved)



def request_channel_identity(params, key, *, opener=None):
    """One fixed-origin lookup; no retries, redirects, writes or raw errors."""
    import json
    import urllib.parse
    import urllib.request

    if (not isinstance(key, str) or not 1 <= len(key) <= 256
            or not key.isascii()
            or any(ord(char) <= 32 or ord(char) >= 127 for char in key)):
        raise ValueError("Invalid resolver key configuration")

    if not isinstance(params, dict):
        raise ValueError("Invalid channel lookup parameters")
    lookup_fields = set(params) - {"part", "maxResults"}
    if (lookup_fields not in ({"id"}, {"forHandle"})
            or params.get("part") != "snippet"
            or type(params.get("maxResults")) is not int
            or params["maxResults"] != 1):
        raise ValueError("Invalid channel lookup parameters")

    field = next(iter(lookup_fields))
    lookup = params[field]
    pattern = CHANNEL_ID if field == "id" else HANDLE
    if not isinstance(lookup, str) or not pattern.fullmatch(lookup):
        raise ValueError("Invalid channel lookup parameters")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    endpoint = "https://www.googleapis.com/youtube/v3/channels"
    url = endpoint + "?" + urllib.parse.urlencode({
        "part": "snippet",
        "maxResults": 1,
        field: lookup,
    })
    request = urllib.request.Request(
        url,
        headers={
            "X-Goog-Api-Key": key,
            "Accept": "application/json",
            "User-Agent": "MyApps-channel-resolver",
        },
        method="GET",
    )

    try:
        client = opener if opener is not None else (
            urllib.request.build_opener(NoRedirect())
        )
        with client.open(request, timeout=15) as response:
            if (response.status != 200 or response.geturl() != url
                    or response.headers.get_content_type()
                    != "application/json"):
                raise ValueError("Invalid lookup response")

            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError("Lookup response too large")
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Invalid lookup response")
            return payload
    except Exception:
        # Never propagate headers, request URLs, provider bodies or raw errors.
        raise RuntimeError("YouTube channel lookup unavailable") from None



RESOLUTION_TITLE = "[MyTube] Resolve channels"
RESOLUTION_CONFIRMATION = (
    "I understand these inputs and resolved identities are public. "
    "This request does not approve channel additions."
)


def parse_resolution_request(body):
    """Parse lookup intent only; authorization is enforced separately."""
    if not isinstance(body, str) or len(body) > 16000:
        raise ValueError("Invalid resolution request body")

    normalized = body.replace("\r\n", "\n").strip()
    pattern = (
        r"### Channels\n\n(?P<inputs>.*?)"
        r"\n\n### Confirmation\n\n- \[x\] "
        + re.escape(RESOLUTION_CONFIRMATION)
    )
    match = re.fullmatch(pattern, normalized, re.DOTALL)
    if not match:
        raise ValueError("Use the reviewed channel resolution form")

    values = match.group("inputs").split("\n")
    if not 1 <= len(values) <= 50 or any(
        not value.strip(" \t") for value in values
    ):
        raise ValueError("Use 1 to 50 entries without blank lines")

    # Validate every input before any later transport can be called.
    return normalize_channel_batch(values)



def authorize_resolution_event(event):
    """Authorize lookup intent only, never permission to add channels."""
    if not isinstance(event, dict) or event.get("action") != "opened":
        raise ValueError("Unauthorized resolution event")

    repository = event.get("repository")
    issue = event.get("issue")
    sender = event.get("sender")
    if not all(isinstance(value, dict)
               for value in (repository, issue, sender)):
        raise ValueError("Unauthorized resolution event")

    def expected_owner(user):
        return (
            isinstance(user, dict)
            and type(user.get("id")) is int
            and user["id"] == 42029941
            and user.get("login") == "linyuli303"
            and user.get("type") == "User"
        )

    if (
        repository.get("full_name") != "linyuli303/Apps"
        or repository.get("default_branch") != "main"
        or not expected_owner(repository.get("owner"))
        or not expected_owner(sender)
        or not expected_owner(issue.get("user"))
        or "pull_request" in issue
        or issue.get("state") != "open"
        or type(issue.get("number")) is not int
        or issue["number"] <= 0
        or issue.get("title") != RESOLUTION_TITLE
    ):
        raise ValueError("Unauthorized resolution event")

    inputs = parse_resolution_request(issue.get("body"))
    return issue["number"], inputs



def verify_resolution_live_issue(event, live_issue):
    """Recheck the live Issue before lookup; this does not approve additions."""
    expected = authorize_resolution_event(event)
    submitted = event["issue"]

    if not isinstance(live_issue, dict):
        raise ValueError("Invalid live resolution Issue")

    submitted_updated = submitted.get("updated_at")
    if (
        not isinstance(submitted_updated, str)
        or not re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T"
            r"[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
            submitted_updated,
        )
    ):
        raise ValueError("Missing resolution Issue revision")

    checked = dict(event)
    checked["issue"] = live_issue

    if (
        authorize_resolution_event(checked) != expected
        or live_issue.get("body") != submitted.get("body")
        or live_issue.get("updated_at") != submitted_updated
    ):
        raise ValueError("Resolution Issue changed; submit a new request")

    return expected



def resolve_owner_request(event, get_issue, request):
    """Read-only orchestration with injected GitHub and YouTube clients.

    No secret loading, file writes, comments, approvals or whitelist changes.
    """
    number, inputs = authorize_resolution_event(event)
    if not callable(get_issue) or not callable(request):
        raise ValueError("Invalid resolution dependencies")

    try:
        live = get_issue(number)
    except Exception:
        raise ValueError("Resolution Issue could not be checked") from None

    verify_resolution_live_issue(event, live)

    # Parsed lookup values are already normalized and bounded.
    values = [lookup for kind, lookup in inputs]
    rows = resolve_channel_batch(values, request)

    # Reject results if the request changed while lookups were running.
    try:
        latest = get_issue(number)
    except Exception:
        raise ValueError("Resolution Issue could not be rechecked") from None

    verify_resolution_live_issue(event, latest)

    return {
        "issue_number": number,
        "issue_updated_at": event["issue"]["updated_at"],
        "rows": rows,
    }



def build_resolution_review(resolution):
    """Prepare advisory review data, never authorization to modify channels."""
    import urllib.parse

    if (not isinstance(resolution, dict)
            or set(resolution) != {
                "issue_number", "issue_updated_at", "rows"
            }
            or type(resolution["issue_number"]) is not int
            or resolution["issue_number"] <= 0
            or not isinstance(resolution["issue_updated_at"], str)
            or not re.fullmatch(
                r"[0-9]{4}-[0-9]{2}-[0-9]{2}T"
                r"[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
                resolution["issue_updated_at"],
            )
            or not isinstance(resolution["rows"], (list, tuple))
            or not 1 <= len(resolution["rows"]) <= 50):
        raise ValueError("Invalid channel resolution review")

    ids = []
    seen = set()
    lines = [
        "Channel identity review",
        "Resolution Issue: #" + str(resolution["issue_number"]),
        "Request revision: " + resolution["issue_updated_at"],
        "Lookup results only. No channels have been added.",
        "",
    ]

    for index, row in enumerate(resolution["rows"], start=1):
        if (not isinstance(row, dict)
                or set(row) != {
                    "kind", "lookup", "id", "title", "url", "duplicate"
                }):
            raise ValueError("Invalid resolved review row")

        kind, lookup = normalize_channel_input(row["lookup"])
        cid, title = row["id"], row["title"]
        if (kind != row["kind"]
                or not isinstance(cid, str)
                or not CHANNEL_ID.fullmatch(cid)
                or (kind == "id" and cid != lookup)
                or not isinstance(title, str)
                or not title.strip()
                or len(title) > 300
                or any(ord(c) < 32 or ord(c) == 127 for c in title)
                or row["url"] !=
                    "https://www.youtube.com/channel/" + cid
                or type(row["duplicate"]) is not bool
                or row["duplicate"] != (cid in seen)):
            raise ValueError("Invalid resolved review identity")

        duplicate = cid in seen
        if not duplicate:
            ids.append(cid)
        seen.add(cid)

        lines.extend([
            str(index) + ". Input: " + lookup,
            "   Title: " + title.strip(),
            "   ID: " + cid,
            "   Official URL: " + row["url"],
            "   Result: " + (
                "Duplicate resolved ID; listed once in the addition form."
                if duplicate else "Review this identity."
            ),
            "",
        ])

    channel_text = "\n".join(ids)
    fields = {
        "template": "channel-bulk-add.yml",
        "title": "[MyTube] Channel change",
        "operation": "Add multiple",
        "channel_ids": channel_text,
    }
    endpoint = "https://github.com/linyuli303/Apps/issues/new"
    url = endpoint + "?" + urllib.parse.urlencode(fields)
    requires_paste = len(url) > 6500
    if requires_paste:
        del fields["channel_ids"]
        url = endpoint + "?" + urllib.parse.urlencode(fields)

    lines.extend([
        "Next: inspect the identities and open a separate bulk-add Issue.",
        "Review the UC IDs and check confirmation on GitHub yourself.",
        "Existing IDs are checked against live configuration during processing.",
        "This report has no authority to approve or write channel additions.",
    ])

    return {
        "report": "\n".join(lines),
        "channel_ids": tuple(ids),
        "channel_text": channel_text,
        "addition_url": url,
        "requires_paste": requires_paste,
    }



def validate_resolution_runner(environment):
    """Check trusted runner context without reading any secret values."""
    from collections.abc import Mapping

    if not isinstance(environment, Mapping):
        raise ValueError("Unauthorized resolution runner")

    required = {
        "GITHUB_REPOSITORY": "linyuli303/Apps",
        "GITHUB_REPOSITORY_OWNER_ID": "42029941",
        "GITHUB_ACTOR_ID": "42029941",
        "GITHUB_TRIGGERING_ACTOR": "linyuli303",
        "GITHUB_EVENT_NAME": "issues",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF": (
            "linyuli303/Apps/.github/workflows/"
            "channel-resolve.yml@refs/heads/main"
        ),
    }

    if any(environment.get(key) != value
           for key, value in required.items()):
        raise ValueError("Unauthorized resolution runner")

    for key in ("GITHUB_SHA", "GITHUB_WORKFLOW_SHA"):
        value = environment.get(key)
        if not isinstance(value, str) or not re.fullmatch(
            r"[0-9a-f]{40}", value
        ):
            raise ValueError("Invalid resolution source revision")

    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        value = environment.get(key)
        if not isinstance(value, str) or not re.fullmatch(
            r"[1-9][0-9]{0,19}", value
        ):
            raise ValueError("Invalid resolution run identity")

    return {
        "source_sha": environment["GITHUB_SHA"],
        "workflow_sha": environment["GITHUB_WORKFLOW_SHA"],
        "run_id": environment["GITHUB_RUN_ID"],
        "run_attempt": environment["GITHUB_RUN_ATTEMPT"],
    }



def read_resolution_issue(number, token, *, opener=None):
    """Read one Issue from the fixed repository; no write operations."""
    import json
    import urllib.request

    if type(number) is not int or not 1 <= number <= 9999999999:
        raise ValueError("Invalid resolution Issue number")
    if (not isinstance(token, str) or not 1 <= len(token) <= 8192
            or not token.isascii()
            or any(ord(c) <= 32 or ord(c) >= 127 for c in token)):
        raise ValueError("Invalid resolution reader credentials")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    url = (
        "https://api.github.com/repos/linyuli303/Apps/issues/"
        + str(number)
    )
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "MyApps-channel-resolver",
        },
    )

    try:
        client = opener if opener is not None else (
            urllib.request.build_opener(NoRedirect())
        )
        with client.open(request, timeout=15) as response:
            if (response.status != 200 or response.geturl() != url
                    or response.headers.get_content_type()
                    != "application/json"):
                raise ValueError("Invalid Issue response")

            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError("Issue response too large")
            issue = json.loads(raw.decode("utf-8"))
            if (not isinstance(issue, dict)
                    or type(issue.get("number")) is not int
                    or issue["number"] != number):
                raise ValueError("Issue response mismatch")
            return issue
    except Exception:
        # Do not propagate credentials, URLs, provider bodies or raw errors.
        raise RuntimeError("Resolution Issue unavailable") from None
