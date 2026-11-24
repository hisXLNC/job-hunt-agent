// Clicking the toolbar button opens the side panel. Nothing else runs here.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
