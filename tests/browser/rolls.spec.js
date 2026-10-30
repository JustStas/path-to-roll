const { test, expect } = require('./extension-fixture');

// Each case must reach chat through real Chrome extension messaging. A missing
// handler, duplicate bubbling dispatch, lost actor or wrong formula fails here.
for (const [surface, target, expected] of [
    ['character', '#spell-attack', '{{name=AgentTesting - Ignition Attack}} {{attack=[[1d20+4]]}}'],
    ['character', '#spell-damage img', '{{name=AgentTesting - Ignition Damage}} {{damage=[[2d4]]}}'],
    ['character', '#fortitude .section-skill-total', '{{name=AgentTesting - Fortitude}} {{roll=[[1d20+4]]}}'],
    ['character', '#strength .abilityMod', '{{name=AgentTesting - STR Check}}'],
    ['character', '#weapon-attack .weapon-hit', '{{name=AgentTesting - Club Attack}} {{attack=[[1d20+5]]}}'],
    ['character', '#weapon-damage .icon-damage-dice', '{{name=AgentTesting - Club Damage}} {{damage=[[1d6+2]]}}'],
    ['familiar', '#familiar-fortitude .dice-proficiency', '{{name=AgentTesting - Familiar (AgentTesting Familiar) - Fortitude}} {{roll=[[1d20+4]]}}'],
    ['familiar', '#familiar-perception .section-skill-total', '{{name=AgentTesting - Familiar (AgentTesting Familiar) - Perception}} {{roll=[[1d20+4]]}}'],
    ['familiar', '#pet-acrobatics .section-skill-total', '{{name=AgentTesting - Familiar (AgentTesting Familiar) - Acrobatics}} {{roll=[[1d20+4]]}}'],
    ['companion', '#pet-jaws .weapon-hit', '{{name=AgentTesting - Young Badger - Jaws Attack}} {{attack=[[1d20+5]]}}'],
    ['companion', '#pet-claw .icon-dice', '{{name=AgentTesting - Young Badger - Claw Attack}} {{attack=[[1d20+5]]}}'],
    ['companion', '#pet-jaws .tooltip:last-child > span', '{{name=AgentTesting - Young Badger - Jaws Damage}} {{damage=[[1d8+2]]}}'],
    ['companion', '#pet-claw .tooltip:last-child > img', '{{name=AgentTesting - Young Badger - Claw Damage}} {{damage=[[1d6+2]]}}'],
    ['eidolon', '#eidolon-fist .icon-dice', '{{name=AgentTesting - Eidolon - Fist Attack}} {{attack=[[1d20+7]]}}'],
    ['eidolon', '#eidolon-wing .weapon-hit', '{{name=AgentTesting - Eidolon - Wing Attack}} {{attack=[[1d20+7]]}}'],
    ['eidolon', '#eidolon-fist .tooltip:last-child > img', '{{name=AgentTesting - Eidolon - Fist Damage}} {{damage=[[1d8+4]]}}'],
    ['eidolon', '#eidolon-wing .tooltip:last-child > span', '{{name=AgentTesting - Eidolon - Wing Damage}} {{damage=[[1d6+4]]}}'],
    ['construct', '#construct-fist .icon-dice', '{{name=AgentTesting - Prototype Construct - Fist Attack}} {{attack=[[1d20+6]]}}'],
    ['construct', '#construct-spike .weapon-hit', '{{name=AgentTesting - Prototype Construct - Spike Attack}} {{attack=[[1d20+6]]}}'],
    ['construct', '#construct-fist .tooltip:last-child > span', '{{name=AgentTesting - Prototype Construct - Fist Damage}} {{damage=[[1d8+3]]}}'],
    ['construct', '#construct-spike .tooltip:last-child > img', '{{name=AgentTesting - Prototype Construct - Spike Damage}} {{damage=[[1d6+3]]}}'],
    ['construct', '#construct-fortitude .section-skill-total', '{{name=AgentTesting - Prototype Construct - Fortitude}} {{roll=[[1d20+5]]}}'],
    ['construct', '#construct-perception .dice-proficiency', '{{name=AgentTesting - Prototype Construct - Perception}} {{roll=[[1d20+4]]}}']
]) {
    test(`${surface}: ${target} reaches Roll20 once`, async ({ extension }) => {
        const { sheet, roll20, openSheet } = extension;
        if (surface !== 'character') await openSheet(surface);
        await sheet.locator(target).click();
        await expect(roll20.locator('#chat article')).toHaveCount(1);
        await expect(roll20.locator('#chat article')).toContainText(expected);
    });
}

test('feedback does not intercept rapid adjacent spell damage click', async ({ extension }, testInfo) => {
    const { sheet, roll20 } = extension;
    await sheet.locator('#spell-attack').click();
    await expect(sheet.getByText('Sent to Roll20: Spell Attack roll', { exact: true })).toBeVisible();
    const point = await sheet.locator('#spell-damage').boundingBox();
    const x = point.x + 10;
    const y = point.y + point.height / 2;
    const hit = await sheet.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#spell-damage')?.id, { x, y });
    expect(hit).toBe('spell-damage');
    await sheet.screenshot({ path: testInfo.outputPath('popup-hit-test.png') });
    await sheet.mouse.click(x, y);
    await expect(roll20.locator('#chat article')).toHaveCount(2);
    await expect(roll20.locator('#chat article').last()).toContainText('{{damage=[[2d4]]}}');
});

test('switching pet names uses current identity and keeps owner rolls separate', async ({ extension }) => {
    const { sheet, roll20, openSheet } = extension;
    await openSheet('familiar');
    await sheet.locator('#selected-pet').evaluate(el => { el.textContent = 'Second Test Familiar'; });
    await sheet.locator('#pet-acrobatics .section-skill-total').click();
    await sheet.locator('#fortitude .section-skill-total').click();
    await expect(roll20.locator('#chat article')).toHaveCount(2);
    await expect(roll20.locator('#chat article').nth(0)).toContainText('AgentTesting - Second Test Familiar - Acrobatics');
    await expect(roll20.locator('#chat article').nth(1)).toContainText('{{name=AgentTesting - Fortitude}}');
});

for (const initial of [null, '0', '']) {
    test(`initiative ${JSON.stringify(initial)} persists across other client and reload`, async ({ extension }) => {
        const { sheet, roll20, state, otherClient } = extension;
        state.turnorder = JSON.stringify([
            { id: '-1', custom: 'Round', pr: '30', formula: '1' },
            ...(initial === null ? [] : [{ id: 'agent-token', pr: initial, custom: '', formula: '-1' }])
        ]);
        await roll20.reload();
        await roll20.evaluate(() => window.fixtureReady);
        await sheet.locator('#initiative .section-skill-total').click();
        await expect(roll20.locator('#chat article')).toHaveCount(1);
        await expect(roll20.locator('script[data-path-to-roll="initiative-bridge"]')).toHaveAttribute('data-loaded', 'true');
        const card = await roll20.locator('#chat article').innerText();
        const total = card.match(/\{\{roll=\[\[(\d+)\]\]\}\}/)[1];
        if (initial === null) {
            await expect(roll20.locator('#path-to-roll-initiative-status')).toContainText('waiting up to 60s');
            expect(JSON.parse(state.turnorder).some(turn => turn.id === 'agent-token')).toBe(false);
            await roll20.clock.runFor(5000);
            await roll20.locator('#add-agent').click();
            await expect(roll20.locator('#add-agent')).toHaveAttribute('data-saved', 'true');
            await roll20.clock.runFor(1000);
        }
        await expect.poll(() => JSON.parse(state.turnorder).find(turn => turn.id === 'agent-token')?.pr).toBe(total);
        const other = await otherClient();
        await expect(other.locator('[data-id="agent-token"]')).toHaveText('AgentTesting: ' + total);
        await other.locator('#other-save').click();
        await expect(other.locator('#other-save')).toHaveAttribute('data-saved', 'true');
        await roll20.reload();
        await roll20.evaluate(() => window.fixtureReady);
        await expect(roll20.locator('[data-id="agent-token"]')).toHaveText('AgentTesting: ' + total);
        await expect(roll20.locator('[data-id="other-token"]')).toHaveText('other-token: 21');
        expect(JSON.parse(state.turnorder).find(turn => turn.id === '-1')).toEqual({ id: '-1', custom: 'Round', pr: '30', formula: '1' });

        // Reroll with a changed modifier so the latest result must differ; do
        // not control Math.random in the extension's isolated JavaScript world.
        await sheet.locator('#initiative .section-skill-total').evaluate(el => { el.textContent = '+30'; });
        await sheet.locator('#initiative .section-skill-total').click();
        await expect(roll20.locator('#chat article')).toHaveCount(1);
        const reroll = (await roll20.locator('#chat article').innerText()).match(/\{\{roll=\[\[(\d+)\]\]\}\}/)[1];
        expect(Number(reroll)).toBeGreaterThan(Number(total));
        await expect.poll(() => JSON.parse(state.turnorder).find(turn => turn.id === 'agent-token')?.pr).toBe(reroll);
        await other.locator('#other-priority').fill('24');
        await other.locator('#other-save').click();
        await expect.poll(() => JSON.parse(state.turnorder).find(turn => turn.id === 'other-token')?.pr).toBe('24');
        await roll20.reload();
        await roll20.evaluate(() => window.fixtureReady);
        await expect(roll20.locator('[data-id="agent-token"]')).toHaveCount(1);
        await expect(roll20.locator('[data-id="agent-token"]')).toHaveText('AgentTesting: ' + reroll);
    });
}

test('pending initiative expires after 60s and never applies to a late DM entry', async ({ extension }) => {
    const { sheet, roll20, state } = extension;
    await sheet.locator('#initiative .section-skill-total').click();
    await expect(roll20.locator('#path-to-roll-initiative-status')).toContainText('waiting up to 60s');
    expect(state.turnorder).toBe('[]');
    await roll20.clock.runFor(60000);
    await expect(roll20.locator('#path-to-roll-initiative-status')).toContainText('expired');
    await roll20.locator('#add-agent').click();
    await expect(roll20.locator('#add-agent')).toHaveAttribute('data-saved', 'true');
    await roll20.clock.runFor(1000);
    expect(JSON.parse(state.turnorder).find(turn => turn.id === 'agent-token').pr).toBe('0');
});

test('newer pending roll wins and unrelated client changes are preserved', async ({ extension }) => {
    const { sheet, roll20, state, otherClient } = extension;
    await sheet.locator('#initiative .section-skill-total').click();
    await expect(roll20.locator('#path-to-roll-initiative-status')).toContainText('waiting up to 60s');
    await roll20.clock.runFor(45000);
    await sheet.locator('#initiative .section-skill-total').evaluate(el => { el.textContent = '+30'; });
    await sheet.locator('#initiative .section-skill-total').click();
    await expect(roll20.locator('#chat article')).toHaveCount(2);
    const latest = (await roll20.locator('#chat article').last().innerText()).match(/\{\{roll=\[\[(\d+)\]\]\}\}/)[1];
    const other = await otherClient();
    await other.locator('#other-priority').fill('42');
    await other.locator('#other-save').click();
    await expect(other.locator('#other-save')).toHaveAttribute('data-saved', 'true');
    await roll20.clock.runFor(16000); // Original deadline passed; new roll is valid.
    await roll20.locator('#add-agent').click();
    await expect(roll20.locator('#add-agent')).toHaveAttribute('data-saved', 'true');
    await roll20.clock.runFor(1000);
    await expect.poll(() => JSON.parse(state.turnorder).find(turn => turn.id === 'agent-token')?.pr).toBe(latest);
    expect(JSON.parse(state.turnorder).find(turn => turn.id === 'other-token').pr).toBe('42');
    await roll20.clock.runFor(61000);
    expect(JSON.parse(state.turnorder).filter(turn => turn.id === 'agent-token')).toHaveLength(1);
    expect(JSON.parse(state.turnorder).find(turn => turn.id === 'agent-token').pr).toBe(latest);
});
