document.addEventListener('DOMContentLoaded', function() {
    // Initialize the checkboxes state from storage
    chrome.storage.sync.get(['blockTinting', 'copyToClipboard'], function(result) {
        const blockTintingCheckbox = document.getElementById('block-tinting');
        const copyToClipboardCheckbox = document.getElementById('copy-to-clipboard');

        // Default blockTinting to true if not set
        blockTintingCheckbox.checked = result.blockTinting !== false;
        // Default copyToClipboard to false if not set
        copyToClipboardCheckbox.checked = result.copyToClipboard === true;
    });

    // Save checkbox state changes
    document.getElementById('block-tinting').addEventListener('change', function(e) {
        chrome.storage.sync.set({ blockTinting: e.target.checked });
        // Notify content script of the change
        chrome.tabs.query({url: "https://pathbuilder2e.com/*"}, function(tabs) {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'UPDATE_TINTING',
                    blockTinting: e.target.checked
                });
            });
        });
    });

    document.getElementById('copy-to-clipboard').addEventListener('change', function(e) {
        chrome.storage.sync.set({ copyToClipboard: e.target.checked });
    });
});

// Check status of Pathbuilder and Roll20 tabs
chrome.tabs.query({}, async (tabs) => {
    const pathbuilderButton = document.getElementById('pathbuilder-button');
    const pathbuilderText = document.getElementById('pathbuilder-text');
    const roll20Button = document.getElementById('roll20-button');
    const roll20Text = document.getElementById('roll20-text');
    const isRoll20GameTab = (url = '') => {
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'app.roll20.net' && /^\/editor(?:\/|$)/.test(parsed.pathname);
        } catch {
            return false;
        }
    };

    // Check for Pathbuilder tabs
    const hasPathbuilderTab = tabs.some(tab => tab.url.includes('pathbuilder2e.com'));

    // Update Pathbuilder status
    if (hasPathbuilderTab) {
        pathbuilderButton.classList.add('active');
        pathbuilderButton.title = 'Pathbuilder page detected';
        pathbuilderText.textContent = 'Page is open';
    } else {
        pathbuilderButton.classList.remove('active');
        pathbuilderButton.title = 'No Pathbuilder page found';
        pathbuilderText.textContent = 'No page open';
    }

    // Check for Roll20 tabs
    const roll20Tabs = tabs.filter(tab => isRoll20GameTab(tab.url || ''));
    const roll20Count = roll20Tabs.length;

    // Update Roll20 status based on both presence and connection
    if (roll20Count === 0) {
        roll20Button.classList.remove('active', 'warning');
        roll20Button.title = 'No Roll20 page found';
        roll20Text.textContent = 'No page open';
    } else if (roll20Count === 1) {
        // Test if content script is responsive
        try {
            const response = await chrome.tabs.sendMessage(roll20Tabs[0].id, { type: 'PING' });
            if (response && response.status === 'ok') {
                roll20Button.classList.add('active');
                roll20Button.classList.remove('warning');
                roll20Button.title = 'Roll20 page connected';
                roll20Text.textContent = 'Connected';
            } else {
                roll20Button.classList.remove('active', 'warning');
                roll20Button.title = 'Roll20 page not ready';
                roll20Text.textContent = 'Not ready';
            }
        } catch (error) {
            roll20Button.classList.remove('active', 'warning');
            roll20Button.title = 'Roll20 page not ready';
            roll20Text.textContent = 'Not ready';
        }
    } else {
        roll20Button.classList.add('warning');
        roll20Button.classList.remove('active');
        roll20Button.title = 'Multiple Roll20 pages detected';
        roll20Text.textContent = 'Multiple pages';
    }
});
