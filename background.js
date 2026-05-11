// Listen for messages from Pathbuilder
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message);

    if (message.type === 'ROLL_STRING') {
        // Find Roll20 tabs - specifically the game editor
        chrome.tabs.query({}, (tabs) => {
            const isRoll20GameTab = (url = '') => {
                try {
                    const parsed = new URL(url);
                    return parsed.hostname === 'app.roll20.net' && /^\/editor(?:\/|$)/.test(parsed.pathname);
                } catch {
                    return false;
                }
            };

            // Filter for Roll20 game tabs specifically
            const roll20Tabs = tabs.filter(tab => {
                const url = tab.url || '';
                console.log('Checking tab:', { id: tab.id, url });
                return isRoll20GameTab(url);
            });

            console.log('Found Roll20 game tabs:', roll20Tabs);

            if (roll20Tabs.length === 1) {
                // Forward the message to Roll20
                const gameTab = roll20Tabs[0];
                console.log('Sending to Roll20 game tab:', gameTab.id);

                chrome.tabs.sendMessage(gameTab.id, message)
                    .then(response => {
                        console.log('Roll20 response:', response);
                        sendResponse(response);
                    })
                    .catch(error => {
                        console.error('Error sending to Roll20:', error);
                        sendResponse({ success: false, error: error.message });
                    });
            } else if (roll20Tabs.length > 1) {
                console.log('Multiple game tabs found:', roll20Tabs.length);
                sendResponse({ success: false, error: 'Multiple Roll20 game tabs open' });
            } else {
                console.log('No game tabs found');
                sendResponse({ success: false, error: 'No Roll20 game tab found' });
            }
        });
        return true; // Keep the message channel open
    }
});
