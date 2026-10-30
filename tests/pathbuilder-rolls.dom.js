const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const source = readFileSync(join(__dirname, '..', 'pathbuilder.js'), 'utf8');
const backgroundSource = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const roll20Source = readFileSync(join(__dirname, '..', 'roll20.js'), 'utf8');
const fixture = readFileSync(join(__dirname, 'fixtures', 'pathbuilder-rolls.html'), 'utf8');
const petFixture = readFileSync(join(__dirname, 'fixtures', 'pathbuilder-pet-rolls.html'), 'utf8');
const companionFixture = readFileSync(join(__dirname, 'fixtures', 'pathbuilder-companion-attacks.html'), 'utf8');
const eidolonFixture = readFileSync(join(__dirname, 'fixtures', 'pathbuilder-eidolon-attacks.html'), 'utf8');

// Run the complete content script, including delegated click handlers and its
// asynchronous send path. Only Chrome's extension boundary is simulated; there
// is no Roll20 connection, network resource loading or real clipboard access.
function createSheet(t, preferences = {}, sendRoll = () => Promise.resolve({ success: true })) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    const dom = new JSDOM(fixture, {
        url: 'https://pathbuilder2e.com/app.html?v=111.4',
        runScripts: 'outside-only',
        virtualConsole
    });
    t.after(() => dom.window.close());
    const messages = [];
    dom.window.chrome = {
        storage: {
            sync: {
                get(keys, callback) {
                    const result = Object.fromEntries(keys
                        .filter((key) => Object.hasOwn(preferences, key))
                        .map((key) => [key, preferences[key]]));
                    queueMicrotask(() => callback(result));
                }
            }
        },
        runtime: {
            onMessage: { addListener() {} },
            sendMessage(message) {
                messages.push(JSON.parse(JSON.stringify(message)));
                return sendRoll(message);
            }
        }
    };
    dom.window.eval(source);
    return {
        document: dom.window.document,
        messages,
        async click(selector) {
            const target = dom.window.document.querySelector(selector);
            assert.ok(target, `fixture target exists: ${selector}`);
            const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            // Let storage callbacks register any delayed damage dispatch, then
            // let that timer and the send promises finish before assertions.
            await Promise.resolve();
            await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
            assert.deepEqual(errors, [], 'content script must not throw on the observed DOM');
            return event;
        }
    };
}

function onlyRoll(sheet) {
    assert.equal(sheet.messages.length, 1, 'one click must dispatch exactly one roll');
    assert.equal(sheet.messages[0].type, 'ROLL_STRING');
    return sheet.messages[0];
}

test('roll feedback lets pointer input pass through to adjacent roll controls', async (t) => {
    const sheet = createSheet(t);
    await sheet.click('#spell-attack');
    const feedback = Array.from(sheet.document.body.children)
        .find((element) => element.textContent === 'Sent to Roll20: Spell Attack roll');
    assert.ok(feedback, 'the completed roll displays feedback');
    // Chrome hit testing reproduced the popup covering the neighbouring damage
    // button. jsdom checks the CSS contract; Chrome verifies the actual target.
    assert.equal(sheet.document.defaultView.getComputedStyle(feedback).pointerEvents, 'none');
});

test('queued initiative feedback distinguishes chat delivery from waiting for the DM', async (t) => {
    const sheet = createSheet(t, {}, async () => ({
        success: true, initiative: { success: true, pending: true, expiresInMs: 60000 }
    }));
    await sheet.click('#initiative .section-skill-total');
    onlyRoll(sheet);
    const feedback = Array.from(sheet.document.body.children)
        .find(element => element.textContent === 'Initiative sent to chat; waiting up to 60s for a tracker entry');
    assert.ok(feedback, 'pending initiative must not look like an applied tracker update');
});

test('Roll20 shows eventual pending initiative outcome without blocking pointer input', (t) => {
    const dom = new JSDOM('', { runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    t.after(() => dom.window.close());
    dom.window.chrome = { runtime: { onMessage: { addListener() {} } } };
    dom.window.eval(roll20Source);
    dom.window.dispatchEvent(new dom.window.CustomEvent('path-to-roll:add-initiative:status', {
        detail: { characterName: 'AgentTesting', total: 17, status: 'expired' }
    }));
    const notice = dom.window.document.querySelector('#path-to-roll-initiative-status');
    assert.ok(notice);
    assert.equal(notice.textContent, 'Initiative for AgentTesting expired: no matching tracker entry appeared within 60s');
    assert.equal(notice.getAttribute('role'), 'status');
    assert.equal(notice.style.pointerEvents, 'none');
});

function addPetSurface(sheet) {
    sheet.document.body.insertAdjacentHTML('beforeend', petFixture);
}

function addCompanionSurface(sheet) {
    addPetSurface(sheet);
    sheet.document.querySelector('#selected-pet').textContent = 'Young Badger';
    sheet.document.querySelector('.pet-column-holder').remove();
    sheet.document.querySelector('#tabbed-area .tabbed-area-display').insertAdjacentHTML('beforeend', companionFixture);
}

function addEidolonSurface(sheet) {
    addCompanionSurface(sheet);
    sheet.document.querySelector('#selected-pet').textContent = 'Eidolon';
    sheet.document.querySelector('#tabbed-area .tabbed-area-display').innerHTML = eidolonFixture;
}

for (const [card, expectedAttack, expectedDamage] of [
    ['#eidolon-fist', '&{template:default} {{name=AgentTesting - Eidolon - Fist Attack}} {{attack=[[1d20+7]]}} {{proficiency=Trained}} {{traits=Disarm}}', '&{template:default} {{name=AgentTesting - Eidolon - Fist Damage}} {{damage=[[1d8+4]]}} {{type=Bludgeoning}} {{critical=2x}}'],
    ['#eidolon-wing', '&{template:default} {{name=AgentTesting - Eidolon - Wing Attack}} {{attack=[[1d20+7]]}} {{proficiency=Trained}} {{traits=Agile, Finesse}}', '&{template:default} {{name=AgentTesting - Eidolon - Wing Damage}} {{damage=[[1d6+4]]}} {{type=Bludgeoning}} {{critical=2x}}']
]) {
    for (const target of ['.weapon-hit', '.icon-dice']) {
        test(`unlabeled Eidolon ${card} attack excludes MAP text from ${target}`, async (t) => {
            const sheet = createSheet(t);
            addEidolonSurface(sheet);
            await sheet.click(`${card} ${target}`);
            assert.equal(onlyRoll(sheet).rollString, expectedAttack);
        });
    }
    for (const target of ['> span', '> img']) {
        test(`unlabeled Eidolon ${card} damage forwards one roll from ${target}`, async (t) => {
            const sheet = createSheet(t);
            addEidolonSurface(sheet);
            await sheet.click(`${card} .tooltip:last-child ${target}`);
            assert.equal(onlyRoll(sheet).rollString, expectedDamage);
        });
    }
}

test('unlabeled damage-like text outside a validated weapon card is ignored', async (t) => {
    const sheet = createSheet(t);
    addEidolonSurface(sheet);
    sheet.document.querySelector('#eidolon-fist .weapon-name').remove();
    await sheet.click('#eidolon-fist .tooltip:last-child > span');
    assert.deepEqual(sheet.messages, []);
});

for (const [card, expectedAttack, expectedDamage] of [
    ['#pet-jaws', '&{template:default} {{name=AgentTesting - Young Badger - Jaws Attack}} {{attack=[[1d20+5]]}} {{proficiency=Trained}}', '&{template:default} {{name=AgentTesting - Young Badger - Jaws Damage}} {{damage=[[1d8+2]]}} {{type=Piercing}} {{critical=2x}}'],
    ['#pet-claw', '&{template:default} {{name=AgentTesting - Young Badger - Claw Attack}} {{attack=[[1d20+5]]}} {{proficiency=Trained}} {{traits=Agile}}', '&{template:default} {{name=AgentTesting - Young Badger - Claw Damage}} {{damage=[[1d6+2]]}} {{type=Slashing}} {{critical=2x}}']
]) {
    for (const target of ['.weapon-hit', '.icon-dice']) {
        test(`companion ${card} attack sends one correctly attributed roll from ${target}`, async (t) => {
            const sheet = createSheet(t);
            addCompanionSurface(sheet);
            await sheet.click(`${card} ${target}`);
            assert.equal(onlyRoll(sheet).rollString, expectedAttack);
        });
    }
    for (const target of ['.weapon-span', 'img']) {
        test(`companion ${card} damage without icon class sends one roll from ${target}`, async (t) => {
            const sheet = createSheet(t);
            addCompanionSurface(sheet);
            await sheet.click(`${card} .tooltip:last-child ${target}`);
            assert.equal(onlyRoll(sheet).rollString, expectedDamage);
        });
    }
}

test('a Damage label in an unrelated layout does not become a companion damage roll', async (t) => {
    const sheet = createSheet(t);
    addCompanionSurface(sheet);
    sheet.document.querySelector('#pet-jaws .weapon-hit').remove();
    await sheet.click('#pet-jaws .tooltip:last-child .weapon-span');
    assert.deepEqual(sheet.messages, []);
});

for (const [target, expected] of [
    ['#familiar-fortitude .dice-proficiency', '&{template:default} {{name=AgentTesting - Familiar (AgentTesting Familiar) - Fortitude}} {{roll=[[1d20+4]]}} {{modifier=+4}}'],
    ['#familiar-perception .section-skill-name', '&{template:default} {{name=AgentTesting - Familiar (AgentTesting Familiar) - Perception}} {{roll=[[1d20+4]]}} {{modifier=+4}}'],
    ['#pet-acrobatics .section-skill-total', '&{template:default} {{name=AgentTesting - Familiar (AgentTesting Familiar) - Acrobatics}} {{roll=[[1d20+4]]}} {{modifier=+4}}']
]) {
    test(`pet roll retains owner and selected pet identity from ${target}`, async (t) => {
        const sheet = createSheet(t);
        addPetSurface(sheet);
        await sheet.click(target);
        assert.equal(onlyRoll(sheet).rollString, expected);
    });
}

test('ordinary sheet skill remains attributed to owner while a pet is selected', async (t) => {
    const sheet = createSheet(t);
    addPetSurface(sheet);
    await sheet.click('#fortitude .section-skill-total');
    assert.equal(onlyRoll(sheet).rollString,
        '&{template:default} {{name=AgentTesting - Fortitude}} {{roll=[[1d20+4]]}} {{modifier=+4}}');
});

test('ordinary spell attack remains attributed to owner while a pet is selected', async (t) => {
    const sheet = createSheet(t);
    addPetSurface(sheet);
    await sheet.click('#spell-attack img');
    assert.equal(onlyRoll(sheet).rollString,
        '&{template:default} {{name=AgentTesting - Ignition Attack}} {{attack=[[1d20+4]]}} {{traits=Attack, Fire}}');
});

for (const [target, expected] of [
    ['#weapon-attack .icon-dice', '&{template:default} {{name=AgentTesting - Club Attack}} {{attack=[[1d20+5]]}} {{proficiency=Trained}} {{traits=Thrown 10ft}}'],
    ['#weapon-damage .icon-damage-dice', '&{template:default} {{name=AgentTesting - Club Damage}} {{damage=[[1d6+2]]}} {{type=Bludgeoning}} {{critical=2x}}']
]) {
    test(`ordinary weapon remains attributed to owner with Pets selected: ${target}`, async (t) => {
        const sheet = createSheet(t);
        addCompanionSurface(sheet);
        await sheet.click(target);
        assert.equal(onlyRoll(sheet).rollString, expected);
    });
}

test('a different skills dialog does not borrow the selected pet identity', async (t) => {
    const sheet = createSheet(t);
    addPetSurface(sheet);
    sheet.document.querySelector('.dialog-title').textContent = 'Skills';
    await sheet.click('#pet-acrobatics');
    assert.equal(onlyRoll(sheet).rollString,
        '&{template:default} {{name=AgentTesting - Acrobatics}} {{roll=[[1d20+4]]}} {{modifier=+4}}');
});

test('inactive Pets tab does not supply a stale selected pet identity', async (t) => {
    const sheet = createSheet(t);
    addPetSurface(sheet);
    sheet.document.querySelector('#tabbed-area > .tabbed-area-menu > .section-menu-selected').classList.remove('section-menu-selected');
    await sheet.click('#pet-acrobatics');
    assert.equal(onlyRoll(sheet).rollString,
        '&{template:default} {{name=AgentTesting - Acrobatics}} {{roll=[[1d20+4]]}} {{modifier=+4}}');
});

for (const target of ['#spell-attack', '#spell-attack img']) {
    test(`Ignition spell attack forwards one attack from ${target}`, async (t) => {
        const sheet = createSheet(t);
        await sheet.click(target);
        assert.deepEqual(onlyRoll(sheet), {
            type: 'ROLL_STRING',
            rollString: '&{template:default} {{name=AgentTesting - Ignition Attack}} {{attack=[[1d20+4]]}} {{traits=Attack, Fire}}'
        });
    });
}

for (const target of ['#spell-damage', '#spell-damage img']) {
    test(`Ignition damage forwards one damage roll from ${target}`, async (t) => {
        const sheet = createSheet(t);
        await sheet.click(target);
        assert.deepEqual(onlyRoll(sheet), {
            type: 'ROLL_STRING',
            rollString: '&{template:default} {{name=AgentTesting - Ignition Damage}} {{damage=[[2d4]]}} {{type=Fire}} {{traits=Attack, Fire}}'
        });
    });
}

for (const target of ['#fortitude .section-skill-total', '#fortitude .dice-proficiency']) {
    test(`Fortitude save forwards its modifier from ${target}`, async (t) => {
        const sheet = createSheet(t);
        await sheet.click(target);
        assert.equal(onlyRoll(sheet).rollString,
            '&{template:default} {{name=AgentTesting - Fortitude}} {{roll=[[1d20+4]]}} {{modifier=+4}}');
    });
}

test('Perception uses the ordinary skill roll path without initiative metadata', async (t) => {
    const sheet = createSheet(t);
    await sheet.click('#perception .section-skill-name');
    assert.deepEqual(onlyRoll(sheet), {
        type: 'ROLL_STRING',
        rollString: '&{template:default} {{name=AgentTesting - Perception}} {{roll=[[1d20+3]]}} {{modifier=+3}}'
    });
});

for (const [modifier, expected] of [
    ['0', '&{template:default} {{name=AgentTesting - Fortitude}} {{roll=[[1d20+0]]}} {{modifier=+0}}'],
    ['-2', '&{template:default} {{name=AgentTesting - Fortitude}} {{roll=[[1d20-2]]}} {{modifier=-2}}']
]) {
    test(`skill handler normalizes modifier ${modifier}`, async (t) => {
        const sheet = createSheet(t);
        // Derived edge case using the observed save layout, not another claim
        // about AgentTesting's actual statistics.
        sheet.document.querySelector('#fortitude .section-skill-total').textContent = modifier;
        await sheet.click('#fortitude');
        assert.equal(onlyRoll(sheet).rollString, expected);
    });
}

test('Initiative combines +0 with Perception +3 and sends the same total to chat and tracker', async (t) => {
    const sheet = createSheet(t);
    await sheet.click('#initiative .section-skill-name');
    const message = onlyRoll(sheet);
    const { initiative } = message;
    assert.equal(initiative.enabled, true);
    assert.equal(initiative.characterName, 'AgentTesting');
    assert.equal(initiative.initiativeModifier, '+0');
    assert.equal(initiative.perceptionModifier, '+3');
    assert.equal(initiative.modifier, '+3');
    assert.ok(Number.isInteger(initiative.d20) && initiative.d20 >= 1 && initiative.d20 <= 20);
    assert.equal(initiative.total, initiative.d20 + 3);
    assert.equal(message.rollString,
        `&{template:default} {{name=AgentTesting - Initiative}} {{roll=[[${initiative.total}]]}} {{modifier=+3}} {{initiative mod=+0}} {{perception mod=+3}} {{formula=1d20+3}} {{d20=${initiative.d20}}}`);
});

for (const target of ['#strength .abilityLabel', '#strength .abilityMod']) {
    test(`STR ability check forwards +2 from ${target}`, async (t) => {
        const sheet = createSheet(t);
        await sheet.click(target);
        assert.equal(onlyRoll(sheet).rollString,
            '&{template:default} {{name=AgentTesting - STR Check}} {{roll=[[1d20+2]]}} {{modifier=+2}}');
    });
}

for (const target of ['#weapon-attack .weapon-hit', '#weapon-attack .icon-dice']) {
    test(`Club attack retains weapon name, proficiency, base bonus and traits from ${target}`, async (t) => {
        const sheet = createSheet(t);
        await sheet.click(target);
        assert.equal(onlyRoll(sheet).rollString,
            '&{template:default} {{name=AgentTesting - Club Attack}} {{attack=[[1d20+5]]}} {{proficiency=Trained}} {{traits=Thrown 10ft}}');
    });
}

for (const target of ['#weapon-damage .weapon-span', '#weapon-damage .icon-damage-dice']) {
    test(`Club damage retains weapon name, damage type and critical text from ${target}`, async (t) => {
        const sheet = createSheet(t);
        await sheet.click(target);
        assert.equal(onlyRoll(sheet).rollString,
            '&{template:default} {{name=AgentTesting - Club Damage}} {{damage=[[1d6+2]]}} {{type=Bludgeoning}} {{critical=2x}}');
    });
}

test('legacy .weapon-name heading still supplies the attack name independently of icon order', async (t) => {
    const sheet = createSheet(t);
    // Compatibility case for the class consumed by the original content
    // script; this is deliberately derived, not claimed as current app markup.
    const icon = sheet.document.querySelector('#club img[src*="icon_prof_"]');
    const heading = icon.parentElement;
    heading.querySelector('div').classList.add('weapon-name');
    heading.append(icon);
    await sheet.click('#weapon-attack .icon-dice');
    assert.equal(onlyRoll(sheet).rollString,
        '&{template:default} {{name=AgentTesting - Club Attack}} {{attack=[[1d20+5]]}} {{proficiency=Trained}} {{traits=Thrown 10ft}}');
});

test('disabling native-tray blocking still forwards a spell attack', async (t) => {
    const sheet = createSheet(t, { blockTinting: false });
    const event = await sheet.click('#spell-attack img');
    assert.equal(event.defaultPrevented, false);
    assert.equal(onlyRoll(sheet).rollString,
        '&{template:default} {{name=AgentTesting - Ignition Attack}} {{attack=[[1d20+4]]}} {{traits=Attack, Fire}}');
});

test('spell attack travels through the real background and Roll20 scripts to one chat submission', async (t) => {
    const virtualConsole = new VirtualConsole();
    const errors = [];
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    const roll20 = new JSDOM('<div id="textchat-input"><textarea></textarea></div><button id="chatSendBtn">Send</button>', {
        url: 'https://app.roll20.net/editor/', runScripts: 'outside-only', virtualConsole
    });
    const background = new JSDOM('', { runScripts: 'outside-only', virtualConsole });
    t.after(() => { roll20.window.close(); background.window.close(); });
    const submissions = [];
    const chatInput = roll20.window.document.querySelector('textarea');
    roll20.window.document.querySelector('#chatSendBtn').addEventListener('click', () => {
        submissions.push(chatInput.value);
    });

    let receiveRoll20;
    roll20.window.chrome = {
        runtime: { onMessage: { addListener(listener) { receiveRoll20 = listener; } } }
    };
    roll20.window.eval(roll20Source);

    let receiveBackground;
    background.window.chrome = {
        runtime: { onMessage: { addListener(listener) { receiveBackground = listener; } } },
        tabs: {
            query(_query, callback) {
                callback([{ id: 42, url: 'https://app.roll20.net/editor/' }]);
            },
            sendMessage(tabId, message) {
                assert.equal(tabId, 42, 'route only to the local simulated editor tab');
                return new Promise((resolve) => receiveRoll20(message, {}, resolve));
            }
        }
    };
    background.window.eval(backgroundSource);

    const sheet = createSheet(t, {}, (message) => new Promise((resolve) => {
        receiveBackground(message, { tab: { id: 1, url: 'https://pathbuilder2e.com/app.html?v=111.4' } }, resolve);
    }));
    await sheet.click('#spell-attack img');

    onlyRoll(sheet);
    assert.deepEqual(errors, []);
    assert.deepEqual(submissions, [
        '&{template:default} {{name=AgentTesting - Ignition Attack}} {{attack=[[1d20+4]]}} {{traits=Attack, Fire}}'
    ]);
});
