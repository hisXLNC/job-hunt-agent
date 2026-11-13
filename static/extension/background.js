// The extension's background: the only part that talks to the Job Hunt app on this computer
// (127.0.0.1, with your key). The page's script (fill.js) and the popup ask through it. Job Hunt
// never sees your other tabs.
//
// A browser may stop this script whenever it is idle, and stops a request it has waited on for half
// a minute. So nothing here waits long or remembers anything it needs: every request to Job Hunt is
// short, with a time limit; answers that take Claude a while are asked for again and again by the
// page (see /ext/fill/start and /ext/fill/poll); and what happened is written down (the log) where
// it survives a restart, so a problem can be traced and, where it can, put right by itself.
const JOB_HUNT = 'http://127.0.0.1:47613';
// Which Job Hunt wrote these files (filled in when Job Hunt writes the extension's folder).
const BUILT = '__JH_VERSION__';

// --- the log: what happened, newest last (no answers or form contents: only what and when) ---
const KEEP = 400;
let events = null, saving = null;
const stored = () => (chrome.storage.session || chrome.storage.local);
async function logged() {
  if (!events) {
    try { events = (await stored().get('log')).log || []; } catch (e) { events = []; }
    events.push({ t: Date.now(), k: 'woke', m: `background started (${BUILT})` });
  }
  return events;
}
function log(k, m, d) {
  const e = { t: Date.now(), k, m: String(m || '').slice(0, 300) };
  if (d !== undefined) { try { e.d = JSON.parse(JSON.stringify(d, (key, v) => typeof v === 'string' ? v.slice(0, 200) : v)); } catch (err) { /* not worth a failure */ } }
  logged().then(l => {
    l.push(e);
    if (l.length > KEEP) l.splice(0, l.length - KEEP);
    clearTimeout(saving);
    saving = setTimeout(() => stored().set({ log: l }).catch(() => {}), 300);
  });
}
self.addEventListener('error', e => log('error', e.message, { at: `${e.filename}:${e.lineno}` }));
self.addEventListener('unhandledrejection', e => log('error', String(e.reason && e.reason.message || e.reason)));

// --- asking Job Hunt ---
// One request, never longer than `ms`. An error says why in `why`: 'key' (none saved), 'offline'
// (Job Hunt isn't answering), 'timeout', or 'http' (Job Hunt said no; its words are the message).
async function ask(path, body, ms = 15000) {
  const { key } = await chrome.storage.local.get('key');
  const fail = (why, message, data) => Object.assign(new Error(message), { why, data });
  if (!key) throw fail('key', 'Paste your Job Hunt key first: open this extension and follow the steps.');
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  let r;
  try {
    r = await fetch(JOB_HUNT + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Job-Hunt-Key': key }, body: body ? JSON.stringify(body) : undefined, signal: stop.signal });
  } catch (e) {
    throw stop.signal.aborted
      ? fail('timeout', 'Job Hunt took too long to answer.')
      : fail('offline', 'Job Hunt isn\'t running on this computer. Open it, then try again.');
  } finally { clearTimeout(timer); }
  const v = await r.json().catch(() => ({}));
  if (!r.ok) throw fail('http', v.error || `Job Hunt said ${r.status}.`, { ...v, status: r.status });
  return v;
}
// The same, tried again when Job Hunt didn't answer (it may be starting, or busy for a moment).
async function askAgain(path, body, tries = 3, ms) {
  for (let i = 0; ; i++) {
    try { return await ask(path, body, ms); }
    catch (e) {
      if (i + 1 >= tries || !['offline', 'timeout'].includes(e.why)) throw e;
      log('retry', `${path}: ${e.why}, trying again`);
      await new Promise(ok => setTimeout(ok, 700 * (i + 1)));
    }
  }
}
// As an answer to a message: { ok, v } or { ok: false, error, why, data }.
const answer = (reply, what, p) => p.then(
  v => { reply({ ok: true, v }); },
  e => { log('failed', `${what}: ${e.message}`, { why: e.why }); reply({ ok: false, error: String(e && e.message || e), why: e.why || 'error', data: e.data }); });

// --- keeping up with Job Hunt ---
// Job Hunt rewrites the extension's folder when it updates; an extension older than the app reloads
// itself from there, once per version. Still older after that: it was loaded from another folder.
async function checkVersion() {
  let v;
  try { v = await ask('/ext/ping', null, 5000); } catch (e) { return { ok: true }; }
  if (!v.version || !/^\d/.test(BUILT) || v.version === BUILT) {
    await chrome.storage.local.remove('stale');
    return { ok: true };
  }
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
  if (reloadedFor === v.version) {
    const stale = { version: v.version, built: BUILT, folder: v.folder || '' };
    await chrome.storage.local.set({ stale });
    log('stale', `Job Hunt is ${v.version}, this copy is ${BUILT} and a reload didn't change it`);
    return { stale };
  }
  await chrome.storage.local.set({ reloadedFor: v.version });
  log('update', `reloading to match Job Hunt ${v.version} (was ${BUILT})`);
  await stored().set({ log: await logged() }).catch(() => {});
  setTimeout(() => chrome.runtime.reload(), 400);
  return { updating: v.version };
}
chrome.runtime.onStartup.addListener(() => { checkVersion(); });
chrome.runtime.onInstalled.addListener(d => {
  checkVersion();
  // Updated (it reloads itself when Job Hunt updates): say so, once, and mark the icon until the
  // popup is opened.
  const now = chrome.runtime.getManifest().version;
  if (d.reason !== 'update' || !d.previousVersion || d.previousVersion === now) return;
  chrome.storage.local.set({ updated: { from: d.previousVersion, to: now } });
  chrome.action.setBadgeText({ text: 'NEW' });
  chrome.action.setBadgeBackgroundColor({ color: '#0B7A3B' });
  try {
    chrome.notifications.create('jobhunt-updated', {
      type: 'basic', iconUrl: 'icon-128.png', title: `Job Hunt extension updated to ${now}`,
      message: 'Reload any application form you have open (F5) before pressing Fill this form.',
    });
  } catch (e) { /* no notifications: the badge and the popup still say it */ }
});

// --- acting as you would, for the page ---
// Workday's skill list takes nothing else: real clicks, typing and keys through the browser's
// debugger, the one way an extension can. Which tabs it's on is asked of the browser each time
// (this script may have been restarted since it turned it on).
const letGo = new Map(); // tab -> the timer that lets it go
const attached = async tabId => (await chrome.debugger.getTargets()).some(t => t.tabId === tabId && t.attached);
// Turns it on for the tab; true when it has only just come on (the browser's "started debugging"
// bar then moves the page down, so the page waits before aiming a click).
async function debugOn(tabId) {
  const fresh = !(await attached(tabId));
  if (fresh) { await chrome.debugger.attach({ tabId }, '1.3'); log('debugger', 'on', { tabId }); }
  clearTimeout(letGo.get(tabId));
  // Kept on while the skills are chosen (a skill the site doesn't have takes several searches): off
  // two minutes after the last. Coming on again mid-list would move the page under the next click.
  letGo.set(tabId, setTimeout(() => debugOff(tabId), 120000));
  return fresh;
}
async function debugOff(tabId) {
  clearTimeout(letGo.get(tabId));
  letGo.delete(tabId);
  if (await attached(tabId).catch(() => false)) { await chrome.debugger.detach({ tabId }).catch(() => {}); log('debugger', 'off', { tabId }); }
}
// A command to the tab; when the debugger had come off underneath (the bar's Cancel, a page that
// reloaded), it's turned on and the command sent once more.
async function command(tabId, method, params) {
  await debugOn(tabId);
  try { return await chrome.debugger.sendCommand({ tabId }, method, params); }
  catch (e) {
    if (!/not attached|detached|no tab|target closed/i.test(String(e && e.message))) throw e;
    log('heal', `debugger had come off (${e.message}): turning it on again`, { tabId });
    await chrome.debugger.detach({ tabId }).catch(() => {});
    await chrome.debugger.attach({ tabId }, '1.3');
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }
}
async function realClick(tabId, x, y) {
  // The position is in the page's own (CSS) pixels, which is what the debugger takes: no scaling for
  // the browser's zoom (scaling it put clicks beside the skill at 90% or 110%).
  for (const [type, button] of [['mouseMoved', 'none'], ['mousePressed', 'left'], ['mouseReleased', 'left']]) {
    await command(tabId, 'Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
}
// Real typing into the box that has the focus, and real keys (Enter, the arrows, Escape).
const realType = (tabId, text) => command(tabId, 'Input.insertText', { text: String(text || '') });
const KEYS = { Enter: [13, '\r'], ArrowDown: [40], ArrowUp: [38], Escape: [27] };
async function realKey(tabId, key) {
  const k = KEYS[key];
  if (!k) throw new Error('No such key');
  const base = { key, code: key, windowsVirtualKeyCode: k[0], nativeVirtualKeyCode: k[0] };
  await command(tabId, 'Input.dispatchKeyEvent', { type: k[1] ? 'keyDown' : 'rawKeyDown', ...base, ...(k[1] ? { text: k[1], unmodifiedText: k[1] } : {}) });
  await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
chrome.debugger.onDetach.addListener((s, reason) => { if (s.tabId) { clearTimeout(letGo.get(s.tabId)); letGo.delete(s.tabId); log('debugger', `came off: ${reason}`, { tabId: s.tabId }); } });

// --- the page's script ---
const run = (tabId, func, args) => chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] });
// Start filling the form on a tab: its script is put there if it isn't (or if the one there is from
// before an update and can no longer reach this extension), then told to start.
async function startFill(tabId) {
  const mine = chrome.runtime.getManifest().version;
  const [{ result: there }] = await run(tabId, v => !!window.__jobhunt && window.__jobhunt.version === v && window.__jobhunt.alive(), [mine]);
  if (!there) {
    log('inject', 'putting the form filler on the page', { tabId });
    await run(tabId, () => { delete window.__jobhunt; });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['fill.js'] });
  }
  await run(tabId, () => window.__jobhunt && window.__jobhunt.start());
  // The site's next pages get the panel too, for twenty minutes (see below).
  try { const tab = await chrome.tabs.get(tabId); const site = new URL(tab.url).origin; const { armed = {} } = await stored().get('armed'); armed[tabId] = { site, until: Date.now() + 20 * 60 * 1000 }; await stored().set({ armed }); } catch (e) { /* no address to go by */ }
}
// A form that is several pages (a profile's list of jobs, then the page to add one; an application's
// steps that load afresh): once you've started Job Hunt on a tab, the pages that tab goes to on the
// same site get its panel by themselves, so there is always something to press. It fills by itself
// only the page it opened itself (pressing the site's Add for you); elsewhere it waits for you.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const { armed = {} } = await stored().get('armed');
  const a = armed[tabId];
  if (!a) return;
  let site = '';
  try { site = new URL(tab.url).origin; } catch (e) { /* the address isn't ours to see: another site */ }
  if (Date.now() > a.until || site !== a.site) { delete armed[tabId]; await stored().set({ armed }); return; }
  try {
    const [{ result: there }] = await run(tabId, () => !!window.__jobhunt);
    if (!there) { await chrome.scripting.executeScript({ target: { tabId }, files: ['fill.js'] }); log('inject', 'the next page of the same site', { tabId }); }
  } catch (e) { log('failed', `the next page: ${e.message}`, { tabId }); }
});
chrome.tabs.onRemoved.addListener(async tabId => { const { armed = {} } = await stored().get('armed'); if (armed[tabId]) { delete armed[tabId]; await stored().set({ armed }); } });
// Fill this form from the keyboard (Alt+Shift+F unless you changed it in the browser's extension
// shortcuts): the same as the popup's button, on the page you're looking at.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-form' || !tab || !tab.id) return;
  try { await startFill(tab.id); }
  catch (e) { log('failed', `shortcut: ${e.message}`); /* a page extensions can't run on (the browser's own pages, the web store) */ }
});

// --- leads ---
// Read the posts on a tab (clip.js's clipPosts) and send them to Job Hunt, which keeps the ones
// where someone says they're hiring. `chosen`: a page you picked yourself, kept whatever it says.
async function sendPosts(tabId, chosen) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['clip.js'] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => clipPosts() });
  if (!result || !result.posts.length) throw new Error(chosen ? 'Select the post\'s text on the page, then press this again.' : 'No posts found on this page. Scroll so some are showing, then press this again.');
  // One page you chose is kept whatever it says; a page of many is sieved for the hiring ones. Claude
  // reads them, which can take a while: Job Hunt is given two minutes.
  const r = await ask('/ext/leads', { posts: result.posts, chosen: !!chosen && !result.many }, 120000);
  return { ...r, many: result.many };
}

// --- how things are, for the popup and for tracing a problem ---
async function health() {
  const { key, stale } = await chrome.storage.local.get(['key', 'stale']);
  const h = { extension: chrome.runtime.getManifest().version, built: BUILT, browser: navigator.userAgent.replace(/^.*?((Edg|Chrome)\/[\d.]+).*$/, '$1'), key: !!key, stale: stale || undefined };
  if (key) {
    const t0 = Date.now();
    try { const v = await ask('/ext/ping', null, 5000); h.app = v.version || 'running'; h.ms = Date.now() - t0; }
    catch (e) { h.app = null; h.problem = e.message; h.why = e.why; }
  }
  return h;
}
// The log and how things are, as text to paste; also handed to Job Hunt, which keeps it beside your
// data (extension-log.json).
async function report(why, page) {
  const h = await health();
  const list = (await logged()).slice();
  if (h.app) ask('/ext/log', { why, health: h, events: list }, 8000).catch(() => {});
  return 'Job Hunt extension log ' + JSON.stringify({ why, health: h, page, events: list.map(e => ({ ...e, t: new Date(e.t).toISOString() })) }, null, 1);
}

// What the page may ask Job Hunt for.
const PAGE_ASKS = ['/ext/fill/start', '/ext/fill/poll', '/ext/pick', '/ext/salary', '/ext/dismiss', '/ext/learn', '/ext/applied', '/ext/brief'];
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // --- from the popup ---
  if (msg.posts) return answer(reply, 'posts', sendPosts(msg.posts, msg.chosen)), true;
  if (msg.check) { checkVersion().then(reply, () => reply({ ok: true })); return true; }
  if (msg.popup) return answer(reply, msg.popup, ask(msg.popup, msg.body)), true;
  if (msg.health) { health().then(reply, e => reply({ problem: String(e && e.message || e) })); return true; }
  if (msg.report) { report(msg.report, msg.page).then(reply, e => reply('Job Hunt extension log: ' + (e && e.message || e))); return true; }
  if (msg.fillTab) return answer(reply, 'fill', startFill(msg.fillTab)), true;
  // --- from the page's script ---
  const tabId = sender.tab && sender.tab.id;
  if (!msg.jobhunt || !tabId) return;
  const { jobhunt: kind, data } = msg;
  if (kind === 'log') {
    for (const e of (data && data.events) || []) log('page', e.m, { ...(e.d || {}), tabId, at: e.t });
    reply({ ok: true });
    // A fill that failed: Job Hunt gets the log at once, while it's fresh.
    if (data && data.why) report(data.why, data.page).catch(() => {});
    return;
  }
  if (kind === 'ask') {
    if (!PAGE_ASKS.includes(data.path)) { reply({ ok: false, error: 'Not something the page may ask.', why: 'error' }); return; }
    if (data.path === '/ext/fill/start') {
      log('fill', 'form sent', { tabId, boxes: ((data.body && data.body.fields) || []).length, host: (() => { try { return new URL(data.body.url).hostname; } catch (e) { return ''; } })() });
      // Older than Job Hunt: update first (the page has the old script; it's reloaded after).
      return answer(reply, 'start', checkVersion().catch(() => ({ ok: true })).then(c => {
        if (c && c.updating) throw Object.assign(new Error(`The extension is updating to ${c.updating} to match Job Hunt. Reload this page (F5) in a moment, then press Fill in this form.`), { why: 'updating' });
        if (c && c.stale) throw Object.assign(new Error(`This copy of the extension is older than Job Hunt (${c.stale.version}) and can't update itself. In chrome://extensions remove it, then press Load unpacked and choose ${c.stale.folder || 'the folder shown in Job Hunt: Settings → Applying → Filling in forms'}.`), { why: 'stale' });
        return askAgain('/ext/fill/start', data.body, 3, 20000);
      })), true;
    }
    // Asking again is the page's job for the rest (it knows what it's waiting for).
    return answer(reply, data.path, ask(data.path, data.body, data.path === '/ext/fill/poll' ? 8000 : 15000)), true;
  }
  // A pause for a page the browser has slowed (a tab behind another): timers here aren't.
  if (kind === 'sleep') { setTimeout(() => reply({ ok: true }), Math.min(Number(data && data.ms) || 0, 20000)); return true; }
  if (kind === 'debug') return answer(reply, 'debugger', debugOn(tabId).then(fresh => ({ fresh }))), true;
  if (kind === 'undebug') {
    // The form is filled: let the tab go at once (other tools can't read a page held by the debugger).
    debugOff(tabId).then(() => reply({ ok: true }), () => reply({ ok: true }));
    return true;
  }
  if (kind === 'click') return answer(reply, 'click', realClick(tabId, data.x, data.y)), true;
  if (kind === 'type') return answer(reply, 'type', realType(tabId, data.text)), true;
  if (kind === 'key') return answer(reply, 'key', realKey(tabId, data.key)), true;
});
