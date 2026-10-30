from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from scripts.validate_release_request import validate_request, validate_tag_source


class ReleaseRequestTests(unittest.TestCase):
    def test_ci_never_requires_publishing_setup(self):
        for event, ref in [("push", "refs/heads/main"), ("pull_request", "refs/pull/1/merge")]:
            self.assertEqual(validate_request(event, ref, "", "", "", "1.0.6"), ("package", "1.0.6"))

    def test_manual_package_needs_version_but_no_credentials(self):
        validate_request("workflow_dispatch", "refs/heads/feature", "package", "1.0.6", "", "1.0.6")
        with self.assertRaisesRegex(ValueError, "version"):
            validate_request("workflow_dispatch", "refs/heads/main", "package", "", "", "1.0.6")

    def test_store_actions_require_main_and_setup_flag(self):
        for action in ["upload"]:
            validate_request("workflow_dispatch", "refs/heads/main", action, "1.0.6", "true", "1.0.6")
            for ref, enabled in [("refs/heads/feature", "true"), ("refs/tags/v1.0.6", "true"),
                                 ("refs/heads/main", ""), ("refs/heads/main", "false")]:
                with self.subTest(action=action, ref=ref, enabled=enabled), self.assertRaises(ValueError):
                    validate_request("workflow_dispatch", ref, action, "1.0.6", enabled, "1.0.6")

    def test_invalid_action_and_version_are_rejected(self):
        for action, version in [("submit-release", "1.0.6"), ("upload", "1.0.6; echo unsafe"), ("package", "1.0.7")]:
            with self.subTest(action=action), self.assertRaises(ValueError):
                validate_request("workflow_dispatch", "refs/heads/main", action, version, "true", "1.0.6")

    def test_matching_tag_selects_automatic_publication(self):
        self.assertEqual(validate_request("push", "refs/tags/v1.0.6", "", "", "true", "1.0.6"),
                         ("submit-release", "1.0.6"))

    def test_check_auth_runs_from_main_without_enable_flag_or_expected_version(self):
        for enabled in ["", None, "false", "true"]:
            with self.subTest(enabled=enabled):
                self.assertEqual(validate_request("workflow_dispatch", "refs/heads/main", "check-auth", "",
                                                  enabled, "1.0.6"), ("check-auth", "1.0.6"))

    def test_check_auth_is_rejected_on_feature_branches_and_tags(self):
        for ref in ["refs/heads/feature", "refs/tags/v1.0.6"]:
            with self.subTest(ref=ref), self.assertRaisesRegex(ValueError, "main"):
                validate_request("workflow_dispatch", ref, "check-auth", "", "", "1.0.6")

    def test_tag_must_be_exact_valid_manifest_version_and_enabled(self):
        for ref, enabled in [("refs/tags/v1.0.7", "true"), ("refs/tags/v01.0.6", "true"),
                             ("refs/tags/v1.0.6-beta", "true"), ("refs/tags/v1.0.6/extra", "true"),
                             ("refs/tags/v1.0.6", ""), ("refs/tags/1.0.6", "true")]:
            with self.subTest(ref=ref, enabled=enabled), self.assertRaises(ValueError):
                validate_request("push", ref, "", "", enabled, "1.0.6")


class TagSourceTests(unittest.TestCase):
    """Real git fixtures: no tags are created in the project's repository."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-b", "main")
        self.commit("main")
        self.main_commit = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/main", self.main_commit)

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                                        *args], cwd=self.root, text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, content):
        (self.root / "fixture.txt").write_text(content)
        self.git("add", "fixture.txt")
        self.git("commit", "-m", "fixture commit")

    def test_lightweight_tag_on_main_is_accepted(self):
        self.git("tag", "v1.0.6")
        validate_tag_source(self.root, "refs/tags/v1.0.6", self.main_commit)

    def test_annotated_tag_accepts_peeled_event_sha(self):
        self.git("tag", "-a", "v1.0.6", "-m", "fixture tag")
        tag_object = self.git("rev-parse", "refs/tags/v1.0.6")
        validate_tag_source(self.root, "refs/tags/v1.0.6", tag_object)

    def test_unmerged_feature_tag_is_rejected(self):
        self.git("switch", "-c", "feature")
        self.commit("feature")
        self.git("tag", "v1.0.6")
        with self.assertRaisesRegex(ValueError, "main"):
            validate_tag_source(self.root, "refs/tags/v1.0.6", self.git("rev-parse", "HEAD"))

    def test_moved_tag_or_different_checkout_is_rejected(self):
        self.git("tag", "v1.0.6")
        self.commit("later main")
        with self.assertRaisesRegex(ValueError, "commit"):
            validate_tag_source(self.root, "refs/tags/v1.0.6", self.main_commit)
        self.git("tag", "-f", "v1.0.6")
        with self.assertRaisesRegex(ValueError, "commit"):
            validate_tag_source(self.root, "refs/tags/v1.0.6", self.main_commit)

    def test_missing_main_ref_is_rejected(self):
        self.git("tag", "v1.0.6")
        self.git("update-ref", "-d", "refs/remotes/origin/main")
        with self.assertRaises(ValueError):
            validate_tag_source(self.root, "refs/tags/v1.0.6", self.main_commit)

    def test_tag_on_earlier_merged_commit_is_accepted(self):
        self.git("tag", "v1.0.6")
        self.commit("later main")
        self.git("update-ref", "refs/remotes/origin/main", self.git("rev-parse", "HEAD"))
        self.git("switch", "--detach", "v1.0.6")
        validate_tag_source(self.root, "refs/tags/v1.0.6", self.main_commit)

    def test_cli_exports_validated_automatic_release_action_and_version(self):
        source = Path(__file__).resolve().parents[1]
        (self.root / "scripts").mkdir()
        for name in ["validate_release_request.py", "package_extension.py"]:
            shutil.copyfile(source / "scripts" / name, self.root / "scripts" / name)
        (self.root / "manifest.json").write_text('{"version": "1.0.6"}')
        self.git("tag", "v1.0.6")
        output = self.root / "outputs.txt"
        subprocess.run([sys.executable, str(self.root / "scripts" / "validate_release_request.py")],
                       cwd=self.root, check=True, env={**os.environ,
                           "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/tags/v1.0.6",
                           "GITHUB_SHA": self.main_commit, "CWS_PUBLISHING_ENABLED": "true",
                           "GITHUB_OUTPUT": str(output)})
        self.assertEqual(output.read_text(), "action=submit-release\nversion=1.0.6\n")
