// Log that the script has loaded
console.log('Roll20 helper script loaded');

const INITIATIVE_REQUEST_EVENT = 'path-to-roll:add-initiative';
const INITIATIVE_RESULT_EVENT = 'path-to-roll:add-initiative:result';
let initiativeBridgeReadyPromise = null;

function ensureInitiativeBridge() {
    if (initiativeBridgeReadyPromise) {
        return initiativeBridgeReadyPromise;
    }

    initiativeBridgeReadyPromise = new Promise((resolve, reject) => {
        const existingBridge = document.querySelector('script[data-path-to-roll="initiative-bridge"]');

        if (existingBridge) {
            if (existingBridge.dataset.loaded === 'true') {
                resolve();
                return;
            }

            existingBridge.addEventListener('load', () => {
                existingBridge.dataset.loaded = 'true';
                resolve();
            }, { once: true });

            existingBridge.addEventListener('error', () => {
                reject(new Error('Failed to load initiative bridge script'));
            }, { once: true });

            return;
        }

        const script = document.createElement('script');
        script.dataset.pathToRoll = 'initiative-bridge';
        script.src = chrome.runtime.getURL('roll20-initiative-bridge.js');

        script.addEventListener('load', () => {
            script.dataset.loaded = 'true';
            resolve();
        }, { once: true });

        script.addEventListener('error', () => {
            reject(new Error('Failed to load initiative bridge script'));
        }, { once: true });

        (document.head || document.documentElement).appendChild(script);
    }).catch((error) => {
        // Allow retry on next request if loading failed.
        initiativeBridgeReadyPromise = null;
        throw error;
    });

    return initiativeBridgeReadyPromise;
}

function addInitiativeToTracker(initiativePayload) {
    return ensureInitiativeBridge().then(() => new Promise((resolve) => {
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
    }));
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
        const chatInput = document.querySelector('#textchat-input > textarea');
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
                const sendButton = document.querySelector('#chatSendBtn');
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
