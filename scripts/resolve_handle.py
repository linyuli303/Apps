"""Resolve a handle locally for human review. Does not edit or approve the whitelist."""
import argparse
import json
import os
from build_feed import api, CHANNEL_ID

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("handle")
    args=parser.parse_args()
    if not args.handle.startswith("@") or len(args.handle)>101 or any(c.isspace() or c in "/?#&" for c in args.handle):
        parser.exit(1,"Enter an @handle only.\n")
    try:
        result=api("channels",{"part":"snippet","forHandle":args.handle},os.environ.get("YOUTUBE_API_KEY",""))
        items=result.get("items",[])
        if len(items)!=1 or not CHANNEL_ID.fullmatch(items[0]["id"]):raise ValueError()
        item=items[0]
        print(json.dumps({"id":item["id"],"publicTitle":item["snippet"]["title"],"reviewURL":"https://www.youtube.com/channel/"+item["id"]},ensure_ascii=False,indent=2))
        print("Open reviewURL and verify channel identity before approving this ID. No configuration was modified.")
    except Exception:parser.exit(1,"Resolution failed. Check handle, local API-key environment, API restrictions and quota.\n")
if __name__=="__main__":main()
