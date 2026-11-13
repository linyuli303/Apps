"""Read-only owner handle resolution. Never writes repository configuration."""
import argparse
import json
import os
from pathlib import Path

from channel_resolution import (
    authorize_resolution_event,
    build_resolution_review,
    read_resolution_issue,
    request_channel_identity,
    resolve_owner_request,
    validate_resolution_runner,
)


def prepare_review(environment, event, get_issue, request):
    """Validate runner/event before invoking injected network clients."""
    provenance = validate_resolution_runner(environment)
    authorize_resolution_event(event)
    resolution = resolve_owner_request(event, get_issue, request)
    review = build_resolution_review(resolution)

    text = review["report"] + "\n\n"
    text += "Workflow run: " + provenance["run_id"] + "\n"
    text += "Run attempt: " + provenance["run_attempt"] + "\n"
    text += "Source SHA: " + provenance["source_sha"] + "\n"
    text += "Workflow SHA: " + provenance["workflow_sha"] + "\n\n"
    text += "Open the separate owner-confirmed bulk-add form:\n"
    text += review["addition_url"] + "\n\n"
    text += "UC IDs to review/copy:\n" + review["channel_text"] + "\n"
    if len(text.encode("utf-8")) > 100000:
        raise ValueError("Resolution report too large")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    try:
        # Check context before reading credentials or making requests.
        validate_resolution_runner(os.environ)

        root = Path(__file__).resolve().parents[1]
        output = args.output.resolve()
        if (
            output == root
            or root in output.parents
            or output.suffix.lower() != ".txt"
            or not output.parent.is_dir()
            or output.exists()
        ):
            raise ValueError("Use a new TXT output outside the repository")

        event_path = Path(os.environ["GITHUB_EVENT_PATH"])
        with event_path.open("rb") as stream:
            raw = stream.read(262145)
        if len(raw) > 262144:
            raise ValueError("Event too large")
        event = json.loads(raw.decode("utf-8"))
        authorize_resolution_event(event)

        # Credentials remain confined to this step and are never report data.
        token = os.environ["GH_TOKEN"]
        key = os.environ["YOUTUBE_API_KEY"]

        report = prepare_review(
            os.environ,
            event,
            lambda number: read_resolution_issue(number, token),
            lambda params: request_channel_identity(params, key),
        )

        # Do not overwrite existing results or publish partial resolutions.
        with output.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(report)

        print("Identity review prepared. No channels were added.")
        return 0
    except Exception:
        print(
            "Resolution stopped. No approval or whitelist write occurred. "
            "Check owner authorization, unchanged Issue, key permissions, "
            "quota and network availability. Raw errors were not logged."
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())