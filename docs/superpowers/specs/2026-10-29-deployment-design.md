# Chrome Web Store deployment

The existing MV3 extension is distributed through Chrome Web Store. Its workflow
currently zips almost the whole checkout and publishes automatically on `v*` tags
through an unpinned third-party action. There is no build system or test suite.

Replace that workflow with CI on pull requests/main and manual deployment on main.
Build an allowlisted, reproducible ZIP with a checksum; check JavaScript syntax,
manifest asset references, and deployment tests before handing that same artifact
to a separate environment-protected store job. Keep packaging credential-free.

Use the official Chrome Web Store v2 HTTP API and the existing OAuth refresh-token
secret names. This avoids adding a dependency or requiring a new service account.
Alternatives: retaining the third-party action leaves version/state handling less
visible; service-account federation can remove long-lived OAuth credentials but
requires additional IAM and publisher access configuration outside this task.

Manual actions: `package` (default), `upload`, `submit-review` (STAGED_PUBLISH),
`release-staged` (only an already STAGED revision matching the expected version).
Require the dispatch version to match manifest.json and require main for store
actions. Serialize store jobs. Never skip review, ignore warnings, or retry a
mutation automatically. Fail closed on unexpected API states and missing setup.
Configure the environment and credentials separately; this change must not publish,
merge, create credentials, or modify access settings.

Document the API, exact setup, reviewer protection, version bumps, review/staging,
troubleshooting uncertain requests, and the manual listing/privacy work Google
still requires. Test packaging isolation and deterministic output, version guards,
API failures, async upload handling, staged publication gates, and secret-safe
errors using mocked HTTP responses. Live publishing is outside validation scope.
