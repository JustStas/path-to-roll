# Path to Roll

A Chrome extension that enhances the interaction between Pathbuilder 2e character sheets and Roll20. It automatically copies skill checks to your clipboard and can directly paste them into Roll20's chat.

## Features

### Roll Management
- **One-Click Rolling**: Click any skill, attack, or spell on your Pathbuilder sheet to generate a formatted roll string
- **Roll20 Template Format**: Rolls are formatted using Roll20's template system, including:
  - Character name
  - Skill/Attack/Spell name
  - Roll formula with modifier
  - Additional context (proficiency level, traits, damage types, etc.)
- **Automatic Roll20 Integration**: When a single Roll20 game tab is open and ready, rolls will be automatically pasted into the chat
- **Enhanced Critical Hit Formatting**: Critical hit information is now displayed in a more readable format:
  - Shows critical multiplier (e.g., "2x")
  - Displays additional critical damage with clickable roll links
  - Format: "2x + [additional damage] ([Roll Additional Critical])"

### Status Indicators
- **Pathbuilder Status**: Shows whether a Pathbuilder character sheet is open
  - Green: Page is open and ready
  - Red: No page open
- **Roll20 Status**: Shows the connection state with Roll20
  - Green: One game tab open and fully connected
  - Orange: Multiple game tabs open
  - Red with "Not ready": Page is open but not ready (needs refresh)
  - Red with "No page open": No Roll20 game detected

### Customization
- **Dice Tray Control**: Toggle Pathbuilder's native dice tray and tinting effect
  - When enabled: Blocks Pathbuilder's dice tray for a cleaner experience
  - When disabled: Allows both Roll20 integration and Pathbuilder's native rolling
- **Clipboard Mode**: Choose how roll strings are handled
  - Auto-paste to Roll20 (default)
  - Copy to clipboard only

## Supported Roll Types
- **Skills**: All skill checks with modifiers
- **Attacks**: Weapon attacks including:
  - Attack bonus
  - Proficiency level
  - Weapon traits
- **Spells**: Spell attacks with traits
- **Damage**: Weapon damage rolls including:
  - Damage formula
  - Damage type
  - Critical multiplier

## Installation

1. **Download the Extension**:
   - Clone this repository or download it as a ZIP file
   ```bash
   git clone https://github.com/yourusername/path-to-roll.git
   ```

2. **Load in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked"
   - Select the folder containing the extension files

3. **Verify Installation**:
   - The extension icon should appear in your Chrome toolbar
   - Click it to see the status indicators
   - Green indicators show when services are properly connected

## Usage

1. **Basic Roll**:
   - Open your Pathbuilder character sheet
   - Open your Roll20 game
   - Wait for both status indicators to turn green
   - Click any rollable element in Pathbuilder
   - The roll will be automatically sent to Roll20 (or copied to clipboard if selected)

2. **Status Panel**:
   - Click the extension icon to see connection status
   - Green circles indicate fully connected services
   - Orange/red indicate potential issues
   - Hover over indicators for detailed status information

3. **Settings**:
   - Block Pathbuilder Dice Tray: Toggle Pathbuilder's native rolling interface
   - Copy to Clipboard: Enable to copy rolls to clipboard instead of auto-pasting
   - Settings persist between sessions

## Troubleshooting

- **"Not ready" Status**:
  - Refresh your Roll20 page
  - Wait for the page to fully load
  - Check if the game is actually loaded (not just the landing page)

- **Multiple Roll20 Tabs**:
  - The extension will only auto-paste when exactly one game tab is open
  - Close other Roll20 game tabs or use clipboard mode

- **Receiving End Error**:
  - If you see this error, check the Roll20 status indicator
  - If red with "Not ready", refresh the Roll20 page
  - Wait for the status to turn green before attempting rolls

- **Pathbuilder Dice Tray Issues**:
  - Try toggling the checkbox in the extension popup
  - Refresh the Pathbuilder page if changes don't take effect

## Contributing

Feel free to submit issues and enhancement requests!

## Publishing to Chrome Web Store

1. **Prepare the Extension**:
   - Update the version number in `manifest.json`
   - Ensure all images and icons meet Chrome Web Store requirements:
     - One 128x128 pixel icon
     - One promotional tile image (440x280)
     - At least two screenshots (1280x800 or 640x400)
   - Create a ZIP file of your extension directory (excluding `.git` and development files)

2. **Developer Registration**:
   - Visit the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Sign up for a developer account
   - Pay one-time registration fee ($5 USD)

3. **Submit the Extension**:
   - Click "New Item" in the developer dashboard
   - Upload your ZIP file
   - Fill out required information:
     - Detailed description
     - Privacy policy
     - Screenshots/videos
     - Category (Productivity)
     - Language
   - Submit for review

4. **Post-Publication**:
   - Review typically takes 2-3 business days
   - Respond to any reviewer feedback promptly
   - After approval, the extension will be publicly available
   - Keep your contact information and privacy policy up to date

### CI/CD Publishing (GitHub Actions)

This project includes a ready workflow at:

- `.github/workflows/publish-chrome-web-store.yml`

It uses `mobilefirstllc/cws-publish` to upload/publish directly to Chrome Web Store.

#### Required GitHub Secrets

Add these repository secrets:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_EXTENSION_ID`

#### Triggers

- Push tag `v*` (for example `v1.0.4`) -> runs with `publish` action
- Manual run (`workflow_dispatch`) -> lets you choose:
  - `upload`
  - `publish`
  - `testers`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Changelog

### Version 1.0.5
- Fixed Roll20 tab detection for URLs without a trailing slash (`https://app.roll20.net/editor`)

### Version 1.0.3
- Fixed char name display - curtesy of @oganm (https://github.com/oganm)

### Version 1.0.2
- Improved critical hit formatting
- Added clickable links for rolling additional critical damage
- Removed parenthetical damage type annotations from critical rolls
- Critical hits now display in format: "2x + [additional damage] ([Roll Additional Critical])"

### Version 1.0.1
- Initial public release
