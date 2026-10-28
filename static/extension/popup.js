// Read the posting in the open tab with Job Hunt's own reader (clip.js, the same code as the
// bookmark), and put it on the clipboard: the Job Hunt app picks it up from there.
const say = (what, more, bad) => {
  document.getElementById('what').textContent = what;
  document.getElementById('more').textContent = more || '';
  document.body.className = bad ? 'bad' : '';
};
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) return say('Open a job posting first', 'Then press this button on its page.', true);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['clip.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => clipPage(true) });
    if (!result) return say("Couldn't read this page", 'Select the posting\'s text and press the button again.', true);
    await navigator.clipboard.writeText(result);
    const c = JSON.parse(result.slice(result.indexOf(':') + 1));
    say('Sent to Job Hunt', `${c.title || tab.title}${c.company ? ` at ${c.company}` : ''}. Job Hunt picks it up in a few seconds; with Job Hunt in a browser, paste it on its Add a job page.`);
  } catch (e) {
    say("Couldn't send it", String(e.message || e), true);
  }
})();
