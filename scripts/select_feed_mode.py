"""Choose feed mode without network access or credentials."""
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
# Changes to these inputs require rebuilding rather than reusing a snapshot.
FEED_INPUTS = {
    "channels.json",
    "scripts/build_feed.py",
    "scripts/prepare_site.py",
}
SHA = re.compile(r"[a-f0-9]{40}\Z")

def needs_refresh(event_name, event, head, diff):
    # Manual dispatch includes owner channel requests and recovery/no-op requests.
    if event_name == "workflow_dispatch":
        inputs = event.get("inputs", {})
        if not isinstance(inputs, dict):
            raise ValueError("Invalid workflow inputs")
        reuse = inputs.get("reuse_published_feed", False)
        # GitHub event payloads may serialize boolean inputs as strings.
        if reuse is True or (isinstance(reuse, str) and reuse == "true"):
            return False
        return True
    if event_name != "push":
        return True
    before = event.get("before")
    after = event.get("after")
    if (
        event.get("ref") != "refs/heads/main"
        or not isinstance(before, str)
        or not SHA.fullmatch(before)
        or before == "0" * 40
        or not isinstance(after, str)
        or not SHA.fullmatch(after)
        or after != head
    ):
        return True
    try:
        changed = diff(before, after)
    except Exception:
        return True
    return bool(FEED_INPUTS.intersection(changed))

def changed_paths(before, after):
    result = subprocess.run(
        ["git", "diff", "--name-only", "-z", before, after, "--"],
        cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=60,
    )
    return set(result.stdout.decode("utf-8").strip("\0").split("\0")) - {""}

def main():
    try:
        if (
            os.environ.get("GITHUB_REPOSITORY") != "linyuli303/MyTube"
            or os.environ.get("GITHUB_REF") != "refs/heads/main"
        ):
            raise ValueError("Unexpected runner context")
        event = json.loads(
            Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8")
        )
        refresh = needs_refresh(
            os.environ.get("GITHUB_EVENT_NAME"),
            event,
            os.environ.get("GITHUB_SHA"),
            changed_paths,
        )
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write("refresh=" + str(refresh).lower() + "\n")
        print(
            "Feed mode: refresh approved channels."
            if refresh else
            "Feed mode: reuse validated public feed; no YouTube calls."
        )
        return 0
    except Exception:
        print("Feed-mode selection failed. No request data or credentials logged.")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
