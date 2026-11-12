"""Isolated proposal preflight. No GitHub API calls or permission approval.

Production callers must run this in a read-only job. The output is data, not a
signature or sufficient authorization for a writer. No preview is published.
"""
import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

from podcast_proposal_binding import PATHS, prepare_bound_proposal
from podcast_resolution import decode

MAX_BUNDLE = 8_000_000
MAX_ARCHIVE = 60_000_000


def isolated_environment(home):
    """Use an allowlist, not a blacklist of known credential variable names."""
    home = Path(home)
    home.mkdir(parents=True, exist_ok=True)
    env = {key: os.environ[key] for key in (
        "PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
    ) if key in os.environ}
    env.update({
        "HOME": str(home), "USERPROFILE": str(home),
        "TMP": str(home), "TEMP": str(home), "TMPDIR": str(home),
        "XDG_CONFIG_HOME": str(home),
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0", "GIT_ALLOW_PROTOCOL": "file",
        "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "CI": "true",
    })
    return env


def command(args, cwd, env, timeout=180, stage="subprocess"):
    result = subprocess.run(
        args, cwd=cwd, env=env, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=timeout, check=False,
    )
    # Never relay arbitrary test/process output to Actions or Issue comments.
    if result.returncode:
        raise ValueError("Preflight " + stage + " command failed")
    if len(result.stdout) > 2_000_000:
        raise ValueError("Oversized command output")
    return result.stdout


def extract_snapshot(archive, destination):
    """Extract only bounded regular files/directories; never links or metadata."""
    if len(archive) > MAX_ARCHIVE:
        raise ValueError("Oversized archive")
    entries = []
    names = set()
    total = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as stream:
        for member in stream:
            path = PurePosixPath(member.name)
            parts = member.name.rstrip("/").split("/")
            if (not parts or path.is_absolute() or "\\" in member.name
                    or any(part in ("", ".", "..") or ":" in part for part in parts)
                    or any(part.lower() == ".git" for part in parts)
                    or not (member.isdir() or member.isfile())
                    or member.name.casefold().rstrip("/") in names):
                raise ValueError("Unsafe archive entry")
            names.add(member.name.casefold().rstrip("/"))
            total += member.size
            if member.size > 5_000_000 or total > MAX_ARCHIVE or len(names) > 10000:
                raise ValueError("Oversized snapshot")
            entries.append((member, parts))
        # Validate the entire member list before writing any files.
        for member, parts in entries:
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with stream.extractfile(member) as source:
                    target.write_bytes(source.read())


def unittest_summary(raw):
    text = raw.decode("utf-8", errors="strict").replace("\r\n", "\n")
    ran = re.findall(r"^Ran ([0-9]+) tests? in [0-9.]+s$", text, re.MULTILINE)
    ok = re.findall(r"^OK(?: \(skipped=([0-9]+)\))?$", text, re.MULTILINE)
    if len(ran) != 1 or len(ok) != 1 or int(ran[0]) < 1:
        raise ValueError("Missing successful test summary")
    return {"ran": int(ran[0]), "skipped": int(ok[0] or 0)}


def preflight(root, event, envelope, base_sha, output):
    """Test an exact-commit proposal in TEMP; publish a new data file on success.

    Pending local implementation files are deliberately NOT copied into this
    snapshot. Until committed, this driver can be tested via disposable fixtures
    but cannot attest to production's pending working-tree code.
    """
    root = Path(root).resolve()
    output = Path(output).absolute()
    if (not isinstance(base_sha, str)
            or not re.fullmatch(r"[0-9a-f]{40}", base_sha)):
        raise ValueError("Invalid base commit")
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("Output must be a new file")
    if output == root or root in output.parents:
        raise ValueError("Output must be outside repository")
    git = shutil.which("git")
    if not git:
        raise ValueError("Git unavailable")
    with tempfile.TemporaryDirectory(prefix="MyApps-preflight-") as temp:
        temp = Path(temp)
        env = isolated_environment(temp / "home")
        def source_git(*args):
            return command([git, *args], root, env)
        if Path(source_git("rev-parse", "--show-toplevel").decode().strip()).resolve() != root:
            raise ValueError("Unexpected repository root")
        if source_git("rev-parse", "HEAD").decode().strip() != base_sha:
            raise ValueError("Checkout commit mismatch")
        if source_git("status", "--porcelain=v1", "--untracked-files=all"):
            raise ValueError("Preflight requires a clean checkout")
        base_files = {}
        for path in sorted(PATHS):
            entry = source_git("ls-tree", base_sha, "--", path).decode().strip()
            if not entry.startswith("100644 blob ") or entry.split("\t")[-1] != path:
                raise ValueError("Unexpected base file type")
            # Read raw Git bytes, independent of Windows checkout line endings.
            base_files[path] = source_git("show", base_sha + ":" + path)
        manifest, proposed = prepare_bound_proposal(event, envelope, base_sha, base_files)
        # Archive contains only the trusted commit, never pending local files.
        archive_file = temp / "snapshot.tar"
        with archive_file.open("wb") as stream:
            result = subprocess.run(
                [git, "archive", "--format=tar", base_sha], cwd=root, env=env,
                stdout=stream, stderr=subprocess.PIPE, timeout=60, check=False,
            )
        if result.returncode or archive_file.stat().st_size > MAX_ARCHIVE:
            raise ValueError("Snapshot export failed")
        sandbox = temp / "repository"
        sandbox.mkdir()
        extract_snapshot(archive_file.read_bytes(), sandbox)
        for path in PATHS:
            if (sandbox / path).read_bytes() != base_files[path]:
                raise ValueError("Archive differs from base bytes")
        def local_git(*args):
            return command([git, *args], sandbox, env)
        local_git("init", "--quiet", "--template=", "--initial-branch=main")
        local_git("config", "core.autocrlf", "false")
        local_git("config", "core.hooksPath", str(temp / "no-hooks"))
        local_git("config", "user.name", "MyApps isolated preflight")
        local_git("config", "user.email", "preflight@invalid.example")
        local_git("config", "commit.gpgsign", "false")
        local_git("add", "--all")
        local_git("commit", "--quiet", "-m", "Disposable exact snapshot baseline")
        if local_git("remote"):
            raise ValueError("Sandbox must not have remotes")
        for path, text in proposed.items():
            (sandbox / path).write_bytes(text.encode("utf-8"))
        local_git("add", "--", *sorted(PATHS))
        expected_changed = {
            path for path in PATHS if proposed[path].encode("utf-8") != base_files[path]
        }
        if "podcasts.json" not in expected_changed:
            raise ValueError("Proposal did not add configuration")
        def check_scope():
            changed = set(local_git("diff", "--cached", "--name-only", "-z").decode().strip("\0").split("\0"))
            if changed != expected_changed or local_git("diff", "--name-only"):
                raise ValueError("Unexpected sandbox changes")
            if local_git("ls-files", "--others", "--exclude-standard"):
                raise ValueError("Unexpected sandbox files")
            for path, text in proposed.items():
                expected = text.encode("utf-8")
                if ((sandbox / path).read_bytes() != expected
                        or local_git("show", ":" + path) != expected):
                    raise ValueError("Proposal changed during checks")
        check_scope()
        test_output = command(
            [sys.executable, "-X", "utf8", "-m", "unittest", "discover", "-s", "tests", "-q"],
            sandbox, env, stage="tests",
        )
        tests = unittest_summary(test_output)
        command([sys.executable, "-X", "utf8", "scripts/security_check.py"],
                sandbox, env, stage="security")
        local_git("diff", "--cached", "--check")
        check_scope()
        # Catch source checkout changes during the disposable run too.
        if (source_git("rev-parse", "HEAD").decode().strip() != base_sha
                or source_git("status", "--porcelain=v1", "--untracked-files=all")):
            raise ValueError("Source changed during preflight")
        bundle = {
            "version": 1, "manifest": manifest,
            "proposed": proposed,
            "checks": {"tests": tests, "security": "passed", "whitespace": "passed"},
        }
        encoded = (json.dumps(bundle, ensure_ascii=True, sort_keys=True) + "\n").encode("utf-8")
        if len(encoded) > MAX_BUNDLE:
            raise ValueError("Oversized result bundle")
        # Exclusive creation; existing bundles are never overwritten.
        with output.open("xb") as stream:
            stream.write(encoded)
        return bundle["checks"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve().parents[1]
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        envelope = decode(os.environ["PODCAST_RESOLUTION"])
        checks = preflight(root, event, envelope, args.base_sha, args.output)
        print("Isolated preflight passed. Tests:", checks["tests"]["ran"],
              "Skipped:", checks["tests"]["skipped"])
        print("No approval, GitHub writes, or publication performed.")
        return 0
    except Exception:
        print("Proposal preflight stopped. No source contents or credentials logged.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
