# Release notes

## 1.0.6

- Save initiative through Roll20's Campaign save path so a later tracker update
  does not reset the rolled result.
- Keep initiative pending for up to 60 seconds while the DM adds the matching
  token to the tracker. A newer roll replaces the pending result. Ambiguous
  targets are not guessed, and missing entries are never created automatically.
- Handle current weapon, companion, eidolon and construct attack/damage controls
  and preserve familiar/pet identity on checks.
- Keep roll feedback from intercepting clicks on nearby spell controls.

Validation: 81 JavaScript tests, 30 real-extension Chromium fixture tests and
47 deployment tests. Live disposable-game checks covered representative rolls,
delayed initiative, supersession, timeout and persistence after another entry's
update and page reload, using two clients under the same GM account.

Native dice-tray rolls and summoned-creature attack controls remain unsupported.
Independent-player permissions and simultaneous conflicting writes remain
unverified. Pending initiative is page-local and cancels on reload. Invoking the
save path does not acknowledge asynchronous server rejection. See
[the coverage report](ROLL-COVERAGE.md) for tested controls and remaining limits.
