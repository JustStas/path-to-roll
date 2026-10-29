"""Explicit Chrome Web Store v2 operations. Never retry a store mutation."""

import argparse
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

try:
    from scripts.package_extension import chrome_version
except ModuleNotFoundError:  # Also support python3 scripts/chrome_web_store.py.
    from package_extension import chrome_version


API = "https://chromewebstore.googleapis.com"
ACTIONS = ("upload", "submit-review", "release-staged")


class StoreError(Exception):
    pass


def request_json(url, *, method="GET", data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # Do not expose response bodies, request headers or credential-bearing errors.
        raise StoreError(f"Google API returned HTTP {error.code}; inspect the Developer Dashboard before retrying.") from None
    except (OSError, ValueError):
        detail = "mutation outcome is uncertain" if method != "GET" else "status could not be read"
        raise StoreError(f"Google API request failed; {detail}. Inspect the Developer Dashboard before retrying.") from None
    if not isinstance(result, dict):
        raise StoreError("Google API returned an unexpected response; inspect the Developer Dashboard before retrying.")
    return result


def configuration(env):
    names = ("CWS_PUBLISHER_ID", "CWS_EXTENSION_ID", "CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN")
    missing = [name for name in names if not env.get(name)]
    if missing:
        raise StoreError("Missing configuration: " + ", ".join(missing))
    if not re.fullmatch(r"[A-Za-z0-9_-]+", env["CWS_PUBLISHER_ID"]):
        raise StoreError("Invalid CWS_PUBLISHER_ID")
    if not re.fullmatch(r"[a-p]{32}", env["CWS_EXTENSION_ID"]):
        raise StoreError("Invalid CWS_EXTENSION_ID: expected the 32-letter store item ID")
    return f"publishers/{env['CWS_PUBLISHER_ID']}/items/{env['CWS_EXTENSION_ID']}"


def revision_versions(revision):
    return [channel["crxVersion"] for channel in revision.get("distributionChannels", [])]


def validate_status(status):
    if status.get("lastAsyncUploadState") not in (None, "SUCCEEDED", "FAILED", "NOT_FOUND"):
        raise StoreError("A previous upload is still processing or has an unknown state; inspect the dashboard")
    allowed_states = {
        "publishedItemRevisionStatus": {"PUBLISHED", "PUBLISHED_TO_TESTERS"},
        "submittedItemRevisionStatus": {
            "PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS", "REJECTED", "CANCELLED"},
    }
    for field, states in allowed_states.items():
        if field not in status:
            continue  # Unpublished items / items with no active submission omit these fields.
        revision = status[field]
        if not isinstance(revision, dict) or revision.get("state") not in states:
            raise StoreError("Unknown store revision state; inspect the dashboard before any store mutation")
        channels = revision.get("distributionChannels")
        if not isinstance(channels, list) or not channels:
            raise StoreError("Store revision is missing version channels; refusing store mutation")
        for channel in channels:
            try:
                if not isinstance(channel, dict):
                    raise ValueError()
                chrome_version(channel.get("crxVersion"))
            except ValueError:
                raise StoreError("Store revision contains an invalid version; refusing store mutation") from None


def deploy(action, package, expected_version, env, *, transport=None, sleep=time.sleep, poll_attempts=24):
    if action not in ACTIONS:
        raise StoreError("Invalid action; use upload, submit-review or release-staged")
    name = configuration(env)
    try:
        expected = chrome_version(expected_version)
        with zipfile.ZipFile(package) as archive:
            version = json.loads(archive.read("manifest.json"))["version"]
        if version != expected_version:
            raise ValueError("Package does not match expected version")
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        raise StoreError(f"Invalid release package or version: {error}") from None

    transport = transport or request_json
    token_result = transport("https://oauth2.googleapis.com/token", method="POST", data=urllib.parse.urlencode({
        "client_id": env["CWS_CLIENT_ID"], "client_secret": env["CWS_CLIENT_SECRET"],
        "refresh_token": env["CWS_REFRESH_TOKEN"], "grant_type": "refresh_token",
    }).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"})
    token = token_result.get("access_token")
    if not isinstance(token, str) or not token:
        raise StoreError("OAuth did not return an access token; check the configured credentials")
    headers = {"Authorization": f"Bearer {token}"}
    status_url = f"{API}/v2/{name}:fetchStatus"
    status = transport(status_url, headers=headers)
    validate_status(status)
    submitted = status.get("submittedItemRevisionStatus", {})

    if action == "release-staged":
        if submitted.get("state") != "STAGED" or revision_versions(submitted) != [expected_version]:
            raise StoreError("The staged revision must be STAGED and match the exact expected version")
        publish_type = "DEFAULT_PUBLISH"
    else:
        if submitted.get("state") in {"PENDING_REVIEW", "STAGED"}:
            raise StoreError("An active submission exists; inspect it before uploading another version")
        versions = revision_versions(status.get("publishedItemRevisionStatus", {})) + revision_versions(submitted)
        if any(expected <= chrome_version(version) for version in versions):
            raise StoreError("The new manifest version must be higher than the store's existing revisions")
        upload = transport(f"{API}/upload/v2/{name}:upload", method="POST",
                           data=Path(package).read_bytes(), headers={**headers, "Content-Type": "application/zip"})
        state = upload.get("uploadState")
        # Enum values come from Google's v2 discovery schema (not the old v1 API).
        asynchronous = state == "IN_PROGRESS"
        if asynchronous:
            for _ in range(poll_attempts):
                sleep(5)
                state = transport(status_url, headers=headers).get("lastAsyncUploadState")
                if state != "IN_PROGRESS":
                    break
        if state != "SUCCEEDED":
            raise StoreError("Store upload did not succeed or is still processing; inspect its status before retrying")
        if (not asynchronous and upload.get("crxVersion") != expected_version) or (
                asynchronous and upload.get("crxVersion") not in (None, expected_version)):
            raise StoreError("Store upload returned an unexpected version; no review was submitted")
        if action == "upload":
            return f"Uploaded {expected_version} as a draft. No review or publication requested."
        publish_type = "STAGED_PUBLISH"

    result = transport(f"{API}/v2/{name}:publish", method="POST", data=json.dumps({
        "publishType": publish_type, "skipReview": False, "blockOnWarnings": True,
    }).encode(), headers={**headers, "Content-Type": "application/json"})
    allowed = {"PUBLISHED"} if action == "release-staged" else {"PENDING_REVIEW", "STAGED"}
    if result.get("state") not in allowed:
        raise StoreError("Publish returned an unexpected state; inspect the Developer Dashboard before retrying")
    if action == "release-staged":
        return f"Published staged version {expected_version}."
    return f"Submitted {expected_version} for staged review ({result['state']}). Release remains a separate action."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--expected-version", required=True)
    args = parser.parse_args()
    try:
        print(deploy(args.action, args.package, args.expected_version, os.environ))
    except (StoreError, ValueError, KeyError, TypeError) as error:
        # Detailed StoreErrors are safe; unexpected malformed response errors aren't.
        message = str(error) if isinstance(error, StoreError) else "Malformed API response; inspect the Developer Dashboard before retrying"
        parser.exit(1, f"Store operation failed: {message}\n")


if __name__ == "__main__":
    main()
