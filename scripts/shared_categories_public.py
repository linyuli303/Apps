"""Validate and embed shared categories in the existing public JS asset."""
import hashlib
import json
from pathlib import Path
import sys

SCRIPTS = str(Path(__file__).resolve().parent)
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
from category_request import validate_model

MARKER = "const SHARED_CATEGORY_SNAPSHOT = null; // Replaced only in the published artifact."

def package(root, source_js):
    path = root / "categories.json"
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 200000:
        raise ValueError("Invalid shared category file")
    raw = path.read_bytes()
    model = json.loads(raw.decode("utf-8"))
    validate_model(model)
    # Ignore assignments for removed channels in the public snapshot; repository history stays intact.
    config = json.loads((root / "channels.json").read_text(encoding="utf-8"))
    allowed = {c["id"] for c in config["channels"]}
    model["assignments"] = {cid: tags for cid, tags in model["assignments"].items() if cid in allowed}
    revision = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
    if source_js.count(MARKER) != 1:
        raise ValueError("Missing or duplicate shared snapshot marker")
    payload = json.dumps({"revision": revision, "model": model}, ensure_ascii=True, separators=(",", ":"))
    # Double encoding prevents JavaScript object-literal special keys from changing JSON semantics.
    replacement = "const SHARED_CATEGORY_SNAPSHOT = JSON.parse(" + json.dumps(payload, ensure_ascii=True) + ");"
    return source_js.replace(MARKER, replacement), revision
