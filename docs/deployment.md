# Chrome Web Store deployment

The extension is plain JavaScript with a Manifest V3 `manifest.json`; it does not
need npm, compilation or a server deployment. The workflow uses Google's
[Chrome Web Store v2 API](https://developer.chrome.com/docs/webstore/api/reference/rest).

After one-time setup, pushing **`vVERSION`**, exactly matching the tagged commit's
`manifest.json`, automatically runs tests, builds a clean ZIP/checksum, uploads it
and submits it using **`DEFAULT_PUBLISH`**. Google publishes when it approves the
submission. There is no second release action, dashboard publication click or
review-status polling job. Google still controls review and can reject a release.
[Google's publication modes](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

Pull requests and ordinary pushes to `main` only run tests and packaging; they do
not call Google. Manual dispatch remains available for `package` (the default,
credential-free) and `upload` (a draft only, from `main`).

## Release safeguards

- Tags must be `v` plus the exact valid Chrome version, such as `v1.0.6`. Semver
  prerelease suffixes, leading zeros and tag/manifest mismatches are rejected.
- The tag, workflow-event SHA and checkout must resolve to the same commit.
  Lightweight and annotated tags are supported. The commit must already be on
  fetched `origin/main`; unmerged feature tags are rejected. Both jobs fetch full
  history; the store job rechecks the source before credentials are supplied.
- Every tagged release is tested and packaged anew. The store job consumes that
  run's artifact and verifies its SHA-256 against the build output.
- Store versions must increase. An active review, staged submission, prior upload
  still processing, malformed status, failed upload or warning blocks publication.
- Store jobs are serialized and mutations are never automatically retried. A
  timeout can leave an uncertain remote outcome: inspect the dashboard first.

Only create release tags on commits containing this merged workflow. Older commits
can contain the previous tag-publishing workflow and do not acquire these safeguards
retroactively. Tag creation is the release decision; do not move or reuse release tags.

## One-time setup by the repository/publisher owner

This code does not create credentials, change access settings or publish anything
until a release tag is pushed (or a draft upload is manually requested) after setup.
Do not paste secret values into issues, chat, source files, workflow inputs or
command-line arguments.

### 1. Configure GitHub

1. In **Settings → Environments**, create `chrome-web-store` before a store run.
2. Under **Deployment branches and tags**, select rules allowing branch `main`
   (manual draft uploads) and tags `v*` (automatic releases). Branch and tag rules
   are separate. For the fully automatic flow, do not require environment reviewers
   or a wait timer. If an earlier configuration required approval, the owner must
   remove that pause; otherwise tagged runs will still wait for approval.
3. Restrict creation/update/deletion of `v*` tags to trusted release maintainers
   using a repository tag ruleset. The workflow's ancestry check guards mistakes;
   it is not an access-control boundary against someone who can push a different
   workflow under a release tag. Keep repository write/release access limited.
4. Add the environment secrets/variables below. The YAML environment name does
   not configure rules; GitHub can otherwise create an unprotected environment
   automatically. [GitHub environment setup](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
5. After setup, set repository Actions variable `CWS_PUBLISHING_ENABLED` to exactly
   `true`. Without it, store requests fail before reaching the environment job.
   Normal CI/package previews still work. The flag is a one-time opt-in, not a
   per-release button or a replacement for restricted tag access.

| Kind / location | Name | Value |
| --- | --- | --- |
| Repository Actions variable | `CWS_PUBLISHING_ENABLED` | `true` after environment setup |
| Environment variable | `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings → publisher ID |
| Environment variable | `CWS_EXTENSION_ID` | Existing listing's 32-letter item ID, also in its store URL |
| Environment secret | `CWS_CLIENT_ID` | OAuth client ID |
| Environment secret | `CWS_CLIENT_SECRET` | OAuth client secret |
| Environment secret | `CWS_REFRESH_TOKEN` | Refresh token authorized by the store publisher account |

The old OAuth secret names remain compatible. A `CWS_EXTENSION_ID` secret remains
a fallback if no variable is set. Move repository-level publishing secrets into
the environment so unrelated jobs cannot access them. Publisher and item IDs are
different; v2 requires both. Environment feature availability depends on repository
visibility and GitHub plan; verify your configuration in Settings.

### 2. Authorize the Google publisher account

Reuse suitable existing OAuth credentials if available. Otherwise follow Google's
[API setup guide](https://developer.chrome.com/docs/webstore/using-api):

1. Select/create a Google Cloud project and enable **Chrome Web Store API**.
2. Configure OAuth consent and a Web application OAuth client with authorized
   redirect URI `https://developers.google.com/oauthplayground`.
3. In [OAuth Playground](https://developers.google.com/oauthplayground), choose
   **Use your own OAuth credentials** and enter that client ID/secret.
4. Request `https://www.googleapis.com/auth/chromewebstore`, authorize using the
   account that owns/manages the store item, and exchange the code. Store the
   **refresh token** in the environment secret. Access tokens are short lived and
   refreshed in memory by the workflow.
5. Use an appropriate production OAuth consent configuration for ongoing access.
   External apps left in **Testing** issue refresh tokens that expire after seven
   days for this scope. Tokens can also expire or be revoked; see Google's
   [token lifetime guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

[Linked service accounts](https://developer.chrome.com/docs/webstore/service-accounts)
are an alternative. This implementation retains the existing OAuth model and does
not create service accounts, keys or IAM bindings.

### 3. Check the existing store listing

The developer account, listing, screenshots, privacy declarations, distribution
settings and review feedback remain in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole). The pipeline
updates the existing item, does not change visibility and does not bypass review.
A changed visibility setting may require one manual publication before the API
can publish again. Listing changes and rejection/credential recovery can require
intervention; ordinary successful releases do not require a dashboard visit.

## Release procedure

1. Merge the intended code and a higher `manifest.json` version into `main`,
   including this pipeline before the first automatic release.
2. Push a new matching version tag on that merged commit. For example, **after
   checking the code/version you intend to release**, run:

   ```sh
   git switch main
   git pull --ff-only
   RELEASE_VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
   git tag -a "v$RELEASE_VERSION" -m "Release $RELEASE_VERSION"
   git push origin "refs/tags/v$RELEASE_VERSION"
   ```

3. **Actions → Chrome extension CI and release** shows tests, artifact checksum,
   upload and review submission. A `PENDING_REVIEW` result means Google accepted
   submission and will publish automatically upon approval; the job does not wait
   for that review to finish. `PUBLISHED` means it is already published.

No manual test or second release action is required by the workflow. Optional
browser smoke testing uses `AgentTesting` per [AGENTS.md](../AGENTS.md). A preview
is available through manual `package` dispatch with the exact manifest version;
extract the outer Actions artifact to get the inner store ZIP and checksum.
Manual `upload` saves a draft only; a subsequent release tag uploads its own tested
artifact before submitting. Avoid changing the dashboard draft during a release.

## Local validation

Requires Node 24, Python 3.11+ and Git. No third-party packages or store credentials:

```sh
node --test
python3 -m unittest discover -s tests -v
python3 scripts/package_extension.py --expected-version 1.0.5
```

Replace the example version with the current manifest version. Unit tests create
temporary local Git fixtures to exercise tags/ancestry; they never tag the project
repository or call the store. Packaging checks shipped JS with `node --check`,
validates assets and uses `RUNTIME_FILES` in `scripts/package_extension.py`. Add
new runtime files there when features add assets/imports. Development files never
ship automatically. ZIP entry timestamps/modes are fixed for reproducible output
from identical source/toolchain.

## Failures and recovery

- **Missing enable flag/credentials or blocked environment:** complete the one-time
  setup. No store mutation occurs before configuration validation.
- **Tag/version/source mismatch:** fix and merge the intended version on `main`;
  use a new correct tag. Do not move/reuse a release tag or tag unmerged work.
- **401/403:** verify credentials, publisher account, API enablement and both IDs.
  Error logs contain HTTP codes without response bodies or secrets.
- **Active submission or version conflict:** inspect the dashboard; wait for or
  resolve the existing review before preparing a higher release version.
- **Upload still processing/failure/unknown status:** review is not submitted.
  Check the dashboard before taking another action. Processing is polled for up
  to two minutes; review itself is handled by Google without a polling job.
- **Warning, rejection, interrupted job, timeout or connection error:** inspect the
  dashboard before rerunning. A failed job does not prove no remote mutation
  occurred. Fix listing/code issues or credentials as appropriate, then deliberately
  retry only after understanding the store state; nothing auto-resubmits.
- **Rollback:** publish a newer version containing the desired earlier code.
  Store versions cannot be downgraded.

The first authenticated store run remains user initiated by pushing a release tag
after setup. Mock HTTP tests and CI do not validate account credentials or listing
configuration. Setting up this PR does not itself create a tag or publish a release.
