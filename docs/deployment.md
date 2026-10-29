# Chrome Web Store deployment

The extension is plain JavaScript with a Manifest V3 `manifest.json`; it does not
need npm, compilation or a server deployment. The existing store listing is
updated using Google's [Chrome Web Store v2 API](https://developer.chrome.com/docs/webstore/api/reference/rest).

The workflow [`.github/workflows/publish-chrome-web-store.yml`](../.github/workflows/publish-chrome-web-store.yml)
tests and packages pull requests and pushes to `main`. **These events never call
Google. Tags no longer publish anything.** Store operations are manual dispatches
from `main`, after CI passes, through the `chrome-web-store` GitHub environment.

## Choose an operation

| Manual action | Effect |
| --- | --- |
| `package` (default) | Builds a tested ZIP/checksum artifact. No store access or credentials required. |
| `upload` | Uploads a new draft. Does not submit review or publish. |
| `submit-review` | Uploads the tested ZIP, waits for upload processing, then submits with `STAGED_PUBLISH`. Google reviews it and holds an approved version for a separate release. |
| `release-staged` | Checks that the store revision is `STAGED` and exactly matches the expected manifest version, then publishes it. Does not upload a new package. **This sends the approved version to users.** |

Every manual run requires the exact version from `manifest.json`. Upload/review
runs require a version higher than existing published/submitted revisions, and
refuse to overwrite a pending review or staged submission. The store also applies
its own version rules. Review submission blocks warnings and never skips review.

## One-time setup by the repository/publisher owner

Nothing in this repository creates credentials or changes GitHub/Google access.
Do the following yourself after reviewing/merging the pipeline. Do not paste token
values into issues, chat, source files, workflow inputs or command-line arguments.

### 1. Configure the protected GitHub environment

1. Open repository **Settings → Environments → New environment** and create
   `chrome-web-store` before attempting a store run.
2. Add **Required reviewers** and restrict **Deployment branches and tags** to
   the branch `main` only. Configure reviewers according to who should approve
   a release. A solo maintainer needs to allow self-review; enable **Prevent
   self-review** only if another person can approve. Disable administrator bypass
   if your release policy requires it. [GitHub setup instructions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
3. Add the environment secrets and variables listed below. The environment name
   in YAML alone does **not** create reviewer rules. GitHub may create an
   unprotected environment if it is referenced before setup; the separate enable
   flag prevents an accidental first store run. Required-reviewer availability
   depends on repository visibility and GitHub plan; verify it in Settings.
4. Only after setup, add repository Actions variable `CWS_PUBLISHING_ENABLED`
   with the exact value `true`. Without it, manual store runs fail before the
   environment job starts. Package/CI runs still work. This flag is an opt-in,
   not a substitute for environment protection rules.

| Kind / location | Name | Value |
| --- | --- | --- |
| Repository Actions variable | `CWS_PUBLISHING_ENABLED` | `true` after environment setup |
| Environment variable | `CWS_PUBLISHER_ID` | Publisher ID from Developer Dashboard → Publisher → Settings |
| Environment variable | `CWS_EXTENSION_ID` | Existing listing's 32-letter item ID (also in its store URL) |
| Environment secret | `CWS_CLIENT_ID` | OAuth client ID |
| Environment secret | `CWS_CLIENT_SECRET` | OAuth client secret |
| Environment secret | `CWS_REFRESH_TOKEN` | Refresh token authorized by the store publisher account |

The old workflow used the same OAuth secret names and a `CWS_EXTENSION_ID`
secret. The item-ID secret remains a fallback if no variable is set. Existing
repository-level secrets also resolve in this workflow; move sensitive publishing
credentials into the protected environment so other jobs cannot access them.
The publisher ID is newly required by v2. An item ID is not a publisher ID.

### 2. Enable API access and authorize the publisher account

Reuse suitable existing OAuth credentials if you already configured the old
workflow. Otherwise follow Google's [API setup guide](https://developer.chrome.com/docs/webstore/using-api):

1. Select/create a Google Cloud project and enable **Chrome Web Store API**.
2. Configure the OAuth consent screen and create a Web application OAuth client,
   adding `https://developers.google.com/oauthplayground` as an authorized redirect URI.
3. Open [OAuth Playground](https://developers.google.com/oauthplayground), choose
   **Use your own OAuth credentials**, and enter that client ID and secret.
4. Request scope `https://www.googleapis.com/auth/chromewebstore`, authorize using
   the Google account that owns/manages the existing store item, and exchange the
   code for tokens. Put the **refresh token** in the environment secret, not the
   short-lived access token. The workflow refreshes access tokens in memory.
5. Verify the client consent-screen publishing status. External apps left in
   **Testing** issue refresh tokens that expire after seven days for this scope.
   Use the appropriate production consent configuration for ongoing publishing.
   Tokens can also be revoked or expire after inactivity; see Google's
   [refresh-token lifetime guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

Google also supports [linked service accounts](https://developer.chrome.com/docs/webstore/service-accounts).
This implementation retains the repository's existing OAuth model; it does not
create a service account, key or IAM binding. Federation is a future alternative
if you prefer to replace refresh-token access with managed identity.

### 3. Check the store listing

Use the existing item; do not create another listing for updates. Google's
developer-account requirements, store listing, screenshots, privacy declarations,
distribution settings and reviewer feedback still need attention in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole). The pipeline
does not populate these fields, change visibility, cancel submissions or bypass
Google's review. A visibility change may require one manual publication before
the API can publish again. Review duration is controlled by Google.

## Release procedure

1. Merge the intended code and a higher `manifest.json` version into `main`.
   Keep this version on `main` until staged publication is complete. This avoids
   trying to release an earlier staged version after the manifest moves ahead.
2. In **Actions → Chrome extension CI and release → Run workflow**, select
   `main`, action `package`, and the exact manifest version. Download the
   `chrome-extension-package` artifact, extract the outer Actions archive, and
   inspect the inner `path-to-roll-VERSION.zip` plus `.zip.sha256`. The ZIP has
   `manifest.json` at its root. Test the extracted extension in Chrome as needed;
   gameplay E2E testing uses `AgentTesting` per [AGENTS.md](../AGENTS.md).
3. Run again on `main` with **`submit-review`** and that version. Review the
   source commit and package SHA-256 in the run summary before approving its
   environment job. That run uploads its own tested artifact. If code changed
   since the package preview, inspect the new artifact before approving.
4. Wait for Google review. Check the Developer Dashboard until it reports the
   version is approved/staged. The CI job reports submission acceptance, not
   review completion. Nothing is released automatically after approval.
5. When ready for users to receive it, run **`release-staged`** on `main` with
   the same version and approve the environment job. It checks Google's staged
   version/state immediately before publishing. The staged store package is
   released, not the newly built local artifact. The API exposes version/state,
   not a draft-package checksum; avoid parallel manual dashboard changes and
   inspect the staged listing before release. You may instead publish the staged
   item manually in the Developer Dashboard.

Use `upload` if you only want a draft for dashboard inspection; submit that draft
manually in the dashboard afterward, or rerun `submit-review` (it reuploads its
tested artifact). Do not start several store runs in parallel. The workflow
serializes store jobs without cancelling one in progress; GitHub concurrency can
replace an older pending run with a newer one.

## Local validation

Requires Node 24 and Python 3.11+; no third-party packages or store credentials:

```sh
node --test
python3 -m unittest discover -s tests -v
python3 scripts/package_extension.py --expected-version 1.0.5
```

Replace the example version with the current manifest version. Packaging also
checks all shipped JavaScript with `node --check`, validates local assets, and
uses the explicit `RUNTIME_FILES` list in `scripts/package_extension.py`. Add new
runtime files there when features add assets/imports; documents, tests, screenshots,
temporary files and hidden configuration never ship automatically. The ZIP is
reproducible for identical source/toolchain, with fixed entry timestamps and modes.
The store job verifies its SHA-256 against the build job output before using it.

## Failures and recovery

- **No enable flag / missing credentials:** finish the setup above. Package-only
  remains available. No store mutation happens before configuration validation.
- **401/403:** verify OAuth client/refresh token, authorized publisher account,
  enabled API, publisher ID and item ID. The script reports status codes without
  printing Google's response bodies or secrets. Inspect the dashboard for detail.
- **Version conflict or active submission:** inspect the dashboard. Release/wait
  for the existing submission, or resolve it manually and prepare a higher version.
- **Upload in progress:** the job polls status for up to two minutes. Failure,
  missing/unknown status or timeout prevents review submission. Inspect the upload
  in the dashboard before deciding what to do next. A pre-existing upload still
  in progress blocks a new operation; malformed/unknown revision status also blocks
  mutation. A synchronous upload must confirm the exact uploaded version.
- **Warning/rejection/listing validation:** correct it in code or the dashboard;
  the pipeline does not ignore warnings or automatically resubmit.
- **Timeout, connection error or interrupted store job:** an upload/publication
  may have reached Google. **Check the dashboard before rerunning.** Mutations are
  never automatically retried. A workflow failure does not prove no remote change.
- **Rollback:** prepare a newer version containing the desired earlier code and
  use the same review/release process. Store version numbers cannot be downgraded.

The first authenticated store run is deliberately a user-operated validation step.
Unit tests use mocked HTTP and do not establish that your Google account, listing,
credentials or GitHub environment have been configured correctly.
