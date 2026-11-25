// Clicking the toolbar button opens the side panel. The keyboard shortcut and
// the right-click item only open the panel and leave it a note of what was
// asked; the panel does the work, since it alone holds the key Job Hunt knows.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(details => {
  chrome.contextMenus.create({ id: 'fill-one', title: 'Job Hunt: fill this in', contexts: ['editable'] }, () => void chrome.runtime.lastError);
  // Updated itself from Job Hunt's folder: NEW on the button until the panel is opened.
  const now = chrome.runtime.getManifest().version;
  if (details && details.reason === 'update' && details.previousVersion && details.previousVersion !== now) {
    chrome.action.setBadgeText({ text: 'NEW' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#2B5BD7' }).catch(() => {});
    chrome.storage.local.set({ updatedFrom: details.previousVersion }).catch(() => {});
  }
});

function hand(todo, tab) {
  // Opening the panel has to be the first thing done with the person's key press or click.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  chrome.storage.session.set({ todo }).then(() => chrome.runtime.sendMessage({ jobhunt: 'todo' })).catch(() => {});
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'fill-form' && tab) hand({ what: 'fill', tabId: tab.id, at: Date.now() }, tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'fill-one' || !tab) return;
  hand({ what: 'one', tabId: tab.id, frameId: info.frameId || 0, at: Date.now() }, tab);
  // Mark the field that was right-clicked (it has the focus), so the panel fills that one.
  chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [info.frameId || 0] },
    func: () => {
      let a = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      if (a && a !== document.body) a.setAttribute('data-jobhunt-target', '1');
    },
  }).catch(() => {});
});
