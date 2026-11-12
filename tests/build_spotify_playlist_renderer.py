"""Generate browser-only playlist renderer checks from current application source.

Usage:
    python tests/build_spotify_playlist_renderer.py --output <TEMP HTML file>

This generator does not run DOM tests. Open the generated HTML in a browser
and inspect its results. It uses fake data, no dependencies, and no account
access. Generated output must remain outside the repository.
"""

import argparse
from pathlib import Path
import re


PLACEHOLDER = "// MYAPPS_SPOTIFY_PLAYLIST_RENDERER_SOURCE"
RENDERER_PATTERN = re.compile(
    r"^function createSpotifyPlaylistView\(controller, onReauthorize\) \{.*?^\}",
    re.MULTILINE | re.DOTALL,
)


def build(output):
    repository = Path(__file__).resolve().parents[1]
    output = output.resolve()

    if output == repository or repository in output.parents:
        raise ValueError("Generated browser harness must be outside the repository.")
    if output.suffix.lower() != ".html":
        raise ValueError("Output must be an HTML file.")
    if not output.parent.is_dir():
        raise ValueError("Output parent directory must already exist.")
    if output.exists():
        raise ValueError("Refusing to overwrite existing output.")

    source = (repository / "site" / "app.js").read_text(encoding="utf-8")
    template = (
        repository / "tests" / "spotify_playlist_renderer.html"
    ).read_text(encoding="utf-8")

    matches = list(RENDERER_PATTERN.finditer(source))
    if len(matches) != 1:
        raise ValueError("Expected exactly one playlist renderer.")
    renderer = matches[0].group()
    if not renderer.endswith("  return Object.freeze({load, clear});\n}"):
        raise ValueError("Unexpected playlist renderer boundary.")
    if re.search(r"</script", renderer, re.IGNORECASE):
        raise ValueError("Renderer cannot be embedded safely in the HTML harness.")
    if template.count(PLACEHOLDER) != 1:
        raise ValueError("Expected exactly one renderer placeholder.")

    rendered = template.replace(PLACEHOLDER, renderer, 1)
    if PLACEHOLDER in rendered:
        raise ValueError("Unresolved renderer placeholder.")

    with output.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(rendered)

    print("Browser harness generated from current site/app.js.")
    print("DOM execution has NOT been performed by this generator.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build(args.output)


if __name__ == "__main__":
    main()
