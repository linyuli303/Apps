"""Trusted proposal-only GitHub writer. Never runs proposal code or publishes.

The future workflow must pass the bundle SHA-256 through needs outputs from
its fixed read-only proposal-preflight job, not from the downloaded bundle.
This module is deliberately not wired into a workflow yet.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re

from podcast_proposal_binding import PATHS, verify_bound_proposal
from podcast_request import REPO, OWNER_ID, authorize_event
from podcast_resolution import decode
from process_channel_request import github

PREFIX = "/repos/" + REPO
MAX_BUNDLE = 8_000_000


def positive(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", value):
        raise ValueError("Invalid workflow identifier")
    return value


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Invalid Git SHA")
    return value


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def process(event, envelope, raw_bundle, expected_digest, run_id, attempt, call=github):
    """Create a new branch and draft PR, using independently fetched base bytes.

    expected_digest/run_id/attempt must come from trusted workflow context and
    needs outputs. A user-provided bundle cannot attest its own test success.
    No subprocesses, imports from proposal data, or branch checkouts occur here.
    Failures may leave unreachable Git objects or a proposal branch; callers
    must inspect GitHub state rather than automatically retrying writes.
    """
    number, _ = authorize_event(event)
    run_id, attempt = positive(run_id), positive(attempt)
    if (not isinstance(raw_bundle, bytes) or len(raw_bundle) > MAX_BUNDLE
            or not isinstance(expected_digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)
            or hashlib.sha256(raw_bundle).hexdigest() != expected_digest):
        raise ValueError("Untrusted preflight bundle")
    bundle = json.loads(raw_bundle.decode("utf-8"), object_pairs_hook=unique)
    if (not isinstance(bundle, dict)
            or set(bundle) != {"version", "manifest", "proposed", "checks"}
            or type(bundle["version"]) is not int or bundle["version"] != 1):
        raise ValueError("Invalid bundle")
    manifest = bundle["manifest"]
    if not isinstance(manifest, dict):
        raise ValueError("Invalid manifest")
    base = sha(manifest.get("baseSha"))
    checks = bundle["checks"]
    if (not isinstance(checks, dict) or set(checks) != {"tests", "security", "whitespace"}
            or checks["security"] != "passed" or checks["whitespace"] != "passed"):
        raise ValueError("Incomplete preflight")
    tests = checks["tests"]
    if (not isinstance(tests, dict) or set(tests) != {"ran", "skipped"}
            or type(tests["ran"]) is not int or tests["ran"] < 1
            or type(tests["skipped"]) is not int
            or not 0 <= tests["skipped"] <= tests["ran"]):
        raise ValueError("Invalid test summary")
    # Fixed workflow/run provenance; fail closed if issue-run SHA and checked-out
    # main differ. Workflow must not relabel or override this binding.
    run = call("GET", PREFIX + "/actions/runs/" + run_id)
    if (not isinstance(run, dict) or type(run.get("id")) is not int
            or str(run["id"]) != run_id or str(run.get("run_attempt")) != attempt
            or run.get("event") != "issues" or run.get("head_branch") != "main"
            or run.get("head_sha") != base
            or run.get("path") != ".github/workflows/podcast-change.yml"
            or run.get("repository", {}).get("full_name") != REPO
            or run.get("actor", {}).get("id") != OWNER_ID
            or run.get("triggering_actor", {}).get("id") != OWNER_ID):
        raise ValueError("Unexpected workflow provenance")
    jobs = call("GET", PREFIX + "/actions/runs/" + run_id
                + "/attempts/" + attempt + "/jobs?per_page=100")
    if (not isinstance(jobs, dict) or type(jobs.get("total_count")) is not int
            or not isinstance(jobs.get("jobs"), list)
            or jobs["total_count"] != len(jobs["jobs"]) or jobs["total_count"] > 100):
        raise ValueError("Incomplete job provenance")
    matches = [job for job in jobs["jobs"] if job.get("name") == "proposal-preflight"]
    if (len(matches) != 1 or matches[0].get("status") != "completed"
            or matches[0].get("conclusion") != "success"
            or matches[0].get("head_sha") != base
            or str(matches[0].get("run_id")) != run_id):
        raise ValueError("Preflight job did not succeed")

    def check_live():
        live = call("GET", PREFIX + "/issues/" + str(number))
        checked = dict(event, issue=live)
        if (authorize_event(checked) != authorize_event(event)
                or live.get("body") != event["issue"].get("body")
                or live.get("updated_at") != event["issue"].get("updated_at")):
            raise ValueError("Issue changed")
        ref = call("GET", PREFIX + "/git/ref/heads/main")
        if (ref.get("ref") != "refs/heads/main"
                or ref.get("object", {}).get("type") != "commit"
                or ref["object"].get("sha") != base):
            raise ValueError("Main changed")

    check_live()
    base_files = {}
    for path in sorted(PATHS):
        record = call("GET", PREFIX + "/contents/" + path + "?ref=" + base)
        if (record.get("type") != "file" or record.get("path") != path
                or record.get("encoding") != "base64"
                or not isinstance(record.get("content"), str)
                or len(record["content"]) > 2_800_000):
            raise ValueError("Unexpected base file")
        data = base64.b64decode(record["content"].replace("\n", ""), validate=True)
        if len(data) > 2_000_000:
            raise ValueError("Oversized base file")
        blob = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()
        if record.get("sha") != blob:
            raise ValueError("Base blob mismatch")
        base_files[path] = data
    proposed = verify_bound_proposal(manifest, event, envelope, base, base_files)
    if (not isinstance(bundle["proposed"], dict) or bundle["proposed"] != proposed):
        raise ValueError("Proposed bytes mismatch")
    commit = call("GET", PREFIX + "/git/commits/" + base)
    if commit.get("sha") != base:
        raise ValueError("Unexpected base commit")
    base_tree = sha(commit.get("tree", {}).get("sha"))
    entries = []
    for path in sorted(PATHS):
        # An inline tree entry avoids executing code or invoking Git with tokens.
        entries.append({"path": path, "mode": "100644", "type": "blob", "content": proposed[path]})
    check_live()
    tree = call("POST", PREFIX + "/git/trees", {"base_tree": base_tree, "tree": entries})
    tree_sha = sha(tree.get("sha"))
    created = call("POST", PREFIX + "/git/commits", {
        "message": "Propose owner podcast request #" + str(number),
        "tree": tree_sha, "parents": [base],
    })
    head = sha(created.get("sha"))
    if (created.get("tree", {}).get("sha") != tree_sha
            or [parent.get("sha") for parent in created.get("parents", [])] != [base]):
        raise ValueError("Unexpected proposal commit")
    branch = "podcast-proposal/issue-" + str(number) + "-run-" + run_id + "-attempt-" + attempt
    check_live()
    ref = call("POST", PREFIX + "/git/refs", {"ref": "refs/heads/" + branch, "sha": head})
    if ref.get("ref") != "refs/heads/" + branch or ref.get("object", {}).get("sha") != head:
        raise ValueError("Unexpected proposal ref")
    check_live()
    proposal_ref = call("GET", PREFIX + "/git/ref/heads/" + branch)
    if (not isinstance(proposal_ref, dict)
            or proposal_ref.get("ref") != "refs/heads/" + branch
            or proposal_ref.get("object", {}).get("type") != "commit"
            or proposal_ref["object"].get("sha") != head):
        raise ValueError("Proposal branch changed")
    body = (
        "Owner review required for podcast request #" + str(number) + ".\n\n"
        "Proposes only podcasts.json, site/app.js, and site/index.html.\n"
        "Read-only preflight: " + str(tests["ran"]) + " tests; "
        + str(tests["skipped"]) + " skipped. Skipped tests are not verified.\n"
        "Sampled HEAD observations are not browser-playback proof.\n"
        "No automatic approval, merge, or production activation.\n"
        "Do not assume this bot-created PR triggers CI.\n\n"
        "Base commit: " + base + "\n"
        "Preflight bundle SHA-256: " + expected_digest + "\n"
        "Workflow run: " + run_id + "; attempt: " + attempt + ".\n"
    )
    pr = call("POST", PREFIX + "/pulls", {
        "title": "Review podcast permissions for request #" + str(number),
        "head": branch, "base": "main", "body": body, "draft": True,
        "maintainer_can_modify": False,
    })
    if type(pr.get("number")) is not int or pr["number"] < 1:
        raise ValueError("Unexpected PR response; inspect before retry")
    return pr["number"]


def main():
    try:
        if (os.environ.get("GITHUB_REPOSITORY") != REPO
                or os.environ.get("GITHUB_ACTOR_ID") != str(OWNER_ID)
                or os.environ.get("GITHUB_REF") != "refs/heads/main"
                or os.environ.get("GITHUB_EVENT_NAME") != "issues"):
            raise ValueError("Unexpected writer context")
        path = Path(os.environ["PODCAST_PROPOSAL_BUNDLE"])
        with path.open("rb") as stream:
            raw = stream.read(MAX_BUNDLE + 1)
        number = process(
            json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8")),
            decode(os.environ["PODCAST_RESOLUTION"]), raw,
            os.environ["PODCAST_PREFLIGHT_SHA256"], os.environ["GITHUB_RUN_ID"],
            os.environ["GITHUB_RUN_ATTEMPT"],
        )
        print("Draft owner-review PR created:", number)
        return 0
    except Exception:
        print("Proposal writer stopped. Inspect run/branch/PR state before retrying; no automatic retry. No source contents or credentials logged.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
