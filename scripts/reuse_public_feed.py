"""Reuse only the fixed public MyTube snapshot, with fail-closed validation."""
from collections import Counter
import datetime as dt
import json
from pathlib import Path
import re
import urllib.request

from build_feed import read_config
from prepare_site import validate_feed, security

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FEED = "https://linyuli303.github.io/MyTube/data/feed.json"
MAX_BYTES = 25_000_000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def download():
    request = urllib.request.Request(
        PUBLIC_FEED,
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "User-Agent": "MyTube-public-feed-reuse",
        },
    )
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=45) as response:
        if response.status != 200 or response.geturl() != PUBLIC_FEED:
            raise ValueError("Unexpected public feed response")
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Public feed too large")
    return raw

def validate_snapshot(raw, config, now=None):
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        raise ValueError("Invalid public feed size")
    if security.sensitive(raw):
        raise ValueError("Public feed failed credential-pattern checks")
    feed = json.loads(raw.decode("utf-8"))
    validate_feed(feed, config)

    generated = feed.get("generatedAt")
    if not isinstance(generated, str):
        raise ValueError("Missing timestamp")
    timestamp = dt.datetime.fromisoformat(generated.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("Timezone required")
    now = now or dt.datetime.now(dt.timezone.utc)
    age = (now - timestamp).total_seconds()
    if not -300 <= age <= 86400:
        raise ValueError("Expired or future feed")

    if feed["title"] != config.get("title", "My Channels"):
        raise ValueError("Feed title differs from configuration")
    channel_ids = [channel["id"] for channel in feed["channels"]]
    if len(channel_ids) != len(set(channel_ids)):
        raise ValueError("Duplicate channels")
    seen = set()
    counts = Counter()
    for video in feed["videos"]:
        if video["id"] in seen:
            raise ValueError("Duplicate videos")
        seen.add(video["id"])
        counts[video["channelId"]] += 1
        if (
            len(video["title"]) > 1000
            or len(video["duration"]) > 100
            or len(video["publishedAt"]) > 100
        ):
            raise ValueError("Invalid video metadata")
        published = dt.datetime.fromisoformat(
            video["publishedAt"].replace("Z", "+00:00")
        )
        if published.tzinfo is None:
            raise ValueError("Video timezone required")
    limit = config.get("max_videos_per_channel", 30)
    if any(count > limit for count in counts.values()):
        raise ValueError("Feed exceeds configured channel limit")
    return feed


def filter_removed_channels(raw, config, now=None):
    """Allow only subtractive membership changes to a valid public snapshot."""
    if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
        raise ValueError("Invalid snapshot size")
    if security.sensitive(raw):
        raise ValueError("Snapshot failed credential-pattern checks")
    snapshot = json.loads(raw.decode("utf-8"))
    if not isinstance(snapshot, dict) or not isinstance(
        snapshot.get("channels"), list
    ):
        raise ValueError("Invalid snapshot")

    published = set()
    for channel in snapshot["channels"]:
        if (
            not isinstance(channel, dict)
            or not isinstance(channel.get("id"), str)
            or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", channel["id"])
        ):
            raise ValueError("Invalid published channel")
        published.add(channel["id"])

    approved = {channel["id"] for channel in config["channels"]}
    if not approved.issubset(published):
        raise ValueError("New channels require a YouTube refresh")

    # Validate the complete original snapshot, including videos that will
    # be removed. Only membership differs; all other settings remain current.
    original_config = dict(config)
    original_config["channels"] = [
        {"id": channel_id} for channel_id in sorted(published)
    ]
    validated = validate_snapshot(raw, original_config, now)

    if approved == published:
        validate_snapshot(raw, config, now)
        return raw

    filtered = dict(validated)
    filtered["channels"] = [
        channel for channel in validated["channels"]
        if channel["id"] in approved
    ]
    filtered["videos"] = [
        video for video in validated["videos"]
        if video["channelId"] in approved
    ]
    # generatedAt is deliberately retained, not reset.
    result = json.dumps(filtered, ensure_ascii=False).encode("utf-8")
    validate_snapshot(result, config, now)
    return result

def main():
    try:
        config = read_config(ROOT / "channels.json")
        raw = download()
        original = raw
        raw = filter_removed_channels(raw, config)
        if raw != original:
            print("Removed unapproved channels and their videos from snapshot.")
        target = ROOT / "site" / "data" / "feed.json"
        if target.parent.is_symlink() or target.is_symlink():
            raise ValueError("Refusing symlink output")
        target.parent.mkdir(exist_ok=True)
        # Preserve the original timestamp and exact validated snapshot.
        target.write_bytes(raw)
        print("Reused validated public snapshot. Original timestamp preserved.")
        print("No YouTube API requests were made.")
        return 0
    except Exception:
        print(
            "Public feed reuse stopped: snapshot unavailable, expired, invalid, "
            "or inconsistent with configuration. No YouTube fallback was attempted. "
            "After quota resets, manually run Refresh and publish."
        )
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
