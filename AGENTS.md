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
