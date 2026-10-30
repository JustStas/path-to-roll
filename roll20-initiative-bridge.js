(() => {
    if (window.__pathToRollInitiativeBridgeInstalled) return;
    window.__pathToRollInitiativeBridgeInstalled = true;

    const INITIATIVE_REQUEST_EVENT = 'path-to-roll:add-initiative';
    const INITIATIVE_RESULT_EVENT = 'path-to-roll:add-initiative:result';
    const INITIATIVE_STATUS_EVENT = 'path-to-roll:add-initiative:status';
    const PENDING_LIFETIME_MS = 60000;
    const POLL_INTERVAL_MS = 1000;
    // Pending work belongs to this page only: reload/pagehide cancels it.
    const pending = new Map();
    let timer = null;
    let listeningCampaign = null;
    let applying = 0;
    let stopped = false;

    const normalize = (value) => (value || '').toString().trim().toLowerCase();

    const parseModifier = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const text = (value || '').toString().trim();
        const parsed = Number.parseInt(text, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const getCampaign = () => {
        try {
            const campaignRef = window.Campaign;
            if (!campaignRef) return null;
            return typeof campaignRef === 'function' ? campaignRef() : campaignRef;
        } catch (error) {
            return null;
        }
    };

    const getD20Campaign = () => {
        try {
            const campaignRef = window.d20?.Campaign;
            if (!campaignRef) return null;
            return typeof campaignRef === 'function' ? campaignRef() : campaignRef;
        } catch (error) {
            return null;
        }
    };

    const getModelId = (model) => model?.id || model?.get?.('_id') || model?.get?.('id') || null;

    const listGraphics = (page) => {
        if (!page) return [];

        const graphics = page.thegraphics;
        if (!graphics) return [];

        if (Array.isArray(graphics.models)) return graphics.models;
        if (typeof graphics.models?.toArray === 'function') return graphics.models.toArray();
        return [];
    };

    const getActivePages = (campaign) => {
        const pages = [];
        const d20Campaign = getD20Campaign();
        const activePage =
            (typeof campaign.activePage === 'function' ? campaign.activePage() : null)
            || (typeof d20Campaign?.activePage === 'function' ? d20Campaign.activePage() : null);
        if (activePage) pages.push(activePage);

        const playerPageId = campaign.get('playerpageid');
        const allPages = campaign.pages?.models || d20Campaign?.pages?.models || [];
        if (playerPageId && Array.isArray(allPages)) {
            const playerPage = allPages.find(page => getModelId(page) === playerPageId);
            if (playerPage && !pages.includes(playerPage)) pages.push(playerPage);
        }
        return pages;
    };

    const findTokenByName = (campaign, characterName) => {
        const targetName = normalize(characterName);
        const matches = new Map();
        for (const page of getActivePages(campaign)) {
            for (const model of listGraphics(page)) {
                const subtype = model?.get?.('_subtype') || model?.attributes?._subtype;
                if (subtype && subtype !== 'token') continue;
                const isDrawing = model?.get?.('isdrawing') || model?.attributes?.isdrawing;
                if (isDrawing) continue;
                const tokenName = model?.get?.('name') || model?.attributes?.name || '';
                if (normalize(tokenName) !== targetName) continue;
                const tokenId = getModelId(model);
                if (!tokenId || tokenId === '-1') continue;
                matches.set(tokenId, {
                    id: tokenId,
                    name: tokenName,
                    pageId: model?.get?.('_pageid') || model?.attributes?._pageid || null
                });
            }
        }
        return matches.size === 1 ? matches.values().next().value : null;
    };

    const readTurnOrder = (campaign) => {
        const raw = campaign.get('turnorder');
        if (!raw || raw === '') return [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (error) {
            // A malformed tracker must never be replaced with an empty one.
        }
        throw new Error('Invalid Roll20 turn order');
    };

    const tryApply = (entry) => {
        applying++;
        try {
            if (pending.get(entry.key) !== entry) return { status: 'superseded' };
            if (Date.now() >= entry.expiresAt) return { status: 'expired' };
            const campaign = getCampaign();
            if (entry.campaign && entry.campaign !== campaign) throw new Error('Roll20 campaign changed');
            if (typeof campaign?.get !== 'function'
                || typeof campaign?.set !== 'function'
                || typeof campaign?.save !== 'function') {
                throw new Error('Campaign API unavailable');
            }
            entry.campaign = campaign;
            // Validate even while the token is absent so malformed data/API
            // failures terminate instead of leaving a stale retry behind.
            readTurnOrder(campaign);
            const token = findTokenByName(campaign, entry.characterName);
            if (!token) return { status: 'waiting' };
            if (entry.tokenId && entry.tokenId !== token.id) return { status: 'waiting' };
            entry.tokenId = token.id;

            // Resolve first, then read fresh shared model state immediately
            // before changing only the existing target's priority.
            const turns = readTurnOrder(campaign);
            const matches = turns.filter(turn => turn && turn.id === token.id);
            if (matches.length !== 1) return { status: 'waiting' };
            if (getCampaign() !== campaign) throw new Error('Roll20 campaign changed');
            if (Date.now() >= entry.expiresAt) return { status: 'expired' };
            if (pending.get(entry.key) !== entry) return { status: 'superseded' };
            const nextTurns = turns.map(turn => turn === matches[0]
                ? { ...turn, pr: String(entry.total) }
                : turn);
            nextTurns.sort((a, b) => (Number.parseFloat(b?.pr) || 0) - (Number.parseFloat(a?.pr) || 0));
            campaign.set('turnorder', JSON.stringify(nextTurns));
            if (pending.get(entry.key) !== entry) return { status: 'superseded' };
            if (token.pageId) {
                try {
                    campaign.set('initiativepage', token.pageId);
                } catch (error) {
                    // Some Roll20 contexts do not expose initiativepage.
                }
            }
            // set() updates this client; save() persists for other clients.
            if (campaign.save() === false) throw new Error('Failed to save Roll20 turn order');
            return { status: 'applied', token };
        } catch (error) {
            return { status: 'failed', error: error?.message || String(error) };
        } finally {
            applying--;
        }
    };

    const emitStatus = (entry, status, error) => {
        window.dispatchEvent(new CustomEvent(INITIATIVE_STATUS_EVENT, {
            detail: {
                characterName: entry.characterName,
                total: entry.total,
                status,
                ...(error ? { error } : {})
            }
        }));
    };

    const disconnectCampaign = () => {
        if (!listeningCampaign) return;
        try {
            listeningCampaign.off('change:turnorder', flushPending);
        } catch (error) {
            // Cleanup must still release the local reference and timer.
        }
        listeningCampaign = null;
    };

    const syncRuntime = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        if (stopped || pending.size === 0) {
            disconnectCampaign();
            return;
        }
        const campaign = getCampaign();
        if (campaign !== listeningCampaign) {
            disconnectCampaign();
            if (typeof campaign?.on === 'function' && typeof campaign?.off === 'function') {
                try {
                    campaign.on('change:turnorder', flushPending);
                    listeningCampaign = campaign;
                } catch (error) {
                    // Model events are optional; the bounded poll remains.
                }
            }
        }
        let delay = POLL_INTERVAL_MS;
        for (const entry of pending.values()) {
            delay = Math.min(delay, Math.max(0, entry.expiresAt - Date.now()));
        }
        timer = window.setTimeout(() => {
            timer = null;
            flushPending();
        }, delay);
    };

    function flushPending() {
        if (stopped || applying) return;
        for (const [key, entry] of [...pending]) {
            if (pending.get(key) !== entry) continue;
            const result = tryApply(entry);
            if (result.status !== 'waiting' && pending.get(key) === entry) {
                // Remove before dispatch: model/status handlers may reenter.
                pending.delete(key);
                emitStatus(entry, result.status, result.error);
            }
        }
        syncRuntime();
    }

    const addInitiative = (payload = {}) => {
        const characterName = (payload.characterName || '').toString().trim();
        if (!characterName) return { success: false, error: 'Missing character name' };
        if (stopped) return { success: false, error: 'Roll20 page is unloading' };
        const modifier = parseModifier(payload.modifier);
        const providedD20 = Number.parseInt(payload.d20, 10);
        const providedTotal = Number.parseInt(payload.total, 10);
        const roll = Number.isFinite(providedD20) ? providedD20 : Math.floor(Math.random() * 20) + 1;
        const total = Number.isFinite(providedTotal) ? providedTotal : roll + modifier;
        const key = normalize(characterName);
        const previous = pending.get(key);
        const entry = { key, characterName, roll, modifier, total, expiresAt: Date.now() + PENDING_LIFETIME_MS };
        // Reserve the newest request before notifications: a status listener
        // can synchronously submit another roll, which must retain ownership.
        pending.set(key, entry);
        if (previous) emitStatus(previous, 'superseded');
        const result = tryApply(entry);
        if (result.status !== 'waiting' && pending.get(key) === entry) pending.delete(key);
        syncRuntime();
        if (result.status === 'superseded') {
            return { success: false, error: 'Initiative roll superseded by a newer roll' };
        }
        if (result.status === 'failed') return { success: false, error: result.error };
        if (result.status === 'expired') return { success: false, error: 'Initiative roll expired' };
        const response = { success: true, characterName, roll, modifier, total };
        if (result.status === 'waiting') {
            return { ...response, pending: true, expiresInMs: PENDING_LIFETIME_MS };
        }
        return { ...response, tokenName: result.token.name, tokenId: result.token.id };
    };

    window.addEventListener('pagehide', () => {
        stopped = true;
        pending.clear();
        syncRuntime();
    });

    window.addEventListener(INITIATIVE_REQUEST_EVENT, (event) => {
        const detail = event?.detail || {};
        const requestId = detail.requestId;

        let result;
        try {
            result = addInitiative(detail.payload || {});
        } catch (error) {
            result = {
                success: false,
                error: error?.message || String(error)
            };
        }

        window.dispatchEvent(new CustomEvent(INITIATIVE_RESULT_EVENT, {
            detail: { requestId, result }
        }));
    });
})();
