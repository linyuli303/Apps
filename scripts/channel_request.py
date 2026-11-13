"""Pure validation for owner-authorized GitHub channel requests.
Authorization and publication are enforced separately by the workflow.
This module performs no network requests and writes no files.
"""
import copy
import re

CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}")
CONFIRMATION = "I reviewed this channel ID and want to change the shared whitelist on all devices."

def parse_request(body):
    if not isinstance(body, str) or len(body) > 4096:
        raise ValueError("Invalid request body")
    body = body.replace("\r\n", "\n").strip()
    pattern = (
        r"### Operation\n+[ \t]*(Add|Remove)[ \t]*\n+"
        r"### Channel ID\n+[ \t]*(UC[A-Za-z0-9_-]{22})[ \t]*\n+"
        r"### Confirmation\n+- \[x\] " + re.escape(CONFIRMATION)
    )
    match = re.fullmatch(pattern, body)
    if not match:
        raise ValueError("Use the channel request form with a reviewed immutable channel ID")
    return match.group(1), match.group(2)

def validate_config(config):
    if not isinstance(config, dict) or set(config) - {"title", "max_videos_per_channel", "channels"}:
        raise ValueError("Unexpected whitelist configuration")
    if "title" in config and (not isinstance(config["title"], str) or len(config["title"]) > 120):
        raise ValueError("Invalid title")
    limit = config.get("max_videos_per_channel", 15)
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("Invalid per-channel limit")
    channels = config.get("channels")
    if not isinstance(channels, list) or len(channels) > 1000:
        raise ValueError("Invalid channels")
    seen = set()
    for entry in channels:
        if not isinstance(entry, dict) or set(entry) != {"id"}:
            raise ValueError("Invalid channel entry")
        cid = entry["id"]
        if not isinstance(cid, str) or not CHANNEL_ID.fullmatch(cid) or cid in seen:
            raise ValueError("Invalid or duplicate channel ID")
        seen.add(cid)
    return seen

def apply_change(config, operation, channel_id):
    ids = validate_config(config)
    if operation not in {"Add", "Remove"} or not isinstance(channel_id, str) or not CHANNEL_ID.fullmatch(channel_id):
        raise ValueError("Invalid change")
    result = copy.deepcopy(config)
    if operation == "Add" and channel_id not in ids:
        if len(ids) >= 1000:
            raise ValueError("Channel limit reached")
        result["channels"].append({"id": channel_id})
    elif operation == "Remove":
        result["channels"] = [entry for entry in result["channels"] if entry["id"] != channel_id]
    return result, result != config


def authorize_event(event, *, bulk=False):
    """Fail closed; only a new issue opened by the expected personal owner.

    The workflow must independently gate execution and fetch/check the live
    issue before writing. This validator does not grant any token permissions.
    """
    if not isinstance(event, dict) or event.get("action") != "opened":
        raise ValueError("Unauthorized event")
    repo = event.get("repository")
    issue = event.get("issue")
    sender = event.get("sender")
    if not all(isinstance(value, dict) for value in (repo, issue, sender)):
        raise ValueError("Unauthorized event")
    owner = repo.get("owner")
    author = issue.get("user")
    if not isinstance(owner, dict) or not isinstance(author, dict):
        raise ValueError("Unauthorized event")
    owner_id = owner.get("id")
    if (repo.get("full_name") != "linyuli303/Apps"
            or repo.get("default_branch") != "main"
            or owner.get("login") != "linyuli303"
            or owner.get("type") != "User"
            or type(owner_id) is not int or owner_id <= 0
            or sender.get("id") != owner_id or author.get("id") != owner_id
            or sender.get("login") != "linyuli303"
            or author.get("login") != "linyuli303"
            or sender.get("type") != "User" or author.get("type") != "User"
            or "pull_request" in issue or issue.get("state") != "open"
            or type(issue.get("number")) is not int or issue["number"] <= 0
            or issue.get("title") != "[MyTube] Channel change"):
        raise ValueError("Unauthorized event")
    if type(bulk) is not bool:
        raise ValueError("Invalid authorization mode")
    if bulk:
        ids = parse_additions_request(issue.get("body"))
        return issue["number"], "Add multiple", ids
    operation, channel_id = parse_request(issue.get("body"))
    return issue["number"], operation, channel_id

def apply_additions(config, channel_ids):
    """Return a fully validated batch result without mutating the input."""
    existing = validate_config(config)
    if not isinstance(channel_ids, list) or not 1 <= len(channel_ids) <= 50:
        raise ValueError("Use between 1 and 50 channel IDs")

    seen = set()
    additions = []
    for cid in channel_ids:
        if (not isinstance(cid, str)
                or not CHANNEL_ID.fullmatch(cid)
                or cid in seen):
            raise ValueError("Invalid or duplicate batch channel ID")
        seen.add(cid)
        if cid not in existing:
            additions.append(cid)

    if len(existing) + len(additions) > 1000:
        raise ValueError("Channel limit reached")

    result = copy.deepcopy(config)
    result["channels"].extend({"id": cid} for cid in additions)
    validate_config(result)
    return result, bool(additions)

BULK_CONFIRMATION = (
    "I reviewed these channel IDs and want to add them "
    "to the shared whitelist on all devices."
)


def parse_additions_request(body):
    """Parse a bounded bulk-add form; no authorization or side effects."""
    if not isinstance(body, str) or len(body) > 4096:
        raise ValueError("Invalid bulk request body")

    normalized = body.replace("\r\n", "\n").strip()
    pattern = (
        r"### Operation\n+[ \t]*Add multiple[ \t]*\n+"
        r"### Channel IDs\n+(?P<ids>.*?)\n+"
        r"### Confirmation\n+- \[x\] " + re.escape(BULK_CONFIRMATION)
    )
    match = re.fullmatch(pattern, normalized, re.DOTALL)
    if not match:
        raise ValueError("Use the reviewed bulk channel request form")

    lines = match.group("ids").split("\n")
    if not 1 <= len(lines) <= 50:
        raise ValueError("Use between 1 and 50 channel IDs")

    ids = []
    seen = set()
    for line in lines:
        cid = line.strip(" \t")
        if not CHANNEL_ID.fullmatch(cid) or cid in seen:
            raise ValueError("Invalid or duplicate batch channel ID")
        seen.add(cid)
        ids.append(cid)

    return tuple(ids)
