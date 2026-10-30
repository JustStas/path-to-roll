const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const bridgeSource = readFileSync(join(__dirname, '..', 'roll20-initiative-bridge.js'), 'utf8');
const requestEvent = 'path-to-roll:add-initiative';
const resultEvent = 'path-to-roll:add-initiative:result';

// The browser Campaign is a Backbone model: set changes this client only;
// save writes to shared state. Another client reads the saved state, not ours.
// Only this external Roll20 boundary is simulated; the real bridge runs below.
function token(id = 'agent-token', name = 'AgentTesting', pageId = 'test-page') {
    return { id, get: (key) => ({ name, _subtype: 'token', _pageid: pageId, isdrawing: false })[key] };
}

function createSession(turnOrder, { persistence = 'available', events = true, tokens = [token()] } = {}) {
    const server = { turnorder: turnOrder, initiativepage: false };
    const local = { ...server };
    const modelListeners = new Set();
    const timers = new Map();
    const statuses = [];
    const graphics = { models: tokens };
    let now = 0;
    let timerId = 0;
    let saves = 0;
    const emitChange = () => { for (const handler of [...modelListeners]) handler(); };
    const campaign = {
        get: (key) => local[key],
        set(key, value) {
            local[key] = value;
            if (key === 'turnorder') emitChange();
        },
        save() {
            saves++;
            if (persistence === 'throws') throw new Error('Save failed');
            if (persistence === 'rejected') return false;
            Object.assign(server, local);
        },
        activePage: () => ({ thegraphics: graphics }),
        on(event, handler) {
            assert.equal(event, 'change:turnorder');
            modelListeners.add(handler);
        },
        off(event, handler) {
            assert.equal(event, 'change:turnorder');
            modelListeners.delete(handler);
        }
    };
    if (!events) { delete campaign.on; delete campaign.off; }
    if (persistence === 'unavailable') delete campaign.save;
    if (persistence === 'invalid') campaign.save = true;

    const listeners = new Map();
    const window = {
        Campaign: campaign,
        setTimeout(handler, delay) { const id = ++timerId; timers.set(id, { at: now + delay, handler }); return id; },
        clearTimeout(id) { timers.delete(id); },
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        dispatchEvent(event) {
            for (const handler of [...(listeners.get(event.type) || [])]) handler(event);
        }
    };
    class CustomEvent {
        constructor(type, { detail } = {}) { this.type = type; this.detail = detail; }
    }
    runInNewContext(bridgeSource, {
        window, CustomEvent, Date: { now: () => now },
        setTimeout: window.setTimeout, clearTimeout: window.clearTimeout
    });
    window.addEventListener('path-to-roll:add-initiative:status', (event) => {
        statuses.push(JSON.parse(JSON.stringify(event.detail)));
    });

    let response;
    window.addEventListener(resultEvent, (event) => { response = event.detail; });
    return {
        local, server, campaign, graphics, statuses,
        replaceCampaign(model) { window.Campaign = model; },
        onStatus(handler) { window.addEventListener('path-to-roll:add-initiative:status', event => handler(event.detail)); },
        get saves() { return saves; },
        get timerCount() { return timers.size; },
        get listenerCount() { return modelListeners.size; },
        advance(ms) {
            const until = now + ms;
            while (timers.size) {
                const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (timer.at > until) break;
                now = timer.at;
                timers.delete(id);
                timer.handler();
            }
            now = until;
        },
        setTime(ms) { now = ms; },
        pagehide() { window.dispatchEvent(new CustomEvent('pagehide')); },
        dmTurns(turns, { notify = true } = {}) {
            server.turnorder = JSON.stringify(turns);
            Object.assign(local, server);
            if (notify) emitChange();
        },
        roll(total, characterName = 'AgentTesting') {
            response = undefined;
            window.dispatchEvent(new CustomEvent(requestEvent, {
                detail: {
                    requestId: 'test-request',
                    payload: { characterName, d20: 12, modifier: '+5', total }
                }
            }));
            assert.equal(response?.requestId, 'test-request');
            return response.result;
        },
        otherPlayerRoll() {
            const turns = JSON.parse(server.turnorder || '[]');
            const other = turns.find((turn) => turn.id === 'other-token');
            if (other) other.pr = '21';
            else turns.push({ id: 'other-token', pr: '21', custom: '', _pageid: 'test-page' });
            this.dmTurns(turns);
        }
    };
}

for (const initialPriority of ['0', '']) {
    test(`existing initiative (${JSON.stringify(initialPriority)}) survives another player's update`, () => {
        const session = createSession(JSON.stringify([
            { id: 'agent-token', pr: initialPriority, custom: '', _pageid: 'test-page', formula: '-1' },
            { id: '-1', pr: '30', custom: 'Round', formula: '1' },
            { id: 'other-token', pr: '10', custom: '', _pageid: 'test-page' }
        ]));

        const result = session.roll(17);
        assert.equal(result.success, true);
        assert.equal(result.total, 17);
        assert.equal(JSON.parse(session.local.turnorder).find((turn) => turn.id === 'agent-token').pr, '17');
        assert.equal(session.server.initiativepage, 'test-page');
        session.otherPlayerRoll();

        assert.deepEqual(JSON.parse(session.local.turnorder), [
            { id: '-1', pr: '30', custom: 'Round', formula: '1' },
            { id: 'agent-token', pr: '17', custom: '', _pageid: 'test-page', formula: '-1' },
            { id: 'other-token', pr: '21', custom: '', _pageid: 'test-page' }
        ]);
    });
}

for (const emptyOrder of ['', '[]']) {
    test(`missing entry in ${JSON.stringify(emptyOrder)} waits for the DM and then persists`, () => {
        const session = createSession(emptyOrder);
        assert.deepEqual(JSON.parse(JSON.stringify(session.roll(17))), {
            success: true, pending: true, expiresInMs: 60000,
            characterName: 'AgentTesting', roll: 12, modifier: 5, total: 17
        });
        assert.equal(session.local.turnorder, emptyOrder);
        assert.equal(session.saves, 0);
        session.otherPlayerRoll();
        assert.equal(JSON.parse(session.server.turnorder).some(turn => turn.id === 'agent-token'), false);
        session.dmTurns([
            { id: 'agent-token', pr: '0', custom: 'keep custom', _pageid: 'test-page', formula: '-1' },
            { id: 'other-token', pr: '21', custom: '' },
            { id: '-1', pr: '30', custom: 'Round', formula: '1' }
        ]);
        assert.deepEqual(JSON.parse(session.server.turnorder), [
            { id: '-1', pr: '30', custom: 'Round', formula: '1' },
            { id: 'other-token', pr: '21', custom: '' },
            { id: 'agent-token', pr: '17', custom: 'keep custom', _pageid: 'test-page', formula: '-1' }
        ]);
        assert.equal(session.saves, 1);
        assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 17, status: 'applied' }]);
        assert.equal(session.timerCount, 0);
        assert.equal(session.listenerCount, 0);
    });
}

test('repeated rolls persist the latest value without duplicating the token or losing other turns', () => {
    const session = createSession('[{"id":"agent-token","pr":"0","custom":"","_pageid":"test-page"}]');
    session.roll(17);
    session.otherPlayerRoll();
    assert.equal(session.roll(25).success, true);
    session.otherPlayerRoll();
    assert.deepEqual(JSON.parse(session.local.turnorder), [
        { id: 'agent-token', pr: '25', custom: '', _pageid: 'test-page' },
        { id: 'other-token', pr: '21', custom: '', _pageid: 'test-page' }
    ]);
});

for (const persistence of ['unavailable', 'invalid', 'rejected', 'throws']) {
    test(`reports failure when campaign persistence is ${persistence}`, () => {
        const initial = '[{"id":"agent-token","pr":"0"}]';
        const session = createSession(initial, { persistence });
        const result = session.roll(17);
        assert.equal(result.success, false);
        assert.equal(result.error, {
            unavailable: 'Campaign API unavailable',
            invalid: 'Campaign API unavailable',
            rejected: 'Failed to save Roll20 turn order',
            throws: 'Save failed'
        }[persistence]);
        assert.equal(session.server.turnorder, initial);
        if (persistence === 'unavailable' || persistence === 'invalid') {
            assert.equal(session.local.turnorder, initial);
        }
    });
}

for (const invalidOrder of ['not-json', '{}', 'null']) {
    test(`does not overwrite unreadable turn order ${JSON.stringify(invalidOrder)}`, () => {
        const session = createSession(invalidOrder);
        assert.equal(session.roll(17).success, false);
        assert.equal(session.local.turnorder, invalidOrder);
        assert.equal(session.server.turnorder, invalidOrder);
    });
}

test('polling finds a later token and DM entry without model events', () => {
    const session = createSession('[]', { events: false, tokens: [] });
    assert.equal(session.roll(17).pending, true);
    session.advance(1000);
    session.graphics.models.push(token());
    session.dmTurns([{ id: 'agent-token', pr: '' }], { notify: false });
    session.advance(999);
    assert.equal(session.saves, 0);
    session.advance(1);
    assert.equal(JSON.parse(session.server.turnorder)[0].pr, '17');
    assert.equal(session.saves, 1);
    session.advance(60000);
    assert.equal(session.saves, 1);
    assert.equal(session.timerCount, 0);
});

test('pending rolls expire at the exact deadline and ignore later DM additions', () => {
    const session = createSession('[]');
    session.roll(17);
    session.advance(59999);
    assert.deepEqual(session.statuses, []);
    session.setTime(60000);
    session.dmTurns([{ id: 'agent-token', pr: '0' }]);
    assert.equal(session.saves, 0);
    assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 17, status: 'expired' }]);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
    session.advance(60000);
    assert.equal(session.saves, 0);
});

test('a newer normalized character roll supersedes the old total and resets its minute', () => {
    const session = createSession('[]');
    session.roll(17);
    session.advance(59000);
    assert.equal(session.roll(25, '  agentTESTING ').pending, true);
    assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 17, status: 'superseded' }]);
    session.advance(2000);
    session.dmTurns([{ id: 'agent-token', pr: '0' }]);
    assert.equal(JSON.parse(session.server.turnorder)[0].pr, '25');
    assert.equal(session.saves, 1);
    assert.deepEqual(session.statuses[1], { characterName: 'agentTESTING', total: 25, status: 'applied' });
});

test('ambiguous token names wait until there is one unique ID', () => {
    const session = createSession('[{"id":"agent-token","pr":"0"}]', {
        tokens: [token(), token('clone', ' agenttesting ')]
    });
    assert.equal(session.roll(17).pending, true);
    session.advance(1000);
    assert.equal(session.saves, 0);
    session.graphics.models.pop();
    session.advance(1000);
    assert.equal(session.saves, 1);
    assert.equal(JSON.parse(session.server.turnorder)[0].pr, '17');
});

test('a token repeated on active and player pages is deduplicated by ID', () => {
    const session = createSession('[{"id":"agent-token","pr":"0"}]');
    session.local.playerpageid = 'player-page';
    session.campaign.pages = { models: [{ id: 'player-page', thegraphics: { models: [token()] } }] };
    assert.equal(session.roll(17).success, true);
    assert.equal(session.saves, 1);
});

test('duplicate tracker IDs and matching custom text never select a character turn', () => {
    const session = createSession('[{"id":"agent-token","pr":"0"},{"id":"agent-token","pr":"2"}]');
    assert.equal(session.roll(17).pending, true);
    session.dmTurns([{ id: '-1', custom: 'AgentTesting', pr: '0' }]);
    session.advance(60000);
    assert.equal(session.saves, 0);
    assert.equal(session.statuses.at(-1).status, 'expired');
});

test('a pinned token cannot be replaced by another token with the same name', () => {
    const session = createSession('[]');
    session.roll(17);
    session.graphics.models = [token('replacement')];
    session.dmTurns([{ id: 'replacement', pr: '0' }]);
    session.advance(60000);
    assert.equal(session.saves, 0);
    assert.deepEqual(JSON.parse(session.server.turnorder), [{ id: 'replacement', pr: '0' }]);
    assert.equal(session.statuses.at(-1).status, 'expired');
});

test('multiple characters share one scheduler and reentrant model events apply each once', () => {
    const session = createSession('[]', { tokens: [token(), token('second', 'Second Hero')] });
    session.roll(17);
    session.roll(22, 'Second Hero');
    assert.equal(session.timerCount, 1);
    assert.equal(session.listenerCount, 1);
    session.dmTurns([
        { id: 'agent-token', pr: '0', formula: '-1' },
        { id: 'second', pr: '0' },
        { id: 'other-token', pr: '11', extra: 'preserved' }
    ]);
    assert.equal(session.saves, 2);
    assert.deepEqual(JSON.parse(session.server.turnorder), [
        { id: 'second', pr: '22' },
        { id: 'agent-token', pr: '17', formula: '-1' },
        { id: 'other-token', pr: '11', extra: 'preserved' }
    ]);
    assert.deepEqual(session.statuses.map(status => status.status), ['applied', 'applied']);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
});

for (const persistence of ['throws', 'rejected']) {
    test(`a delayed ${persistence} save fails once and cancels all stale retries`, () => {
        const session = createSession('[]', { persistence });
        session.roll(17);
        session.dmTurns([{ id: 'agent-token', pr: '0' }]);
        assert.equal(session.saves, 1);
        assert.deepEqual(session.statuses, [{
            characterName: 'AgentTesting', total: 17, status: 'failed',
            error: persistence === 'throws' ? 'Save failed' : 'Failed to save Roll20 turn order'
        }]);
        session.advance(60000);
        session.dmTurns([{ id: 'agent-token', pr: '5' }]);
        assert.equal(session.saves, 1);
        assert.equal(session.timerCount, 0);
        assert.equal(session.listenerCount, 0);
    });
}

test('a thrown Campaign read terminates pending work without retries', () => {
    const session = createSession('[]');
    session.roll(17);
    session.campaign.get = () => { throw new Error('Read failed'); };
    session.advance(1000);
    assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 17, status: 'failed', error: 'Read failed' }]);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
});

test('pagehide cancels page-local pending work and cleans its timer and listener', () => {
    const session = createSession('[]');
    session.roll(17);
    session.pagehide();
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
    session.dmTurns([{ id: 'agent-token', pr: '0' }]);
    session.advance(60000);
    assert.equal(session.saves, 0);
    assert.deepEqual(session.statuses, []);
});

test('poll expiry bounds an absent token without any Campaign events', () => {
    const session = createSession('[]', { events: false, tokens: [] });
    session.roll(17);
    session.advance(59999);
    assert.deepEqual(session.statuses, []);
    assert.equal(session.timerCount, 1);
    session.advance(1);
    assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 17, status: 'expired' }]);
    assert.equal(session.timerCount, 0);
    assert.equal(session.saves, 0);
});

test('a delayed write uses tracker changes made during token resolution', () => {
    const session = createSession('[]');
    session.roll(17);
    session.graphics.models = [{
        id: 'agent-token',
        get(key) {
            if (key === 'name') session.local.turnorder = JSON.stringify([
                { id: 'agent-token', pr: '0', custom: 'latest', formula: '-2' },
                { id: 'other-token', pr: '33', custom: 'fresh unrelated', extra: { retained: true } }
            ]);
            return { name: 'AgentTesting', _subtype: 'token', _pageid: 'test-page' }[key];
        }
    }];
    session.dmTurns([{ id: 'agent-token', pr: '0', custom: 'stale' }]);
    assert.deepEqual(JSON.parse(session.server.turnorder), [
        { id: 'other-token', pr: '33', custom: 'fresh unrelated', extra: { retained: true } },
        { id: 'agent-token', pr: '17', custom: 'latest', formula: '-2' }
    ]);
});

test('deadline reached during resolution prevents a delayed write', () => {
    const session = createSession('[]');
    session.roll(17);
    session.graphics.models = [{
        id: 'agent-token',
        get(key) {
            if (key === 'name') session.setTime(60000);
            return { name: 'AgentTesting', _subtype: 'token', _pageid: 'test-page' }[key];
        }
    }];
    session.dmTurns([{ id: 'agent-token', pr: '0' }]);
    assert.equal(session.saves, 0);
    assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 17, status: 'expired' }]);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
});

test('malformed tracker data encountered while pending fails and stops retrying', () => {
    const session = createSession('[]');
    session.roll(17);
    session.local.turnorder = '{';
    session.advance(1000);
    assert.deepEqual(session.statuses, [{
        characterName: 'AgentTesting', total: 17, status: 'failed', error: 'Invalid Roll20 turn order'
    }]);
    assert.equal(session.local.turnorder, '{');
    assert.equal(session.saves, 0);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
});


test('a pending roll never follows a replacement Campaign model with the same token ID', () => {
    const session = createSession('[]');
    session.roll(17);
    const replacement = { turnorder: '[{"id":"agent-token","pr":"0"}]' };
    let saves = 0;
    session.replaceCampaign({
        get: key => replacement[key],
        set(key, value) { replacement[key] = value; },
        save() { saves++; },
        activePage: session.campaign.activePage
    });
    session.advance(1000);
    assert.equal(saves, 0);
    assert.equal(replacement.turnorder, '[{"id":"agent-token","pr":"0"}]');
    assert.deepEqual(session.statuses, [{
        characterName: 'AgentTesting', total: 17, status: 'failed', error: 'Roll20 campaign changed'
    }]);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
});


for (const nestedAppliesImmediately of [false, true]) {
    test(`a reroll from a superseded status listener keeps the newest total (immediate=${nestedAppliesImmediately})`, () => {
        const session = createSession('[]');
        session.roll(17);
        session.onStatus(status => {
            if (status.total !== 17 || status.status !== 'superseded') return;
            if (nestedAppliesImmediately) session.dmTurns([{ id: 'agent-token', pr: '0' }], { notify: false });
            session.roll(33);
        });
        session.roll(25);
        if (!nestedAppliesImmediately) session.dmTurns([{ id: 'agent-token', pr: '0' }]);
        assert.equal(JSON.parse(session.server.turnorder)[0].pr, '33');
        assert.equal(session.saves, 1);
        assert.deepEqual(session.statuses.filter(status => status.status === 'superseded').map(status => status.total), [17, 25]);
        if (!nestedAppliesImmediately) assert.deepEqual(session.statuses.at(-1), {
            characterName: 'AgentTesting', total: 33, status: 'applied'
        });
        session.advance(60000);
        assert.equal(session.saves, 1);
        assert.equal(session.timerCount, 0);
        assert.equal(session.listenerCount, 0);
    });
}

test('a reroll during token resolution prevents the older immediate request from writing', () => {
    const session = createSession('[{"id":"agent-token","pr":"0"}]');
    let nested = false;
    session.graphics.models = [{
        id: 'agent-token',
        get(key) {
            if (key === 'name' && !nested) {
                nested = true;
                session.roll(33);
            }
            return { name: 'AgentTesting', _subtype: 'token', _pageid: 'test-page' }[key];
        }
    }];
    session.roll(25);
    assert.equal(JSON.parse(session.server.turnorder)[0].pr, '33');
    assert.equal(session.saves, 1);
    assert.deepEqual(session.statuses, [{ characterName: 'AgentTesting', total: 25, status: 'superseded' }]);
    assert.equal(session.timerCount, 0);
    assert.equal(session.listenerCount, 0);
});
