"""Build a static, validated snapshot using only the official YouTube Data API."""
import csv
import datetime as dt
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}\Z")
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")

def read_subscriptions(path):
    """Read a Google Takeout subscription CSV, validating every nonempty row."""
    if path.stat().st_size > 5_000_000:
        raise ValueError("Subscription export exceeds the 5 MB limit")
    channels, seen = [], set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or "Channel ID" not in reader.fieldnames:
            raise ValueError("subscriptions.csv must have a Channel ID column")
        if len(set(reader.fieldnames)) != len(reader.fieldnames):
            raise ValueError("Duplicate CSV headers are not allowed")
        for line, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Malformed CSV field count at row {line}")
            if not any(str(value or "").strip() for value in row.values()):
                continue
            cid = (row.get("Channel ID") or "").strip()
            if not CHANNEL_ID.fullmatch(cid):
                raise ValueError(f"Invalid or missing channel ID in subscriptions.csv, row {line}")
            url = (row.get("Channel URL") or "").strip()
            if url:
                parsed = urllib.parse.urlparse(url)
                if parsed.scheme not in ("http", "https") or parsed.netloc not in ("www.youtube.com", "youtube.com") or parsed.path.rstrip("/") != "/channel/" + cid or parsed.query or parsed.fragment:
                    raise ValueError(f"Channel URL and ID disagree in subscriptions.csv, row {line}")
            if cid not in seen:
                channels.append({"id": cid})
                seen.add(cid)
                if len(channels) > 1000:
                    raise ValueError("At most 1000 unique channels are supported")
    if not channels:
        raise ValueError("subscriptions.csv contains no channels; refusing an accidental empty import")
    return channels

def read_config(path):
    if path.stat().st_size > 200000:
        raise ValueError("Configuration exceeds size limit")
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("channels.json must be an object")
    if "subscriptions_csv" in config:
        raise ValueError("CSV import is local-only. Run scripts/import_takeout.py and commit reviewed channels.json instead")
    unknown = set(config) - {"title", "max_videos_per_channel", "channels"}
    if unknown:
        raise ValueError("Unknown channels.json field")
    if "channels" not in config:
        raise ValueError("An explicit channels list is required")
    channels = config.get("channels", [])
    if not isinstance(channels, list) or len(channels) > 1000:
        raise ValueError("channels must be a list with at most 1000 entries")
    for entry in channels:
        if not isinstance(entry, dict) or set(entry) != {"id"} or not isinstance(entry["id"], str) or not CHANNEL_ID.fullmatch(entry["id"]):
            raise ValueError("Approved channels must be immutable channel IDs; resolve handles locally before approval")
    if len({c["id"] for c in channels}) != len(channels):
        raise ValueError("Duplicate channel IDs are not allowed")
    limit = config.get("max_videos_per_channel", 30)
    if type(limit) is not int or not 1 <= limit <= 50:
        raise ValueError("max_videos_per_channel must be an integer from 1 to 50")
    if not isinstance(config.get("title", "My Channels"), str) or len(config.get("title", "My Channels")) > 120:
        raise ValueError("title must be a string of at most 120 characters")
    return config

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(resource, params, key):
    if resource not in {"channels", "playlistItems", "videos"}:
        raise ValueError("Unsupported API resource")
    if not key or "\n" in key or "\r" in key:
        raise ValueError("Invalid API key configuration")
    query = urllib.parse.urlencode(params)
    url = "https://www.googleapis.com/youtube/v3/" + resource + "?" + query
    request = urllib.request.Request(url, headers={"X-Goog-Api-Key": key, "Accept": "application/json"})
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(3):
        try:
            with opener.open(request, timeout=30) as response:
                raw = response.read(5_000_001)
                if len(raw) > 5_000_000:
                    raise RuntimeError("YouTube API response exceeds size limit")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            # Do not print response bodies, request headers, or credential-bearing errors.
            raise RuntimeError(f"YouTube API {resource} failed (HTTP {error.code}). Check API enablement, key restrictions, and quota.") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError("YouTube API connection failed") from None
    raise RuntimeError("YouTube API unavailable")

def build(config, key, request=api):
    if config["channels"] and not key:
        raise ValueError("Set the YOUTUBE_API_KEY repository Actions secret first")
    channels, candidates, seen = [], [], set()
    for entry in config["channels"]:
        params = {"part":"snippet,contentDetails"}
        params.update({"id":entry["id"]} if "id" in entry else {"forHandle":entry["handle"]})
        items = request("channels", params, key).get("items", [])
        if len(items) != 1:
            raise ValueError("A configured channel could not be resolved; no partial feed was published")
        channel = items[0]
        cid = channel["id"]
        if not CHANNEL_ID.fullmatch(cid) or ("id" in entry and cid != entry["id"]):
            raise ValueError("Unexpected channel ID from API")
        if cid in seen:
            continue
        seen.add(cid)
        channels.append({"id":cid,"title":channel["snippet"]["title"]})
        playlist = channel["contentDetails"]["relatedPlaylists"]["uploads"]
        uploads = request("playlistItems", {"part":"contentDetails", "playlistId":playlist,
                           "maxResults":config.get("max_videos_per_channel",30)}, key).get("items", [])
        candidates.extend(item.get("contentDetails",{}).get("videoId", "") for item in uploads)
    ids = list(dict.fromkeys(vid for vid in candidates if VIDEO_ID.fullmatch(vid)))
    approved = {c["id"] for c in channels}
    videos = []
    for offset in range(0, len(ids), 50):
        details = request("videos", {"part":"snippet,status,contentDetails", "id":",".join(ids[offset:offset+50])}, key)
        for item in details.get("items", []):
            snippet, status = item["snippet"], item["status"]
            # Verify ownership independently; a playlist entry alone is not authorization.
            if item["id"] not in ids[offset:offset+50] or snippet["channelId"] not in approved:
                continue
            if status.get("privacyStatus") != "public" or not status.get("embeddable"):
                continue
            # Upcoming streams are not yet playable. Active live streams may be included.
            if snippet.get("liveBroadcastContent") == "upcoming":
                continue
            videos.append({"id":item["id"], "channelId":snippet["channelId"],
                           "title":snippet["title"], "publishedAt":snippet["publishedAt"],
                           "duration":item.get("contentDetails",{}).get("duration", "")})
    videos.sort(key=lambda v:v["publishedAt"], reverse=True)
    return {"title":config.get("title","My Channels"),
            "generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),
            "channels":channels, "videos":videos}

def main():
    try:
        config = read_config(ROOT / "channels.json")
        feed = build(config, os.environ.get("YOUTUBE_API_KEY", ""))
        out = ROOT / "site" / "data"
        out.mkdir(exist_ok=True)
        content = json.dumps(feed, ensure_ascii=False)
        secret = os.environ.get("YOUTUBE_API_KEY", "")
        if secret and secret in content:
            raise RuntimeError("Credential detected in generated feed; publication stopped")
        temporary = out / "feed.json.tmp"
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(out / "feed.json")
        print(f"Built {len(feed['videos'])} videos from {len(feed['channels'])} approved channels.")
    except Exception as exc:
        print("Build failed. No new deployment was published.")
        print("Error category:", type(exc).__name__)

        safe_messages = {
            "Set the YOUTUBE_API_KEY repository Actions secret first":
                "The API key is missing from this workflow step.",
            "Invalid API key configuration":
                "The API key is empty or contains a newline.",
            "A configured channel could not be resolved; no partial feed was published":
                "One configured channel could not be resolved.",
            "YouTube API connection failed":
                "The connection to Google's API failed.",
            "YouTube API response exceeds size limit":
                "The API response exceeded the safety limit.",
        }

        message = str(exc)
        if message in safe_messages:
            print(safe_messages[message])

        match = re.fullmatch(
            r"YouTube API (channels|playlistItems|videos) failed "
            r"\(HTTP ([0-9]{3})\)\. Check API enablement, key restrictions, and quota\.",
            message,
        )
        if match:
            print("API operation:", match.group(1))
            print("HTTP status:", match.group(2))

        raise SystemExit(1)

if __name__ == "__main__":
    main()
