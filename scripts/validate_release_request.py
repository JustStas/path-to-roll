"""Reject incomplete or unsafe manual release requests before environment access."""

import os

try:
    from scripts.package_extension import chrome_version
except ModuleNotFoundError:
    from package_extension import chrome_version


def validate_request(event, ref, action, expected_version, publishing_enabled):
    if event != "workflow_dispatch":
        return
    if action not in {"package", "upload", "submit-review", "release-staged"}:
        raise ValueError("Unknown release action")
    chrome_version(expected_version)
    if action != "package":
        if ref != "refs/heads/main":
            raise ValueError("Store operations must be dispatched from main")
        if publishing_enabled != "true":
            raise ValueError("Configure the chrome-web-store environment and set repository variable CWS_PUBLISHING_ENABLED=true first; see docs/deployment.md")


if __name__ == "__main__":
    try:
        validate_request(os.environ.get("GITHUB_EVENT_NAME"), os.environ.get("GITHUB_REF"),
                         os.environ.get("RELEASE_ACTION"), os.environ.get("EXPECTED_VERSION"),
                         os.environ.get("CWS_PUBLISHING_ENABLED"))
    except ValueError as error:
        raise SystemExit(str(error)) from None
