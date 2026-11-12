"""Pure proposal snapshot bindings; no network, writes, or test attestation."""
import hashlib
import json
import re

from podcast_proposal import build_proposal
from podcast_request import REPO, authorize_event
from podcast_resolution import digest

PATHS = frozenset({"podcasts.json", "site/app.js", "site/index.html"})


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare_bound_proposal(event, envelope, base_sha, base_files):
    """Generate from trusted base bytes and bind all inputs and outputs.

    The caller must establish that base_sha is the exact trusted main commit
    and that base_files came from that commit. Hashes are not signatures or
    proof that preflight tests ran. No supplied proposal code is executed here.
    """
    number, _ = authorize_event(event)
    if not isinstance(base_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", base_sha):
        raise ValueError("Invalid base commit")
    if not isinstance(base_files, dict) or set(base_files) != PATHS:
        raise ValueError("Unexpected base paths")
    for data in base_files.values():
        if not isinstance(data, bytes) or len(data) > 2_000_000:
            raise ValueError("Invalid base bytes")
    if sum(map(len, base_files.values())) > 5_000_000:
        raise ValueError("Oversized base")
    text = {path: data.decode("utf-8") for path, data in base_files.items()}
    config = json.loads(text["podcasts.json"])
    proposed = build_proposal(
        event, config, envelope, text["site/app.js"], text["site/index.html"]
    )
    if set(proposed) != PATHS or any(
        not isinstance(value, str) for value in proposed.values()
    ):
        raise ValueError("Unexpected proposal output")
    encoded = {path: value.encode("utf-8") for path, value in proposed.items()}
    if any(len(value) > 2_000_000 for value in encoded.values()):
        raise ValueError("Oversized proposal")
    manifest = {
        "version": 1,
        "repository": REPO,
        "issue": number,
        "baseSha": base_sha,
        "requestDigest": digest(event["issue"]),
        "configDigest": digest(config),
        "resolutionDigest": digest(envelope),
        "baseFiles": {path: _sha(base_files[path]) for path in sorted(PATHS)},
        "proposedFiles": {path: _sha(encoded[path]) for path in sorted(PATHS)},
    }
    return manifest, proposed


def verify_bound_proposal(manifest, event, envelope, base_sha, base_files):
    """Recompute using independently obtained trusted inputs, not artifact code.

    Live Issue/main checks and verified same-run preflight provenance remain
    the responsibility of the future privileged writer. This function neither
    authorizes GitHub writes nor certifies test success.
    """
    expected, proposed = prepare_bound_proposal(event, envelope, base_sha, base_files)
    if (not isinstance(manifest, dict) or set(manifest) != set(expected)
            or digest(manifest) != digest(expected)):
        raise ValueError("Proposal bindings mismatched")
    return proposed
