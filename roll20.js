// Log that the script has loaded
console.log('Roll20 helper script loaded');

const INITIATIVE_REQUEST_EVENT = 'path-to-roll:add-initiative';
const INITIATIVE_RESULT_EVENT = 'path-to-roll:add-initiative:result';
let initiativeBridgeInjected = false;

function injectInitiativeBridge() {
    if (initiativeBridgeInjected) return;

    const existingBridge = document.querySelector('script[data-path-to-roll="initiative-bridge"]');
    if (existingBridge) {
        initiativeBridgeInjected = true;
        return;
    }

    const script = document.createElement('script');
    script.dataset.pathToRoll = 'initiative-bridge';
    script.textContent = `
(() => {
    if (window.__pathToRollInitiativeBridgeInstalled) return;
    window.__pathToRollInitiativeBridgeInstalled = true;

    const normalize = (value) => (value || '').toString().trim().toLowerCase();

    const parseModifier = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        const text = (value || '').toString().trim();
        const parsed = Number.parseInt(text, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    };

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

        try {
            const activePage = window.d20?.Campaign?.activePage?.();
            if (activePage) pages.push(activePage);
        } catch (error) {
            // ignore
        }

        try {
            const campaign = window.Campaign?.();
            const playerPageId = campaign?.get?.('playerpageid');
            const allPages = window.d20?.Campaign?.pages?.models;

            if (playerPageId && Array.isArray(allPages)) {
                const playerPage = allPages.find(page => {
                    if (!page) return false;
                    const id = page.id || page.get?.('id') || page.get?.('_id');
                    return id === playerPageId;
                });

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

                    const tokenId = model?.id || model?.get?.('_id') || model?.get?.('id');
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
        const campaign = window.Campaign?.();
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
            custom: ''
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

        // If available, set the initiative page so tracker is associated with this page.
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

    window.addEventListener('${INITIATIVE_REQUEST_EVENT}', (event) => {
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

        window.dispatchEvent(new CustomEvent('${INITIATIVE_RESULT_EVENT}', {
            detail: { requestId, result }
        }));
    });
})();
`;

    (document.head || document.documentElement).appendChild(script);
    script.remove();
    initiativeBridgeInjected = true;
}

function addInitiativeToTracker(initiativePayload) {
    injectInitiativeBridge();

    return new Promise((resolve) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const onResult = (event) => {
            const detail = event?.detail;
            if (!detail || detail.requestId !== requestId) return;

            window.removeEventListener(INITIATIVE_RESULT_EVENT, onResult);
            clearTimeout(timeoutId);
            resolve(detail.result || { success: false, error: 'No result payload from initiative bridge' });
        };

        const timeoutId = setTimeout(() => {
            window.removeEventListener(INITIATIVE_RESULT_EVENT, onResult);
            resolve({ success: false, error: 'Timed out while updating initiative tracker' });
        }, 2000);

        window.addEventListener(INITIATIVE_RESULT_EVENT, onResult);

        window.dispatchEvent(new CustomEvent(INITIATIVE_REQUEST_EVENT, {
            detail: {
                requestId,
                payload: initiativePayload
            }
        }));
    });
}

// Listen for messages from the Pathbuilder page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message in Roll20:', message);

    if (message.type === 'PING') {
        // Respond to ping messages to verify the content script is loaded
        sendResponse({ status: 'ok' });
        return true;
    }

    if (message.type === 'ROLL_STRING') {
        console.log('Processing roll string:', message.rollString);

        // Try to find the chat input
        const chatInput = document.querySelector("#textchat-input > textarea");
        console.log('Found chat input:', !!chatInput);

        if (chatInput) {
            try {
                // Set the value and trigger an input event
                chatInput.value = message.rollString;
                console.log('Set chat input value to:', message.rollString);

                // Verify the value was set
                if (chatInput.value !== message.rollString) {
                    console.warn('Failed to set chat input value');
                    sendResponse({ success: false, error: 'Failed to set input value' });
                    return true;
                }

                // Create and dispatch the input event
                const inputEvent = new Event('input', { bubbles: true });
                chatInput.dispatchEvent(inputEvent);
                console.log('Dispatched input event');

                // Focus the input
                chatInput.focus();
                console.log('Focused chat input');

                // Try to submit the roll
                const sendButton = document.querySelector("#chatSendBtn");
                if (sendButton) {
                    console.log('Found send button, clicking it');
                    sendButton.click();
                } else {
                    // If no button, try pressing Enter
                    console.log('No send button found, simulating Enter key');
                    chatInput.dispatchEvent(new KeyboardEvent('keypress', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true
                    }));
                }

                // Optionally update initiative tracker if this roll is an initiative roll
                if (message?.initiative?.enabled) {
                    addInitiativeToTracker(message.initiative)
                        .then((initiativeResult) => {
                            if (!initiativeResult?.success) {
                                console.warn('Failed to update initiative tracker:', initiativeResult?.error);
                            } else {
                                console.log('Initiative tracker updated:', initiativeResult);
                            }

                            sendResponse({
                                success: true,
                                initiative: initiativeResult
                            });
                        })
                        .catch((error) => {
                            console.warn('Initiative tracker update threw an error:', error);
                            sendResponse({
                                success: true,
                                initiative: {
                                    success: false,
                                    error: error?.message || String(error)
                                }
                            });
                        });

                    return true;
                }

                sendResponse({ success: true });
            } catch (error) {
                console.error('Error while setting roll string:', error);
                sendResponse({ success: false, error: error.message });
            }
        } else {
            console.warn('Chat input not found. Available textareas:',
                document.querySelectorAll('textarea').length);
            sendResponse({ success: false, error: 'Chat input not found' });
        }
    } else {
        console.log('Unknown message type:', message.type);
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep the message channel open for async responses
});
