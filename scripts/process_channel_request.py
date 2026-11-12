"""Process a fresh owner request using GitHub's fixed-origin API.
No issue text is interpolated into shell commands. Only channels.json is written.
"""
import base64
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
from channel_request import authorize_event, apply_change

REPO = "linyuli303/Apps"
OWNER_ID = 42029941

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def github(method, path, payload=None):
    if not path.startswith("/repos/" + REPO + "/"):
        raise ValueError("Unexpected API path")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "https://api.github.com" + path, data=data, method=method,
        headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"],
                 "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "User-Agent": "MyTube-channel-request"},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise RuntimeError("Response too large")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise RuntimeError("GitHub request failed with HTTP " + str(status)) from None

def process(event, call=github):
    number, operation, channel_id = authorize_event(event)
    if event["repository"]["owner"]["id"] != OWNER_ID:
        raise ValueError("Unexpected owner ID")
    live = call("GET", f"/repos/{REPO}/issues/{number}")
    checked = dict(event)
    checked["issue"] = live
    if authorize_event(checked) != (number, operation, channel_id):
        raise ValueError("Request changed")
    if live.get("body") != event["issue"].get("body") or live.get("updated_at") != event["issue"].get("updated_at"):
        raise ValueError("Issue edited since submission; submit a new request")
    file = call("GET", f"/repos/{REPO}/contents/channels.json?ref=main")
    if file.get("type") != "file" or file.get("path") != "channels.json" or file.get("encoding") != "base64":
        raise ValueError("Unexpected configuration file")
    raw = base64.b64decode(file["content"].replace("\n", ""), validate=True)
    if len(raw) > 200_000:
        raise ValueError("Configuration too large")
    config = json.loads(raw.decode("utf-8"))
    updated, changed = apply_change(config, operation, channel_id)
    if changed:
        content = (json.dumps(updated, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        call("PUT", f"/repos/{REPO}/contents/channels.json", {
            "message": f"Apply owner channel request #{number}",
            "content": base64.b64encode(content).decode("ascii"),
            "sha": file["sha"], "branch": "main",
        })
        print("Whitelist updated. Requesting publication.")
    else:
        print("Whitelist already matches request. Requesting publication.")
    # GITHUB_TOKEN commits do not trigger push workflows; explicitly dispatch.
    call("POST", f"/repos/{REPO}/actions/workflows/publish.yml/dispatches", {"ref": "main"})
    print("Refresh and publish dispatched. Check that separate run for deployment success.")

def main():
    try:
        if os.environ.get("GITHUB_REPOSITORY") != REPO or os.environ.get("GITHUB_ACTOR_ID") != str(OWNER_ID):
            raise ValueError("Unauthorized runner context")
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        process(event)
        return 0
    except Exception:
        print("Channel request stopped. No credentials or request bodies were logged. Check authorization, unchanged issue, permissions, and concurrent whitelist edits. If the whitelist commit succeeded but dispatch failed, manually run Refresh and publish.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
