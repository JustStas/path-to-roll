import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

from scripts.chrome_web_store import StoreError, deploy, request_json


VERSION = "1.0.6"
ITEM_ID = "a" * 32
ENV = {"CWS_PUBLISHER_ID": "publisher-123", "CWS_EXTENSION_ID": ITEM_ID,
       "CWS_CLIENT_ID": "client", "CWS_CLIENT_SECRET": "secret",
       "CWS_REFRESH_TOKEN": "refresh"}


def status(version="1.0.5", state="PUBLISHED", submitted=None, upload=None):
    result = {"publishedItemRevisionStatus": {
        "state": state, "distributionChannels": [{"crxVersion": version}]}}
    if submitted:
        result["submittedItemRevisionStatus"] = {
            "state": submitted, "distributionChannels": [{"crxVersion": VERSION}]}
    if upload:
        result["lastAsyncUploadState"] = upload
    return result


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.package = Path(self.temp.name) / "extension.zip"
        with zipfile.ZipFile(self.package, "w") as archive:
            archive.writestr("manifest.json", json.dumps({"version": VERSION}))

    def run_deploy(self, action, responses, **kwargs):
        calls = []

        def transport(url, *, method="GET", data=None, headers=None):
            calls.append((url, method, data, headers))
            if not responses:
                raise AssertionError(f"Unexpected network request: {method} {url}")
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

        result = deploy(action, self.package, VERSION, ENV, transport=transport,
                        sleep=lambda _: None, poll_attempts=2, **kwargs)
        self.assertEqual(responses, [])
        return result, calls

    def test_upload_draft_never_calls_publish(self):
        result, calls = self.run_deploy("upload", [
            {"access_token": "token"}, status(),
            {"uploadState": "SUCCEEDED", "crxVersion": VERSION}])
        self.assertIn("draft", result)
        self.assertTrue(calls[-1][0].endswith(":upload"))
        self.assertEqual(calls[-1][2], self.package.read_bytes())
        self.assertEqual(calls[-1][3]["Authorization"], "Bearer token")

    def test_release_submits_for_automatic_publication_and_blocks_warnings(self):
        result, calls = self.run_deploy("submit-release", [
            {"access_token": "token"}, status(),
            {"uploadState": "SUCCEEDED", "crxVersion": VERSION}, {"state": "PENDING_REVIEW"}])
        self.assertIn("review", result)
        self.assertEqual(json.loads(calls[-1][2]), {
            "publishType": "DEFAULT_PUBLISH", "skipReview": False, "blockOnWarnings": True})
        self.assertIn("automatically", result)

    def test_async_upload_waits_for_success_before_review(self):
        result, calls = self.run_deploy("submit-release", [
            {"access_token": "token"}, status(), {"uploadState": "IN_PROGRESS"},
            status(upload="IN_PROGRESS"), status(upload="SUCCEEDED"), {"state": "PENDING_REVIEW"}])
        self.assertIn("review", result)
        self.assertEqual([call[1] for call in calls], ["POST", "GET", "POST", "GET", "GET", "POST"])

    def test_failed_or_unknown_upload_never_publishes(self):
        for state in ["FAILED", "UPLOAD_STATE_UNSPECIFIED", None]:
            with self.subTest(state=state), self.assertRaisesRegex(StoreError, "upload"):
                self.run_deploy("submit-release", [
                    {"access_token": "token"}, status(), {"uploadState": state}])

    def test_async_failure_and_timeout_never_publish(self):
        for states in [["FAILED"], ["IN_PROGRESS", "IN_PROGRESS"]]:
            with self.subTest(states=states), self.assertRaisesRegex(StoreError, "upload"):
                self.run_deploy("submit-release", [
                    {"access_token": "token"}, status(), {"uploadState": "IN_PROGRESS"},
                    *[status(upload=state) for state in states]])

    def test_upload_version_mismatch_is_not_submitted(self):
        with self.assertRaisesRegex(StoreError, "version"):
            self.run_deploy("submit-release", [
                {"access_token": "token"}, status(), {"uploadState": "SUCCEEDED", "crxVersion": "2.0"}])

    def test_synchronous_upload_must_confirm_exact_version(self):
        with self.assertRaisesRegex(StoreError, "version"):
            self.run_deploy("submit-release", [
                {"access_token": "token"}, status(), {"uploadState": "SUCCEEDED"}])

    def test_unknown_or_malformed_store_revisions_block_all_mutations(self):
        responses = [
            {"submittedItemRevisionStatus": {"state": "FUTURE_ACTIVE_STATE",
                 "distributionChannels": [{"crxVersion": "1.0.4"}]}},
            {"publishedItemRevisionStatus": {"state": "PUBLISHED"}},
            {"publishedItemRevisionStatus": None},
            {"publishedItemRevisionStatus": {"state": "PUBLISHED", "distributionChannels": []}},
            {"submittedItemRevisionStatus": {"state": "REJECTED", "distributionChannels": [None]}},
            {"submittedItemRevisionStatus": {"state": "CANCELLED", "distributionChannels": [{"crxVersion": "bad"}]}},
            status(upload="IN_PROGRESS"),
            status(upload="UNKNOWN"),
        ]
        for response in responses:
            with self.subTest(response=response), self.assertRaises(StoreError):
                self.run_deploy("upload", [{"access_token": "token"}, response])

    def test_active_review_or_stage_is_not_overwritten(self):
        for state in ["PENDING_REVIEW", "STAGED"]:
            with self.subTest(state=state), self.assertRaisesRegex(StoreError, "active submission"):
                self.run_deploy("upload", [{"access_token": "token"}, status(submitted=state)])

    def test_version_must_increase(self):
        for version in [VERSION, "2.0.0", "1.0.6.0"]:
            with self.subTest(version=version), self.assertRaisesRegex(StoreError, "higher"):
                self.run_deploy("upload", [{"access_token": "token"}, status(version=version)])

    def test_immediately_approved_submission_is_reported_as_published(self):
        result, calls = self.run_deploy("submit-release", [
            {"access_token": "token"}, status(),
            {"uploadState": "SUCCEEDED", "crxVersion": VERSION}, {"state": "PUBLISHED"}])
        self.assertIn("Published", result)
        self.assertEqual(len(calls), 4)

    def test_missing_configuration_and_bad_ids_fail_before_network(self):
        for changes in [{"CWS_CLIENT_SECRET": ""}, {"CWS_PUBLISHER_ID": "../bad"},
                        {"CWS_EXTENSION_ID": "not-an-id"}]:
            with self.subTest(changes=changes), patch("scripts.chrome_web_store.request_json") as transport:
                with self.assertRaises(StoreError):
                    deploy("upload", self.package, VERSION, {**ENV, **changes})
                transport.assert_not_called()

    def test_invalid_action_and_package_version_fail_before_network(self):
        with patch("scripts.chrome_web_store.request_json") as transport:
            for action, version in [("publish", VERSION), ("upload", "1.0.7")]:
                with self.subTest(action=action), self.assertRaises(StoreError):
                    deploy(action, self.package, version, ENV)
            transport.assert_not_called()

    def test_missing_access_token_fails_without_echoing_response(self):
        with self.assertRaises(StoreError) as caught:
            self.run_deploy("upload", [{"error": "secret refresh"}])
        self.assertNotIn("secret refresh", str(caught.exception))

    def test_unexpected_publish_response_fails(self):
        with self.assertRaisesRegex(StoreError, "unexpected"):
            self.run_deploy("submit-release", [{"access_token": "token"}, status(),
                {"uploadState": "SUCCEEDED", "crxVersion": VERSION}, {"state": "STAGED"}])


class TransportTests(unittest.TestCase):
    def test_http_error_does_not_expose_response_body_or_credentials(self):
        error = urllib.error.HTTPError("https://example.invalid", 403, "secret", {}, io.BytesIO(b"refresh secret"))
        with patch("urllib.request.urlopen", side_effect=error), self.assertRaises(StoreError) as caught:
            request_json("https://example.invalid", method="POST", data=b"secret")
        self.assertIn("403", str(caught.exception))
        self.assertNotIn("secret", str(caught.exception))
        self.assertTrue(error.fp.closed)

    def test_timeout_reports_uncertain_mutation_and_does_not_retry(self):
        with patch("urllib.request.urlopen", side_effect=TimeoutError("secret")) as opener:
            with self.assertRaisesRegex(StoreError, "uncertain") as caught:
                request_json("https://example.invalid", method="POST", data=b"secret")
            self.assertNotIn("secret", str(caught.exception))
            self.assertEqual(opener.call_count, 1)
