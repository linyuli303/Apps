"""Fail if tracked files include raw exports or common credential material.
This is a narrow guardrail, not a complete secret-scanning product.
"""
import re
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
API_KEY = re.compile(rb"AIza[0-9A-Za-z_-]{35}")
PRIVATE_KEY = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
TOKEN = re.compile(rb"(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})")

def prohibited(path):
    p=Path(path)
    name=p.name.lower()
    parts={part.lower() for part in p.parts}
    return (bool(parts & {"takeout", "private", "_site"}) or
            p.as_posix().startswith("site/data/") or
            name == ".env" or name.startswith(".env.") or
            name.endswith((".csv", ".zip", ".tar", ".tar.gz", ".tgz", ".7z", ".pem", ".key", ".p12", ".pfx")) or
            (name.endswith(".json") and name.startswith(("credentials", "client_secret", "service-account"))))

def sensitive(data):
    return bool(API_KEY.search(data) or PRIVATE_KEY.search(data) or TOKEN.search(data))

def check(paths):
    issues=[]
    for relative in paths:
        path=ROOT/relative
        if prohibited(relative) or path.is_symlink():
            issues.append("Blocked tracked file (export, generated output, credential file, or symlink)")
            continue
        if path.is_file():
            if path.stat().st_size > 5_000_000:
                issues.append("Tracked file exceeds 5 MB review limit")
            elif sensitive(path.read_bytes()):
                issues.append("Possible credential detected in tracked content")
    return issues

def main():
    try:
        tracked=subprocess.check_output(["git","ls-files","-z"],cwd=ROOT).decode("utf-8").split("\0")
        issues=check([p for p in tracked if p])
        if issues:
            print("Security check failed:")
            for message in sorted(set(issues)): print("-",message)
            print("Remove sensitive files from the Git index/history as appropriate; rotate any exposed credentials. No file contents were logged.")
            return 1
        print("Tracked-file privacy and credential-pattern checks passed.")
        return 0
    except Exception:
        print("Security check could not complete. Refusing publication.")
        return 1

if __name__=="__main__":sys.exit(main())
