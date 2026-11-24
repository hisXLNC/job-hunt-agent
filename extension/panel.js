// The side panel. It talks only to Job Hunt on this computer, and reads or
// writes a page only when the person asks: a button here, the keyboard
// shortcut, or "Job Hunt: fill this in" on a field. Everything that comes
// from a page or a posting is put on screen as text, never as markup.
// It fills in and attaches; it never presses Submit.

const BASE = 'http://127.0.0.1:47700/api/ext/';
const APP = 'http://127.0.0.1:47700/';
const $main = document.getElementById('main'), $status = document.getElementById('status');

let key = '', code = '';
let state = 'start';          // start | off | pair | ok
let tab = null;               // the tab beside the panel
let page = { kind: 'none' };  // what that tab is showing
let next = [];                // roles ready to apply to
let flash = null;             // the result of the last button, for this address
let person = null;            // the profile being added
let working = '';             // which button is busy
let appVersion = '', helloAt = 0; // the program's own version, to tell when this panel is the older one
let tabRoles = {};            // tab id → the role last seen in that tab, for the later pages of its application
const pressed = {};           // tab id → the person pressed Submit there: { at, was, role }
const filledIn = {};          // tab id → when a form was last filled there
let applying = null;          // counting down to "applied": { id, title, left, timer }
let offers = [], held = [];   // answers the person typed themselves; offered once they send the form
const offered = new Set();    // roles the countdown has been shown for
const plog = [];              // what the panel did, for bug reports. Never what was typed.
const MINE = chrome.runtime.getManifest().version;
const log = line => { plog.push(`${new Date().toISOString().slice(11, 19)} ${line}`); if (plog.length > 200) plog.shift(); };

// ---- small helpers ----------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const STAGE = { new: 'Being read', found: 'Worth a look', ready: 'Ready to send', applied: 'Applied', reply: 'In conversation', interview: 'Interview', offer: 'Offer' };
const CLOSED = { screened: 'Set aside', no: 'Not interested', rejected: 'They said no', expired: 'Taken down', withdrawn: 'Withdrawn' };

class Away extends Error {}

async function call(path, { method = 'GET', body, raw } = {}) {
  let r;
  try {
    r = await fetch(BASE + path, { method, cache: 'no-store', headers: { 'X-JobHunt-Ext': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    setState('off');
    throw new Away('Job Hunt is not running.');
  }
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
    if (j.pair) { setState('pair'); throw new Away(j.error); }
    throw new Error(j.error || 'Job Hunt said no.');
  }
  if (raw) { if (!r.ok) throw new Error('That document is not written yet.'); return r; }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || 'Something went wrong.');
  return j;
}

async function loadKey() {
  const got = await chrome.storage.local.get('key');
  key = got.key;
  if (!key) {
    const a = new Uint8Array(32);
    crypto.getRandomValues(a);
    key = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ key });
  }
  const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  code = [...new Uint8Array(sum)].slice(0, 3).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function setState(s) {
  if (state === s) return;
  state = s;
  render();
}

// ---- what the tab is showing ------------------------------------------------------
// Normally the tab beside the panel. Opened as panel.html?tab=<id>, the panel
// follows that one tab instead (used when it is shown in a window of its own).
const pinned = Number(new URLSearchParams(location.search).get('tab')) || 0;
async function activeTab() {
  if (pinned) return chrome.tabs.get(pinned).catch(() => null);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function inPage(func, args = [], frames) {
  if (!tab) throw new Error('There is no page open beside this panel.');
  const target = { tabId: tab.id };
  if (frames === 'all') target.allFrames = true;
  else if (typeof frames === 'number') target.frameIds = [frames];
  try {
    const res = await chrome.scripting.executeScript({ target, func, args });
    return res.filter(r => r && r.result != null).map(r => ({ frame: r.frameId, result: r.result }));
  } catch (e) {
    throw new Error("Job Hunt can't reach this page. Reload the page and try again.");
  }
}

// The filler is one file put into the page; `method` is one of the few things it offers.
const FILLER = (m, a) => window.__jobhuntFiller[m](...a);
async function inFiller(method, args = [], frames, tabId) {
  if (!tabId && !tab) throw new Error('There is no page open beside this panel.');
  const target = { tabId: tabId || tab.id };
  if (frames === 'all') target.allFrames = true;
  else if (typeof frames === 'number') target.frameIds = [frames];
  try {
    await chrome.scripting.executeScript({ target, files: ['filler.js'] });
    const res = await chrome.scripting.executeScript({ target, func: FILLER, args: [method, args] });
    return res.filter(r => r && r.result != null).map(r => ({ frame: r.frameId, result: r.result }));
  } catch (e) {
    throw new Error("Job Hunt can't reach this page. Reload the page and try again.");
  }
}

// ---- the role a tab is about ------------------------------------------------------
const ATS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|icims\.com|jobvite\.com|bamboohr\.com|myworkdayjobs\.com|myworkdaysite\.com|taleo\.net|successfactors\.(com|eu)|sapsf\.(com|eu)|zohorecruit\.[a-z.]+)$/i;
// Addresses the main hiring systems show once an application is in.
const KNOWN_DONE = /greenhouse\.io\/.+\/confirmation|lever\.co\/.+\/thanks|myworkday(jobs|site)\.com\/.+\/jobTasks\/completed|ashbyhq\.com\/.+\/application\/(confirmation|success)|workable\.com\/.+\/(thank-you|thanks)/i;
const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
const sameTrip = (now, then) => hostOf(now) === hostOf(then) || ATS.test(hostOf(now));
function remember(tabId, id, url, at) {
  tabRoles[tabId] = { id, url, at: at || Date.now() };
  for (const k of Object.keys(tabRoles)) if (Date.now() - tabRoles[k].at > 4 * 3600 * 1000) delete tabRoles[k];
  chrome.storage.session.set({ tabRoles }).catch(() => {});
}
const roleOfTab = id => (tab && tab.id === id && page.kind === 'role' ? page.role.id : (tabRoles[id] || {}).id || 0);

// ---- after the person sends the form ----------------------------------------------
// The site said the application went in. Marking a role applied only changes Job
// Hunt's own list and can be put back there, so it is done after a short wait
// the person can stop.
function startApplying(id, title) {
  if (!id || offered.has(id) || applying) return;
  offered.add(id);
  applying = { id, title, left: 5 };
  log('the form was sent: counting down to applied');
  applying.timer = setInterval(async () => {
    const a = applying;
    if (!a) return;
    if (--a.left > 0) { render(); return; }
    clearInterval(a.timer);
    applying = null;
    try { await call(`role/${a.id}/applied`, { method: 'POST', body: {} }); say('good', 'Marked as applied. Job Hunt will watch for their reply.'); } catch (e) { if (!(e instanceof Away)) flash = { tone: 'bad', title: e.message, url: page.url }; }
    refresh(true);
  }, 1000);
  render();
}
async function sentFrom(tabId) {
  const id = (pressed[tabId] || {}).role || roleOfTab(tabId);
  delete pressed[tabId];
  showOffers();
  if (!id || offered.has(id)) { render(); return; }
  const r = await call('role/' + id).catch(() => null);
  if (r && r.known && !r.role.closed && !['applied', 'reply', 'interview', 'offer'].includes(r.role.stage)) startApplying(id, [r.role.title, r.role.company].filter(Boolean).join(' · '));
  else render();
}
// A page finished loading in a tab where the person was applying: is it the site's thank-you?
async function afterLoad(tabId) {
  const p = pressed[tabId], recent = Date.now() - (filledIn[tabId] || 0) < 2 * 3600 * 1000;
  if (!(p && Date.now() - p.at < 10 * 60 * 1000) && !(recent && roleOfTab(tabId))) return;
  try {
    const got = await inFiller('check', p ? [p.was, p.at] : [null, 0], undefined, tabId);
    if (got.some(g => g.result.done)) sentFrom(tabId);
  } catch (e) { /* a page the panel can't read */ }
}
const short = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
function hold(list) {
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x.label !== 'string' || typeof x.answer !== 'string' || !x.label.trim() || !x.answer.trim() || x.answer.length > 300 || x.label.length > 300) continue;
    const i = held.findIndex(h => h.label === x.label);
    if (i >= 0) held[i] = { label: x.label, answer: x.answer }; else if (held.length < 12) held.push({ label: x.label, answer: x.answer });
  }
}
function showOffers() { if (held.length) { offers = held.slice(0, 8); held = []; } }

let seq = 0;
async function refresh(force) {
  const mine = ++seq;
  try {
    if (state !== 'ok' || Date.now() - helloAt > 60000) { const hi = await call('hello', { method: 'POST', body: {} }); appVersion = String((hi && hi.version) || ''); helloAt = Date.now(); state = 'ok'; }
    const t = await activeTab();
    const url = t && t.url ? t.url.split('#')[0] : '';
    let p;
    if (!t) p = { kind: 'none' };
    else if (!url) p = { kind: 'blind' };
    else if (!/^https?:/.test(url) || url.startsWith(APP)) p = { kind: 'other' };
    else if (/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^/]+/.test(url)) p = { kind: 'profile', url };
    else {
      const r = await call('role?url=' + encodeURIComponent(url));
      p = r.known ? { kind: 'role', role: r.role, url } : { kind: 'unknown', url };
      if (r.known) remember(t.id, r.role.id, url);
      else {
        // The later pages of an application have their own addresses: the role
        // this tab (or the tab it was opened from) was showing still stands.
        const m = tabRoles[t.id] || (t.openerTabId && tabRoles[t.openerTabId]);
        if (m && Date.now() - m.at < 2 * 3600 * 1000 && sameTrip(url, m.url)) {
          const rr = await call('role/' + m.id).catch(() => null);
          if (rr && rr.known) { p = { kind: 'role', role: rr.role, url, carried: true }; remember(t.id, m.id, m.url, m.at); }
        }
      }
    }
    const n = (await call('next')).roles || [];
    if (mine !== seq) return;
    if (flash && flash.url !== url) flash = null;
    if (person && person.url !== url) person = null;
    tab = t; page = p; next = n;
    if (p.kind === 'profile' && !person) grabProfile();
    if (p.carried && KNOWN_DONE.test(url)) sentFrom(t.id);
  } catch (e) {
    if (!(e instanceof Away) && mine === seq) flash = { tone: 'bad', title: e.message, url: tab && tab.url };
  }
  if (mine !== seq) return;
  // Don't redraw under someone who is typing, unless they pressed something.
  const typing = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
  if (force || !typing) render();
}
let soon;
const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(() => refresh(), 350); };

// ---- buttons ----------------------------------------------------------------------
async function run(name, fn) {
  if (working) return;
  working = name;
  render();
  try { await fn(); } catch (e) { if (!(e instanceof Away)) flash = { tone: 'bad', title: e.message, url: page.url }; }
  working = '';
  await refresh(true);
}
const say = (tone, title, lists) => { flash = { tone, title, lists, url: page.url }; };

async function fetchFile(id, which) {
  const r = await call(`role/${id}/${which}.docx`, { raw: true });
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '');
  let name = which === 'cv' ? 'CV.docx' : 'Cover letter.docx';
  if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; } }
  return { name, blob: await r.blob() };
}
function toB64(blob) {
  return new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => no(new Error('The file could not be read.')); fr.readAsDataURL(blob); });
}

const actions = {
  async send() {
    const got = await inPage(pageGrabPosting);
    const p = got[0] && got[0].result;
    if (!p || !p.title || p.description.length < 200) throw new Error("This doesn't look like a job posting. Open the posting itself and try again.");
    if (!p.company) throw new Error("Job Hunt couldn't tell which employer this is. Add the role by hand in Job Hunt.");
    await call('posting', { method: 'POST', body: p });
    say('good', 'Sent. Job Hunt is reading it; your fit shows here in a moment.');
  },
  async prepare() {
    await call(`role/${page.role.id}/prepare`, { method: 'POST', body: {} });
    say('good', 'Writing your CV and letter. About a minute.');
  },
  async attach(arg) {
    const which = arg.which || arg, r = await attachFile(which, !!arg.replace);
    const what = which === 'cv' ? 'CV' : 'letter';
    if (r.state === 'ok') say('good', `Attached your ${what} (${r.name}). Check that the form shows it.`);
    else if (r.state === 'has') { say('warn', `The form already has a file (${short(r.has, 60)}), so Job Hunt left it.`); flash.button = { label: `Replace it with my ${what}`, name: 'attach', arg: { which, replace: true } }; }
    else if (r.state === 'unsure') say('warn', `This form has more than one upload and Job Hunt couldn't tell which is for the ${what}. Use Download and attach it yourself.`);
    else say('warn', `No upload field found on this page. If the form opens after "Apply", open it first. Or use Download and attach it yourself.`);
  },
  async download(which) {
    const f = await fetchFile(page.role.id, which);
    const a = h('a', { href: URL.createObjectURL(f.blob), download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  },
  async copyLetter() {
    await navigator.clipboard.writeText(page.role.letter || '');
    say('good', 'Letter copied.');
  },
  // Fills the form beside the panel: the person's details, each job and school,
  // Job Hunt's answers to the questions, and the CV and letter. Then stops.
  async fill() {
    const role = page.kind === 'role' ? page.role : null;
    const got = await fillForm(fillIO(role), await call('me'), role);
    if (!got) { say('warn', 'No form found on this page. If it opens after "Apply", open it first.'); return; }
    const total = got.total, best = { result: got.last };
    const files = best.result.fields.filter(f => f.kind === 'file'), attached = [];
    for (const [which, has, what] of [['cv', role && role.has_cv, 'CV'], ['letter', role && role.has_letter, 'Cover letter']]) {
      if (!has || !files.some(f => (which === 'letter' ? f.want === 'letter' : f.want !== 'letter'))) continue;
      const r = await attachFile(which, false).catch(() => ({ state: 'none' }));
      if (r.state === 'ok') attached.push(`${what}: ${r.name}`);
      else if (r.state === 'has') total.left.push({ label: `${what} upload`, why: `it already has a file (${short(r.has, 40)}), which Job Hunt kept` });
      else if (r.state === 'unsure') total.left.push({ label: `${what} upload`, why: "Job Hunt couldn't tell which upload is for it" });
    }
    await inFiller('watch', [], 'all').catch(() => {});
    filledIn[tab.id] = Date.now();
    log(`fill: ${best.result.site || 'no known system'}${best.result.step ? ' (' + best.result.step + ')' : ''}; filled ${total.filled}; to check ${total.check.length}; left ${total.left.length}; attached ${attached.length}`);
    const line = x => `${short(x.label, 70)}: ${x.why}`;
    const lists = [];
    if (attached.length) lists.push(['Attached', attached]);
    if (total.check.length) lists.push(['Needs a check (outlined in amber)', total.check.map(line)]);
    if (total.left.length) lists.push(['Left for you', total.left.map(line)]);
    const n = total.filled, more = best.result.site === 'workday' ? ' On the next step, fill again (Alt+Shift+F).' : '';
    say(n || attached.length ? 'good' : 'warn', n ? `Filled ${plural(n, 'field', 'fields')}, outlined in blue. Read them before you submit.${more}` : attached.length ? 'Attached your files. The fields are already filled in or are yours to answer.' : 'Nothing to fill: the fields are already filled in or are yours to answer.', lists);
  },
  // One field, the one the person right-clicked.
  async fillOne(frame) {
    const role = page.kind === 'role' ? page.role : null;
    const got = (await inFiller('scanOne', [], typeof frame === 'number' ? frame : 0))[0];
    const f = got && got.result.field;
    if (!f) { say('warn', 'Right-click inside a field of the form, then choose "Job Hunt: fill this in".'); return; }
    if (f.private) { say('warn', `"${short(f.label, 80)}" is yours to answer.`); return; }
    const sum = await fillRound({ ...fillIO(role), frame: got.frame }, [f], await call('me'), role, { over: true });
    await inFiller('watch', [], 'all').catch(() => {});
    filledIn[tab.id] = Date.now();
    log(`one field: ${sum.filled ? 'filled' : 'left'}`);
    const name = `"${short(f.label || 'This field', 80)}"`;
    if (sum.filled && sum.check.length) say('warn', `Filled ${name}. Check it: ${sum.check[0].why}.`);
    else if (sum.filled) say('good', `Filled ${name}.`);
    else say('warn', `Left ${name} for you: ${(sum.left[0] || {}).why || 'Job Hunt has no answer for it'}.`);
  },
  async applied() {
    stopApplying();
    offered.add(page.role.id);
    showOffers();
    await call(`role/${page.role.id}/applied`, { method: 'POST', body: {} });
    say('good', 'Marked as applied. Job Hunt will watch for their reply.');
  },
  async no() {
    if (!confirm("Not for you? Job Hunt won't show this role again.")) return;
    await call(`role/${page.role.id}/no`, { method: 'POST', body: {} });
  },
  async applyNow() {
    const a = applying;
    if (!a) return;
    stopApplying();
    await call(`role/${a.id}/applied`, { method: 'POST', body: {} });
    say('good', 'Marked as applied. Job Hunt will watch for their reply.');
  },
  async notYet() { stopApplying(); },
  // An answer the person typed into the form themselves, kept because they said so.
  async keep(n) {
    const o = offers[n];
    if (!o) return;
    await call('answer', { method: 'POST', body: { question: o.label, answer: o.answer } });
    offers = offers.filter(x => x !== o);
    log('kept an answer');
  },
  async drop(n) { offers = offers.filter((x, i) => i !== n); },
  async notThisRole() { delete tabRoles[tab.id]; chrome.storage.session.set({ tabRoles }).catch(() => {}); },
  async reloadPanel() { chrome.runtime.reload(); },
  async copyLog() {
    const lines = [`Job Hunt side panel ${MINE}; program ${appVersion || 'unknown'}`];
    try {
      const got = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => (window.__jobhuntFiller ? window.__jobhuntFiller.log() : null) });
      for (const g of got) {
        if (!g || !g.result || !g.result.rows.length) continue;
        lines.push('', `Page: ${g.result.url}; system: ${g.result.site || 'none known'}`);
        g.result.rows.forEach((r, i) => lines.push(`${i + 1}. ${r.step}${r.kind ? ' [' + r.kind + ']' : ''}${r.label ? ' "' + r.label + '"' : ''}${r.more ? ' (' + r.more + ')' : ''}${r.at ? ' at ' + r.at : ''}`));
      }
    } catch (e) { lines.push('', "The page beside the panel couldn't be read."); }
    lines.push('', 'Panel:', ...plog.slice(-60));
    await navigator.clipboard.writeText(lines.join('\n'));
    if (flash && flash.url === page.url) flash.also = 'Log copied.';
    else say('good', 'Log copied. It has the names of the fields, not what was typed in them.');
  },
  async everySite() {
    const ok = await chrome.permissions.request({ origins: ['https://*/*'] });
    if (!ok) say('warn', 'Not switched on. Job Hunt keeps working on LinkedIn and the main hiring systems.');
  },
  async addPerson() {
    const form = document.getElementById('person');
    const f = Object.fromEntries(new FormData(form));
    if (!f.name.trim()) throw new Error('Their name is missing.');
    const r = await call('person', { method: 'POST', body: { name: f.name.trim(), title: f.title.trim(), company: f.company.trim(), kind: f.kind, url: person.url, draft: true } });
    person = { ...person, name: f.name, title: f.title, company: f.company, kind: f.kind, id: r.id, note: r.note };
  },
  async copyNote() {
    await navigator.clipboard.writeText(document.getElementById('note').value);
    say('good', "Copied. On their profile choose Connect, then Add a note, and paste it.");
  },
  async sentNote() {
    await call(`note/${person.note.id}/sent`, { method: 'POST', body: {} });
    person.note.state = 'sent';
    say('good', "Marked as sent. Job Hunt reminds you if a week goes by with no answer.");
  },
};

async function grabProfile() {
  const url = page.url;
  try {
    const got = await inPage(pageGrabProfile);
    if (page.url !== url || !got[0]) return;
    person = { ...got[0].result, url: got[0].result.url || url, kind: 'same_craft' };
    render();
  } catch (e) { person = { name: '', title: '', company: '', url, kind: 'same_craft' }; render(); }
}

function stopApplying() { if (applying) { clearInterval(applying.timer); applying = null; } }

async function attachFile(which, replace) {
  const f = await fetchFile(page.role.id, which);
  const file = { name: f.name, b64: await toB64(f.blob), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', want: which, replace };
  const res = await inFiller('attach', [file], 'all');
  log(`attach ${which}: ${res.map(r => (r.result.ok ? 'ok' : r.result.why)).join(', ') || 'no answer'}`);
  if (res.some(r => r.result.ok)) return { state: 'ok', name: f.name };
  const has = res.find(r => r.result.why === 'has');
  if (has) return { state: 'has', has: has.result.name, name: f.name };
  return { state: res.some(r => r.result.why === 'unsure') ? 'unsure' : 'none', name: f.name };
}

// How plan.js reaches the page and Job Hunt while it fills a form.
const fillIO = role => ({
  scan: async o => (await inFiller('scan', [o], 'all')).sort((a, b) => b.result.fields.length - a.result.fields.length).map(x => ({ ...x.result, frame: x.frame }))[0],
  addEntry: async (a, frame) => ((await inFiller('addEntry', [a], frame))[0] || { result: {} }).result,
  fill: async (items, frame) => ((await inFiller('fill', [items], frame))[0] || { result: [] }).result,
  ask: async list => (await call('answers', { method: 'POST', body: { role: role ? role.id : 0, questions: list.map(a => a.q), options: list.map(a => a.options) } })).answers || [],
});

// A fill asked for from outside the panel: the keyboard shortcut, or a right-click on a field.
async function takeTodo() {
  const { todo } = await chrome.storage.session.get('todo');
  if (!todo || Date.now() - todo.at > 20000) return;
  await chrome.storage.session.remove('todo');
  await refresh(true);
  if (state !== 'ok' || !tab || tab.id !== todo.tabId) return;
  if (!['role', 'unknown'].includes(page.kind)) { if (page.kind !== 'blind') { say('warn', 'There is no form here that Job Hunt can fill in.'); render(); } return; }
  if (todo.what === 'one') run('one', () => actions.fillOne(todo.frameId));
  else run('fill', () => actions.fill());
}

// (What goes in which field is decided in plan.js.)

// ---- drawing ----------------------------------------------------------------------
const btn = (label, name, arg, cls = '') => h('button', { class: 'btn ' + cls, disabled: !!working, onclick: () => run(name, () => actions[name](arg)) }, working === name ? [h('span', { class: 'spin' }), ' '] : null, label);

function flashCard() {
  if (!flash) return null;
  return h('div', { class: 'note ' + (flash.tone || ''), role: 'status' }, h('b', {}, flash.title),
    (flash.lists || []).map(([title, items]) => [h('div', { class: 's', style: 'margin-top:6px;font-weight:600' }, `${title} · ${items.length}`), h('ul', { class: 'dots s' }, items.slice(0, 15).map(x => h('li', {}, short(x, 160))), items.length > 15 ? h('li', {}, `and ${items.length - 15} more`) : null)]),
    flash.button ? h('div', { style: 'margin-top:8px' }, btn(flash.button.label, flash.button.name, flash.button.arg)) : null,
    flash.also ? h('div', { class: 's', style: 'margin-top:6px' }, flash.also) : null);
}

// The program and this panel are numbered alike; when they differ, one of them is old.
function versionCard() {
  // (A copy of the program built by hand has no number.)
  if (!/^\d+\.\d+\.\d+$/.test(appVersion) || appVersion === MINE) return null;
  return h('div', { class: 'note warn', role: 'status' }, h('b', {}, `Job Hunt is ${appVersion}; this panel is ${MINE}.`),
    h('div', { class: 's', style: 'margin-top:4px' }, 'Press Reload, then open the panel again. If this note comes back, get the new panel in Job Hunt under You, Connections.'),
    h('div', { style: 'margin-top:8px' }, btn('Reload this panel', 'reloadPanel')));
}

function applyingCard() {
  if (!applying) return null;
  return h('section', { class: 'card ask', role: 'status' }, h('div', { class: 'eb' }, 'Sent'), h('h2', {}, 'Looks like your application went in'),
    h('p', { class: 's' }, short(applying.title, 120)),
    h('p', { class: 's ink2' }, `Marking it as applied in ${applying.left}…`),
    h('div', { class: 'row' }, btn('Mark as applied', 'applyNow', null, 'p'), btn("Don't", 'notYet')));
}

function offersCard() {
  if (!offers.length) return null;
  return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'Your own answers'), h('h2', {}, offers.length === 1 ? 'Remember this answer?' : 'Remember these answers?'),
    h('p', { class: 's m' }, 'You typed these yourself. Kept, Job Hunt uses them on the next form that asks.'),
    h('ul', { class: 'plain' }, offers.map((o, n) => h('li', {}, h('div', { class: 's', style: 'font-weight:600' }, short(o.label, 140)), h('div', { class: 's ink2' }, short(o.answer, 300)),
      h('div', { class: 'row', style: 'margin-top:4px' }, h('button', { class: 'btn', disabled: !!working, onclick: () => run('keep', () => actions.keep(n)) }, 'Remember'), h('button', { class: 'btn ghost', disabled: !!working, onclick: () => run('drop', () => actions.drop(n)) }, 'No'))))));
}

function logLink() {
  return ['role', 'unknown'].includes(page.kind) ? h('div', { style: 'text-align:center' }, h('button', { class: 'btn ghost s', disabled: !!working, onclick: () => run('copyLog', actions.copyLog) }, "Copy the panel's log")) : null;
}

function fitBox(r) {
  return h('div', { class: 'fit' }, h('div', {}, h('b', {}, r.fit || '–'), h('span', {}, 'Fit now')), h('div', {}, h('b', { style: 'color:var(--good)' }, r.fit_tailored || '–'), h('span', {}, 'Tailored')));
}

function roleCard(r) {
  const at = r.posted_at || r.first_seen_at, early = r.applicants >= 0 && r.applicants < 10;
  const kids = [
    h('div', { class: 'row' }, h('span', { class: 'chip ' + (r.closed ? '' : r.stage === 'ready' ? 'hot' : r.stage === 'applied' ? 'blue' : '') }, r.closed ? CLOSED[r.closed] || 'Closed' : STAGE[r.stage] || r.stage),
      h('span', { class: 's m' }, `${r.posted_at ? 'Posted' : 'Seen'} ${ago(at)}`, r.applicants >= 0 ? [' · ', h('b', { style: early ? 'color:var(--hot)' : '' }, plural(r.applicants, 'applicant', 'applicants'))] : null)),
    h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { class: 'grow' }, h('h2', {}, r.title), h('div', { class: 's m' }, [r.company, r.location].filter(Boolean).join(' · '))), r.fit ? fitBox(r) : null),
    r.summary ? h('p', { class: 's ink2' }, r.summary) : null,
  ];
  if (r.closed) kids.push(h('p', { class: 's m' }, r.closed === 'no' ? 'You said this one is not for you.' : r.closed_why || 'This role is closed.'));
  else if (r.stage === 'new') kids.push(h('p', { class: 's' }, h('span', { class: 'spin' }), ' Job Hunt is reading this role.'));
  else if (r.preparing) kids.push(h('p', { class: 's' }, h('span', { class: 'spin' }), ' Writing your CV and letter. About a minute.'));
  else if (!r.has_cv) kids.push(btn('Write my CV and letter for this', 'prepare', null, 'p wide'), btn('Fill in the form', 'fill', null, 'wide'));
  else {
    kids.push(h('div', { class: 'eb', style: 'margin-top:4px' }, 'On the application form'),
      btn('Attach my CV', 'attach', 'cv', 'p wide'), btn('Fill in the form', 'fill', null, 'wide'),
      h('div', { class: 'row' }, r.has_letter ? btn('Attach letter', 'attach', 'letter') : null, r.has_letter ? btn('Copy letter', 'copyLetter') : null),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', disabled: !!working, onclick: () => run('download', () => actions.download('cv')) }, 'Download CV'), r.has_letter ? h('button', { class: 'btn ghost', disabled: !!working, onclick: () => run('download', () => actions.download('letter')) }, 'Download letter') : null));
  }
  if (!r.closed && r.stage !== 'new') {
    kids.push(h('div', { class: 'row', style: 'border-top:1px solid var(--line2);padding-top:8px' },
      ['applied', 'reply', 'interview', 'offer'].includes(r.stage) ? h('span', { class: 's m grow' }, 'You applied.') : btn('I applied', 'applied'),
      h('span', { class: 'grow' }), btn('Not for me', 'no', null, 'ghost danger')));
  }
  kids.push(h('div', { class: 'row' }, h('a', { class: 's grow', href: `${APP}#/roles/${r.id}`, target: '_blank', rel: 'noopener' }, 'Open in Job Hunt'),
    page.carried ? h('button', { class: 'btn ghost s', disabled: !!working, onclick: () => run('notThisRole', actions.notThisRole) }, 'Not this role') : null));
  if (page.carried) kids.unshift(h('div', { class: 's m' }, 'You came to this page from this role.'));
  return h('section', { class: 'card' }, kids);
}

function personCard() {
  if (!person) return h('section', { class: 'card' }, h('p', { class: 's' }, h('span', { class: 'spin' }), ' Reading this profile.'));
  const KINDS = [['same_craft', 'Does your work'], ['made_move', 'Made the same move'], ['same_roots', 'Shares your roots'], ['knows_work', 'Knows your work'], ['recruiter', 'Recruiter'], ['manager', 'Hiring manager'], ['mentor', 'Mentor'], ['contact', 'You know them']];
  if (!person.id) {
    return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'This profile'), h('h2', {}, 'Add them and get a note to send'),
      h('form', { id: 'person', style: 'display:grid;gap:8px', onsubmit: ev => { ev.preventDefault(); run('addPerson', actions.addPerson); } },
        h('label', { class: 'f' }, 'Name', h('input', { type: 'text', name: 'name', value: person.name, required: true })),
        h('label', { class: 'f' }, 'Their role', h('input', { type: 'text', name: 'title', value: person.title })),
        h('label', { class: 'f' }, 'Employer', h('input', { type: 'text', name: 'company', value: person.company })),
        h('label', { class: 'f' }, 'What you share', h('select', { name: 'kind' }, KINDS.map(([k, v]) => h('option', { value: k, selected: k === person.kind }, v)))),
        h('button', { class: 'btn p wide', disabled: !!working }, working === 'addPerson' ? [h('span', { class: 'spin' }), ' '] : null, 'Add and write a note')));
  }
  const n = person.note, sent = n && n.state !== 'draft';
  const count = h('span', { class: 'chip' }, `${n ? n.body.length : 0} of 300`);
  return h('section', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'eb' }, sent ? 'Your note · sent' : 'Your note · draft'), h('h2', {}, person.name)), count),
    n ? h('textarea', { id: 'note', maxlength: 300, 'aria-label': 'Your note', oninput: ev => { count.textContent = `${ev.target.value.length} of 300`; } }, n.body) : h('p', { class: 's m' }, 'No note yet. Write one in Job Hunt.'),
    n ? h('div', { class: 'row' }, btn('Copy', 'copyNote', null, 'p'), sent ? null : btn('I sent it', 'sentNote')) : null,
    h('p', { class: 's m' }, 'Job Hunt never sends it. Paste it into Connect, Add a note.'),
    h('a', { class: 's', href: `${APP}#/people/${person.id}`, target: '_blank', rel: 'noopener' }, 'Open in Job Hunt'));
}

function pageCard() {
  switch (page.kind) {
    case 'role': return roleCard(page.role);
    case 'profile': return personCard();
    case 'unknown': return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'This page'), h('h2', {}, 'Is this a job posting?'),
      h('p', { class: 's m' }, 'Send it to Job Hunt and it is scored against your CV, with a CV and letter written if it fits.'), btn('Send this posting to Job Hunt', 'send', null, 'p wide'),
      btn('Fill in a form on this page', 'fill', null, 'wide'));
    case 'blind': return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'This page'), h('h2', {}, "Job Hunt isn't switched on for this site"),
      h('p', { class: 's m' }, "It works on LinkedIn and the main hiring systems as it is. To use it on an employer's own careers site, allow it on every site. It looks up the address of the page beside it in your own Job Hunt, and reads or fills a page only when you press a button here."),
      btn('Switch on for every site', 'everySite', null, 'wide'));
    default: return null;
  }
}

function nextCard() {
  const rest = next.filter(r => !(page.kind === 'role' && page.role.id === r.id)).slice(0, 6);
  if (!rest.length) return page.kind === 'role' || page.kind === 'profile' ? null : h('section', { class: 'card' }, h('h3', {}, 'Nothing is waiting to be sent'), h('p', { class: 's m' }, 'New roles appear here the moment their CV and letter are written.'));
  return h('section', { class: 'card next' }, h('div', { class: 'eb' }, 'Ready to send · freshest first'), h('ul', { class: 'plain' }, rest.map(r => {
    const link = safeUrl(r.apply_url) || safeUrl(r.url), early = r.applicants >= 0 && r.applicants < 10;
    return h('li', {}, link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, r.title) : h('b', {}, r.title),
      h('div', { class: 's m' }, r.company, ' · fit ', r.fit_tailored || r.fit, ' · ', ago(r.posted_at || r.first_seen_at), early ? [' · ', h('b', { style: 'color:var(--hot)' }, plural(r.applicants, 'applicant', 'applicants'))] : null));
  })));
}

function render() {
  $status.className = 'chip ' + (state === 'ok' ? 'good' : state === 'pair' ? 'warn' : '');
  $status.textContent = state === 'ok' ? 'Connected' : state === 'pair' ? 'Needs approval' : state === 'off' ? 'Not running' : 'Starting';
  let kids;
  if (state === 'off' || state === 'start') {
    kids = [h('section', { class: 'card' }, h('h2', {}, state === 'off' ? 'Job Hunt is not running' : 'Looking for Job Hunt'), h('p', { class: 's m' }, 'Start Job Hunt on this computer. This panel connects by itself.'))];
  } else if (state === 'pair') {
    kids = [h('section', { class: 'card ask' }, h('h2', {}, 'Approve this panel in Job Hunt'), h('div', { class: 'code', 'aria-label': 'Code ' + code.split('').join(' ') }, code),
      h('p', { class: 's' }, 'In Job Hunt open You, then Connections. Check that it shows this code and press Approve.'),
      h('a', { class: 'btn wide', href: `${APP}#/you/connections`, target: '_blank', rel: 'noopener' }, 'Open Job Hunt'))];
  } else {
    kids = [versionCard(), applyingCard(), flashCard(), offersCard(), pageCard(), nextCard(), logLink()];
  }
  $main.replaceChildren(...kids.flat().filter(Boolean));
}

// ---- start ------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(refreshSoon);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) refreshSoon(); if (info.status === 'complete') afterLoad(id); });
chrome.tabs.onRemoved.addListener(id => { delete pressed[id]; delete filledIn[id]; });
// Word from the page (only ever from this extension's own filler) and from the shortcut.
chrome.runtime.onMessage.addListener((m, sender) => {
  if (!m || sender.id !== chrome.runtime.id) return;
  if (m.jobhunt === 'todo') { takeTodo(); return; }
  const id = sender.tab && sender.tab.id;
  if (!id) return;
  if (m.jobhunt === 'learn') hold(m.learn);
  else if (m.jobhunt === 'pressed') { pressed[id] = { at: Number(m.at) || Date.now(), was: m.was || null, role: roleOfTab(id) }; hold(m.learn); showOffers(); log('the person sent the form'); render(); }
  else if (m.jobhunt === 'submitted') sentFrom(id);
});
chrome.permissions.onAdded.addListener(refreshSoon);
setInterval(() => {
  const waiting = state !== 'ok' || (page.kind === 'role' && (page.role.preparing || page.role.stage === 'new')) || (flash && flash.tone === 'good' && page.kind === 'unknown');
  if (waiting && !working) refresh();
}, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
chrome.storage.session.get('tabRoles').then(g => { tabRoles = { ...(g.tabRoles || {}), ...tabRoles }; }).catch(() => {});
loadKey().then(() => refresh()).then(takeTodo);
