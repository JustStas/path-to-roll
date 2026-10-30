# Deployment implementation plan

**Goal:** Build and validate a version-tag Chrome Web Store release pipeline in a
separate checkout/branch without invoking live store mutations.

**Architecture:** Python standard-library scripts package the source and call the
v2 API. GitHub Actions separates credential-free CI from the store environment.

**Spec:** ../specs/2026-10-29-deployment-design.md

## Constraints and review focus

- Preserve all extension behavior and the separate gameplay-fix checkout.
- No credentials, publishing, release dispatch, security-setting changes or merge.
- Catch missing assets, accidental development-file inclusion, invalid versions,
  asynchronous upload errors, and staged-revision mismatches before mutation.
- Do not echo HTTP bodies or credential-bearing transport exceptions.
- A failed mutation may have completed remotely: report uncertainty, never retry it.

## Tasks

1. [x] Add packaging tests, verify failure, then implement `scripts/package_extension.py`.
   Test deterministic allowlisted ZIP/checksum, missing assets, version mismatch,
   invalid Chrome versions, and symlinks. Run Python tests and JS syntax checks.
2. [x] Add API-client tests, verify failure, then implement `scripts/chrome_web_store.py`.
   Test upload-only, staged review, async success/failure/timeout, auth failures,
   invalid/missing configuration, active submissions, version monotonicity and
   DEFAULT_PUBLISH auto-publication. Run the whole suite without network.
3. [x] Replace the workflow; add exact setup/runbook and link it from ReadMe.md.
   Validate YAML/Actions expressions, pinned official actions, credential isolation,
   tag-only publication, tag/version/commit ancestry guards and artifact handoff.
4. [x] Review the full diff, run all checks and packaging; deliver on the isolated branch,
   and create a draft PR if GitHub write access is available. Report live validation
   and user-configuration limits precisely.

## Verification and review

- Baseline: no test suite or build dependencies; `node --test` discovers zero JS tests.
- Python tests: 47 pass, including source validation, request gates, real local Git
  tag fixtures and mocked store API. Annotated/lightweight tags, version mismatch,
  unmerged commits, moved tags and missing main history are covered.
- Built 12-entry store ZIP and SHA-256; runtime sources remain unchanged.
- `actionlint` 1.7.12: clean (downloaded official binary, checksum verified).
- Fresh reviewer found unknown/malformed preflight state, a previous async upload
  still in progress, and missing synchronous-upload version could allow mutation.
  Added reproductions, observed failures, tightened validation, and reran the full
  suite green. No reviewer findings remain deferred.
- Live store authentication/publication and environment setup deliberately excluded.
- User approved switching to automatic version-tag publication: submission uses
  DEFAULT_PUBLISH and Google publishes after approval; no staged-release action.

## Read-only authentication checkpoint

- [x] Add regression tests for exactly OAuth refresh + fetchStatus GET, sanitized
  output/errors, CLI operation without package/version and no mutation fallthrough.
- [x] Keep publishing disabled: check-auth bypasses only the enable flag, remains
  manual/main-only, and runs in a separate environment job after credential-free CI.
- [x] Document exact post-merge dispatch steps and what the result proves.
- [x] Fresh review: no actionable findings; 47 tests, workflow lint and diff checks
  pass. Deliver on PR #5 and verify that commit's CI before reporting completion.
  Do not merge, dispatch check-auth, inspect secrets, enable publishing or create tags.
