import unittest
from scripts.validate_release_request import validate_request


class ReleaseRequestTests(unittest.TestCase):
    def test_ci_never_requires_publishing_setup(self):
        for event in ["push", "pull_request"]:
            validate_request(event, "refs/pull/1/merge", "", "", "")

    def test_manual_package_needs_version_but_no_credentials(self):
        validate_request("workflow_dispatch", "refs/heads/feature", "package", "1.0.6", "")
        with self.assertRaisesRegex(ValueError, "version"):
            validate_request("workflow_dispatch", "refs/heads/main", "package", "", "")

    def test_store_actions_require_main_and_setup_flag(self):
        for action in ["upload", "submit-review", "release-staged"]:
            validate_request("workflow_dispatch", "refs/heads/main", action, "1.0.6", "true")
            for ref, enabled in [("refs/heads/feature", "true"), ("refs/tags/v1.0.6", "true"),
                                 ("refs/heads/main", ""), ("refs/heads/main", "false")]:
                with self.subTest(action=action, ref=ref, enabled=enabled), self.assertRaises(ValueError):
                    validate_request("workflow_dispatch", ref, action, "1.0.6", enabled)

    def test_invalid_action_and_version_are_rejected(self):
        for action, version in [("publish", "1.0.6"), ("upload", "1.0.6; echo unsafe")]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                validate_request("workflow_dispatch", "refs/heads/main", action, version, "true")
