const { test: base, expect, chromium } = require('@playwright/test');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');

// Override only for temporary baseline/mutation checks; ordinary runs load the
// worktree itself. This never points at a user's browser profile.
const extensionPath = process.env.PATH_TO_ROLL_EXTENSION_DIR || join(__dirname, '../..');
const fixture = (name) => readFileSync(join(__dirname, '../fixtures', name), 'utf8');
const pageStyle = `<style>
body { font:16px sans-serif; margin:30px; }
.section-skill,.ability-span,.named-roll,.tooltip { display:inline-block; padding:10px; margin:6px; }
.tooltiptextCrit { display:none; } img { display:inline-block; width:18px; height:18px; }
.weapon-hit { display:inline-block; } #spell-attack,#spell-damage { margin:0; }
#spell-attack { width:170px; } #spell-damage { width:100px; }
</style>`;

function sheetHtml(surface) {
    let html = fixture('pathbuilder-rolls.html');
    if (surface !== 'character') {
        html = html.replace('</body>', fixture('pathbuilder-pet-rolls.html') + '</body>');
        if (['companion', 'eidolon', 'construct'].includes(surface)) {
            const { JSDOM } = require('jsdom');
            const dom = new JSDOM(html);
            dom.window.document.querySelector('.pet-column-holder').remove();
            dom.window.document.querySelector('.modal').remove();
            dom.window.document.querySelector('#selected-pet').textContent = {
                companion: 'Young Badger', eidolon: 'Eidolon', construct: 'Prototype Construct'
            }[surface];
            dom.window.document.querySelector('.tabbed-area-display').innerHTML = fixture(
                { companion: 'pathbuilder-companion-attacks.html', eidolon: 'pathbuilder-eidolon-attacks.html',
                    construct: 'pathbuilder-construct-rolls.html' }[surface]);
            html = dom.serialize();
            dom.window.close();
        }
    }
    return html.replace('</head>', pageStyle + '</head>');
}

// Test-only external app boundary. Campaign.set stays local; save writes a
// shared server binding. Every page/client has its own local Campaign model.
// No extension script or chrome.* API is replaced or injected by this harness.
const roll20Html = `<!doctype html><html><head><title>AgentTesting Roll20 fixture</title></head><body>
<div id="textchat-input"><textarea></textarea></div><button id="chatSendBtn">Send</button>
<div id="chat"></div><ol id="turnorder"></ol>
<label>Other priority <input id="other-priority" value="21"></label>
<button id="other-save">Update other player's initiative</button>
<button id="add-agent">DM adds AgentTesting to tracker</button>
<script>
window.fixtureReady = (async () => {
    let state = await window.readCampaign();
    const listeners = new Map();
    function render() {
        document.querySelector('#turnorder').replaceChildren(...JSON.parse(state.turnorder || '[]').map(turn => {
            const row = document.createElement('li');
            row.dataset.id = turn.id;
            row.textContent = (turn.id === 'agent-token' ? 'AgentTesting' : turn.custom || turn.id) + ': ' + turn.pr;
            return row;
        }));
    }
    window.Campaign = {
        get: key => state[key],
        set(key, value) {
            state[key] = value; render();
            for (const handler of [...(listeners.get('change:' + key) || [])]) handler();
        },
        on(event, handler) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        },
        off(event, handler) { listeners.get(event)?.delete(handler); },
        save() { return window.writeCampaign(JSON.parse(JSON.stringify(state))); },
        activePage: () => ({ thegraphics: { models: [{
            id: 'agent-token', get: key => ({ name: 'AgentTesting', _subtype: 'token',
                _pageid: 'qa-page', isdrawing: false })[key]
        }] } })
    };
    document.querySelector('#chatSendBtn').addEventListener('click', () => {
        const card = document.createElement('article');
        card.textContent = document.querySelector('textarea').value;
        document.querySelector('#chat').append(card);
    });
    document.querySelector('#other-save').addEventListener('click', async () => {
        state = await window.readCampaign();
        const turns = JSON.parse(state.turnorder || '[]');
        let other = turns.find(turn => turn.id === 'other-token');
        if (!other) { other = { id: 'other-token', custom: '' }; turns.push(other); }
        other.pr = document.querySelector('#other-priority').value;
        window.Campaign.set('turnorder', JSON.stringify(turns));
        await window.Campaign.save();
        document.querySelector('#other-save').dataset.saved = 'true';
    });
    document.querySelector('#add-agent').addEventListener('click', async () => {
        state = await window.readCampaign();
        const turns = JSON.parse(state.turnorder || '[]');
        if (!turns.some(turn => turn.id === 'agent-token')) {
            turns.push({ id: 'agent-token', pr: '0', custom: '', _pageid: 'qa-page' });
        }
        // Save the DM's addition before broadcasting a model change. Pending
        // application must read that latest order and preserve other turns.
        state.turnorder = JSON.stringify(turns);
        await window.Campaign.save();
        window.Campaign.set('turnorder', state.turnorder);
        document.querySelector('#add-agent').dataset.saved = 'true';
    });
    render();
})();
</script></body></html>`;

const test = base.extend({
    extension: async ({}, use, testInfo) => {
        const profile = mkdtempSync(join(tmpdir(), 'path-to-roll-browser-'));
        let context;
        try {
            context = await chromium.launchPersistentContext(profile, {
                channel: 'chromium', headless: true,
                args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
            });
            const state = { turnorder: '[]', initiativepage: false };
            const errors = [];
            const blockedRequests = [];
            context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
            await context.exposeBinding('readCampaign', () => structuredClone(state));
            await context.exposeBinding('writeCampaign', (_source, value) => {
                Object.assign(state, structuredClone(value));
                return true;
            });
            await context.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.hostname === 'pathbuilder2e.com' && url.pathname === '/app.html') {
                    return route.fulfill({ contentType: 'text/html', body: sheetHtml(url.searchParams.get('surface') || 'character') });
                }
                if (url.hostname === 'app.roll20.net' && ['/editor/', '/qa-other-client/'].includes(url.pathname)) {
                    return route.fulfill({ contentType: 'text/html', body: roll20Html });
                }
                if (url.protocol === 'chrome-extension:') return route.continue();
                blockedRequests.push(url.href);
                return route.abort();
            });
            let worker = context.serviceWorkers()[0];
            if (!worker) worker = await context.waitForEvent('serviceworker');
            const activation = await worker.evaluate(async () => ({
                workerUrl: self.location.href,
                manifest: chrome.runtime.getManifest(),
                pathbuilderSource: await (await fetch(chrome.runtime.getURL('pathbuilder.js'))).text(),
                backgroundSource: await (await fetch(chrome.runtime.getURL('background.js'))).text(),
                roll20Source: await (await fetch(chrome.runtime.getURL('roll20.js'))).text(),
                'roll20-initiative-bridgeSource': await (await fetch(chrome.runtime.getURL('roll20-initiative-bridge.js'))).text()
            }));
            const hash = source => createHash('sha256').update(source).digest('hex');
            const sourceHashes = {};
            for (const name of ['pathbuilder', 'background', 'roll20', 'roll20-initiative-bridge']) {
                sourceHashes[name] = hash(activation[name + 'Source']);
                expect(sourceHashes[name], 'loaded extension source matches selected directory').toBe(
                    hash(readFileSync(join(extensionPath, name + '.js'), 'utf8')));
            }
            const roll20 = await context.newPage();
            const clockStart = new Date('2026-10-30T00:00:00Z');
            await roll20.clock.install({ time: clockStart });
            await roll20.goto('https://app.roll20.net/editor/');
            await roll20.evaluate(() => window.fixtureReady);
            await roll20.clock.pauseAt(new Date('2026-10-30T00:01:00Z'));
            const roll20Ping = await worker.evaluate(async () => {
                const tabs = await chrome.tabs.query({ url: 'https://app.roll20.net/editor/*' });
                return chrome.tabs.sendMessage(tabs[0].id, { type: 'PING' });
            });
            expect(roll20Ping).toEqual({ status: 'ok' });
            const sheet = await context.newPage();
            const openSheet = async (surface = 'character') => {
                await sheet.goto('https://pathbuilder2e.com/app.html?surface=' + surface);
                await expect(sheet.locator('#tinting-style')).toHaveCount(1);
            };
            await openSheet();
            await testInfo.attach('extension-activation.json', {
                body: JSON.stringify({
                    browserVersion: context.browser().version(),
                    mode: 'headless isolated captured-page integration',
                    workerUrl: activation.workerUrl,
                    extensionName: activation.manifest.name,
                    manifestVersion: activation.manifest.manifest_version,
                    version: activation.manifest.version,
                    sourceDirectory: extensionPath,
                    sourceHashes,
                    contentScriptMarker: await sheet.locator('#tinting-style').count(),
                    roll20ContentScriptPing: roll20Ping,
                    chromeApiMocks: false,
                    externalAppBoundaries: ['captured Pathbuilder DOM', 'Roll20 chat DOM and Campaign/shared state']
                }, null, 2), contentType: 'application/json'
            });
            const otherClient = async () => {
                // Separate document and model, deliberately outside /editor/ so
                // the production background still sees exactly one target tab.
                const page = await context.newPage();
                await page.goto('https://app.roll20.net/qa-other-client/');
                await page.evaluate(() => window.fixtureReady);
                return page;
            };
            await use({ context, sheet, roll20, state, openSheet, otherClient, worker, blockedRequests });
            expect(errors, 'fixture and real extension scripts must not throw').toEqual([]);
        } finally {
            if (context) await context.close();
            rmSync(profile, { recursive: true, force: true });
        }
    }
});

module.exports = { test, expect };
