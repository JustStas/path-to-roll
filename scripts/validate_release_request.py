"""Validate release tags and manual previews before store credentials are used."""

import json
import os
from pathlib import Path
import re
import subprocess

try:
    from scripts.package_extension import chrome_version
except ModuleNotFoundError:
    from package_extension import chrome_version


def validate_request(event, ref, action, expected_version, publishing_enabled, manifest_version):
    chrome_version(manifest_version)
    if event == "push" and ref.startswith("refs/tags/"):
        if not ref.startswith("refs/tags/v"):
            raise ValueError("Release tag must be v followed by the exact manifest version")
        expected_version = ref.removeprefix("refs/tags/v")
        chrome_version(expected_version)
        action = "submit-release"
    elif event != "workflow_dispatch":
        return "package", manifest_version
    elif action == "check-auth":
        if ref != "refs/heads/main":
            raise ValueError("Authentication checks must be dispatched from main")
        return "check-auth", manifest_version  # Read-only: no publishing opt-in or release version needed.
    elif action not in {"package", "upload"}:
        raise ValueError("Unknown release action")
    chrome_version(expected_version)
    if expected_version != manifest_version:
        raise ValueError("Release tag or expected version must exactly match manifest.json version")
    if action != "package":
        if event == "workflow_dispatch" and ref != "refs/heads/main":
            raise ValueError("Manual draft uploads must be dispatched from main")
        if publishing_enabled != "true":
            raise ValueError("Configure the chrome-web-store environment and set repository variable CWS_PUBLISHING_ENABLED=true first; see docs/deployment.md")
    return action, expected_version


def validate_tag_source(root, ref, event_sha):
    if not ref.startswith("refs/tags/v"):
        raise ValueError("Expected a release tag")
    chrome_version(ref.removeprefix("refs/tags/v"))
    if not isinstance(event_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", event_sha):
        raise ValueError("Invalid event commit SHA")

    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], text=True,
                                       stderr=subprocess.DEVNULL).strip()

    try:
        tag_commit = git("rev-parse", "--verify", f"{ref}^{{commit}}")
        event_commit = git("rev-parse", "--verify", f"{event_sha}^{{commit}}")
        if tag_commit != event_commit or git("rev-parse", "HEAD") != tag_commit:
            raise ValueError("Release tag, event and checkout must identify the same commit; tag may have moved")
        git("merge-base", "--is-ancestor", tag_commit, "refs/remotes/origin/main")
    except (subprocess.CalledProcessError, OSError):
        raise ValueError("Release commit must exist on fetched origin/main; fetch full history and reject unmerged tags") from None


if __name__ == "__main__":
    try:
        root = Path(__file__).resolve().parents[1]
        action, version = validate_request(
            os.environ.get("GITHUB_EVENT_NAME"), os.environ.get("GITHUB_REF", ""),
            os.environ.get("RELEASE_ACTION"), os.environ.get("EXPECTED_VERSION"),
            os.environ.get("CWS_PUBLISHING_ENABLED"), json.loads((root / "manifest.json").read_text())["version"])
        if action == "submit-release":
            validate_tag_source(root, os.environ["GITHUB_REF"], os.environ.get("GITHUB_SHA"))
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write(f"action={action}\nversion={version}\n")
    except (ValueError, KeyError, OSError) as error:
        raise SystemExit(str(error)) from None
