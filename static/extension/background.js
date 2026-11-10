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
  if (!r.ok) { const e = new Error(v.error || `Job Hunt said ${r.status}.`); e.data = v; throw e; }
  return v;
}
// Which Job Hunt wrote these files (filled in when Job Hunt writes the extension's folder). Job Hunt
// rewrites the folder when it updates; an extension older than the app reloads itself from there,
// once per version. Still older after that: it was loaded from another folder (an old download).
const BUILT = '__JH_VERSION__';
async function checkVersion() {
  let v;
  try { v = await ask('/ext/ping'); } catch (e) { return { ok: true }; }
  if (!v.version || !/^\d/.test(BUILT) || v.version === BUILT) {
    await chrome.storage.local.remove('stale');
    return { ok: true };
  }
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
  if (reloadedFor === v.version) {
    const stale = { version: v.version, built: BUILT, folder: v.folder || '' };
    await chrome.storage.local.set({ stale });
    return { stale };
  }
  await chrome.storage.local.set({ reloadedFor: v.version });
  setTimeout(() => chrome.runtime.reload(), 400);
  return { updating: v.version };
}
chrome.runtime.onStartup.addListener(() => { checkVersion(); });
chrome.runtime.onInstalled.addListener(() => { checkVersion(); });
const run = (tabId, func, args) => chrome.scripting.executeScript({ target: { tabId }, func, args });
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.check) {
    checkVersion().then(reply, () => reply({ ok: true }));
    return true;
  }
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
      .catch(e => e.data && e.data.choose
        // Job Hunt can't tell which application this is: the panel lists them to choose from.
        ? run(tabId, (m, l) => window.__jobhunt && window.__jobhunt.choose(m, l), [e.message, e.data.choose])
        : run(tabId, m => window.__jobhunt && window.__jobhunt.failed(m), ['Couldn\'t fill it in: ' + e.message]));
  } else if (kind === 'pick') {
    ask('/ext/pick', data)
      .then(() => run(tabId, () => window.__jobhunt && window.__jobhunt.start(), []))
      .catch(e => run(tabId, m => window.__jobhunt && window.__jobhunt.failed(m), ['Couldn\'t choose it: ' + e.message]));
  } else if (kind === 'salary' || kind === 'dismiss') {
    ask('/ext/' + kind, data).catch(() => {});
  } else if (kind === 'learn') {
    ask('/ext/learn', data).catch(() => {});
  } else if (kind === 'applied') {
    ask('/ext/applied', data).catch(() => {});
  }
});
