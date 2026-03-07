(() => {
    if (window.__pathToRollInitiativeBridgeInstalled) return;
    window.__pathToRollInitiativeBridgeInstalled = true;

    const INITIATIVE_REQUEST_EVENT = 'path-to-roll:add-initiative';
    const INITIATIVE_RESULT_EVENT = 'path-to-roll:add-initiative:result';

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

    const getActivePages = () => {
        const pages = [];

        const campaign = getCampaign();
        const d20Campaign = getD20Campaign();

        try {
            const activePage =
                (typeof campaign?.activePage === 'function' ? campaign.activePage() : null)
                || (typeof d20Campaign?.activePage === 'function' ? d20Campaign.activePage() : null);

            if (activePage) pages.push(activePage);
        } catch (error) {
            // ignore
        }

        try {
            const playerPageId = campaign?.get?.('playerpageid');
            const allPages = campaign?.pages?.models || d20Campaign?.pages?.models || [];

            if (playerPageId && Array.isArray(allPages)) {
                const playerPage = allPages.find(page => getModelId(page) === playerPageId);

                if (playerPage && !pages.includes(playerPage)) {
                    pages.push(playerPage);
                }
            }
        } catch (error) {
            // ignore
        }

        return pages;
    };

    const findTokenByName = (characterName) => {
        const targetName = normalize(characterName);
        if (!targetName) return null;

        const pages = getActivePages();
        for (const page of pages) {
            const graphics = listGraphics(page);
            for (const model of graphics) {
                try {
                    const subtype = model?.get?.('_subtype') || model?.attributes?._subtype;
                    if (subtype && subtype !== 'token') continue;

                    const isDrawing = model?.get?.('isdrawing') || model?.attributes?.isdrawing;
                    if (isDrawing) continue;

                    const tokenName = model?.get?.('name') || model?.attributes?.name || '';
                    if (normalize(tokenName) !== targetName) continue;

                    const tokenId = getModelId(model);
                    if (!tokenId) continue;

                    return {
                        id: tokenId,
                        name: tokenName,
                        pageId: model?.get?.('_pageid') || model?.attributes?._pageid || null
                    };
                } catch (error) {
                    // ignore this token and continue
                }
            }
        }

        return null;
    };

    const updateTurnOrder = (tokenId, total, pageId) => {
        const campaign = getCampaign();
        if (!campaign?.get || !campaign?.set) {
            return { ok: false, error: 'Campaign API unavailable' };
        }

        let turnOrder = [];
        const rawTurnOrder = campaign.get('turnorder');

        if (rawTurnOrder && rawTurnOrder !== '') {
            try {
                const parsed = JSON.parse(rawTurnOrder);
                if (Array.isArray(parsed)) {
                    turnOrder = parsed;
                }
            } catch (error) {
                // ignore parse errors and reset turn order
            }
        }

        const existingIndex = turnOrder.findIndex(entry => entry && entry.id === tokenId);
        const entry = {
            id: tokenId,
            pr: String(total),
            custom: '',
            ...(pageId ? { _pageid: pageId } : {})
        };

        if (existingIndex >= 0) {
            turnOrder[existingIndex] = {
                ...turnOrder[existingIndex],
                ...entry
            };
        } else {
            turnOrder.push(entry);
        }

        turnOrder.sort((a, b) => (Number.parseFloat(b?.pr) || 0) - (Number.parseFloat(a?.pr) || 0));
        campaign.set('turnorder', JSON.stringify(turnOrder));

        if (pageId) {
            try {
                campaign.set('initiativepage', pageId);
            } catch (error) {
                // ignore if unavailable in this context
            }
        }

        return { ok: true };
    };

    const addInitiative = (payload = {}) => {
        const characterName = (payload.characterName || '').toString().trim();
        if (!characterName) {
            return { success: false, error: 'Missing character name' };
        }

        const token = findTokenByName(characterName);
        if (!token) {
            return {
                success: false,
                error: 'No token with matching name found on the active Roll20 page',
                characterName
            };
        }

        const modifier = parseModifier(payload.modifier);

        const providedD20 = Number.parseInt(payload.d20, 10);
        const providedTotal = Number.parseInt(payload.total, 10);

        const roll = Number.isFinite(providedD20)
            ? providedD20
            : Math.floor(Math.random() * 20) + 1;

        const total = Number.isFinite(providedTotal)
            ? providedTotal
            : (roll + modifier);

        const turnOrderResult = updateTurnOrder(token.id, total, token.pageId);
        if (!turnOrderResult.ok) {
            return { success: false, error: turnOrderResult.error };
        }

        return {
            success: true,
            characterName,
            tokenName: token.name,
            tokenId: token.id,
            roll,
            modifier,
            total
        };
    };

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
