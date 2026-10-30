# Roll coverage and verification

## Initiative behavior

The Roll20 bridge previously changed the browser Campaign model without saving
it. Updates now call `Campaign.save()` after changing the existing token entry,
preserving unrelated entries and metadata. Malformed turn orders are rejected.

When the matching token or tracker entry is missing, retain the already rolled
result for up to 60 seconds. Watch Campaign changes with a one-second polling
fallback. Never create tracker entries. The DM must add the token normally.
A newer roll for the same normalized name supersedes the pending roll and resets
its deadline. Ambiguous names and duplicate tracker IDs are never guessed.
Resolved token and Campaign identities are pinned. Pending work stops after
application, expiry, failure, supersession or page unload; reload cancels it.
Pathbuilder distinguishes chat delivery from waiting, and Roll20 shows outcome
notices that do not intercept clicks.

## Roll coverage

Fixtures use the synthetic character `AgentTesting`. They preserve minimal
observed control structure from Pathbuilder 111.4, not complete page captures.

| Roll family | Automated evidence | Live disposable-game evidence |
| --- | --- | --- |
| Existing initiative: zero/empty values, rerolls | VM and real-extension browser tests | Existing zero and reroll values survived another QA entry update and reload |
| Delayed tracker addition | VM and browser tests | Original total applied after DM addition; unrelated change preserved after reload |
| Pending supersession | VM and browser tests | Newest of two rolls applied when a second client added the token; survived reload |
| Pending timeout | Deterministic VM/browser clocks | Real one-minute expiry; late addition kept its default priority after reload |
| Skills/saves/Perception | Representative controls, text/icon and zero/negative modifiers | Representative familiar and construct checks delivered with correct actor |
| Ability checks | STR label/modifier controls | Not individually live-tested |
| Character weapons | Current and legacy headings, Hit/Damage, traits/proficiency | Club attack and damage delivered correctly |
| Spells | Ignition attack/damage, full extension messaging and adjacent-click hit testing | Consecutive Ignition attack/damage delivered correctly |
| Familiar | Fortitude, Perception, separate Pet Skills dialog; owner/pet attribution | Representative save, Perception and Acrobatics delivered correctly |
| Companion | Young Badger Jaws/Claw attack and damage | Both attacks and damage delivered correctly |
| Eidolon | Beast Eidolon Fist/Wing attack and damage; nested MAP excluded | Both attacks and damage delivered correctly |
| Construct | Prototype Construct Fist/Spike, Fortitude and Perception | Both attacks/damage and representative checks delivered correctly |
| Summons | Inspected Summon Animal exposes description, no creature attack controls | No supported attack surface identified |
| Native dice tray | Separate MAP/Damage/Critical/free-die controls | Not bridged by these changes |

The spell selectors already handled the inspected Ignition controls. A separate
missed-click defect was reproduced: roll feedback covered an adjacent damage
button. Feedback now uses `pointer-events: none`; actual browser hit testing
and consecutive clicks verify the fix. This does not establish the cause of
every reported spell-attack failure or support all spell modes.

## Reproduce automated checks

Use Node.js 20.19+ and Python 3:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
python3 -m unittest discover -s tests -p 'test_*.py'
```

Verified totals: **81 Node tests**, **30 browser tests**, **47 Python tests**.
The existing dependency-free CI command, `node --test`, discovers the 32 bridge
tests. The explicit `npm test` command also runs the jsdom cases after `npm ci`;
their `.dom.js` suffix keeps them out of dependency-free discovery. Browser tests
use Playwright's separate discovery. The deployment workflow remains unchanged.
Node tests execute the real scripts against VM/jsdom fixtures. Browser tests
load the actual unpacked MV3 extension in fresh disposable Chromium profiles;
they verify the service worker, all four runtime source fingerprints,
Pathbuilder injection and Roll20 PING before testing message round-trips.
No `chrome.*` APIs are replaced in the browser suite. Normal matching HTTPS
URLs are fulfilled with fixtures; other external page requests are aborted.
Roll20's chat and Campaign/server boundary are simulated. Separate documents
hold independent Campaign models backed by shared test state.

Profiles are removed after each test. Reports/screenshots stay in ignored
`test-results/`; they are generated test artifacts, not repository fixtures.
Set `PLAYWRIGHT_BROWSERS_PATH` if using a custom browser download location.
`PATH_TO_ROLL_EXTENSION_DIR` optionally selects a temporary source copy for
baseline/mutation checks; leave unset for the current checkout. Removing save
or restoring popup interception was verified to fail the relevant regressions.

## Limits

Live checks used a disposable campaign and two clients under the same GM account,
not independent player accounts. Player permissions and simultaneous conflicting
writes remain unverified. `applied` means the Campaign save path was invoked;
asynchronous server rejection is not acknowledged before reporting success.
A synchronous failure can leave a local visual edit. The queue is not a conflict
resolution system and does not survive page reload.

Other pet species/levels, healing, heightened/focus/innate spell modes, multiple
damage components and extra critical dice are not exhaustively covered. These
changes do not modify the release manifest or deployment workflow. Browser tests
are a separate local command, not an addition to the publishing workflow.
