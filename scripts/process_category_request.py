"""Apply a reviewed owner Issue; write only categories.json; dispatch reuse only."""
import base64
import json
import os
from pathlib import Path
import re
import sys
from category_request import authorize_event, validate_model, unique_object, apply_request
from channel_request import validate_config
from process_channel_request import github, REPO, OWNER_ID

def read_file(call, name, limit):
    file = call("GET", f"/repos/{REPO}/contents/{name}?ref=main")
    if (not isinstance(file, dict) or file.get("type") != "file"
            or file.get("path") != name or file.get("encoding") != "base64"
            or not re.fullmatch(r"[0-9a-f]{40}", str(file.get("sha", "")))
            or not isinstance(file.get("content"), str)):
        raise ValueError("Unexpected repository file")
    if len(file["content"]) > limit * 2:
        raise ValueError("Encoded file too large")
    raw = base64.b64decode(file["content"].replace("\n", ""), validate=True)
    if len(raw) > limit:
        raise ValueError("File too large")
    return file, json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)

def process(event, call=github):
    number, request = authorize_event(event)
    live = call("GET", f"/repos/{REPO}/issues/{number}")
    checked = dict(event)
    checked["issue"] = live
    if authorize_event(checked) != (number, request):
        raise ValueError("Request changed")
    if (live.get("body") != event["issue"].get("body")
            or live.get("updated_at") != event["issue"].get("updated_at")):
        raise ValueError("Issue edited; submit a new Issue")
    file, current = read_file(call, "categories.json", 200000)
    if file["sha"] != request["baseRevision"]:
        raise ValueError("Stale category revision; no overwrite")
    _, config = read_file(call, "channels.json", 200000)
    approved = validate_config(config)
    validate_model(current)
    updated = apply_request(current, request, approved)
    if current != updated:
        content = (json.dumps(updated, ensure_ascii=True, indent=2) + "\n").encode("utf-8")
        call("PUT", f"/repos/{REPO}/contents/categories.json", {
            "message": f"Apply owner category request #{number}",
            "content": base64.b64encode(content).decode("ascii"),
            "sha": file["sha"], "branch": "main",
        })
    call("POST", f"/repos/{REPO}/actions/workflows/publish.yml/dispatches", {
        "ref": "main", "inputs": {"reuse_published_feed": "true"},
    })
    print("Category request processed. Reuse-only publication dispatched; check that separate run.")

def main():
    try:
        if os.environ.get("GITHUB_REPOSITORY") != REPO or os.environ.get("GITHUB_ACTOR_ID") != str(OWNER_ID):
            raise ValueError("Unauthorized runner")
        path = Path(os.environ["GITHUB_EVENT_PATH"])
        if path.stat().st_size > 1000000:
            raise ValueError("Event too large")
        process(json.loads(path.read_text(encoding="utf-8")))
        return 0
    except Exception:
        print("Category request stopped. No request contents or credentials logged. Check owner, unchanged Issue, revision and schema. If a commit succeeded but publication failed, dispatch reuse-only publication manually.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
