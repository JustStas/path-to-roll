# AGENTS.md — path-to-roll

This file is for agents (and humans) working on this repo.

## Project links

- Roll20 app: https://app.roll20.net/
- Pathbuilder entry: https://pathbuilder2e.com/
- Pathbuilder app page: https://pathbuilder2e.com/app.html?v=104b
- Chrome extensions page: chrome://extensions/

---

## Pathbuilder test character policy

For all automated/manual tests in this repo, use Pathbuilder character **`AgentTesting`**.

If it does not exist:

1. Open `https://pathbuilder2e.com/` -> **Continue** (Web Character Builder)
2. Click **New character**
3. In the new character wizard, click **Get Started** (or **Core Only**)
4. Click **Character Name** and set it to `AgentTesting`, then **Accept**
5. Open **Menu** -> **Save Character (Local)** (or **Save Character**) -> **Save to Local Folder**
6. Open **Menu** -> **Open Character**, select `AgentTesting`, then click **Accept**

---

## Open everything from scratch (tested flow)

### 1) Open Roll20 campaign

1. Open a new tab: `https://app.roll20.net/`
2. Make sure you are logged in.
3. In **My Games**, open your game via **Launch Game** (or **Restore Game** for paused games).
4. You should land on: `https://app.roll20.net/editor/`

### 2) Open Pathbuilder character sheet

1. Open a new tab: `https://pathbuilder2e.com/`
2. Click **Continue** under Web Character Builder.
3. Click **Load Character**.
4. In the load dialog:
   - choose source (**Local Files** or **Google Drive**)
   - select character **`AgentTesting`**
   - click **Accept**
5. You should end up on the full character sheet in `app.html`.

If `AgentTesting` is not available, follow the **Pathbuilder test character policy** above to create/save/load it first.

> If the list is empty, switch source (Local Files <-> Google Drive) and/or sign in to the chosen source.

---

## Reload extension after code changes

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right).
3. Find **Path to Roll**.
4. Click **Reload** on the extension card.

If extension is not installed:

1. In `chrome://extensions/`, click **Load unpacked**.
2. Select this repo folder (`path-to-roll`).
3. Confirm **Path to Roll** appears and is enabled.

---

## Page reload rules after extension reload

After reloading the extension, reload both web apps so updated content scripts attach:

1. Reload Roll20 editor tab (`https://app.roll20.net/editor/`)
2. Reload Pathbuilder tab (`https://pathbuilder2e.com/app.html?v=104b`)
3. Re-open your character in Pathbuilder if needed (Load Character -> Accept)

---

## Manual E2E test checklist

Use this after any behavior change.

1. Have exactly one Roll20 editor tab open.
2. Use Pathbuilder character **`AgentTesting`** for test runs.
3. Ensure a token exists in Roll20 whose **token name matches character name** from Pathbuilder (for this flow: `AgentTesting`).
4. In Pathbuilder, click a skill roll and confirm Roll20 chat receives it.
5. Click **Initiative** and verify:
   - chat card appears in Roll20
   - card includes `Initiative mod`, `Perception mod`, and combined `Modifier`
   - initiative tracker is updated for the matching token

---

## Initiative persistence regression checks

Run all regression tests from the repo root (Node.js 20.19+):

```sh
npm ci
npm test
```

To run only the dependency-free bridge tests:

```sh
node --test tests/initiative-bridge.test.js
```

See `ROLL-COVERAGE.md` for inspected controls, known gaps and verification limits.

To exercise the actual unpacked extension in isolated Chromium using captured
pages (no live account required):

```sh
npx playwright install chromium
npm run test:browser
```

The runner creates/removes disposable profiles, verifies loaded source hashes,
and writes `test-results/results.json` with extension-activation attachments.
It does not reload the extension in an existing Chrome profile. Treat this as
captured-page integration; live Roll20 server persistence still needs the
manual checks below. Never use a user's normal profile or copy cookies into
the test runner. `PATH_TO_ROLL_EXTENSION_DIR` is only for a selected temporary
extension source copy during baseline/mutation checks, not a browser profile.

For manual verification, use a disposable/safe Roll20 test game only and Pathbuilder character **`AgentTesting`**. Do not alter a live game for testing.

1. Reload the extension and both web apps as described above. Keep one Roll20 editor tab per client; use a second authorized test player/client for the shared-state check.
2. Create a matching `AgentTesting` token and another test token. Note the existing tracker entries so they can be restored after testing.
3. With `AgentTesting` absent from the tracker, roll Initiative in Pathbuilder. Confirm the chat card and waiting notice appear, and no tracker entry is created. Have the DM add the matching token to the tracker within 60 seconds. Confirm its total matches the original chat card and the second client receives it. The extension never adds missing entries itself; ambiguous token names wait safely and expire. Pending work is page-local and is canceled by a Roll20 reload.
4. Have the second player change their own initiative, then reload the first Roll20 client. Confirm `AgentTesting` retains its total and the other token/custom entries remain intact.
5. Repeat with `AgentTesting` already in the tracker at `0` and at an empty priority, then reroll from Pathbuilder. Confirm the latest total survives the second player's subsequent update and a reload, with only one `AgentTesting` entry.
6. Check the browser console for save errors and restore the test tracker. A local tracker update alone does not establish persistence: confirm it in the second client and after reload. Test simultaneous rolls separately; this bridge does not merge competing writes.

---

## Quick troubleshooting

- **No roll sent to Roll20**
  - Check extension is enabled and reloaded
  - Check only one Roll20 editor tab is open
  - Reload both tabs after extension reload

- **Initiative chat works but tracker does not update**
  - Ensure token name exactly matches Pathbuilder character name
  - Ensure token is on the active/player page

- **Pathbuilder load dialog opens but no characters listed**
  - Switch source (Local Files / Google Drive)
  - Confirm source account/data availability
