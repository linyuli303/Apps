"""Optional: convert Takeout subscriptions to a standalone channels.json."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("feed", Path(__file__).with_name("build_feed.py"))
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--output", type=Path, default=Path("channels.json"))
    parser.add_argument("--force", action="store_true", help="Replace an existing output file")
    args = parser.parse_args()
    try:
        if args.output.exists() and not args.force:
            raise ValueError("Output already exists. Review/backup it and pass --force to replace")
        if args.output.resolve() == args.csv.resolve():
            raise ValueError("Input and output must be different files")
        channels = feed.read_subscriptions(args.csv)
        if len(channels) > 1000:
            raise ValueError("This starter supports at most 1000 channels")
        config = {"title":"My Subscriptions", "max_videos_per_channel":15, "channels":channels}
        args.output.write_text(json.dumps(config, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        print(f"Wrote {len(channels)} unique approved channel IDs. Review before publishing.")
    except (ValueError, OSError) as error:
        parser.exit(1, str(error)+"\n")

if __name__ == "__main__":
    main()
