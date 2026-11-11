"""Publish only an explicit set of website assets, never the repository root."""
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys

_scripts_path = str(Path(__file__).resolve().parent)
if _scripts_path not in sys.path:
    sys.path.insert(0, _scripts_path)
from shared_categories_public import package as package_categories

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("security",ROOT/"scripts/security_check.py")
security=importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)
ASSETS=("index.html","style.css","app.js","icon.svg","data/feed.json")

def validate_feed(feed, config):
    if not isinstance(feed,dict) or set(feed)!={"title","generatedAt","channels","videos"}:
        raise ValueError("Invalid feed schema")
    if not isinstance(feed["channels"],list) or not isinstance(feed["videos"],list):
        raise ValueError("Invalid feed lists")
    if len(feed["channels"])>1000 or len(feed["videos"])>50000:
        raise ValueError("Feed exceeds configured safety limits")
    ids=set()
    for c in feed["channels"]:
        if set(c)!={"id","title"} or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}",c["id"]) or not isinstance(c["title"],str):
            raise ValueError("Invalid channel")
        ids.add(c["id"])
    configured=config.get("channels",[])
    # For ID-only configs from Takeout, independently enforce the exact configured set.
    if all(isinstance(c,dict) and set(c)=={"id"} for c in configured):
        if ids!={c["id"] for c in configured}:
            raise ValueError("Feed channel list differs from configuration")
    for v in feed["videos"]:
        base_fields = {"id","channelId","title","publishedAt","duration"}
        if (
            not isinstance(v, dict)
            or set(v) not in (base_fields, base_fields | {"viewCount"})
            or not all(isinstance(x, str) for x in v.values())
        ):
            raise ValueError("Invalid video schema")
        count = v.get("viewCount", "")
        if count != "" and not re.fullmatch(r"[0-9]{1,20}", count):
            raise ValueError("Invalid view count")
        if v["channelId"] not in ids or not re.fullmatch(r"[A-Za-z0-9_-]{11}",v["id"]):
            raise ValueError("Unapproved video")
    return True

def prepare():
    source=ROOT/"site"
    output=ROOT/"_site"
    if output.is_symlink(): raise ValueError("Refusing symlink output")
    for name in ASSETS:
        path=source/name
        if any(p.is_symlink() for p in (source,path,path.parent)) or not path.is_file():
            raise ValueError("Missing or symlinked website asset")
        if path.stat().st_size>25_000_000 or security.sensitive(path.read_bytes()):
            raise ValueError("Website asset failed size/credential checks")
    validate_feed(json.loads((source/"data/feed.json").read_text()),json.loads((ROOT/"channels.json").read_text()))
    public_js, category_revision = package_categories(ROOT, (source/"app.js").read_text(encoding="utf-8"))
    if security.sensitive(public_js.encode("utf-8")) or len(public_js.encode("utf-8")) > 25_000_000:
        raise ValueError("Packaged script failed safety checks")
    if output.exists():shutil.rmtree(output)
    output.mkdir()
    for name in ASSETS:
        target=output/name
        target.parent.mkdir(parents=True,exist_ok=True)
        if name == "app.js":
            target.write_text(public_js, encoding="utf-8", newline="\n")
        elif name == "index.html":
            html = (source/name).read_text(encoding="utf-8")
            html, count = re.subn(r'app\.js\?v=[^"\s]+', "app.js?v=shared-categories-" + category_revision, html)
            if count != 1:
                raise ValueError("Missing application cache version")
            target.write_text(html, encoding="utf-8", newline="\n")
        else:
            shutil.copyfile(source/name,target)
    print("Staged exactly five public assets; raw exports, repository configuration, and credentials are excluded.")

if __name__=="__main__":
    try:prepare()
    except Exception:
        print("Public artifact validation failed. Publication stopped; no input contents were logged.")
        raise SystemExit(1)
