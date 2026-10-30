# Chrome Web Store deployment

The existing MV3 extension is distributed through Chrome Web Store. Its workflow
currently zips almost the whole checkout and publishes automatically on `v*` tags
through an unpinned third-party action. There is no build system or test suite.

Replace that workflow with CI on pull requests/main and automatic version-tag releases.
Build an allowlisted, reproducible ZIP with a checksum; check JavaScript syntax,
manifest asset references, and deployment tests before handing that same artifact
to a separate environment-protected store job. Keep packaging credential-free.

Use the official Chrome Web Store v2 HTTP API and the existing OAuth refresh-token
secret names. This avoids adding a dependency or requiring a new service account.
Alternatives: retaining the third-party action leaves version/state handling less
visible; service-account federation can remove long-lived OAuth credentials but
requires additional IAM and publisher access configuration outside this task.

Automatic releases: a pushed `vVERSION` tag must exactly match manifest.json and
resolve to the event/checkout commit, already merged on fetched origin/main.
Check these constraints in both build and store jobs. Upload the tested artifact,
then submit with DEFAULT_PUBLISH so Google publishes on approval without polling
or a second release action. Manual actions remain `package` (default) and draft-only
`upload` from main; their expected version must match manifest.json. Add manual
`check-auth` from main in a separate environment job: it refreshes OAuth and makes
only the official fetchStatus GET, with fixed sanitized output and no upload/publish
call. This read-only mode requires neither the publishing enable flag nor a package
or expected release version. Its credentials stay in the chrome-web-store environment.
Serialize store
jobs. Never skip review, ignore warnings, or retry a mutation automatically. Fail
closed on unexpected API states and missing setup. The owner configures allowed
release tags, trusted tag creators and credentials once; per-release environment
approval is optional and must be absent for the fully automatic flow.
Configure the environment and credentials separately; this change must not publish,
merge, create credentials, or modify access settings.

Document the API, exact setup, reviewer protection, version bumps, review/staging,
troubleshooting uncertain requests, and the manual listing/privacy work Google
still requires. Test packaging isolation and deterministic output, version guards,
API failures, async upload handling, exact tag/version/commit ancestry guards,
automatic publication mode and secret-safe errors using mocked HTTP responses and
temporary local Git fixtures. Live publishing is outside validation scope.
Read-only authentication checks are tested with fake credentials/HTTP; do not dispatch
the credential-using workflow as part of implementation. Merge, publishing enablement,
tag creation and actual authentication checks require separate user steps.
