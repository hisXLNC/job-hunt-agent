// Fill this form: the page's script (fill.js, the same one Job Hunt's Apply window runs) sends the
// form's questions here, this asks the Job Hunt app on this computer (127.0.0.1, with your key),
// and hands the answers and your files back to the page. Job Hunt never sees your other tabs.
const JOB_HUNT = 'http://127.0.0.1:47613';
async function ask(path, body) {
  const { key } = await chrome.storage.local.get('key');
  if (!key) throw new Error('Paste your Job Hunt key first: open this extension and follow the steps.');
  let r;
  try {
    r = await fetch(JOB_HUNT + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Job-Hunt-Key': key }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error('Job Hunt isn\'t running on this computer. Open it, then try again.');
  }
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(v.error || `Job Hunt said ${r.status}.`);
  return v;
}
const run = (tabId, func, args) => chrome.scripting.executeScript({ target: { tabId }, func, args });
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.popup) {
    // From the popup: check the key, or what Job Hunt knows about this page.
    ask(msg.popup, msg.body).then(v => reply({ ok: true, v }), e => reply({ ok: false, error: e.message }));
    return true;
  }
  const tabId = sender.tab && sender.tab.id;
  if (!msg.jobhunt || !tabId) return;
  const { jobhunt: kind, data } = msg;
  if (kind === 'fields') {
    ask('/ext/fill', data)
      .then(a => run(tabId, a => window.__jobhunt && window.__jobhunt.fill(a), [a]))
      .catch(e => run(tabId, m => window.__jobhunt && window.__jobhunt.failed(m), ['Couldn\'t fill it in: ' + e.message]));
  } else if (kind === 'learn') {
    ask('/ext/learn', data).catch(() => {});
  } else if (kind === 'applied') {
    ask('/ext/applied', data).catch(() => {});
  }
});
