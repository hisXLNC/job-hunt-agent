// Job Hunt screens. Everything talks to the app through /api on the private jobhunt:// address.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The phone's "Fill this form" bookmark: loads Job Hunt's form filler from your PC (through Tailscale). */
const phoneBookmark = st => `javascript:(function(){var s=document.createElement('script');s.src='${st.phone_url}/m/fill.js?k=${encodeURIComponent(st.ext_key)}&t='+Date.now();s.onerror=function(){alert('Job Hunt: couldn\\'t reach your PC. Is Job Hunt running there, and Tailscale on on this phone? (A few sites block it.)')};document.documentElement.appendChild(s)})();`;
function phoneCard(st) {
  const url = st.phone_url || '';
  return `<section class="card" id="phoneCard"><header><h2>Fill forms on your phone</h2>${url ? `<span class="pill ${st.phone_last ? 'good' : ''}">${st.phone_last ? 'Used ' + esc(fmtWhen(st.phone_last)) : 'Ready'}</span>` : ''}</header>
    <p class="muted">Apply from your phone's browser and Job Hunt fills in the form, from this PC (it has to be on, with Job Hunt running). Your phone reaches it through Tailscale, so only your own devices can.</p>
    ${url ? `<ol class="small steps-list">
      <li>On your phone, turn on Tailscale.</li>
      <li>Get this bookmark onto your phone: <button class="btn sm" data-act="copyPhone">Copy the bookmark</button> and send it to yourself (a note or an email to yourself). Or add it as a favourite in Edge here: with sync on it shows up in Edge on your phone.</li>
      <li>On the phone, bookmark any page, then edit the bookmark: name it <b>Job Hunt Fill</b> and paste what you copied as its address (URL).</li>
      <li>On an application form, tap the address bar, type <b>Job Hunt Fill</b> and tap the bookmark (in Safari, open Bookmarks and tap it). The Job Hunt panel appears and fills in the form.</li></ol>
      <p class="muted small">On the phone, Workday's skills are chosen as best Job Hunt can; tick any it missed. The bookmark holds your key: keep it to yourself. Address: <code>${esc(url)}</code> <button class="btn ghost sm" data-act="phoneReset">Change</button></p>
      <h3 style="margin-top:18px">Send jobs from the LinkedIn app</h3>
      <p class="muted small">Share a job from the LinkedIn app (or any app or browser) to Job Hunt: it's added and scored here, and you get a notice.</p>
      <ol class="small steps-list">
        <li>Get this link onto your iPhone: <button class="btn sm" data-act="copyShare">Copy the link</button> (send it to yourself, like the bookmark).</li>
        <li>In <b>Shortcuts</b>, press <b>+</b> and name it <b>Send to Job Hunt</b>. Press the <b>ⓘ</b> and turn on <b>Show in Share Sheet</b>.</li>
        <li>Add the action <b>URL Encode</b> (it takes the <b>Shortcut Input</b>).</li>
        <li>Add <b>Get Contents of URL</b>: paste the link as its address, then tap at its end and insert <b>URL Encoded Text</b>.</li>
        <li>Add <b>Show Notification</b> with <b>Contents of URL</b>, so you see what was added.</li>
        <li>In the LinkedIn app, on a job: <b>Share</b> → <b>More</b> → <b>Send to Job Hunt</b>.</li></ol>
      <p class="muted small">On Android, the free <b>HTTP Shortcuts</b> app does the same: a shortcut that receives shared text and opens this link with the text added at the end.</p>`
    : `<div class="row"><button class="btn primary" data-act="phoneTailscale">Set up with Tailscale</button><span class="muted small">Shares Job Hunt with your own devices only (Tailscale Serve), and gets this PC's address.</span></div>
      <details class="small"><summary class="muted">Or type the address yourself</summary><div class="row"><input id="phoneUrl" placeholder="https://your-pc.tailnet-name.ts.net" style="flex:1"><button class="btn sm" data-act="phoneSave">Save</button></div>
      <p class="muted small">An https address that reaches port ${47613} on this PC, such as after <code>tailscale serve --bg 47613</code>.</p></details>`}
  </section>`;
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: {} };
  if (raw !== undefined) { opts.body = raw; opts.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, opts);
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((data && data.error) || `Something went wrong (${r.status})`);
  // Anything changed: the lists kept for a moment (see kept) are asked for afresh.
  if (method !== 'GET') keptAt.clear();
  return data;
}
/** A long list (every job, the tracker), kept for a few seconds so that going from tab to tab, or
 *  back to a page, doesn't fetch and read it again each time. Anything you change clears it. */
const keptAt = new Map();
async function kept(path, ms = 15000) {
  const k = keptAt.get(path);
  if (k && Date.now() - k.at < ms) return k.data;
  const data = await api(path);
  keptAt.set(path, { at: Date.now(), data });
  return data;
}

/** In a browser (Remote access or the server), links open in a new tab and files download. */
function follow(r) {
  if (r?.url) window.open(r.url, '_blank', 'noopener');
  else if (r?.download) { const a = document.createElement('a'); a.href = r.download; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
  return r;
}

let toastTimer;
/** A short message at the bottom. `action` adds a button, e.g. { label: 'Undo', run: () => … }. */
/** Job Hunt's own dialog (the browser's says "jobhunt.localhost says"). Resolves to the chosen
 *  button's value and the text typed, or null when closed. */
function dialog({ title, text = '', input, placeholder = '', buttons }) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${input ? `<label class="field">${esc(input)}<input type="text" placeholder="${esc(placeholder)}"></label>` : ''}
      <div class="modal-btns">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = v => { back.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const field = back.querySelector('input');
    const pick = i => done(buttons[i].value == null ? null : { value: buttons[i].value, text: field ? field.value.trim() : '' });
    const key = e => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') { const d = buttons.findIndex(b => b.kind === 'primary'); if (d >= 0) pick(d); }
    };
    back.addEventListener('click', e => { if (e.target === back) done(null); const b = e.target.closest('[data-i]'); if (b) pick(Number(b.dataset.i)); });
    document.addEventListener('keydown', key);
    document.body.appendChild(back);
    (field || back.querySelector('.btn.primary') || back.querySelector('.btn')).focus();
  });
}
/** A yes/no question in Job Hunt's own dialog. */
const ask = async (text, ok = 'OK', danger = false) => !!(await dialog({ title: text, buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: ok, value: 'ok', kind: danger ? 'danger' : 'primary' }] }));

function toast(msg, err, action) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.hidden = true; action.run(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 7000 : action ? 8000 : 4000);
}

const ICON = {
  overview: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  applications: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  pipeline: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  cvs: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9.5" r="2.5"/><path d="M8 17c.6-2 2.1-3 4-3s3.4 1 4 3"/>',
  recruiters: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.4-.3 4.4 1.2 5 4.3"/>',
  add: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  documents: '<path d="M9 3h7l4 4v11H9z"/><path d="M16 3v4h4M5 7v14h11"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  results: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

/** Four places. Queue: what's waiting for you, and behind its last tab every job, wherever it stands. Inbox: the email about them. Calendar: interviews and reminders. Me: what you're looking for, your CVs and details, the files tailored from them, and how it's going. The same four are the phone's tabs. Settings (the gear) has the accounts, the job sources and the app itself. */
const NAV = [['overview', 'Queue'], ['inbox', 'Inbox'], ['calendar', 'Calendar'], ['cvs', 'Me'], ['results', 'Insights'], ['settings', 'Settings']];
/** Pages that belong to a place: a job, applying, review and every job to the Queue; the tailored files and the insights to Me; Recruiters to Inbox. */
const NAV_HOME = { job: 'overview', apply: 'overview', add: 'overview', applications: 'overview', pipeline: 'overview', review: 'overview', welcome: 'overview', leads: 'overview', documents: 'cvs', recruiters: 'inbox' };
/** Which place a page belongs to. What you're looking for is part of Me; where it looks is part of Settings. */
const placeOf = () => { const [page, arg] = (location.hash.slice(1) || 'overview').split('/'); return page === 'search' ? (arg === 'what' ? 'cvs' : 'settings') : page === 'applications' && arg === 'files' ? 'cvs' : NAV_HOME[page] || page; };
/** Each place's views, as the same row of tabs wherever you are in it. */
const placeTabs = (tabs, on) => `<nav class="tabs place-tabs">${tabs.map(([href, name, id]) => `<a href="${href}" class="${id === on ? 'on' : ''}">${name}</a>`).join('')}</nav>`;
const inboxTabs = on => placeTabs([['#inbox', 'Email', 'email'], ['#inbox/recruiters', 'Recruiters', 'recruiters']], on);
/** Me: what you're looking for, then what Job Hunt knows about you. */
const meTabs = (on, n) => placeTabs([['#search/what', 'Looking for', 'what'], ['#cvs', `CVs${n ? ` (${n})` : ''}`, 'cvs'], ['#cvs/details', 'About me', 'details'], ['#cvs/career', 'Career', 'career'], ['#applications/files', 'Tailored files', 'files']], on);
/** Career's two views, on the one tab: the paths your CV supports, and the skills that would help most. */
const careerSeg = on => `<nav class="mode career-seg" aria-label="Career"><a href="#cvs/career" class="${on === 'paths' ? 'on' : ''}">Paths you could take</a><a href="#cvs/coach" class="${on === 'skills' ? 'on' : ''}">Skills to build</a></nav>`;
const meHead = (on, about, n) => `<div class="head"><div class="grow"><h1>Me</h1><p class="muted">${about}</p></div><span class="save-state" ${on === 'what' ? '' : 'id="saveState"'} aria-live="polite">${['cvs', 'details'].includes(on) ? 'Changes save by themselves' : ''}</span></div>${meTabs(on, n)}`;
/** Settings' tabs: what belongs to no one place, and where Job Hunt looks for jobs. */
/** The job hunt, step by step: each a view of Pipeline and a kind of decision in the Queue, with how many are in it and what to do there. */
const FLOW = [
  ['pick', 'Pick', c => c.queued || 0, 'New matches that cleared your fit score. Tick the ones worth applying to: Job Hunt tailors your CV and writes a cover letter for each.', 'new matches'],
  ['approve', 'Approve', c => c.ready || 0, 'Each has a tailored CV and cover letter. Read them, change what you like, then approve.', 'tailored, to check'],
  ['submit', 'Submit', c => c.approved || 0, 'Approved. Apply on the company\'s site (Job Hunt fills in the form), or mark it applied if you already did.', 'approved, to send'],
  ['waiting', 'Waiting', c => c.applied || 0, 'Sent. Follow up after a week or two without a reply; close the ones that went quiet.', 'sent, no reply yet'],
  ['interviews', 'Interviews', c => (c.interviewing || 0) + (c.offer || 0), 'Interviews coming up, and offers.', 'and offers'],
];
/** Older addresses of the list of every job. */
const VIEWS = [['tracker', 'All jobs'], ['postings', 'All jobs'], ['skipped', 'All jobs']];
const INBOX_TABS = [['email', 'Email'], ['recruiters', 'Recruiters'], ['settings', `${svg('settings')}Settings`, 'tab-end']];
/** Inbox's top: its name, what the view is, its buttons, and its tabs. */
const inboxHead = (on, about, actions) => `<div class="head"><div class="grow"><h1>Inbox</h1><p class="muted">${about}</p></div><div class="row">${actions || ''}</div></div>${inboxTabs(on)}`;
const INBOX_ABOUT = 'Job email Job Hunt has read. Replies are saved as Gmail drafts for you to check and send, and messages are labelled under JobHunt/ in Gmail.';
/** Where Job Hunt keeps your files, and a way to choose another folder (setup and Settings). */
const filesCard = (st, setup) => `<section class="card"><header><h2>${setup ? 'Where to keep your files' : 'Your files'}</h2></header>
  <p class="muted">Your CVs, every tailored CV and cover letter, and backups go here${setup ? '. Most people keep them in Documents' : ''}. Job Hunt's own database stays in its program data, so a sync app like OneDrive can't damage it.</p>
  <form data-form="filesFolder" class="row" style="flex-wrap:nowrap;gap:6px"><input type="text" name="dir" value="${esc(st.files.folder)}" style="flex:1">
    <button class="btn" type="button" data-act="pickFolder" data-into="dir">Browse…</button><button class="btn primary" type="submit">${setup ? 'Use this folder' : 'Move here'}</button></form>
  <p class="muted small" style="margin-top:6px">Moving takes what's there now with it, and every application still finds its files.</p></section>`;
/** Profile's tabs: your CVs, the versions tailored from them, career paths, your details. */
const cvsTabs = (view, n) => '';
/** A page's heading with its tabs, for the pages that hold several views. */
/** A page's settings (tabs marked tab-end or tab-set) show as buttons at its top, by its main
 *  action, where they're easy to find; its views stay as tabs. */
const settingsButtons = (base, tabs, on) => tabs.filter(t => t[2]).map(([id, n]) =>
  `<a class="btn ${id === on ? 'on' : ''} set-btn" href="#${base}/${id}" ${id === on ? 'aria-current="page"' : ''}>${n.includes('<svg') ? n : `${svg('settings')}${n}`}</a>`).join('');
const tabbedHead = (title, about, actions, base, tabs, on) => `<div class="head"><div class="grow"><h1>${title}</h1><p class="muted">${about}</p></div>${actions || tabs.some(t => t[2]) ? `<div class="row">${settingsButtons(base, tabs, on)}${actions || ''}</div>` : ''}</div>
  <nav class="tabs">${tabs.filter(t => !t[2]).map(([id, n]) => `<a href="#${base}/${id}" class="${id === on ? 'on' : ''}">${n}</a>`).join('')}</nav>`;
/** The step that needs you first: what's furthest along comes before new matches (approve, submit, pick), then what's waiting. '' when there's nothing anywhere. */
function nextStepId(c = overview?.counts || {}) {
  return ['approve', 'submit', 'pick', 'waiting', 'interviews'].find(id => FLOW.find(f => f[0] === id)[2](c)) || '';
}
/** A list's sort and filters: shown on a wide window, folded under one line on a phone so the jobs come first. */
const foldFilters = (html, few) => `<details class="fold-filters${few ? ' few' : ''}" ${!few && matchMedia('(min-width: 761px)').matches && !matchMedia('(pointer: coarse) and (max-width: 1100px) and (max-height: 700px)').matches ? 'open' : ''}><summary class="btn ghost sm">${svg('settings')}Sort and filter<span class="caret">▾</span></summary>${html}</details>`;
/** Find any job, and add one you found: at the top of Today and Jobs. */
const findBox = () => `<button class="find-box" data-act="palette" title="Find any job (Ctrl+K)">${svg('search')}<span>Find a job…</span><kbd>Ctrl K</kbd></button>`;
/** The Queue's row of tabs, the same on every one of them: what's waiting (all of it, then by step), and
 *  last, every job wherever it stands. `on`: a step, '' for everything waiting, or 'jobs'. `view`: the
 *  Queue's List / One by one switch, shown on the waiting tabs. */
function queueTabs(on, view) {
  const all = overview ? queueItems(overview) : [];
  const n = k => all.filter(x => x.step === k).length;
  return `<nav class="tabs qsteps" aria-label="What's waiting, and every job"><a href="#overview" class="${on ? '' : 'on'}">Everything <span class="n">${queueCount(all)}</span></a>${FLOW.map(([id, name]) => `<a href="#overview/${id}" class="${id === on ? 'on' : ''}${n(id) ? '' : ' none'}">${id === 'waiting' ? 'Follow up' : name} <span class="n">${n(id)}</span></a>`).join('')}
      <a href="#leads" class="leads-tab${on === 'leads' ? ' on' : ''}${overview?.leads ? '' : ' none'}" title="People saying they're hiring and companies that just raised money: write to them directly">Leads <span class="n">${overview?.leads || 0}</span></a>
      <a href="#applications" class="all-jobs${on === 'jobs' ? ' on' : ''}" title="Every job Job Hunt has seen, wherever it stands: applied, closed, set aside">All jobs</a>
      ${view ? `<span class="tabs-gap"></span><span class="seg view-seg" role="group" aria-label="How to show them"><button type="button" data-act="queueView" data-view="list" class="${view === 'list' ? 'on' : ''}" title="Every listing at once">List</button><button type="button" data-act="queueView" data-view="one" class="${view === 'one' ? 'on' : ''}" title="One decision at a time, with everything you need to decide">One by one</button></span>` : ''}</nav>`;
}
/** Postings found but not scored yet, with the button that scores them now. */
function heldLine() {
  const waiting = overview?.held || 0;
  return waiting ? `<p class="small muted held-line">${waiting} posting${waiting === 1 ? '' : 's'} found and waiting to be scored (newest first, ${(overview?.running || []).includes('search') ? 'scoring now' : 'a batch every 45 minutes'}). <button class="btn sm" data-act="scoreHeld">Score them all now</button></p>` : '';
}
/** The top of the Jobs page: its name, find and add, and the steps. */
function jobsHead(extra = '') {
  return `<div class="head">
      <div class="grow"><h1>All jobs</h1><p class="muted">Every job Job Hunt has seen, wherever it stands. What needs you is under the other tabs.</p></div>
      <div class="row head-acts">${extra}<a class="btn" href="#add">${svg('add')}Add a job</a></div>
    </div>
    ${queueTabs('jobs')}`;
}
/** Scheduled searches: on, paused until a date, or off. A menu that says which, to change it. */
function pausedWords(paused) {
  if (!paused) return '';
  if (paused === 'off') return 'Daily search off';
  const d = new Date(paused);
  return `Daily search paused until ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
function scheduleMenu(paused, right = true) {
  const label = !paused ? 'Daily search: on' : paused === 'off' ? 'Daily search: off' : `Paused until ${new Date(paused).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const opt = (days, text) => `<button data-act="searchPause" data-days="${days}">${text}</button>`;
  return `<details class="menu sched-menu"><summary class="btn ghost${paused ? ' paused' : ''}" title="${paused ? esc(pausedWords(paused)) : 'Job Hunt searches once a day by itself'}">${svg('clock')}${label}<span class="caret">▾</span></summary><div class="menu-list${right ? ' right' : ''}">
      ${paused ? opt(0, 'Turn the daily search back on') : ''}
      ${opt(1, 'Pause for a day')}${opt(3, 'Pause for 3 days')}${opt(7, 'Pause for a week')}${opt(14, 'Pause for 2 weeks')}
      ${paused === 'off' ? '' : opt('off', 'Turn the daily search off')}
      <p class="muted small menu-note">You can still search by hand any time.</p>
    </div></details>`;
}
const STAGES = {
  queued: 'Pick to tailor', ready: 'Ready to approve', approved: 'Approved – submit it', applied: 'Applied',
  interviewing: 'Interviewing', offer: 'Offer', rejected: 'Rejected', no_response: 'No response', skipped: 'Skipped', dismissed: 'Not interested', saved: 'Saved for later',
};
const BOARD = ['queued', 'ready', 'approved', 'applied', 'interviewing', 'offer', 'rejected'];
const CATEGORY = {
  interview_request: ['Interview request', 'good'], interview_confirmed: ['Interview booked', 'good'], assessment: ['Assessment', 'info'],
  rejection: ['Rejection', 'crit'], offer: ['Offer', 'good'], application_received: ['Received', ''], recruiter_outreach: ['Recruiter', 'info'],
  job_alert: ['Job alert', ''], other_job_related: ['Other', ''],
};

let overview = null;

// ---- formatting ----
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
/** A posting's date as the source gave it (ISO time, Unix time, or words), shown like Found. */
/** When the job site says the posting went up, as { at, dateOnly }, or null when it doesn't say.
 *  Mirrors posted_date on the server: Unix times, ISO times, and dates (2026-10-16 or 20261016). */
function postedWhen(raw) {
  if (raw == null || raw === '') return null;
  const t = String(raw).split('|').pop().trim(); // "source|date" from email alerts
  const noon = (y, m, d) => ({ at: new Date(+y, +m - 1, +d, 12), dateOnly: true });
  if (/^\d{9,13}$/.test(t)) { const n = Number(t); const d = new Date(n < 1e12 ? n * 1000 : n); return d.getFullYear() >= 2000 ? { at: d, dateOnly: false } : null; }
  let m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (m) return noon(m[1], m[2], m[3]);
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})T(.*)$/);
  if (m) {
    // Midnight UTC is a date with no time given: keep it on its own day wherever you are.
    if (/^00:00(:00(\.0+)?)?(Z|[+-]00:?00)$/.test(m[4])) return noon(m[1], m[2], m[3]);
    const d = new Date(t); if (!isNaN(d)) return { at: d, dateOnly: false };
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? noon(m[1], m[2], m[3]) : null;
}
const fullWhen = (d, dateOnly) => d.toLocaleString(undefined, dateOnly ? { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' } : { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** How old the posting is ("5 days old"); hover for the exact date and time. When the job site
 *  doesn't say, how long ago Job Hunt found it. */
function ageTag(j) {
  const p = postedWhen(j.posted_at);
  const found = j.found_at ? new Date(j.found_at) : null;
  const at = p ? p.at : found;
  if (!at || isNaN(at)) return '';
  const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const days = Math.max(0, Math.round((day(Date.now()) - day(at)) / 86400000));
  const hours = Math.floor((Date.now() - at) / 3600000);
  const span = days === 0 ? (p && !p.dateOnly && hours >= 1 ? `${hours} h` : '') : days < 60 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.round(days / 30)} months`;
  const text = p ? (span ? `${span} old` : 'Posted today') : (span ? `Found ${span} ago` : 'Found today');
  const tip = [p ? `Posted ${fullWhen(p.at, p.dateOnly)}${p.dateOnly ? ' (the job site gives the date only)' : ''}` : "The job site didn't say when it was posted.",
    found && !isNaN(found) ? `Found by Job Hunt ${fullWhen(found, false)}` : ''].filter(Boolean).join('\n');
  return `<span class="age${days > 30 ? ' old' : ''}${p ? '' : ' unsure'}" title="${esc(tip)}" data-at="${esc(at.toISOString())}">${esc(text)}</span>`;
}
// Tapping a posting's age (on a phone there's no hovering) shows the exact date and time, without
// also opening the row or ticking the box it sits in. Caught first, before those handlers run.
// A company's stars open what its employees say, without opening the row or ticking its box.
document.addEventListener('click', e => {
  const star = e.target.closest?.('.stars[data-company]');
  if (!star) return;
  e.preventDefault(); e.stopPropagation();
  showReviews(star.dataset.company);
}, true);
document.addEventListener('keydown', e => {
  const star = e.target.closest?.('.stars[data-company]');
  if (star && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showReviews(star.dataset.company); }
});
document.addEventListener('click', e => {
  const tag = e.target.closest?.('.age');
  if (!tag) return;
  e.preventDefault(); e.stopPropagation();
  toast(tag.title.split('\n').map(x => x.replace(/\.$/, '')).join('. ') + '.');
}, true);
const ageValue = j => (postedWhen(j.posted_at)?.at || new Date(j.found_at || 0)).toISOString?.() || '';
const fmtWhen = iso => iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
const pct = x => x == null ? '–' : `${Math.round(x * 100)}%`;
const scoreBand = n => n >= 80 ? 'hi' : n >= 60 ? 'mid' : 'lo';
const scoreBadge = n => n == null ? '' : `<span class="score ${scoreBand(n)}" style="--p:${n}" title="Fit score">${n}</span>`;
/** Company and location as their own cells: the company with its rating, a dash for no place. */
const coCell = j => `${esc(j.company)}${ratingTag(j.rating, j.company)}`;
/** Country names as a place line spells them, and the short form a remote role shows: "Remote (US)". */
const COUNTRY_SHORT = [[/^(united states( of america)?|usa|u\.?s\.?a?\.?)$/i, 'US'], [/^canada$/i, 'Canada'], [/^(united kingdom|uk|great britain|england)$/i, 'UK'],
  [/^(australia|ireland|germany|france|india|netherlands|spain|singapore|kuwait|qatar|united arab emirates|uae|saudi arabia|new zealand|mexico|brazil|poland|portugal|italy|sweden|switzerland|japan|philippines|south africa)$/i, null]];
const countryOf = s => { for (const [re, short] of COUNTRY_SHORT) if (re.test(s.trim())) return short || s.trim(); return null; };
/** A posting's place, short. Job sites send a city ("Toronto, ON"), a long list ("United States of America, Eagan,
 *  Minnesota; …; Canada, Toronto, Ontario") or remote ("Remote - US"). Shows the one nearest your places with
 *  "+N more", and remote roles as "Toronto (remote)" or "Remote (US)". The full text stays in the tooltip. */
function placeShort(raw) {
  const all = String(raw || '').trim();
  if (!all) return '';
  const how = /\bremote\b|work from home|\bwfh\b/i.test(all) ? 'remote' : /\bhybrid\b/i.test(all) ? 'hybrid' : '';
  let country = null;
  const places = all.split(/\s*(?:;|\||\n|\s\/\s|•)\s*/).map(p => {
    const bits = p.replace(/\(?\b(remote|hybrid|on-?site|in-?office|work from home|wfh|anywhere)\b\)?/ig, ' ').replace(/[()]/g, ' ')
      .split(/\s*,\s*|\s+[–-]\s+|^\s*[–-]\s*|\s*[–-]\s*$/).map(b => b.trim()).filter(Boolean);
    const rest = bits.filter(b => { const c = countryOf(b); if (c) country = country || c; return !c; });
    return rest.slice(0, 2).join(', ');
  }).filter(Boolean);
  const mine = (overview?.places || []).map(p => String(p).split(',')[0].trim().toLowerCase()).filter(Boolean);
  const pick = places.find(p => mine.some(m => p.toLowerCase().includes(m))) || places[0];
  const more = places.length > 1 ? ` +${places.length - 1} more` : '';
  if (!pick) return how === 'remote' ? `Remote${country ? ` (${country})` : ''}` : how === 'hybrid' ? 'Hybrid' : all;
  return `${pick}${how ? ` (${how})` : ''}${more}`;
}
/** The place as shown, with the posting's own text on hover when it was shortened. */
const placeHtml = j => {
  const s = placeShort(j.location);
  if (s === j.location) return esc(s);
  const [, place, more] = s.match(/^(.*?)( \+\d+ more)?$/);
  return `<span title="${esc(j.location)}">${esc(place)}${more ? ` <span class="more-places">${esc(more.trim())}</span>` : ''}</span>`;
};
const locCell = j => j.location ? placeHtml(j) : '<span class="muted">–</span>';
/** On a phone the columns fold: company and place under the role. */
const coLocLine = j => `<span class="phone-only"><br><span class="muted small">${esc(j.company)}${j.location ? ` · ${placeHtml(j)}` : ''}</span></span>`;
/** A company's employee rating, as a small star tag with the rating out of 5. */
const ratingTag = (r, company) => r?.found && r.rating != null ? ` <span class="stars ${r.rating >= 4 ? 'hi' : r.rating >= 3.3 ? 'mid' : 'lo'}${company ? ' open-reviews' : ''}" ${company ? `data-company="${esc(company)}" role="button" tabindex="0"` : ''} title="Employees rate it ${r.rating.toFixed(1)} out of 5${r.reviews ? `, ${r.reviews.toLocaleString()} reviews` : ''}${r.source ? ` on ${esc(r.source)}` : ''}${company ? '. Click for what they say.' : ''}">${svg('star')}${r.rating.toFixed(1)}</span>` : '';
/** What employees say about a company, in a popup over the page you're on (a star was clicked). */
async function showReviews(company) {
  let r;
  try { r = (await api(`/api/rating?company=${encodeURIComponent(company)}`)).rating; } catch (e) { toast(e.message, true); return; }
  const back = document.createElement('div');
  back.className = 'modal-back';
  // The job page's card, without its Look again button (that one belongs to the job page).
  const card = ratingCard(r, false, company).replace(/<button[^>]*data-act="rateCompany"[^>]*>.*?<\/button>/, '');
  back.innerHTML = `<div class="modal reviews-modal" role="dialog" aria-modal="true" aria-label="What employees say about ${esc(company)}">
    <h2>${esc(company)}</h2>${card}
    <div class="modal-btns">${r?.url ? `<button class="btn" data-act="link" data-url="${esc(r.url)}">Read the reviews on ${esc(r.source || 'the site')}</button>` : ''}<button class="btn primary" data-close>Close</button></div></div>`;
  const done = () => { back.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') done(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) done(); });
  document.addEventListener('keydown', key);
  document.body.appendChild(back);
  back.querySelector('[data-close]').focus();
}
/** What employees say, as a card for the job page. */
function ratingCard(r, busy, company) {
  const head = `<header><h2>What employees say</h2>${busy ? '<span class="muted small"><span class="spin" data-kind="ratings"></span>Looking…</span>' : `<button class="btn ${r ? 'ghost' : ''} sm" data-act="rateCompany">${r ? 'Look again' : 'Look up reviews'}</button>`}</header>`;
  if (!r) return `<section class="card">${head}<p class="muted">Ratings and reviews of ${esc(company)} from Glassdoor, Indeed and the like: what people who work there praise and complain about. Job Hunt looks them up by itself for roles you're considering.</p></section>`;
  if (!r.found) return `<section class="card">${head}<p class="muted">No employee reviews of ${esc(company)} were found (${esc(fmtDate(r.at))}). Smaller employers often have none.</p></section>`;
  const five = n => n == null ? '' : `<b>${n.toFixed(1)}</b><span class="muted"> / 5</span>`;
  const list = (label, xs, cls) => (xs || []).length ? `<div class="small ${cls}"><b>${label}</b><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `<section class="card">${head}
    <div class="row" style="gap:22px;align-items:flex-end">
      <div><div class="big-stars ${r.rating >= 4 ? 'hi' : r.rating >= 3.3 ? 'mid' : 'lo'}">${svg('star')}${r.rating.toFixed(1)}</div><span class="muted small">${r.reviews ? `${r.reviews.toLocaleString()} reviews` : 'reviews'}${r.source ? ` on ${r.url ? `<a href="#" data-act="link" data-url="${esc(r.url)}">${esc(r.source)}</a>` : esc(r.source)}` : ''}</span></div>
      ${r.work_life != null ? `<div class="small">Work-life balance<br>${five(r.work_life)}</div>` : ''}
      ${r.recommend != null ? `<div class="small">Would recommend it<br><b>${r.recommend}%</b></div>` : ''}
    </div>
    ${r.summary ? `<p class="small">${esc(r.summary)}</p>` : ''}
    <div class="proscons">${list('Praised', r.pros, 'pro')}${list('Complaints', r.cons, 'con')}</div>
    ${(r.others || []).length ? `<p class="muted small">Also: ${r.others.map(o => `${o.url ? `<a href="#" data-act="link" data-url="${esc(o.url)}">${esc(o.source)}</a>` : esc(o.source)} ${o.rating.toFixed(1)}${o.reviews ? ` (${o.reviews.toLocaleString()})` : ''}`).join(' · ')}</p>` : ''}
    <p class="muted small">Looked up ${esc(fmtDate(r.at))}. Reviews are opinions, and a few can swing a small company's score.</p></section>`;
}
/** The predicted fit after tailoring, while it isn't tailored yet: "could reach ~85". */
const canReach = j => j.score_after == null && j.score_potential != null && j.score != null && j.score_potential >= j.score ? j.score_potential : null;
/** On a phone a row shows one fit badge (the tailored CV's once there is one) and says the other
 *  figure in words under it: "was 76", or "~97 tailored" while it's a forecast. */
const fitNote = j => j.score != null && j.score_after != null && j.score_after !== j.score
  ? `<small class="fit-note">was ${j.score}</small>`
  : canReach(j) && canReach(j) > j.score ? `<small class="fit-note">~${canReach(j)} tailored</small>` : '';
/** After the fit badge: the tailored CV's fit as a second badge, or the forecast one (dashed) before tailoring. */
const reachTag = j => j.score != null && j.score_after != null && j.score_after !== j.score
  ? `<span class="reach"><span class="reach-arrow">→</span><span class="score ${scoreBand(j.score_after)}" style="--p:${j.score_after}" title="Fit of the tailored CV">${j.score_after}</span></span>`
  : canReach(j) ? `<span class="reach"><span class="reach-arrow">→</span><span class="score forecast ${scoreBand(canReach(j))}" style="--p:${canReach(j)}" title="${canReach(j) > j.score ? 'Predicted fit once your CV is tailored to this posting' : 'Tailoring is unlikely to raise this fit: the gap is in experience, not wording'}">~${canReach(j)}</span></span>` : '';
const trackLabel = t => (settingsCache?.profile?.tracks || []).find(x => x.name === t)?.label || overview?.track_labels?.[t] || (t || '').replace(/[-_]/g, ' ');
const stagePill = s => `<span class="pill ${esc(s)}">${esc(STAGES[s] || s)}</span>`;
/** When the posting stops taking applications, if it says; red when it's two days or less away. */
function deadlineTag(j) {
  if (!j.deadline || j.closed_at || expiredWhy(j) || !['queued', 'ready', 'approved', 'skipped', 'saved'].includes(j.status)) return '';
  const days = Math.round((new Date(j.deadline + 'T23:59:59') - Date.now()) / 86400000);
  if (days < 0 || days > 21) return '';
  return `<span class="pill ${days <= 2 ? 'crit' : 'warn'}" title="Last day to apply: ${esc(j.deadline)}">Closes ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : esc(fmtDate(j.deadline + 'T12:00:00'))}</span>`;
}
/** Filtered out for being outside your locations: hidden from every list. */
const outsideYours = j => j.status === 'skipped' && /^Filtered out: location/.test(j.reasoning || '');
/** Stages where a posting that's no longer open still matters: you haven't applied yet. */
const BEFORE_APPLYING = ['queued', 'ready', 'approved', 'saved', 'skipped'];
/** Why a posting you haven't applied to is no longer open, or '': taken down (closed_at), or its last
 *  day to apply has passed. */
function expiredWhy(j) {
  if (!BEFORE_APPLYING.includes(j.status)) return '';
  if (j.closed_at) return `Expired: Job Hunt noticed on ${fmtDate(j.closed_at)} that the company took it down or stopped taking applications`;
  if (j.deadline && new Date(j.deadline + 'T23:59:59') < Date.now()) return `Expired: the last day to apply was ${fmtDate(j.deadline + 'T12:00:00')}`;
  return '';
}
/** A tag for postings that are no longer open, and for ones to check before putting time in. */
const closedTag = j => (expiredWhy(j) ? `<span class="pill crit expired" title="${esc(expiredWhy(j))}">Expired</span>` : '')
  + ((j.warnings || []).length ? ` <span class="pill warn" title="${esc(j.warnings.join('\n'))}">Check first</span>` : '');
function eventText(e) {
  const k = e.kind;
  if (k.startsWith('status:')) return `Moved to <b>${esc(STAGES[k.slice(7)] || k.slice(7))}</b>${e.detail ? ` · ${esc(e.detail)}` : ''}`;
  if (k.startsWith('email:')) return `Email: ${esc((CATEGORY[k.slice(6)] || [k.slice(6)])[0])} · ${esc(e.detail)}`;
  if (k.endsWith(':error')) return `<span style="color:var(--crit)">Problem</span> · ${esc(e.detail)}`;
  if (k === 'backup' && e.detail.startsWith('saved ')) return 'Backup saved';
  const names = { scored: 'Scored', tailored: 'Tailored', rescored: 'Fit re-checked', skipped: 'Skipped', search: 'Job search', inbox: 'Email check', added: 'Added', calendar: 'Calendar', revised: 'Changed', followup: 'Follow-up', closed: 'Closed', check: 'Postings checked', prep: 'Interview prep', answers: 'Application questions', offer: 'Offer', contact: 'Contact', insights: 'Insights', weekly: 'Weekly summary', discover: 'Employers', thanks: 'Thank-you note', career: 'Career paths', coach: 'Career coach', care: 'Interview reminders', 'apply-link': 'Company site', ratings: 'Company ratings', 'added-again': 'Sent again', forecast: 'Fit forecast' };
  return `${esc(names[k] || k)} · ${esc(e.detail)}`;
}
const jobLink = e => e.job_id ? `<a href="#job/${encodeURIComponent(e.job_id)}">${esc(e.company)} – ${esc(e.title)}</a> · ` : '';

// ---- shell ----
const MODES = { auto: ['Auto: follows your device', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'], light: ['Light', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'], dark: ['Dark', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'] };
/** The phone's top bar, right of the name: what the search is doing, email, sync, anything that needs
 *  a look, find, and one button that steps through Auto, Light and Dark. Drawn here, not in the page,
 *  so a page kept from an older version has no menu button left over. */
function phoneTop() {
  const top = $('.mtop');
  if (!top || $('#mTheme')) return;
  top.querySelectorAll('.mstatus, .mbtn, .mchip').forEach(e => e.remove());
  $('#settingsLink')?.remove();
  const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  top.insertAdjacentHTML('beforeend', `<span class="mstats">
    <a class="mstatus" id="mStatus" href="#search"><span class="dot" id="mDot"></span><span id="mNote"></span><span id="mNoteShort"></span></a>
    <a class="mchip" id="mGoogle" href="#settings/connections">${ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}<span class="dot" id="mDotGoogle"></span><span class="mchip-t" id="mGoogleNote"></span></a>
    <a class="mchip" id="mSync" href="#settings/sync">${ic('<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1-.5 7.5z"/>')}<span class="dot" id="mDotSync"></span><span class="mchip-t" id="mSyncNote"></span></a>
    <a class="mchip" id="mWarn" href="#settings/connections" hidden><span class="dot warn"></span><span class="mchip-t" id="mWarnNote"></span></a></span>
    <button type="button" class="mbtn" data-act="palette" aria-label="Find a job">${ic('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>')}</button>
    <button type="button" class="mbtn" id="mTheme" data-act="themeCycle"></button>`);
  showTheme();
}
/** The desktop bar, right of the places: what the search is doing, email and sync each as their own
 *  chip (as on a phone), anything that needs a look, and one button for Auto, Light and Dark. The
 *  old pop-up that held them stays in the page, hidden, as where their words are worked out. */
function deskTop() {
  const pop = $('#statusPop');
  if (!pop || $('#dTheme')) return;
  const ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  pop.insertAdjacentHTML('beforebegin', `<span class="dstats">
    <a class="status-pill" id="dRun" href="#search" title="What the search found"><span class="dot" id="dDotRun"></span><span id="dRunNote"></span></a>
    <a class="dchip" id="dGoogle" href="#settings/connections">${ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}<span class="dot" id="dDotGoogle"></span><span class="dchip-t" id="dGoogleNote"></span></a>
    <a class="dchip" id="dSync" href="#settings/sync">${ic('<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1-.5 7.5z"/>')}<span class="dot" id="dDotSync"></span><span class="dchip-t" id="dSyncNote"></span></a>
    <a class="dchip warn" id="dWarn" href="#settings/connections" hidden><span class="dot warn"></span><span class="dchip-t" id="dWarnNote"></span></a>
    <a class="dchip warn" id="dUp" href="#settings/app" hidden><span class="dot warn"></span><span class="dchip-t">Update ready</span></a></span>
    <button type="button" class="dtheme" id="dTheme" data-act="themeCycle"></button>`);
  pop.hidden = true;
  showTheme();
}
function renderNav() {
  phoneTop();
  deskTop();
  const active = placeOf();
  // The badge: what's waiting on you. New matches to pick from aren't counted, or it would never clear.
  const waiting = overview ? queueCount(queueItems(overview).filter(x => x.step !== 'pick')) : 0;
  const mailNew = overview?.inbox_new || 0;
  $('#nav').innerHTML = NAV.map(([id, name, group]) =>
    `<a href="#${id}" class="${id === active ? 'on' : ''}">${svg(id)}${name}${id === 'overview' && waiting ? `<span class="badge" title="${waiting} decision${waiting === 1 ? '' : 's'} waiting (new matches to pick from aren't counted)">${waiting}</span>` : ''}${id === 'inbox' && mailNew ? `<span class="badge" title="${mailNew} new email${mailNew === 1 ? '' : 's'} about your applications (job alerts and receipts aren't counted)">${mailNew}</span>` : ''}</a>`).join('');
  const running = overview?.running || [];
  const busy = running.includes('search') ? (overview?.progress?.scoring ? `${overview.progress.paused ? 'Scoring paused' : 'Scoring waiting postings…'} ${overview.progress.done ?? 0} of ${overview.progress.total ?? 0}` : `${overview?.progress?.paused ? 'Search paused' : 'Searching for jobs…'} ${overview?.progress?.percent ?? 0}%`) : running.includes('inbox') ? 'Checking email…'
    : running.some(r => r.startsWith('tailor') || r === 'add') ? 'Tailoring…' : '';
  const side = overview?.side || {};
  const nextSearch = side.next_search ? new Date(side.next_search) : null;
  const when = d => {
    const t = new Date(); const tm = new Date(+t + 86400000);
    return d.toDateString() === t.toDateString() ? `today ${timeOf(d)}` : d.toDateString() === tm.toDateString() ? `tomorrow ${timeOf(d)}` : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${timeOf(d)}`;
  };
  $('#dotRun').className = 'dot' + (busy ? ' busy' : ' on');
  $('#mDot').className = 'dot' + (busy ? ' busy' : ' on');
  $('#mNote').textContent = busy || (overview?.last_search ? `Searched ${ago(overview.last_search)}` : '');
  // On a narrow phone, just the time (or how far along it is).
  $('#mNoteShort').textContent = busy ? (busy.match(/\d+%/)?.[0] || 'Working…') : overview?.last_search ? ago(overview.last_search) : '';
  // The phone's tab bar: the four used most, and More for the rest (and the status lines).
  // The phone's tabs are the same five places; the top bar's menu button has Settings, the status lines and the theme.
  $('#tabbar').innerHTML = NAV.map(([id, name]) =>
    `<a href="#${id}" class="${id === active ? 'on' : ''}">${svg(id)}<span>${name}</span>${id === 'overview' && waiting ? `<span class="badge">${waiting > 99 ? '99+' : waiting}</span>` : ''}</a>`).join('');
  const alert = !$('#connLine')?.hidden || !$('#limitLine')?.hidden || !$('#updateNote')?.hidden;
  $('#statusPop')?.classList.toggle('alert', alert);
  updateSearchCtl();
  $('#runNote').textContent = busy || `Searched ${ago(overview?.last_search)}${side.paused ? ` · ${side.paused === 'off' ? 'daily search off' : `paused until ${new Date(side.paused).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}` : ''}`;
  $('#dotRun').className = 'dot' + (busy ? ' busy' : side.paused ? ' warn' : ' on');
  const g = overview?.setup?.google;
  $('#dotGoogle').className = 'dot' + (g ? ' on' : '');
  const off = (overview?.setup?.skipped || []).includes('google');
  $('#googleLine').hidden = !g && off;
  $('#googleNote').textContent = g ? (overview?.last_inbox ? `Email checked ${ago(overview.last_inbox)}` : 'Gmail & Calendar connected') : 'Google not connected';
  // Sync when it's on, else backups.
  const sync = side.sync_on;
  const at = sync ? side.last_sync : side.last_backup;
  const stale = !at || Date.now() - new Date(at) > (sync ? 2 : 3) * 86400000;
  $('#dotSync').className = 'dot' + (sync && side.sync_error ? ' crit' : side.syncing ? ' busy' : stale ? ' warn' : ' on');
  $('#syncNote').textContent = sync ? (side.syncing ? 'Syncing…' : side.sync_error ? 'Sync didn\'t work' : at ? `Synced ${ago(at)}` : 'Not synced yet') : (at ? `Backed up ${ago(at)}` : 'No backup yet');
  $('#syncLine').title = sync && side.sync_error ? side.sync_error : sync ? `Syncing to ${side.sync_where === 'drive' ? 'Google Drive' : 'your sync folder'}. Open Sync & backup to sync now.` : 'Daily backups. Open Sync & backup to sync to Google Drive.';
  $('#syncLine').hidden = overview?.kind === 'server' && !sync && !at;
  // The phone's chips: the same lines, short. The words show when there's room; the dot always does.
  const chip = (id, line, dot, note, short) => { const el = $(id); if (!el) return; el.hidden = $(line).hidden; el.title = $(note).textContent; el.setAttribute('aria-label', $(note).textContent); $(id.replace(/^#(.)/, '#$1Dot')).className = $(dot).className; $(`${id}Note`).textContent = short; };
  // The desktop bar's chips: the same lines.
  chip('#dGoogle', '#googleLine', '#dotGoogle', '#googleNote', g ? (overview?.last_inbox ? `Email ${ago(overview.last_inbox)}` : 'Email on') : 'Email off');
  chip('#dSync', '#syncLine', '#dotSync', '#syncNote', $('#syncNote').textContent);
  if ($('#dRunNote')) { $('#dRunNote').textContent = $('#runNote').textContent; $('#dDotRun').className = $('#dotRun').className; }
  chip('#mGoogle', '#googleLine', '#dotGoogle', '#googleNote', g ? (overview?.last_inbox ? `Email ${ago(overview.last_inbox)}` : 'Email on') : 'Email off');
  chip('#mSync', '#syncLine', '#dotSync', '#syncNote', $('#syncNote').textContent);
  if ($('#mStatus')) $('#mStatus').title = 'What the search found';
  const lim = side.claude_limited_until && new Date(side.claude_limited_until) > new Date();
  $('#limitLine').hidden = !lim && !side.deferred;
  $('#limitNote').textContent = lim ? `Claude limit until ${new Date(side.claude_limited_until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : `${side.deferred} batch${side.deferred === 1 ? '' : 'es'} waiting for tonight`;
  $('#connLine').hidden = !side.conn_problems;
  $('#connNote').textContent = `${side.conn_problems} connection${side.conn_problems === 1 ? '' : 's'} need${side.conn_problems === 1 ? 's' : ''} attention`;
  // The phone's amber chip: a Claude limit or a connection that needs a look.
  const warn = $('#mWarn');
  if (warn) { const what = !$('#connLine').hidden ? $('#connNote').textContent : !$('#limitLine').hidden ? $('#limitNote').textContent : ''; warn.hidden = !what; warn.title = what; warn.setAttribute('aria-label', what); $('#mWarnNote').textContent = !$('#connLine').hidden ? 'Check connections' : 'Claude limit'; }
  const dWarn = $('#dWarn');
  if (dWarn) { const what = !$('#connLine').hidden ? $('#connNote').textContent : !$('#limitLine').hidden ? $('#limitNote').textContent : ''; dWarn.hidden = !what; dWarn.title = what; $('#dWarnNote').textContent = what; $('#dUp').hidden = $('#updateNote').hidden; }
  if (overview?.version) $('#versionNote').textContent = `Job Hunt ${shortVersion(overview.version)}`;
  // Under the name, top left: the version, which opens what's new in it.
  if (overview?.version) document.querySelectorAll('[data-version]').forEach(el => { el.textContent = `Version ${shortVersion(overview.version)}`; });
}

let overviewAt = 0, scrollToAfter = '';
async function refreshOverview() {
  // Nothing changed since what's on screen: the app says only that, and nothing is redrawn.
  try {
    const o = await api(`/api/overview${overview?.rev ? `?have=${overview.rev}` : ''}`);
    overviewAt = Date.now();
    if (o.same) return;
    overview = o;
  } catch (e) { return; }
  renderNav();
}

const main = () => $('#main');
// Something typed, ticked or chosen on this page that isn't saved yet: the background refresh
// leaves the page alone until it's redrawn by your own action.
let pageDirty = false;
document.addEventListener('input', e => { if (e.target.closest?.('#main') && !e.target.dataset.act && e.target.type !== 'search') pageDirty = true; });
/** A list kept as lines in a text box, shown as chips: type and press Enter (or a comma) to add one,
 *  × to take one away. The text box stays the value, so saving works as it did. */
function chipify(root) {
  root.querySelectorAll('textarea[data-chips]:not([data-chipped])').forEach(ta => {
    ta.dataset.chipped = '1';
    ta.hidden = true;
    const box = document.createElement('div');
    box.className = 'chips-in';
    const list = () => ta.value.split(/\n/).map(x => x.trim()).filter(Boolean);
    const set = l => { ta.value = l.join('\n'); for (const t of ['input', 'change']) ta.dispatchEvent(new Event(t, { bubbles: true })); draw(); };
    const draw = () => {
      box.innerHTML = `${list().map((x, i) => `<span class="chip">${esc(x)}<button type="button" data-i="${i}" aria-label="Remove ${esc(x)}">×</button></span>`).join('')}<input type="text" class="chip-add" placeholder="${esc(ta.dataset.add || 'Add')}…" aria-label="${esc(ta.dataset.add || 'Add')}">`;
    };
    // The box is emptied before the chips are drawn again: drawing takes the focus from it, and what
    // was typed must not be added a second time as it goes.
    const add = input => { const v = input.value.split(/,|\n/).map(x => x.trim()).filter(Boolean); input.value = ''; if (!v.length) return false; set([...list(), ...v.filter(x => !list().some(y => y.toLowerCase() === x.toLowerCase()))]); box.querySelector('.chip-add').focus(); return true; };
    box.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); const l = list(); l.splice(Number(b.dataset.i), 1); set(l); } });
    box.addEventListener('keydown', e => {
      if (!e.target.matches('.chip-add')) return;
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); e.stopPropagation(); add(e.target); }
      else if (e.key === 'Backspace' && !e.target.value && list().length) { const l = list(); l.pop(); set(l); box.querySelector('.chip-add').focus(); }
    });
    box.addEventListener('focusout', e => { if (e.target.matches('.chip-add') && e.target.value.trim()) add(e.target); });
    // Typing in the box mustn't count as an edit of the form by itself: only the list does.
    box.addEventListener('input', e => { if (e.target.matches('.chip-add')) e.stopPropagation(); });
    box.addEventListener('change', e => { if (e.target.matches('.chip-add')) e.stopPropagation(); });
    ta.after(box);
    draw();
  });
}
// A slider beside a number box: each follows the other.
document.addEventListener('input', e => {
  const t = e.target;
  if (t.matches?.('[data-range-for]')) { const n = t.closest('.range-row')?.querySelector(`[name="${t.dataset.rangeFor}"]`); if (n && n.value !== t.value) { n.value = t.value; n.dispatchEvent(new Event('input', { bubbles: true })); } }
  else if (t.name && t.closest?.('.range-row')) { const r = t.closest('.range-row').querySelector('[data-range-for]'); if (r && r.value !== t.value) r.value = t.value; }
});
document.addEventListener('change', e => { const t = e.target; if (t.matches?.('[data-range-for]')) { const n = t.closest('.range-row')?.querySelector(`[name="${t.dataset.rangeFor}"]`); if (n) n.dispatchEvent(new Event('change', { bubbles: true })); } });

function page(html) {
  pageDirty = false;
  main().innerHTML = `<div class="page">${updateBarHtml()}${html}</div>`;
  chipify(main());
  requestAnimationFrame(fitTabs);
  // Only the job page sets these; elsewhere actions name their job themselves.
  delete main().dataset.job;
  delete main().dataset.status;
}

/** Tab bars that don't fit the window: the tabs past the edge go into a "More" menu, so none is
 *  hidden off screen. The tab you're on and a page's own settings tabs (⚙) always stay in view. Run
 *  after each page is drawn and when the window is resized. Phones wrap their tabs instead. */
function fitTabs() {
  document.querySelectorAll('nav.tabs').forEach(nav => {
    // Put back what an earlier fit moved, then measure afresh.
    const old = nav.querySelector(':scope > .tabs-more');
    if (old) { old.querySelectorAll('.menu-list > a').forEach(a => nav.insertBefore(a, old)); old.remove(); }
    nav.classList.remove('fitted');
    if (getComputedStyle(nav).flexWrap === 'wrap' || getComputedStyle(nav).overflowX === 'auto' || nav.scrollWidth <= nav.clientWidth + 1) return;
    const links = [...nav.querySelectorAll(':scope > a')];
    const more = document.createElement('details');
    more.className = 'menu tabs-more';
    more.innerHTML = '<summary>More <span class="caret">▾</span></summary><div class="menu-list right"></div>';
    nav.insertBefore(more, nav.querySelector(':scope > a.tab-end') || null);
    nav.classList.add('fitted'); // the menu opens past the bar's edge
    const list = more.querySelector('.menu-list');
    const keep = a => a === links[0] || a.classList.contains('on') || a.classList.contains('tab-end') || a.classList.contains('tab-set');
    // From the last movable tab back, until the bar fits.
    for (const a of links.filter(a => !keep(a)).reverse()) {
      if (nav.scrollWidth <= nav.clientWidth + 1) break;
      list.prepend(a);
    }
    if (!list.children.length) { more.remove(); nav.classList.remove('fitted'); return; }
    more.querySelector('summary').firstChild.textContent = `More (${list.children.length}) `;
    list.addEventListener('click', () => { more.open = false; });
  });
}
let fitTimer;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitTabs, 120); });

let routeSeq = 0, routeDone = 0;
async function route() {
  const mine = ++routeSeq;
  try { await showRoute(); } finally {
    // A slower, older load can finish after a newer one and paint over it: draw the current page again.
    if (mine < routeDone) route(); else routeDone = mine;
  }
}

let shownKey = '', pageKey = '';
async function showRoute() {
  pageKey = '';
  const [name, ...rest] = (location.hash.slice(1) || 'overview').split('/');
  const arg = decodeURIComponent(rest.join('/'));
  renderNav();
  try {
    if (name === 'overview' && overview?.setup && !overview.setup.cvs && !welcomed()) { location.hash = '#welcome'; return; }
    if (name === 'documents' || (name === 'pipeline' || name === 'overview' || name === 'cvs') && arg === 'documents') { location.replace('#applications/files'); return; }
    if (name === 'pipeline' || name === 'overview' && (arg === 'board' || arg === 'list' || VIEWS.some(([id]) => id === arg))) { location.replace('#applications/all'); return; }
    if (name === 'overview' && arg === 'ready') { location.replace('#overview/approve'); return; }
    // A page's settings are tabs of Settings.
    if ((name === 'inbox' || name === 'calendar') && arg === 'settings') { location.replace(`#settings/${name}`); return; }
    if (name === 'cvs' && arg === 'coach') await showCoach();
    // A step of the hunt is the Queue's: an old link to it in the Pipeline goes there, as a list.
    else if (name === 'applications' && FLOW.some(([id]) => id === arg)) { location.replace(`#overview/${arg}/list`); return; }
    else if (name === 'applications') { if (!overview || Date.now() - overviewAt > 1500) await refreshOverview(); await showPipeline(arg); }
    else if (name === 'overview') await showOverview(arg);
    else if (name === 'leads') { if (!overview) await refreshOverview(); await showLeads(); }
    else if (name === 'job') await showJob(arg);
    // The old Review page: the Queue's tailored applications, where each opens with its CV and letter.
    else if (name === 'review') { location.replace('#overview/approve'); return; }
    else if (name === 'welcome') await showWelcome();
    // The old Apply page: the job's own page, on the tab with what a form asks for.
    else if (name === 'apply') { jobTabs[arg] = 'apply'; location.replace(`#job/${encodeURIComponent(arg)}`); return; }
    else if (name === 'calendar') await showCalendar();
    else if (name === 'results') await showResults();
    else if (name === 'search') await showSearch(arg);
    else if (name === 'inbox' && arg === 'recruiters' || name === 'recruiters') await showRecruiters();
    else if (name === 'inbox') await showInbox();
    else if (name === 'add') showAdd();
    else if (name === 'settings' && ['search', 'preferences', 'sources'].includes(arg)) { location.replace(arg === 'sources' ? '#search/setup' : '#search/what'); return; }
    else if (name === 'cvs' || (name === 'settings' && arg === 'cvs')) await settingsCards('cvs', name === 'cvs' ? arg : '');
    else if (name === 'settings') await showSettings(arg);
    else location.hash = '#overview';
  } catch (e) {
    page(`<div class="card"><h2>Couldn't load this page</h2><p class="muted">${esc(e.message)}</p></div>`);
  }
  syncPanel();
  // A new page (or the next job in Review) starts at the top; a refresh of the same one stays put.
  const key = `${location.hash}|${pageKey}`;
  if (key !== shownKey) { shownKey = key; window.scrollTo(0, 0); }
}
