"""Strict, network-free validation for shared category requests."""
import copy
import json
import re
from channel_request import authorize_event as authorize_channel_event, validate_config

TITLE = "[MyTube] Category change"
CONFIRMATION = "I reviewed these public categories and assignments and want to save them for all devices."
MAX_BYTES = 48000

def validate_model(model, approved=None):
    if not isinstance(model, dict) or set(model) != {"version", "categories", "assignments"}:
        raise ValueError("Invalid category schema")
    if type(model["version"]) is not int or model["version"] != 1:
        raise ValueError("Invalid version")
    categories, assignments = model["categories"], model["assignments"]
    if not isinstance(categories, list) or len(categories) > 50:
        raise ValueError("Invalid categories")
    if not isinstance(assignments, dict) or len(assignments) > 1000:
        raise ValueError("Invalid assignments")
    ids, names = set(), set()
    for category in categories:
        if not isinstance(category, dict) or set(category) != {"id", "name"}:
            raise ValueError("Invalid category")
        cid, name = category["id"], category["name"]
        if (not isinstance(cid, str) or not re.fullmatch(r"cat-[A-Za-z0-9-]{1,64}", cid)
                or not isinstance(name, str) or not name or name != name.strip()
                or len(name.encode("utf-16-le")) // 2 > 50
                or re.search(r"[\x00-\x1f\x7f]", name)):
            raise ValueError("Invalid category identity or name")
        folded = name.lower()
        if cid in ids or folded in names or folded in {"all categories", "uncategorized"}:
            raise ValueError("Duplicate or reserved category")
        ids.add(cid)
        names.add(folded)
    for cid, tags in assignments.items():
        if (not isinstance(cid, str) or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", cid)
                or not isinstance(tags, list) or len(tags) > 50
                or any(not isinstance(tag, str) or tag not in ids for tag in tags)
                or len(set(tags)) != len(tags)):
            raise ValueError("Invalid channel assignment")
        if approved is not None and cid not in approved:
            raise ValueError("Assignment is outside approved whitelist")
    if len(json.dumps(model, ensure_ascii=True, separators=(",", ":")).encode("utf-8")) > MAX_BYTES:
        raise ValueError("Category data exceeds Issue transport limit")
    return model

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result

def parse_request(body):
    if not isinstance(body, str) or len(body.encode("utf-8")) > 60000:
        raise ValueError("Invalid Issue size")
    pattern = (r"### Category request\n+```json\n(.*?)\n```\n+"
               r"### Confirmation\n+- \[x\] " + re.escape(CONFIRMATION))
    match = re.fullmatch(pattern, body.replace("\r\n", "\n").strip(), re.S)
    if not match:
        raise ValueError("Use reviewed category request form")
    request = json.loads(match.group(1), object_pairs_hook=unique_object)
    if not isinstance(request, dict) or set(request) not in (
        {"baseRevision", "model"}, {"baseRevision", "operations"}
    ):
        raise ValueError("Invalid request schema")
    if not isinstance(request["baseRevision"], str) or not re.fullmatch(r"[0-9a-f]{40}", request["baseRevision"]):
        raise ValueError("Invalid base revision")
    if "model" in request:
        # Previously reviewed full-model Issues remain supported.
        validate_model(request["model"])
    else:
        validate_operations(request["operations"])
    return request


def validate_operations(operations):
    if not isinstance(operations, list) or not 1 <= len(operations) <= 1001:
        raise ValueError("Invalid change list")
    seen = set()
    for operation in operations:
        if not isinstance(operation, dict):
            raise ValueError("Invalid change")
        kind = operation.get("op")
        if kind == "setCategories" and set(operation) == {"op", "categories"}:
            validate_model({"version": 1, "categories": operation["categories"], "assignments": {}})
            target = "definitions"
        elif kind == "setChannelCategories" and set(operation) == {"op", "channelId", "categoryIds"}:
            cid, tags = operation["channelId"], operation["categoryIds"]
            if (not isinstance(cid, str) or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", cid)
                    or not isinstance(tags, list) or len(tags) > 50
                    or any(not isinstance(tag, str) or not re.fullmatch(r"cat-[A-Za-z0-9-]{1,64}", tag) for tag in tags)
                    or len(set(tags)) != len(tags)):
                raise ValueError("Invalid assignment change")
            target = cid
        else:
            raise ValueError("Unsupported change schema")
        if target in seen:
            raise ValueError("Duplicate change target")
        seen.add(target)
    if len(json.dumps(operations, ensure_ascii=True).encode("utf-8")) > MAX_BYTES:
        raise ValueError("Change list too large")
    return operations


def apply_request(current, request, approved):
    validate_model(current)
    if "operations" not in request:
        validate_model(request["model"], approved)
        return copy.deepcopy(request["model"])
    operations = validate_operations(request["operations"])
    result = copy.deepcopy(current)
    # Definitions are resolved first. Deleted categories lose their assignments.
    for operation in operations:
        if operation["op"] == "setCategories":
            result["categories"] = copy.deepcopy(operation["categories"])
    ids = {category["id"] for category in result["categories"]}
    for cid in list(result["assignments"]):
        tags = [tag for tag in result["assignments"][cid] if tag in ids]
        if tags:
            result["assignments"][cid] = tags
        else:
            del result["assignments"][cid]
    for operation in operations:
        if operation["op"] != "setChannelCategories":
            continue
        cid, tags = operation["channelId"], operation["categoryIds"]
        if cid not in approved:
            raise ValueError("Changed channel is not approved")
        if any(tag not in ids for tag in tags):
            raise ValueError("Changed category does not exist")
        if tags:
            result["assignments"][cid] = list(tags)
        else:
            result["assignments"].pop(cid, None)
    # Preserve unrelated legacy assignments, including removed channels. Public
    # packaging filters them; this request cannot create new unapproved ones.
    validate_model(result)
    return result


def authorize_event(event):
    if not isinstance(event, dict) or not isinstance(event.get("issue"), dict):
        raise ValueError("Invalid event")
    if event["issue"].get("title") != TITLE:
        raise ValueError("Unexpected title")
    request = parse_request(event["issue"].get("body"))
    # Reuse the existing strict personal-owner authorization, not its parser.
    checked = copy.deepcopy(event)
    checked["issue"]["title"] = "[MyTube] Channel change"
    checked["issue"]["body"] = (
        "### Operation\n\nRemove\n\n### Channel ID\n\nUC" + "a" * 22
        + "\n\n### Confirmation\n\n- [x] I reviewed this channel ID and want to change the shared whitelist on all devices."
    )
    number, _, _ = authorize_channel_event(checked)
    if type(event["repository"]["owner"]["id"]) is not int or event["repository"]["owner"]["id"] != 42029941:
        raise ValueError("Unauthorized numeric owner")
    return number, request
