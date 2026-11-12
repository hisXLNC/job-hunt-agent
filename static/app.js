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

/** Five places. Queue: the next decision, one at a time. Pipeline: every job, wherever it is. Inbox: the email about them. Calendar: interviews and reminders. Me: what you're looking for, your CVs and details. The same five are the phone's tabs. Settings (the gear) has the accounts, the job sources and the app itself. */
const NAV = [['overview', 'Queue'], ['applications', 'Pipeline'], ['inbox', 'Inbox'], ['calendar', 'Calendar'], ['cvs', 'Me']];
/** Pages that belong to a place: a job, applying, review, the tailored files and the insights to Pipeline; Recruiters to Inbox. */
const NAV_HOME = { job: 'applications', apply: 'applications', documents: 'applications', add: 'applications', pipeline: 'applications', recruiters: 'inbox', results: 'applications', review: 'applications', welcome: 'overview' };
/** Which place a page belongs to. What you're looking for is part of Me; where it looks is part of Settings. */
const placeOf = () => { const [page, arg] = (location.hash.slice(1) || 'overview').split('/'); return page === 'search' ? (arg === 'what' ? 'cvs' : 'settings') : NAV_HOME[page] || page; };
/** Each place's views, as the same row of tabs wherever you are in it. */
const placeTabs = (tabs, on) => `<nav class="tabs place-tabs">${tabs.map(([href, name, id]) => `<a href="${href}" class="${id === on ? 'on' : ''}">${name}</a>`).join('')}</nav>`;
const inboxTabs = on => placeTabs([['#inbox', 'Email', 'email'], ['#inbox/recruiters', 'Recruiters', 'recruiters']], on);
/** Me: what you're looking for, then what Job Hunt knows about you. */
const meTabs = (on, n) => placeTabs([['#search/what', 'Looking for', 'what'], ['#cvs', `CVs${n ? ` (${n})` : ''}`, 'cvs'], ['#cvs/details', 'About me', 'details'], ['#cvs/career', 'Career paths', 'career'], ['#cvs/coach', 'Career coach', 'coach']], on);
const meHead = (on, about, n) => `<div class="head"><div class="grow"><h1>Me</h1><p class="muted">${about}</p></div><span class="save-state" ${on === 'what' ? '' : 'id="saveState"'} aria-live="polite">${['cvs', 'details'].includes(on) ? 'Changes save by themselves' : ''}</span></div>${meTabs(on, n)}`;
/** Settings' tabs: what belongs to no one place, and where Job Hunt looks for jobs. */
const SETTINGS_TABS = [['connections', 'Accounts'], ['sources', 'Job sources'], ['inbox', 'Email'], ['calendar', 'Calendar'], ['notifications', 'Notifications'], ['sync', 'Sync & backup'], ['extension', 'Browser extension'], ['app', 'App']];
const settingsTabs = on => `<nav class="tabs place-tabs">${SETTINGS_TABS.map(([id, n]) => `<a href="${id === 'sources' ? '#search' : `#settings/${id}`}" class="${id === on ? 'on' : ''}">${n}</a>`).join('')}</nav>`;
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
/** Pipeline's views: every job, each step with how many are in it, the files tailored for them, and how it's going. */
function flowNav(on) {
  const c = overview?.counts || {};
  const all = APP_TABS.some(([id]) => id === on);
  return `<nav class="tabs pipe-tabs" aria-label="Views"><a href="#applications/all" class="${all ? 'on' : ''}">All jobs</a>${FLOW.map(([id, name, n]) => `<a href="#applications/${id}" class="${id === on ? 'on' : ''}${n(c) ? '' : ' none'}" ${id === on ? 'aria-current="page"' : ''}>${name} <span class="n">${n(c)}</span></a>`).join('')}
    <span class="tabs-gap"></span><a href="#applications/files" class="${on === 'files' ? 'on' : ''}">Tailored files</a><a href="#results" class="${on === 'insights' ? 'on' : ''}">Insights</a></nav>`;
}
/** Postings found but not scored yet, with the button that scores them now. */
function heldLine() {
  const waiting = overview?.held || 0;
  return waiting ? `<p class="small muted held-line">${waiting} posting${waiting === 1 ? '' : 's'} found and waiting to be scored (newest first, ${(overview?.running || []).includes('search') ? 'scoring now' : 'a batch every 45 minutes'}). <button class="btn sm" data-act="scoreHeld">Score them all now</button></p>` : '';
}
/** The top of the Jobs page: its name, find and add, and the steps. */
function jobsHead(on, extra = '') {
  return `<div class="head">
      <div class="grow"><h1>Pipeline</h1></div>
      <div class="row head-acts">${extra}<a class="btn" href="#add">${svg('add')}Add a job</a></div>
    </div>
    ${flowNav(on)}`;
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
const scoreBadge = n => n == null ? '' : `<span class="score ${scoreBand(n)}" title="Fit score">${n}</span>`;
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
  ? `<span class="reach"><span class="reach-arrow">→</span><span class="score ${scoreBand(j.score_after)}" title="Fit of the tailored CV">${j.score_after}</span></span>`
  : canReach(j) ? `<span class="reach"><span class="reach-arrow">→</span><span class="score forecast ${scoreBand(canReach(j))}" title="${canReach(j) > j.score ? 'Predicted fit once your CV is tailored to this posting' : 'Tailoring is unlikely to raise this fit: the gap is in experience, not wording'}">~${canReach(j)}</span></span>` : '';
const trackLabel = t => (settingsCache?.profile?.tracks || []).find(x => x.name === t)?.label || overview?.track_labels?.[t] || (t || '').replace(/[-_]/g, ' ');
const stagePill = s => `<span class="pill ${esc(s)}">${esc(STAGES[s] || s)}</span>`;
/** When the posting stops taking applications, if it says; red when it's two days or less away. */
function deadlineTag(j) {
  if (!j.deadline || j.closed_at || !['queued', 'ready', 'approved', 'skipped', 'saved'].includes(j.status)) return '';
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
function renderNav() {
  const active = placeOf();
  const gear = $('#settingsLink'); if (gear) gear.classList.toggle('on', active === 'settings');
  const waiting = overview ? queueCount(queueItems(overview)) : 0;
  $('#nav').innerHTML = NAV.map(([id, name, group]) =>
    `<a href="#${id}" class="${id === active ? 'on' : ''}">${svg(id)}${name}${id === 'overview' && waiting ? `<span class="badge" title="${waiting} decision${waiting === 1 ? '' : 's'} waiting">${waiting}</span>` : ''}</a>`).join('');
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
  // The phone's tab bar: the four used most, and More for the rest (and the status lines).
  // The phone's tabs are the same five places; the top bar's menu button has Settings, the status lines and the theme.
  $('#tabbar').innerHTML = NAV.map(([id, name]) =>
    `<a href="#${id}" class="${id === active ? 'on' : ''}">${svg(id)}<span>${name}</span>${id === 'overview' && waiting ? `<span class="badge">${waiting > 99 ? '99+' : waiting}</span>` : ''}</a>`).join('');
  const alert = !$('#connLine')?.hidden || !$('#limitLine')?.hidden || !$('#updateNote')?.hidden;
  $('#statusPop')?.classList.toggle('alert', alert);
  const mm = $('#mMenu');
  if (mm) { mm.setAttribute('aria-expanded', document.body.classList.contains('more-open')); mm.classList.toggle('alert', !$('#connLine')?.hidden || !$('#limitLine')?.hidden || !$('#updateNote')?.hidden); }
  updateSearchCtl();
  $('#runNote').textContent = busy || `Searched ${ago(overview?.last_search)}${side.paused ? ` · ${side.paused === 'off' ? 'daily search off' : `paused until ${new Date(side.paused).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}` : nextSearch ? ` · next ${when(nextSearch)}` : overview?.last_search ? ' · next soon' : ''}`;
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
  const lim = side.claude_limited_until && new Date(side.claude_limited_until) > new Date();
  $('#limitLine').hidden = !lim && !side.deferred;
  $('#limitNote').textContent = lim ? `Claude limit until ${new Date(side.claude_limited_until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : `${side.deferred} batch${side.deferred === 1 ? '' : 'es'} waiting for tonight`;
  $('#connLine').hidden = !side.conn_problems;
  $('#connNote').textContent = `${side.conn_problems} connection${side.conn_problems === 1 ? '' : 's'} need${side.conn_problems === 1 ? 's' : ''} attention`;
  if (overview?.version) $('#versionNote').textContent = `Job Hunt ${shortVersion(overview.version)}`;
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
    else if (name === 'applications') { overview = await api('/api/overview'); await showPipeline(arg); }
    else if (name === 'overview') await showOverview(arg);
    else if (name === 'job') await showJob(arg);
    else if (name === 'review') await showReview();
    else if (name === 'welcome') await showWelcome();
    else if (name === 'apply') await showApply(arg);
    else if (name === 'calendar') await showCalendar();
    else if (name === 'results') await showResults();
    else if (name === 'search') await showSearch(arg);
    else if (name === 'inbox' && arg === 'recruiters' || name === 'recruiters') await showRecruiters();
    else if (name === 'inbox') await showInbox();
    else if (name === 'add') showAdd();
    else if (name === 'settings' && ['search', 'preferences', 'sources'].includes(arg)) { location.replace(arg === 'sources' ? '#search/setup' : '#search/what'); return; }
    else if (name === 'cvs' || (name === 'settings' && arg === 'cvs')) await showSettings('cvs', name === 'cvs' ? arg : '');
    else if (name === 'settings') await showSettings(arg || 'connections');
    else location.hash = '#overview';
  } catch (e) {
    page(`<div class="card"><h2>Couldn't load this page</h2><p class="muted">${esc(e.message)}</p></div>`);
  }
  syncPanel();
  // A new page (or the next job in Review) starts at the top; a refresh of the same one stays put.
  const key = `${location.hash}|${pageKey}`;
  if (key !== shownKey) { shownKey = key; window.scrollTo(0, 0); }
}

// ---- Overview ----
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// ---- A job beside the Pipeline's list ----
let panelJob = '';
/** Room for a job beside the list: a wide window with a mouse. Elsewhere a job opens its own page. */
const panelFits = () => matchMedia('(min-width: 1180px)').matches && !matchMedia('(pointer: coarse) and (max-height: 700px)').matches;
function closePanel() {
  panelJob = '';
  const el = $('#jobPanel');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('panel-open');
  document.querySelectorAll('.in-panel').forEach(x => x.classList.remove('in-panel'));
}
/** Open a job beside the list: what it is, where it stands, the next thing to do with its buttons,
 *  and why it fits. The whole job (letter, questions, interview, notes) is a click further. */
async function openPanel(id) {
  const el = $('#jobPanel');
  if (!el) return;
  const again = panelJob === id && !el.hidden;
  panelJob = id;
  el.hidden = false;
  document.body.classList.add('panel-open');
  document.querySelectorAll('.in-panel').forEach(x => x.classList.remove('in-panel'));
  document.querySelectorAll(`tr[data-expand="${CSS.escape(id)}"], .jrow[data-job-row="${CSS.escape(id)}"]`).forEach(x => x.classList.add('in-panel'));
  if (!again) el.innerHTML = '<p class="muted jp-wait">Loading…</p>';
  let d;
  try { d = await api(`/api/jobs/${encodeURIComponent(id)}`); } catch (e) { if (panelJob === id) el.innerHTML = `<div class="jp-top"><button class="x" data-act="panelClose" title="Close (Esc)">×</button></div><p class="muted jp-wait">${esc(e.message)}</p>`; return; }
  if (panelJob !== id) return;
  const j = d.job;
  j.effort = d.effort;
  const tailoring = (overview?.running || []).includes(`tailor:${id}`);
  const w = fitWords(j), must = mustHaves(j), flags = (j.red_flags || []).filter(x => !/^must have:/i.test(x));
  const lacks = [w.gap, ...must.map(m => `Required, not on your CV: ${m}`), ...flags].filter(Boolean);
  const facts = [`<b>${coCell(j)}</b>`, j.location ? placeHtml(j) : '', payFact(j), j.employment ? esc(j.employment) : '', ageTag(j)].filter(Boolean).map(x => `<span>${x}</span>`).join('');
  el.innerHTML = `<div class="jp-top"><span class="kicker">${esc(STAGES[j.status] || j.status)}</span><span class="grow"></span><a class="btn ghost sm" href="#job/${encodeURIComponent(id)}">Open the full page</a><button class="x" data-act="panelClose" title="Close (Esc)">×</button></div>
    <div class="jp-scroll">
      <div class="jp-head">${avatar(j.company)}<div class="grow"><h2>${esc(j.title)}</h2><div class="facts">${facts}</div></div>${fitRing(j.score_after ?? j.score)}</div>
      <div class="dtags">${oneTag(j)}${effortTag(j)}${closedTag(j)}${deadlineTag(j)}${belowMinTag(j)}${(d.company_history || []).length ? '<span class="pill info">Applied here before</span>' : ''}</div>
      ${d.progress ? `<div class="jp-track">${stepsHtml(d.progress)}</div>` : ''}
      ${jobActions(j, tailoring, d.progress)}
      ${w.match ? `<div class="why"><b>Why it fits</b>${esc(w.match)}${j.score_after == null && canReach(j) ? ` <span class="muted">Tailored, it could reach about <b class="in">${canReach(j)}</b>.</span>` : ''}</div>` : ''}
      ${lacks.length ? `<div class="why warnish"><b>Gaps and things to check</b><ul>${lacks.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
      ${j.cv_path ? `<div class="jp-files"><button class="btn sm" data-act="open" data-what="cv" data-job="${esc(id)}">${svg('doc')}Tailored CV</button><button class="btn sm" data-act="open" data-what="letter" data-job="${esc(id)}">${svg('doc')}Cover letter</button>${j.coverage_after != null ? `<span class="muted small">${pct(j.coverage_after)} of the posting's keywords</span>` : ''}</div>` : ''}
      ${j.notes ? `<div class="jp-notes"><b class="small">Your notes</b><p class="small">${esc(j.notes)}</p></div>` : ''}
      <details class="jp-posting"><summary><b>The posting</b></summary><div class="posting">${esc(j.description || 'The source gave no description. Open it on the site to read it.')}</div></details>
    </div>`;
}
/** After a page is drawn: the job beside the list stays open (and up to date) while you're in Pipeline. */
function syncPanel() {
  const inPipeline = /^#(applications|results)/.test(location.hash);
  if (panelJob && inPipeline && panelFits()) openPanel(panelJob); else if (panelJob || !$('#jobPanel')?.hidden) closePanel();
}

// ---- Queue: one decision at a time ----
/** What a fit's reasoning says for the role, and against: "Strong match on X. Biggest gap: Y." */
function fitWords(j) {
  const r = (j.reasoning || '').trim();
  const m = r.match(/^(.*?)(?:\.?\s*)(?:The )?(?:Gap|Biggest gap|Main gap)s?(?: is|:)\s*(.*)$/i);
  return { match: (m ? m[1] : r).replace(/^(Strong(est)? match|Match):\s*/i, '').replace(/\.$/, ''), gap: m ? m[2].replace(/\.$/, '') : '' };
}
/** A fit score as a ring that fills with it. */
const fitRing = n => n == null ? '<div class="ring none" title="Not scored yet">–</div>' : `<div class="ring ${scoreBand(n)}" style="--p:${Math.max(0, Math.min(100, n))}" title="Fit score">${n}</div>`;
/** Everything waiting for a decision from you, most pressing first. Each: the step it belongs to
 *  (Pick, Approve, Submit, Waiting, Interviews, or fix for a problem), its kind, and what it's about. */
function queueItems(o) {
  const items = [];
  const add = (step, kind, key, x) => items.push({ step, kind, id: `${kind}:${key}`, ...x });
  const health = o.health || [];
  health.forEach((h, i) => { if (h.level === 'problem') add('fix', 'health', i, { h }); });
  (o.interviews || []).filter(i => new Date(i.start) - Date.now() < 3 * 86400000).forEach(i => add('interviews', 'interview', i.job_id || i.start, { i }));
  const unconfirmed = o.filled_unconfirmed || [];
  unconfirmed.forEach(j => add('submit', 'filled', j.id, { j }));
  (o.ready || []).forEach(j => add('approve', 'approve', j.id, { j }));
  // Quickest first: one-click emails and short forms, then the ones that need an account.
  [...(o.approved || [])].filter(j => !unconfirmed.some(u => u.id === j.id)).sort((a, b) => (a.effort?.minutes ?? 10) - (b.effort?.minutes ?? 10)).forEach(j => add('submit', 'submit', j.id, { j }));
  (o.recruiter_asks || []).forEach(j => add('submit', 'ask', j.id, { j }));
  (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`)).sort((a, b) => applyRank(b) - applyRank(a)).forEach(j => add('pick', 'pick', j.id, { j }));
  (o.contact_follow_ups || []).forEach(f => add('waiting', 'contact', f.job.id, { j: f.job, f }));
  (o.follow_ups || []).forEach(j => add('waiting', 'follow', j.id, { j }));
  (o.reach_out || []).forEach(j => add('waiting', 'reach', j.id, { j }));
  if (o.quiet?.length) add('waiting', 'quiet', 'all', { list: o.quiet });
  if (o.held && !(o.running || []).includes('search')) add('pick', 'held', 'all', { n: o.held });
  health.forEach((h, i) => { if (h.level !== 'problem') add('fix', 'health', `w${i}`, { h }); });
  return items;
}
/** How many decisions are waiting: everything but the notes that are merely worth a look. */
const queueCount = items => items.filter(x => x.kind !== 'health' || x.h.level === 'problem').length;
const QUEUE_KIND = { pick: 'Pick', approve: 'Approve', submit: 'Submit', filled: 'Submit', ask: 'Ask a recruiter', contact: 'Follow up', follow: 'Follow up', reach: 'Say hello', quiet: 'Tidy up', interview: 'Interview', health: 'Needs attention', held: 'Waiting to be scored' };
let queueSkipped = new Set(), queueAt = '';
/** How the Queue is shown: every listing at once ('list', unless you choose otherwise) or one decision at a time ('one'). Remembered on this device. */
const queueView = () => { try { return localStorage.getItem('jh.queueView') === 'one' ? 'one' : 'list'; } catch (e) { return 'list'; } };
/** A decision's buttons: the quiet ones on the left, a gap, then the one that moves it on. */
const dbar = (quiet, main) => `<div class="dbar">${quiet}<span class="sp"></span>${main}<button class="btn ghost skip" type="button" data-act="queueSkip" title="Leave it for now and see the next one (→)">Skip${svg('next')}</button></div>`;
const key = k => `<kbd class="k">${k}</kbd>`;
/** The top of a decision about a job: its company tile, what kind of decision, its name and facts, its fit. */
function decisionTop(j, kicker, fit = fitRing(j.score_after ?? j.score)) {
  const facts = [`<b>${coCell(j)}</b>`, j.location ? placeHtml(j) : '', payFact(j), j.employment ? esc(j.employment) : '', ageTag(j)].filter(Boolean).map(x => `<span>${x}</span>`).join('');
  return `<div class="dtop">${avatar(j.company)}<div class="grow"><p class="kicker">${kicker}</p><h2><a href="#job/${encodeURIComponent(j.id)}">${esc(j.title)}</a></h2>
      <div class="facts">${facts}</div><div class="dtags">${oneTag(j)}${effortTag(j)}${appliedBeforeTag(j)}${closedTag(j)}${deadlineTag(j)}${belowMinTag(j)}</div></div>${fit}</div>`;
}
/** One decision, drawn in full: what it is, what you need to know to decide, and its buttons. */
function decisionHtml(x, at, of) {
  const where = `${QUEUE_KIND[x.kind]} · ${at} of ${of}`;
  const j = x.j, id = j ? esc(j.id) : '', enc = j ? encodeURIComponent(j.id) : '';
  const notNow = from => `<button class="btn quiet" data-act="stage" data-status="dismissed" data-job="${id}" data-from="${from}">Not interested${key('X')}</button><button class="btn quiet" data-act="stage" data-status="saved" data-job="${id}" data-from="${from}" title="Save it for later: it leaves the queue and stays in Pipeline">Later${key('L')}</button>`;
  if (x.kind === 'pick') {
    const w = fitWords(j), gaps = new Set((j.keyword_gaps || []).map(k => k.toLowerCase()));
    const have = (j.keywords || []).filter(k => !gaps.has(k.toLowerCase())).slice(0, 7);
    const must = mustHaves(j), flags = (j.red_flags || []).filter(f => !/^must have:/i.test(f));
    const lacks = [w.gap, ...must.map(m => `Required, not on your CV: ${m}`), ...flags].filter(Boolean);
    const reach = j.score_after ?? canReach(j);
    return `<article class="card decision" data-kind="pick">${decisionTop(j, where, fitRing(j.score))}
      <div class="dbody">
        ${w.match || reach ? `<div class="why"><b>Why it fits</b>${esc(w.match || 'It cleared your fit score.')}${reach && reach !== j.score ? ` <span class="muted">Tailored, your CV could reach about <b class="in">${reach}</b>.</span>` : ''}</div>` : ''}
        ${have.length || lacks.length ? `<div class="two">${have.length ? `<div><span class="pill good">You have</span><div class="kws">${have.map(k => `<span class="kw">${esc(k)}</span>`).join('')}</div></div>` : ''}
          ${lacks.length ? `<div><span class="pill warn">Gaps and things to check</span><ul>${lacks.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
        ${expiredWhy(j) ? `<p class="bad-text small">${esc(expiredWhy(j))}. Check the posting is still open.</p>` : ''}
      </div>
      ${dbar(`${notNow('queued')}<a class="btn ghost" href="#job/${enc}" data-tab-to="overview">Read the posting</a>`,
        j.score == null ? `<button class="btn primary big" data-primary data-act="scoreAnyway" data-job="${id}">Score it${key('Enter')}</button>` : `<button class="btn primary big" data-primary data-act="tailorPicked" data-job="${id}">Tailor my CV for it${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'approve') {
    return `<article class="card decision" data-kind="approve">${decisionTop(j, where)}
      <div class="dbody">
        <div class="why blue"><b>Your CV and cover letter are tailored</b>${j.coverage_after != null ? `They now cover ${pct(j.coverage_after)} of the posting's keywords${j.coverage_before != null ? ` (your CV covered ${pct(j.coverage_before)} before)` : ''}. ` : ''}${j.score_after != null && j.score != null && j.score_after !== j.score ? `Tailored, it scores <b class="in">${j.score_after}</b> (was ${j.score}). ` : ''}Read them, change what you like, then approve.</div>
        <p class="small muted">${j.apply_email ? `Approving emails them to ${esc(j.apply_email)} from your Gmail.` : 'Approving opens the form in your browser for Job Hunt to fill in. You press Submit.'} ${onCompanySite(j)}</p>
      </div>
      ${dbar(`${notNow('ready')}<a class="btn" href="#job/${enc}" data-tab-to="docs">Read CV and letter</a>`,
        `<button class="btn primary big" data-primary data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">${j.apply_email ? 'Approve and email it' : 'Approve and apply'}${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'submit') {
    const can = overview?.can_fill && j.url && j.effort?.kind !== 'email';
    return `<article class="card decision" data-kind="submit">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>Approved: submit it</b>${can ? 'It opens in your own browser, where your sign-ins work. On the form, click the Job Hunt extension and press Fill this form; check it over and press Submit.' : 'Open the Apply page: the posting, your files and your answers are there in one place.'}</div>
        <p class="small muted">${onCompanySite(j)}</p></div>
      ${dbar(`<button class="btn quiet" data-act="stage" data-status="dismissed" data-job="${id}" data-from="approved">Not interested${key('X')}</button><button class="btn" data-act="stage" data-status="applied" data-job="${id}" data-from="approved" title="Already submitted it">Mark applied</button>${can ? `<a class="btn ghost" href="#apply/${enc}">Files and answers</a>` : ''}`,
        can ? `<button class="btn primary big" data-primary data-act="fillBrowser" data-job="${id}">Fill it in my browser${key('Enter')}</button>` : `<a class="btn primary big" data-primary href="#apply/${enc}">Apply${key('Enter')}</a>`)}</article>`;
  }
  if (x.kind === 'filled') {
    return `<article class="card decision" data-kind="filled">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>Did it go through?</b>Job Hunt filled in this form, but it isn't marked applied yet. Most go through.</div></div>
      ${dbar(`<a class="btn" href="#apply/${enc}">Not yet: open it again</a>`, `<button class="btn primary big" data-primary data-act="stage" data-status="applied" data-job="${id}" data-from="approved">Yes, I applied${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'ask') {
    return `<article class="card decision" data-kind="ask">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>You know a recruiter there</b>${esc(j.recruiter || 'A recruiter')} handled an application of yours before. Ask them to put you forward: Job Hunt writes the note.</div></div>
      ${dbar('', `<button class="btn primary big" data-primary data-act="askRecruiter" data-job="${id}" data-name="${esc(firstName(j.recruiter))}">Ask ${esc(firstName(j.recruiter))}${key('Enter')}</button>`)}</article>`;
  }
  if (['follow', 'reach', 'contact'].includes(x.kind)) {
    const text = x.kind === 'follow' ? ['No reply yet', `You applied ${esc(ago(j.applied_at))}. A short, polite follow-up is worth sending; Job Hunt writes it for you to read and send.`]
      : x.kind === 'reach' ? ['Just applied: say hello', `You applied ${esc(ago(j.applied_at))}. A short note to the recruiter within one to three days helps you stand out.`]
      : ['No reply from the recruiter', `You messaged ${esc(x.f.name)} ${esc(ago(x.f.sent_at))}${x.f.late ? '. Follow up now, or let it go' : ''}.`];
    const main = x.kind === 'follow' ? `<button class="btn primary big" data-primary data-act="followUp" data-job="${id}">Write the follow-up${key('Enter')}</button>`
      : `<a class="btn primary big" data-primary href="#job/${enc}" data-tab-to="apply" ${x.kind === 'reach' ? 'data-scroll="people"' : ''}>${x.kind === 'reach' ? 'Write a note' : 'Write the follow-up'}${key('Enter')}</a>`;
    return `<article class="card decision" data-kind="${x.kind}">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>${text[0]}</b>${text[1]}</div></div>
      ${dbar(x.kind === 'follow' ? `<button class="btn quiet" data-act="stage" data-status="no_response" data-job="${id}" data-from="applied" title="Stop waiting for this one">Close as No response</button>` : '', main)}</article>`;
  }
  if (x.kind === 'quiet') {
    const l = x.list;
    return `<article class="card decision" data-kind="quiet"><div class="dtop"><span class="bigicon">${svg('clock')}</span><div class="grow"><p class="kicker">${where}</p><h2>${l.length} quiet for four weeks or more</h2>
        <div class="facts"><span>${l.slice(0, 4).map(q => esc(q.company)).join(', ')}${l.length > 4 ? ` and ${l.length - 4} more` : ''}</span></div></div></div>
      <div class="dbody"><div class="why"><b>Keep your list true</b>No reply in a month rarely turns into one. Closing them as No response keeps Waiting to the ones still alive; they stay in Pipeline.</div></div>
      ${dbar(`<a class="btn" href="#applications/waiting">See them</a>`, `<button class="btn primary big" data-primary data-act="closeQuiet" data-ids="${esc(JSON.stringify(l.map(q => q.id)))}">Close ${l.length === 1 ? 'it' : `all ${l.length}`} as No response${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'interview') {
    const i = x.i;
    return `<article class="card decision" data-kind="interview"><div class="dtop">${avatar(i.company || i.title)}<div class="grow"><p class="kicker">${where}</p><h2>${esc(i.company || i.title)}</h2>
        <div class="facts"><span><b>${esc(fmtWhen(i.start))}</b></span>${i.job_title ? `<span>${esc(i.job_title)}</span>` : ''}</div></div><span class="bigicon good">${svg('calendar')}</span></div>
      <div class="dbody"><div class="why"><b>Coming up</b>Job Hunt writes prep notes for each interview: likely questions, your stories that answer them, and what to ask.</div></div>
      ${dbar(`<a class="btn" href="#calendar">Calendar</a>`, i.job_id ? `<a class="btn primary big" data-primary href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prepare${key('Enter')}</a>` : '')}</article>`;
  }
  if (x.kind === 'held') {
    return `<article class="card decision" data-kind="held"><div class="dtop"><span class="bigicon">${svg('search')}</span><div class="grow"><p class="kicker">${where}</p><h2>${x.n} posting${x.n === 1 ? '' : 's'} found, not scored yet</h2>
        <div class="facts"><span>Job Hunt scores them newest first, a batch every 45 minutes.</span></div></div></div>
      <div class="dbody"><div class="why"><b>Or now</b>Scoring them all uses more of your Claude plan at once. The ones that clear your fit score come here to pick.</div></div>
      ${dbar('', `<button class="btn primary big" data-primary data-act="scoreHeld">Score them all now${key('Enter')}</button>`)}</article>`;
  }
  const h = x.h, bad = h.level === 'problem';
  return `<article class="card decision ${bad ? 'crit' : 'warn'}" data-kind="health"><div class="dtop"><span class="bigicon ${bad ? 'crit' : 'warn'}">!</span><div class="grow"><p class="kicker">${where}</p><h2>${bad ? 'Something needs fixing' : 'Worth a look'}</h2></div></div>
    <div class="dbody"><p class="lead">${esc(h.text)}</p><div id="healthIdeas" class="ideas"></div></div>
    ${dbar(h.action === 'removeBroken' ? `<button class="btn" data-act="removeBroken" data-boards="${esc(JSON.stringify(h.data))}">Remove ${h.data.length === 1 ? 'it' : 'them'}</button>` : '',
      `${h.action === 'removeBroken' ? `<button class="btn primary big" data-primary data-act="suggestBoards" data-into="healthIdeas">Suggest companies</button>` : ''}${h.fix ? `<button class="btn primary big" data-primary data-act="${esc(h.fix.act)}" data-task="${esc(h.fix.task)}">${esc(h.fix.label)}</button>` : ''}${h.link && h.link !== '#overview' ? `<a class="btn primary big" data-primary href="${esc(h.link)}">Fix it${key('Enter')}</a>` : ''}`)}</article>`;
}
/** A decision as one line of Up next. */
function queueMini(x) {
  const j = x.j;
  const name = j ? j.title : x.kind === 'interview' ? `Interview: ${x.i.company || x.i.title}` : x.kind === 'quiet' ? `${x.list.length} quiet for 4+ weeks` : x.kind === 'held' ? `${x.n} waiting to be scored` : x.h.level === 'problem' ? 'Something needs fixing' : 'Worth a look';
  const who = j ? j.company : x.kind === 'interview' ? fmtWhen(x.i.start) : '';
  const tile = j ? avatar(j.company) : x.kind === 'interview' ? avatar(x.i.company || x.i.title) : `<span class="avatar plain">${x.kind === 'health' ? '!' : svg(x.kind === 'held' ? 'search' : 'clock')}</span>`;
  return `<button type="button" class="mini" data-act="queueGo" data-id="${esc(x.id)}">${tile}<span class="grow"><b>${esc(name)}</b><span class="small muted">${esc(who)}${who ? ' · ' : ''}${QUEUE_KIND[x.kind]}</span></span>${j && j.score != null ? `<span class="score ${scoreBand(j.score_after ?? j.score)}">${j.score_after ?? j.score}</span>` : ''}</button>`;
}

/** Queue: the next decision, in full, and what's behind it. The lists of jobs are in Pipeline. */
async function showOverview(arg) {
  // Just fetched (opening Job Hunt fetches it before drawing the page): no need to ask twice.
  if (!overview || Date.now() - overviewAt > 1500) { overview = await api('/api/overview'); overviewAt = Date.now(); }
  renderNav();
  const o = overview;
  const setup = o.setup;
  const steps = [
    [setup.claude, setup.engine === 'api' ? 'Add your Claude API key' : 'Connect Claude Code', setup.engine === 'api' ? 'Needed to score jobs and tailor your CV.' : 'Uses Claude Code on this PC and your Claude subscription. No API key needed.', '#settings/connections'],
    [setup.cvs > 0 && !setup.cvs_missing.length, setup.cvs ? 'Your CVs' : 'Add your CV', setup.cvs ? (setup.cvs_missing.length ? `Missing a file: ${setup.cvs_missing.join(', ')}` : `${setup.cvs} CV${setup.cvs === 1 ? '' : 's'} ready.`) : 'Word, PDF or text. Add as many as you like.', '#cvs'],
    [setup.google, 'Connect Gmail and Calendar (optional)', 'For job email, replies and interview booking.', '#settings/connections', 'google'],
    [setup.adzuna, 'Add a job-search service (optional)', 'Google for Jobs listings from LinkedIn, Indeed, Glassdoor and more.', '#search/setup', 'search_service'],
  ].filter(st => !(st[4] && (setup.skipped || []).includes(st[4])));
  // Shown until the steps you need are done; optional ones can be put off with Not now.
  const showSteps = steps.some(s => !s[0]);
  const neededDone = steps.filter(s => !s[4]).every(s => s[0]); // Claude and a CV
  const searching = (o.running || []).includes('search');
  const side = o.side || {};
  const nextSearch = side.next_search ? new Date(side.next_search) : null;
  const googleOff = (setup.skipped || []).includes('google');
  const first = (o.name || '').split(' ')[0];
  // The queue, the step you're looking at, and the decision you're on.
  const all = queueItems(o);
  const step = FLOW.some(([id]) => id === arg) ? arg : '';
  const list = step ? all.filter(x => x.step === step) : all;
  if (list.length && list.every(x => queueSkipped.has(x.id))) list.forEach(x => queueSkipped.delete(x.id));
  const cur = list.find(x => x.id === queueAt) || list.find(x => !queueSkipped.has(x.id)) || list[0];
  if (cur) queueAt = cur.id;
  jobOrder = all.filter(x => x.j).map(x => x.j.id);
  // Every listing at once (the usual way), or one decision at a time.
  const view = queueView();
  let listing = '';
  if (view === 'list' && all.length) {
    const tracked = ['waiting', 'interviews'].includes(step) ? (await api('/api/tracker')).rows : [];
    const notes = step ? [] : all.filter(x => x.kind === 'health');
    const noteRow = x => `<div class="next-row ${x.h.level === 'problem' ? 'crit' : 'warn'}"><span class="next-n">!</span><span class="grow">${esc(x.h.text)}</span><span class="row next-act">
        ${x.h.action === 'removeBroken' ? `<button class="btn sm" data-act="removeBroken" data-boards="${esc(JSON.stringify(x.h.data))}">Remove ${x.h.data.length === 1 ? 'it' : 'them'}</button><button class="btn sm" data-act="suggestBoards" data-into="healthIdeas">Suggest companies</button>` : ''}
        ${x.h.fix ? `<button class="btn sm" data-act="${esc(x.h.fix.act)}" data-task="${esc(x.h.fix.task)}">${esc(x.h.fix.label)}</button>` : ''}${x.h.link && x.h.link !== '#overview' ? `<a class="btn sm" href="${esc(x.h.link)}">Fix it</a>` : ''}</span></div>`;
    // What's furthest along first, as in the one-by-one order; a step you chose shows all of itself.
    const order = step ? [step] : ['interviews', 'approve', 'submit', 'pick', 'waiting'].filter(s => all.some(x => x.step === s));
    const qopt = (v, n) => `<option value="${v}">${n}</option>`;
    const qbar = all.filter(x => x.j).length > 1 ? `<div class="queue-filters" data-queuebox>
        <label class="small">Sort by <select data-queuef="sort">${qopt('', 'Each step\'s own order')}${qopt('now', 'Best to apply to now')}${qopt('fit', 'Best fit')}${qopt('new', 'Newest')}${qopt('pay', 'Highest pay')}</select></label>
        <label class="check small"><input type="checkbox" data-queuef="pay"> Shows pay</label>
        <label class="check small"><input type="checkbox" data-queuef="flags"> No red flags</label>
        <span class="muted small" data-queuecount></span></div>` : '';
    listing = `${qbar}${notes.some(x => x.h.level === 'problem') ? `<section class="card next-card">${notes.filter(x => x.h.level === 'problem').map(noteRow).join('')}</section>` : ''}
      ${order.map(s => `${s === 'pick' ? heldLine() : ''}${stepHtml(o, s, s === step ? tracked : [])}`).join('')}
      ${notes.some(x => x.h.level !== 'problem') ? `<section class="card next-card">${notes.filter(x => x.h.level !== 'problem').map(noteRow).join('')}</section>` : ''}
      <div id="healthIdeas" class="ideas"></div>`;
    jobOrder = all.filter(x => x.j).map(x => x.j.id);
  }
  const rest = cur ? [...list.slice(list.indexOf(cur) + 1), ...list.slice(0, list.indexOf(cur))] : [];
  const tailoring = (o.to_tailor || []).length - (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`)).length;
  const n = k => all.filter(x => x.step === k).length;
  const delta = o.this_week - o.last_week;
  const picks = n('pick');
  page(`<div class="head">
      <div class="grow">
        <div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${first ? ` · ${greeting()}, ${esc(first)}` : ''}</div>
        <h1>${queueCount(all) ? `${queueCount(all)} waiting for you` : all.length ? 'No decisions waiting' : neededDone ? 'Nothing needs you right now' : 'Let\'s get you set up'}</h1>
      </div>
      <div class="row head-acts">
        <a class="btn ghost" href="#add">${svg('add')}Add a job</a>
        ${searching ? searchCtl(o.progress)
          : `<button class="btn${all.length ? '' : ' primary'}" data-act="run" data-task="search" ${!o.setup?.cvs ? 'disabled title="Add your CV first"' : ''}>${svg('search')}Search for jobs now</button>`}
      </div>
    </div>
    ${all.length ? `<nav class="tabs qsteps" aria-label="Kinds of decision"><a href="#overview" class="${step ? '' : 'on'}">Everything <span class="n">${queueCount(all)}</span></a>${FLOW.map(([id, name]) => `<a href="#overview/${id}" class="${id === step ? 'on' : ''}${n(id) ? '' : ' none'}">${id === 'waiting' ? 'Follow up' : name} <span class="n">${n(id)}</span></a>`).join('')}
      <span class="tabs-gap"></span><span class="seg view-seg" role="group" aria-label="How to show them"><button type="button" data-act="queueView" data-view="list" class="${view === 'list' ? 'on' : ''}" title="Every listing at once">List</button><button type="button" data-act="queueView" data-view="one" class="${view === 'one' ? 'on' : ''}" title="One decision at a time, with everything you need to decide">One by one</button></span></nav>` : ''}
    ${syncNewerHtml(o.sync_newer)}
    ${showSteps && !neededDone ? `<section class="card"><header><h2>Finish setting up</h2><a class="btn ghost" href="#welcome">Guided setup</a></header><div class="steps">${steps.map(([done, t, d, href, key]) =>
      `<div class="step-wrap"><a class="step ${done ? 'done' : ''}" href="${href}"><span class="tick">${done ? '✓' : ''}</span><span><b>${esc(t)}</b><br><span class="muted small">${esc(d)}</span></span></a>${key && !done ? `<button class="btn ghost sm" data-act="setupSkip" data-what="${key}" title="Hide this step">Not now</button>` : ''}</div>`).join('')}</div></section>` : ''}
    ${inUseHtml(o.in_use)}
    ${o.progress ? progressHtml(o.progress) : ''}
    <div class="deck">
      <div class="deck-main">
        ${listing ? listing : cur ? decisionHtml(cur, list.indexOf(cur) + 1, list.length)
          : `<section class="card decision done"><div class="dtop"><span class="bigicon good">${svg('check')}</span><div class="grow"><p class="kicker">${step ? 'Nothing here' : neededDone ? 'All caught up' : 'Getting started'}</p>
              <h2>${step ? `No ${step === 'waiting' ? 'follow-ups' : `${FLOW.find(f => f[0] === step)[1].toLowerCase()} decisions`} waiting` : neededDone ? 'Your queue is empty' : 'Connect Claude and add your CV'}</h2>
              <div class="facts"><span>${!neededDone ? 'Then search for jobs: the ones that fit come here, one at a time.' : searching ? 'A search is running: new matches come here when it\'s done.' : side.paused ? `${esc(pausedWords(side.paused))}.` : nextSearch ? `Job Hunt searches again ${esc(nextSearch.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }))}.` : 'Search for jobs to find new matches.'}</span></div></div></div></section>`}
        ${!listing && cur && cur.kind === 'pick' && picks > 3 ? `<p class="muted small deck-note">${picks} to pick from. Rather tick several at once? <a href="#applications/pick">Pick from the list in Pipeline</a>.</p>` : ''}
        ${tailoring ? `<p class="muted small deck-note"><span class="spin" data-kind="tailor+score" data-n="${Math.ceil(tailoring / 3)}"></span>Tailoring ${tailoring} application${tailoring === 1 ? '' : 's'}… they come back here to approve.</p>` : ''}
        ${titleIdeasHtml(o.title_ideas)}
      </div>
      <aside class="deck-side">
        ${!listing && rest.length ? `<h3>Up next</h3><div class="upnext">${rest.slice(0, 5).map(queueMini).join('')}${rest.length > 5 ? `<p class="muted small" style="margin:2px 4px">and ${rest.length - 5} more</p>` : ''}</div>` : ''}
        <h3>Running by itself</h3>
        <section class="card on-auto">
          <div class="auto-line">${svg('search')}<span class="grow"><b>Search</b> <span class="muted">${esc(ago(o.last_search))}${o.last_report && o.last_search ? `: ${o.last_report.new} new` : ''}${side.paused ? '' : nextSearch ? ` · next ${esc(nextSearch.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}</span></span><a class="btn ghost sm" href="#search">Results</a></div>
          <div class="auto-line sched">${scheduleMenu(side.paused, false)}</div>
          ${setup.google || !googleOff ? `<div class="auto-line">${svg('mail')}<span class="grow"><b>Email</b> <span class="muted">${setup.google ? `checked ${esc(ago(o.last_inbox))}` : 'Gmail isn\'t connected'}</span></span>${setup.google ? `<button class="btn ghost sm" data-act="run" data-task="inbox">Check now</button>` : `<a class="btn sm" href="#settings/connections">Connect</a><button class="btn ghost sm" data-act="setupSkip" data-what="google" title="Hide this">Not now</button>`}</div>` : ''}
        </section>
        <h3>This week</h3>
        <section class="card week">
          <a href="#results" class="wk"><b>${o.this_week}${o.weekly_goal ? `<span class="muted"> / ${o.weekly_goal}</span>` : ''}</b><span>applied${delta ? ` · <span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>` : ''}</span></a>
          <a href="#calendar" class="wk"><b>${o.interviews.length}</b><span>interview${o.interviews.length === 1 ? '' : 's'}</span></a>
          <a href="#results" class="wk"><b>${pct(o.response_rate)}</b><span>replied</span></a>
        </section>
        ${showSteps && neededDone && steps.some(st => st[4] && st[4] !== 'google' && !st[0]) ? `<section class="card optional-steps"><b>Optional:</b> ${steps.filter(st => st[4] && st[4] !== 'google' && !st[0]).map(([, t, d, href, key]) =>
          `<span class="opt"><a href="${href}" title="${esc(d)}">${esc(t.replace(' (optional)', ''))}</a><button class="btn ghost sm" data-act="setupSkip" data-what="${key}" title="Hide this">Not now</button></span>`).join('')}</section>` : ''}
      </aside>
    </div>
    <details class="card activity"><summary><b>What Job Hunt did lately</b></summary>
      ${o.events.length ? `<div class="feed" style="margin-top:10px">${o.events.map(e => `<div><time title="${esc(new Date(e.created_at).toLocaleString())}">${esc(ago(e.created_at))}</time><span>${jobLink(e)}${eventText(e)}</span></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}
    </details>`);
  if (listing) restorePickViews();
}

/** One step of the hunt on the Jobs page: what the step is for, and its roles with the next thing to do. */
async function showStep(step) {
  const o = overview;
  const tracked = ['waiting', 'interviews'].includes(step) ? (await api('/api/tracker')).rows : [];
  page(`${jobsHead(step)}
    <p class="muted flow-about">${FLOW.find(([id]) => id === step)[3]}</p>
    ${step === 'pick' ? heldLine() : ''}
    ${stepHtml(o, step, tracked)}`);
  restorePickViews();
}

// ---- Applications ----
/** The list of every job, and its narrower views: each a set of stages. */
const APP_TABS = [['all', 'Everything'], ['new', 'New postings'], ['active', 'In progress'], ['applied', 'Applied']];
const APP_TAB_STAGES = { applied: ['applied', 'interviewing', 'offer', 'rejected', 'no_response'], active: ['ready', 'approved', 'saved'], new: ['queued'] };
async function showPipeline(view) {
  if (FLOW.some(([id]) => id === view)) return showStep(view);
  if (view === 'files') return showDocuments();
  if (!APP_TABS.some(([id]) => id === view)) {
    // Opened from the menu: every job. (What to do next is the Queue's.)
    view = 'all';
  }
  // Every job in one table (applications, new postings, skipped ones): click a column's heading to
  // sort by it. Postings outside your locations aren't shown.
  const [{ jobs: everything }, { rows }] = await Promise.all([api('/api/jobs'), api('/api/tracker')]);
  const inTab = j => view === 'all' || (APP_TAB_STAGES[view] || []).includes(j.status);
  const jobs = everything.filter(j => !outsideYours(j) && j.status !== 'dismissed' && inTab(j));
  const counts = Object.fromEntries(APP_TABS.map(([id]) => [id, everything.filter(j => !outsideYours(j) && j.status !== 'dismissed' && (id === 'all' || (APP_TAB_STAGES[id] || []).includes(j.status))).length]));
  const tracked = Object.fromEntries(rows.map(r => [r.id, r]));
  const WHO = { you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' };
  // A skipped role whose forecast clears your fit score is worth a second look: tailored, it could make it.
  const bar = (settingsCache || await api('/api/settings').catch(() => null))?.profile?.score_threshold ?? 101;
  const worth = j => canReach(j) != null && canReach(j) >= bar ? `<span class="pill good" title="Its fit is below your minimum (${bar}), but tailored it could reach about ${canReach(j)}">Worth a look tailored</span> ` : '';
  const next = j => {
    const r = tracked[j.id];
    if (r) return `<span class="who ${esc(r.who)}">${WHO[r.who] || ''}</span> <span class="small">${nextText(r)}</span>`;
    if (j.status === 'queued') return '<span class="small">Pick it to tailor</span>';
    if (j.status === 'skipped') return `<span class="small muted" title="${esc(j.reasoning || '')}">${worth(j)}${esc((j.reasoning || '').slice(0, 60))}${(j.reasoning || '').length > 60 ? '…' : ''}</span>`;
    return '';
  };
  const nextKey = j => ({ you: 0, them: 1, later: 2, done: 3 }[tracked[j.id]?.who] ?? (j.status === 'queued' ? 0.5 : 4));
  // Until you sort it yourself: what needs you first.
  if (!sortState['t-all']) sortState['t-all'] = { col: 5, dir: 'asc' };
  const opt = (v, n) => `<option value="${esc(v)}">${esc(n)}</option>`;
  const sources = [...new Set(jobs.map(j => j.source))].sort((a, b) => sourceName(a).localeCompare(sourceName(b)));
  const stagesHere = Object.keys(STAGES).filter(k => jobs.some(j => j.status === k));
  const empKinds = ['Full-time', 'Contract', 'Temporary', 'Part-time', 'Internship', 'Co-op', 'Freelance', 'Not stated'].filter(k => jobs.some(j => empKind(j) === k));
  page(`${jobsHead(view, `<a class="btn ghost" href="/api/export.csv" download="Job Hunt applications.csv" title="Company, title, stage, fit, salary, dates, links and notes, for Excel or Google Sheets">${svg('download')}Spreadsheet</a>`)}
    <nav class="tabs sub-tabs">${APP_TABS.map(([id, n]) => `<a href="#applications/${id}" class="${id === view ? 'on' : ''}">${n} <span class="n">${counts[id]}</span></a>`).join('')}</nav>
    ${foldFilters(`<div class="all-filters" id="allFilters">
      <input type="search" data-allf="q" placeholder="Company, role or place" aria-label="Find in the list">
      <label class="small">Stage <select data-allf="stage">${opt('', 'Any')}${opt('you', 'Your move')}${opt('them', 'Waiting on them')}${stagesHere.map(k => opt(k, STAGES[k])).join('')}</select></label>
      <label class="small">Fit <select data-allf="fit">${opt('0', 'Any')}${opt('60', '60 or more')}${opt('70', '70 or more')}${opt('80', '80 or more')}</select></label>
      ${sources.length > 1 ? `<label class="small">Source <select data-allf="source">${opt('', 'Any')}${sources.map(x => opt(x, sourceName(x))).join('')}</select></label>` : ''}
      <label class="small">Found <select data-allf="age">${opt('', 'Any time')}${opt('7', 'Last 7 days')}${opt('30', 'Last 30 days')}</select></label>
      ${empKinds.length > 1 ? `<label class="small">Type <select data-allf="emp">${opt('', 'Any')}${empKinds.map(k => opt(k, k)).join('')}</select></label>` : ''}
      <label class="check small"><input type="checkbox" data-allf="pay"> Shows pay</label>
      <label class="small">Sort by <select data-allf="sort">${opt('5', 'What needs you first')}${opt('4', 'Best fit')}${opt('7', 'Newest')}${opt('3', 'Highest pay')}${opt('0', 'Company')}</select></label>
      <span class="muted small" id="allCount">${jobs.length} job${jobs.length === 1 ? '' : 's'}</span>
      <a class="views-x small" href="/api/export.csv" download="Job Hunt applications.csv" title="Your applications as a spreadsheet">Export</a>
    </div>`)}
    <section class="card" style="padding:6px 10px"><table class="jobs" id="t-all"><thead><tr>${sortTh('Company')}${sortTh('Role')}${sortTh('Location')}${sortTh('Salary', 'num')}${sortTh('Fit', 'num')}${sortTh('Stage', 'rank')}${sortTh('Next step', 'num')}${sortTh('Age', 'date')}${sortTh('Type')}</tr></thead><tbody>
      ${jobs.map(j => `<tr class="click" data-expand="${esc(j.id)}" data-who="${esc(tracked[j.id]?.who || '')}" data-status="${esc(j.status)}" data-source="${esc(j.source)}"
        data-fit="${j.score_after ?? j.score ?? 0}" data-emp="${esc(empKind(j))}" data-pay="${salaryValue(j.salary) > 0 ? 1 : 0}" data-found="${+new Date(j.found_at || 0) || 0}" data-text="${esc(`${j.company} ${j.title} ${j.location || ''}`.toLowerCase())}">
        <td class="co" data-v="${esc(j.company.toLowerCase())}">${coCell(j)}</td>
        <td class="role" data-v="${esc(j.title.toLowerCase())}"><b>${esc(j.title)}</b> ${closedTag(j)}${deadlineTag(j)}${coLocLine(j)}<span class="phone-only"><br>${stagePill(j.status)}</span></td>
        <td class="loc small" data-v="${esc((j.location || '').toLowerCase())}">${locCell(j)}</td>
        <td class="small salary" data-v="${salaryValue(j.salary)}">${salaryCell(j)}</td>
        <td class="fit" data-v="${j.score_after ?? j.score ?? -1}">${scoreBadge(j.score)}${reachTag(j)}</td>
        <td class="stage" data-v="${stageOrder(j.status)}">${stagePill(j.status)}</td>
        <td class="next" data-v="${nextKey(j)}">${rowActions(j) ? `<div class="row-act" title="${esc(next(j).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}">${rowActions(j)}</div>` : next(j)}</td>
        <td class="small muted nowrap" data-v="${esc(ageValue(j))}" title="Found on ${esc(sourceName(j.source))}">${ageTag(j)}</td>
        <td class="small emp" data-v="${esc(j.employment || '~')}">${empCell(j)}</td></tr>`).join('')}
    </tbody></table>${jobs.length ? '' : `<p class="empty">${{ applied: 'Nothing applied to yet. Jobs show here once you apply (or Job Hunt sees the confirmation email).', active: 'Nothing in progress: no tailored applications waiting.', new: 'No new postings to pick from.' }[view] || 'No jobs yet. Search for jobs from the Queue.'}</p>`}</section>`);
  restoreAllFilters();
  main().querySelectorAll('table.jobs').forEach(applySort);
  // j / k on a job page walk through the list as it was shown here.
  jobOrder = [...main().querySelectorAll('[data-expand]')].map(el => el.dataset.expand);
}

/** All jobs' filters: hide rows that don't match, sort by the choice, remember both in this browser. */
function applyAllFilters(save = true) {
  const box = $('#allFilters'), table = $('#t-all');
  if (!box || !table) return;
  const v = {};
  box.querySelectorAll('[data-allf]').forEach(el => { v[el.dataset.allf] = el.type === 'checkbox' ? el.checked : el.value; });
  if (save) try { localStorage.setItem('jh.allFilters', JSON.stringify(v)); } catch (e) {}
  const words = (v.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const since = v.age ? Date.now() - Number(v.age) * 86400000 : 0;
  let shown = 0;
  table.querySelectorAll('tr.xrow').forEach(r => r.remove());
  for (const r of table.tBodies[0].rows) {
    const d = r.dataset;
    const ok = words.every(w => d.text.includes(w))
      && (!v.stage || (v.stage === 'you' || v.stage === 'them' ? d.who === v.stage : d.status === v.stage))
      && Number(d.fit) >= Number(v.fit || 0) && (!v.source || d.source === v.source)
      && (!since || Number(d.found) >= since) && (!v.pay || d.pay === '1') && (!v.emp || d.emp === v.emp);
    r.hidden = !ok; r.classList.remove('open');
    if (ok) shown++;
  }
  $('#allCount').textContent = `${shown < table.tBodies[0].rows.length ? `${shown} of ` : ''}${table.tBodies[0].rows.length} jobs`;
  const col = Number(v.sort || 5);
  if (!sortState['t-all'] || sortState['t-all'].col !== col || save) {
    sortState['t-all'] = { col, dir: [0, 5].includes(col) ? 'asc' : 'desc' };
    applySort(table);
  }
}
function restoreAllFilters() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('jh.allFilters') || '{}') || {}; } catch (e) {}
  document.querySelectorAll('#allFilters [data-allf]').forEach(el => { if (el.dataset.allf in saved) el.type === 'checkbox' ? el.checked = !!saved[el.dataset.allf] : el.value = saved[el.dataset.allf]; });
  applyAllFilters(false);
}
document.addEventListener('input', e => { if (e.target.matches?.('[data-allf]')) applyAllFilters(); });
document.addEventListener('change', e => { if (e.target.matches?.('select[data-allf], input[type=checkbox][data-allf]')) applyAllFilters(); });

/** How each source is called on screen. */
const SOURCE = { adzuna: 'Adzuna', jsearch: 'Google for Jobs', jooble: 'Jooble', indeed: 'Indeed', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', smartrecruiters: 'SmartRecruiters', workable: 'Workable', bamboohr: 'BambooHR', linkedin: 'LinkedIn', bayt: 'Bayt', naukrigulf: 'Naukrigulf', gulftalent: 'GulfTalent', eluta: 'Eluta', workopolis: 'Workopolis', glassdoor: 'Glassdoor', jobbank: 'Job Bank', freehire: 'FreeHire', ziprecruiter: 'ZipRecruiter', manual: 'Added by you', clip: 'Sent from your browser', alert: 'Job-alert email', email: 'Job-alert email' };
const sourceName = s => SOURCE[s] || (s ? s[0].toUpperCase() + s.slice(1) : '');
/** Stages a posting can be picked from, whatever its score or location ("Tailor anyway"). */
const CAN_CHOOSE = ['skipped', 'dismissed', 'saved'];
/** The next step for a job, right on its row. */
function rowActions(j) {
  const id = esc(j.id);
  if (j.status === 'ready') return `<button class="btn primary sm" data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">Approve</button><button class="btn ghost sm" data-act="stage" data-status="dismissed" data-job="${id}" data-from="ready" title="Not interested">${svg('close')}</button>`;
  if (j.status === 'approved') return `<a class="btn primary sm" href="#apply/${encodeURIComponent(j.id)}">Apply</a>`;
  if (j.status === 'queued') return `<button class="btn sm" data-act="tailorPicked" data-job="${id}">Tailor</button>`;
  if (['skipped', 'dismissed'].includes(j.status)) return `<button class="btn ghost sm" data-act="tailorAnyway" data-job="${id}">Tailor anyway</button>`;
  return '';
}

/** The posting's stated pay, or a dash. Extras some boards add ("• Offers Equity") go in the tooltip. */
/** Full-time, contract (and for how long), part-time…, as the posting says; "—" when it doesn't. */
const empCell = j => j.employment ? `<span class="emp-${esc(empKind(j).toLowerCase().replace(/[^a-z]/g, ''))}">${esc(j.employment)}</span>` : '<span class="muted">—</span>';
/** The kind alone, for the Type filter: "Contract · 12 months" is a Contract. */
const empKind = j => !j.employment ? 'Not stated' : j.employment.startsWith('Full-time or') ? 'Part-time' : j.employment.split(' · ')[0];
/** You've sent this company a CV before (for another role): a tag, with which ones. */
const appliedBeforeTag = j => (j.applied_before || []).length ? ` <span class="pill info" title="${esc(`You applied to ${j.company} before: ${j.applied_before.map(x => `${x.title} (${STAGES[x.status] || x.status}${x.applied_at ? `, ${fmtDate(x.applied_at)}` : ''})`).join('; ')}`)}">Applied here before</span>` : '';
/** Your history with the company: where you applied before, and your own notes. */
function historyHtml(j, history, notes, mode) {
  if (!(history || []).length && !notes) return '';
  return `<section class="card company-history"><header><h2>Your history with ${esc(j.company)}</h2></header>
    ${(history || []).length ? `<ul class="small">${history.map(x => `<li><a href="#job/${encodeURIComponent(x.id)}">${esc(x.title)}</a> · ${esc(STAGES[x.status] || x.status)}${x.applied_at ? ` · applied ${esc(fmtDate(x.applied_at))}` : ''}</li>`).join('')}</ul>
      <p class="muted small">${mode === 'same' ? `This role gets the same CV you sent them.` : mode === 'usual' ? 'Tailored as usual (Search → What to search → Tailoring).' : `${esc(j.company)} keeps the CVs you sent on file, so this one stays close to the last: the same headline, at most 4 paragraphs changed.`}</p>` : ''}
    <label class="field small">Your notes on ${esc(j.company)}<textarea id="companyNotes" placeholder="e.g. The recruiter said to wait six months before applying again." style="min-height:60px">${esc(notes || '')}</textarea></label>
    <div class="row"><button class="btn sm" data-act="saveCompanyNotes" data-company="${esc(j.company)}">Save notes</button></div></section>`;
}
/** This CV beside the one you last sent the company: what differs, and a way back to that one. */
function sentCompareHtml(j, c) {
  if (!c || !j.cv_path) return '';
  const n = (c.changes || []).length;
  return `<section class="card sent-compare"><header><h2>Beside the CV you sent ${esc(j.company)} before</h2>${n ? '<button class="btn sm" data-act="reuseCv">Use the CV you sent before</button>' : ''}</header>
    <p class="small">${n ? `<b>${n} paragraph${n === 1 ? '' : 's'}</b> differ from the CV you sent for <a href="#job/${encodeURIComponent(c.job.id)}">${esc(c.job.title)}</a>${c.job.applied_at ? ` (${esc(fmtDate(c.job.applied_at))})` : ''}. They keep both on file; small, keyword-level differences are normal, a different headline or story is what stands out.` : `The same as the CV you sent for <a href="#job/${encodeURIComponent(c.job.id)}">${esc(c.job.title)}</a>.`}</p>
    ${n ? `<details ${n <= 4 ? 'open' : ''}><summary class="small muted">What differs</summary>${c.changes.map(x => `<div class="rev-para">${wordDiff(x.before, x.after)}</div>`).join('')}</details>` : ''}</section>`;
}
/** Two versions of a paragraph, word by word: removed words struck through, added ones highlighted. */
function wordDiff(before, after) {
  const a = String(before || '').split(/(\s+)/).filter(Boolean), b = String(after || '').split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 250000) return `<del>${esc(before)}</del> <ins>${esc(after)}</ins>`;
  const n = a.length, m = b.length, l = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) l[i][j] = a[i] === b[j] ? l[i + 1][j + 1] + 1 : Math.max(l[i + 1][j], l[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out += esc(a[i]); i++; j++; }
    else if (i < n && (j === m || l[i + 1][j] >= l[i][j + 1])) { out += /^\s+$/.test(a[i]) ? '' : `<del>${esc(a[i])}</del>`; i++; }
    else { out += /^\s+$/.test(b[j]) ? esc(b[j]) : `<ins>${esc(b[j])}</ins>`; j++; }
  }
  return out.replace(/<\/ins>(\s*)<ins>/g, '$1').replace(/<\/del><del>/g, ' ');
}
/** The last change you asked for (or made) to the tailored CV or letter, highlighted word by word. */
function revisionHtml(r) {
  if (!r || !(r.changes || []).length) return '';
  const what = r.what === 'letter' ? 'cover letter' : 'CV';
  return `<section class="card revision"><header><h2>What changed just now</h2><button class="btn sm" data-act="revisionSeen">Done</button></header>
    <p class="muted small">In your ${what}${r.note && r.note !== 'your edit' ? `, for “${esc(r.note)}”` : r.note === 'your edit' ? ', by you' : ''} · ${esc(ago(r.at))}. <del>Struck through</del> is gone, <ins>highlighted</ins> is new; the paragraphs are marked in the preview too.</p>
    ${r.changes.map(c => `<div class="rev-para">${!c.before ? '<span class="pill good">New paragraph</span> ' : !c.after ? '<span class="pill crit">Removed</span> ' : ''}${wordDiff(c.before, c.after)}</div>`).join('')}</section>`;
}
/** Mark the changed paragraphs in the preview, once it's drawn. */
function markRevision(r) {
  if (!r) return;
  const norm = t => String(t || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const after = new Set((r.changes || []).map(c => norm(c.after)).filter(Boolean));
  const box = document.getElementById(r.what === 'letter' ? 'pv-letter' : 'pv-cv');
  if (!box || !after.size) return;
  box.querySelectorAll('p, li, div').forEach(el => { if (!el.children.length || el.tagName !== 'DIV') { if (after.has(norm(el.textContent))) { el.classList.add('just-changed'); el.title = 'Changed just now'; } } });
}
const salaryCell = j => {
  if (!j.salary) return '<span class="muted">—</span>';
  const [pay, ...rest] = String(j.salary).split(/\s+[•·|]\s+/);
  return `<span title="${esc(j.salary)}">${esc(pay)}</span>${rest.length ? `<br><span class="muted">${esc(rest.join(' · '))}</span>` : ''}`;
};

/** The top of a salary as a yearly number, for sorting: "$110,000–$135,000" → 135000, "CA$95K–120K" → 120000, "$45–$55/hour" → 114400. */
function salaryValue(s) {
  if (!s) return -1;
  const t = String(s).split(/\s+[•·|]\s+/)[0];
  const nums = [...t.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*([kK])?/g)].map(m => Number(m[1]) * (m[2] ? 1000 : 1));
  if (!nums.length) return -1;
  let top = Math.max(...nums);
  if (/hour|\/hr/i.test(t)) top *= 2080;
  return Math.round(top);
}
const stageOrder = s => ['ready', 'approved', 'queued', 'applied', 'interviewing', 'offer', 'rejected', 'no_response', 'saved', 'skipped', 'dismissed'].indexOf(s);

// ---- sortable tables ----
const sortState = {};
/** A header cell that sorts its column: "date" and "num" sort largest first on the first click; "text" and "rank" (stage order) smallest first. */
const sortTh = (label, type = 'text') => `<th class="sortable" data-type="${type}" title="Sort by ${esc(label.toLowerCase())}">${esc(label)}<span class="arrow"></span></th>`;

function applySort(table) {
  const st = sortState[table.id];
  if (!st) return;
  const th = table.tHead.rows[0].cells[st.col];
  if (!th) return;
  // Close any open postings first; their detail rows would end up out of place.
  table.querySelectorAll('tr.xrow').forEach(r => r.remove());
  table.querySelectorAll('tr.open').forEach(r => r.classList.remove('open'));
  const body = table.tBodies[0];
  const num = ['num', 'rank'].includes(th.dataset.type);
  const val = r => { const v = r.cells[st.col]?.dataset.v ?? r.cells[st.col]?.textContent ?? ''; return num ? Number(v) : v; };
  const rows = [...body.rows].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return st.dir === 'asc' ? c : -c; });
  rows.forEach(r => body.appendChild(r));
  [...table.tHead.rows[0].cells].forEach((c, i) => { c.classList.toggle('sorted', i === st.col); const a = c.querySelector('.arrow'); if (a) a.textContent = i === st.col ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''; });
}

document.addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const table = th.closest('table');
  const col = th.cellIndex, prev = sortState[table.id];
  const first = ['text', 'rank'].includes(th.dataset.type) ? 'asc' : 'desc';
  sortState[table.id] = { col, dir: prev && prev.col === col ? (prev.dir === 'asc' ? 'desc' : 'asc') : first };
  try { localStorage.setItem('sort', JSON.stringify(sortState)); } catch (err) {}
  applySort(table);
});
try { Object.assign(sortState, JSON.parse(localStorage.getItem('sort') || '{}')); } catch (err) {}

// ---- Tracker ----
/** The steps an application has reached, as dots on a line, with dates on hover. */
function stepsHtml(r) {
  const at = r.steps.map(x => x.at);
  const lastDone = at.reduce((m, a, i) => a ? i : m, -1);
  return `<ol class="tsteps">${r.steps.map((x, i) => `<li class="${x.at ? 'done' : i < lastDone ? 'skip' : ''}${x.bad ? ' bad' : ''}" title="${esc(x.step)}${x.at ? `: ${esc(fmtDate(x.at))}` : ''}"><i></i><span>${esc(x.step)}</span></li>`).join('')}</ol>`;
}
function nextText(r) {
  return r.next_interview ? `Interview ${esc(fmtWhen(r.next_interview))}` : esc(r.next);
}
function trackRow(r) {
  const id = esc(r.id);
  const act = r.follow_up_due ? `<button class="btn sm" data-act="followUp" data-job="${id}">Write follow-up</button>` : rowActions(r);
  return `<div class="trow">
    <span class="co">${coCell(r)}</span>
    <a class="grow tmain" href="#job/${encodeURIComponent(r.id)}"><span class="qt">${esc(r.title)}</span> ${closedTag(r)}${deadlineTag(r)}${coLocLine(r)}</a>
    <span class="loc small">${locCell(r)}</span>
    ${stepsHtml(r)}
    <div class="tnext"><span class="who ${esc(r.who)}">${{ you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' }[r.who] || ''}</span>
      <span class="small">${nextText(r)}</span>
      <span class="muted small">${r.last_step ? `${esc(r.last_step)} ${r.days_since === 0 ? 'today' : `${r.days_since} day${r.days_since === 1 ? '' : 's'} ago`}` : ''}</span></div>
    <span class="row todo-act">${act}</span></div>`;
}

// ---- Job ----
let jobPoll;
const JOB_TABS = [['overview', 'Overview'], ['docs', 'CV &amp; letter'], ['apply', 'Questions &amp; contacts'], ['interview', 'Interview'], ['chat', 'Ask Claude']];
const jobTabs = {};
/** The job's buttons: its next step first, as the main one, then the rest, all in view. */
function jobActions(j, tailoring, progress) {
  const id = esc(j.id), on = `data-job="${id}" data-from="${esc(j.status)}"`;
  const enc = encodeURIComponent(j.id);
  // What to do now, in a sentence, with its button (or two).
  let next = '', main = [];
  if (tailoring) next = 'Job Hunt is tailoring your CV and cover letter. This page updates by itself.';
  else if (j.status === 'queued') { next = 'Read the posting and why it fits. Worth applying to? Job Hunt tailors your CV and writes a cover letter.'; main = [`<button class="btn primary" data-act="tailorPicked" data-job="${id}">Tailor my CV for this role</button>`]; }
  else if (j.status === 'ready') { next = 'Read your tailored CV and cover letter below, change what you like, then approve.'; main = [`<button class="btn primary" data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">${svg('check')}${j.apply_email ? `Approve and email to ${esc(j.apply_email)}` : 'Approve and apply'}</button>`]; }
  else if (j.status === 'approved') { next = 'Submit it on the company\'s site. Job Hunt fills in the form in your browser; you check it and press Submit.';
    main = [overview?.can_fill && j.url ? `<button class="btn primary" data-act="fillBrowser" data-job="${id}">${svg('open')}Fill it in my browser</button>` : `<a class="btn primary" href="#apply/${enc}">${svg('open')}Apply</a>`,
      overview?.can_fill && j.url ? `<a class="btn" href="#apply/${enc}">Files and answers</a>` : '', `<button class="btn" data-act="stage" ${on} data-status="applied">${svg('check')}Mark applied</button>`]; }
  else if (j.status === 'saved') { next = 'Saved for later.'; main = [`<button class="btn primary" data-act="stage" ${on} data-status="${j.cv_path ? 'ready' : 'queued'}">Bring it back</button>`]; }
  else if (['skipped', 'dismissed'].includes(j.status)) next = j.status === 'skipped' ? 'Set aside: its fit was below your minimum, or a filter caught it. You can still tailor it.' : 'You marked it Not interested. You can still tailor it.';
  else if (progress && ['applied', 'interviewing', 'offer'].includes(j.status)) next = nextText(progress);
  if (['skipped', 'dismissed'].includes(j.status) || (j.status === 'saved' && !j.cv_path)) main.push(`<button class="btn ${j.status === 'saved' ? '' : 'primary'}" data-act="tailorAnyway" data-job="${id}" ${tailoring ? 'disabled' : ''}>Tailor anyway</button>`);
  // The rest: always there, never in the way.
  const b = [];
  if (j.apply_url) b.push(`<button class="btn ghost sm" data-act="open" data-job="${id}" data-what="company">${svg('open')}On the company's site</button>`);
  if (j.url) b.push(`<button class="btn ghost sm" data-act="open" data-job="${id}" data-what="posting">${svg('open')}Open posting</button>`);
  if (['ready', 'approved', 'queued'].includes(j.status)) b.push(`<button class="btn ghost sm" data-act="stage" ${on} data-status="saved">Save for later</button>`, `<button class="btn ghost sm danger" data-act="stage" ${on} data-status="dismissed">Not interested</button>`);
  return `<section class="card next-step actions">
      <div class="next-main">${next ? `<p class="grow"><b>Next:</b> ${next}</p>` : '<span class="grow"></span>'}<div class="row">${main.filter(Boolean).join('')}</div></div>
      ${b.length ? `<div class="row next-more">${b.join('')}</div>` : ''}</section>`;
}
/** "Why it fits", up top: the strongest match, the biggest gap, and anything to check. */
function whyBox(j, flags, note = '') {
  if (!j.reasoning && !flags.length && j.score == null) return '';
  const r = (j.reasoning || '').trim();
  const m = r.match(/^(.*?)(?:\.?\s*)(?:Gap|Biggest gap|Main gap)s?:\s*(.*)$/i);
  const match = (m ? m[1] : r).replace(/^(Strong(est)? match|Match):\s*/i, '').replace(/\.$/, '');
  const gap = m ? m[2].replace(/\.$/, '') : '';
  const must = mustHaves(j), other = flags.filter(f => !/^must have:/i.test(f));
  return `<section class="card why-box">
    ${j.score != null ? `<div class="why-score">${scoreBadge(j.score)}${reachTag(j)}</div>` : ''}
    <div class="grow">
      ${match ? `<p><span class="why-label good-text">Why it fits</span> ${esc(match)}</p>` : ''}
      ${gap ? `<p><span class="why-label warn-text">Biggest gap</span> ${esc(gap)}</p>` : ''}
      ${must.length ? `<p><span class="why-label warn-text">Required, not on your CV</span> ${esc(must.join('; '))}</p>` : ''}
      ${other.length ? `<p><span class="why-label bad-text">Check</span> ${esc(other.join('; '))}</p>` : ''}
      ${note ? `<p class="muted small">${note}</p>` : ''}
    </div></section>`;
}
async function showJob(id) {
  clearTimeout(jobPoll);
  const [{ job: j, effort, warnings, history, progress, own, prep, preparing, rating, rating_busy, cv_pdf, letter_pdf, revising, undo, follow_up: fu, following_up, thanks, thanking, answers, answering, offer, advising, contacts, playbook, revision, company_history, company_notes, sent_compare, repeat_mode, know, chat, chatting, links, writing_to, ats, claude_desktop, recruiter, recruiters_here }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(id)}`), api('/api/settings')]);
  j.effort = effort;
  const tailoring = (overview?.running || []).includes(`tailor:${id}`);
  const gaps = new Set((j.keyword_gaps || []).map(k => k.toLowerCase()));
  const tracks = st.profile.tracks;
  const flags = j.red_flags || [];
  j.warnings = warnings || [];
  // Open on what this stage needs, or on the tab you last used for this job.
  const stageTab = { ready: 'docs', queued: 'overview', approved: 'apply', applied: 'apply', interviewing: 'interview', offer: 'apply' }[j.status] || 'overview';
  // Only the tabs this stage needs: questions and contacts once there's an application, the
  // interview once it's sent. Notes and history are on the Overview.
  const sent = ['applied', 'interviewing', 'offer', 'rejected', 'no_response'].includes(j.status);
  const tabs = JOB_TABS.filter(([k]) => k === 'apply' ? !['queued', 'skipped', 'dismissed'].includes(j.status) || (contacts || []).length || (answers || []).length
    : k === 'interview' ? sent || !!prep || preparing : true);
  const want = jobTabs[id] === 'notes' ? 'overview' : jobTabs[id] || stageTab;
  const tab = tabs.some(([k]) => k === want) ? want : 'overview';
  const badge = { docs: revising || tailoring ? 'Working on it' : '', apply: answering || following_up || writing_to || advising ? 'Working on it' : (j.status === 'offer' && !offer ? 'Weigh the offer' : ''), interview: preparing ? 'Writing' : '' };
  page(`
    <div class="head">
      <div class="grow">
        <div class="eyebrow"><a href="#applications">Jobs</a> / ${esc(STAGES[j.status] || j.status)}</div>
        <h1>${esc(j.title)}</h1>
        <div class="facts" style="margin-top:6px"><b>${esc(j.company)}</b>${j.location ? `<span>${placeHtml(j)}</span>` : ''}${j.salary ? `<span>${esc(j.salary)}</span>` : ''}<span>${ageTag(j)} · found on ${esc(sourceName(j.source))}</span>${stagePill(j.status)}${closedTag(j)}${belowMinTag(j)}${deadlineTag(j)}${stretchTag(j)}${effortTag(j)}${(company_history || []).length ? ' <span class="pill info">Applied here before</span>' : ''}</div>
      </div>
    </div>
    ${jobActions(j, tailoring, progress)}
    ${j.warnings.length && !j.closed_at && !['applied', 'interviewing', 'offer'].includes(j.status) ? `<div class="card" style="border-color:var(--warn)"><b>Check this posting is real and open before you put time in.</b><ul class="flags">${j.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${expiredWhy(j) ? `<div class="card" style="border-color:var(--crit)"><b>This opening has expired.</b><p class="muted">${esc(expiredWhy(j).replace(/^Expired: /, '').replace(/^./, c => c.toUpperCase()))}. Open the posting to make sure, then mark it Not interested.</p></div>` : ''}
    ${(recruiters_here || []).length ? `<div class="card"><b>Recruiter${recruiters_here.length === 1 ? '' : 's'} for this application</b>${recruiters_here.map(r => `<div class="small" style="margin-top:6px"><b>${esc(r.name)}</b> <span class="muted">${esc(r.company_of || '')}</span> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ` · <a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}${r.linkedin ? ` · <a href="#" data-act="link" data-url="${esc(r.linkedin)}">LinkedIn</a>` : ''}<br><span class="muted">${esc(r.emails)} email${r.emails === 1 ? '' : 's'} · last ${esc(ago(r.last_at))}${r.last_subject ? ` · “${esc(r.last_subject)}”` : ''}</span></div>`).join('')}<a class="small" href="#inbox/recruiters">All recruiters</a></div>` : ''}
    ${recruiter && !['rejected', 'offer', 'no_response', 'dismissed'].includes(j.status) && !(recruiters_here || []).some(r => r.email === recruiter.email && ['applied', 'interviewing'].includes(j.status)) ? recruiterCard(recruiter, j) : ''}
    ${tailoring ? `<p class="muted small"><span class="spin" data-kind="tailor+score"></span> Tailoring…</p>` : ''}
    ${revising ? `<div class="card"><p><span class="spin" data-kind="revise"></span> Making your changes… this page updates by itself.</p></div>` : ''}
    <nav class="tabs job-tabs" id="jobTabs">${tabs.map(([k, n]) => `<a href="#" data-jtab="${k}" class="${k === tab ? 'on' : ''}">${n}${badge[k] ? `<span class="tab-dot" title="${esc(badge[k])}"></span>` : ''}</a>`).join('')}</nav>
    <div class="jpane" data-pane="overview" ${tab === 'overview' ? '' : 'hidden'}>
      <section class="card progress-main">
        <header><h2>${progress ? 'Progress' : 'Stage'}</h2>${progress ? `<span class="who ${esc(progress.who)}">${{ you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' }[progress.who] || ''}</span>` : ''}</header>
        ${progress ? stepsHtml(progress) : ''}
        <div class="progress-foot">
          ${progress ? `<div class="grow"><p style="margin:0"><b>Next:</b> ${nextText(progress)}</p>
            <p class="muted small timeline-inline">${progress.steps.filter(x => x.at).map(x => `<b>${esc(x.step)}</b> ${esc(fmtDate(x.at))}`).join(' · ')}</p></div>` : '<div class="grow"></div>'}
          <div class="row stage-set"><select id="stage" style="width:auto" aria-label="Stage">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
            <input type="text" id="stageNote" placeholder="Note (optional)"><button class="btn" data-act="setStage">Save</button></div>
        </div>
      </section>
      <div class="job-grid">
        <div class="stack">
          ${whyBox(j, flags, j.track ? `Matched to your <b>${esc((tracks.find(t => t.name === j.track) || {}).label || j.track)}</b> CV${j.score_after != null ? `; tailored, it scores <b>${j.score_after}</b> (${j.score_after >= j.score ? '+' : ''}${j.score_after - j.score})` : canReach(j) ? `; tailored, it could reach about <b>${canReach(j)}</b>` : ''}.` : '')}
          <section class="card posting-card"><header><h2>The posting</h2>${j.url ? `<button class="btn ghost sm" data-act="open" data-what="${j.apply_url ? 'company' : 'posting'}">${svg('open')}Open it on the site</button>` : ''}</header>
            <div class="posting">${esc(j.description || 'The source gave no description. Open it on the site to read it.')}</div></section>
        </div>
        <div class="stack">
          ${ratingCard(rating, rating_busy, j.company)}
          ${(j.keywords || []).length ? `<section class="card">
            <header><h2>Posting keywords</h2></header>
            ${j.coverage_after != null ? `<p class="muted small">Your CV covered <b>${pct(j.coverage_before)}</b> before tailoring, <b>${pct(j.coverage_after)}</b> after.</p>` : ''}
            <div>${j.keywords.map(k => `<span class="kw ${gaps.has(k.toLowerCase()) ? 'miss' : ''}">${esc(k)}</span>`).join('')}</div>
            ${gaps.size ? '<p class="muted small">Dashed keywords are not in the tailored CV, because nothing in your experience backs them up or they didn\'t fit. Add one yourself only if it\'s true.</p>' : ''}
          </section>` : ''}
          <section class="card">
            <header><h2>Notes</h2></header>
            <textarea id="notes" placeholder="Contacts, referral, salary talk…">${esc(j.notes || '')}</textarea>
            <div class="row"><button class="btn" data-act="saveNotes">Save notes</button></div>
          </section>
          <details class="card"><summary><b>History</b> <span class="muted small">${history.length} event${history.length === 1 ? '' : 's'}</span></summary>
            <div class="feed">${history.map(e => `<div><time title="${esc(new Date(e.created_at).toLocaleString())}">${esc(fmtDate(e.created_at))}</time><span>${eventText(e)}</span></div>`).join('')}</div>
          </details>
        </div>
      </div>
    </div>
    <div class="jpane" data-pane="docs" ${tab === 'docs' ? '' : 'hidden'}>
    ${j.cv_path || j.cover_letter || tailoring ? '' : `<section class="card"><p class="muted">Not tailored yet. Let Job Hunt tailor your CV, or attach one you tailored yourself: it moves to Approve and is used when you apply.</p>
      <div class="row"><button class="btn primary" data-act="tailorPicked" data-job="${esc(j.id)}">Tailor my CV for this role</button><label class="btn">${svg('doc')}Attach my own CV<input type="file" accept=".docx,.pdf" data-upload="own-cv" hidden></label></div></section>`}
    ${(links || []).length ? `<section class="card"><header><h2>Your links</h2></header>${links.map(l => `<p class="small"><b>${esc(l.site)}</b>: ${l.opened ? `<span class="good-text">opened ${l.opened} time${l.opened === 1 ? '' : 's'}</span>, last ${esc(ago(l.last))}` : '<span class="muted">not opened yet</span>'}${l.previews ? ` <span class="muted">(${l.previews} by link checkers)</span>` : ''}</p>`).join('')}</section>` : ''}
    ${revisionHtml(revision)}
    ${sentCompareHtml(j, sent_compare)}
    ${historyHtml(j, company_history, company_notes, repeat_mode)}
    ${j.cv_path || j.cover_letter ? `<section class="card">
      <div class="row file-row">${j.cv_path ? `<button class="btn" data-act="open" data-what="cv">${svg('doc')}${own?.cv ? 'Open your CV' : 'Open tailored CV'}</button><button class="btn" data-act="open" data-what="letter">${svg('doc')}Open cover letter</button>
        <button class="btn ghost" data-act="open" data-what="cv-pdf" title="${cv_pdf ? 'Open the PDF copy' : 'Make a PDF copy (needs Word or LibreOffice)'}">CV PDF</button><button class="btn ghost" data-act="open" data-what="letter-pdf" title="${letter_pdf ? 'Open the PDF copy' : 'Make a PDF copy (needs Word or LibreOffice)'}">Letter PDF</button>
        <button class="btn" data-act="open" data-what="folder">${svg('folder')}Show files</button>` : ''}</div>
      <header><h2>Preview</h2><div class="seg small" id="pvTabs">
        ${j.cv_path ? `<button class="on" data-pv="cv">${own?.cv ? 'Your CV' : 'Tailored CV'}</button>` : ''}${j.cover_letter && !own?.letter ? `<button class="${j.cv_path ? '' : 'on'}" data-pv="letter">Cover letter</button>` : ''}</div></header>
      ${j.cv_path ? (own?.cv && /\.pdf$/i.test(j.cv_path) ? `<div id="pv-cv"><iframe class="pdf-view" src="/api/jobs/${encodeURIComponent(j.id)}/view/cv" title="Your CV"></iframe></div>` : '<div class="paper" id="pv-cv"><p class="muted">Loading…</p></div>') : ''}
      ${j.cover_letter && !own?.letter ? `<div class="paper letter" id="pv-letter" ${j.cv_path ? 'hidden' : ''}>${letterHtml(j.cover_letter, st.signature)}</div>` : ''}
      <p class="muted small">${own?.cv ? 'This is the CV you attached; it\'s the one used when you apply. ' : j.cv_path ? '<span class="chg-key">Highlighted</span> paragraphs were reworded for this posting. ' : ''}Open the Word files above to see the exact layout.</p>
      ${ats ? atsHtml(ats) : ''}
    </section>
    <section class="card">
      <header><h2>Ask for changes</h2>${undo.cv || undo.letter ? `<div class="row">${undo.cv ? '<button class="btn ghost" data-act="undoRevision" data-what="cv">Undo last CV change</button>' : ''}${undo.letter ? '<button class="btn ghost" data-act="undoRevision" data-what="letter">Undo last letter change</button>' : ''}</div>` : ''}</header>
      <div class="row" style="align-items:flex-start">
        <select id="reviseWhat" style="width:auto">${j.cv_path && !own?.cv ? '<option value="cv">Tailored CV</option>' : ''}${j.cover_letter && !own?.letter ? '<option value="letter">Cover letter</option>' : ''}</select>
        <textarea id="reviseNote" style="flex:1;min-height:64px" placeholder="e.g. Make it shorter · Lead with the ERP rollout · Put SAP in the summary · Less formal"></textarea>
      </div>
      <div class="row"><button class="btn primary" data-act="revise" ${revising || tailoring ? 'disabled' : ''}>Make the change</button>
        <span class="muted small">Claude changes only what you ask, using what's true in your CV. You can undo the last change.</span></div>
    </section>` : ''}
      <div class="grid-2">
        <div class="stack">
        ${(j.cv_changes || []).length && !own?.cv ? `<section class="card">
          <header><h2>What changed in your CV</h2><span class="muted small">${j.cv_changes.length} paragraph${j.cv_changes.length === 1 ? '' : 's'} reworded</span></header>
          ${changesHtml(j, false)}
        </section>` : ''}
        ${j.cv_path || j.cover_letter ? `<section class="card">
          <header><h2>Your own files</h2></header>
          <p class="muted small">Tailored a CV or letter for this role yourself? Attach it (Word or PDF) and Job Hunt uses it instead, in the Apply screen and in emailed applications. Job Hunt's version is kept.</p>
          ${['cv', 'letter'].map(w => own?.[w]
            ? `<div class="row"><span class="pill good">Using your own ${w === 'cv' ? 'CV' : 'cover letter'}</span><span class="small">${esc(((w === 'cv' ? j.cv_path : j.letter_path) || '').split(/[\\/]/).pop())}</span>
                <button class="btn ghost sm" data-act="ownOff" data-what="${w}">Use Job Hunt's ${w === 'cv' ? 'CV' : 'letter'}</button>
                <label class="btn ghost sm">Replace<input type="file" accept=".docx,.pdf" data-upload="own-${w}" hidden></label></div>`
            : `<label class="btn">${svg('doc')}Attach my own ${w === 'cv' ? 'CV' : 'cover letter'}<input type="file" accept=".docx,.pdf" data-upload="own-${w}" hidden></label>`).join(' ')}
        </section>` : ''}
        <section class="card">
          <header><h2>${j.cv_path ? 'Tailor again' : 'Tailor'}</h2></header>
          ${tracks.length ? `<p class="muted small">Starts from your <b>${esc(trackLabel(j.track || tracks[0].name))}</b> CV, the closest fit for this role.</p>` : '<p class="muted small">Add a CV in <a href="#cvs">Profile</a> first.</p>'}
          <div class="row" ${tracks.length && j.cv_path ? '' : 'hidden'}><button class="btn" data-act="retailor" ${tailoring ? 'disabled' : ''}>Tailor again</button></div>
          ${tracks.length > 1 ? `<details class="small" style="margin-top:6px"><summary class="muted">Use a different CV</summary><div class="row" style="margin-top:6px"><select id="track" style="width:auto">${tracks.map(t => `<option value="${esc(t.name)}" ${t.name === j.track ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select><button class="btn" data-act="retailor" data-pick="1" ${tailoring ? 'disabled' : ''}>Tailor from it</button></div></details>` : ''}
        </section>
        </div>
        <div class="stack">
        ${j.cover_letter != null && !own?.letter ? `<details class="card">
          <summary><b>Edit the cover letter yourself</b> <span class="muted small">or ask for changes above</span></summary>
          <p class="muted small">Your edits update the Word file too. Put ** around words to make them bold.</p>
          <textarea id="letter" style="min-height:340px">${esc(j.cover_letter)}</textarea>
          <div class="row"><button class="btn" data-act="saveLetter">Save cover letter</button></div>
        </details>` : ''}
        </div>
      </div>
    </div>
    <div class="jpane" data-pane="apply" ${tab === 'apply' ? '' : 'hidden'}>
    ${['ready', 'approved', 'applied', 'interviewing', 'offer'].includes(j.status) ? `<section class="card" id="kitCard"><details ${j.status === 'approved' ? 'open' : ''}><summary><h2 style="display:inline">Copy-and-paste kit</h2> <span class="muted small">every detail a form asks for, to copy one at a time when Fill this form doesn't work</span></summary><div id="kitBody" data-job="${esc(j.id)}"><p class="muted small">Loading…</p></div></details></section>` : ''}
    ${['ready', 'approved', 'applied', 'interviewing'].includes(j.status) || answers ? `<section class="card">
      <header><h2>Application questions</h2>${answering ? '<span class="muted small"><span class="spin" data-kind="answers"></span>Writing…</span>' : ''}</header>
      <p class="muted small">Paste the form's questions, one per line, or leave it empty for the usual ones (why this role, salary expectations, notice period…). Answers use your CV, this posting and your <a href="#cvs/details">facts for forms</a>.</p>
      <textarea id="questions" placeholder="Why do you want to work at ${esc(j.company)}?\nHow many years of experience do you have with SAP?">${esc((answers || []).map(a => a.question).join('\n'))}</textarea>
      <div class="row"><button class="btn primary" data-act="answers" ${answering ? 'disabled' : ''}>${answers ? 'Write them again' : 'Write answers'}</button></div>
      ${(answers || []).map((a, i) => `<div class="qa"><b>${esc(a.question)}</b><div class="posting" id="ans${i}">${esc(a.answer)}</div><button class="btn ghost" data-act="copy" data-from="ans${i}">Copy</button></div>`).join('')}
    </section>` : ''}
    ${fu || following_up || j.status === 'applied' ? `<section class="card">
      <header><h2>Follow-up</h2>${following_up ? '<span class="muted small"><span class="spin" data-kind="followup"></span>Writing…</span>' : `<button class="btn" data-act="followUp" data-job="${esc(j.id)}">${fu ? 'Write again' : 'Write follow-up'}</button>`}</header>
      ${fu ? `<p class="small muted">${fu.draft ? 'Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>' : 'Written'} ${esc(ago(fu.at))}${fu.to ? ` · to ${esc(fu.to)}` : ' · add the recruiter\'s address before sending'}</p>
        <p><b>${esc(fu.subject)}</b></p><div class="posting" id="fuBody">${esc(fu.body)}</div>
        <div class="row"><button class="btn ghost" data-act="copy" data-from="fuBody">Copy</button></div>`
        : `<p class="muted">${following_up ? 'Claude is writing a short, polite note asking about the timeline.' : `No reply yet? Job Hunt drafts a short follow-up ${st.profile.follow_up_after ? `${st.profile.follow_up_after} days after you apply` : 'when you ask'}.`}</p>`}
    </section>` : ''}
    ${!['skipped', 'dismissed'].includes(j.status) ? `<section class="card" id="people">
      <header><h2>People at ${esc(j.company)}</h2>${writing_to ? '<span class="muted small"><span class="spin" data-kind="outreach"></span>Working on it: finding people and writing the note…</span>' : (contacts || []).length ? '<button class="btn ghost" data-act="findPeople">Find the recruiter on LinkedIn</button>' : ''}</header>
      <p class="muted small">A recruiter, the hiring manager or someone you know there. A short note to the right person often counts for more than a perfect CV. <a href="#" data-act="link" data-url="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(j.company + ' ' + (playbook?.kind === 'agency' ? 'recruiter' : j.title.split(/[,(-]/)[0]))}">Look on LinkedIn</a></p>
      ${overview?.can_fill !== false ? `<div class="qa team-get"><div class="row" style="justify-content:space-between;align-items:center"><span class="small"><b>The hiring team, from LinkedIn.</b> Many postings there list who posted the job and who it reports to. Open ${/linkedin\.com\/jobs/.test(j.url || '') ? 'the posting' : 'the job on LinkedIn'} signed in, click the Job Hunt extension and press <b>Send to Job Hunt</b>: the people it lists are added here, with a note to the first.</span>
        <button class="btn" data-act="link" data-url="${esc(/linkedin\.com\/jobs/.test(j.url || '') ? j.url : `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${j.title.split(/[,(]/)[0].trim()} ${j.company}`)}`)}">${svg('open')}${/linkedin\.com\/jobs/.test(j.url || '') ? 'Open the posting' : 'Find it on LinkedIn'}</button></div></div>` : ''}
      ${playbookHtml(playbook, contacts || [], j)}
      ${(know || []).filter(p => !(contacts || []).some(c => c.name === p.name)).map(p => `<div class="qa"><div class="row" style="justify-content:space-between"><span><span class="pill good">You know them</span> <b>${esc(p.name)}</b>${p.position ? ` · ${esc(p.position)}` : ''}${p.link ? ` · <a href="#" data-act="link" data-url="${esc(p.link)}">profile</a>` : ''}</span>
        <button class="btn primary" data-act="askReferral" data-person="${esc(JSON.stringify(p))}" ${writing_to ? 'disabled' : ''}>Ask ${esc(firstName(p.name))} for a referral</button></div></div>`).join('')}
      ${(contacts || []).map((c, i) => contactHtml(c, i, writing_to, playbook)).join('')}
      ${!(contacts || []).length && ['approved', 'applied', 'interviewing'].includes(j.status) ? `<div class="qa"><div class="row" style="justify-content:space-between;align-items:center">
        <span class="small">${recruiter ? `You know <b>${esc(recruiter.name)}</b>, a recruiter there.` : 'Job Hunt looks on LinkedIn for the recruiter who hires for this role (or the hiring manager) and writes a short note to them, to send from their profile.'}</span>
        <span class="row">${recruiter ? '' : `<button class="btn primary" data-act="findPeople" ${writing_to ? 'disabled' : ''}>Find the recruiter on LinkedIn</button>`}
        <button class="btn${recruiter ? ' primary' : ''}" data-act="noteRecruiter" data-name="${esc(recruiter?.name || '')}" data-email="${esc(recruiter?.email || '')}" ${writing_to ? 'disabled' : ''}>${recruiter ? `Write a note to ${esc(firstName(recruiter.name))}` : 'Write it without a name'}</button></span></div></div>` : ''}
      <div class="row contact-add"><input type="text" id="cName" placeholder="Name"><input type="text" id="cRole" placeholder="Role (e.g. hiring manager)"><input type="text" id="cEmail" placeholder="Email or LinkedIn link (optional)">
        <button class="btn" data-act="addContact">Add</button></div>
    </section>` : ''}    ${offer || advising || j.status === 'offer' ? `<section class="card prep">
      <header><h2>The offer</h2>${advising ? '<span class="muted small"><span class="spin" data-kind="offer"></span>Weighing it…</span>' : ''}</header>
      <textarea id="offerText" placeholder="Paste the offer: base salary, bonus, equity, benefits, vacation, start date…">${esc(offer?.offer || '')}</textarea>
      <div class="row"><button class="btn primary" data-act="offerAdvice" ${advising ? 'disabled' : ''}>${offer ? 'Weigh it again' : 'Weigh the offer'}</button>
        <span class="muted small">Compared with the posted range, your minimum and any other offers, with what to ask for and a counter-offer email.</span></div>
      ${offer?.advice ? mdHtml(offer.advice) : ''}
    </section>` : ''}
    </div>
    <div class="jpane" data-pane="chat" ${tab === 'chat' ? '' : 'hidden'}>
    <section class="card chat">
      <header><h2>Ask Claude about this job</h2>${(chat || []).length ? '<button class="btn ghost sm" data-act="chatClear">Start over</button>' : ''}</header>
      <p class="muted small">Claude knows this posting, your CV for it and your notes. Ask for an answer to a form question, a shorter cover letter, what to say about salary, or how to prepare.</p>
      <div class="chat-log">${(chat || []).map((m, i) => `<div class="chat-msg ${m.who === 'you' ? 'me' : 'them'}">${m.who === 'you' ? esc(m.text) : `<div id="chat${i}">${mdHtml(m.text)}</div><button class="btn ghost sm" data-act="copy" data-from="chat${i}">Copy</button>`}</div>`).join('')}
        ${chatting ? '<div class="chat-msg them"><span class="spin" data-kind="chat"></span>Writing…</div>' : ''}</div>
      <div class="chat-send"><textarea id="chatMsg" rows="2" placeholder="e.g. Write a 100-word answer to “Why do you want to work here?”" ${chatting ? 'disabled' : ''}></textarea>
        <button class="btn primary" data-act="chatSend" ${chatting ? 'disabled' : ''}>Send</button></div>
    </section>
    </div>
    <div class="jpane" data-pane="interview" ${tab === 'interview' ? '' : 'hidden'}>
    <section class="card prep">
      <header><h2>Interview prep</h2>${preparing ? '<span class="muted small"><span class="spin" data-kind="prep"></span>Writing…</span>' : `<button class="btn" data-act="prep">${prep ? 'Write again' : 'Write prep sheet'}</button>`}</header>
      ${prep ? mdHtml(prep) : `<p class="muted">${preparing ? 'Claude is writing likely questions, answers from your CV, gaps to prepare for and questions to ask. This page updates by itself.' : 'Likely questions with answers from your CV, what the company is up to now (from a quick web search), gaps to prepare for, and questions to ask them.'}</p>`}
      ${prep ? '<p class="muted small">Also saved as “Interview prep.md” with this application\'s files.</p>' : ''}
      <p class="muted small">The evening before an interview on your calendar, Job Hunt makes sure this sheet is ready and reminds you.</p>
      <p class="muted small">${claude_desktop ? `Practise out loud: in the Claude app, ask <b>“Practise my interview for ${esc(j.company)}”</b>. Claude plays the interviewer and gives feedback on each answer.` : 'Want a mock interview with feedback? Add Job Hunt to the Claude app in <a href="#settings/app">Settings → App</a>.'}</p>
    </section>
    ${thanks || thanking || ['interviewing', 'offer'].includes(j.status) ? `<section class="card">
      <header><h2>Thank-you note</h2>${thanking ? '<span class="muted small"><span class="spin" data-kind="thanks"></span>Writing…</span>' : `<button class="btn" data-act="thanks">${thanks ? 'Write again' : 'Write it now'}</button>`}</header>
      ${thanks ? `<p class="small muted">${thanks.draft ? 'Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>' : 'Written'} ${esc(ago(thanks.at))}${thanks.to ? ` · to ${esc(thanks.to)}` : ' · add the interviewer\'s address before sending'}</p>
        <p><b>${esc(thanks.subject)}</b></p><div class="posting">${esc(thanks.body)}</div>
        <p class="muted small">Fill in the [bracketed] detail from your conversation, then send it the same day.</p>` : '<p class="muted">Job Hunt drafts one about an hour and a half after each interview on your calendar starts, so you can send it the same day.</p>'}
    </section>` : ''}
    </div>
    </div>`);
  main().dataset.job = id;
  main().dataset.status = j.status;
  changeList = j.cv_changes || [];
  document.querySelectorAll('#jobTabs [data-jtab]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    jobTabs[id] = a.dataset.jtab;
    document.querySelectorAll('#jobTabs [data-jtab]').forEach(x => x.classList.toggle('on', x === a));
    document.querySelectorAll('.jpane').forEach(p => { p.hidden = p.dataset.pane !== a.dataset.jtab; });
  }));
  document.querySelectorAll('#pvTabs [data-pv]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#pvTabs [data-pv]').forEach(x => x.classList.toggle('on', x === b));
    ['cv', 'letter'].forEach(k => { const el = $(`#pv-${k}`); if (el) el.hidden = k !== b.dataset.pv; });
  }));
  if (j.cv_path && !(own?.cv && /\.pdf$/i.test(j.cv_path))) api(`/api/jobs/${encodeURIComponent(id)}/preview`).then(({ cv }) => {
    const el = $('#pv-cv'); if (el) el.innerHTML = cv ? cvHtml(cv) : own?.cv ? '<p class="muted">Your own CV is a PDF: use <b>Open tailored CV</b> to see it.</p>' : '<p class="muted">The tailored CV file is missing. Re-tailor to make a new one.</p>';
    if (revision?.what === 'cv') markRevision(revision);
  }).catch(e => { const el = $('#pv-cv'); if (el) el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
  // Just changed the letter: show it, with the changed paragraphs marked.
  if (revision?.what === 'letter') { document.querySelector('#pvTabs [data-pv=letter]')?.click(); markRevision(revision); }
  main().dataset.contacts = JSON.stringify(contacts || []);
  // Opened for one part of the page (Write a note → People at the company): go there.
  if (scrollToAfter) { const at = document.getElementById(scrollToAfter); scrollToAfter = ''; if (at) setTimeout(() => at.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  loadKit();
  if (tailoring || preparing || revising || following_up || answering || advising || writing_to || thanking || chatting) jobPoll = setTimeout(() => { if (location.hash === `#job/${encodeURIComponent(id)}`) { refreshOverview().then(route); } }, 4000);
}

/** The copy-and-paste kit on a job's Apply tab: each detail with its own Copy button. */
async function loadKit() {
  const box = $('#kitBody');
  if (!box) return;
  let k;
  try { k = await api(`/api/jobs/${encodeURIComponent(box.dataset.job)}/kit`); } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
  let n = 0;
  // A row: its label, the value (long ones folded), and Copy.
  const row = (label, value, long) => {
    if (!value || !String(value).trim()) return '';
    const id = 'kit' + n++;
    return `<div class="kit-row"><span class="kit-l">${esc(label)}</span><span class="kit-v${long ? ' long' : ''}" id="${id}">${esc(value)}</span><button class="btn ghost sm" data-act="copy" data-from="${id}">Copy</button></div>`;
  };
  const entry = (e, i, what) => {
    const parts = (e.parts || []).length > 1 ? e.parts.map((p, j) => row(j === 0 ? `${what} ${i + 1}` : '', p)).join('') : row(`${what} ${i + 1}`, e.heading);
    return `<div class="kit-entry">${parts}${row('From', e.from_mm || e.from)}${e.from && e.from_mm && e.from !== e.from_mm ? row('From (as on CV)', e.from) : ''}${row('To', e.to_mm || e.to)}${/present|current|now|date|ongoing/i.test(e.to || '') ? row('Current', 'Yes, I currently work here') : ''}${row('Description', e.description, true)}</div>`;
  };
  const group = (title, inner) => inner.trim() ? `<h3 class="kit-h">${title}</h3>${inner}` : '';
  box.innerHTML = `<div class="kit">
    ${group('You', k.contact.map(c => row(c.label, c.value)).join(''))}
    ${group('Your facts for forms', (k.facts || []).map(f => row(f.label || 'Fact', f.value)).join(''))}
    ${group('Work experience', (k.jobs || []).map((e, i) => entry(e, i, 'Job')).join(''))}
    ${group('Education', (k.schools || []).map((e, i) => entry(e, i, 'School')).join(''))}
    ${group('Skills', (k.skills ? k.skills.split(/\s*[;,|•·\n]\s*/).map(x => x.replace(/^[-–*\s]+|[.\s]+$/g, '')).filter(x => x && x.length < 60) : []).map(x => row('Skill', x)).join('') + row('All of them', k.skills, true))}
    ${group('Languages', (k.languages || []).map(l => row('Language', l)).join(''))}
    ${group('Answers written for this application', (k.answers || []).map(a => row(a.question, a.answer, true)).join(''))}
    ${group('Cover letter', row('Letter', k.letter, true))}
    ${group('Whole CV as text', row('CV', k.cv, true))}
    <p class="muted small">From the CV this application uses${(k.jobs || []).length ? '' : ' (Job Hunt found no dated jobs in it: copy from the whole CV below)'} and your <a href="#cvs/details">facts for forms</a>. Edit those to change what's here.</p></div>`;
}

// ---- Inbox ----
// ---- What to do next ----
/** One list of what's waiting on you, most urgent first, with the action right on each row. */
/** "Why it fits" for a role to pick: Claude's reasons, folded to two lines, and its red flags. */
const whyFits = j => {
  const flags = j.red_flags || [];
  if (!j.reasoning && !flags.length) return '<span class="muted">–</span>';
  return `<details class="why-fits"><summary><span class="why-text">${esc(j.reasoning || '')}</span>${flags.length ? `<span class="bad-text">${flags.length} red flag${flags.length === 1 ? '' : 's'}</span>` : ''}</summary>
    ${flags.length ? `<ul class="flags">${flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</details>`;
};
/** The posting's hard requirements the CV doesn't show (red flags Claude marks "Must have:"): a stretch to apply for. */
const mustHaves = j => (j.red_flags || []).filter(f => /^must have:/i.test(f)).map(f => f.replace(/^must have:\s*/i, ''));
const stretchTag = j => { const m = mustHaves(j); return m.length ? ` <span class="pill warn" title="Required, and not on your CV: ${esc(m.join('; '))}">Stretch</span>` : ''; };
/** The one tag a row in a list shows, the most important first: closed, closing soon, a stretch,
 *  someone you know there. The rest are on the job itself. */
function oneTag(j) {
  const closed = closedTag(j); if (closed) return ` ${closed}`;
  const low = belowMinTag(j); if (low) return low;
  const dl = deadlineTag(j); if (dl && /crit|bad|warn/.test(dl)) return ` ${dl}`;
  const st = stretchTag(j); if (st) return st;
  if (j.recruiter) return ` <span class="pill good" title="You know ${esc(j.recruiter)}, a recruiter there">Recruiter: ${esc(firstName(j.recruiter))}</span>`;
  if (j.know?.length) return ` <span class="pill good" title="Connected on LinkedIn: ${esc(j.know.join(', '))}">You know ${esc(j.know.length === 1 ? firstName(j.know[0]) : `${j.know.length} people`)}</span>`;
  return dl ? ` ${dl}` : '';
}
/** You closed the Apply window without the site's confirmation being recognised: did it go through? */
window.askApplied = async j => {
  if (await ask(`Did your application to ${j.title} at ${j.company} go through?`, 'Yes, mark it applied')) {
    try { await api(`/api/jobs/${encodeURIComponent(j.id)}/submitted`, { method: 'POST' }); toast('Marked as applied. Job Hunt reminds you to follow up if there\'s no reply.'); await refreshOverview(); route(); }
    catch (e) { toast(e.message, true); }
  }
};
/** After Approve: open the job's form in your own browser (your sign-ins and saved passwords work
 *  there), where the Job Hunt extension fills it in; false when that can't be done here (the phone,
 *  no link), and the Apply page takes over. */
/** Applying to several in your browser, one after another: the list ({id, name}), where we are, and how many went. */
let applyRun = null;
/** The bar that carries a run: which application is open, and what to do when it's sent. */
function runBar() {
  let bar = $('#applyRun');
  if (!applyRun) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'applyRun'; bar.className = 'apply-run'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
  const cur = applyRun.list[applyRun.at];
  bar.innerHTML = `<span class="grow"><b>Applying in your browser · ${applyRun.at + 1} of ${applyRun.list.length}</b><span class="muted small">${esc(cur.name)}. On the form, click the Job Hunt extension, then Fill this form.</span></span>
    <button class="btn primary sm" data-act="runApplied">I submitted it: next</button><button class="btn sm" data-act="runSkip">Skip</button><button class="btn ghost sm" data-act="runAgain" title="Open this one's form again">Open again</button><button class="btn ghost sm" data-act="runStop">Stop</button>`;
}
/** Open the run's current application in your browser, or finish. */
async function runOpen() {
  if (!applyRun) return;
  if (applyRun.at >= applyRun.list.length) {
    const n = applyRun.done;
    applyRun = null; runBar();
    return toast(n ? `Done: ${n} marked as applied. Job Hunt reminds you to follow up if there's no reply.` : 'Done. None were marked as applied.');
  }
  runBar();
  const cur = applyRun.list[applyRun.at];
  try {
    const r = await api(`/api/jobs/${encodeURIComponent(cur.id)}/fill-browser`, { method: 'POST' });
    await api('/api/open-url', { method: 'POST', body: { url: r.url } });
  } catch (e) { toast(`${cur.name}: ${e.message} Skip it, or press Open again.`, true); }
}
async function applyNow(id) {
  if (!overview?.can_fill) return false;
  try {
    const r = await api(`/api/jobs/${encodeURIComponent(id)}/fill-browser`, { method: 'POST' });
    await api('/api/open-url', { method: 'POST', body: { url: r.url } });
    toast('Approved. It\'s opening in your browser: on the form, click the Job Hunt extension and press Fill this form.');
    return true;
  } catch (e) { return false; }
}
/** A salary below your minimum (Search → What to search), as a tag. */
const minSalary = () => overview?.min_salary ?? settingsCache?.profile?.min_salary ?? null;
const money = n => '$' + Math.round(n).toLocaleString();
/** The top of a role's pay, against your minimum: a range that reaches it is fine, and a starting
 *  point alone ("From $90,000", "$90,000+") isn't the most it pays. */
const openEnded = s => /\b(from|starting|starts? at|minimum|at least|and up|or more)\b|\d\s*[kK]?\s*\+/i.test(s) && (String(s).match(/\d[\d,]*(?:\.\d+)?\s*[kK]?/g) || []).length < 2;
const belowMin = j => { const m = minSalary(); if (!m || !j.salary || openEnded(j.salary)) return null; const top = salaryValue(j.salary); return top > 1000 && top < m ? top : null; };
const belowMinTag = j => belowMin(j) ? ` <span class="pill crit" title="Pays up to ${money(belowMin(j))}, below your minimum of ${money(minSalary())}">Below your minimum</span>` : '';
/** How you'd apply, and how long it takes: email, a quick form, an account to make first… */
const EFFORT_CLS = { email: 'good', quick: 'good', account: 'warn', board: 'warn', site: '' };
const effortTag = j => j.effort && ['ready', 'approved'].includes(j.status) ? ` <span class="pill effort ${EFFORT_CLS[j.effort.kind] || ''}" title="${esc(j.effort.about || 'How you apply to this one')}">${esc(j.effort.label)}</span>` : '';
/** Where Apply goes, for a posting found on a job board: the company's own site, once Job Hunt finds it there. */
const onCompanySite = j => j.apply_url ? `<span class="good-text" title="${esc(j.apply_url)}">applies on ${esc(j.company)}'s own site</span>` : '';

/** Reaching out to recruiters (see core/src/playbook.rs): the advice for this kind of employer, and a
 *  word if you've already messaged someone at the company. */
const PLAYBOOK_LABEL = { private: 'Private employer', agency: 'Staffing agency', federal: 'Government of Canada', public: 'Provincial or municipal government' };
function playbookHtml(pb, contacts, j) {
  if (!pb) return '';
  // Anyone messaged at the company (for this job or another), when there's someone else you might write to.
  const messaged = pb.messaged || [];
  const warn = messaged.length && (contacts.some(c => !c.sent_at) || messaged.some(m => m.job !== j.id));
  const names = [...new Set(messaged.map(m => m.name))];
  return `<div class="playbook ${esc(pb.kind)}"><b>${esc(PLAYBOOK_LABEL[pb.kind] || '')}.</b> ${esc(pb.advice)}
    ${warn ? `<p class="small"><b>You've messaged ${esc(names.join(', '))} at ${esc(j.company)}</b> (${esc(ago(messaged.map(m => m.at).sort().pop()))}). One recruiter at a company at a time: wait for a reply before writing to someone else there.</p>` : ''}
    <details class="small"><summary class="muted">How to reach out</summary><ul>
      <li>One short message: the role and its job ID, one concrete line on your strongest proof for what they need, your availability, and an offer of a quick call.</li>
      <li>Don't ask “what's the status?”, paste your CV into the message, or send attachments unless they ask.</li>
      <li>No reply? One follow-up ${pb.follow_up_after} to ${pb.follow_up_by} days later, then stop. Never more than twice.</li>
      <li>Don't message several recruiters at the same company at once.</li></ul></details></div>`;
}
/** One person at the company, and where your messages to them stand: write, send, follow up once, done. */
function contactHtml(c, i, writing, pb) {
  const day = t => fmtDate(t);
  const sent = c.sent_at && new Date(c.sent_at), followed = c.followed_at && new Date(c.followed_at);
  const due = sent && !followed && Date.now() - sent >= (pb?.follow_up_after || 7) * 86400000;
  const writtenNow = c.message && (followed ? false : sent ? c.message_kind === 'follow-up' : true);
  let state = '', acts = '';
  if (followed) state = `Messaged ${esc(day(c.sent_at))}, followed up ${esc(day(c.followed_at))}. That's it: no more messages to ${esc(firstName(c.name))}.`;
  else if (sent && !due) state = `Sent ${esc(day(c.sent_at))}. No reply by ${esc(day(new Date(+sent + (pb?.follow_up_after || 7) * 86400000).toISOString()))}? Follow up once then.`;
  else if (due) state = `Sent ${esc(day(c.sent_at))}, no reply yet: time for the one follow-up.`;
  if (!followed) {
    if (writtenNow) acts += `<button class="btn primary" data-act="contactSent" data-i="${i}" title="Mark it sent, so Job Hunt knows when to follow up">I sent it</button>`;
    if (!sent || due) acts += `<button class="btn${writtenNow ? ' ghost' : ''}" data-act="outreach" data-i="${i}" ${writing ? 'disabled' : ''}>${writtenNow ? 'Write again' : due ? 'Write the follow-up' : 'Write a message'}</button>`;
  }
  acts += `<button class="btn ghost" data-act="removeContact" data-i="${i}">Remove</button>`;
  return `<div class="qa"><div class="row" style="justify-content:space-between"><span><b>${esc(c.name)}</b>${c.role ? ` · ${esc(c.role)}` : ''}${c.email ? ` · ${esc(c.email)}` : ''}${c.link ? ` · <a href="#" data-act="link" data-url="${esc(c.link)}">profile</a>` : ''}
      ${state ? `<br><span class="small ${due ? '' : 'muted'}">${state}</span>` : ''}</span>
    <span class="row">${acts}</span></div>
    ${c.message && !followed ? `<div class="posting" id="msg${i}">${esc(c.message)}</div><div class="row">${c.link && !c.email ? `<button class="btn" data-act="copyOpen" data-from="msg${i}" data-url="${esc(c.link)}" title="Copies the note and opens their profile: press Connect, Add a note, paste, Send">${svg('open')}Copy it and open their profile</button>` : ''}<button class="btn ghost" data-act="copy" data-from="msg${i}">Copy</button>${c.link && !c.email ? `<span class="muted small">${c.message.length} characters. A connection note takes 300 (200 on a free account, where LinkedIn also limits how many you can send a month).</span>` : ''}</div>` : ''}</div>`;
}

/** One step of the job hunt on the Overview: its roles, each with the next thing to do. `tracked`
 *  (the Tracker's rows) fills in the steps after you apply. */
/** A company's initial on a tile whose colour comes from its name: the same company, the same colour. */
const avatar = name => { const s = String(name || '?').trim(); let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `<span class="avatar" style="--h:${h}" title="${esc(s)}" aria-hidden="true">${esc((s.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase())}</span>`; };
/** What a posting pays, for a job's line of facts: the figure it states (its full wording on hover,
 *  and a mark when it's below your minimum), or that it states none. Always there, so no pay is
 *  something you see, not something missing. */
const payFact = j => j.salary
  ? `<span class="pay${belowMin(j) ? ' low' : ''}" title="${esc(j.salary)}${belowMin(j) ? `. Below your minimum of ${money(minSalary())}` : ''}">${esc(String(j.salary).split(/\s+[•·|]\s+/)[0])}</span>`
  : '<span class="pay none" title="The posting doesn\'t say what it pays">No pay stated</span>';
/** Under this share of a posting's keywords, a tailored CV is thin for it. */
const THIN_COVER = 0.6;
/** How much of a posting's keywords the tailored CV covers, as a fact for its row: marked when thin. */
const coverFact = j => j.coverage_after == null ? '' : j.coverage_after < THIN_COVER
  ? `<span class="warn-text" title="Under ${pct(THIN_COVER)}: screening software may rank it low. Open it to add the keywords you do have.">only ${pct(j.coverage_after)} of the posting's keywords</span>`
  : `${pct(j.coverage_after)} of the posting's keywords`;
/** For a thin CV: the posting's keywords it lacks, to tick the ones you really have. Job Hunt left
 *  them out because nothing in your CV backs them; ticking one is you saying it's true. */
const gapsHtml = j => j.coverage_after != null && j.coverage_after < THIN_COVER && (j.keyword_gaps || []).length ? `<div class="advice warn gaps" data-gaps="${esc(j.id)}">
    <b>This CV covers ${pct(j.coverage_after)} of the posting's keywords.</b>
    <p class="small">Job Hunt left these out because nothing in your CV backs them. Tick the ones you really have and it works them in; leave the rest.</p>
    <div class="gap-list">${j.keyword_gaps.slice(0, 14).map(k => `<label class="check small"><input type="checkbox" value="${esc(k)}"> ${esc(k)}</label>`).join('')}</div>
    <div class="row"><button class="btn sm" type="button" data-act="gapsAdd" data-job="${esc(j.id)}">Work in the ticked ones</button></div></div>` : '';
/** How good a match is to apply to now, for ordering: its fit, less for each day the posting has
 *  been up after the first two (a role's first days are when applications get read), less for red
 *  flags and pay below your minimum, a little more when it applies on the company's own site or
 *  says what it pays. An expired posting goes to the bottom. */
function applyRank(j) {
  const days = Math.max(0, (Date.now() - (+new Date(ageValue(j) || 0) || Date.now())) / 86400000);
  let n = (j.score ?? 0) - Math.min(30, Math.max(0, days - 2) * 1.5) - Math.min(12, (j.red_flags || []).length * 4);
  if (belowMin(j)) n -= 10;
  if (j.apply_url) n += 3;
  if (salaryValue(j.salary) > 0) n += 2;
  if (expiredWhy(j)) n -= 60;
  return Math.round(n * 10) / 10;
}
/** Days a posting has been up (or since Job Hunt found it). */
const daysUp = j => Math.max(0, (Date.now() - (+new Date(ageValue(j) || 0) || Date.now())) / 86400000);
/** One job in a step's list. The tick box, fit and name are one label when the row can be ticked
 *  (a press anywhere on them ticks it); the why line and the buttons are outside it. */
function jobRow(j, { tick = '', sub = '', actions = '', tags = '', cls = '', attrs = '', facts = '' }) {
  const meta = [coCell(j), j.location ? placeHtml(j) : '', payFact(j), j.employment ? esc(j.employment) : '', facts].filter(Boolean).join('<i class="sep">·</i>');
  const head = `${tick ? `<span class="jtick">${tick}</span>` : ''}${avatar(j.company)}<span class="jfit${j.score != null && j.score_after != null && j.score_after !== j.score ? ' has-after' : canReach(j) ? ' has-fore' : ''}">${scoreBadge(j.score)}${reachTag(j)}${fitNote(j)}</span>
      <span class="jmain"><span class="jtitle"><a class="qt" href="#job/${encodeURIComponent(j.id)}">${esc(j.title)}</a>${tags}</span><span class="jmeta">${meta}</span></span>`;
  return `<div class="jrow${cls ? ` ${cls}` : ''}${tick ? ' ticks' : ''}${expiredWhy(j) ? ' expired-row' : ''}" data-job-row="${esc(j.id)}" ${attrs} data-qnow="${applyRank(j)}" data-qfit="${j.score_after ?? j.score ?? 0}" data-qnew="${+new Date(ageValue(j) || 0) || 0}" data-qpay="${Math.max(0, salaryValue(j.salary))}" data-qhaspay="${j.salary ? 1 : 0}" data-qflags="${(j.red_flags || []).length}">${tick ? `<label class="jhead">${head}</label>` : `<div class="jhead">${head}</div>`}
      <span class="row jact">${actions}</span>${sub ? `<div class="jwhy small">${sub}</div>` : ''}</div>`;
}

function stepHtml(o, step, tracked) {
  jobOrder = [...(o.ready || []), ...(o.approved || []), ...(o.follow_ups || [])].map(j => j.id);
  const row = (j, sub, actions, tick = '') => jobRow(j, { tick, sub: sub ? `<span class="muted">${sub}</span>` : '', actions, tags: `${oneTag(j)}${effortTag(j)}${appliedBeforeTag(j)}` });
  const id = j => esc(j.id);
  const groups = [];
  const soon = (o.interviews || []).filter(i => new Date(i.start) - Date.now() < 3 * 86400000);
  if (soon.length) groups.push(['Interviews in the next few days', soon.map(i => `<div class="jrow"><div class="jhead"><span class="jfit"><span class="pill interviewing">${esc(fmtWhen(i.start))}</span></span>
      <span class="jmain"><span class="jtitle"><span class="qt">${esc(i.company || i.title)}</span></span>${i.job_title ? `<span class="jmeta">${esc(i.job_title)}</span>` : ''}</span></div>
      ${i.job_id ? `<span class="row jact"><a class="btn sm" href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prepare</a></span>` : ''}</div>`).join('')]);
  const picking = (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`));
  const inWork = (o.to_tailor || []).length - picking.length;
  if (picking.length) {
    // One list, best fit first; the filters reorder and hide rows in place (see applyPickView).
    const places = [...new Set((o.places || []).map(p => String(p).split(',')[0].trim()).filter(Boolean))];
    const opt = (v, n) => `<option value="${v}">${n}</option>`;
    const rows = [...picking].sort((a, b) => applyRank(b) - applyRank(a)).map(j => jobRow(j, {
      cls: 'pick', tick: `<input type="checkbox" data-pick="${esc(j.id)}" aria-label="Pick ${esc(j.title)}">`, tags: `${oneTag(j)}${appliedBeforeTag(j)}`, facts: ageTag(j), sub: whyFits(j),
      attrs: `data-expired="${expiredWhy(j) ? 1 : 0}" data-now="${applyRank(j)}" data-score="${j.score ?? 0}" data-reach="${j.score_after ?? canReach(j) ?? j.score ?? 0}" data-age="${+new Date(ageValue(j) || 0) || 0}" data-pay="${Math.max(0, salaryValue(j.salary))}" data-rating="${j.rating?.found ? j.rating.rating : 0}" data-flags="${(j.red_flags || []).length}" data-place="${esc(`${j.location || ''}${j.remote ? ' remote' : ''}`.toLowerCase())}"`,
      actions: `${j.score == null ? `<button class="btn sm" type="button" data-act="scoreAnyway" data-job="${id(j)}">Score it</button>` : ''}<a class="btn sm" href="#job/${encodeURIComponent(j.id)}" data-tab-to="overview">View</a><button class="btn ghost sm icon-only" type="button" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="queued" title="Not interested">${svg('close')}</button>` })).join('');
    groups.push([`Pick from <span data-pickhead>${picking.length} new match${picking.length === 1 ? '' : 'es'}</span>`, `<div data-pickbox>
    <div class="row" style="margin:2px 0 8px">${picking.length > 5 ? '<button class="btn sm" type="button" data-act="pickTop" data-n="5">Tick the top 5</button>' : ''}<button class="btn ghost sm" type="button" data-act="pickAll">Select all</button>${(() => { const old = picking.filter(j => daysUp(j) > 21 || expiredWhy(j)); return old.length ? `<button class="btn ghost sm" type="button" data-act="pickStale" data-ids="${esc(JSON.stringify(old.map(j => j.id)))}" title="Postings up for more than three weeks, or expired: an application now is rarely read. It doesn't change how Job Hunt scores.">Set aside ${old.length} older than 3 weeks</button>` : ''; })()}${inWork ? `<span class="muted small"><span class="spin" data-kind="tailor+score" data-n="${Math.ceil(inWork / 3)}"></span>Tailoring ${inWork}…</span>` : ''}</div>
    ${foldFilters(`<div class="pick-filters">
      <label class="small">Sort by <select data-pickf="sort">${opt('now', 'Best to apply to now')}${opt('fit', 'Best fit')}${opt('reach', 'Fit after tailoring')}${opt('new', 'Newest')}${opt('pay', 'Highest pay')}${opt('rating', 'Best-rated company')}</select></label>
      <label class="small">Fit <select data-pickf="min">${opt('0', 'Any')}${opt('60', '60 or more')}${opt('70', '70 or more')}${opt('80', '80 or more')}${opt('-60', 'Under 60')}${opt('-70', 'Under 70')}</select></label>
      <label class="small">Found <select data-pickf="age">${opt('', 'Any time')}${opt('3', 'Last 3 days')}${opt('7', 'Last 7 days')}${opt('-14', 'Over 2 weeks ago')}</select></label>
      ${places.length > 1 || o.remote_ok ? `<label class="small">Where <select data-pickf="place">${opt('', 'Anywhere')}${places.map(p => opt(esc(p.toLowerCase()), esc(p))).join('')}${opt('remote', 'Remote')}</select></label>` : ''}
      <label class="check small"><input type="checkbox" data-pickf="pay"> Shows pay</label>
      <label class="check small"><input type="checkbox" data-pickf="flags"> No red flags</label>
      <label class="check small" title="The ten best to apply to now, by the order you chose. The rest wait."><input type="checkbox" data-pickf="top"> Best 10 only</label>
      <span class="muted small" data-pickcount></span>
    </div>`, picking.length < 8)}
    <p class="muted small pick-keys desktop-only" ${picking.length < 8 ? 'hidden' : ''}><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Space</kbd> tick · <kbd>Enter</kbd> open · <kbd>X</kbd> not interested · <kbd>T</kbd> tailor the ticked ones</p>
    <div class="pick-list">${rows}</div>
    <p class="muted small pick-more" data-pickmore hidden></p>
    <div class="select-bar" hidden><span class="select-n"></span><button class="btn primary" data-act="tailorPicked">Tailor selected</button><button class="btn" data-act="dismissPicked">${svg('close')}Not interested</button><button class="btn ghost" data-act="pickClear">Clear</button></div>
</div>`]);
  }
  else if (inWork) groups.push(['Tailoring', `<p class="muted"><span class="spin" data-kind="tailor+score" data-n="${Math.ceil(inWork / 3)}"></span>Tailoring ${inWork} application${inWork === 1 ? '' : 's'}… they appear under Ready to approve.</p>`]);
  const ready = [];
  const many = o.ready?.length > 1;
  if (o.ready?.length) ready.push([`Ready to approve${many ? '' : ` <a class="btn sm" href="#review">Review it</a>`}`, `<div data-approvebox>
    ${many ? `<div class="row" style="margin:2px 0 8px"><button class="btn ghost sm" type="button" data-act="approveAll">Select all</button><a class="btn primary sm" href="#review" title="Each one's changes and letter on one page: A approves and shows the next">Review them one by one</a></div>` : ''}
    ${[...o.ready].sort((a, b) => applyRank(b) - applyRank(a)).map(j => row(j, [coverFact(j), j.apply_email ? 'applies by email' : '', onCompanySite(j)].filter(Boolean).join(' · '),
    `<a class="btn sm" href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs">Check and approve</a>
     <button class="btn ghost sm icon-only" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="ready" title="Not interested">${svg('close')}</button>`,
    o.ready.length > 1 ? `<input type="checkbox" data-appr="${id(j)}" data-email="${esc(j.apply_email || '')}" aria-label="Select ${esc(j.company)}">` : '')).join('')}
    ${many ? `<div class="select-bar" hidden><span class="select-n"></span><button class="btn primary" data-act="approvePicked">Approve selected</button><button class="btn ghost" data-act="approveClear">Clear</button></div>` : ''}</div>`]);
  if (o.recruiter_asks?.length) groups.push(['Ask your recruiters to put you forward', o.recruiter_asks.map(j => row(j, `you know ${esc(j.recruiter)} there`,
    `<button class="btn sm" data-act="askRecruiter" data-job="${id(j)}" data-name="${esc(firstName(j.recruiter))}">Ask ${esc(firstName(j.recruiter))}</button>`)).join('')]);
  // Forms Job Hunt filled in that aren't marked applied: most went through, so ask.
  const unconfirmed = o.filled_unconfirmed || [];
  if (unconfirmed.length) groups.push([`Filled in by Job Hunt: did these go through?${unconfirmed.length > 1 ? ` <button class="btn primary sm" data-act="appliedAll" data-ids="${esc(JSON.stringify(unconfirmed.map(j => j.id)))}" style="margin-left:8px">All went through</button>` : ''}`,
    unconfirmed.map(j => row(j, 'Job Hunt filled in the form; it isn\'t marked applied yet',
      `<button class="btn primary sm" data-act="stage" data-status="applied" data-job="${id(j)}" data-from="approved">Yes, applied</button>
       <a class="btn ghost sm" href="#apply/${encodeURIComponent(j.id)}" title="Not submitted yet: open it again">Not yet</a>`)).join('')]);
  // Quickest first: one-click emails and short forms, then the ones that need an account.
  const toSubmit = [...(o.approved || [])].filter(j => !unconfirmed.some(u => u.id === j.id)).sort((a, b) => (a.effort?.minutes ?? 10) - (b.effort?.minutes ?? 10));
  const formable = toSubmit.filter(j => j.url && j.effort?.kind !== 'email');
  const runIds = list => esc(JSON.stringify(list.map(j => ({ id: j.id, name: `${j.company}: ${j.title}` }))));
  const quick = formable.filter(j => (j.effort?.minutes ?? 10) <= 5);
  if (toSubmit.length) groups.push([`Submit on the company's site${formable.length > 1 && o.can_fill ? ` ${quick.length > 1 && quick.length < formable.length ? `<button class="btn primary sm" data-act="applyAll" data-ids="${runIds(quick)}" style="margin-left:8px" title="The short forms, a few minutes each: each opens in your browser, the extension fills it, you press Submit, then the next">Apply to the ${quick.length} quick ones</button>` : ''}<button class="btn ${quick.length > 1 && quick.length < formable.length ? '' : 'primary '}sm" data-act="applyAll" data-ids="${runIds(formable)}" style="margin-left:8px" title="Each opens in your browser, quickest first; the extension fills it, you check it and press Submit, then the next one opens">Apply to all ${formable.length}</button>` : ''}`, toSubmit.map(j => row(j, onCompanySite(j),
    `<a class="btn sm" href="#apply/${encodeURIComponent(j.id)}">Apply</a>
     <button class="btn ghost sm" data-act="stage" data-status="applied" data-job="${id(j)}" data-from="approved" title="Already submitted it">Mark applied</button>
     <button class="btn ghost sm icon-only" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="approved" title="Not interested after all (the pay, say)">${svg('close')}</button>`)).join('')]);
  if (o.quiet?.length) groups.push([`Quiet for 4+ weeks <button class="btn sm" data-act="closeQuiet" data-ids="${esc(JSON.stringify(o.quiet.map(j => j.id)))}" style="margin-left:8px">Close ${o.quiet.length === 1 ? 'it' : `all ${o.quiet.length}`} as No response</button>`,
    o.quiet.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}, no reply`,
      `<button class="btn sm" data-act="stage" data-status="no_response" data-job="${id(j)}" data-from="applied">No response</button>`)).join('')]);
  if (o.reach_out?.length) groups.push(['Just applied: message the recruiter', o.reach_out.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}. A short note within 1 to 3 days helps`,
    `<a class="btn sm" href="#job/${encodeURIComponent(j.id)}" data-tab-to="apply" data-scroll="people">Write a note</a>`)).join('')]);
  if (o.contact_follow_ups?.length) groups.push(['No reply from the recruiter: follow up once', o.contact_follow_ups.slice(0, 6).map(f => row(f.job, `messaged ${esc(f.name)} ${esc(ago(f.sent_at))}${f.late ? '. Follow up now or let it go' : ''}`,
    `<a class="btn sm" href="#job/${encodeURIComponent(f.job.id)}" data-tab-to="apply">Write the follow-up</a>`)).join('')]);
  if (o.follow_ups?.length) groups.push([`No reply yet: follow up${o.follow_ups.length > 1 ? ` <button class="btn primary sm" data-act="followUpAll" data-ids="${esc(JSON.stringify(o.follow_ups.slice(0, 6).map(j => j.id)))}" style="margin-left:8px" title="Job Hunt writes a short follow-up for each; they're saved as Gmail drafts (or on each job) for you to read and send">Write all ${Math.min(6, o.follow_ups.length)}</button>` : ''}`, o.follow_ups.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}`,
    `<button class="btn sm" data-act="followUp" data-job="${id(j)}">Write follow-up</button>`)).join('')]);
  // Each step's groups; the ones above were made for all of them.
  const has = h => groups.find(g => String(g[0]).startsWith(h));
  const listed = new Set([...(o.follow_ups || []), ...(o.reach_out || []), ...(o.contact_follow_ups || []).map(f => f.job), ...(o.quiet || []), ...(o.approved || [])].map(j => j.id));
  const rest = (title, keep) => {
    const rows = tracked.filter(r => keep(r) && !listed.has(r.id));
    return rows.length ? [[title, rows.map(trackRow).join('')]] : [];
  };
  const by = {
    pick: [has('Pick'), has('Tailoring')].filter(Boolean),
    approve: ready,
    submit: [has('Filled in by Job Hunt'), has('Ask your recruiters'), has('Submit')].filter(Boolean),
    waiting: [has('Just applied'), has('No reply from the recruiter'), has('No reply yet'), has('Quiet'), ...rest('Everything else you applied to', r => r.status === 'applied')].filter(Boolean),
    interviews: [has('Interviews in the next'), ...rest('Interviewing and offers', r => ['interviewing', 'offer'].includes(r.status))].filter(Boolean),
  }[step];
  const empty = {
    pick: o.setup?.claude && o.setup?.cvs ? 'No new matches to pick from. New ones appear here after each search.' : 'Finish setting up above, then search for jobs.',
    approve: 'Nothing to approve. Tailor some roles in Pick, and they appear here.',
    submit: 'Nothing waiting to be submitted.',
    waiting: 'No applications waiting on a reply.',
    interviews: 'No interviews yet.',
  }[step];
  // The groups' headings name the step's parts; the step's own name is on its tab.
  const card = by.length ? by.map(([h, rows]) => `<section class="card todo step-${step}"><div class="todo-group">${h ? `<h2 class="group-h">${h}</h2>` : ''}${rows}</div></section>`).join('') : `<section class="card todo step-${step}"><p class="empty">${empty}</p></section>`;
  return card;
}

// ---- Two computers ----
function inUseHtml(u) {
  if (!u) return '';
  if (u.handed_to) return `<section class="card sync-banner"><header><h2>Job Hunt moved to ${esc(u.handed_to)}</h2></header>
    <p>${esc(u.handed_to)} took over, and your latest data was saved for it. Close Job Hunt here (on a server, just leave it): anything done here now wouldn't reach the other one. To switch back, use <b>Use it here again</b>.</p>
    <div class="row"><button class="btn" data-act="syncResume">Use it here again</button><span class="muted small">${esc(u.handed_to)} saves its latest data for this one and stops, if it's still open; then continue from it here.</span></div></section>`;
  if (u.waiting_for) return `<section class="card sync-banner"><header><h2><span class="spin" data-kind="wait" data-secs="120"></span>Waiting for ${esc(u.waiting_for)}</h2></header>
    <p>${esc(u.waiting_for)} is saving its latest data for this computer. That takes a minute or two, plus however long Google Drive takes to bring it here. Then you'll be offered to continue from it.</p></section>`;
  if (u.other) return `<section class="card sync-banner warn"><header><h2>Job Hunt is open on ${esc(u.other)}</h2></header>
    <p>Use one computer at a time: changes made on both can't be combined. Close Job Hunt there, or take over here: ${esc(u.other)} saves its latest data and stops, and this computer continues from it.</p>
    <div class="row"><button class="btn primary" data-act="takeOver">Take over here</button></div></section>`;
  return '';
}

// ---- Search progress ----
/** What the search is doing, in a line: "Scoring postings (12 of 40)". */
function stageLine(pr) {
  if (!pr) return '';
  const count = pr.scoring ? ` (${pr.done} of ${pr.total})` : pr.total ? ` (${Math.min(pr.done + 1, pr.total)} of ${pr.total})` : '';
  return `${pr.paused ? 'Paused: ' : ''}${pr.stage || 'Starting the search'}${count}${pr.also ? ` · ${pr.also}` : ''}`;
}
/** The running search at the top of the Overview: its progress, and a menu with what it's doing
 * now and Pause / Resume / Stop. Kept up to date in place by updateSearchCtl. */
function searchCtl(pr) {
  pr = pr || {};
  return `<details class="menu" id="searchCtl"><summary class="btn${pr.paused ? ' primary' : ''}" data-sv="summary" title="${esc(stageLine(pr))}">
      <span class="spin" data-sv="bar" data-p="${pr.percent ?? 0}"></span><span data-sv="label">${esc(ctlLabel(pr))}</span><span class="caret">▾</span></summary>
    <div class="menu-list right search-now">
      <b data-sv="stage">${esc(stageLine(pr))}</b>
      <span class="muted small" data-sv="detail">${esc(pr.detail || '')}</span>
      <span class="small" data-sv="counts">${searchCounts(pr)}</span>
      <div class="row">
        <button class="btn sm${pr.paused ? ' primary' : ''}" data-act="searchHold" data-sv="hold" data-on="${pr.paused ? '0' : '1'}">${pr.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn ghost danger sm" data-act="searchStop" title="Ends it after the step it's on; what it found or scored so far is kept">Stop</button>
      </div>
    </div></details>`;
}
const searchCounts = pr => pr.scoring ? `${pr.done ?? 0} of ${pr.total ?? 0} scored · ${pr.tailored ?? 0} tailored` : `${pr.found ?? 0} found · ${pr.new ?? 0} new · ${pr.scored ?? 0} scored · ${pr.tailored ?? 0} tailored`;
/** The search button's words: searching, or scoring what was waiting ("Scoring 40 of 379"). */
const ctlLabel = pr => pr.paused ? `Paused · ${pr.percent ?? 0}%` : pr.scoring ? `Scoring ${pr.done ?? 0} of ${pr.total ?? 0}` : `Searching · ${pr.percent ?? 0}%`;
/** Bring the search menu and the sidebar's line up to date without redrawing anything else. */
function updateSearchCtl() {
  const pr = overview?.progress;
  $('#runLine').title = pr ? `${stageLine(pr)}${pr.detail ? ` – ${pr.detail}` : ''}` : '';
  const box = $('#searchCtl');
  if (!box || !pr) return;
  const set = (k, v) => { const el = box.querySelector(`[data-sv="${k}"]`); if (el && el.textContent !== v) el.textContent = v; };
  set('label', ctlLabel(pr));
  set('stage', stageLine(pr));
  set('detail', pr.detail || '');
  set('counts', searchCounts(pr));
  box.querySelector('[data-sv="bar"]').dataset.p = pr.percent;
  const sum = box.querySelector('[data-sv="summary"]');
  sum.title = stageLine(pr);
  sum.classList.toggle('primary', !!pr.paused);
  const hold = box.querySelector('[data-sv="hold"]');
  if (hold.dataset.on !== (pr.paused ? '0' : '1')) {
    hold.dataset.on = pr.paused ? '0' : '1';
    hold.textContent = pr.paused ? 'Resume' : 'Pause';
    hold.classList.toggle('primary', !!pr.paused);
  }
}

function progressHtml(pr) {
  if (!pr) return '';
  const count = pr.total ? ` ${Math.min(pr.done + 1, pr.total)} of ${pr.total}` : '';
  return `<section class="card progress-card" id="progressCard">
    <header><h2>${pr.paused ? 'Paused: ' : ''}${esc(pr.stage || 'Starting the search')}${count}</h2><b class="pct">${pr.percent}%</b></header>
    <div class="pbar${pr.paused ? ' paused' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pr.percent}"><i style="width:${pr.percent}%"></i></div>
    <p class="muted small">${pr.paused ? 'Everything found so far is kept. Resume carries on from this step.' : esc(pr.detail || '')}${!pr.paused && pr.also ? `<br><b>Meanwhile:</b> ${esc(pr.also)}` : ''}</p>
    ${pr.paused ? `<div class="row"><button class="btn primary sm" data-act="searchHold" data-on="0">${pr.scoring ? 'Resume scoring' : 'Resume search'}</button><button class="btn ghost danger sm" data-act="searchStop">Stop</button></div>` : ''}
    <div class="facts small"><span><b>${pr.found}</b> postings found</span><span><b>${pr.new}</b> new</span><span><b>${pr.scored}</b> scored</span><span><b>${pr.tailored}</b> tailored</span></div>
  </section>`;
}
function reportHtml(r) {
  if (!r) return '';
  const probs = [...(r.source_problems || []), ...(r.errors || [])];
  const why = Object.entries(r.why_filtered || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
  // Few new postings: say why, and offer the ways to get more.
  const few = r.new < 25 || r.tailored === 0;
  const s = overview?.setup || {};
  const more = few ? `<details class="more" ${r.new === 0 ? 'open' : ''}><summary><b>Get more postings</b></summary><p><b>${r.new === 0 ? 'Nothing new this time.' : `Only ${r.new} new posting${r.new === 1 ? '' : 's'}.`}</b>
      ${r.known ? `${r.known} of the ${r.found} postings were already seen in earlier searches, so the boards you search have little that's new.` : ''}
      ${overview?.auto_boards ? 'Job Hunt is looking for more employers in your locations by itself and will search them when it finds some. To speed things up:' : 'More sources bring more postings:'}</p>
    <div class="row">
      <button class="btn primary" data-act="suggestBoards" data-into="moreIdeas">Find employers near me now</button>
      ${s.adzuna ? '' : '<a class="btn" href="#search/setup">Add Google for Jobs listings</a>'}
      <a class="btn desktop-only" href="#search/setup">Send to Job Hunt from LinkedIn</a>
      <button class="btn ghost" data-act="run" data-task="search-force" title="Looks again at postings set aside earlier, with your current settings">Search again, including set-aside postings</button>
    </div>
    <p class="muted small">Also set up daily job alerts on LinkedIn, Indeed or your country's job sites for your titles, sent to your Gmail: Job Hunt reads them on every email check. If many postings are set aside for their location or title, widen your locations or add titles in <a href="#cvs">Your CVs</a>.</p>
    <div id="moreIdeas" class="ideas"></div></details>` : '';
  const WHY_FIX = { 'outside your locations': 'Change your places', 'title doesn\'t match your CVs': 'Add job titles', 'a title word you skip': 'Change the words you skip', 'salary below your minimum': 'Change your minimum salary', 'a company you skip': 'Change the companies you skip', 'company rated below your minimum': 'Change the minimum rating' };
  const whyRows = Object.entries(r.why_filtered || {}).sort((a, b) => b[1] - a[1]);
  const aside = whyRows.length ? `<details class="more"><summary><b>Why ${r.filtered} ${r.filtered === 1 ? 'was' : 'were'} set aside before scoring</b></summary>
      <div class="why-rows">${whyRows.map(([k, n]) => `<div><b class="num">${n}</b><span class="grow">${esc(k)}</span>${WHY_FIX[k] ? `<a class="btn ghost sm" href="#search/what">${WHY_FIX[k]}</a>` : ''}</div>`).join('')}</div>
      <p class="muted small">They used no Claude. They're in <a href="#applications/all">Pipeline → All jobs</a> with the stage Skipped, each with its reason and Tailor anyway.</p></details>` : '';
  return `<section class="card"><header><h2>Last search</h2><a class="btn ghost" href="#applications/new">See the postings</a></header>
    <div class="facts"><span><b>${r.found}</b> postings found</span><span><b>${r.new}</b> new</span>${r.known ? `<span><b>${r.known}</b> seen before</span>` : ''}<span title="${esc(why)}"><b>${r.filtered}</b> set aside before scoring</span><span><b>${r.scored}</b> checked by Claude</span><span><b>${r.tailored}</b> tailored</span>${r.to_pick ? `<span><b>${r.to_pick}</b> to pick from</span>` : ''}${r.deferred ? `<span><b>${r.deferred}</b> left for next time</span>` : ''}${r.closed ? `<span><b>${r.closed}</b> closed</span>` : ''}</div>
    ${(r.by_source || []).length ? `<p class="small muted" style="margin:8px 0 0">From: ${r.by_source.map(x => `${esc(x.name)} <b>${x.found}</b>${x.failed ? ` <span class="bad-text">(${x.failed === x.searches ? 'failed' : `${x.failed} of ${x.searches} searches failed`})</span>` : ''}`).join(' · ')}</p>` : ''}
    ${probs.length ? `<details style="margin-top:8px"><summary class="small">${probs.length} problem${probs.length === 1 ? '' : 's'}</summary><ul class="flags">${probs.slice(0, 12).map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
    ${aside}
    ${more}
  </section>`;
}
/** Live updates while a search runs, without redrawing the page. */
setInterval(async () => {
  if (!overview?.progress) return;
  await refreshOverview();
  updateSearchCtl();
  const card = $('#progressCard');
  if (card && overview.progress) card.outerHTML = progressHtml(overview.progress);
  else if (card || !overview.progress) { if (location.hash === '' || location.hash.startsWith('#overview')) route(); }
}, 1500);

/** A little Markdown: ## headings, - bullets, **bold**. */
function mdHtml(text) {
  const out = []; let list = [];
  const flush = () => { if (list.length) out.push(`<ul>${list.map(i => `<li>${marked(i)}</li>`).join('')}</ul>`); list = []; };
  String(text || '').split('\n').forEach(l => {
    const t = l.trim();
    if (!t) { flush(); return; }
    const h = t.match(/^#{1,4}\s+(.*)$/), b = t.match(/^[-*•]\s+(.*)$/);
    if (h) { flush(); out.push(`<h3>${marked(h[1])}</h3>`); }
    else if (b) list.push(b[1]);
    else { flush(); out.push(`<p>${marked(t)}</p>`); }
  });
  flush();
  return out.join('');
}

// ---- A posting, opened in place in a list ----
async function togglePosting(tr) {
  const next = tr.nextElementSibling;
  if (next?.classList.contains('xrow')) { next.remove(); tr.classList.remove('open'); return; }
  const cols = tr.children.length;
  tr.classList.add('open');
  tr.insertAdjacentHTML('afterend', `<tr class="xrow"><td colspan="${cols}"><div class="xpand"><p class="muted"><span class="spin" data-kind="posting" data-secs="3"></span>Loading the posting…</p></div></td></tr>`);
  const box = tr.nextElementSibling.querySelector('.xpand');
  // As wide as the card shows, even when the table scrolls sideways.
  const card = tr.closest('.card');
  if (card) box.style.maxWidth = `${card.clientWidth - 40}px`;
  try {
    const { job: j } = await api(`/api/jobs/${encodeURIComponent(tr.dataset.expand)}`);
    const id = esc(j.id);
    box.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><b>${esc(j.title)}</b> ${closedTag(j)} · ${esc(j.company)}${j.location ? ` · ${placeHtml(j)}` : ''}${j.salary ? ` · ${esc(j.salary)}` : ''}
          <div class="muted small">${ageTag(j)} · found on ${esc(sourceName(j.source))}</div></div>
        <div class="row">
          ${j.url ? `<button class="btn" data-act="open" data-what="posting" data-job="${id}">${svg('open')}Open posting</button>` : ''}
          ${['skipped', 'saved', 'queued'].includes(j.status) && j.score == null ? `<button class="btn" data-act="scoreAnyway" data-job="${id}">Score it anyway</button>` : ''}
          ${CAN_CHOOSE.includes(j.status) ? `<button class="btn primary" data-act="tailorAnyway" data-job="${id}">Tailor anyway</button>` : ''}
          <a class="btn ghost" href="#job/${encodeURIComponent(j.id)}">Full details</a>
        </div>
      </div>
      ${j.reasoning ? `<p class="small" style="margin:10px 0 0"><b>${j.score != null ? `Fit ${j.score}:` : 'Why skipped:'}</b> ${esc(j.reasoning.replace(/^Filtered out: /, 'Filtered out before scoring: '))}</p>` : ''}
      <div class="posting" style="margin-top:10px">${esc(j.description || 'The source gave no description. Use Open posting to read it on the site.')}</div>`;
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

// ---- Documents ----
/** Escaped text with **bold** marks turned into bold. */
const marked = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** The cover letter as it prints: paragraphs, bullets, bold, and your signature above your name. */
function letterHtml(text, signature) {
  const blocks = String(text || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map((b, bi) => {
    const lines = b.split('\n').filter(l => l.trim());
    let html = '', run = [], items = [];
    const flushRun = () => { if (run.length) html += `<p>${run.map(marked).join('<br>')}</p>`; run = []; };
    const flushList = () => { if (items.length) html += `<ul>${items.map(i => `<li>${marked(i)}</li>`).join('')}</ul>`; items = []; };
    lines.forEach((l, li) => {
      if (signature && bi === blocks.length - 1 && li === lines.length - 1) { flushRun(); flushList(); html += `<p><img class="sig" src="${signature}" alt="Signature"></p>`; }
      const m = l.trim().match(/^[-•]\s+(.*)$/);
      if (m) { flushRun(); items.push(m[1]); } else { flushList(); run.push(l); }
    });
    flushRun(); flushList();
    return html;
  }).join('');
}

function cvHtml(blocks) {
  return blocks.map(b => b.kind === 'blank' ? '' :
    b.kind === 'heading' ? `<h4>${marked(b.text)}</h4>` :
    b.kind === 'name' ? `<p class="name">${esc(b.text.replace(/\*\*/g, ''))}</p>` :
    `<p class="${b.kind === 'bullet' ? 'li' : ''}${b.changed ? ' chg' : ''}${b.center ? ' c' : ''}">${marked(b.text)}</p>`).join('');
}

// ---- First-time setup, in one guided page ----
const welcomed = () => { try { return !!sessionStorage.getItem('welcomed'); } catch { return true; } };
/** Newer data from another computer (in Google Drive or a sync folder): continue from it here? */
const syncNewerHtml = n => n ? `<section class="card sync-banner"><header><h2>Continue where you left off</h2></header>
      <p>Job Hunt on <b>${esc(n.device)}</b> saved newer data ${esc(ago(n.saved_at))}${n.jobs ? ` (${n.jobs} roles)` : ''}. Continue from it here? Job Hunt restarts with it, and what's on this computer now is kept in a "before-restore" folder.</p>
      <div class="row"><button class="btn primary" data-act="syncContinue" data-folder="${esc(n.folder)}">Continue from ${esc(n.device)}</button>
      <button class="btn ghost" data-act="syncDecline" data-saved="${esc(n.saved_at)}">Keep this computer's data</button></div></section>` : '';
async function showWelcome() {
  try { sessionStorage.setItem('welcomed', '1'); } catch {}
  const st = settingsCache = await api('/api/settings');
  await refreshOverview();
  const s = overview.setup, p = st.profile;
  const fresh = !(p.locations || []).length; // nothing saved yet: suggest this device's country and time zone
  const step = (n, done, title, body) => `<li class="card ${done ? 'done' : ''}"><h2>${done ? '✓ ' : ''}${esc(title)}</h2>${body}</li>`;
  page(`<div class="head"><div class="grow"><h1>Welcome to Job Hunt</h1><p class="muted">Five steps, about five minutes. You can change everything later in Settings.</p></div><a class="btn ghost" href="#overview">Skip for now</a></div>
    ${overview.sync_newer ? syncNewerHtml(overview.sync_newer) : `<section class="card"><header><h2>Already using Job Hunt on another computer?</h2></header>
      <p class="muted">Connect the same Google account here: Job Hunt finds your data in your Google Drive and offers to continue with all your CVs, applications and settings. (On the other computer, connecting Google turns that on.) Otherwise, start fresh below.</p>
      ${st.google.client ? `<div class="row"><button class="btn primary" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connected ? `Connected as ${esc(st.google.email || 'you')}: check again` : 'Connect Google'}</button>${st.google.connected ? '<span class="muted small">Nothing to continue from yet? Turn on sync on the other computer, wait a few minutes, then check again.</span>' : ''}</div>
        <div id="googlePaste" ${st.google.pasting ? '' : 'hidden'}>${googlePasteBox(st.google.paste_url)}</div>`
        : '<div class="row"><a class="btn" href="#settings/connections">Set up Google</a></div>'}</section>`}
    ${st.kind === 'server' ? '' : filesCard(st, true)}
    <ol class="apply-steps">
      ${step(1, s.claude, 'Connect Claude', `<p class="muted">Claude is the AI that reads postings and rewrites your CV for each. ${s.engine === 'api' ? 'Job Hunt uses your Claude API key.' : 'Job Hunt uses your Claude subscription (Pro or Max).'}</p>
        ${s.engine === 'api' ? `<p class="muted">${s.claude ? '✓ Ready, with your API key.' : 'Add your API key in <a href="#settings/connections">Settings → Accounts</a>.'}</p>`
          : `<div id="welcomeClaude" class="small muted"><span class="spin" data-kind="check" data-secs="6"></span> Checking…</div><p class="muted small" style="margin-top:8px">No Claude subscription? <a href="#settings/connections">Use an API key instead</a> (you pay per use).</p>`}`)}
      ${step(2, st.cvs.length > 0, 'Add your CV', `<p class="muted">Word, PDF or text. Add one per kind of role (e.g. data engineering, program delivery). Claude reads each one and suggests the job titles to search for.</p>
        <label class="drop"><input type="file" accept=".docx,.pdf,.txt" multiple data-upload="cv-add" hidden><b>Add CVs</b><br><span class="muted small">Click to choose files</span></label>
        ${st.cvs.map(c => `<p class="small" style="margin:8px 0 0"><b>${esc(c.label)}</b>: ${(c.titles || []).length} job titles to search, like ${esc((c.titles || []).slice(0, 4).join(', ') || 'none yet')}${(c.areas || []).length ? `<br><span class="muted">Experience found: ${esc(c.areas.map(a => a.split(':')[0]).join(', '))}</span>` : ''} <a href="#cvs">See all and edit</a></p>`).join('')}
        ${st.cvs.length ? `<p class="small" style="margin-top:8px">${st.career_thinking ? '<span class="spin" data-kind="career"></span>Claude is working out your career options: every direction your CV supports, with pay, pros and cons. ' : st.career ? '' : ''}${st.career || st.career_thinking ? '<a href="#cvs/career">See your career options</a>' : ''}</p>` : ''}`)}
      ${step(3, (p.locations || []).length > 0, 'Where you want to work', `<form data-form="welcomeWhere" class="form">
          <div class="field">Cities or areas${placePicker('locations', p.locations, (fresh && tzCountry(deviceTz(), st.countries)) || p.sources.adzuna_country)}</div>
          <div class="stack" style="gap:12px">
            <label class="field">Country${countrySelect('country', (fresh && tzCountry(deviceTz(), st.countries)) || p.sources.adzuna_country, st.countries)}</label>
            <label class="field">Your time zone${tzSelect('timezone', fresh && deviceTz() ? deviceTz() : p.timezone)}<span class="hint">For interview times and when the daily search runs.</span></label>
            <label class="check"><input type="checkbox" name="include_metro" ${p.include_metro !== false ? 'checked' : ''}> <span>Include the area around each city<br><span class="muted small">Toronto, Oakville or any GTA city brings in the whole GTA (Mississauga, Markham, Vaughan…), Vancouver or Burnaby Metro Vancouver, Montreal Laval and Longueuil, London Greater London, New York the NYC area, Dubai Sharjah and Ajman.</span></span></label>
            <label class="check"><input type="checkbox" name="remote_ok" ${p.remote_ok ? 'checked' : ''}> <span>Include remote roles open across the country</span></label>
            <div><button class="btn primary" type="submit">Save</button></div>
          </div></form>`)}
      ${step(4, true, 'Where to look', `<p class="muted">Job Hunt finds employers near you by itself and searches their job boards. Add more places in one click:</p>
        <div class="stack" style="gap:8px">
          <label class="check"><input type="checkbox" data-act="welcomeSource" data-id="linkedin" ${p.sources.linkedin ? 'checked' : ''}> <span><b>LinkedIn</b> <span class="muted small">free, in any country; never touches your LinkedIn account</span></span></label>
          ${p.sources.adzuna_country === 'ca' ? `<label class="check"><input type="checkbox" data-act="welcomeSource" data-id="jobbank" ${p.sources.jobbank ? 'checked' : ''}> <span><b>Job Bank</b> <span class="muted small">Canada's national job board, free</span></span></label>` : ''}
        </div>
        <p class="muted small" style="margin-top:8px">More (Google for Jobs, recruiters, job-alert emails) in <a href="#search/setup">Search → Set up sources</a>. Connecting Gmail lets Job Hunt read replies and book interviews.</p>
        <div class="row"><a class="btn" href="#settings/connections">Connect Gmail (optional)</a></div>`)}
      ${step(5, !!overview.last_search, 'Run your first search', `<p class="muted">It takes a few minutes. Roles that fit come to your Queue, one at a time, for you to pick; tick the ones you want and Job Hunt tailors your CV and a cover letter for each.</p>
        <div class="row"><button class="btn primary" data-act="welcomeSearch" ${s.claude && st.cvs.length ? '' : 'disabled'}>Search for jobs now</button>${s.claude && st.cvs.length ? '' : '<span class="muted small">After steps 1 and 2.</span>'}</div>`)}
    </ol>`);
  if (s.engine !== 'api') welcomeClaude(false);
}

/** Welcome step 1: whether Claude Code is installed and signed in, with the button to do it. */
async function welcomeClaude(force) {
  const box = $('#welcomeClaude');
  if (!box) return;
  if (force) box.innerHTML = '<span class="spin" data-kind="check" data-secs="6"></span> Checking…';
  try {
    const st = await api('/api/settings/claude-code');
    if (!$('#welcomeClaude')) return;
    box.innerHTML = claudeSetupHtml(st);
    const li = box.closest('li'), ready = st.found && st.signed_in;
    li.classList.toggle('done', ready);
    li.querySelector('h2').textContent = (ready ? '✓ ' : '') + 'Connect Claude';
  } catch (err) { box.textContent = err.message; }
}

/** What changed in the tailored CV, each with Edit (your own wording) and Put back (your CV's line). */
function changesHtml(j, own) {
  if (own) return '<p class="muted">You\'re using your own CV file for this role, so there\'s no list of changes.</p>';
  if (!(j.cv_changes || []).length) return '<p class="muted">Your CV already matches this posting well, so nothing needed rewording. The cover letter was written for this role.</p>';
  return `<div class="diff">${j.cv_changes.map((c, i) => `<div class="chg-row" data-chg="${i}"><span class="was">${esc(c.before)}</span><span class="now">${esc(c.after)}</span>
    <span class="row chg-acts"><button class="btn ghost sm" data-act="chgEdit" data-i="${i}">Edit</button><button class="btn ghost sm" data-act="chgPutBack" data-i="${i}" title="Use the line from your CV">Put back</button></span>
    <span class="chg-form" hidden><textarea>${esc(c.after)}</textarea><span class="row"><button class="btn primary sm" data-act="chgSave" data-i="${i}">Save</button><button class="btn ghost sm" data-act="chgCancel" data-i="${i}">Cancel</button><span class="muted small">Your words, as you write them. Keep it true: you'll be asked about it.</span></span></span></div>`).join('')}</div>`;
}
let changeList = []; // the changes on the page, for Edit / Put back

// ---- Review: ready applications one at a time ----
const reviewSkipped = new Set(); // skipped for now, this session
let reviewPoll;
async function showReview() {
  clearTimeout(reviewPoll);
  const { jobs } = await api('/api/jobs?status=ready');
  const queue = jobs.filter(j => !reviewSkipped.has(j.id)).sort((a, b) => applyRank(b) - applyRank(a));
  if (!queue.length) {
    page(`<div class="head"><div class="grow"><h1>Review</h1></div></div><section class="card review-done"><h2>All caught up</h2>
      <p class="muted">${jobs.length ? `You skipped ${jobs.length} for now. <a href="#" data-act="reviewReset">Go through them again</a>.` : 'Nothing waiting for your review. New ones appear after you tailor roles.'}</p>
      <div class="row" style="justify-content:center"><a class="btn primary" href="#applications">Back to Jobs</a><a class="btn" href="#overview">Today</a></div></section>`);
    return;
  }
  const j0 = queue[0];
  pageKey = j0.id;
  const [{ job: j, effort, warnings, revising, answers, revision, sent_compare }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(j0.id)}`), settingsCache ? Promise.resolve(settingsCache) : api('/api/settings')]);
  j.effort = effort;
  const done = jobs.length - queue.length;
  const flags = j.red_flags || [];
  j.warnings = warnings || [];
  page(`<div class="head"><div class="grow"><div class="eyebrow">Review · ${queue.length} to go${done ? ` · ${done} skipped` : ''}</div>
      <h1>${esc(j.title)}</h1><div class="facts" style="margin-top:6px"><b>${esc(j.company)}${ratingTag(j.rating)}</b>${j.location ? `<span>${placeHtml(j)}</span>` : ''}${j.salary ? `<span>${esc(j.salary)}</span>` : ''}<span>${ageTag(j)}</span>${closedTag(j)}${belowMinTag(j)}${deadlineTag(j)}${effortTag(j)}</div></div>
      <a class="btn ghost" href="#applications/approve">Exit review</a></div>
    ${expiredWhy(j) ? `<div class="card" style="border-color:var(--crit)"><b>This opening has expired.</b> <span class="muted">${esc(expiredWhy(j).replace(/^Expired: /, ''))}. Check the posting before approving it.</span></div>` : ''}
    ${revising ? '<section class="card"><p><span class="spin" data-kind="revise"></span> Making your changes… this updates by itself.</p></section>' : revisionHtml(revision)}
    ${sentCompareHtml(j, sent_compare)}
    <div class="grid-2">
      <div class="stack">
        <section class="card"><header><h2>Why it fits</h2>${j.url ? `<button class="btn ghost" data-act="open" data-what="posting" data-job="${esc(j.id)}">${svg('open')}Posting</button>` : ''}</header>
          <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
            ${j.score != null ? `<div class="fit-pair"><div><div class="ring" style="--p:${j.score}"><b>${j.score}</b></div><span class="muted small">your CV</span></div>${j.score_after != null ? `<span class="fit-arrow">→</span><div><div class="ring" style="--p:${j.score_after}"><b>${j.score_after}</b></div><span class="muted small">tailored</span></div>` : ''}</div>` : ''}
            <p>${esc(j.reasoning || '')}</p></div>
          ${flags.length ? `<ul class="flags">${flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          ${j.coverage_after != null ? `<p class="muted small">Posting keywords in your CV: <b>${pct(j.coverage_before)}</b> before, <b>${pct(j.coverage_after)}</b> after.${(j.keyword_gaps || []).length ? ` Not added (nothing in your CV backs them): ${esc(j.keyword_gaps.slice(0, 6).join(', '))}.` : ''}</p>` : ''}
        </section>
        <section class="card"><header><h2>What changed in your CV</h2><button class="btn ghost" data-act="open" data-what="cv" data-job="${esc(j.id)}">${svg('doc')}Open</button></header>
          ${gapsHtml(j)}
          ${changesHtml(j, false)}
        </section>
      </div>
      <div class="stack">
        <section class="card"><header><h2>Cover letter</h2><a class="btn ghost" href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs">Edit</a></header>
          ${j.cover_letter ? `<div class="paper letter">${letterHtml(j.cover_letter, st.signature)}</div>` : '<p class="muted">No letter.</p>'}</section>
        <section class="card"><header><h2>Want something changed?</h2></header>
          <div class="row" style="align-items:flex-start"><select id="reviseWhat" style="width:auto"><option value="cv">CV</option>${j.cover_letter ? '<option value="letter">Cover letter</option>' : ''}</select>
            <textarea id="reviseNote" style="flex:1;min-height:56px" placeholder="e.g. Lead with the Snowflake work · Shorter letter"></textarea></div>
          <div class="row"><button class="btn" data-act="revise" ${revising ? 'disabled' : ''}>Make the change</button></div></section>
      </div>
    </div>
    <div class="review-bar">
      <button class="btn primary" data-act="reviewApprove" data-job="${esc(j.id)}" data-email="${esc(j.apply_email || '')}" title="A">${svg('check')}${j.apply_email ? 'Approve and email it' : 'Approve and apply'}</button>
      <button class="btn" data-act="stage" data-status="saved" data-job="${esc(j.id)}" data-from="ready" title="S">Save for later</button>
      <button class="btn danger" data-act="stage" data-status="dismissed" data-job="${esc(j.id)}" data-from="ready" title="X">Not interested</button>
      <button class="btn ghost" data-act="reviewSkip" data-job="${esc(j.id)}" title="N">Skip for now →</button>
      <span class="muted small desktop-only">Keys: A approve · S save · X not interested · N skip</span>
    </div>`);
  main().dataset.job = j.id;
  main().dataset.status = j.status;
  changeList = j.cv_changes || [];
  if (revising) reviewPoll = setTimeout(() => { if (location.hash === '#review') route(); }, 4000);
}

// ---- Apply: everything for submitting on the company's site, then one click ----
async function showApply(id) {
  const [{ job: j, answers, cv_pdf, letter_pdf, can_fill, on_apply }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(id)}`), api('/api/settings')]);
  const p = st.profile;
  const facts = [p.name, p.email, ...(p.application_facts || '').split('\n')].map(x => (x || '').trim()).filter(Boolean);
  const copyRow = (label, text, i) => `<div class="copy-row"><span class="grow"><span class="muted small">${esc(label)}</span><br><span id="cp${i}">${esc(text)}</span></span><button class="btn ghost sm" data-act="copy" data-from="cp${i}">Copy</button></div>`;
  const done = ['applied', 'interviewing', 'offer', 'rejected'].includes(j.status);
  page(`<div class="head"><div class="grow"><div class="eyebrow"><a href="#job/${encodeURIComponent(j.id)}">${esc(j.company)}</a> / Apply</div><h1>Apply: ${esc(j.title)} ${closedTag(j)}</h1>
      <p class="muted">${!done && expiredWhy(j) ? `<b style="color:var(--crit)">${esc(expiredWhy(j))}.</b> Check the posting is still open before you apply.` : done ? 'You\'ve applied to this one.' : can_fill && j.url ? 'Job Hunt can fill in the form for you, or use the files and answers below yourself.' : 'Four steps. Your files and answers are ready below.'}</p></div></div>
    <ol class="apply-steps">
      ${can_fill && j.url && !done ? `<li class="card"><h2>Let Job Hunt fill it in</h2>
        <p class="muted">Opens ${j.apply_url ? 'the job on the company\'s own site' : 'the posting'} in your own browser, where your sign-ins and saved passwords work. On the form, click the Job Hunt extension and press <b>Fill this form</b>: it fills it in from your CV, letter, facts and saved answers, and attaches your files. You check it and press Submit.</p>
        <div class="row"><button class="btn primary" data-act="fillBrowser" data-job="${esc(j.id)}" title="Opens it in Chrome or Edge; the Job Hunt extension fills it in">${svg('open')}Fill it in my browser</button><button class="btn" data-act="fillForm" data-job="${esc(j.id)}" title="Opens it in a Job Hunt window and fills it in there. Sites that need you to sign in are easier in your own browser.">${svg('check')}In a Job Hunt window instead</button></div>
        <details class="more"><summary class="small muted">How it works, and marking it applied</summary><p class="muted small">Job Hunt doesn't press Submit (unless you turned that on for simple forms): check the form, fix anything in amber, and submit it yourself. When the site confirms it, Job Hunt marks the application as applied by itself; or press <b>Mark applied</b> here. The extension is set up in <a href="#settings/extension">Settings → Browser extension</a>. The steps below are there if you'd rather do it yourself, or for anything it couldn't fill.</p></details></li>` : ''}
      <li class="card"><h2>${j.apply_url ? 'Open it on the company\'s site' : 'Open the posting'}</h2><p class="muted">${j.apply_url ? 'Applying on the company\'s own site goes straight to them, not through a job board.' : 'Use the company\'s Apply button.'} If it asks you to sign in or make an account, do that first.</p>
        <div class="row">${j.apply_url ? `<button class="btn ${can_fill ? '' : 'primary'}" data-act="open" data-what="company" data-job="${esc(j.id)}">${svg('open')}Apply on the company's site</button>` : ''}
        ${j.url ? `<button class="btn ${j.apply_url ? 'ghost' : can_fill ? '' : 'primary'}" data-act="open" data-what="posting" data-job="${esc(j.id)}">${svg('open')}${j.apply_url ? 'The job board posting' : 'Open the posting'}</button>` : ''}
        ${!j.apply_url && j.url && !done ? `<button class="btn ghost" data-act="findApply" data-job="${esc(j.id)}" title="Claude searches the company's careers site for this job">${svg('search')}Find it on the company's site</button>` : ''}</div>
        ${j.url || j.apply_url ? '' : '<p class="muted">No link saved for this posting.</p>'}</li>
      <li class="card"><h2>Attach your CV and cover letter</h2><p class="muted">Most sites take PDF; use Word only if they ask for it. <b>Show files</b> opens the folder so you can drag them in.</p>
        <div class="row">
          <button class="btn" data-act="open" data-what="cv-pdf" data-job="${esc(j.id)}">${svg('doc')}CV (PDF)</button>
          <button class="btn" data-act="open" data-what="letter-pdf" data-job="${esc(j.id)}">${svg('doc')}Cover letter (PDF)</button>
          <button class="btn ghost" data-act="open" data-what="cv" data-job="${esc(j.id)}">CV (Word)</button>
          <button class="btn ghost" data-act="open" data-what="letter" data-job="${esc(j.id)}">Letter (Word)</button>
          <button class="btn ghost" data-act="open" data-what="folder" data-job="${esc(j.id)}">${svg('folder')}Show files</button>
        </div>${cv_pdf && letter_pdf ? '' : '<p class="muted small">The PDF copies are made when you open them, and made again after you change the Word file (needs Word or LibreOffice).</p>'}</li>
      <li class="card"><h2>Fill in the form</h2>
        ${facts.length ? `<div class="copy-list">${facts.map((f, i) => copyRow(i === 0 ? 'Name' : i === 1 ? 'Email' : 'From your facts for forms', f, `f${i}`)).join('')}</div>` : ''}
        ${(answers || []).length ? `<h3 class="sub" style="margin-top:12px">Answers to the usual questions</h3><div class="copy-list">${answers.map((a, i) => copyRow(a.question, a.answer, `a${i}`)).join('')}</div>`
          : `<p class="muted">For questions like “Why this company?” or salary expectations, <a href="#job/${encodeURIComponent(j.id)}" data-tab-to="apply">have Claude write answers</a> from your CV and this posting.</p>`}
        ${(p.application_facts || '').trim() ? '' : '<p class="muted small">Add the facts forms ask for (work authorization, notice period, salary expectations) in <a href="#cvs/details">Me → About me</a> to have them here.</p>'}</li>
      <li class="card"><h2>Done?</h2><p class="muted">Job Hunt then waits for a reply, and reminds you to follow up if none comes${p.follow_up_after ? ` in ${p.follow_up_after} days` : ''}.${on_apply?.to && on_apply.mode !== 'off' && !done
        ? ` It also ${on_apply.mode === 'send' ? 'emails' : 'drafts an email to'} <b>${esc(on_apply.to.name || on_apply.to.email)}</b>${on_apply.to.known ? ', the recruiter you know there, asking them to put you forward' : ' (named in the posting) to say you\'ve applied'}. <a href="#inbox/recruiters">Change this</a>` : ''}</p>
        <div class="row">${done ? `<a class="btn" href="#job/${encodeURIComponent(j.id)}">Back to the job</a>` : `<button class="btn primary" data-act="applied" data-job="${esc(j.id)}">${svg('check')}I've submitted it</button><a class="btn ghost" href="${reviewReturn ? '#review' : `#job/${encodeURIComponent(j.id)}`}">Not now</a>`}</div></li>
    </ol>`);
}
let reviewReturn = false;

// ---- Calendar ----
let calMonth = null; // the month shown, as its first day
const CAL_KIND = { interview: ['Interview', 'interviewing'], prep: ['Prep', 'queued'], reminder: ['Reminder', 'approved'], deadline: ['Deadline', 'crit'], 'follow-up': ['Follow-up', 'info'], google: ['Google Calendar', ''] };
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeOf = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The Calendar page's tabs: the calendar, and its settings (email, interviews, reminders; moved from Settings). */
const calHead = () => `<div class="head"><div class="grow"><div class="eyebrow"><a href="#calendar">Calendar</a> / Settings</div><h1>Calendar settings</h1><p class="muted">Your time zone, and how Job Hunt books interviews and reminds you.</p></div>
  <div class="row"><a class="btn" href="#calendar">${svg('calendar')}Back to the calendar</a></div></div>`;
async function showCalendar() {
  const [{ items, google, synced, show_google, syncing }, { jobs }] = await Promise.all([api('/api/calendar?back=60&ahead=120'), api('/api/jobs')]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  calMonth = calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  const byDay = {};
  items.forEach(i => { (byDay[dayKey(new Date(i.at))] ||= []).push(i); });
  // The month grid, Monday first.
  const first = calMonth, lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1))];
  const grid = `<div class="cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-h">${d}</div>`).join('')}
    ${cells.map(d => {
      if (!d) return '<div class="cal-d empty"></div>';
      const list = byDay[dayKey(d)] || [];
      return `<a href="#" class="cal-d ${+d === +today ? 'today' : ''} ${d < today ? 'past' : ''}" data-act="calDay" data-day="${dayKey(d)}"><span class="n">${d.getDate()}</span>
        ${list.slice(0, 3).map(i => `<span class="cal-e ${esc(i.kind)}">${i.all_day ? '' : `${esc(timeOf(i.at))} `}${esc(i.company || i.title)}</span>`).join('')}${list.length > 3 ? `<span class="muted small">+${list.length - 3} more</span>` : ''}</a>`;
    }).join('')}</div>`;
  // The agenda: what's coming, then what just happened.
  const row = i => {
    const [label, cls] = CAL_KIND[i.kind] || [esc(i.kind), ''];
    const past = new Date(i.at) < new Date() && !i.all_day;
    const job = i.job_id ? `<a href="#job/${encodeURIComponent(i.job_id)}" ${i.kind === 'interview' || i.kind === 'prep' ? 'data-tab-to="interview"' : ''}>${esc(i.job_title || 'Open the job')}</a>` : '';
    const id = esc(i.job_id || '');
    let acts = '';
    if (i.kind === 'interview' && !past && i.job_id) acts = `<a class="btn sm" href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prep</a>`;
    if (i.kind === 'interview' && past && i.job_id) acts = `<span class="muted small">How did it go?</span><button class="btn sm" data-act="calNext" data-job="${id}" data-label="${esc(`${i.company || ''} – ${i.job_title || ''}`)}">Next round</button><button class="btn sm" data-act="stage" data-status="offer" data-job="${id}">Offer</button><button class="btn ghost sm" data-act="stage" data-status="rejected" data-job="${id}">Rejected</button>`;
    if (i.kind === 'follow-up' && i.job_id) acts = `<button class="btn sm" data-act="followUp" data-job="${id}">Write follow-up</button>`;
    // A last day to apply that has passed: expired, nothing left to do there.
    const gone = i.kind === 'deadline' && new Date(new Date(i.at).setHours(23, 59, 59)) < new Date();
    if (gone) acts = '<span class="pill crit expired" title="The last day to apply has passed">Expired</span>';
    else if (i.kind === 'deadline' && i.status === 'queued') acts = `<button class="btn sm" data-act="tailorPicked" data-job="${id}">Tailor</button>`;
    else if (i.kind === 'deadline' && i.status === 'ready') acts = `<button class="btn primary sm" data-act="approve" data-job="${id}" data-email="${esc(i.apply_email || '')}">Approve</button>`;
    if (i.kind === 'google' && i.suggest) acts = `<span class="muted small">Interview for ${esc(i.suggest.company)}?</span><button class="btn sm" data-act="calLink" data-id="${esc(i.id)}" data-job="${esc(i.suggest.job_id)}" title="Show it with that application and move it to Interviewing">Link to application</button>`;
    if (i.local && i.kind === 'interview') acts += `<button class="btn ghost sm" data-act="calDelete" data-id="${esc(i.id)}" title="Remove this interview, its prep time and reminders">${svg('close')}</button>`;
    return `<div class="cal-row ${past ? 'past' : ''} ${i.kind === 'google' ? 'gcal' : ''}"><span class="cal-t">${i.all_day ? (i.overdue ? '<b style="color:var(--crit)">Due</b>' : 'All day') : esc(timeOf(i.at))}</span>
      <span class="pill ${cls}">${label}</span><span class="grow"><b>${esc(i.title)}</b>${job ? `<br><span class="small">${job}</span>` : ''}</span><span class="row todo-act">${acts}</span></div>`;
  };
  const group = list => {
    const out = {};
    list.forEach(i => { (out[dayKey(new Date(i.at))] ||= []).push(i); });
    return Object.entries(out).map(([k, l]) => `<div class="cal-day" id="day-${k}"><h3>${esc(new Date(k + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}${k === dayKey(today) ? ' <span class="pill good">Today</span>' : ''}</h3>${l.map(row).join('')}</div>`).join('');
  };
  const soon = items.filter(i => new Date(i.at) >= today && new Date(i.at) < new Date(+today + 31 * 86400000));
  const recent = items.filter(i => new Date(i.at) < today && new Date(i.at) >= new Date(+today - 14 * 86400000)).reverse();
  const pickable = jobs.filter(j => ['ready', 'approved', 'applied', 'interviewing', 'saved'].includes(j.status)).sort((a, b) => a.company.localeCompare(b.company));
  page(`<div class="head"><div class="grow"><h1>Calendar</h1><p class="muted">Interviews, prep time and reminders${google ? ' (also in your Google Calendar)' : ''}, application deadlines and follow-ups that are due.</p></div>
      <div class="row"><a class="btn ghost set-btn" href="#calendar/settings">${svg('settings')}Calendar settings</a><button class="btn primary" data-act="calAdd">${svg('add')}Add interview</button>
        <a class="btn" href="/api/calendar.ics" download="Job Hunt.ics" title="Import into Outlook or Apple Calendar">Download for Outlook / Apple</a>
        ${google ? `<button class="btn" data-act="calSync" ${syncing ? 'disabled' : ''} title="Copy Job Hunt's entries there, and bring back interviews you moved or deleted">${syncing ? 'Syncing…' : 'Sync with Google'}</button>
          <button class="btn ghost" data-act="link" data-url="https://calendar.google.com">Google Calendar</button>` : ''}</div></div>
    ${google ? `<p class="muted small" style="margin:-6px 0 12px">${synced ? `Synced with Google Calendar ${esc(ago(synced))}; it syncs every 30 minutes.` : 'Not synced with Google Calendar yet.'}
      <label class="check inline"><input type="checkbox" data-act="calShowGoogle" ${show_google ? 'checked' : ''}> Show my other Google Calendar events</label></p>` : ''}
    <section class="card" id="calAddCard" hidden><header><h2>Add an interview</h2></header>
      <form data-form="calInterview" class="form">
        <label class="field">Application<select name="job_id" required>${pickable.length ? pickable.map(j => `<option value="${esc(j.id)}">${esc(j.company)} – ${esc(j.title)}</option>`).join('') : '<option value="">No applications yet</option>'}</select></label>
        <label class="field">Date and time<input type="datetime-local" name="start" required></label>
        <label class="field">Length<select name="minutes">${[[30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']].map(([v, n]) => `<option value="${v}" ${v === 60 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field">Video link or place (optional)<input type="text" name="link" placeholder="https://teams.microsoft.com/… or 100 King St W"></label>
        <label class="field">Notes (optional)<input type="text" name="note" placeholder="Who you'll meet, what round"></label>
        <div class="row" style="align-self:end"><button class="btn primary" type="submit">Add it</button><button class="btn ghost" type="button" data-act="calAdd">Cancel</button></div>
      </form>
      <p class="muted small">Adds prep time before it and thank-you and follow-up reminders after (Settings → Schedule)${google ? ', in your Google Calendar too' : ''}, and moves the application to Interviewing.</p></section>
    <section class="card"><header><h2>${esc(calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2>
      <div class="row"><button class="btn ghost" data-act="calMonth" data-d="-1" title="Previous month" aria-label="Previous month">‹</button><button class="btn ghost" data-act="calMonth" data-d="0">Today</button><button class="btn ghost" data-act="calMonth" data-d="1" title="Next month" aria-label="Next month">›</button></div></header>
      ${grid}
      <div class="row small muted" style="margin-top:8px;gap:14px">${Object.entries(CAL_KIND).map(([k, [n]]) => `<span><i class="cal-key ${k}"></i>${n}</span>`).join('')}</div></section>
    <section class="card"><header><h2>Next 30 days</h2></header>${soon.length ? group(soon) : `<p class="muted">Nothing coming up.${google ? '' : ' Interviews you add here, or that Job Hunt books from your email once Google is connected, show up here.'}</p>`}</section>
    ${recent.length ? `<details class="card"><summary><b>Last 2 weeks</b> <span class="muted small">${recent.length}</span></summary>${group(recent)}</details>` : ''}`);
}

let docFilter = 'all';
/** Titles the career coach suggested this week: add one to its CV's searches, or say no. */
function titleIdeasHtml(ideas) {
  if (!ideas?.length) return '';
  return `<section class="card title-ideas"><header><h2>New titles to try</h2><a class="btn ghost sm" href="#cvs/coach">Why these</a></header>
    <p class="muted small">Your career coach thinks these would find good matches. Add one and the next search looks for it.</p>
    ${ideas.map(i => `<div class="idea-row"><div class="grow"><b>${esc(i.title)}</b>${i.cv ? ` <span class="muted small">· with your ${esc(i.cv)} CV</span>` : ''}<div class="muted small">${esc(i.why || '')}</div></div>
      <button class="btn sm primary" data-act="titleIdea" data-add="1" data-title="${esc(i.title)}">Add to my search</button><button class="btn sm ghost" data-act="titleIdea" data-title="${esc(i.title)}">No thanks</button></div>`).join('')}
  </section>`;
}

const COACH_KIND = { show: ['good', 'Say it on your CV'], learn: ['', 'Learn it'], experience: ['warn', 'Get the experience'] };
let coachWatch;
async function showCoach() {
  const r = await api('/api/coach');
  const g = r.gaps || { postings: 0, skills: [], must_haves: [] }, c = r.coach;
  const ideas = overview?.title_ideas || [];
  const jobsOf = x => (x.jobs || []).map(j => `<a href="#job/${encodeURIComponent(j.id)}">${esc(j.company)}</a>`).join(', ');
  page(`
    ${meHead('coach', 'The skills the roles you go for ask for that your CV doesn\'t show, and what would help most.')}
    <section class="card coach-plan"><header><h2>Your career coach</h2>
      ${r.thinking ? '<span class="pill"><span class="spin" data-kind="coach"></span>Thinking…</span>' : `<button class="btn ${c ? 'ghost' : 'primary'}" data-act="coachRun" ${r.claude && g.postings ? '' : 'disabled'}>${c ? 'Look again' : 'Get my plan'}</button>`}</header>
      ${c ? `<p>${esc(c.advice)}</p><p class="muted small">From ${esc(fmtDate(c.at))}. Job Hunt looks again every week with your weekly review.</p>
        <div class="coach-skills">${(c.skills || []).map(k => { const [cls, label] = COACH_KIND[k.kind] || ['', k.kind]; return `<div class="coach-skill">
          <div class="row" style="justify-content:space-between"><b>${esc(k.skill)}</b><span class="pill ${cls}">${label}</span></div>
          <p class="small">${esc(k.why)}</p><p class="small"><b>How:</b> ${esc(k.how)}</p>${k.time ? `<p class="muted small">About ${esc(k.time)}</p>` : ''}</div>`; }).join('')}</div>`
        : `<p class="muted">${!g.postings ? 'After a search or two, your coach looks at the roles you go for and says which missing skills would help most, how to get each one, and new titles to try.' : !r.claude ? 'Connect Claude to get a plan (Settings → Accounts).' : 'Claude looks at the skills below and your CVs, then says which ones are worth the effort, how to get each, and new titles to try. It takes a minute.'}</p>`}
    </section>
    ${ideas.length ? titleIdeasHtml(ideas) : ''}
    <section class="card"><header><h2>Skills your CV doesn't show</h2><span class="muted small">From ${g.postings} role${g.postings === 1 ? '' : 's'} near your fit score in the last 90 days</span></header>
      ${g.skills.length ? `<table class="jobs" id="t-gaps"><thead><tr>${sortTh('Skill')}${sortTh('Not in your CV', 'num')}${sortTh('Asked for', 'num')}<th>For example</th></tr></thead><tbody>
        ${g.skills.map(x => `<tr><td data-v="${esc(x.skill.toLowerCase())}"><b>${esc(x.skill)}</b></td>
          <td data-v="${x.missing}"><div class="gap-bar"><span style="width:${Math.min(100, x.share)}%"></span></div><span class="small">${x.missing} role${x.missing === 1 ? '' : 's'} · ${x.share}%</span></td>
          <td data-v="${x.asked}" class="small">${x.asked}</td><td class="small">${jobsOf(x)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">If you have one of these, add it to your CV in your own words, and tailoring will use it. Never claim one you don't have.</p>`
        : `<p class="muted">${g.postings ? 'Your CV covers what these roles ask for. Nice.' : 'Nothing yet: run a search first.'}</p>`}
    </section>
    ${g.must_haves.length ? `<section class="card"><header><h2>Hard requirements you missed</h2></header><ul class="flags">
      ${g.must_haves.map(m => `<li>${esc(m.text)} <span class="muted small">· <a href="#job/${encodeURIComponent(m.id)}">${esc(m.company)} – ${esc(m.title)}</a></span></li>`).join('')}</ul></section>` : ''}`);
  const t = document.getElementById('t-gaps');
  if (t) { if (!sortState['t-gaps']) sortState['t-gaps'] = { col: 1, dir: 'desc' }; applySort(t); }
  clearTimeout(coachWatch);
  if (r.thinking) { const here = location.hash; coachWatch = setTimeout(() => { if (location.hash === here) route(); }, 8000); }
}

async function showDocuments() {
  const { jobs } = await api('/api/jobs');
  const all = jobs.filter(j => j.cv_path || j.letter_path).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const week = Date.now() - 7 * 86400000;
  const groups = {
    all: ['All', () => true],
    ready: ['Ready to approve', j => j.status === 'ready'],
    sent: ['Applied', j => ['approved', 'applied'].includes(j.status)],
    interviewing: ['Interviewing', j => ['interviewing', 'offer'].includes(j.status)],
    week: ['This week', j => new Date(j.updated_at) >= week],
    saved: ['Saved for later', j => j.status === 'saved'],
    closed: ['Rejected or closed', j => ['rejected', 'no_response'].includes(j.status) || !!j.closed_at],
  };
  const docs = all.filter((groups[docFilter] || groups.all)[1]);
  page(`
    ${jobsHead('files')}
    <p class="muted flow-about">Every CV and cover letter tailored from yours. Click a heading to sort; click a role to read and edit them.</p>
    ${all.length ? '<input type="search" id="docFilter" class="filter" placeholder="Filter by company or title" style="max-width:420px;margin-bottom:10px">' : ''}
    ${all.length ? `<div class="chips">${Object.entries(groups).map(([k, [n, f]]) => `<button class="chip ${k === docFilter ? 'on' : ''}" data-act="docFilter" data-f="${k}">${n} <b>${all.filter(f).length}</b></button>`).join('')}</div>` : ''}
    ${docs.length ? `<section class="card" style="padding:6px 10px"><table class="jobs" id="t-docs"><thead><tr>${sortTh('Company')}${sortTh('Role')}${sortTh('Location')}${sortTh('Stage', 'rank')}${sortTh('Fit', 'num')}${sortTh('Updated', 'date')}<th>Files</th></tr></thead><tbody>
      ${docs.map(j => `<tr class="docrow-t" data-text="${esc((j.company + ' ' + j.title).toLowerCase())}">
        <td class="co" data-v="${esc(j.company.toLowerCase())}">${coCell(j)}</td>
        <td class="role" data-v="${esc(j.title.toLowerCase())}"><a href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs"><b>${esc(j.title)}</b></a>${closedTag(j)}</td>
        <td class="loc small" data-v="${esc((j.location || '').toLowerCase())}">${locCell(j)}</td>
        <td data-v="${stageOrder(j.status)}">${stagePill(j.status)}</td>
        <td data-v="${j.score_after ?? j.score ?? -1}">${j.score != null ? scoreBadge(j.score_after ?? j.score) : '<span class="muted">–</span>'}</td>
        <td class="small muted nowrap" data-v="${esc(j.updated_at || '')}">${esc(fmtDate(j.updated_at))}</td>
        <td class="files"><div class="file-slots">
          ${j.cv_path ? `<button class="btn sm" data-act="open" data-what="cv" data-job="${esc(j.id)}" title="Open the CV in Word">${svg('doc')}CV</button>` : '<span></span>'}
          ${j.letter_path ? `<button class="btn sm" data-act="open" data-what="letter" data-job="${esc(j.id)}" title="Open the cover letter in Word">${svg('doc')}Letter</button>` : '<span></span>'}
          ${j.cv_path ? `<button class="btn ghost sm" data-act="open" data-what="cv-pdf" data-job="${esc(j.id)}" title="PDF copy of the CV">CV PDF</button>` : '<span></span>'}
          ${j.letter_path ? `<button class="btn ghost sm" data-act="open" data-what="letter-pdf" data-job="${esc(j.id)}" title="PDF copy of the cover letter">Letter PDF</button>` : '<span></span>'}
          <button class="btn ghost sm icon-only" data-act="open" data-what="folder" data-job="${esc(j.id)}" title="Show files">${svg('folder')}</button>
        </div>
        </td></tr>`).join('')}</tbody></table></section>`
    : `<p class="empty">${all.length ? 'Nothing here.' : 'No tailored CVs or cover letters yet. They appear here after you tailor a role, or add a job yourself.'}</p>`}`);
  $('#docFilter')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.docrow-t').forEach(r => { r.hidden = q && !r.dataset.text.includes(q); });
  });
  if (!sortState['t-docs']) sortState['t-docs'] = { col: 5, dir: 'desc' };
  main().querySelectorAll('table.jobs').forEach(applySort);
}

/** What an applicant tracking system would trip on in this CV. */
function atsHtml(list) {
  const problems = list.filter(x => x.level === 'problem');
  return `<details class="ats" ${problems.length ? 'open' : ''}><summary class="small"><b>Screening-software check:</b> ${list.length ? `${problems.length ? `<span style="color:var(--crit)">${problems.length} problem${problems.length === 1 ? '' : 's'}</span>` : 'reads cleanly'}${list.length - problems.length ? `, ${list.length - problems.length} tip${list.length - problems.length === 1 ? '' : 's'}` : ''}` : 'the software employers use to screen CVs reads it cleanly'}</summary>
    ${list.length ? `<ul class="flags">${list.map(x => `<li class="${x.level === 'problem' ? 'crit' : 'ats-tip'}">${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${(() => {
      // What was checked, ticked when nothing above is about it.
      const said = list.map(x => x.text.toLowerCase()).join(' ');
      const ok = ATS_CHECKS.filter(([, key]) => !said.includes(key));
      return ok.length ? `<p class="small muted" style="margin:8px 0 4px">${list.length ? 'Also checked, and fine:' : 'What was checked:'}</p><ul class="ats-ok small">${ok.map(([what]) => `<li>${esc(what)}</li>`).join('')}</ul>` : '';
    })()}</details>`;
}
/** What the screening-software check looks at, with a word its warning about it would contain. */
const ATS_CHECKS = [
  ['Your email and phone are in the body, not only in the page header or footer', 'header or footer'],
  ['No text hidden in text boxes', 'text boxes'],
  ['No newspaper-style columns', 'columns'],
  ['No tables that older systems jumble', 'table'],
  ['No pictures (photos, logos or icons)', 'picture'],
  ['An email address the system can find', 'no email'],
  ['Standard section names: Experience, Education, Skills', 'section names'],
  ['A usual length (no more than about three pages)', 'words'],
];

/** Pay across your tailored roles, as a range bar with the typical figure and your minimum. */
function payHtml(p) {
  if (!p || !p.tailored) return '';
  const k = v => `$${Math.round(v / 1000)}K`;
  if (!p.stated) return `<section class="card"><header><h2>Pay in the roles you tailored</h2></header><p class="muted">None of your ${p.tailored} tailored role${p.tailored === 1 ? '' : 's'} states a yearly salary yet.</p></section>`;
  const lo = Math.min(p.low, p.minimum ?? p.low), hi = Math.max(p.high, p.minimum ?? p.high);
  const at = v => hi > lo ? ((v - lo) / (hi - lo) * 100).toFixed(1) : 50;
  return `<section class="card"><header><h2>Pay in the roles you tailored</h2><span class="muted small">${p.stated} of ${p.tailored} state a yearly salary</span></header>
    <div class="kpis" style="margin:0 0 14px"><div class="kpi"><span class="kpi-l">Lowest</span><span class="kpi-v">${k(p.low)}</span></div>
      <div class="kpi"><span class="kpi-l">Typical (middle)</span><span class="kpi-v">${k(p.median)}</span></div>
      <div class="kpi"><span class="kpi-l">Highest</span><span class="kpi-v">${k(p.high)}</span></div>
      <div class="kpi"><span class="kpi-l">Your minimum</span><span class="kpi-v">${p.minimum ? k(p.minimum) : '–'}</span><span class="kpi-s">${p.minimum ? `${p.below_minimum} role${p.below_minimum === 1 ? '' : 's'} top out below it` : '<a href="#search/what">Set one</a>'}</span></div></div>
    <div class="payline"><span class="payband" style="left:${at(p.low)}%;right:${100 - at(p.high)}%"></span>
      <span class="paymark" style="left:${at(p.median)}%" title="Typical ${k(p.median)}"></span>
      ${p.minimum ? `<span class="paymark min" style="left:${at(p.minimum)}%" title="Your minimum ${k(p.minimum)}"></span>` : ''}</div>
    <div class="row small muted" style="justify-content:space-between;margin-top:4px"><span>${k(lo)}</span><span><i class="key"></i> typical${p.minimum ? ' <i class="key min"></i> your minimum' : ''}</span><span>${k(hi)}</span></div>
    <h3 class="sub" style="margin-top:14px">Best paid</h3>
    <table><tbody>${p.roles.map(x => `<tr><td><a href="#job/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <span class="muted small">${esc(x.company)}</span></td><td class="num">${x.low === x.high ? k(x.high) : `${k(x.low)}–${k(x.high)}`}</td><td>${stagePill(x.status)}</td></tr>`).join('')}</tbody></table>
  </section>`;
}

// ---- Results ----
/** Where jobs come from: per source, the roles it listed in the last 90 days, how many only it
 *  found, and which other sources listed the same ones. */
function overlapCard(list) {
  const name = x => x.name || sourceName(x.source);
  const pc = (a, b) => b ? Math.round(a / b * 100) : 0;
  if (!list.length) return `<section class="card"><header><h2>Where jobs come from</h2></header><p class="muted">How much your job sources overlap shows here after your next search: Job Hunt now notes every source that lists each role.</p></section>`;
  const low = list.filter(x => x.roles >= 10).sort((a, b) => pc(a.only, a.roles) - pc(b.only, b.roles))[0];
  return `<section class="card"><header><h2>Where jobs come from</h2><span class="muted small">last 90 days</span></header>
    <p class="muted small">The same role on several sources counts once per source. <b>Only here</b> is what you'd miss without that source.${low && pc(low.only, low.roles) < 25 ? ` ${esc(name(low))} adds the least: ${100 - pc(low.only, low.roles)}% of its roles are on another source too.` : ''}</p>
    <table class="jobs"><thead><tr>${sortTh('Source', 'text')}${sortTh('Roles', 'num')}${sortTh('Only here', 'num')}<th>Also listed on</th></tr></thead><tbody>
    ${list.map(x => `<tr><td>${esc(name(x))}</td><td class="num" data-v="${x.roles}">${x.roles}</td>
      <td class="num" data-v="${pc(x.only, x.roles)}">${x.only} <span class="muted small">${pc(x.only, x.roles)}%</span></td>
      <td class="small">${x.also.length ? x.also.slice(0, 4).map(a => `${esc(name(a))} <span class="muted">${pc(a.roles, x.roles)}%</span>`).join(' · ') : '<span class="muted">nowhere else</span>'}</td></tr>`).join('')}
    </tbody></table></section>`;
}
/** The period Results covers: 7, 30 or 90 days, or 0 for everything. Remembered in this browser. */
let resultsDays = (() => { try { return Number(localStorage.getItem('jh.resultsDays') || 0); } catch (e) { return 0; } })();
/** Reply rate by source, best first, with how many applications each rests on; small ones hidden unless asked. */
function sourceRates(rows, all) {
  const rate = x => x.sent ? x.replied / x.sent : 0;
  const list = rows.filter(x => all || x.sent >= 5).sort((a, b) => rate(b) - rate(a));
  const hidden = rows.length - list.length;
  return `<section class="card"><header><h2>Reply rate by source</h2>
      ${rows.some(x => x.sent < 5) ? `<label class="check small"><input type="checkbox" data-act="smallSources" ${all ? 'checked' : ''}> Include sources with fewer than 5</label>` : ''}</header>
    ${list.length ? `<div class="bars">${list.map(x => `<div class="bar-row" data-tip="${esc(sourceName(x.name))}: ${x.replied} replies, ${x.interviews} interviews from ${x.sent} sent"><span>${esc(sourceName(x.name))}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(x.replied ? 2 : 0, rate(x) * 100)}%"></span></span><span class="v">${Math.round(rate(x) * 100)}% <span class="muted small">(n=${x.sent})</span></span></div>`).join('')}</div>`
      : '<p class="muted">No source has 5 applications yet.</p>'}
    ${hidden && !all ? `<p class="muted small">${hidden} source${hidden === 1 ? '' : 's'} with fewer than 5 applications hidden: one lucky reply would look like a trend.</p>` : ''}</section>`;
}
let smallSources = false;
async function showResults() {
  const [r, st] = await Promise.all([api(`/api/results${resultsDays ? `?days=${resultsDays}` : ''}`), settingsCache ? Promise.resolve(settingsCache) : api('/api/settings')]);
  const tracks = st.profile.tracks || [];
  const f = r.funnel;
  const rate = (a, b) => b ? `${Math.round(a / b * 100)}%` : '–';
  const steps = [['Postings found', f.found], ['Scored by Claude', f.scored], ['Tailored', f.tailored], ['Applications sent', f.sent], ['Replies', f.replied], ['Interviews', f.interviews], ['Offers', f.offers]];
  const max = Math.max(1, f.found);
  const table = (title, rows, what) => `<section class="card"><header><h2>${esc(title)}</h2></header>
    ${rows.length ? `<table><thead><tr><th>${esc(what)}</th><th class="num">Sent</th><th class="num">Replies</th><th class="num">Interviews</th><th class="num">Offers</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${esc(x.name)}</td><td class="num"><b>${x.sent}</b></td>
      <td class="num">${x.replied} <span class="muted small">${rate(x.replied, x.sent)}</span></td>
      <td class="num">${x.interviews} <span class="muted small">${rate(x.interviews, x.sent)}</span></td>
      <td class="num">${x.offers}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing sent yet.</p>'}</section>`;
  const days = r.per_day || [], maxDay = Math.max(1, ...days.map(d => d.sent)), sentDays = days.reduce((a, d) => a + d.sent, 0);
  const label = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const every = Math.ceil(days.length / 8);
  page(`${jobsHead('insights')}
    <p class="muted flow-about">Which CVs, sources and fit scores turn into replies and interviews. A reply is any answer from the company, a rejection included, but not an automatic “we received it”.</p>
      <nav class="mode" aria-label="Period">${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All']].map(([v, n]) => `<a href="#results" data-act="resultsDays" data-days="${v}" class="${resultsDays === v ? 'on' : ''}">${n}</a>`).join('')}</nav></div>
    ${r.week_words?.length ? `<section class="card week-words"><header><h2>Your week</h2></header>${r.week_words.map(w => `<p>${esc(w)}</p>`).join('')}</section>` : ''}
    <section class="kpis">
      <div class="kpi"><span class="kpi-l">Applications sent</span><span class="kpi-v">${f.sent}</span><span class="kpi-s">of ${f.tailored} tailored</span></div>
      <div class="kpi"><span class="kpi-l">Reply rate</span><span class="kpi-v">${rate(f.replied, f.sent)}</span><span class="kpi-s">${f.replied} repl${f.replied === 1 ? 'y' : 'ies'}</span></div>
      <div class="kpi"><span class="kpi-l">Interview rate</span><span class="kpi-v">${rate(f.interviews, f.sent)}</span><span class="kpi-s">${f.interviews} interview${f.interviews === 1 ? '' : 's'}</span></div>
      <div class="kpi"><span class="kpi-l">Typical wait for a reply</span><span class="kpi-v">${r.days_to_reply == null ? '–' : `${r.days_to_reply} d`}</span><span class="kpi-s">${r.days_to_reply == null ? 'Not enough replies yet' : 'Half of replies came sooner'}</span></div>
    </section>
    <section class="card"><header><h2>Applications per day</h2><span class="muted small">${resultsDays ? `Last ${days.length} days` : 'Last 90 days'} · ${sentDays} sent · ${(sentDays / Math.max(1, days.length)).toFixed(1)} a day</span></header>
      ${sentDays ? `<div class="cols days">${days.map(d => `<div class="col" data-tip="${esc(label(d.day))}: ${d.sent} sent"><span class="c" style="height:${d.sent / maxDay * 100}%"></span></div>`).join('')}</div>
      <div class="col-labels days">${days.map((d, i) => `<span>${i % every === 0 ? esc(label(d.day)) : ''}</span>`).join('')}</div>` : '<p class="muted">No applications sent in this period.</p>'}</section>
    ${sourceRates(r.by_source || [], smallSources)}
    ${overlapCard(r.overlap || [])}
    <section class="card"><header><h2>From posting to offer</h2></header>
      <div class="bars">${steps.map(([n, v], i) => `<div class="bar-row"><span>${esc(n)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(v ? 1 : 0, v / max * 100)}%"></span></span><span class="v">${v}${i && steps[i - 1][1] ? ` <span class="muted small">${Math.round(v / steps[i - 1][1] * 100)}%</span>` : ''}</span></div>`).join('')}</div>
      <p class="muted small">Each percentage is of the step above it.</p></section>
    ${f.sent >= 5 ? `    <div class="grid-2">
      ${table('By CV', r.by_cv, 'CV')}
      ${table('By fit score', r.by_fit, 'Fit score')}
    </div>
    <div class="grid-2">
      ${table('By kind of role', r.by_title || [], 'Role (as your search titles)')}
      ${table('By pay', r.by_pay || [], 'Yearly pay stated')}
    </div>` : '<section class="card"><p class="muted">Breakdowns by CV, source, fit score and pay appear once you\'ve sent 5 applications.</p></section>'}
    ${(r.market_pay || []).length ? `<section class="card"><header><h2>What the roles you find pay</h2><span class="muted small">Every scored posting that states a yearly salary</span></header>
      <table><thead><tr><th>Role</th><th class="num">Postings</th><th class="num">Lowest</th><th class="num">Typical</th><th class="num">Highest</th></tr></thead><tbody>
      ${r.market_pay.map(m => `<tr><td>${esc(m.name)}</td><td class="num">${m.postings}</td><td class="num">${Math.round(m.low / 1000)}K</td><td class="num"><b>${Math.round(m.median / 1000)}K</b></td><td class="num">${Math.round(m.high / 1000)}K</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${(() => {
      const o = overview || {}, c = o.counts || {};
      if (!o.weeks) return '';
      const stages = ['queued', 'ready', 'approved', 'applied', 'interviewing', 'offer', 'rejected', 'no_response'];
      const maxStage = Math.max(1, ...stages.map(x => c[x] || 0));
      const maxWeek = Math.max(1, ...o.weeks.map(w => w.count));
      return `<div class="grid-2">        <section class="card">
          <header><h2>Applications by stage</h2><a class="btn ghost" href="#applications/applied">All applications</a></header>
          <div class="bars">${stages.map(s => `<div class="bar-row"><span>${esc(STAGES[s])}</span><span class="track"><span class="fill" style="display:block;width:${(c[s] || 0) / maxStage * 100}%"></span></span><span class="v">${c[s] || 0}</span></div>`).join('')}</div>
        </section>
        <section class="card">
          <header><h2>Applications sent per week</h2></header>
          ${o.weeks.every(w => !w.count) ? '<p class="muted">Your applications per week show here once you start applying.</p>' : `<div class="cols">${o.weeks.map((w, i) => `<div class="col" data-tip="Week of ${esc(fmtDate(w.week))}: ${w.count} sent">${i === o.weeks.length - 1 || w.count === maxWeek && w.count ? `<span class="cv">${w.count}</span>` : ''}<span class="c" style="height:${w.count / maxWeek * 100}%"></span></div>`).join('')}</div>
          <div class="col-labels">${o.weeks.map(w => `<span>${esc(fmtDate(w.week))}</span>`).join('')}</div>`}
        </section>
</div>`;
    })()}
    ${payHtml(r.pay)}
    <section class="card prep"><header><h2>What's working, and what to change</h2>
      ${r.thinking ? '<span class="muted small"><span class="spin" data-kind="insights"></span>Claude is looking…</span>' : `<button class="btn" data-act="insights">${r.insights ? 'Look again' : 'Ask Claude'}</button>`}</header>
      ${r.insights ? `<p class="muted small">From ${esc(fmtDate(r.insights.at))}. Job Hunt also does this once a month by itself.</p>${mdHtml(r.insights.text)}` : '<p class="muted">Claude reads your results and the applications behind them, and says what is working and what to change: titles, CVs, sources or your fit threshold.</p>'}
    </section>
    <section class="card row" style="justify-content:space-between"><span><b>Your career options</b><br><span class="muted small">${r.career ? `${(r.career.paths || []).length} directions with pay, pros and cons, and Claude's advice. Ask again now and then: it uses what's working above.` : 'Every direction your CVs support, with pay ranges, pros and cons, and Claude\'s advice.'}</span></span><a class="btn" href="#cvs/career">${svg('cvs')}Open Me</a></section>
    ${f.sent && f.sent < 20 ? '<p class="muted small">With only a few applications in a group, its rates can swing a lot. They settle as you send more.</p>' : ''}`);
}

async function showInbox() {
  const { emails } = await api('/api/emails');
  page(`${inboxHead('email', 'Job email Job Hunt has read. Replies are saved as Gmail drafts for you to check and send.',
      `<a class="btn ghost set-btn" href="#settings/inbox">${svg('settings')}Email settings</a>${overview?.setup?.google ? `<button class="btn primary" data-act="run" data-task="inbox">${svg('mail')}Check email now</button>` : '<a class="btn primary" href="#settings/connections">Connect Gmail</a>'}`)}
    <section class="card" style="padding:6px 10px">${emails.length ? `<table><thead><tr><th>Received</th><th>Type</th><th>Email</th><th>Application</th></tr></thead><tbody>
    ${emails.map(m => { const [name, cls] = CATEGORY[m.category] || [m.category, '']; return `<tr>
      <td class="small muted" style="white-space:nowrap">${esc(fmtWhen(m.received_at))}</td>
      <td><span class="pill ${cls}">${esc(name)}</span>${m.draft_id ? '<br><span class="small muted">Draft reply ready</span>' : ''}</td>
      <td><b>${esc(m.subject)}</b><br><span class="small muted">${esc(m.sender)}</span><p class="small" style="margin-top:4px">${esc(m.summary)}</p></td>
      <td class="small">${m.job_id ? `<a href="#job/${encodeURIComponent(m.job_id)}">${esc(m.company)} – ${esc(m.title)}</a>` : ''}</td></tr>`; }).join('')}
    </tbody></table>` : `<p class="empty">${overview?.setup?.google ? 'No job email yet.' : 'Connect Google and Job Hunt sorts your job email by itself. <a href="#settings/connections">Connect Google</a>'}</p>`}</section>`);
}

// ---- Add a job ----
function showAdd() {
  const noCv = overview && !overview.setup?.cvs;
  // Without Claude connected (or a CV to compare with) the posting is saved as it is.
  const canClaude = !!(overview?.setup?.claude && overview?.setup?.cvs);
  page(`<div class="head"><div class="grow"><div class="eyebrow"><a href="#applications">Jobs</a> / Add a job</div><h1>Add a job you found</h1><p class="muted">For roles on LinkedIn, company sites or from referrals. Paste the link to fill this in, then have it scored and tailored, or just save it to track.</p></div></div>
    ${noCv ? '<section class="card"><p>No CV yet, so a job you add here is saved without a score. Add your CV and Job Hunt can score it and tailor your CV for it.</p><div class="row"><a class="btn" href="#cvs">Add your CV</a></div></section>' : ''}
    <form class="card" data-form="add"><div class="form">
      <div class="field wide">Posting link<div class="row" style="flex-wrap:nowrap"><input type="url" name="url" placeholder="https://" style="flex:1"><button class="btn" type="button" data-act="fillFromLink">Fill in from link</button></div>
        <span class="hint">Reads the posting from its page (LinkedIn and most company job sites), without using Claude.</span></div>
      <label class="field">Company<input type="text" name="company" required></label>
      <label class="field">Job title<input type="text" name="title" required></label>
      <label class="field">Location<input type="text" name="location"></label>
      <label class="field wide">Full job description<textarea name="description" style="min-height:300px" placeholder="Needed to score and tailor; optional if you only save it."></textarea></label>
      <div class="field wide">What to do with it
        <label class="check"><input type="radio" name="claude" value="1" ${canClaude ? 'checked' : 'disabled'}> <span>Score it and tailor my CV and a cover letter<br><span class="muted small">${canClaude ? 'Uses Claude: two or three requests.' : 'Needs Claude connected and your CV added.'}</span></span></label>
        <label class="check"><input type="radio" name="claude" value="0" ${canClaude ? '' : 'checked'}> <span>Just save it, without Claude<br><span class="muted small">Saved in Pipeline. Use Tailor anyway on it whenever you like.</span></span></label>
      </div>
    </div><div class="row"><button class="btn primary" type="submit">Add the job</button></div></form>
    <p class="muted small desktop-only">Used the <a href="#search/setup">Send to Job Hunt</a> button? Press Ctrl+V on this page to add that posting.</p>`);
}

// A posting from the Send to Job Hunt button, pasted on the Add a job page.
document.addEventListener('paste', async e => {
  if (location.hash !== '#add') return;
  const text = e.clipboardData?.getData('text') || '';
  if (!text.startsWith('JOBHUNT-CLIP:')) return;
  e.preventDefault();
  try {
    await api('/api/clip', { method: 'POST', raw: text });
    toast('Adding it now. Once it\'s scored it\'s in your Queue to pick; you get a notification.');
    location.hash = '#overview';
  } catch (err) { toast(err.message, true); }
});

/** This device's time zone, like "Europe/London". */
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
/** A time-zone dropdown (every zone the browser knows), or a text box where it knows none. */
function tzSelect(name, value) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch {}
  if (!zones.length) return `<input type="text" name="${name}" value="${esc(value)}" placeholder="Like Europe/London">`;
  if (value && !zones.includes(value)) zones = [value, ...zones];
  return `<select name="${name}">${zones.map(z => `<option value="${esc(z)}" ${z === value ? 'selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('')}</select>`;
}
/** The likely country from a time zone, for the first run ("" when it isn't one Job Hunt knows). */
const tzCountry = (tz, countries) => (countries || []).find(c => c.tz.includes(tz))?.code || '';
/** Places you pick, as chips: your country's popular cities one click away, and a box for any other place.
 *  A hidden textarea (`name`) keeps the list, one per line, so forms read it as before. */
function placePicker(name, values, country) {
  const c = (settingsCache?.countries || []).find(x => x.code === country);
  const picked = values || [];
  const has = x => picked.some(p => p.toLowerCase() === x.toLowerCase());
  const more = (c?.cities || []).filter(x => !has(x));
  return `<div class="places" data-places="${name}" data-country="${esc(country)}">
    <textarea name="${name}" hidden>${esc(lines(picked))}</textarea>
    <div class="chips">${picked.map(x => `<button type="button" class="chip on" data-act="placeDrop" data-place="${esc(x)}" title="Remove">${esc(x)} ${svg('close')}</button>`).join('') || '<span class="muted small">None yet: anywhere in the country.</span>'}</div>
    <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input type="text" class="place-input" list="cities-${name}" placeholder="Type a city or area" style="flex:1"><datalist id="cities-${name}">${(c?.cities || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist><button type="button" class="btn sm" data-act="placeAdd">Add</button></div>
    ${more.length ? `<div class="small muted" style="margin-top:8px">Popular in ${esc(c.name)}:</div><div class="chips">${more.map(x => `<button type="button" class="chip" data-act="placePick" data-place="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>` : ''}
  </div>`;
}
/** Change a place picker's list, draw it again, and let its form know (so it saves). */
function placesSet(box, list, country) {
  const name = box.dataset.places;
  box.outerHTML = placePicker(name, list, country || box.dataset.country);
  const ta = document.querySelector(`[data-places="${name}"] textarea`);
  ta?.dispatchEvent(new Event('input', { bubbles: true }));
  return ta;
}
const placesOf = box => fromLines(box.querySelector('textarea').value);

/** A country dropdown from the core's list. */
const countrySelect = (name, value, countries) => `<select name="${name}">${(countries || []).map(c => `<option value="${c.code}" ${c.code === value ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;

/** An hour of the day as a dropdown: "9 AM", "5 PM" (24 is midnight, the end of the day). */
function hourSelect(name, value, from = 0, to = 23) {
  const label = h => h === 0 || h === 24 ? 'Midnight' : h === 12 ? 'Noon' : `${h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return `<select name="${name}">${hours.map(h => `<option value="${h}" ${Number(value) === h ? 'selected' : ''}>${label(h)}</option>`).join('')}</select>`;
}

// ---- Settings ----
const lines = v => (v || []).join('\n');
const fromLines = s => s.split(/\n|,/).map(x => x.trim()).filter(Boolean);
let settingsCache = null;

/** Your answers to the questions application forms keep asking, learned as you submit forms, and
 *  whether Job Hunt may submit simple forms for you. */
async function renderBank() {
  const box = $('#bankCard'); if (!box) return;
  let b;
  try { b = await api('/api/answer-bank'); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<header><h2>Your saved answers</h2>${b.answers.length ? `<span class="pill">${b.answers.length}</span>` : ''}</header>
    <p class="muted">When you submit a form, Job Hunt keeps your answers to the questions forms keep asking (work authorization, notice period, salary, how you heard about the job…) and fills them in next time without asking Claude: faster, the same answer everywhere, and less of your plan. Answers about one employer (why this role, your cover letter) aren't kept.</p>
    ${b.answers.length ? `<div class="bank">${b.answers.map((x, i) => `<div class="bank-row" data-i="${i}"><input type="text" class="bank-q" value="${esc(x.q)}" aria-label="Question"><input type="text" class="bank-a" value="${esc(x.a)}" aria-label="Your answer"><span class="muted small" title="Times used">${x.uses ? `used ${x.uses}×` : ''}</span><button class="btn ghost sm icon-only" data-act="bankDrop" data-i="${i}" title="Forget this answer">${svg('close')}</button></div>`).join('')}</div>` : '<p class="empty small">None yet: they appear after your first form.</p>'}
    <div class="row"><button class="btn" data-act="bankAdd">Add one</button>${b.answers.length ? '<button class="btn primary" data-act="bankSave">Save changes</button>' : ''}</div>
    <h3 class="sub">Submitting for you</h3>
    <label class="check"><input type="checkbox" data-act="autoSubmit" ${b.auto_submit ? 'checked' : ''}> <span>Submit simple forms for me<br><span class="muted small">Only on Greenhouse, Lever and Ashby forms, and only when every required question is answered from your saved answers, facts and files, nothing long was written for this job, there's no captcha and no box left for you to tick. It counts down 10 seconds first, with a Stop button. Anything else waits for you to press Submit.</span></span></label>`;
}
const bankRows = () => [...document.querySelectorAll('#bankCard .bank-row')].map(r => ({ q: r.querySelector('.bank-q').value, a: r.querySelector('.bank-a').value }));

/** The browser extension, in Settings → App: what it does, the download, the key to paste into it,
 *  the steps for Edge (and Chrome), and whether it has reached Job Hunt yet. */
function extensionCard(st) {
  const browser = st.app.browser === 'chrome' ? 'Chrome' : 'Edge';
  const page = browser === 'Chrome' ? 'chrome://extensions' : 'edge://extensions';
  return `<section class="card" id="extCard"><header><h2>Browser extension</h2>${st.ext_last ? `<span class="pill good" title="Last reached Job Hunt ${esc(ago(st.ext_last))}">Connected</span>` : '<span class="pill">Not connected yet</span>'}</header>
    <p class="muted"><b>Send to Job Hunt</b> in ${browser}: send a posting you're looking at to Job Hunt, and fill in application forms in your own browser, with your sign-ins and password manager, from your tailored CV and letter.</p>
    <label class="field" style="max-width:420px">Open links in<select data-act="browserPick">${[['', "Windows' default browser"], ['edge', 'Microsoft Edge'], ['chrome', 'Google Chrome']].map(([v, n]) => `<option value="${v}" ${(st.app.browser || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Postings, company sites, and Fill it in my own browser open there.</span></label>
    <ol class="small steps-list">
      <li>Job Hunt keeps the extension in this folder, and updates it with each new version: <span class="copy-row" style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><code id="extDir">${esc(st.ext_folder || '')}</code><button class="btn ghost sm" data-act="copy" data-from="extDir">Copy</button><button class="btn ghost sm" data-act="folder" data-which="extension">Open the folder</button></span></li>
      <li>In ${browser}, open <code>${page}</code>, turn on <b>Developer mode</b>${browser === 'Edge' ? ' (at the bottom of the left side)' : ' (top right)'}, press <b>Load unpacked</b> and choose that folder (paste it into the folder box). Had it from a download before? Remove that copy first, so there's only one.</li>
      <li>Pin it: the puzzle-piece icon by the address bar → the eye or pin next to <b>Send to Job Hunt</b>.</li>
      ${st.ext_key ? `<li>Click it once and paste this key, then press <b>Save the key</b>: <span class="copy-row" style="display:inline-flex;gap:6px;align-items:center"><code id="extKey2">${esc(st.ext_key)}</code><button class="btn ghost sm" data-act="copy" data-from="extKey2">Copy</button></span></li>` : ''}
    </ol>
    <p class="muted small">Then on any application form, click it and press <b>Fill this form</b>; on a posting, <b>Send this job to Job Hunt</b>. Job Hunt needs to be running on this PC. It updates itself: after Job Hunt updates, the extension reloads with the new version when you next open it or start ${browser}. For another PC or browser profile, <a href="/api/extension.zip" download>download it</a> instead (that copy doesn't update itself).</p></section>`;
}

/** After Install and restart, from your phone (or a browser): Job Hunt on the PC goes away for a
 *  moment while it installs and restarts; this page reloads once it's back on the new version. */
async function waitForRestart(before) {
  if (!before) return;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (!r.ok) continue;
      const v = (await r.json())?.app?.version || '';
      if (v && v !== before) { location.reload(); return; }
    } catch (e) { /* restarting */ }
  }
  toast('Job Hunt hasn\'t come back yet. Check the PC: it may still be installing.', true);
}

/** Services that work the way OpenAI's API does: name, address ('' for one you type), and where its key comes from. */
const OTHER_AI = [['Grok (xAI)', 'https://api.x.ai/v1', 'console.x.ai'], ['ChatGPT (OpenAI)', 'https://api.openai.com/v1', 'platform.openai.com'], ['Gemini (Google)', 'https://generativelanguage.googleapis.com/v1beta/openai', 'aistudio.google.com'],
  ['OpenRouter (many models, one key)', 'https://openrouter.ai/api/v1', 'openrouter.ai'], ['On this PC (Ollama, no key)', 'http://localhost:11434/v1', ''], ['Another one', '', '']];
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches?.('form[data-form=other] [name=service]')) {
    const form = t.form, known = OTHER_AI.find(x => x[1] === t.value);
    form.querySelector('[data-other-url]').hidden = !!t.value;
    form.querySelector('[data-other-keyhint]').textContent = known?.[2] ? `Create one at ${known[2]}.` : t.value ? 'None needed.' : '';
    form.elements.model.innerHTML = '<option value="">Press Check to see its models</option>';
  }
  if (t.matches?.('[name=searches_per_day]')) { const s = t.form?.querySelector('[data-second-search]'); if (s) s.hidden = t.value !== '2'; }
});
/** Which model does what, in a line: from the Claude settings ({engine, model, tailor_model, score_model}). */
function modelsLine(c) {
  const api = c.engine === 'api';
  const name = m => {
    const k = (m || '').trim().toLowerCase();
    if (k === 'opus' || k === 'claude-opus-5-5') return api ? 'Opus 5.5' : 'Opus';
    if (k === 'sonnet' || k === 'claude-sonnet-5-5') return api ? 'Sonnet 5.5' : 'Sonnet';
    return k ? m.trim() : api ? 'Opus 5.5' : "Claude Code's default";
  };
  const other = name(c.model);
  const pick = m => (m || '').trim() ? name(m) : other;
  return `Searching, scoring and filling in forms: <b>${esc(pick(c.score_model))}</b> · CVs and cover letters: <b>${esc(pick(c.tailor_model))}</b> · Everything else (email, interview prep): <b>${esc(other)}</b>.`;
}

/** host: the Search page's top, for its What to search and Set up sources tabs (Settings' Search and Job sources, moved there). */
async function showSettings(tab, sub, host) {
  // Older links: Extras went to App; Schedule became Email & calendar.
  tab = { extras: 'app', schedule: 'calendar', preferences: 'search' }[tab] || tab;
  const st = settingsCache = await api('/api/settings');
  const p = st.profile;
  const tabs = SETTINGS_TABS;
  let body = '';
  if (tab === 'connections') {
    body = `<section class="card attention" id="connStatus" hidden></section>
    <section class="card" id="claudeCard"><header><h2>Claude</h2><span id="ccPill">${st.claude.engine === 'api' ? (st.claude.key ? '<span class="pill good">API key saved</span>' : '<span class="pill warn">Needed</span>') : (st.claude.code_found ? '<span class="pill">Checking…</span>' : '<span class="pill warn">Not found</span>')}</span></header>
      <p class="muted">Claude is the AI that reads job postings, picks the ones that fit you, rewrites your CV and cover letter for each, and sorts your job email.</p>
      <form data-form="claude" class="stack" style="gap:14px">
        <label class="check"><input type="radio" name="engine" value="code" ${st.claude.engine !== 'api' ? 'checked' : ''}> <span><b>Your Claude subscription</b> <span class="muted">(recommended)</span><br><span class="muted small">Your Claude Pro or Max plan, through Claude Code, a free helper from Anthropic that Job Hunt can install for you. Nothing extra to pay; each search uses some of your plan's usage.</span></span></label>
        <div id="ccStatus" class="small muted" style="margin-left:26px" ${st.claude.engine === 'api' ? 'hidden' : ''}><span class="spin" data-kind="check" data-secs="6"></span> Checking…</div>
        <label class="check"><input type="radio" name="engine" value="api" ${st.claude.engine === 'api' ? 'checked' : ''}> <span><b>An API key instead</b><br><span class="muted small">For people without a Claude subscription: you pay Anthropic for what you use. Create a key at <a href="#" data-act="link" data-url="https://console.anthropic.com/settings/keys">console.anthropic.com</a>.</span></span></label>
        <label class="field" id="apiKeyField" style="margin-left:26px;max-width:420px" ${st.claude.engine === 'api' ? '' : 'hidden'}>API key<input type="password" name="claude_key" autocomplete="off" placeholder="${st.claude.key ? 'Saved. Paste a new one to replace it' : 'sk-ant-…'}"></label>
        <p class="small muted" id="modelsLine">${modelsLine(st.claude)}</p>
        <details ${st.claude.model || st.claude.path ? 'open' : ''}><summary class="small muted">Advanced: which models</summary>
        <h3 class="sub">Tailoring CVs and cover letters</h3>
        <div class="form">
          <label class="field">Model<select name="tailor_model">${[['opus', 'Opus (best writing)'], ['sonnet', 'Sonnet (faster, uses less of your plan)'], ['', 'Same as for everything else']].map(([v, n]) => `<option value="${v}" ${st.claude.tailor_model === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">How hard Claude thinks<select name="tailor_effort">${[['low', 'Low (fastest)'], ['medium', 'Medium (recommended)'], ['high', 'High (slowest, a few minutes each)']].map(([v, n]) => `<option value="${v}" ${st.claude.tailor_effort === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <h3 class="sub">Searching</h3>
        <div class="form">
          <label class="field">Model<select name="score_model">${[['sonnet', 'Sonnet (recommended: nearly the same scores, much less of your plan)'], ['opus', 'Opus'], ['', 'Same as for everything else']].map(([v, n]) => `<option value="${v}" ${st.claude.score_model === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Scoring each new posting, reading posting pages, Indeed, salaries and company ratings: most of what Job Hunt asks of Claude.</span></label>
          <label class="field">Postings scored in one request<select name="score_batch">${[[4, 'Four (recommended: your CVs are sent once for the four)'], [6, 'Six (least usage)'], [2, 'Two'], [1, 'One (most usage)']].map(([v, n]) => `<option value="${v}" ${(st.score_batch || 4) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Each request carries your CVs and the scoring instructions. Scoring several postings in one sends those once, which is most of what a search uses.</span></label>
        </div>
        <div class="form" style="margin-top:10px">
          <label class="field">Model for everything else<input type="text" name="model" value="${esc(st.claude.model)}" placeholder="Default"><span class="hint">Email sorting and the rest. Blank: Claude Code's own choice, or Opus for the API.</span></label>
          <label class="field">Claude Code location<input type="text" name="path" value="${esc(st.claude.path)}" placeholder="C:\\Users\\you\\.local\\bin\\claude.exe"><span class="hint">Only if Job Hunt can't find it.</span></label>
        </div></details>
        <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="checkClaude">Check again</button>${st.claude.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="claude">Remove API key</button>' : ''}</div>
      </form></section>
    <section class="card" id="otherCard"><header><h2>Another AI</h2>${st.other.for ? `<span class="pill good">${st.other.for === 'all' ? 'Used for everything' : 'Used for searching'}</span>` : '<span class="pill">Optional</span>'}</header>
      <p class="muted">Grok, ChatGPT, Gemini or a model on your own PC can do some of the work in Claude's place, so a search uses none of your Claude plan. You pay that service for what you use (a model on your PC is free).</p>
      <form data-form="other" class="stack" style="gap:14px">
        <div class="form">
          <label class="field">Use it for<select name="for">${[['', 'Nothing: Claude does everything'], ['search', 'Searching: scoring postings, titles, salaries, job alerts (most of the usage)'], ['all', 'Everything, CVs and cover letters included']].map(([v, n]) => `<option value="${v}" ${st.other.for === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">Service<select name="service">${OTHER_AI.map(([n, u]) => `<option value="${esc(u)}" ${u && st.other.url === u ? 'selected' : ''} ${!u && st.other.url && !OTHER_AI.some(x => x[1] === st.other.url) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field" data-other-url ${st.other.url && !OTHER_AI.some(x => x[1] === st.other.url) ? '' : 'hidden'}>Its address<input type="url" name="url" value="${esc(st.other.url || OTHER_AI[0][1])}" placeholder="https://…/v1"><span class="hint">Any service that works the way OpenAI's API does: the address up to and including /v1.</span></label>
          <label class="field">Key<input type="password" name="key" autocomplete="off" placeholder="${st.other.key ? 'Saved. Paste a new one to replace it' : 'From the service\'s website'}"><span class="hint" data-other-keyhint></span></label>
          <label class="field">Model<span class="row" style="flex-wrap:nowrap"><select name="model" style="flex:1">${st.other.model ? `<option selected>${esc(st.other.model)}</option>` : '<option value="">Press Check to see its models</option>'}</select><button class="btn sm" type="button" data-act="otherModels">Check</button></span><span class="hint">Check tests the address and key and lists the models; nothing is used.</span></label>
        </div>
        <p class="small muted">Looking things up on the web stays with Claude through your subscription: Indeed, company ratings, a company's own application page and finding recruiters. Without Claude those are skipped. Scores from another AI can differ from Claude's by a few points, so matches near your fit score may fall on the other side of it.</p>
        <div class="row"><button class="btn primary" type="submit">Save</button>${st.other.url ? '<button class="btn ghost" type="button" data-act="otherForget">Remove it</button>' : ''}</div>
      </form></section>
    <section class="card" id="googleCard"><header><h2>Gmail, Google Calendar and Drive</h2>${st.google.connected ? `<span class="pill good">Connected${st.google.email ? ` · ${esc(st.google.email)}` : ''}</span>` : '<span class="pill">Optional</span>'}</header>
      <p class="muted">Job Hunt sorts your job email, drafts replies, books interviews in your calendar and keeps a private copy of your data in your own Drive. Everything stays in your Google account.</p>
      ${st.google.connected && !st.sync.on && st.sync.drive_ready ? `<div class="advice"><b>Back up and sync to your Google Drive</b><p>Keeps everything in a private "Job Hunt" folder in your Drive, so you can install Job Hunt on any PC and pick up where you left off.</p><div class="row"><button class="btn primary" data-act="syncOn">Turn on</button></div></div>` : ''}
      ${st.google.connected ? `<div class="row">
          <button class="btn" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connecting ? '<span class="spin" data-kind="google" data-secs="90"></span>Waiting for Google…' : 'Reconnect Google'}</button>
          <button class="btn ghost" data-act="forget" data-what="google">Disconnect</button></div>`
      : st.google.client ? `<ol class="steps-list">
          <li>Press <b>Connect Google</b>. Your browser opens: sign in with your Gmail account.</li>
          <li>Google says it <b>hasn't verified</b> Job Hunt (it's a small app, not one Google has reviewed). Click <b>Advanced</b>, then <b>Go to Job Hunt</b>.</li>
          <li><b>Tick every box</b> and press <b>Continue</b>. Then come back here: Job Hunt finishes by itself.</li></ol>
        <div class="row"><button class="btn primary" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connecting ? '<span class="spin" data-kind="google" data-secs="90"></span>Waiting for Google… finish in your browser' : 'Connect Google'}</button></div>
        <p class="muted small">If Google says you don't have access, ask whoever gave you Job Hunt to add your Gmail address, then try again.</p>`
      : `<div class="advice"><b>One thing first: a Google connection file</b><p>This copy of Job Hunt doesn't have Google's connection built in. Whoever gave you Job Hunt can send you its connection file (a small file ending in <b>.json</b>). Save it, then choose it here; after that, it's one button.</p></div>
        <div class="row"><label class="btn primary">Choose the connection file<input type="file" accept=".json" data-upload="google-client" hidden></label></div>`}
      <details class="small" style="margin-top:10px"><summary class="muted">${st.google.own_client ? 'Your own connection file is in use' : 'Make your own connection file (technical, about 15 minutes)'}</summary>
        <ol class="steps-list" style="margin-top:6px">
          <li>At <a href="#" data-act="link" data-url="https://console.cloud.google.com">console.cloud.google.com</a>, create a project and enable the <b>Gmail API</b>, the <b>Google Calendar API</b> and the <b>Google Drive API</b>.</li>
          <li>Under Google Auth Platform → Audience, choose <b>External</b>, then <b>Publish app</b> (In production), or Google signs you out every 7 days.</li>
          <li>Under Clients, create a client of type <b>Desktop app</b> and download its JSON file. That's the connection file: you can give the same file to friends.</li>
          <li>Choose it here, then press Connect Google.</li>
        </ol>
        <div class="row"><label class="btn">${st.google.own_client ? 'Replace the connection file' : 'Choose a connection file'}<input type="file" accept=".json" data-upload="google-client" hidden></label>${st.google.own_client ? '<button class="btn ghost" data-act="forget" data-what="google">Remove it</button>' : ''}</div>
      </details>
      <div id="googlePaste" ${st.google.pasting ? '' : 'hidden'}>${googlePasteBox(st.google.paste_url)}</div></section>
    <section class="card" id="usageCard"><p class="muted small"><span class="spin" data-kind="load" data-secs="3"></span> Loading…</p></section>
    <p class="muted small">Looking for LinkedIn, Google for Jobs or recruiters? They're in <a href="#search/setup">Search → Set up sources</a>.</p>`;
  } else if (tab === 'sources') {
    const desk = st.kind !== 'server' && !st.remote.here;
    const tile = (id, name, tag, about, more = '', open = false) => `<article class="tile" data-tile="${id}" id="tile-${id}">
      <header><b>${name}</b>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="tile-state"></span></header>
      <p class="small muted">${about}</p><p class="small tile-detail"></p>
      <div class="row tile-acts"></div>${more ? `<details ${open ? 'open' : ''}>${more}</details>` : ''}</article>`;
    const keyNote = (site, url) => `<p class="small">Get a key at <a href="#" data-act="link" data-url="${url}">${site}</a>, paste it here and press Save.</p>`;
    body = `<section class="card"><header><h2>Where Job Hunt looks</h2><button class="btn" data-act="testSources">Check them all</button></header>
      <p class="muted">Turn on the places you'd like searched. The free ones need nothing else; a few need a free key from their own website, pasted in once. Every search looks for the job titles from your CVs, in your locations. To search one on its own and see what each found, use the <a href="#search">Sources</a> tab.</p>
      <div id="sourceTest"></div></section>
    <div class="tiles">
      ${tile('boards', 'Company job boards', 'Free', 'Job Hunt finds employers near you and searches their own careers pages. Nothing to set up.',
        `<summary class="small">Choose companies yourself</summary><form data-form="profile" data-part="boards" class="stack" style="gap:10px;margin-top:8px">
          <label class="check"><input type="checkbox" name="auto_boards" ${p.sources.auto_boards !== false ? 'checked' : ''}> <span>Find employers near me by itself<br><span class="muted small">Every week, and when a search finds little that's new.</span></span></label>
          <div class="row"><button class="btn sm" type="button" data-act="suggestBoards">Suggest companies</button></div><div id="boardIdeas" class="ideas"></div>
          <div class="field">Add a company by its careers link<div class="row" style="flex-wrap:nowrap"><input type="url" id="boardLink" placeholder="https://www.affirm.com/careers" style="flex:1"><button class="btn" type="button" data-act="addBoardLink">Add</button></div>
            <span class="hint">Its careers page or any of its job postings. Job Hunt works out which job board it uses (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable or BambooHR).</span></div>
          <p class="muted small">Or type the name at the end of its careers link, like boards.greenhouse.io/<b>name</b> or jobs.lever.co/<b>name</b>. For Workday, paste the whole link.</p>
        <div class="form">
          <label class="field">Greenhouse<textarea name="greenhouse">${esc(lines(p.sources.greenhouse))}</textarea></label>
          <label class="field">Lever<textarea name="lever">${esc(lines(p.sources.lever))}</textarea></label>
          <label class="field">Ashby<textarea name="ashby">${esc(lines(p.sources.ashby))}</textarea></label>
          <label class="field">Workday<textarea name="workday" placeholder="https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1">${esc(lines(p.sources.workday))}</textarea><span class="hint">Careers links, one per line. Searched for your job titles.</span></label>
          <label class="field">SmartRecruiters<textarea name="smartrecruiters">${esc(lines(p.sources.smartrecruiters))}</textarea></label>
          <label class="field">Workable<textarea name="workable">${esc(lines(p.sources.workable))}</textarea></label>
          <label class="field">BambooHR<textarea name="bamboohr" placeholder="acme">${esc(lines(p.sources.bamboohr))}</textarea><span class="hint">The name before .bamboohr.com in the careers link.</span></label>
        </div>
        </form>`)}
      ${tile('linkedin', 'LinkedIn', 'Free', "LinkedIn's public job search, the one anyone sees without signing in. It never touches your LinkedIn account. A few searches a day.",
        `<summary class="small">Steadier, through Apify (paid per result)</summary><form data-form="apify" class="form tile-form">
            <p class="small">With an Apify token, Job Hunt runs a LinkedIn jobs scraper on <a href="#" data-act="link" data-url="https://apify.com/store?search=linkedin%20jobs">Apify</a> instead, once per search. It gets past LinkedIn's limits and returns full descriptions. Apify's free plan includes a small monthly credit; after that you pay per result (check their prices). Sign up, then copy your token from Settings → API &amp; Integrations.</p>
            <label class="field">Apify token<input type="password" name="apify_key" autocomplete="off" placeholder="${st.apify.key ? 'Saved. Paste a new one to replace it' : 'apify_api_…'}"></label>
            <label class="field">Scraper<input type="text" name="apify_actor" value="${esc(st.apify.actor)}" placeholder="${esc(st.apify.default_actor)}"><span class="hint">Blank uses ${esc(st.apify.default_actor)}. Another LinkedIn jobs scraper from the Apify Store works too, as user/name.</span></label>
            <div class="row"><button class="btn primary" type="submit">Save</button>${st.apify.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="apify">Remove</button>' : ''}</div>
          </form>`, !!st.apify.key)}
      ${p.sources.adzuna_country === 'ca' ? tile('jobbank', 'Job Bank', 'Free · Canada', "Canada's national job board, including postings found only there.") : ''}
      ${tile('freehire', 'FreeHire', 'Free', "A free job search gathered from employers' own careers sites, with each posting's full text.")}
      ${tile('alerts', 'Job-alert emails', 'Free', 'Set up job alerts on LinkedIn, Indeed, Job Bank, recruiters like Randstad, Adecco, Hays and Robert Half, or your country\'s job sites, sent to your Gmail, and Job Hunt reads them on every email check. Needs Gmail connected.')}
      ${tile('jsearch', 'Google for Jobs', 'Free key', 'The widest reach: LinkedIn, Indeed, Glassdoor and company sites, with full descriptions. Free for about 6 searches a day.',
        `<summary class="small">${st.jsearch.key ? 'Change the key' : 'Add a key'}</summary>${keyNote('OpenWeb Ninja', 'https://www.openwebninja.com/api/jsearch')}<form data-form="jsearch" class="form tile-form">
          
          
          <label class="field">Key from<select name="jsearch_provider"><option value="openwebninja" ${st.jsearch.provider !== 'rapidapi' ? 'selected' : ''}>OpenWeb Ninja</option><option value="rapidapi" ${st.jsearch.provider === 'rapidapi' ? 'selected' : ''}>RapidAPI</option></select></label>
          <label class="field">Key<input type="password" name="jsearch_key" autocomplete="off" placeholder="${st.jsearch.key ? 'Saved. Paste a new one to replace it' : ''}"></label>
          <div class="row"><button class="btn primary" type="submit">Save</button>${st.jsearch.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="jsearch">Remove</button>' : ''}</div>
        </form>`, !st.jsearch.key)}
      ${tile('jooble', 'Jooble', 'Free key', 'Listings gathered from many job sites. It shows only part of each posting, so its scores are rougher.',
        `<summary class="small">${st.jooble.key ? 'Change the key' : 'Add a key'}</summary>${keyNote('jooble.org/api', 'https://jooble.org/api/about')}<form data-form="jooble" class="form tile-form">
          
          
          <label class="field">Key<input type="password" name="jooble_key" autocomplete="off" placeholder="${st.jooble.key ? 'Saved. Paste a new one to replace it' : ''}"></label>
          <div class="row"><button class="btn primary" type="submit">Save</button>${st.jooble.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="jooble">Remove</button>' : ''}</div>
        </form>`)}
      ${tile('adzuna', 'Adzuna', 'Free key', 'A job search engine with listings from many sites.',
        `<summary class="small">${st.adzuna.key ? 'Change the key' : 'Add a key'}</summary>${keyNote('developer.adzuna.com', 'https://developer.adzuna.com')}<form data-form="adzuna" class="form tile-form">
          
          
          <label class="field">App ID<input type="text" name="adzuna_id" value="${esc(st.adzuna.id)}"></label>
          <label class="field">App key<input type="password" name="adzuna_key" autocomplete="off" placeholder="${st.adzuna.key ? 'Saved' : ''}"></label>
          <div class="row"><button class="btn" type="submit">Save</button>${st.adzuna.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="adzuna">Remove</button>' : ''}</div>
        </form>`)}
      ${tile('indeed', 'Indeed', 'Uses your Claude plan', 'Searched through the Indeed connector on your Claude account: connect Indeed once at claude.ai → Settings → Connectors, then turn this on.')}
      ${tile('agencies', 'Recruiters and job sites', 'Free', (st.sites?.catalog || []).some(x => x.country === p.sources.adzuna_country) ? 'Recruitment agencies and job sites in your country: choose which ones, or add any other site.' : `Add any job site you use in ${esc(st.countries?.find(c => c.code === p.sources.adzuna_country)?.name || 'your country')}: search on it, copy the address, and paste it in.`,
        `<summary class="small">Choose recruiters and sites</summary>${sitesForm(st)}`)}
    </div>
    <section class="card" id="clipCard"><header><h2>Jobs you find yourself</h2>${desk ? `<span class="pill ${st.clip_watch ? 'good' : ''}">${st.clip_watch ? 'Button on' : 'Button off'}</span>` : ''}</header>
      <p class="muted">Found a role on LinkedIn, a company site or anywhere else? ${desk ? 'Add a <b>Send to Job Hunt</b> button to your browser: on the posting, click it, and Job Hunt adds the job, scores it and puts it in your Queue to pick. Or' : ''} paste it on the <a href="#add">Add a job</a> page.</p>
      ${desk ? `<div class="row"><button class="btn primary" data-act="bookmarkSetup"><img src="/static/logo.svg" alt="" width="16" height="16">Set up the button</button><span class="muted small">Opens a page in your browser that walks you through it, so the button gets the Job Hunt logo.</span></div>
      <p class="small">Or use the <b>browser extension</b> (Chrome or Edge), which also fills in application forms: <a class="btn sm" href="#settings/extension">Set up the extension</a></p>
      <details class="small"><summary class="muted">Or add it yourself</summary><ol class="small steps-list">
        <li><button class="btn sm" data-act="copyBookmarklet">Copy the button</button>, or drag <a class="btn sm bookmarklet" href="${esc(bookmarklet())}" draggable="true" onclick="return false" title="Drag this onto your browser's bookmarks bar">${BOOKMARK_NAME}</a> to your bookmarks bar.</li>
        <li>In your browser (Chrome or Edge), show the bookmarks bar with <b>Ctrl+Shift+B</b>, right-click it → <b>Add page</b> (Edge: <b>Add favorite</b>). Name it <b>${BOOKMARK_NAME}</b>, paste into the address (URL) box, and save. Added this way it has no logo.</li></ol></details>
      <ol class="small steps-list">
        <li>Open a job posting and click the bookmark. On LinkedIn, click the job in the list so it shows on the right (or open the job itself), then click it.</li>
        <li>Job Hunt picks it up within a few seconds and tells you when it's ready. Added it before version 1.44? Add it again: the old one didn't work on LinkedIn.</li></ol>
      <label class="check"><input type="checkbox" data-act="clipWatch" ${st.clip_watch ? 'checked' : ''}> <span class="small">Pick up postings sent from the browser</span></label>` : '<div class="row"><a class="btn" href="#add">Add a job</a></div>'}
    </section>`;
  } else if (tab === 'cvs') {
    const kindName = { docx: 'Word', pdf: 'Converted from PDF', text: 'Converted from text', 'docx-converted': 'Converted to Job Hunt layout' };
    body = `<section class="card"><header><h2>Your CVs</h2><button class="btn ghost" data-act="folder" data-which="cv">${svg('folder')}Open folder</button></header>
      <p class="muted">Add as many CVs as you like, one for each kind of role. Every posting is scored against all of them and tailored from the best match.</p>
      <details class="more"><summary class="small muted">What Job Hunt changes in a CV</summary><p class="muted small">Word files are edited in place, so your formatting stays. PDF and text CVs are converted, word for word, into a clean Word copy first. Only your headline, summary, skills and bullet points are ever reworded, and an edit that adds a figure your CV doesn't state is refused.</p></details>
      <label class="drop" id="drop"><input type="file" accept=".docx,.pdf,.txt" multiple data-upload="cv-add" hidden>
        <b>Add CVs</b><span class="muted small">Drop Word, PDF or text files here, or click to choose. Claude reads each one and suggests the job titles to search for.</span></label>
    </section>
    ${st.cvs.map(c => `<section class="card" data-cv="${esc(c.track)}">
      <header><h2>${esc(c.label)}</h2><span class="pill ${c.exists ? (c.editable ? 'good' : 'warn') : 'crit'}">${c.exists ? (c.editable ? `${c.editable} parts can be tailored` : 'Layout can\'t be tailored') : 'File missing'}</span></header>
      <p class="muted small">${esc(kindName[c.kind] || 'Word')}${c.original ? ` · ${esc(c.original)}` : ''}${c.updated ? ` · updated ${esc(fmtDate(c.updated))}` : ''}</p>
      ${(c.areas || []).length ? `<div class="areas"><b class="small">Experience Claude found in it</b><ul class="small">${c.areas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${c.exists && !c.editable ? `<div class="card" style="box-shadow:none;background:var(--warn-soft);border-color:transparent"><p>Job Hunt can't find editable paragraphs in this file. Text boxes and some templates hide them. It will still write cover letters, but your CV won't be tailored.</p><div class="row"><button class="btn" data-act="convertCv" data-track="${esc(c.track)}">Convert to an editable copy</button><span class="muted small">Claude copies your CV word for word into Job Hunt's clean layout. Your original stays as it is.</span></div></div>` : ''}
      <div class="form">
        <div class="stack" style="gap:14px">
          <label class="field">Name<input type="text" data-k="label" value="${esc(c.label)}"></label>
          <label class="field">Cover-letter style<select data-k="letter_style">${[['standard', 'Standard (300–450 words)'], ['formal', 'Formal: banks, government, law'], ['short', 'Short and direct: startups, tech'], ['warm', 'Warm and personal']].map(([v, n]) => `<option value="${v}" ${(c.letter_style || 'standard') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">For letters written from this CV.</span></label>
        </div>
        <label class="field">Job titles to search for<textarea data-k="titles" style="min-height:220px">${esc(lines(c.titles))}</textarea><span class="hint">One per line. Missing a field you've worked in? Add titles here, or press Find more titles.</span></label>
        <label class="field">Keywords that also qualify a posting<textarea data-k="keywords">${esc(lines(c.keywords))}</textarea><span class="hint">A posting whose title doesn't match is still scored if it mentions one.</span></label>
      </div>
      ${c.ats ? atsHtml(c.ats) : ''}
      <div class="row">
        <button class="btn primary" data-act="saveCv" data-track="${esc(c.track)}">Save</button>
        ${c.exists ? `<button class="btn" data-act="openCv" data-track="${esc(c.track)}">${svg('doc')}Open</button>` : ''}
        <label class="btn">Replace file<input type="file" accept=".docx,.pdf,.txt" data-upload="cv-replace" data-track="${esc(c.track)}" hidden></label>
        <button class="btn" data-act="suggestCv" data-track="${esc(c.track)}">Find more titles</button>
        <button class="btn ghost danger" data-act="removeCv" data-track="${esc(c.track)}">Remove</button>
      </div></section>`).join('')}
    ${st.cvs.length ? '' : '<p class="empty">No CVs yet. Add one above to start.</p>'}`;
    const career = st.cvs.length ? careerHtml(st.career, st.career_thinking, st.profile.tracks || []) : '<section class="card"><p>Add a CV first: Claude maps your career paths from it.</p><div class="row"><a class="btn primary" href="#cvs">Add your CV</a></div></section>';
    const details = `<form data-form="profile" data-part="about"><section class="card"><header><h2>About you</h2></header>
      <p class="muted">Your name goes on your CVs' file names and cover letters; your email is where the weekly review goes.</p>
      <div class="form">
        <label class="field">Your name<input type="text" name="name" value="${esc(p.name)}"></label>
        <label class="field">Your email<input type="email" name="email" value="${esc(p.email)}"></label>
      </div></section></form>
    <section class="card"><header><h2>Signature</h2>${st.signature ? '<span class="pill good">Added</span>' : ''}</header>
      <p class="muted">Goes on every cover letter, between the sign-off and your name. Sign a white sheet of paper, take a photo or scan, and crop it close. PNG or JPEG.</p>
      ${st.signature ? `<p><img src="${st.signature}" alt="Your signature" style="max-height:60px;max-width:260px;background:#fff;padding:6px;border-radius:6px"></p>` : ''}
      <div class="row">
        <label class="btn">${st.signature ? 'Replace signature' : 'Add signature'}<input type="file" accept=".png,.jpg,.jpeg" data-upload="signature" hidden></label>
        ${st.signature ? '<button class="btn ghost" data-act="forget" data-what="signature">Remove</button>' : ''}
      </div>
      <p class="muted small">Letters already written keep what they had. Saving a cover letter again adds it.</p></section>
    <form data-form="profile" data-part="stories"><section class="card"><header><h2>Your stories</h2></header>
      <p class="muted">True achievements and stories that aren't in your CV, for cover letters to draw on, like a hard delivery you pulled off or a problem only you solved. Cover letters may use them; your CV is never changed with them.</p>
      <label class="field">Stories<textarea name="stories" style="min-height:160px" placeholder="e.g. Managed a key shipment for a \$2B oil project in Iran.\nCoordinated urgent delivery of medical supplies to Iraq.">${esc(st.profile.stories || '')}</textarea><span class="hint">One per line or paragraph. Keep the real numbers.</span></label>
      <label class="field">Facts for application forms<textarea name="application_facts" placeholder="e.g. Citizen, no visa sponsorship needed.\nNotice period: one month.\nSalary expectation: (your range and currency).\nOpen to hybrid; not relocating.\nAddress: 123 Main St, Toronto, ON M5P 3M1\nPhone: (416) 555-0100">${esc(st.profile.application_facts || '')}</textarea><span class="hint">Used to answer application questions. Anything not here is left as “[Fill in]”.</span></label>
      <div class="row"><button class="btn primary" type="submit">Save</button></div></section></form>
    <section class="card" id="bankCard"><header><h2>Your saved answers</h2></header><p class="muted small">Loading…</p></section>`;
    const view = ['career', 'details'].includes(sub) ? sub : 'cvs';
    body = `${cvsTabs(view, st.cvs.length)}
      ${view === 'career' ? career : view === 'details' ? details : body}`;
  } else if (tab === 'search') {
    body = `<section class="card"><header><h2>Job titles</h2><a class="btn ghost" href="#cvs">Your CVs</a></header>
        <p class="muted small">Each CV searches for its own titles. Type one and press Enter to add it. A posting whose title doesn't match is still scored if it mentions one of the keywords.</p>
        ${st.cvs.length ? st.cvs.map(c => `<div class="title-set" data-cv="${esc(c.track)}"><input type="hidden" data-k="label" value="${esc(c.label)}"><input type="hidden" data-k="letter_style" value="${esc(c.letter_style || 'standard')}">
          <div class="form"><label class="field">${st.cvs.length > 1 ? `Titles for your ${esc(c.label)} CV` : 'Job titles to search for'}<textarea data-chips data-add="Add a job title" data-k="titles" style="min-height:120px">${esc(lines(c.titles))}</textarea></label>
          <label class="field">Keywords that also qualify a posting<textarea data-chips data-add="Add a keyword" data-k="keywords" style="min-height:120px">${esc(lines(c.keywords))}</textarea></label></div>
          <div class="row"><button class="btn" data-act="saveCv" data-track="${esc(c.track)}">Save titles</button><button class="btn ghost" data-act="suggestCv" data-track="${esc(c.track)}">Find more titles</button></div></div>`).join('') : '<p class="muted">Add a CV first: Claude reads it and suggests the titles. <a href="#cvs">Add your CV</a></p>'}
      </section>
      <form data-form="profile" data-part="search">
      <section class="card"><header><h2>Where</h2></header><div class="form">
        <div class="field">Cities or areas${placePicker('locations', p.locations, p.sources.adzuna_country)}<span class="hint">Job Hunt also looks about 50 km around each. None: anywhere in the country.</span></div>
        <div class="stack" style="gap:14px">
          <label class="field">Country${countrySelect('adzuna_country', p.sources.adzuna_country, st.countries)}<span class="hint">Where searches look, and which job sites are offered.</span></label>
          <label class="check"><input type="checkbox" name="include_metro" ${p.include_metro !== false ? 'checked' : ''}> <span>Include the area around each city<br><span class="muted small">Toronto, Oakville or any GTA city brings in the whole GTA (Mississauga, Markham, Vaughan…), Vancouver or Burnaby Metro Vancouver, Montreal Laval and Longueuil, London Greater London, New York the NYC area, Dubai Sharjah and Ajman.</span></span></label>
          <label class="check"><input type="checkbox" name="remote_ok" ${p.remote_ok ? 'checked' : ''}> <span>Include remote roles open across the country<br><span class="muted small">Remote roles based in one of your locations are always included.</span></span></label>
        </div>
      </div></section>
      <section class="card"><header><h2>What you want</h2></header>
        <p class="muted small">The things that make you turn a role down, told to Job Hunt up front. Scoring weighs them for every new posting: a role that goes against one scores lower and says why.</p>
        <div class="form">
          <label class="field">The level you're going for<input type="text" name="want_level" value="${esc(p.wants?.level || '')}" placeholder="e.g. senior manager or director"></label>
          <label class="field">Permanent or contract<select name="want_work">${[['', 'Either'], ['permanent', 'Permanent only'], ['contract', 'Contract only']].map(([v, n]) => `<option value="${v}" ${(p.wants?.work || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">Industries you want<textarea data-chips data-add="Add an industry" name="want_industries">${esc(lines(p.wants?.industries))}</textarea></label>
          <label class="field">Industries you don't want<textarea data-chips data-add="Add an industry" name="want_avoid">${esc(lines(p.wants?.avoid))}</textarea></label>
          <label class="field" style="grid-column:1/-1">Deal-breakers<textarea data-chips data-add="Add a deal-breaker" name="want_dealbreakers">${esc(lines(p.wants?.dealbreakers))}</textarea><span class="hint">For example: on-site five days, more than 25% travel, commission only. A posting that clearly has one is set aside with the reason.</span></label>
        </div></section>
      <section class="card"><header><h2>Which roles</h2></header><div class="form">
        <label class="field">Skip these companies<textarea data-chips data-add="Add a company" name="exclude_companies">${esc(lines(p.exclude_companies))}</textarea></label>
        <label class="field">Skip titles containing<textarea data-chips data-add="Add a word" name="exclude_title_keywords">${esc(lines(p.exclude_title_keywords))}</textarea></label>
        <label class="field">Don't score jobs older than<input type="number" name="max_age_days" min="0" step="1" value="${p.max_age_days ?? 30}"><span class="hint">Days since the job was posted (0: any age). Older ones are set aside before scoring, using no Claude. Jobs whose posting date isn't known are scored.</span></label>
        <label class="field">Minimum yearly salary<input type="number" name="min_salary" min="0" step="1000" value="${p.min_salary ?? ''}" placeholder="No minimum, e.g. 120000"><span class="hint">Digits only. Jobs that pay less at most are skipped before scoring, so they use no Claude: the salary a job site gives, or the pay in the posting itself (hourly rates count as 2,080 hours a year). Jobs that don't say are kept. Job Hunt looks for missing salaries once a week. <a href="#" data-act="rescanSalaries">Look now</a></span></label>
        <label class="field">Skip companies rated below<select name="min_rating">${[['', 'Any rating'], ['3', '3.0 out of 5'], ['3.5', '3.5 out of 5'], ['4', '4.0 out of 5']].map(([x, n]) => `<option value="${x}" ${String(p.min_rating ?? '') === x || (x && Number(x) === p.min_rating) ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">From what employees say (Glassdoor and the like). Companies not rated yet are kept until they are.</span></label>
      </div>
        <label class="field" style="margin-top:14px">What matters to you<textarea name="guidance" placeholder="e.g. Prefer hybrid roles in fintech or government. Avoid pure sales roles. Open to contract roles.">${esc(p.guidance || '')}</textarea><span class="hint">Claude weighs this when scoring. Job titles and keywords for each CV are set in Me.</span></label>
      </section>
      <section class="card"><header><h2>Employers</h2></header>
        <label class="check"><input type="checkbox" data-act="ratingsAuto" ${st.ratings_auto ? 'checked' : ''}> <span>Look up what employees say<br><span class="muted small">Ratings and reviews from Glassdoor, Indeed and the like, for the companies of roles you're considering: shown as a star rating next to the company, and on each job. Each company is looked up once (again after two months), through Claude Code; it uses a little of your Claude plan.</span></span></label>
      </section>
      <section class="card"><header><h2>When</h2></header><div class="form">
        <label class="field">Searches a day<select name="searches_per_day">${[[1, 'One'], [2, 'Two: a second one later in the day']].map(([v, n]) => `<option value="${v}" ${(p.searches_per_day >= 2 ? 2 : 1) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Two finds new postings hours sooner, when applications are read most. The second scores only what's new since the first, so it uses a little more of your plan, not double.</span></label>
        <label class="field">Search every day at${hourSelect('search_hour', p.search_hour)}<span class="hint">If Job Hunt isn't running then, it searches when it next opens.</span></label>
        <label class="field" data-second-search ${p.searches_per_day >= 2 ? '' : 'hidden'}>And again at${hourSelect('search_hour_2', p.search_hour_2 ?? 16)}<span class="hint">Skipped when you searched by hand in the two hours before.</span></label>
        <div class="field">Daily search<div class="row">${scheduleMenu(overview?.side?.paused, false)}</div><span class="hint">${overview?.side?.paused ? esc(pausedWords(overview.side.paused)) + '.' : 'On. Pause it for a while, or turn it off.'}</span></div>
      </div></section>
      <section class="card"><header><h2>Tailoring</h2></header>
        <div class="field" style="margin-bottom:10px">A company you've applied to before<select data-act="repeatMode">${[['light', 'Light touch: the same headline, at most 4 paragraphs changed (recommended)'], ['same', 'The same CV as before, with a new cover letter'], ['usual', 'Tailor as usual']].map(([v, n]) => `<option value="${v}" ${(st.repeat_mode || 'light') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">They keep every CV you send on file, side by side. A different headline or a different story for the same achievement is what stands out.</span></div>
        <label class="field">Tailor by itself<select name="auto_tailor_mode">${[['off', 'No: I pick which roles to tailor'], ['strong', 'Only strong fits (85 or better), so they\'re ready to approve'], ['all', 'Every role that clears my fit score']].map(([v, n]) => `<option value="${v}" ${(p.auto_tailor ? 'all' : p.auto_tailor_min > 0 ? 'strong' : 'off') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Strong fits: after each search the best new matches from the last two weeks are tailored without waiting for you, at most as many as Most applications tailored per search. They use your Claude plan as any tailoring does.</span></label>
        <details style="margin-top:10px"><summary class="small muted">Advanced</summary><div class="form" style="margin-top:8px">
        <label class="field">Fit score needed to tailor<span class="range-row"><input type="range" min="0" max="100" step="1" value="${p.score_threshold}" data-range-for="score_threshold" aria-label="Fit score needed to tailor"><input type="number" min="0" max="100" name="score_threshold" value="${p.score_threshold}"></span><span class="hint">0–100. Roles below it are skipped.</span></label>
        <label class="field">Most new postings scored per search<input type="number" min="5" max="200" name="max_scored_per_run" value="${p.max_scored_per_run}"><span class="hint">Spares your Claude usage; the rest are scored next time. With more than 40 matches waiting to be picked, a search by itself scores half this many, newest first.</span></label>
        <label class="field">Most applications tailored per search<input type="number" min="1" max="50" name="max_per_run" value="${p.max_per_run}"><span class="hint">Only when tailoring automatically.</span></label>
      </div><div class="form" style="margin-top:14px">
        <label class="field">Remove postings I never acted on<select name="purge_after_days">${[[0, 'Never'], [30, 'After 30 days'], [60, 'After 60 days'], [90, 'After 90 days']].map(([v, n]) => `<option value="${v}" ${(p.purge_after_days || 0) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Skipped, not-interested and closed ones only; anything tailored, saved or applied to stays. Removed postings aren't brought back as new.</span></label>
        <div class="field">Score skipped postings again<div><button class="btn" type="button" data-act="rescore" data-group="skipped">Score them again</button></div><span class="hint">After you change your CVs, titles, fit score or locations.</span></div>
      </div></details></section>
      </form>`;
  } else if (tab === 'calendar') {
    const c = p.calendar;
    body = `<p class="muted">How Job Hunt books interviews and reminds you, in your Google Calendar too.${st.google.connected ? '' : ' <b>Connect Google in <a href="#settings/connections">Accounts</a> first.</b>'}</p>
      <form data-form="profile" data-part="calendar">
      <section class="card"><header><h2>Your time</h2></header><div class="form">
        <label class="field">Your time zone${tzSelect('timezone', p.timezone)}<span class="hint">For interview times, the daily search and reminders.</span></label>
      </div></section>
      <section class="card"><header><h2>Interviews</h2></header><div class="form">
        <label class="field">Interviews from${hourSelect('work_start', c.work_start, 0, 23)}</label>
        <label class="field">Until${hourSelect('work_end', c.work_end, 1, 24)}</label>
        <label class="field">Interview length to offer (minutes)<input type="number" min="15" step="15" name="slot_minutes" value="${c.slot_minutes}"></label>
        <label class="field">How many times to offer<input type="number" min="1" max="6" name="propose_slots" value="${c.propose_slots}"></label>
        <label class="field">Prep time before interviews (minutes)<input type="number" min="0" step="15" name="prep_minutes" value="${c.prep_minutes}"><span class="hint">0 for none.</span></label>
        <label class="field">Reminders after an interview (days)<input type="text" name="followup_days" value="${esc(c.followup_days.join(', '))}"><span class="hint">E.g. 1, 7: a thank-you note the next day, and a check-in a week later.</span></label>
      </div>
      <details class="small" style="margin-top:10px" ${c.calendar_id && c.calendar_id !== 'primary' ? 'open' : ''}><summary class="muted">Advanced</summary><div class="form" style="margin-top:8px">
        <label class="field">Which Google calendar<input type="text" name="calendar_id" value="${esc(c.calendar_id)}"><span class="hint">Leave it as “primary” for your main calendar. For another one, paste its Calendar ID from Google Calendar → Settings → that calendar → Integrate calendar.</span></label>
      </div></details></section>
      </form>`;
  } else if (tab === 'inbox') {
    body = `<p class="muted">How Job Hunt reads your job email and follows up on applications.${st.google.connected ? '' : ' <b>Connect Google in <a href="#settings/connections">Accounts</a> first.</b>'}</p>
      <form data-form="profile" data-part="inbox">
      <section class="card"><header><h2>Email</h2></header><div class="form">
        <label class="field">Check email every (minutes)<input type="number" min="10" max="240" name="inbox_minutes" value="${p.inbox_minutes}"><span class="hint">Replies, interview invitations and job alerts are read then; replies are drafted in Gmail for you to send.</span></label>
        <label class="field">Follow up on applications after (days)<input type="number" min="0" max="45" name="follow_up_after" value="${p.follow_up_after ?? 8}"><span class="hint">With no reply by then, Job Hunt drafts a short follow-up in Gmail. 0 for never.</span></label>
      </div></section></form>`;
  } else if (tab === 'notifications') {
    const ph = st.phone;
    body = `<p class="muted">How Job Hunt lets you know what's happening, here and on your phone.</p>
      <form data-form="profile" data-part="weekly">
      <section class="card"><header><h2>Weekly review</h2><button class="btn" type="button" data-act="weeklyNow">Send it now</button></header>
        <p class="muted">Once a week: what you sent against your goal, who replied, what's going quiet, what to do next, and the best new roles of the week to pick.</p>
        <div class="form">
          <label class="field">Weekly goal (applications)<input type="number" min="0" max="100" name="weekly_goal" value="${p.weekly_goal ?? 10}"><span class="hint">Shown in the Queue too. 0 for none.</span></label>
          <label class="field">When<select data-act="weeklyDay"><option value="sun" ${st.weekly.day === 'sun' ? 'selected' : ''}>Sunday at 6 PM, to plan the week ahead</option><option value="mon" ${st.weekly.day === 'mon' ? 'selected' : ''}>Monday, at the daily search hour</option></select></label>
        </div>
        <label class="check"><input type="checkbox" data-act="weeklyEmail" ${st.weekly.email ? 'checked' : ''}> <span>Email me the whole review${st.weekly.to ? ` at ${esc(st.weekly.to)}` : ''} (needs Gmail connected). Otherwise it's a short notice.</span></label>
      </section>
      </form>
      <section class="card" id="phoneCard"><header><h2>Notices on your phone</h2>${ph.topic ? '<span class="pill good">On</span>' : '<span class="pill">Optional</span>'}</header>
        <p class="muted">Interviews, offers and applications ready, on your phone even when you're away from this computer. Uses the free ntfy app; no account needed.</p>
        <div class="row">${ph.topic ? '<button class="btn" data-act="phoneTest">Send a test</button><button class="btn ghost" data-act="phone" data-on="0">Turn off</button>' : '<button class="btn primary" data-act="phone" data-on="1">Turn on</button>'}</div>
        ${ph.topic ? `<ol class="small steps-list">
          <li>Install <b>ntfy</b> on your phone: <a href="#" data-act="link" data-url="https://play.google.com/store/apps/details?id=io.heckel.ntfy">Android</a> or <a href="#" data-act="link" data-url="https://apps.apple.com/app/ntfy/id1625396347">iPhone</a>.</li>
          <li>In ntfy, tap <b>+</b> and subscribe to <b class="mono">${esc(ph.topic)}</b>${ph.server && ph.server !== 'https://ntfy.sh' ? ` on ${esc(ph.server)}` : ''}.</li>
          <li>Press <b>Send a test</b> above.</li></ol>
          <label class="check"><input type="checkbox" data-act="phoneUrgent" ${ph.urgent_only ? 'checked' : ''}> <span class="small">Only what can't wait: interviews, offers, replies from employers and postings about to close.</span></label>
          <label class="check"><input type="checkbox" data-act="phoneDetails" ${ph.details ? 'checked' : ''}> <span class="small">Show the company and role in notices<br><span class="muted">Off (private): notices only say what kind they are, like “An interview update”. They travel through ntfy.sh, a public relay, so anyone who learned your topic name could read them.</span></span></label>
          <details class="small"><summary class="muted">Your own ntfy server (optional)</summary><form data-form="phone" class="form" style="margin-top:8px"><label class="field">Server<input type="url" name="server" value="${esc(ph.server)}" placeholder="https://ntfy.sh"></label><div class="row"><button class="btn sm" type="submit">Save</button></div></form></details>
          <p class="muted small">Keep the topic name to yourself.</p>` : ''}
      </section>`;
  } else if (tab === 'extension') {
    // Set up on the PC Job Hunt runs on (its folder and key are there); from a phone, say so.
    body = st.kind === 'server' || st.remote.here
      ? `<section class="card"><header><h2>Browser extension</h2></header><p class="muted"><b>Send to Job Hunt</b> for Chrome or Edge sends a posting you're looking at to Job Hunt and fills in application forms in your own browser. It's set up on the computer Job Hunt runs on: open Job Hunt there and go to <b>Settings → Browser extension</b>.</p>
          </section>
        <section class="card"><header><h2>Fill forms on this phone</h2></header>
          <p class="muted">A phone's browser can't run the extension, so on a phone a bookmark does the filling. It carries your private key, so Job Hunt only hands it out on your PC.</p>
          <ol class="small steps-list">
            <li>On your PC, open Job Hunt: <b>Settings</b> (the gear) → <b>Browser extension</b> → <b>Fill forms on your phone</b>.</li>
            <li>Press <b>Copy the bookmark</b> and send it to yourself (a note or an email to yourself).</li>
            <li>On this phone, bookmark any page, then edit that bookmark: name it <b>Job Hunt Fill</b> and paste what you copied as its address.</li>
            <li>On an application form, tap the address bar, type <b>Job Hunt Fill</b> and tap the bookmark. The Job Hunt panel appears and fills in the form.</li></ol></section>`
      : extensionCard(st) + (st.ext_key ? phoneCard(st) : '');
  } else if (tab === 'sync') {
    const server = st.kind === 'server', here = st.remote.here;
    const b = st.backup;
    const kb = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const y = st.sync;
    const viaDrive = server || y.where === 'drive' || (!y.on && !y.folder); // new to syncing: Drive is the simpler way
    const every = [[5, 'Every 5 minutes after a change'], [10, 'Every 10 minutes after a change'], [30, 'Every 30 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Once a day'], [0, 'Only when I press Sync now']];
    const state = !y.on ? ['', 'Off', 'Your data is only on this computer (and in its daily backups).']
      : y.running ? ['', '<span class="spin" data-kind="sync" data-secs="30"></span>Syncing…', 'Saving the latest copy now.']
      : y.error ? ['crit', 'Didn\'t sync', y.error]
      : y.last ? ['good', 'Up to date', `Last synced ${ago(y.last)} from ${y.device}.`]
      : ['warn', 'Not synced yet', 'Press Sync now to save the first copy.'];
    const status = `<section class="card sync-status"><header><h2>Status</h2><span class="pill ${state[0]}">${state[1]}</span></header>
      <p class="${state[0] === 'crit' ? '' : 'muted'}">${esc(state[2])}</p>
      <div class="kpis small-kpis">
        <div class="kpi"><span class="kpi-l">Sync</span><span class="kpi-v">${y.on ? (y.last ? esc(ago(y.last)) : '–') : 'Off'}</span><span class="kpi-s">${y.on ? (y.where === 'drive' ? 'to Google Drive' : 'to your sync folder') : 'not turned on'}</span></div>
        <div class="kpi"><span class="kpi-l">Backup</span><span class="kpi-v">${b.last ? esc(ago(b.last)) : '–'}</span><span class="kpi-s">${y.drive_backup ? `in Google Drive ${esc(ago(y.drive_backup))}` : 'on this computer'}</span></div>
        <div class="kpi"><span class="kpi-l">Automatic sync</span><span class="kpi-v">${y.on ? esc((every.find(e => e[0] === y.every) || [0, `Every ${y.every} min`])[1].replace(' after a change', '')) : 'Off'}</span><span class="kpi-s">${y.on ? 'and when Job Hunt exits' : 'turn on sync below'}</span></div>
      </div>
      <div class="row">${y.on ? `<button class="btn primary" data-act="syncNow" ${y.running ? 'disabled' : ''}>Sync now</button>` : y.drive_ready ? '<button class="btn primary" data-act="syncOn">Turn on sync to Google Drive</button>' : '<a class="btn primary" href="#settings/connections">Connect Google to sync</a>'}<button class="btn" data-act="backupNow">Back up now</button></div>
      ${y.on ? '' : '<p class="muted small">One click: your data goes to a private "Job Hunt" folder in your Google Drive and keeps itself up to date, with daily backups. On another PC, install Job Hunt and connect the same Google account to continue there.</p>'}</section>`;
    const sync = `<section class="card"><header><h2>Sync to Google Drive</h2>${y.on ? '<span class="pill good">On</span>' : ''}</header>
      <p class="muted">Pick up where you left off on any computer${server ? ', or move between this server and a PC' : ''}. Job Hunt keeps an up-to-date copy of everything in your own Google Drive; on another computer, install Job Hunt and connect the same Google account, and it finds your data and offers to continue from it. Use one at a time. Only you can see the copy.</p>
      <form data-form="sync" class="form">
        <fieldset class="field" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend class="small">Where</legend>
          <label class="check"><input type="radio" name="where" value="drive" ${viaDrive ? 'checked' : ''}> <span>Straight to Google Drive<br><span class="muted small">Through your Google connection: no Google Drive app needed. Job Hunt uses a "Job Hunt" folder in My Drive and can't see your other files. Daily backups are copied there too (the last three).${y.drive_ready ? '' : ' <b>Connect Google in Settings → Accounts first.</b>'}</span></span></label>
          ${server ? '' : `<label class="check"><input type="radio" name="where" value="folder" ${viaDrive ? '' : 'checked'}> <span>Through a folder on this computer<br><span class="muted small">One that Google Drive for desktop, OneDrive or Dropbox keeps in the cloud. Daily backups go there too.</span></span></label>`}
        </fieldset>
        ${server ? '' : `<div class="sync-folder" style="grid-column:1/-1" ${viaDrive ? 'hidden' : ''}><label class="field">Folder<span class="row" style="flex-wrap:nowrap;gap:6px"><input type="text" name="dir" value="${esc(y.folder || '')}" placeholder="${esc(y.suggest || 'G:\\My Drive\\Job Hunt')}" style="flex:1">${here ? '' : '<button class="btn" type="button" data-act="pickFolder" data-into="dir">Browse…</button>'}</span>
          <span class="hint">${y.suggest ? `<a href="#" data-act="useDrive" data-path="${esc(y.suggest)}">Use ${esc(y.suggest)}</a>` : 'Install <a href="#" data-act="link" data-url="https://www.google.com/drive/download/">Google Drive for desktop</a>, then use a folder in My Drive, like G:\\My Drive\\Job Hunt.'}</span></label></div>`}
        <label class="check" style="grid-column:1/-1"><input type="checkbox" name="on" ${y.on ? 'checked' : ''}> <b>Keep a synced copy there</b></label>
        <label class="field">How often<select name="every">${every.map(([v, n]) => `<option value="${v}" ${y.every === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">It also syncs when Job Hunt exits.</span></label>
        <label class="check"><input type="checkbox" name="secrets" ${y.secrets ? 'checked' : ''}> <span>Include saved keys and sign-ins<br><span class="muted small">So another computer needs no setting up. They stay in your own Google Drive.</span></span></label>
        <div class="row"><button class="btn primary" type="submit">Save</button></div>
      </form></section>`;
    const backups = `<section class="card"><header><h2>Backups</h2></header>
      <p class="muted">Every day Job Hunt saves one zip file with everything: your applications, CVs, cover letters, settings and signature. The last ${14} are kept.
        ${server ? 'They go to the <b>/backups</b> folder you mapped to a NAS share, so Hyper Backup or Cloud Sync can copy them off the NAS.' : 'With sync on, each one goes to your Google Drive (or sync folder) too.'}</p>
      <form data-form="backup" class="form">
        <label class="check"><input type="checkbox" name="secrets" ${b.secrets ? 'checked' : ''}> <span>Include saved keys and sign-ins (Claude API key, Google, Adzuna)<br><span class="muted small">So a restore on a new computer or the NAS needs no signing in again. Keep the backup folder private if you tick this.</span></span></label>
        <div class="row"><button class="btn" type="submit">Save</button></div>
      </form>
      <p class="muted small">${b.last ? `Last backup ${esc(ago(b.last))}` : 'No backup yet.'} · Saved in ${esc(b.folder)}</p>
      ${b.files.length ? `<table><tbody>${b.files.slice(0, 5).map(f => `<tr><td class="small">${esc(f.name.replace('JobHunt backup ', '').replace('.zip', ''))}</td><td class="small muted">${kb(f.size)}</td><td style="text-align:right"><a class="btn ghost" href="/api/backup/download/${encodeURIComponent(f.name)}" download>Download</a></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="row" style="margin-top:10px"><label class="btn">Restore from a backup…<input type="file" accept=".zip" data-upload="restore" hidden></label>
        <span class="muted small">Replaces everything here with the backup and restarts Job Hunt. What's here now is kept in a "before-restore" folder.</span></div>
    </section>`;
    body = `${status}${sync}${server ? '' : filesCard(st, false)}${backups}`;
  } else {
    const server = st.kind === 'server', here = st.remote.here;
    const r = st.remote, cd = st.claude_desktop;
    const remote = server ? `<section class="card"><header><h2>Signed in from this browser</h2></header>
        <p class="muted">Job Hunt is running on your server. To change the password, enter a new one; every device is signed out.</p>
        <form data-form="remote" class="form"><label class="field">New password<input type="password" name="password" autocomplete="new-password" minlength="8"></label><span></span>
        <div class="row"><button class="btn" type="submit">Change password</button></div></form>
        <form method="post" action="/logout"><button class="btn ghost" type="submit">Sign out</button></form></section>`
      : `<details class="card" ${r.on || here ? 'open' : ''}><summary><b>Use it from your phone</b> <span class="muted small">(advanced: needs Tailscale on this PC and on your phone)</span>${r.on ? ' <span class="pill good">On</span>' : ''}</summary>
        <p class="muted">Use Job Hunt from your phone or another computer, in a web browser, while it runs here. Install <a href="#" data-act="link" data-url="https://tailscale.com/download">Tailscale</a> (free) on this PC and your phone and sign in to both with the same account: only your own devices can reach Job Hunt, from anywhere. This PC has to stay on.</p>
        <form data-form="remote" class="form">
          <label class="field">${r.password ? 'New password (optional)' : 'Password'}<input type="password" name="password" autocomplete="new-password" minlength="8" ${r.password ? '' : 'required'}><span class="hint">At least 8 characters. Changing it signs every device out.</span></label>
          <label class="field">Port<input type="number" name="port" min="1024" max="65535" value="${r.port}"><span class="hint">Changing it takes effect when Job Hunt restarts.</span></label>
          <label class="check"><input type="checkbox" name="on" ${r.on ? 'checked' : ''}> Turn on remote access</label>
          <div class="row"><button class="btn primary" type="submit">Save</button></div>
        </form>
        ${r.on ? `<p>On your phone, with Tailscale on, open <b>${esc(r.address)}</b></p><p class="muted small">Windows may ask whether Job Hunt can use the network the first time: allow it on private networks.</p>` : ''}
        ${here ? '<form method="post" action="/logout"><button class="btn ghost" type="submit">Sign out of this browser</button></form>' : ''}</details>`;
    const extras = `<section class="card"><header><h2>Ask Claude about your search</h2>${cd.added ? '<span class="pill good">Added</span>' : ''}</header>
        <p class="muted">Adds Job Hunt to the Claude desktop app, so you can ask in plain words: “What's waiting for my approval?”, “Make the Maple Bank letter shorter”, “Search now”.</p>
        <div class="row">${cd.available ? `<button class="btn ${cd.added ? '' : 'primary'}" data-act="addClaudeDesktop">${cd.added ? 'Add again' : 'Add to Claude'}</button>` : '<span class="muted small">Set this up from the Job Hunt app on your PC.</span>'}</div>
        ${cd.available ? `<p class="muted small">After adding: quit the Claude app fully (right-click its icon by the clock → Quit) and open it again. Job Hunt appears among its tools.${cd.config ? ` Claude's settings file: ${esc(cd.config)}` : ''}</p>` : ''}</section>
`;
    body = `<section class="card"><header><h2>Updates</h2><span class="muted small">Version ${esc(shortVersion(st.app.version))}</span></header>
      <p class="muted small" id="updateStatus">${server ? 'The server version updates with its container image: when a new version is out, update the image in Container Manager.' : 'Job Hunt checks for updates every 30 minutes and lets you know when one is ready.'}</p>
      <div class="row"><button class="btn" data-act="updateCheck">Check for updates</button><button class="btn primary" data-act="updateInstall" id="updateInstallBtn" hidden>Install and restart</button></div>
      ${server ? '' : `<label class="check" style="margin-top:10px"><input type="checkbox" data-act="updateAuto" ${st.app.update_auto ? 'checked' : ''}> <span>Install updates by themselves<br><span class="muted small">When a new version is out, Job Hunt installs it and restarts once it isn't busy (no search, tailoring or form filling running) and you're not using its window, then tells you what changed. Your applications and settings stay as they are.</span></span></label>`}</section>
      ${remote}
      <section class="card"><header><h2>Know when your CV links are opened</h2>${st.links?.base ? '<span class="pill good">On</span>' : ''}</header>
        <p class="muted">The web links in each tailored CV and cover letter (your LinkedIn, a portfolio) go through Job Hunt first, which notes the click and sends the reader straight on. The text they see doesn't change. Each job then shows whether its links were opened: a sign someone read your application.</p>
        <p class="muted small">Needs Job Hunt reachable from the internet at an https address, such as the server version behind Cloudflare. ${server ? '' : 'On this PC that means a tunnel (Cloudflare Tunnel or Tailscale Funnel) to remote access, which has to be on; links only work while this PC is on.'} Email security scanners and link previews are counted apart from people.</p>
        <form data-form="links" class="form"><label class="field">Job Hunt's public address<input name="base" type="url" placeholder="https://jobhunt.example.com" value="${esc(st.links?.base || '')}"><span class="hint">Leave empty to turn it off.</span></label>
        <div class="row"><button class="btn" type="submit">Save</button></div></form></section>
      ${extras}
      <section class="card" id="whatsnew"><header><h2>What's new</h2></header><p class="muted small">Loading…</p></section>
      ${server || here ? `<section class="card"><header><h2>App</h2></header><p class="muted small">Your data: ${esc(st.app.data)}</p></section>` : `<section class="card"><header><h2>App</h2></header>
      <label class="check"><input type="checkbox" data-act="autostart" ${st.app.autostart ? 'checked' : ''}> Start Job Hunt when I sign in to Windows (in the tray, so searches and email checks keep running)</label>
      ${st.app.slept && st.app.keep_awake && Date.now() - new Date(st.app.slept.at) < 14 * 864e5 ? `<div class="card" style="box-shadow:none;border-color:var(--warn);margin:6px 0"><b>Windows put this PC to sleep during Job Hunt's work</b> <span class="muted small">(${esc(ago(st.app.slept.at))}, for ${st.app.slept.minutes} minutes, while ${esc((st.app.slept.during || []).join(', '))} was running)</span>
        <p class="small">Job Hunt asks Windows to stay on while it works, but closing a laptop's lid, the power button, or a power plan that forces sleep still win. To keep it on: plug it in, and in Control Panel → Power Options → Choose what closing the lid does, set it to Do nothing when plugged in.</p></div>` : ''}
      <label class="check"><input type="checkbox" data-act="wakePc" ${st.app.wake ? 'checked' : ''}> <span>Wake this PC from sleep to run Job Hunt's tasks<br><span class="muted small">For the daily search, the weekly review and interview prep, while Job Hunt is in the tray. It can't wake a PC that's shut down. Not waking? Windows' wake timers may be off: Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep → Allow wake timers → Enable.${st.app.wake && st.app.next_wake ? `<br>Next wake: ${esc(new Date(st.app.next_wake).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}${st.app.last_wake ? ` · last ${esc(ago(st.app.last_wake))}` : ''}</span></span></label>
      <label class="check"><input type="checkbox" data-act="keepAwake" ${st.app.keep_awake ? 'checked' : ''}> <span>Keep this PC awake while Job Hunt is working<br><span class="muted small">While it searches, tailors, checks email or backs up, and for a few minutes after (so it doesn't sleep between one step and the next), Windows won't go to sleep, including after it woke the PC for the daily search. The screen can still turn off. Once it's done, your usual sleep settings apply. Closing a laptop's lid still puts it to sleep unless you set the lid to Do nothing when plugged in.</span></span></label>
      <label class="field" style="max-width:420px">When I close the window<select data-act="closeMode"><option value="tray" ${st.app.close === 'tray' ? 'selected' : ''}>Keep running in the tray</option><option value="exit" ${st.app.close === 'exit' ? 'selected' : ''}>Exit Job Hunt</option></select></label>
      <div class="row"><button class="btn" data-act="folder" data-which="data">${svg('folder')}Open data folder</button><button class="btn" data-act="folder" data-which="applications">${svg('folder')}Open tailored applications</button></div>
      <p class="muted small">Your data: ${esc(st.app.data)}</p></section>`}`;
  }
  if (tab === 'cvs') {
    page(`${meHead(sub === 'details' ? 'details' : sub === 'career' ? 'career' : 'cvs', 'What Job Hunt knows about you: your CVs, your details, and where your career could go.', st.cvs.length)}
      ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${body}`);
    if (st.career_thinking) watchCareer(location.hash);
    if ($('#bankCard')) renderBank();
    return;
  }
  if (host) page(`${host}<p class="save-state right-note" id="saveState" aria-live="polite">Changes save by themselves</p>
    ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${body}`);
  else page(`<div class="head"><div class="grow"><h1>Settings</h1></div><span class="save-state" id="saveState" aria-live="polite">${['notifications', 'inbox', 'calendar'].includes(tab) ? 'Changes save by themselves' : ''}</span></div>
    ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${settingsTabs(tab)}
    ${body}`);
  if (tab === 'connections' && st.claude.engine !== 'api') checkClaude(false);
  if (tab === 'connections') { renderConnStatus(); renderUsage(); }
  if (connScrollTo) { const t = document.getElementById(connScrollTo); connScrollTo = null; if (t) { t.scrollIntoView({ block: 'start' }); t.querySelector('details')?.setAttribute('open', ''); } }
  if (tab === 'sources') { showSourceTest(); renderConnStatus(); }
  if (tab === 'app') { showWhatsNew(); if (update?.available) showUpdate(update); }
}

/** The bookmark's name. Its icon is the Job Hunt logo, kept from the setup page it was made from. */
const BOOKMARK_NAME = 'Send to Job Hunt';
/** The setup page, opened in your browser: its icon is the Job Hunt logo, so a bookmark of it shows the
 *  logo; its address is then swapped for the button's code, and the logo stays. */
async function bookmarkPage() {
  const blob = await (await fetch('/static/icon-192.png')).blob();
  const logo = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  const code = JSON.stringify(bookmarklet()).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${BOOKMARK_NAME}</title>
<link rel="icon" type="image/png" href="${logo}"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px/1.55 system-ui,"Segoe UI",sans-serif;color:#1f201d;background:#f4f4f2;margin:0;padding:48px 16px}
main{max-width:620px;margin:0 auto;background:#fff;border:1px solid #eaeae6;border-radius:16px;padding:32px}
h1{font-size:24px;margin:12px 0 4px}ol{padding-left:22px}li{margin:14px 0}kbd{background:#efefec;border-radius:6px;padding:1px 6px;font:inherit}
button{font:inherit;background:#1f201d;color:#fff;border:0;border-radius:999px;padding:8px 18px;cursor:pointer}p.note{color:#636361;font-size:14px}</style></head>
<body><main><img src="${logo}" width="48" height="48" alt=""><h1>Send to Job Hunt</h1>
<p>Three steps give your browser a Job Hunt button with the Job Hunt logo.</p>
<ol><li>Press <kbd>Ctrl</kbd>+<kbd>D</kbd> to bookmark this page. Choose <b>Bookmarks bar</b> as the folder, keep the name, and press <b>Done</b>. (No bookmarks bar? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.)</li>
<li><button id="copy">Copy the code</button> <span id="done"></span></li>
<li>Right-click the new <b>Send to Job Hunt</b> on your bookmarks bar and choose <b>Edit</b>. Select everything in the <b>URL</b> box, paste, and <b>Save</b>.</li></ol>
<p>Then, on any job posting (LinkedIn, Indeed, a company's site), click it: Job Hunt adds the job, scores it and puts it in your Queue, ready for you to tailor when you choose.</p>
<p class="note">The bookmark usually keeps the Job Hunt logo. If your browser shows a plain icon instead, the button works just the same.</p></main>
<script>var CODE=${code};document.getElementById('copy').onclick=function(){var d=document.getElementById('done');
function ok(){d.textContent='Copied. Now step 3.';}function fb(){var t=document.createElement('textarea');t.value=CODE;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();ok();}
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(CODE).then(ok,fb);else fb();};</script></body></html>`;
}
const bookmarklet = () => 'javascript:' + encodeURIComponent(`(${clipPage.toString()})()`);

// Versions have three parts everywhere: 1.7.0, 1.8.0… Older feeds wrote "1.07", which reads as 1.7.0.
function shortVersion(v) {
  const p = String(v || '').split('.');
  if (p.length === 2 && p[1] !== '') return `${Number(p[0])}.${Number(p[1])}.0`;
  return String(v || '');
}
const versionKey = v => { const [a, b, c] = shortVersion(v).split('.').map(Number); return (a || 0) * 1e6 + (b || 0) * 1e3 + (c || 0); };

async function showWhatsNew() {
  const box = $('#whatsnew');
  if (!box) return;
  try {
    const r = await api('/api/changelog');
    const current = shortVersion(r.current);
    // Include versions an available update would bring, from its own history.
    const extra = (update?.history || []).map(e => ({ ...e, version: shortVersion(e.version) })).filter(e => versionKey(e.version) > versionKey(current));
    const log = [...extra, ...r.log.map(e => ({ ...e, version: shortVersion(e.version) })).filter(e => !extra.some(x => x.version === e.version))];
    const entry = e => `<li>
      <h3>${esc(e.version)} · ${esc(e.title)}${e.version === current ? '<span class="pill">Installed</span>' : versionKey(e.version) > versionKey(current) ? '<span class="pill approved">Ready to install</span>' : ''}</h3>
      ${e.date ? `<p class="muted small">${esc(fmtDate(e.date))}</p>` : ''}
      <ul>${(e.changes || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul></li>`;
    // The newest few, and anything not installed yet; the rest folded away.
    const shown = Math.max(3, extra.length + 1);
    box.innerHTML = `<header><h2>What's new</h2></header><ol class="whatsnew">${log.slice(0, shown).map(entry).join('')}</ol>
      ${log.length > shown ? `<details><summary class="small muted">Earlier versions (${log.length - shown})</summary><ol class="whatsnew">${log.slice(shown).map(entry).join('')}</ol></details>` : ''}`;
  } catch (e) { box.innerHTML = `<header><h2>What's new</h2></header><p class="muted small">${esc(e.message)}</p>`; }
}

// ---- Progress bars ----
// Where a spinner would go, a small bar fills over the time that kind of work usually takes: your own
// average from Claude's requests this month (see /api/usage), or a fair guess until there is one. It
// slows as it nears the end and stops short of full, so it never says "done" before the work is.
// Work with real progress (a search) gives its percentage in data-p. A page redrawn while the work
// runs carries on from where its bar was, rather than starting again.
const GUESS_SECS = { score: 25, tailor: 100, revise: 40, answers: 45, followup: 25, outreach: 25, offer: 50, chat: 25, prep: 80, thanks: 25,
  career: 120, coach: 90, insights: 60, ratings: 45, recruiters: 60, employers: 120 };
let typicalSecs = {};
async function loadTypical() {
  try {
    const u = await api('/api/usage');
    for (const k of u.month?.kinds || []) {
      const { calls, secs, errors } = k.usage || {};
      const ok = (calls || 0) - (errors || 0);
      if (ok > 0 && secs > 0) typicalSecs[k.kind] = secs / calls;
    }
  } catch {}
}
/** How long a bar's work usually takes, in seconds. */
function expectedSecs(el) {
  if (el.dataset.secs) return Number(el.dataset.secs);
  const each = (el.dataset.kind || '').split('+').filter(Boolean).reduce((t, k) => t + (typicalSecs[k] || GUESS_SECS[k] || 30), 0) || 30;
  return each * Math.max(1, Number(el.dataset.n) || 1);
}
const barStarts = new Map(); // which work → [when it started, last seen]
function barKey(el) {
  // The same work on a redrawn page: its kind, the page, and the words beside it (numbers left out).
  const near = (el.parentElement?.textContent || '').replace(/\d+/g, '').trim().slice(0, 40);
  return `${el.dataset.kind || ''}|${location.hash.split('/')[0]}|${el.closest('[data-job]')?.dataset.job || ''}|${near}`;
}
function tickBars() {
  const now = Date.now();
  for (const el of document.querySelectorAll('.spin')) {
    let p;
    if (el.dataset.p != null && el.dataset.p !== '') p = Math.max(2, Math.min(100, Number(el.dataset.p))) / 100;
    else {
      const key = barKey(el);
      const seen = barStarts.get(key) || [now, now];
      seen[1] = now;
      barStarts.set(key, seen);
      // About 80% at the usual time, then slower and slower, never past 95%.
      const t = (now - seen[0]) / 1000 / expectedSecs(el);
      p = Math.max(0.04, Math.min(0.95, 1 - Math.exp(-1.6 * t)));
    }
    el.style.setProperty('--p', p.toFixed(3));
    if (!el.hasAttribute('role')) { el.setAttribute('role', 'progressbar'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100'); }
    el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }
  // Work no longer on screen for a while has finished: its bar starts afresh next time.
  for (const [k, v] of barStarts) if (now - v[1] > 5000) barStarts.delete(k);
}
loadTypical();
setInterval(loadTypical, 60 * 60 * 1000);
setInterval(tickBars, 400);
// Drawn at once (not at the next tick), so a new bar never shows empty or full for a moment.
new MutationObserver(() => tickBars()).observe(document.body, { childList: true, subtree: true });

let update = null;
/** The version whose top bar you put off with Later (it comes back for the next version). */
let updateBarLater = null;
/** A bar across the top of every page while an update waits: the sidebar note is easy to miss. */
function updateBarHtml() {
  return updatedBarHtml() + readyBarHtml();
}
/** Just updated (installed and restarted onto a newer version): what changed, until you press Got it. */
let updated = null;
function updatedBarHtml() {
  if (!updated) return '';
  const titles = updated.news.map(e => e.title).filter(Boolean);
  return `<div class="update-bar done" id="updatedBar" role="status"><span><b>✓ Job Hunt was updated to ${esc(updated.to)}.</b>${titles.length ? ` <span class="muted">${esc(titles.slice(0, 3).join(' · '))}${titles.length > 3 ? ` and ${titles.length - 3} more` : ''}</span>` : ''}</span>
    <span class="row"><a class="btn ghost" href="#settings/app" data-act="updatedOk">What's new</a><button class="btn" data-act="updatedOk">Got it</button></span></div>`;
}
/** Opening Job Hunt on a newer version than this window last saw: say so, with what changed since. */
async function noteUpdated() {
  const now = shortVersion(overview?.version);
  if (!now) return;
  let seen = null;
  try { seen = localStorage.getItem('seenVersion'); localStorage.setItem('seenVersion', now); } catch (e) { return; }
  if (!seen || versionKey(seen) >= versionKey(now)) return;
  let log = [];
  try { log = (await api('/api/changelog')).log || []; } catch (e) { /* the bar still says it updated */ }
  const news = log.map(e => ({ ...e, version: shortVersion(e.version) })).filter(e => versionKey(e.version) > versionKey(seen) && versionKey(e.version) <= versionKey(now));
  updated = { from: seen, to: now, news };
  if (!$('#updatedBar')) main().querySelector('.page')?.insertAdjacentHTML('afterbegin', updatedBarHtml());
}
function readyBarHtml() {
  if (!update?.available || updateBarLater === update.version) return '';
  return `<div class="update-bar" id="updateBar"><span><b>Job Hunt ${esc(shortVersion(update.version))} is ready.</b> <span class="muted">Your applications and settings stay as they are.</span></span>
    <span class="row"><button class="btn primary" data-act="updateInstall">Install and restart</button><a class="btn ghost" href="#settings/app">What's new</a><button class="btn ghost" data-act="updateLater">Later</button></span></div>`;
}
function showUpdate(u) {
  const bar = $('#updateBar');
  if (!u?.available || updateBarLater === u.version) bar?.remove();
  else if (!bar) main().querySelector('.page')?.insertAdjacentHTML('afterbegin', readyBarHtml());
  const note = $('#updateNote');
  if (u?.available) {
    note.innerHTML = `<b>Job Hunt ${esc(shortVersion(u.version))} is ready</b>
      <div class="row"><button class="btn primary" data-act="updateInstall">Install and restart</button><a class="btn ghost" href="#settings/app">What's new</a></div>`;
    note.hidden = false;
  } else note.hidden = true;
  const status = $('#updateStatus');
  if (status) {
    status.textContent = u?.server ? (u.newer ? `Version ${shortVersion(u.version)} is out. Update the Job Hunt image in Container Manager to get it.` : `You're on the newest version (${shortVersion(u.current)}).`)
      : u?.error ? `Couldn't check for updates: ${u.error}`
      : u?.available ? `Version ${shortVersion(u.version)} is ready to install. Your data stays as it is; Job Hunt restarts on the new version.`
      : u ? `You're on the newest version (${shortVersion(u.current)}).` : status.textContent;
    $('#updateInstallBtn').hidden = !u?.available;
  }
}

async function checkUpdate() {
  try { update = await api('/api/update/check'); } catch (e) { update = { error: e.message }; }
  showUpdate(update);
  return update;
}

/** The profile with whatever fields this form holds: settings can sit in any card or tab. */
function readProfile(form, part) {
  const p = JSON.parse(JSON.stringify(settingsCache.profile));
  const el = n => form.elements[n];
  const v = n => el(n)?.value ?? '';
  const has = n => el(n) != null;
  for (const k of ['name', 'email', 'timezone', 'guidance', 'stories', 'application_facts']) if (has(k)) p[k] = v(k).trim();
  for (const k of ['remote_ok', 'include_metro', 'auto_tailor']) if (has(k)) p[k] = !!el(k).checked;
  if (has('auto_tailor_mode')) { p.auto_tailor = v('auto_tailor_mode') === 'all'; p.auto_tailor_min = v('auto_tailor_mode') === 'strong' ? 85 : 0; }
  // What you want from a role (Me, Looking for): told to the scorer.
  if (has('want_level')) p.wants = { level: v('want_level').trim(), work: v('want_work'), industries: fromLines(v('want_industries')), avoid: fromLines(v('want_avoid')), dealbreakers: fromLines(v('want_dealbreakers')) };
  for (const k of ['score_threshold', 'max_per_run', 'max_scored_per_run', 'purge_after_days', 'max_age_days', 'search_hour', 'search_hour_2', 'searches_per_day', 'inbox_minutes', 'follow_up_after', 'weekly_goal']) if (has(k)) p[k] = Number(v(k) || 0);
  for (const k of ['locations', 'exclude_companies', 'exclude_title_keywords']) if (has(k)) p[k] = fromLines(v(k));
  if (has('min_salary')) p.min_salary = v('min_salary') ? Number(v('min_salary')) : null;
  if (has('min_rating')) p.min_rating = v('min_rating') ? Number(v('min_rating')) : null;
  if (has('adzuna_country')) Object.assign(p.sources, { adzuna_where: [], adzuna_country: v('adzuna_country') || 'ca' });
  if (part === 'boards') {
    p.sources.auto_boards = !!form.querySelector('[name=auto_boards]')?.checked;
    // Workday links can hold commas in rare cases, so they're split by line only.
    const byLine = x => x.split('\n').map(y => y.trim()).filter(Boolean);
    Object.assign(p.sources, { greenhouse: fromLines(v('greenhouse')), lever: fromLines(v('lever')), ashby: fromLines(v('ashby')),
      workday: byLine(v('workday')), smartrecruiters: fromLines(v('smartrecruiters')), workable: fromLines(v('workable')), bamboohr: fromLines(v('bamboohr')) });
  }
  for (const k of ['work_start', 'work_end', 'slot_minutes', 'propose_slots', 'prep_minutes']) if (has(k)) p.calendar[k] = Number(v(k));
  if (has('calendar_id')) p.calendar.calendar_id = v('calendar_id').trim() || 'primary';
  if (has('followup_days')) p.calendar.followup_days = fromLines(v('followup_days')).map(Number).filter(n => n > 0);
  return p;
}

// Board lists can change while Settings is open (Remove buttons, employers found by themselves):
// show the server's lists, without touching a field you're typing in.
async function reloadBoards() {
  if (!settingsCache) return;
  try { settingsCache.profile = (await api('/api/settings')).profile; } catch { return; }
  showBoardFields();
}
function showBoardFields() {
  const f = document.querySelector('form[data-form=profile][data-part=boards]');
  if (!f || !settingsCache) return;
  for (const k of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable', 'bamboohr']) {
    const el = f.elements[k];
    if (el && el !== document.activeElement) el.value = lines(settingsCache.profile.sources[k]);
  }
}

// Ticking roles to tailor
/** The Pick list's sort and filters, applied to its rows in place (ticks stay), and remembered. */
function applyPickView(box, saved) {
  const controls = [...box.querySelectorAll('[data-pickf]')];
  if (saved) controls.forEach(el => { if (el.dataset.pickf in saved) el.type === 'checkbox' ? el.checked = !!saved[el.dataset.pickf] : el.value = saved[el.dataset.pickf]; });
  // Until you choose otherwise: the best to apply to now first, and with a long list, the best ten.
  if (saved) {
    let fresh = false;
    try { fresh = !localStorage.getItem('jh.pickNow'); localStorage.setItem('jh.pickNow', '1'); } catch (e) {}
    const sort = controls.find(el => el.dataset.pickf === 'sort'), top = controls.find(el => el.dataset.pickf === 'top');
    if (fresh && sort) sort.value = 'now';
    if (top && !('top' in saved)) top.checked = (box.querySelector('.pick-list')?.children.length || 0) > 15;
  }
  const v = {};
  controls.forEach(el => { v[el.dataset.pickf] = el.type === 'checkbox' ? el.checked : el.value; });
  if (!saved) try { localStorage.setItem('jh.pickView', JSON.stringify(v)); } catch (e) {}
  const list = box.querySelector('.pick-list');
  if (!list) return;
  const key = { now: 'now', fit: 'score', reach: 'reach', new: 'age', pay: 'pay', rating: 'rating' }[v.sort] || 'now';
  // Expired postings last, whatever the order.
  const rows = [...list.children].sort((a, b) => (a.dataset.expired === '1') - (b.dataset.expired === '1') || Number(b.dataset[key]) - Number(a.dataset[key]) || Number(b.dataset.score) - Number(a.dataset.score));
  let shown = 0;
  for (const r of rows) {
    // Fit: "70" is 70 or more, "-70" under 70. Found: "7" within 7 days, "-14" over 14 days ago.
    const min = Number(v.min || 0), score = Number(r.dataset.score), age = Number(v.age || 0);
    const days = (Date.now() - Number(r.dataset.age || 0)) / 86400000;
    const hide = (min >= 0 ? score < min : score >= -min) || (age > 0 && days > age) || (age < 0 && days <= -age) || (v.pay && !(Number(r.dataset.pay) > 0))
      || (v.flags && Number(r.dataset.flags) > 0) || (v.place && !r.dataset.place.includes(v.place));
    // Best 10 only: the first ten that pass the filters, in the order chosen.
    const over = !hide && v.top && shown >= 10;
    r.hidden = hide || over;
    if (r.hidden) r.querySelector('[data-pick]').checked = false; // never tailor what you can't see
    else shown++;
    list.appendChild(r);
  }
  const more = box.querySelector('[data-pickmore]');
  if (more) { more.hidden = !(v.top && rows.length > shown); more.innerHTML = more.hidden ? '' : `Showing the best ${shown} of ${rows.length}. Deal with these first: the rest wait. <button class="btn ghost sm" type="button" data-act="pickShowAll">Show all ${rows.length}</button>`; }
  // With filters on, every count says what you can see, and how to see the rest.
  const hidden = rows.length - shown;
  const count = box.querySelector('[data-pickcount]');
  if (count) count.innerHTML = hidden ? `<b>${hidden} hidden by your filters.</b> <button class="btn ghost sm" type="button" data-act="pickShowAll">Show all ${rows.length}</button>` : '';
  const head = document.querySelector('[data-pickhead]');
  if (head) head.textContent = hidden ? `${shown} of ${rows.length} new matches` : `${rows.length} new match${rows.length === 1 ? '' : 'es'}`;
  const chip = document.querySelector('.pipe-tabs a[href="#applications/pick"] .n');
  if (chip) { chip.textContent = String(shown); chip.title = hidden ? `${shown} shown, ${hidden} hidden by your filters` : ''; }
  pickChanged(box);
}
function restorePickViews() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('jh.pickView') || 'null'); } catch (e) {}
  document.querySelectorAll('[data-pickbox]').forEach(b => applyPickView(b, saved || {}));
  applyQueueView(true);
}
/** The Queue's sort and filters, over every group in its list, and remembered: jobs that state no
 *  pay or have red flags are hidden when you ask, and each group is put in the order chosen. The
 *  Pick group has its own, finer controls; these set them to match. */
function applyQueueView(restore) {
  const box = document.querySelector('[data-queuebox]');
  if (!box) return;
  const controls = [...box.querySelectorAll('[data-queuef]')];
  if (restore) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('jh.queueF') || '{}') || {}; } catch (e) {}
    controls.forEach(el => { if (el.dataset.queuef in saved) el.type === 'checkbox' ? el.checked = !!saved[el.dataset.queuef] : el.value = saved[el.dataset.queuef]; });
  }
  const v = Object.fromEntries(controls.map(el => [el.dataset.queuef, el.type === 'checkbox' ? el.checked : el.value]));
  if (!restore) { try { localStorage.setItem('jh.queueF', JSON.stringify(v)); } catch (e) {} }
  const rows = [...document.querySelectorAll('.page .jrow[data-job-row]')];
  let shown = 0;
  const parents = new Set();
  for (const r of rows) {
    const hide = (v.pay && r.dataset.qhaspay !== '1') || (v.flags && Number(r.dataset.qflags) > 0);
    r.classList.toggle('qf-hide', hide);
    if (hide) r.querySelectorAll('input[type=checkbox]:checked').forEach(c => { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); // never act on what you can't see
    else shown++;
    if (!r.parentElement.classList.contains('pick-list')) parents.add(r.parentElement);
  }
  // Each group in the order chosen; its heading, buttons and bar stay where they are.
  if (v.sort) for (const p of parents) {
    const mine = [...p.children].filter(c => c.matches('.jrow[data-job-row]'));
    const after = mine[mine.length - 1].nextSibling;
    mine.sort((a, b) => Number(b.dataset['q' + v.sort]) - Number(a.dataset['q' + v.sort])).forEach(r => p.insertBefore(r, after));
  }
  // A group with nothing left to show steps aside.
  document.querySelectorAll('.page .todo-group').forEach(g => { const all = g.querySelectorAll('.jrow[data-job-row]'); const card = g.closest('.card'); if (card && all.length) card.classList.toggle('qf-hide', !g.querySelector('.jrow[data-job-row]:not(.qf-hide)')); });
  // The Pick group's own controls follow these (only when you change one here).
  if (!restore) document.querySelectorAll('[data-pickbox]').forEach(pb => {
    const set = (k, val) => { const el = pb.querySelector(`[data-pickf="${k}"]`); if (el) el.type === 'checkbox' ? el.checked = val : el.value = val; };
    set('pay', !!v.pay); set('flags', !!v.flags);
    if (v.sort) set('sort', v.sort);
    applyPickView(pb);
  });
  const n = box.querySelector('[data-queuecount]');
  if (n) n.innerHTML = shown < rows.length ? `Showing ${shown} of ${rows.length}. <a href="#" data-act="queueFClear">Show all</a>` : '';
}
/** The bar at the bottom while jobs are ticked: how many, and what to do with them. */
function selectBar(box, n) {
  const bar = box.querySelector('.select-bar');
  if (!bar) return;
  bar.hidden = !n;
  bar.querySelector('.select-n').textContent = `${n} selected`;
}
function approveChanged(box) {
  const n = box.querySelectorAll('[data-appr]:checked').length;
  const btn = box.querySelector('button[data-act=approvePicked]');
  if (btn) { btn.disabled = !n; btn.textContent = n ? `Approve ${n}` : 'Approve selected'; }
  selectBar(box, n);
  const all = box.querySelector('[data-act=approveAll]');
  if (all) all.textContent = n && n === box.querySelectorAll('[data-appr]').length ? 'Clear' : 'Select all';
}
function pickChanged(box) {
  const n = box.querySelectorAll('[data-pick]:checked').length;
  const btn = box.querySelector('button[data-act=tailorPicked]');
  if (btn) { btn.disabled = !n; btn.textContent = n ? `Tailor ${n}` : 'Tailor selected'; }
  selectBar(box, n);
  const all = box.querySelector('[data-act=pickAll]');
  if (all) all.textContent = n && n === box.querySelectorAll('.jrow:not([hidden]) [data-pick]').length ? 'Clear' : 'Select all';
}
// Sync: the folder box only for syncing through a folder.
document.addEventListener('change', e => {
  if (e.target.name !== 'where' || !e.target.closest('[data-form=sync]')) return;
  const box = e.target.closest('form').querySelector('.sync-folder');
  if (box) box.hidden = e.target.value === 'drive';
});
document.addEventListener('change', e => {
  const box = e.target.closest?.('[data-pickbox]');
  if (box && e.target.matches('[data-pick]')) pickChanged(box);
  if (box && e.target.matches('[data-pickf]')) applyPickView(box);
  if (e.target.matches?.('[data-queuef]')) applyQueueView(false);
  const abox = e.target.closest?.('[data-approvebox]');
  if (abox && e.target.matches('[data-appr]')) approveChanged(abox);
});

// Place pickers: a place typed (or chosen from the list) is added on Enter or when you move on;
// changing the country offers that country's cities.
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('.place-input')) { e.preventDefault(); e.target.closest('[data-places]').querySelector('[data-act=placeAdd]').click(); }
});
document.addEventListener('change', e => {
  if (e.target.matches?.('.place-input') && e.target.value.trim()) e.target.closest('[data-places]').querySelector('[data-act=placeAdd]').click();
  if (e.target.matches?.('select[name=country], select[name=adzuna_country]')) {
    const box = e.target.closest('form')?.querySelector('[data-places]');
    if (box) placesSet(box, placesOf(box), e.target.value);
  }
});

// The API key field only matters with the API option.
document.addEventListener('change', e => {
  if (e.target.matches?.('form[data-form=claude] [name=engine]')) {
    const f = $('#apiKeyField'), c = $('#ccStatus'), useKey = e.target.value === 'api';
    if (f) f.hidden = !useKey;
    if (c) { c.hidden = useKey; if (!useKey) checkClaude(true); }
  }
});

// ---- Connections: one row each, with its status and what fixes it ----
const CONN_PILL = { ok: ['good', 'Working'], partial: ['warn', 'Some not working'], problem: ['crit', 'Needs attention'], off: ['', 'Off'], setup: ['', 'Not set up'], unknown: ['good', 'On'], na: ['', 'Not in your country'] };
/** The recruiters database: everyone who emailed you about a role, with the applications they handled. */
let recruiterQuery = '';
async function showRecruiters() {
  const rec = await api('/api/recruiters');
  const list = rec.recruiters || [];
  const shown = list.filter(r => !r.hidden), hidden = list.filter(r => r.hidden);
  const when = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const apps = r => (r.applications || []).map(a => `<a href="#job/${encodeURIComponent(a.job_id)}">${esc(a.title || 'An application')}</a> ${a.status ? stagePill(a.status) : ''}<span class="muted small"> · ${esc(a.emails)} email${a.emails === 1 ? '' : 's'}, last ${esc(when(a.last_at))}${a.last_subject ? ` · “${esc(a.last_subject)}”` : ''}</span>`);
  const card = r => `<section class="card rec" data-text="${esc(`${r.name} ${r.company} ${r.email} ${(r.roles || []).join(' ')} ${r.notes}`.toLowerCase())}">
    <header><h2>${esc(r.name || r.email)} <span class="muted small" style="font-weight:400">${r.kind === 'agency' ? 'agency recruiter at' : 'recruiter at'} <b>${esc(r.company)}</b></span></h2>
      <span class="row"><button class="btn ghost sm" data-act="recruiterEdit" data-email="${esc(r.email)}">Edit</button><button class="btn ghost sm" data-act="recruiterHide" data-email="${esc(r.email)}" data-hidden="${r.hidden ? '0' : '1'}">${r.hidden ? 'Use again' : 'Not a recruiter'}</button></span></header>
    <div class="facts"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}${r.linkedin ? `<a href="#" data-act="link" data-url="${esc(r.linkedin)}">LinkedIn</a>` : ''}<span>${esc(RECRUITER_STAGE[r.stage] || 'emailed you')}</span><span>last ${esc(when(r.last_at))}</span></div>
    ${(r.applications || []).length ? `<div class="small"><b>Your applications they handled</b><ul class="rec-apps">${apps(r).map(x => `<li>${x}</li>`).join('')}</ul></div>`
      : (r.roles || []).length ? `<p class="small muted">Wrote about ${esc(r.roles.join(', '))}.</p>` : ''}
    ${(r.jobs || []).filter(j => !(r.applications || []).some(a => a.job_id === j.id)).length ? `<p class="small">Open at ${esc(r.company)} in your lists: ${r.jobs.filter(j => !(r.applications || []).some(a => a.job_id === j.id)).map(j => `<a href="#job/${encodeURIComponent(j.id)}">${esc(j.title)}</a>`).join(', ')}</p>` : ''}
    ${r.notes ? `<p class="small"><b>Notes:</b> ${esc(r.notes)}</p>` : ''}
    <form class="form rec-edit" data-form="recruiterEdit" hidden>
      <input type="hidden" name="email" value="${esc(r.email)}">
      <label class="field">Name<input name="name" value="${esc(r.name)}"></label><label class="field">Company<input name="company" value="${esc(r.company)}"></label>
      <label class="field">Phone<input name="phone" value="${esc(r.phone)}"></label><label class="field">LinkedIn<input name="linkedin" value="${esc(r.linkedin)}"></label>
      <label class="field" style="grid-column:1/-1">Notes<textarea name="notes">${esc(r.notes)}</textarea></label>
      <div class="row"><button class="btn primary" type="submit">Save</button></div></form></section>`;
  page(`${inboxHead('recruiters', 'Recruiters who emailed you about a role, saved with the applications they handled. Ask them to put you forward for new roles.', `${rec.gmail ? `<button class="btn" data-act="recruiterScan" ${rec.scanning ? 'disabled' : ''}>${rec.scanning ? '<span class="spin" data-kind="recruiters"></span>Looking…' : 'Find them in my email'}</button>` : ''}
        <button class="btn" data-act="recruiterNew">Add a recruiter</button><a class="btn ghost" href="/api/recruiters.csv" download>Download spreadsheet</a>`)}
    <section class="card"><header><h2>When you apply</h2></header>
      <p class="muted small">When you mark an application as submitted (or Job Hunt sees the confirmation email), it writes to the recruiter on it, or one you know at that company, or the person named in the posting: that you've applied, and, if they know you, could they put you forward. Never more than once a week to the same person, and never to the address the application went to.</p>
      <div class="row" style="gap:16px;flex-wrap:wrap">${[['draft', 'Draft it in Gmail for me to send'], ['send', 'Send it for me'], ['off', 'Off']].map(([v, n]) => `<label class="check"><input type="radio" name="applyMode" data-act="applyMode" value="${v}" ${(rec.on_apply?.mode || 'draft') === v ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" data-act="applyCv" ${rec.on_apply?.attach_cv ? 'checked' : ''}> <span>Attach my tailored CV to emails Job Hunt sends</span></label>
      ${rec.gmail ? '' : '<p class="muted small">Needs Gmail connected (Settings → Accounts); until then the email is written on the application\'s People list for you to copy.</p>'}</section>
    <section class="card"><header><h2>People you know</h2></header>
      <p class="muted small">Your LinkedIn connections, so each job shows who you know at the company and Job Hunt drafts a note asking for a referral. A referral is the surest way past the pile. In LinkedIn: Me → Settings → Data privacy → Get a copy of your data → Connections; LinkedIn emails you a file within the hour. Choose <b>Connections.csv</b> from it here. It stays on your computer.</p>
      <div class="row"><label class="btn ${rec.network?.count ? '' : 'primary'}">${rec.network?.count ? 'Replace with a newer export' : 'Choose Connections.csv'}<input type="file" accept=".csv" data-upload="network" hidden></label>
      ${rec.network?.count ? `<span class="muted small">${rec.network.count} connections${rec.network.at ? `, saved ${esc(ago(rec.network.at))}` : ''}</span><button class="btn ghost" data-act="forgetNetwork">Remove them</button>` : ''}</div></section>
    <form class="card form" data-form="recruiterEdit" id="recruiterNew" hidden><h2 style="grid-column:1/-1">Add a recruiter</h2>
      <label class="field">Name<input name="name" required></label><label class="field">Email<input name="email" type="email" required></label>
      <label class="field">Company<input name="company" required></label><label class="field">Phone<input name="phone"></label>
      <label class="field" style="grid-column:1/-1">Notes<textarea name="notes" placeholder="How you know them"></textarea></label>
      <div class="row"><button class="btn primary" type="submit">Add</button></div></form>
    ${list.length ? `<input type="search" id="recFilter" class="filter" placeholder="Find a recruiter, company or role" value="${esc(recruiterQuery)}" style="max-width:420px">` : ''}
    ${shown.length ? shown.map(card).join('') : `<section class="card"><p class="muted">${!rec.gmail ? 'Connect Gmail and Job Hunt finds them in your email: it reads the last two years once, then saves each recruiter as their emails arrive. <div class="row" style="margin-top:8px"><a class="btn primary" href="#settings/connections">Connect Gmail</a></div>' : rec.last ? 'None found yet. Each recruiter is saved as their emails arrive.' : 'Job Hunt looks through the last two years of your email for them once, then saves each new one as their emails arrive.'}</p></section>`}
    <p class="empty" id="recNone" hidden>No recruiter matches.</p>
    ${hidden.length ? `<details class="card"><summary class="muted">${hidden.length} marked not a recruiter</summary>${hidden.map(card).join('')}</details>` : ''}
    ${rec.last ? `<p class="muted small">Last looked through your email ${esc(ago(rec.last))}.</p>` : ''}`);
  const f = $('#recFilter');
  const apply = () => { recruiterQuery = f.value; const q = f.value.trim().toLowerCase(); let n = 0;
    document.querySelectorAll('.rec').forEach(c => { const on = !q || c.dataset.text.includes(q); c.hidden = !on; if (on) n++; }); $('#recNone').hidden = n > 0 || !q; };
  if (f) { f.addEventListener('input', apply); apply(); }
}

/** "You know a recruiter here": who, what you talked about, and the email asking them to put you forward. */
const RECRUITER_STAGE = { interview: 'you got to an interview', screen: 'you had a screening call', rejected: 'it ended in a rejection', offer: 'you got an offer', outreach: 'they approached you' };
const firstName = n => (n || '').split(/\s+/)[0] || 'them';
function recruiterCard(r, j) {
  const when = r.last_at ? new Date(r.last_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  const about = (r.roles || []).length ? ` about ${esc(r.roles.slice(0, 2).join(', '))}` : '';
  return `<div class="card recruiter-card"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
    <span class="grow"><b>You know a recruiter at ${esc(r.company)}: ${esc(r.name)}</b><br>
      <span class="muted small">They emailed you${about}${when ? ` in ${esc(when)}` : ''}${RECRUITER_STAGE[r.stage] ? `, and ${RECRUITER_STAGE[r.stage]}` : ''}. Apply, then ask them to put you forward: it gets you past the pile of cold applications.</span></span>
    <span class="row">${r.asked ? '<span class="pill good">Asked</span>' : ''}<button class="btn ${r.asked ? '' : 'primary'}" data-act="askRecruiter" data-job="${esc(j.id)}" data-name="${esc(firstName(r.name))}">${r.asked ? 'Write again' : `Ask ${esc(firstName(r.name))} to put you forward`}</button></span></div></div>`;
}

/** Connecting Google away from the computer running Job Hunt: three steps, ending in a paste. */
function googlePasteBox(url) {
  return `<ol class="small apply-steps" style="margin-top:10px">
    <li>${url ? `<a class="btn primary sm" href="${esc(url)}" target="_blank" rel="noopener">Open Google sign-in</a>` : 'Press Connect Google again to start.'} and approve access with your Google account.</li>
    <li>Google then sends you to a page that <b>doesn't open</b> (its address starts with <code>http://127.0.0.1</code>). That's expected: copy that page's whole address from the address bar.</li>
    <li><span class="row" style="gap:6px"><input type="text" id="googlePasteUrl" placeholder="http://127.0.0.1:1/?state=…&code=…" style="flex:1;min-width:200px"><button class="btn primary sm" data-act="googleFinish">Finish</button></span></li></ol>`;
}

/** Recruiters' and job sites' own listings: which to search, how each is doing, and your own sites. */
const SITE_STATE = { ok: ['good', 'Working'], quiet: ['warn', 'No postings found'], problem: ['crit', "Couldn't read"], unknown: ['', 'Not searched yet'] };
function sitesForm(st) {
  const on = st.profile.sources.sites || [], mine = st.profile.sources.custom_sites || [];
  const status = Object.fromEntries((st.sites?.status || []).map(x => [x.id, x]));
  const pill = id => { const x = status[id]; if (!x) return ''; const [cls, label] = SITE_STATE[x.state] || ['', x.state]; return `<span class="pill ${cls}" title="${esc(x.detail)}">${label}</span>`; };
  // A recruiter site that can't be read (or shows nothing) still sends job alerts: suggest those.
  const ALERTS_OK = ['randstad', 'adecco', 'hays', 'roberthalf', 'michaelpage', 'altis', 'lro', 'peoplefirst', 'techtalent', 'jobsca', 'aplin'];
  const line = id => status[id] && status[id].state !== 'unknown' ? `<br><span class="small ${status[id].state === 'problem' ? '' : 'muted'}">${esc(status[id].detail)}${status[id].at ? ` · ${esc(ago(status[id].at))}` : ''}</span>${['problem', 'quiet'].includes(status[id].state) && ALERTS_OK.includes(id) ? '<br><span class="small">Tip: set up job alerts on its website for your titles, sent to your Gmail. Job Hunt reads them on every email check.</span>' : ''}` : '';
  const here = x => x.country === st.profile.sources.adzuna_country || on.includes(x.id);
  const group = kind => (st.sites?.catalog || []).filter(x => x.kind === kind && here(x)).map(x => `<label class="check"><input type="checkbox" name="site" value="${esc(x.id)}" ${on.includes(x.id) ? 'checked' : ''}>
      <span><b>${esc(x.name)}</b> ${on.includes(x.id) ? pill(x.id) : ''}<br><span class="muted small">${esc(x.about)}</span>${on.includes(x.id) ? line(x.id) : ''}</span></label>`).join('');
  const own = mine.map((c, i) => { const id = (st.sites?.status || []).find(x => x.template === c.url.replace('{title}', '{q}').replace('{place}', '{l}'))?.id;
    return `<div class="row site-own" data-i="${i}"><input type="text" name="own_name" value="${esc(c.name)}" placeholder="Name" style="max-width:180px"><input type="text" name="own_url" value="${esc(c.url)}" placeholder="Search address" style="flex:1">${id ? pill(id) : ''}<button class="btn ghost sm" type="button" data-act="siteDrop" data-i="${i}">Remove</button></div>`; }).join('');
  return `<p class="small muted" style="margin-top:8px">Job Hunt reads their own search pages for your titles, as a browser would. Agencies usually don't name their client, so the company shows as the agency.</p>
    <form data-form="sites" class="form">
      <div style="grid-column:1/-1">${group('Agency') ? `<h3 class="sub">Agencies</h3>${group('Agency')}` : ''}
        ${group('Job site') ? `<h3 class="sub" style="margin-top:10px">Job sites</h3>${group('Job site')}` : ''}</div>
      <div style="grid-column:1/-1"><h3 class="sub" style="margin-top:10px">Your own</h3>
        <p class="muted small">Any other site: search on it in your browser, then copy the address. Put {title} where your search words are and {place} where the place is, like <code>https://example.ca/jobs?q={title}&amp;where={place}</code>. A page that lists all its jobs works too.</p>
        <div id="ownSites" style="display:flex;flex-direction:column;gap:6px">${own}</div>
        <button class="btn ghost sm" type="button" data-act="siteAdd" style="margin-top:6px">Add a site</button></div>
      <div class="row"><button class="btn primary" type="submit">Save</button></div>
    </form>`;
}

/** Sources that can be searched on their own (see /api/sources/search), in the Search page's order. */
const SEARCHABLE = ['linkedin', 'boards', 'jobbank', 'freehire', 'jsearch', 'indeed', 'jooble', 'adzuna', 'agencies'];
const SRC_OUTCOME = {
  match: ['good', 'Fits'], low: ['', 'Below your fit score'], new: ['', 'Added'], waiting: ['warn', 'Scored with the next search'],
  known: ['', 'Already in Job Hunt'], filtered: ['', 'Skipped'],
};
const SRC_FILTERS = [['all', 'All'], ['match', 'Fits'], ['new', 'New'], ['known', 'Already had'], ['filtered', 'Skipped']];
const SRC_NEW = ['match', 'new', 'low', 'waiting'];
/** The Search page's filters, per source tab: {outcome, site}. */
const srcFilter = {};
let srcPoll;
/** Start a search of one source, then show its tab. */
async function searchSource(id) {
  await api('/api/sources/search', { method: 'POST', body: { id } });
  const tab = id.startsWith('site:') ? 'agencies' : id;
  if (location.hash === `#search/${tab}`) route(); else location.hash = `#search/${tab}`;
}
/** A source's latest results in a line: "42 found · 5 new · 2 fit you · 3 hours ago". */
function srcLastLine(r) {
  if (!r) return '<span class="muted">Not searched yet</span>';
  if (r.running) return `<span class="spin" data-kind="search"></span>Searching${r.searching && r.searching !== r.name ? ` ${esc(r.searching)}` : ''}…`;
  const c = r.counts || {};
  const bits = [`${c.found ?? (r.postings || []).length} found`];
  if (c.new) bits.push(`${c.new} new`);
  if (c.fits) bits.push(`<b>${c.fits} fit${c.fits === 1 ? 's' : ''} you</b>`);
  return `${bits.join(' · ')}${r.finished ? ` <span class="muted">· ${esc(ago(r.finished))}</span>` : ''}${r.error ? `<br><span class="crit-text">${esc(r.error)}</span>` : ''}`;
}
async function showSearch(arg) {
  clearTimeout(srcPoll);
  const d = await api('/api/sources/search');
  if (!location.hash.startsWith('#search')) return;
  const results = d.results || {};
  const own = Object.values(results).find(r => r.running);
  const full = d.running && !own;
  const rows = Object.fromEntries((d.sources || []).map(r => [r.id, r]));
  // The ones searched first, then those off or not set up.
  const isOff = id => ['off', 'setup', 'na'].includes(rows[id].status);
  const order = [...SEARCHABLE, 'alerts'].filter(id => rows[id]).sort((a, b) => isOff(a) - isOff(b));
  const tabs = [['sources', 'Where it looks'], ...SEARCHABLE.filter(id => results[id] && (results[id].postings || results[id].running || results[id].error))
    .map(id => [id, `${esc(results[id].name || rows[id]?.name || id)}${results[id].counts?.fits ? ` <span class="tab-n">${results[id].counts.fits}</span>` : ''}`]),
    ['setup', 'Set up sources']];
  const view = arg === 'what' || tabs.some(([id]) => id === arg) ? arg : 'sources';
  const next = d.next_search ? new Date(d.next_search) : null;
  const status = `<p class="muted small search-when">${d.last_search ? `Last full search ${esc(ago(d.last_search))}` : 'No full search yet'}${d.paused ? ` · ${esc(pausedWords(d.paused))}` : next ? ` · next ${esc(next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${d.held ? ` · ${d.held} posting${d.held === 1 ? '' : 's'} waiting to be scored <button class="btn sm" data-act="scoreHeld">Score them all now</button>` : ''}</p>`;
  const actions = `${scheduleMenu(d.paused)}${d.running ? `<button class="btn ghost danger" data-act="searchStop">Stop</button>`
    : `<button class="btn primary" data-act="run" data-task="search">${svg('search')}Search everything now</button>`}`;
  const ownCard = own ? `<section class="card progress-card"><header><h2>Searching ${esc(own.searching || own.name)}</h2><b class="pct">${d.progress?.percent ?? 0}%</b></header>
      <div class="pbar${d.progress?.paused ? ' paused' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${d.progress?.percent ?? 0}"><i style="width:${d.progress?.percent ?? 0}%"></i></div>
      <p class="muted small">${esc(d.progress?.stage || 'Starting')}${d.progress?.detail ? ` · ${esc(d.progress.detail)}` : ''}</p>
      <div class="facts small"><span><b>${d.progress?.found ?? 0}</b> found</span><span><b>${d.progress?.new ?? 0}</b> new</span><span><b>${d.progress?.scored ?? 0}</b> scored</span></div></section>` : '';
  // What you're looking for is part of Me; where Job Hunt looks, and what each place found, is part of Settings.
  if (view === 'what') return showSettings('search', '', meHead('what', 'What you\'re looking for: the titles, the places, and how picky to be. Job Hunt searches for these every day.', (settingsCache?.cvs || []).length));
  const head = `<div class="head"><div class="grow"><h1>Settings</h1></div><div class="row">${actions}</div></div>
    ${settingsTabs('sources')}
    <nav class="tabs sub-tabs">${tabs.map(([id, n]) => `<a href="#search/${id}" class="${id === view ? 'on' : ''}">${n}</a>`).join('')}</nav>
    ${status}${full ? progressHtml(d.progress) : ownCard}`;
  if (view === 'setup') return showSettings('sources', '', head);
  let body;
  if (view === 'sources') {
    const busy = d.running;
    if (!overview) await refreshOverview();
    const st = settingsCache || (settingsCache = await api('/api/settings').catch(() => null));
    const titles = [...new Set((st?.cvs || []).flatMap(c => c.titles || []))];
    const places = st?.profile?.locations || [];
    const few = (l, n) => l.slice(0, n).map(x => `<b>${esc(x)}</b>`).join(', ') + (l.length > n ? ` and ${l.length - n} more` : '');
    const looking = st ? `<section class="card looking"><div class="auto-line">${svg('search')}<span class="grow">${titles.length ? `Looking for ${few(titles, 4)}` : '<b>No job titles yet.</b> Add a CV, or add titles yourself.'}
        ${places.length ? ` in ${few(places.map(p => String(p).split(',')[0]), 4)}` : ' anywhere in the country'}${st.profile.remote_ok ? ', and remote roles' : ''}${st.profile.min_salary ? `, paying ${money(st.profile.min_salary)} or more` : ''}.</span>
        <a class="btn sm" href="#search/what">Change</a></div></section>` : '';
    const btns = (r, res) => {
      const b = [];
      const on = !['off', 'setup', 'na'].includes(r.status);
      if (SEARCHABLE.includes(r.id) && on) b.push(`<button class="btn sm" data-act="srcSearch" data-id="${esc(r.id)}" ${busy ? 'disabled' : ''} title="Search ${esc(r.name)} only, for all your job titles">${svg('search')}Search</button>`);
      if (res?.postings) b.push(`<a class="btn ghost sm" href="#search/${esc(r.id)}">Results</a>`);
      if (r.status === 'off' && (r.actions || []).includes('on')) b.push(`<button class="btn primary sm" data-act="connIndeed" data-id="${esc(r.id)}" data-on="1">Turn on</button>`);
      if (r.status === 'setup' || r.status === 'problem') b.push(`<button class="btn ghost sm" data-act="connGoto" data-to="tile-${esc(r.id)}">${r.status === 'setup' ? 'Set up' : 'Fix'}</button>`);
      return b.join('');
    };
    const sites = d.sites || [];
    const siteRows = sites.map(x => { const [cls, label] = SITE_STATE[x.state] || ['', x.state];
      return `<div class="src-site"><span class="grow"><b>${esc(x.name)}</b> <span class="pill ${cls}">${label}</span><br><span class="small muted">${esc(x.detail)}${x.at ? ` · ${esc(ago(x.at))}` : ''}</span></span>
        ${rows.agencies && !['off', 'setup'].includes(rows.agencies.status) ? `<button class="btn ghost sm" data-act="srcSearch" data-id="site:${esc(x.id)}" ${busy ? 'disabled' : ''}>Search</button>` : ''}</div>`; }).join('');
    const srcRow = id => {
      const r = rows[id], res = results[id];
      const [cls, label] = CONN_PILL[r.status] || ['', r.status];
      const off = ['off', 'setup', 'na'].includes(r.status);
      return `<div class="src-row${off ? ' off' : ''}">
        <div class="src-name"><b>${esc(r.name.replace(' (through your Claude account)', ''))}</b> <span class="pill ${cls}">${label}</span><br><span class="small muted">${esc(r.detail)}</span></div>
        <div class="src-last small">${id === 'alerts' ? '<span class="muted">Read on every email check</span>' : off ? '' : res?.postings || res?.running || res?.error ? `<a href="#search/${esc(id)}" class="plain">${srcLastLine(res)}</a>` : srcLastLine(res)}</div>
        <div class="src-acts row">${btns(r, res)}</div>
        ${id === 'agencies' && sites.length ? `<details class="src-sites"><summary class="small">${sites.length} recruiter${sites.length === 1 ? '' : 's'} and job site${sites.length === 1 ? '' : 's'}</summary>${siteRows}</details>` : ''}
      </div>`; };
    const inUse = order.filter(id => !isOff(id)), unused = order.filter(isOff);
    body = `${looking}${d.running ? '' : reportHtml(overview?.last_report)}
      <section class="card src-table"><header><h2>Where it looks</h2><span class="muted small">${inUse.length} in use</span></header>${inUse.map(srcRow).join('') || '<p class="muted">No source is on yet. Turn one on below.</p>'}
        ${unused.length ? `<details class="more src-unused"${inUse.length ? '' : ' open'}><summary><b>${unused.length} more you can turn on or set up</b></summary>${unused.map(srcRow).join('')}</details>` : ''}</section>
      <p class="muted small">Keys, company boards and which recruiters to search are set, and tested, in <a href="#search/setup">Set up sources</a>; what you're looking for is in <a href="#search/what">Me → Looking for</a>.</p>`;
  } else {
    const r = results[view];
    const f = srcFilter[view] || (srcFilter[view] = { outcome: 'all', site: '' });
    const list = r.postings || [];
    const siteNames = Object.fromEntries((d.sites || []).map(x => [x.id, x.name]));
    const inSite = list.filter(p => !f.site || p.source === f.site);
    const n = k => inSite.filter(p => k === 'all' ? p.outcome !== 'filtered' : (k === 'new' ? SRC_NEW.includes(p.outcome) : p.outcome === k)).length;
    // All: what Job Hunt kept. Postings it skipped (outside your locations, say) only under Skipped.
    const shown = inSite.filter(p => f.outcome === 'all' ? p.outcome !== 'filtered' : (f.outcome === 'new' ? SRC_NEW.includes(p.outcome) : p.outcome === f.outcome));
    const probs = (r.report?.source_problems || []);
    const errs = (r.report?.errors || []).filter(e => !e.startsWith('Stopped'));
    const sitesHere = view === 'agencies' ? [...new Set(list.map(p => p.source))] : [];
    const row = p => {
      const [cls, label] = SRC_OUTCOME[p.outcome] || ['', p.outcome];
      const fit = p.score != null ? `<span class="pill ${p.outcome === 'match' ? 'good' : ''}">${p.score}</span>` : '';
      const what = p.outcome === 'filtered' ? `Skipped: ${p.detail}` : p.outcome === 'known' && p.status ? `Already in Job Hunt · ${STAGES[p.status] || p.status}` : p.outcome === 'match' && p.status ? `${label} · ${STAGES[p.status] || p.status}` : label;
      const title = p.job ? `<a href="#job/${encodeURIComponent(p.job)}">${esc(p.title)}</a>` : p.url ? `<a href="#" data-act="link" data-url="${esc(p.url)}">${esc(p.title)}</a>` : esc(p.title);
      return `<tr class="src-${esc(p.outcome)}"><td>${title}${p.job && p.status ? closedTag({ status: p.status, closed_at: p.closed_at, deadline: p.deadline }).replace(/^/, ' ') : ''}<br><span class="muted small">${esc(p.company)}${p.location ? ` · ${esc(p.location)}` : ''}${p.remote ? ' · Remote' : ''}${view === 'agencies' && siteNames[p.source] && siteNames[p.source] !== p.company ? ` · via ${esc(siteNames[p.source])}` : ''}</span></td>
        <td class="num">${fit}</td><td class="small ${cls === 'warn' ? '' : 'muted'}">${esc(what)}</td>
        <td class="num">${p.url ? `<button class="btn ghost sm icon-only" data-act="link" data-url="${esc(p.url)}" title="Open the posting">${svg('open')}</button>` : ''}</td></tr>`;
    };
    const searchBtn = rows[view] && !['off', 'setup', 'na'].includes(rows[view].status) ? `<button class="btn" data-act="srcSearch" data-id="${esc(view)}" ${d.running ? 'disabled' : ''}>${svg('search')}Search again</button>` : '';
    body = `<section class="card"><header><h2>${esc(r.name)}</h2><div class="row">${searchBtn}${n('match') ? '<a class="btn primary" href="#applications/pick">Pick the ones to tailor</a>' : ''}</div></header>
      <p class="small">${r.running ? 'Searching now; the list below is from before.' : r.via === 'search' ? `From the full search ${esc(ago(r.finished))}.` : r.finished ? `Searched on its own ${esc(ago(r.finished))}.` : ''}
        ${list.length ? ` <b>${list.length}</b> posting${list.length === 1 ? '' : 's'}, <b>${n('new')}</b> new, <b>${n('match')}</b> fit${n('match') === 1 ? 's' : ''} you.` : r.finished ? ' Nothing found.' : ''}</p>
      ${r.error ? `<p class="small crit-text">${esc(r.error)}</p>` : ''}
      ${probs.length ? `<details class="small"><summary class="crit-text">${probs.length} search${probs.length === 1 ? '' : 'es'} couldn't be read</summary><p class="muted">${probs.slice(0, 12).map(esc).join('<br>')}</p></details>` : ''}
      ${errs.length ? `<p class="small muted">${errs.slice(0, 3).map(esc).join('<br>')}</p>` : ''}
      ${sitesHere.length > 1 ? `<div class="chips src-chips"><button class="chip ${f.site ? '' : 'on'}" data-act="srcFilter" data-site="">All sites</button>${sitesHere.map(s => `<button class="chip ${f.site === s ? 'on' : ''}" data-act="srcFilter" data-site="${esc(s)}">${esc(siteNames[s] || s)} <span class="muted">${list.filter(p => p.source === s).length}</span></button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="chips src-chips">${SRC_FILTERS.filter(([k]) => k === 'all' || n(k)).map(([k, name]) => `<button class="chip ${f.outcome === k ? 'on' : ''}" data-act="srcFilter" data-outcome="${k}">${name} <span class="muted">${n(k)}</span></button>`).join('')}</div>` : ''}
      ${shown.length ? `<div class="src-list"><table><thead><tr><th>Posting</th><th class="num">Fit</th><th>What happened</th><th></th></tr></thead><tbody>${shown.map(row).join('')}</tbody></table></div>` : list.length ? '<p class="empty">None of these.</p>' : ''}
    </section>`;
  }
  page(head + body);
  if (d.running) srcPoll = setTimeout(() => { if (location.hash.startsWith('#search')) route(); }, 1500);
}

const CONN_ACT = {
  test: () => ['Test', 'connTest'], checkClaude: () => ['Check again', 'checkClaude'], google: () => ['Connect', 'google'],
  on: () => ['Turn on', 'connIndeed', 'data-on="1"'], off: () => ['Turn off', 'connIndeed', 'data-on="0"'],
  removeBroken: r => ['Remove broken boards', 'removeBroken', `data-boards="${esc(JSON.stringify(r.data || []))}"`],
  sitesOff: r => [`Turn off the ${(r.data || []).length === 1 ? 'one' : (r.data || []).length} not working`, 'sitesOff', `data-ids="${esc(JSON.stringify(r.data || []))}"`],
  phoneTest: () => ['Send a test', 'phoneTest'], syncNow: () => ['Sync now', 'syncNow'], backupNow: () => ['Back up now', 'backupNow'],
};
let connPoll;
const USAGE_KIND = { score: 'Scoring postings', tailor: 'Tailoring CVs and letters', email: 'Reading job email', indeed: 'Searching Indeed', titles: 'Checking near-miss titles', alerts: 'Job-alert emails', employers: 'Finding employers', prep: 'Interview prep', revise: 'Your changes to documents', answers: 'Application questions', offer: 'Offers', outreach: 'Messages to contacts', insights: "What's working", thanks: 'Thank-you notes', career: 'Career paths', coach: 'Career coach', postings: 'Reading postings', followup: 'Follow-ups', ratings: 'Company ratings', 'apply-link': "Finding companies' own postings", reasons: 'Shortening fit reasons', chat: 'Ask Claude (job chat)', cv: 'Reading your CVs', fill: 'Filling in forms', recruiters: 'Finding your recruiters', salaries: 'Finding salaries' };
async function renderUsage() {
  const box = $('#usageCard'); if (!box) return;
  let u;
  try { u = await api('/api/usage'); } catch (e) { return; }
  const tok = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
  const tz = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const w = u.week.total, max = Math.max(1, ...u.per_day.map(d => d.calls));
  const held = (u.deferred || []).map(d => d.kind === 'rescore' ? 'Scoring postings again' : `Tailoring ${d.ids.length} roles`);
  const open = box.querySelector('details')?.open || !!u.limited_until;
  box.innerHTML = `<details ${open ? 'open' : ''}><summary><b>Claude usage</b> <span class="muted small">how much Job Hunt uses, and saving it for the night</span>${u.limited_until ? ` <span class="pill crit">Limit reached until ${esc(tz(u.limited_until))}</span>` : ''}</summary>
    <p class="muted small">Every request Job Hunt makes to Claude, by what it was for.${u.engine === 'code' ? ' Claude plans limit use over 5-hour windows and each week; the cost is what the same use would cost through the API, as Claude Code reports it.' : ''}</p>
    <section class="kpis" style="margin:10px 0">
      <div class="kpi"><span class="kpi-l">Last 5 hours</span><span class="kpi-v">${u.last_5h}</span><span class="kpi-s">requests</span></div>
      <div class="kpi"><span class="kpi-l">Today</span><span class="kpi-v">${u.today.total.calls}</span><span class="kpi-s">${tok(u.today.total.input + u.today.total.output)} tokens</span></div>
      <div class="kpi"><span class="kpi-l">Last 7 days</span><span class="kpi-v">${w.calls}</span><span class="kpi-s">${tok(w.input + w.output)} tokens${w.cost ? ` · ≈ $${w.cost.toFixed(2)}` : ''}</span></div>
    </section>
    <div class="cols" style="height:60px">${u.per_day.map(d => `<div class="col" data-tip="${esc(fmtDate(d.day + 'T12:00'))}: ${d.calls} requests"><span class="c" style="height:${d.calls / max * 100}%"></span></div>`).join('')}</div>
    ${u.week.kinds.length ? `<table style="margin-top:10px"><thead><tr><th>Last 7 days</th><th class="num">Requests</th><th class="num">Tokens</th><th class="num">Time</th>${w.cost ? '<th class="num">≈ Cost</th>' : ''}</tr></thead><tbody>
      ${u.week.kinds.map(k => `<tr><td>${esc(USAGE_KIND[k.kind] || k.kind)}${k.usage.errors ? ` <span class="muted small">${k.usage.errors} failed</span>` : ''}</td><td class="num">${k.usage.calls}</td><td class="num">${tok(k.usage.input + k.usage.output)}</td><td class="num">${Math.round(k.usage.secs / 60)} min</td>${w.cost ? `<td class="num">$${k.usage.cost.toFixed(2)}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing yet this week.</p>'}
    <h3 class="sub">Budget mode</h3>
    <label class="check"><input type="checkbox" data-act="budgetOn" ${u.budget.on ? 'checked' : ''}> <span>Hold big batches for the night: scoring postings again, and tailoring more than 3 roles at once. Your daily search and single roles still run right away.</span></label>
    <label class="field" style="max-width:240px">Start held batches at<select data-act="budgetHour">${[19, 20, 21, 22, 23, 0, 1, 2].map(h => `<option value="${h}" ${u.budget.hour === h ? 'selected' : ''}>${new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}</option>`).join('')}</select></label>
    <p class="muted small">When your usage limit is reached, the same batches wait and start by themselves once it resets.</p>
    ${held.length ? `<div class="row" style="margin-top:6px"><span><b>Waiting:</b> ${held.map(esc).join(', ')}</span><button class="btn sm primary" data-act="runHeld">Run now</button><button class="btn sm ghost" data-act="clearHeld">Cancel</button></div>` : ''}</details>`;
}

/** Where each place lives now that job sources have their own tab. */
const CONN_HOME = { listingsCard: 'tile-jsearch', sitesCard: 'tile-agencies', linkedinCard: 'tile-linkedin' };
let connScrollTo = null;
/** One button for a connection: Turn on, Test, Connect… */
function connBtn(r, a, testing) {
  if (a.startsWith('goto:')) {
    const to = a.slice(5);
    if (to.endsWith('Card')) return `<button class="btn ghost sm" data-act="connGoto" data-to="${esc(CONN_HOME[to] || to)}">Open</button>`;
    return `<a class="btn ghost sm" href="${{ calendar: '#settings/notifications', sources: '#search/setup', search: '#search/what' }[to] || `#settings/${esc(to)}`}">Open</a>`;
  }
  if (a.startsWith('link:')) return `<button class="btn sm" data-act="link" data-url="${esc(a.slice(5))}">Open Claude connectors</button>`;
  const [label, act, extra] = (CONN_ACT[a] || (() => [a, a]))(r);
  const cls = a === 'on' ? 'primary' : a === 'off' ? 'ghost' : r.status === 'problem' || a === 'test' ? '' : 'ghost';
  return `<button class="btn ${cls} sm" data-act="${act}" data-id="${esc(r.id)}" ${extra || ''} ${testing && act === 'connTest' ? 'disabled' : ''}>${label}</button>`;
}

/** Fill in each source's tile, and on Accounts, what needs attention (nothing shows when all is well). */
/** A running test's progress: a bar and "3 of 12 checked". */
const testBar = p => {
  const total = Math.max(1, p?.total || 0), done = Math.min(p?.done || 0, total);
  return `<span class="test-bar" title="Testing"><span class="meter"><i style="width:${Math.max(4, done / total * 100)}%"></i></span><span class="small muted">${done} of ${total} checked</span></span>`;
};
let connWasTesting = false;
async function renderConnStatus() {
  clearTimeout(connPoll);
  let d;
  try { d = await api('/api/connections'); } catch (e) { return; }
  document.querySelectorAll('[data-tile]').forEach(t => {
    const r = d.rows.find(x => x.id === t.dataset.tile);
    if (!r) return;
    const [cls, label] = CONN_PILL[r.status] || ['', r.status];
    t.querySelector('.tile-state').innerHTML = `<span class="pill ${cls}">${label}</span>`;
    t.classList.toggle('off', ['off', 'setup'].includes(r.status));
    t.classList.toggle('problem', ['problem', 'partial'].includes(r.status));
    t.querySelector('.tile-detail').innerHTML = ['off', 'setup'].includes(r.status) ? ''
      : `${esc(r.detail)}${r.at ? ` <span class="muted">· ${esc(ago(r.at))}</span>` : ''}`;
    // The one being tested shows how far along it is instead of its buttons.
    t.querySelector('.tile-acts').innerHTML = d.progress && d.progress.only === r.id ? testBar(d.progress)
      : (r.actions || []).filter(a => !a.startsWith('goto:')).map(a => connBtn(r, a, d.testing)).join('');
  });
  const box = $('#connStatus');
  if (box) {
    const probs = d.rows.filter(r => ['problem', 'partial'].includes(r.status));
    box.hidden = !probs.length;
    box.innerHTML = `<header><h2>Needs attention</h2></header>${probs.map(r => `<div class="conn-row problem">
      <span class="conn-name"><b>${esc(r.name)}</b></span><span class="grow small">${esc(r.detail)}</span>
      <span class="row todo-act">${(r.actions || []).map(a => connBtn(r, a, d.testing)).join('')}</span></div>`).join('')}`;
  }
  // Done testing: the sources page shows each site's result.
  if (connWasTesting && !d.testing && location.hash.startsWith('#search/setup')) { connWasTesting = false; settingsCache = null; route(); return; }
  connWasTesting = d.testing;
  if (d.testing) connPoll = setTimeout(() => { if (location.hash.startsWith('#settings') || location.hash.startsWith('#search/setup')) renderConnStatus(); }, 1500);
}

// ---- Settings save themselves ----
let saveTimer;
function saveState(text, cls) {
  const el = $('#saveState');
  if (el) { el.textContent = text; el.className = `save-state ${cls || ''}`; }
}
async function autosave(form) {
  try {
    const body = readProfile(form, form.dataset.part);
    // The board lists as this page last saw them, so the server keeps boards changed elsewhere.
    body.seen_sources = settingsCache.profile.sources;
    const r = await api('/api/settings/profile', { method: 'POST', body });
    delete body.seen_sources;
    settingsCache.profile = r.profile || body;
    showBoardFields();
    saveState('✓ All changes saved', 'ok');
  } catch (e) { saveState(e.message, 'err'); }
}
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const form = e.target.closest?.('form[data-form=profile]');
  if (!form || e.target.type === 'file') return;
  saveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => autosave(form), 800);
}));

// ---- Find any job (Ctrl+K) ----
/** A search over every job, company first, grouped by where it stands; Enter opens the first. */
let paletteJobs = null;
async function jobPalette() {
  if ($('.palette-back')) return;
  const back = document.createElement('div');
  back.className = 'modal-back palette-back';
  back.innerHTML = `<div class="modal palette" role="dialog" aria-modal="true" aria-label="Find a job">
    <input type="search" class="palette-q" placeholder="Find a job by company, title or place…" aria-label="Find a job">
    <div class="palette-list"><p class="muted small">Loading…</p></div>
    <p class="muted small palette-hint">↑ ↓ to choose · Enter to open · Esc to close</p></div>`;
  document.body.appendChild(back);
  const q = back.querySelector('.palette-q'), list = back.querySelector('.palette-list');
  let sel = 0, shown = [];
  const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
  const ORDER = ['ready', 'approved', 'queued', 'interviewing', 'offer', 'applied', 'saved', 'no_response', 'rejected', 'skipped', 'dismissed'];
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = j => `${j.company} ${j.title} ${j.location || ''}`.toLowerCase();
    shown = (paletteJobs || []).filter(j => words.every(w => hay(j).includes(w)))
      .sort((a, b) => (ORDER.indexOf(a.status) - ORDER.indexOf(b.status)) || (b.score || 0) - (a.score || 0)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let last = '';
    list.innerHTML = shown.length ? shown.map((j, i) => {
      const head = j.status !== last ? `<h3>${esc(STAGES[j.status] || j.status)}</h3>` : '';
      last = j.status;
      return `${head}<a class="palette-row ${i === sel ? 'on' : ''}" href="#job/${encodeURIComponent(j.id)}" data-i="${i}">${scoreBadge(j.score)}<span class="grow"><b>${esc(j.company)}</b> · ${esc(j.title)}${expiredWhy(j) ? ' <span class="pill crit expired">Expired</span>' : ''}<br><span class="muted small">${esc(j.location || '')}</span></span></a>`;
    }).join('') : `<p class="muted small">${paletteJobs ? 'No job matches.' : 'Loading…'}</p>`;
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); close(); location.hash = `#job/${encodeURIComponent(shown[sel].id)}`; }
  };
  document.addEventListener('keydown', key, true);
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('.palette-row')) close(); });
  q.addEventListener('input', () => { sel = 0; draw(); });
  q.focus();
  try { paletteJobs = (await api('/api/jobs')).jobs; } catch (e) { paletteJobs = []; }
  draw();
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); jobPalette(); }
});
/** Every key, in Job Hunt's own dialog. */
function keysHelp() {
  const rows = [['Ctrl + K', 'Find any job'], ['/', 'Search the list on this page'], ['j / k', 'Next or previous job'], ['Enter X L →', 'In the Queue: do it, not interested, later, skip'], ['↑ ↓ Space X T', 'In Pipeline, Pick: move, tick, not interested, tailor the ticked ones'], ['a', 'Approve (on a job ready to approve)'],
    ['o', 'Open the posting'], ['t', 'Tailor my CV for this role'], ['c', 'Ask Claude about this job'], ['Esc', 'Back to the list'], ['?', 'These keys']];
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Keys"><h2>Keys</h2>
    <table class="keys"><tbody>${rows.map(([k, w]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(w)}</td></tr>`).join('')}</tbody></table>
    <p class="muted small">In Review: a approve · s save for later · x not interested · n next.</p>
    <div class="modal-btns"><button class="btn primary">Close</button></div></div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?') { e.preventDefault(); close(); } };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('button')) close(); });
  document.addEventListener('keydown', key, true);
  document.body.appendChild(back);
}

// ---- Keyboard ----
// Ctrl+K find a job · / search the list · a approve · j / k next and previous job · o open the
// posting · t tailor · c ask Claude · Esc back · ? the keys
let jobOrder = [];
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ($('.modal-back')) return;
  if (e.key === 'Escape' && panelJob) { closePanel(); return; }
  const t = e.target;
  if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  if (location.hash === '#review') {
    const k = { a: '[data-act=reviewApprove]', s: '[data-status=saved]', x: '[data-status=dismissed]', n: '[data-act=reviewSkip]' }[e.key.toLowerCase()];
    const b = k && document.querySelector(`.review-bar ${k}`);
    if (b) { e.preventDefault(); b.click(); }
    return;
  }
  // Queue: decide without the mouse.
  const deck = document.querySelector('.decision[data-kind]');
  if (deck && ['Enter', 'x', 'l', 'ArrowRight', 's'].includes(e.key) && !(t && ['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && e.key === 'Enter')) {
    const b = e.key === 'Enter' ? deck.querySelector('[data-primary]') : e.key === 'x' ? deck.querySelector('[data-status=dismissed]') : e.key === 'l' ? deck.querySelector('[data-status=saved]') : deck.querySelector('[data-act=queueSkip]');
    if (b) { e.preventDefault(); b.click(); return; }
  }
  // Pick: walk the list and tick without the mouse.
  const pickRows = [...document.querySelectorAll('.pick-list .jrow.pick')].filter(r => !r.hidden);
  if (pickRows.length && ['ArrowDown', 'ArrowUp', 'j', 'k', ' ', 'Enter', 'x', 't'].includes(e.key) && !(t && ['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && [' ', 'Enter'].includes(e.key))) {
    const at = pickRows.findIndex(r => r.classList.contains('kb'));
    const cur = pickRows[at];
    if (['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key)) {
      const to = pickRows[Math.max(0, Math.min(pickRows.length - 1, at < 0 ? 0 : at + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))];
      cur?.classList.remove('kb'); to.classList.add('kb'); to.scrollIntoView({ block: 'nearest' });
      e.preventDefault(); return;
    }
    if (e.key === 't') { const b = document.querySelector('[data-pickbox] .select-bar:not([hidden]) [data-act=tailorPicked]'); if (b) { e.preventDefault(); b.click(); } else toast('Tick a role first (Space).'); return; }
    if (cur) {
      e.preventDefault();
      if (e.key === ' ') cur.querySelector('[data-pick]').click();
      else if (e.key === 'Enter') cur.querySelector('a.qt').click();
      else if (e.key === 'x') { const n = pickRows[at + 1] || pickRows[at - 1]; n?.classList.add('kb'); cur.querySelector('[data-status=dismissed]').click(); }
      return;
    }
  }
  const onJob = location.hash.startsWith('#job/');
  const id = onJob ? decodeURIComponent(location.hash.slice(5)) : null;
  if (e.key === '/') {
    const f = $('#filter') || $('#docFilter');
    if (f) { e.preventDefault(); f.focus(); }
  } else if (e.key === '?') {
    e.preventDefault(); keysHelp();
  } else if (e.key === 'o' && onJob) {
    const b = document.querySelector('.actions [data-act=open][data-what=company], .actions [data-act=open][data-what=posting]');
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 't' && onJob) {
    const b = document.querySelector('.actions [data-act=tailorPicked]');
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 'c' && onJob) {
    const b = document.querySelector('[data-jtab=chat]');
    if (b) { e.preventDefault(); b.click(); setTimeout(() => $('#chatMsg')?.focus(), 50); }
  } else if (e.key === 'Escape' && onJob) {
    history.length > 1 ? history.back() : (location.hash = '#applications');
  } else if (e.key === 'a' && onJob) {
    const b = document.querySelector('.actions [data-act=approve]');
    if (b) { e.preventDefault(); b.click(); }
  } else if ((e.key === 'j' || e.key === 'k') && onJob && jobOrder.length) {
    const i = jobOrder.indexOf(id);
    const next = jobOrder[i + (e.key === 'j' ? 1 : -1)];
    if (next) location.hash = `#job/${encodeURIComponent(next)}`;
    else toast(e.key === 'j' ? 'That was the last one in the list.' : 'That was the first one in the list.');
  }
});

// ---- actions ----
async function act(el) {
  const a = el.dataset.act;
  const jobId = main().dataset.job;
  const busy = async (fn, done) => {
    el.disabled = true;
    try { await fn(); if (done) toast(done); } catch (e) { toast(e.message, true); } finally { el.disabled = false; }
  };
  if (a === 'updatedOk') { updated = null; $('#updatedBar')?.remove(); if (el.getAttribute('href')) location.hash = el.getAttribute('href'); return; }
  if (a === 'updateLater') { updateBarLater = update?.version || null; $('#updateBar')?.remove(); return; }
  if (a === 'updateCheck') {
    return busy(async () => {
      const u = await checkUpdate();
      if (!u.error && !u.available) toast("You're on the newest version.");
      showWhatsNew();
    });
  }
  if (a === 'updateInstall') {
    return busy(async () => {
      toast('Getting the update…');
      const before = settingsCache?.app?.version || (await api('/api/settings').catch(() => null))?.app?.version || '';
      const r = await api('/api/update/install', { method: 'POST' });
      if (r.waiting) {
        const what = (r.for || []).some(n => n === 'search') ? 'the job search' : 'the tailoring';
        toast(`Installing after ${what} finishes: Job Hunt restarts by itself then. Nothing is lost.`);
        document.querySelectorAll('[data-act=updateInstall]').forEach(b => { b.disabled = true; b.textContent = `Installs after ${what}`; });
      } else if (!r.installed) { toast("You're already on the newest version."); checkUpdate(); }
      else { toast('Installing the update… Job Hunt restarts by itself in a moment.'); waitForRestart(before); }
    });
  }
  if (a === 'addBoardLink') {
    const input = $('#boardLink');
    if (!input?.value.trim()) { toast('Paste the company\'s careers link first.', true); return; }
    toast('Finding its job board…');
    return busy(async () => {
      const KIND = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', smartrecruiters: 'SmartRecruiters', workable: 'Workable', bamboohr: 'BambooHR' };
      const r = await api('/api/settings/add-board-link', { method: 'POST', body: { url: input.value.trim() } });
      toast(r.new ? `Added: ${KIND[r.board] || r.board} “${r.name}”. The next search looks at its jobs.` : `${KIND[r.board] || r.board} “${r.name}” is already in your list.`);
      input.value = '';
      await reloadBoards();
    });
  }
  if (a === 'searchHold') {
    const on = el.dataset.on === '1';
    return busy(async () => {
      const r = await api('/api/search/hold', { method: 'POST', body: { on } });
      toast(!r.running ? 'No search is running.' : on ? 'Pausing the search after the step it\'s on. Resume carries on from there.' : 'Resuming the search.');
      await refreshOverview();
      const card = $('#progressCard');
      if (card && overview?.progress) card.outerHTML = progressHtml(overview.progress);
    });
  }
  if (a === 'searchStop') {
    return busy(async () => {
      const r = await api('/api/search/stop', { method: 'POST' });
      toast(r.stopping ? 'Stopping the search after the step it\'s on. What it found so far is kept.' : 'No search is running.');
      el.disabled = true;
      await refreshOverview();
      if (location.hash.startsWith('#search')) route();
    });
  }
  if (a === 'searchPause') {
    el.closest('details')?.removeAttribute('open');
    return busy(async () => {
      const days = el.dataset.days === 'off' ? 'off' : Number(el.dataset.days);
      const r = await api('/api/search/pause', { method: 'POST', body: { days } });
      toast(r.paused ? `${pausedWords(r.paused)}. You can still search by hand.` : 'The daily search is back on.');
      await refreshOverview();
      route();
    });
  }
  if (a === 'run') {
    return busy(async () => {
      const r = await api(`/api/run/${el.dataset.task}`, { method: 'POST' });
      toast(r.started ? (el.dataset.task.startsWith('search') ? (el.dataset.task === 'search-force' ? 'Searching and re-checking postings filtered out before…' : 'Searching for jobs. New matches appear as they are tailored.') : 'Checking your email…') : 'Already running.');
      await refreshOverview();
      if (location.hash === '' || location.hash.startsWith('#overview') || location.hash.startsWith('#search')) route();
    });
  }
  if (a === 'pickFolder') {
    const input = el.closest('form')?.elements[el.dataset.into];
    try {
      const r = await api('/api/pick-folder', { method: 'POST', body: { start: input?.value || '' } });
      if (r.path && input) { input.value = r.path; input.dispatchEvent(new Event('input', { bubbles: true })); }
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (a === 'closeQuiet') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    if (!await ask(`Close ${ids.length === 1 ? 'this application' : `these ${ids.length} applications`} as No response? They move to Finished; you can reopen any of them.`, 'Close them')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'no_response', note: 'no reply after 4+ weeks' } });
      await refreshOverview(); route();
    }, 'Closed. Your Tracker now shows only what\'s still live.');
  }
  if (a === 'placePick' || a === 'placeDrop' || a === 'placeAdd') {
    const box = el.closest('[data-places]');
    let list = placesOf(box);
    const add = x => { x = x.trim(); if (x && !list.some(y => y.toLowerCase() === x.toLowerCase())) list.push(x); };
    if (a === 'placePick') add(el.dataset.place);
    if (a === 'placeDrop') list = list.filter(y => y !== el.dataset.place);
    if (a === 'placeAdd') add(box.querySelector('.place-input').value);
    placesSet(box, list);
    return;
  }
  if (a === 'welcomeRecheck') { await refreshOverview(); route(); return; }
  if (a === 'welcomeSearch') {
    return busy(async () => { await api('/api/run/search', { method: 'POST' }); await refreshOverview(); location.hash = '#overview'; }, 'Searching for jobs. Matches come to your Queue.');
  }
  if (a === 'chgEdit' || a === 'chgCancel') {
    const row = el.closest('.chg-row');
    row.querySelector('.chg-form').hidden = a === 'chgCancel';
    row.querySelector('.now').hidden = a === 'chgEdit';
    row.querySelector('.chg-acts').hidden = a === 'chgEdit';
    if (a === 'chgEdit') row.querySelector('textarea').focus();
    return;
  }
  if (a === 'chgSave' || a === 'chgPutBack') {
    const c = changeList[Number(el.dataset.i)]; if (!c) return;
    const text = a === 'chgPutBack' ? c.before : el.closest('.chg-row').querySelector('textarea').value;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/cv-edit`, { method: 'POST', body: { current: c.after, text } });
      route();
    }, a === 'chgPutBack' ? 'Put back as in your CV. Undo is at the top of CV & letter.' : 'Saved in the tailored CV.');
  }
  if (a === 'ownOff') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/own-file-off`, { method: 'POST', body: { what: el.dataset.what } }); route(); }, 'Back to Job Hunt\'s version.');
  }
  if (a === 'srcSearch') return busy(() => searchSource(el.dataset.id));
  if (a === 'contactSent') return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/contact-sent`, { method: 'POST', body: { index: Number(el.dataset.i) } }); route(); }, 'Marked sent. Job Hunt reminds you once if there\'s no reply in a week.');
  if (a === 'srcFilter') {
    const tab = location.hash.split('/')[1] || '';
    const f = srcFilter[tab] || (srcFilter[tab] = { outcome: 'all', site: '' });
    if (el.dataset.outcome != null) f.outcome = el.dataset.outcome;
    if (el.dataset.site != null) { f.site = el.dataset.site; f.outcome = 'all'; }
    route(); return;
  }
  if (a === 'connTest') {
    const sites = el.dataset.id === 'agencies' ? document.querySelectorAll('#tile-agencies [name=site]:checked, #tile-agencies .site-own').length : 0;
    return busy(async () => { await api('/api/connections/test', { method: 'POST', body: { id: el.dataset.id } }); renderConnStatus(); },
      sites ? `Testing ${sites} site${sites === 1 ? '' : 's'}… each one's result shows here when it's through.` : 'Testing…');
  }
  if (a === 'connIndeed') {
    const on = el.dataset.on === '1';
    const id = el.dataset.id || 'indeed';
    const name = el.closest('.conn-row')?.querySelector('.conn-name b')?.textContent || { linkedin: 'LinkedIn', indeed: 'Indeed' }[id] || 'It';
    return busy(async () => { await api(`/api/connections/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); settingsCache = null; route(); }, on ? `${name} is on. The next search includes it.` : `${name} is off. Its settings stay saved; turn it back on here any time.`);
  }
  if (a === 'siteAdd') {
    const box = $('#ownSites'); if (!box) return;
    box.insertAdjacentHTML('beforeend', `<div class="row site-own"><input type="text" name="own_name" placeholder="Name" style="max-width:180px"><input type="text" name="own_url" placeholder="https://… with {title} and {place}" style="flex:1"><button class="btn ghost sm" type="button" data-act="siteDrop">Remove</button></div>`);
    box.lastElementChild.querySelector('[name=own_url]').focus();
    return;
  }
  if (a === 'siteDrop') { el.closest('.site-own')?.remove(); toast('Removed. Save to keep the change.'); return; }
  if (a === 'queueView') {
    try { localStorage.setItem('jh.queueView', el.dataset.view === 'one' ? 'one' : 'list'); } catch (e) { /* storage off: it stays a list */ }
    route(); return;
  }
  if (a === 'queueSkip' || a === 'queueGo') {
    // Leave this decision for now, or go to one of the next: nothing is changed, only what's shown.
    if (a === 'queueSkip') queueSkipped.add(queueAt);
    queueAt = a === 'queueGo' ? el.dataset.id : '';
    if (a === 'queueGo') queueSkipped.delete(el.dataset.id);
    route(); window.scrollTo(0, 0);
    return;
  }
  if (a === 'panelClose') return closePanel();
  if (a === 'moreMenu') { document.body.classList.toggle('more-open'); const pop = $('#statusPop'); if (pop) pop.open = document.body.classList.contains('more-open'); renderNav(); return; }
  if (a === 'connGoto') {
    const id = CONN_HOME[el.dataset.to] || el.dataset.to, target = document.getElementById(id);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.querySelector('details')?.setAttribute('open', ''); return; }
    connScrollTo = id; location.hash = id.startsWith('tile-') ? '#search/setup' : '#settings/connections'; return;
  }
  if (a === 'reviewSkip') { reviewSkipped.add(el.dataset.job); route(); return; }
  if (a === 'reviewReset') { reviewSkipped.clear(); route(); return; }
  if (a === 'reviewApprove') {
    const id = el.dataset.job;
    if (el.dataset.email && !await ask(`Send your tailored CV and cover letter to ${el.dataset.email} from your Gmail?`, 'Send')) return;
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      await refreshOverview();
      if (r.outcome === 'applied') { toast('Sent and marked applied.'); route(); }
      else if (await applyNow(id)) route(); // on to the next to review; the form opens in your browser
      else { reviewReturn = location.hash === '#review'; location.hash = `#apply/${encodeURIComponent(id)}`; }
    });
  }
  if (a === 'applied') {
    const id = el.dataset.job;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'applied', note: 'submitted on the company site' } });
      await refreshOverview();
      toast('Marked applied. Job Hunt will remind you to follow up.');
      location.hash = reviewReturn ? '#review' : '#applications';
      reviewReturn = false;
    });
  }
  if (a === 'calMonth') {
    const d = Number(el.dataset.d), t = new Date();
    calMonth = d === 0 ? new Date(t.getFullYear(), t.getMonth(), 1) : new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1);
    route(); return;
  }
  if (a === 'calDay') {
    const box = document.getElementById(`day-${el.dataset.day}`);
    if (box) { const d = box.closest('details'); if (d) d.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    // Outside the list below: say what's on that day here.
    const items = [...el.querySelectorAll('.cal-e')].map(x => x.textContent.trim());
    toast(items.length ? items.join(' · ') : 'Nothing on that day.');
    return;
  }
  if (a === 'calAdd' || a === 'calNext') {
    const card = $('#calAddCard'); if (!card) return;
    card.hidden = a === 'calAdd' ? !card.hidden : false;
    if (el.dataset.job) {
      const sel = card.querySelector('[name=job_id]');
      // An application not in the list (an offer, say): add it, so the interview goes on the right one.
      if (![...sel.options].some(o => o.value === el.dataset.job)) sel.add(new Option(el.dataset.label || 'This application', el.dataset.job));
      sel.value = el.dataset.job;
    }
    if (!card.hidden) { card.scrollIntoView({ behavior: 'smooth' }); card.querySelector('[name=start]').focus(); }
    return;
  }
  if (a === 'calSync') {
    return busy(async () => {
      const r = await api('/api/calendar/sync', { method: 'POST', body: {} });
      const bits = [r.pushed && `${r.pushed} copied to Google`, r.moved && `${r.moved} moved`, r.removed && `${r.removed} removed`].filter(Boolean);
      route(); toast(bits.length ? `Synced: ${bits.join(', ')}.` : 'Synced. Nothing had changed.');
    });
  }
  if (a === 'calLink') {
    return busy(async () => { await api('/api/calendar/link', { method: 'POST', body: { event_id: el.dataset.id, job_id: el.dataset.job } }); route(); }, 'Linked. The application is now in Interviewing.');
  }
  if (a === 'calDelete') {
    if (!await ask('Remove this interview, with its prep time and reminders?', 'Remove', true)) return;
    return busy(async () => { await api('/api/calendar/delete', { method: 'POST', body: { id: el.dataset.id } }); route(); }, 'Removed.');
  }
  if (a === 'docFilter') { docFilter = el.dataset.f; route(); return; }
  if (a === 'pickTop') {
    const box = el.closest('[data-pickbox]');
    const all = [...box.querySelectorAll('.jrow:not([hidden]) [data-pick]')];
    const top = new Set(all.slice(0, Number(el.dataset.n)));
    all.forEach(c => { c.checked = top.has(c); });
    pickChanged(box);
    return;
  }
  if (a === 'pickShowAll') {
    const box = el.closest('[data-pickbox]');
    box.querySelectorAll('[data-pickf]').forEach(f => { if (f.type === 'checkbox') f.checked = false; else if (f.dataset.pickf !== 'sort') f.value = f.querySelector('option')?.value ?? ''; });
    applyPickView(box);
    return;
  }
  if (a === 'pickAll') {
    const box = el.closest('[data-pickbox]');
    const all = [...box.querySelectorAll('.jrow:not([hidden]) [data-pick]')];
    const on = !all.every(c => c.checked);
    all.forEach(c => { c.checked = on; });
    pickChanged(box);
    return;
  }
  if (a === 'tailorPicked') {
    const box = el.closest('[data-pickbox]');
    const ids = el.dataset.job ? [el.dataset.job] : [...box.querySelectorAll('[data-pick]:checked')].map(c => c.dataset.pick);
    if (!ids.length) return;
    return busy(async () => {
      const r = await api('/api/tailor', { method: 'POST', body: { ids } });
      if (r.deferred) { toast(`${r.deferred} See Settings → Accounts → Claude usage to run it now.`); await refreshOverview(); route(); return; }
      toast(`Tailoring ${r.started} application${r.started === 1 ? '' : 's'}. ${r.started === 1 ? 'It appears' : 'They appear'} under Ready to approve when done.`);
      await refreshOverview(); route();
    });
  }
  if (a === 'approveAll') {
    const box = el.closest('[data-approvebox]');
    const all = [...box.querySelectorAll('[data-appr]')];
    const on = !all.every(c => c.checked);
    all.forEach(c => { c.checked = on; });
    approveChanged(box);
    return;
  }
  if (a === 'approvePicked') {
    const picked = [...el.closest('[data-approvebox]').querySelectorAll('[data-appr]:checked')];
    if (!picked.length) return;
    const emails = picked.filter(c => c.dataset.email).length;
    if (!await ask(`Approve ${picked.length} application${picked.length === 1 ? '' : 's'}?${emails ? ` ${emails === 1 ? 'One applies' : `${emails} apply`} by email: the tailored CV and cover letter go out from your Gmail now.` : ''} The rest wait under Submit for you to apply on the company's site.`)) return;
    return busy(async () => {
      let sent = 0, approved = 0;
      const failed = [];
      for (const c of picked) {
        try {
          const r = await api(`/api/jobs/${encodeURIComponent(c.dataset.appr)}/approve`, { method: 'POST' });
          if (r.outcome === 'applied') sent++; else approved++;
        } catch (e) { failed.push(e.message || String(e)); }
      }
      await refreshOverview();
      toast([approved ? `${approved} approved: submit ${approved === 1 ? 'it' : 'them'} under Submit.` : '', sent ? `${sent} sent by email.` : '', failed.length ? `${failed.length} didn't go: ${failed[0]}` : ''].filter(Boolean).join(' '));
      location.hash = approved ? '#applications/submit' : '#applications/approve';
      route();
    });
  }
  if (a === 'approve') {
    if (el.dataset.email && !await ask(`Send your tailored CV and cover letter to ${el.dataset.email} from your Gmail?`)) return;
    return busy(async () => {
      const id = el.dataset.job || jobId;
      const r = await api(`/api/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      await refreshOverview();
      if (r.outcome === 'applied') { toast('Sent. Marked as applied.'); route(); }
      else if (!await applyNow(id)) location.hash = `#apply/${encodeURIComponent(id)}`;
      else route();
    });
  }
  if (a === 'syncResume') {
    return busy(async () => { await api('/api/sync/resume', { method: 'POST' }); await refreshOverview(); route(); }, 'Switching back here… when the other computer\'s data arrives, Continue from it in the Queue.');
  }
  if (a === 'syncContinue') {
    if (!await ask('Continue from the other computer\'s data? Job Hunt restarts with it.')) return;
    return busy(async () => { await api('/api/sync/continue', { method: 'POST', body: { folder: el.dataset.folder } }); toast('Continuing… Job Hunt restarts in a moment.'); setTimeout(() => location.reload(), 6000); });
  }
  if (a === 'syncDecline') {
    if (!await ask('Keep this computer\'s data? The next sync replaces the other computer\'s copy with this one.')) return;
    return busy(async () => { await api('/api/sync/decline', { method: 'POST', body: { saved_at: el.dataset.saved } }); await refreshOverview(); route(); }, 'Keeping this computer\'s data.');
  }
  if (a === 'syncNow') return busy(async () => { await api('/api/sync/now', { method: 'POST' }); route(); }, 'Synced.');
  if (a === 'takeOver') {
    if (!await ask('Take over here? The other computer saves its latest data and stops, then this one offers to continue from it.')) return;
    return busy(async () => { const r = await api('/api/sync/takeover', { method: 'POST' }); toast(`Asked ${r.from} to hand over. This takes a few minutes.`); await refreshOverview(); route(); });
  }
  if (a === 'testSources') return busy(() => showSourceTest(true));
  if (a === 'answers') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/answers`, { method: 'POST', body: { questions: $('#questions').value } }); setTimeout(route, 300); }, 'Writing answers…');
  }
  if (a === 'offerAdvice') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/offer`, { method: 'POST', body: { offer: $('#offerText').value } }); setTimeout(route, 300); }, 'Weighing the offer…');
  }
  if (a === 'palette') return jobPalette();
  if (a === 'pickClear' || a === 'approveClear') {
    const box = el.closest('[data-pickbox], [data-approvebox]');
    box.querySelectorAll('[data-pick]:checked, [data-appr]:checked').forEach(c => { c.checked = false; });
    return a === 'pickClear' ? pickChanged(box) : approveChanged(box);
  }
  if (a === 'pickStale') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    if (!ids.length || !await ask(`Set aside ${ids.length === 1 ? 'the one posting' : `the ${ids.length} postings`} that ${ids.length === 1 ? 'has' : 'have'} been up for more than three weeks or expired? ${ids.length === 1 ? 'It goes' : 'They go'} to Pipeline under Not interested, where you can still tailor ${ids.length === 1 ? 'it' : 'any of them'}. It doesn't change how Job Hunt scores.`, 'Set them aside')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'dismissed', note: 'older than three weeks', learn: false } });
      await refreshOverview(); route(); toast(`${ids.length} set aside.`);
    });
  }
  if (a === 'dismissPicked') {
    const ids = [...el.closest('[data-pickbox]').querySelectorAll('[data-pick]:checked')].map(c => c.dataset.pick);
    // Set aside without changing how Job Hunt scores: to teach it, use Not interested on one job
    // and choose "and learn from it".
    const learn = false;
    if (!ids.length || !await ask(`Not interested in ${ids.length === 1 ? 'this one' : `these ${ids.length}`}? ${ids.length === 1 ? 'It goes' : 'They go'} to All jobs under Not interested. It doesn't change how Job Hunt scores.`, 'Not interested')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'dismissed', note: '', learn } });
      await refreshOverview(); route(); toast(`${ids.length} set aside as not interested.`);
    });
  }
  if (a === 'resultsDays') {
    resultsDays = Number(el.dataset.days);
    try { localStorage.setItem('jh.resultsDays', String(resultsDays)); } catch (e) {}
    return route();
  }
  if (a === 'chatSend') {
    const msg = $('#chatMsg').value.trim();
    if (!msg) { toast('Write a message first.', true); return; }
    jobTabs[jobId] = 'chat';
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/chat`, { method: 'POST', body: { message: msg } }); setTimeout(route, 300); });
  }
  if (a === 'chatClear') {
    if (!await ask('Start the conversation over? This one is deleted.')) return;
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/chat`, { method: 'POST', body: { clear: true } }); route(); });
  }
  if (a === 'forgetNetwork') {
    if (!await ask('Remove your LinkedIn connections from Job Hunt?')) return;
    return busy(async () => { await api('/api/network/forget', { method: 'POST' }); route(); }, 'Removed.');
  }
  if (a === 'askReferral') {
    const list = JSON.parse(main().dataset.contacts || '[]');
    const p = JSON.parse(el.dataset.person);
    let i = list.findIndex(c => c.name === p.name);
    if (i < 0) {
      list.push({ name: p.name, role: p.position || '', email: p.email || '', link: p.link || '', note: 'A LinkedIn connection of mine who works there. Ask, warmly and briefly, whether they would refer me or pass my CV to the hiring manager, and offer to send the posting and my CV.' });
      i = list.length - 1;
    }
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, { method: 'POST', body: { contacts: list } });
      await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: i } });
      setTimeout(route, 300);
    }, `Writing to ${firstName(p.name)}…`);
  }
  if (a === 'outreach') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: Number(el.dataset.i) } }); setTimeout(route, 300); }, 'Writing the message…');
  }
  // A note to the recruiter, with no name needed: added as a contact, then written.
  if (a === 'findPeople') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/find-people`, { method: 'POST' }); setTimeout(route, 300); },
      'Looking on LinkedIn for the recruiter, then writing the note. This takes a minute or two.');
  }
  if (a === 'noteRecruiter') {
    const list = JSON.parse(main().dataset.contacts || '[]');
    const name = el.dataset.name;
    list.push({ name: name || 'Recruiter', role: 'Recruiter', email: el.dataset.email || '', link: '', note: name ? '' : 'Name not known yet: greet them without a name ("Hello,"), never "Dear Recruiter".' });
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, { method: 'POST', body: { contacts: list } });
      await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: list.length - 1 } });
      setTimeout(route, 300);
    }, 'Writing the note…');
  }
  if (a === 'addContact' || a === 'removeContact') {
    const list = JSON.parse(main().dataset.contacts || '[]');
    if (a === 'addContact') {
      const name = $('#cName').value.trim(), extra = $('#cEmail').value.trim();
      if (!name) { toast('Add their name.', true); return; }
      list.push({ name, role: $('#cRole').value.trim(), email: extra.includes('@') && !extra.startsWith('http') ? extra : '', link: extra.startsWith('http') ? extra : '' });
    } else list.splice(Number(el.dataset.i), 1);
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, { method: 'POST', body: { contacts: list } }); route(); });
  }
  if (a === 'coachRun') {
    return busy(async () => { const r = await api('/api/coach/run', { method: 'POST' }); if (!r.started) toast('Your coach is already thinking, or Claude isn\'t connected.'); route(); }, 'Your coach is looking at the skills you\'re missing. This takes a minute or two.');
  }
  if (a === 'titleIdea') {
    const add = !!el.dataset.add;
    return busy(async () => {
      await api('/api/titles/idea', { method: 'POST', body: { title: el.dataset.title, add } });
      settingsCache = null; await refreshOverview(); route();
      toast(add ? `Added “${el.dataset.title}”. The next search looks for it.` : 'Dropped.');
    });
  }
  if (a === 'careerJump') { document.getElementById(`path-${el.dataset.i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (a === 'career') {
    const here = location.hash;
    return busy(async () => { await api('/api/results/career', { method: 'POST' }); settingsCache = null; route(); watchCareer(here); }, 'Claude is thinking about your career options. This takes a minute or two.');
  }
  if (a === 'addTitles') {
    const titles = JSON.parse(el.dataset.titles || '[]');
    const sel = document.querySelector(`[data-path-track="${el.dataset.i}"]`);
    return busy(async () => {
      const track = sel ? sel.value : (settingsCache || await api('/api/settings')).profile.tracks[0].name;
      const x = await api('/api/results/add-titles', { method: 'POST', body: { track, titles } }); settingsCache = null; route(); toast(x.added ? `Added ${x.added} title${x.added === 1 ? '' : 's'}. The next search looks for them.` : 'Those titles are already in your search.'); });
  }
  if (a === 'bankAdd') {
    const list = $('#bankCard .bank') || (() => { $('#bankCard .empty')?.remove(); const d = document.createElement('div'); d.className = 'bank'; $('#bankCard .row').before(d); return d; })();
    list.insertAdjacentHTML('beforeend', `<div class="bank-row"><input type="text" class="bank-q" placeholder="The question, as forms ask it" aria-label="Question"><input type="text" class="bank-a" placeholder="Your answer" aria-label="Your answer"><span></span><span></span></div>`);
    if (!$('#bankCard [data-act=bankSave]')) $('#bankCard .row').insertAdjacentHTML('beforeend', '<button class="btn primary" data-act="bankSave">Save changes</button>');
    list.lastElementChild.querySelector('input').focus();
    return;
  }
  if (a === 'bankSave' || a === 'bankDrop') {
    const rows = bankRows().filter((_, i) => a !== 'bankDrop' || i !== Number(el.dataset.i));
    return busy(async () => { await api('/api/answer-bank', { method: 'POST', body: { answers: rows } }); renderBank(); }, a === 'bankDrop' ? 'Forgotten.' : 'Saved.');
  }
  if (a === 'rescanSalaries') {
    return busy(async () => { const r = await api('/api/salaries/rescan', { method: 'POST' }); if (!r.started) toast('Already looking.'); },
      'Looking for the pay of every posting without one: its text, its page and the company\'s own posting. A notice says what was found.');
  }
  if (a === 'saveCompanyNotes') {
    return busy(async () => { await api('/api/company-notes', { method: 'POST', body: { company: el.dataset.company, notes: $('#companyNotes').value } }); }, 'Saved. They show on every role at this company.');
  }
  if (a === 'reuseCv') {
    if (!await ask('Use the CV you sent this company before, word for word? Undo puts this one back.', 'Use it')) return;
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/reuse-cv`, { method: 'POST' }); route(); }, 'Now the same CV as before. Undo last CV change puts this one back.');
  }
  if (a === 'revisionSeen') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/revision-seen`, { method: 'POST' }); route(); });
  }
  if (a === 'appliedAll') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    if (!await ask(`Mark all ${ids.length} as applied?`, 'Mark them applied')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/submitted`, { method: 'POST' });
      await refreshOverview(); route();
    }, `Marked ${ids.length} as applied. Job Hunt reminds you to follow up on each.`);
  }
  if (a === 'applyAll') { applyRun = { list: JSON.parse(el.dataset.ids || '[]'), at: 0, done: 0 }; return runOpen(); }
  if (a === 'runApplied') {
    const cur = applyRun?.list[applyRun.at];
    if (!cur) return;
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(cur.id)}/submitted`, { method: 'POST' }); applyRun.done++; applyRun.at++; await runOpen(); refreshOverview().then(() => { if (/^#(overview|applications)/.test(location.hash)) route(); }); });
  }
  if (a === 'runSkip') { if (applyRun) { applyRun.at++; return runOpen(); } return; }
  if (a === 'runAgain') { if (applyRun) return runOpen(); return; }
  if (a === 'queueFClear') { document.querySelectorAll('[data-queuef]').forEach(c => { if (c.type === 'checkbox') c.checked = false; }); return applyQueueView(false); }
  if (a === 'runStop') { applyRun = null; return runBar(); }
  if (a === 'fillBrowser') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/fill-browser`, { method: 'POST' });
      await api('/api/open-url', { method: 'POST', body: { url: r.url } });
      refreshOverview();
    }, 'Opened in your browser. On the form, click the Job Hunt extension and press Fill this form.');
  }
  if (a === 'fillForm') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/fill`, { method: 'POST' }); refreshOverview(); },
      'Opening the posting in a Job Hunt window. Get to the form; Job Hunt fills it in, and you press Submit.');
  }
  if (a === 'askRecruiter') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/ask-recruiter`, { method: 'POST' });
      await refreshOverview(); route();
      toast(r.drafted ? `The email to ${r.name} is in your Gmail drafts. Read it over, then send it.` : `Written: it's on the application's Apply tab under People, to copy into an email to ${r.to}.`);
    }, `Writing to ${el.dataset.name || 'them'}…`);
  }
  if (a === 'recruiterScan') {
    return busy(async () => { const r = await api('/api/recruiters/scan', { method: 'POST' }); toast(r.started === false ? 'Already looking.' : 'Looking through your email for recruiters. A notice comes when it\'s done, in a few minutes.'); setTimeout(() => { if (['#recruiters', '#inbox/recruiters'].includes(location.hash)) route(); }, 4000); });
  }
  if (a === 'recruiterNew') { const f = $('#recruiterNew'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('[name=name]').focus(); return; }
  if (a === 'recruiterEdit') { const f = el.closest('.rec')?.querySelector('.rec-edit'); if (f) f.hidden = !f.hidden; return; }
  if (a === 'recruiterHide') {
    return busy(async () => { await api('/api/recruiters/hide', { method: 'POST', body: { email: el.dataset.email, hidden: el.dataset.hidden === '1' } }); route(); });
  }
  if (a === 'weeklyNow') {
    return busy(async () => { const r = await api('/api/weekly/send', { method: 'POST' }); toast(r.emailed ? 'Sent. Check your inbox.' : 'Sent as a notice. Connect Gmail and tick the email option to get the whole review by email.'); });
  }
  if (a === 'runHeld') {
    return busy(async () => { await api('/api/usage/run-held', { method: 'POST' }); renderUsage(); refreshOverview(); }, 'Started.');
  }
  if (a === 'clearHeld') {
    return busy(async () => { await api('/api/usage/clear-held', { method: 'POST' }); renderUsage(); refreshOverview(); }, 'Cancelled.');
  }
  if (a === 'insights') {
    return busy(async () => { await api('/api/results/insights', { method: 'POST' }); route(); setTimeout(() => { if (location.hash === '#results') route(); }, 30000); }, 'Claude is looking at your results. This takes a minute.');
  }
  if (a === 'copyPhone') {
    const st = await api('/api/settings');
    try { await navigator.clipboard.writeText(phoneBookmark(st)); toast('Copied. Send it to your phone and paste it as a bookmark\'s address.'); } catch (e) { toast('Couldn\'t copy.', true); }
    return;
  }
  if (a === 'scoreHeld') {
    if (!confirm('Score every waiting posting now? It uses your Claude plan (about one request per posting, in batches of 25), and stops at its usage limit; the rest then wait for the usual batches.')) return;
    return busy(async () => { await api('/api/run/score-held', { method: 'POST' }); refreshOverview(); }, 'Scoring them all: matches show up under Pick as they come in.');
  }
  if (a === 'copyShare') {
    const st = await api('/api/settings');
    try { await navigator.clipboard.writeText(`${st.phone_url}/m/add?k=${encodeURIComponent(st.ext_key)}&u=`); toast('Copied. Send it to your phone for the shortcut.'); } catch (e) { toast('Couldn\'t copy.', true); }
    return;
  }
  if (a === 'phoneTailscale') return busy(async () => { await api('/api/phone', { method: 'POST', body: { action: 'tailscale' } }); route(); }, 'Set up: Job Hunt can be reached from your phone through Tailscale.');
  if (a === 'phoneSave') return busy(async () => { await api('/api/phone', { method: 'POST', body: { url: $('#phoneUrl').value } }); route(); }, 'Saved.');
  if (a === 'phoneReset') return busy(async () => { await api('/api/phone', { method: 'POST', body: { url: '' } }); route(); });
  if (a === 'copyBookmarklet') {
    try { await navigator.clipboard.writeText(bookmarklet()); toast('Copied. Paste it as the URL of a new bookmark.'); } catch (e) { toast('Couldn\'t copy. Drag the blue button to your bookmarks bar instead.', true); }
    return;
  }
  if (a === 'addClaudeDesktop') {
    return busy(async () => { await api('/api/settings/claude-desktop', { method: 'POST' }); route(); }, 'Added. Quit Claude Desktop fully and open it again.');
  }
  if (a === 'phone') return busy(async () => { await api('/api/settings/phone', { method: 'POST', body: { on: el.dataset.on === '1' } }); route(); }, el.dataset.on === '1' ? 'Turned on. Now subscribe on your phone.' : 'Turned off.');
  if (a === 'phoneTest') return busy(() => api('/api/settings/phone-test', { method: 'POST' }), 'Sent. It should be on your phone now.');
  if (a === 'otherModels') {
    const form = el.closest('form'), f = form.elements;
    return busy(async () => {
      const r = await api('/api/settings/other/models', { method: 'POST', body: { url: f.service.value || f.url.value, key: f.key.value } });
      const had = f.model.value;
      f.model.innerHTML = r.models.length ? r.models.map(m => `<option ${m === had ? 'selected' : ''}>${esc(m)}</option>`).join('') : '<option value="">It lists no models</option>';
      toast(r.models.length ? `It answered: ${r.models.length} model${r.models.length === 1 ? '' : 's'}. Choose one, then Save.` : 'It answered, but lists no models.');
    }, 'Checking…');
  }
  if (a === 'otherForget') {
    if (!await ask('Remove the other AI and its key? Claude does everything again.', 'Remove it')) return;
    return busy(async () => { await api('/api/settings/other', { method: 'POST', body: { forget: true } }); toast('Removed.'); route(); });
  }
  if (a === 'gapsAdd') {
    const have = [...el.closest('[data-gaps]').querySelectorAll('input:checked')].map(c => c.value);
    if (!have.length) return toast('Tick the keywords you really have first.', true);
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/revise`, { method: 'POST', body: { what: 'cv', note: `I do have real experience with each of these, though my CV doesn't say so: ${have.join(', ')}. Work each one into the CV where it honestly fits, in the posting's own wording. Change nothing else.` } });
      await refreshOverview(); setTimeout(route, 300);
    }, 'Working them in…');
  }
  if (a === 'revise') {
    const what = $('#reviseWhat').value, note = $('#reviseNote').value.trim();
    if (!note) { toast('Say what to change first.', true); return; }
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/revise`, { method: 'POST', body: { what, note } }); await refreshOverview(); setTimeout(route, 300); }, 'Making the change…');
  }
  if (a === 'undoRevision') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/undo`, { method: 'POST', body: { what: el.dataset.what } }); route(); }, 'Put back as it was.');
  }
  if (a === 'thanks') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/thanks`, { method: 'POST' }); setTimeout(route, 300); }, 'Writing the thank-you note…');
  }
  if (a === 'followUpAll') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/followup`, { method: 'POST' });
      document.querySelectorAll('[data-act=followUp]').forEach(b => { if (ids.includes(b.dataset.job)) b.outerHTML = '<span class="muted small"><span class="spin" data-kind="followup"></span>Writing…</span>'; });
      el.remove();
    }, `Writing ${ids.length} follow-ups. Read each one before you send it.`);
  }
  if (a === 'followUp') {
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/followup`, { method: 'POST' });
      if (location.hash.startsWith('#job/')) setTimeout(route, 300);
      else el.outerHTML = '<span class="muted small"><span class="spin" data-kind="followup"></span>Writing…</span>';
    }, 'Writing the follow-up…');
  }
  if (a === 'bookmarkSetup') {
    return busy(async () => { await api('/api/bookmark-page', { method: 'POST', body: { html: await bookmarkPage() } }); }, 'The setup page opened in your browser.');
  }
  if (a === 'copyText') {
    try { await navigator.clipboard.writeText(el.dataset.text || ''); toast('Copied.'); } catch (e) { toast('Select the text and copy it.', true); }
    return;
  }
  if (a === 'copyOpen') {
    const text = $(`#${el.dataset.from}`)?.textContent || '';
    try { await navigator.clipboard.writeText(text); } catch (e) { return toast('Select the note and copy it, then open their profile.', true); }
    return api('/api/open-url', { method: 'POST', body: { url: el.dataset.url } }).then(() => toast('Copied. On their profile: Connect, Add a note, paste, Send. Then press I sent it here.')).catch(e => toast(e.message, true));
  }
  if (a === 'copy') {
    const text = $(`#${el.dataset.from}`)?.textContent || '';
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Select the text and copy it.', true); }
    return;
  }
  if (a === 'useDrive') { const f = el.closest('form'); f.elements.dir.value = el.dataset.path; return; }
  if (a === 'backupNow') {
    return busy(async () => { const r = await api('/api/backup/now', { method: 'POST' }); toast(`Backed up: ${r.file}`); route(); });
  }
  if (a === 'suggestBoards') {
    // The list appears in the box named by data-into (or the one in this card).
    const box = (el.dataset.into && document.getElementById(el.dataset.into)) || el.closest('section')?.querySelector('.ideas') || $('#boardIdeas');
    return busy(async () => {
      box.innerHTML = '<p class="muted small"><span class="spin" data-kind="employers"></span>Claude is picking employers near you, and Job Hunt is checking each one\'s job board. This takes a minute or two…</p>';
      try {
        const { boards } = await api('/api/settings/suggest-boards', { method: 'POST' });
        box.dataset.ideas = JSON.stringify(boards);
        box.innerHTML = boards.length ? `<div class="card ideas-card">
          <p><b>${boards.length} employers with live job boards.</b> The ones with matching jobs are ticked.</p>
          <table><tbody>${boards.map((b, i) => `<tr><td><label class="check"><input type="checkbox" data-idea="${i}" ${b.matching ? 'checked' : ''}> ${esc(b.company)}</label></td>
            <td class="small muted">${esc(b.board)}</td><td class="small">${b.matching} of ${b.jobs} jobs match</td></tr>`).join('')}</tbody></table>
          <div class="row"><button class="btn primary" type="button" data-act="addIdeas">Add ticked and search</button></div></div>`
          : '<p class="muted">None of the suggested employers had a live job board this time. Try again later, or add companies yourself in Search → Set up sources → Company job boards.</p>';
      } catch (e) { box.innerHTML = ''; throw e; }
    });
  }
  if (a === 'addIdeas') {
    const box = el.closest('[data-ideas]');
    const boards = JSON.parse(box?.dataset.ideas || '[]');
    const pick = [...box.querySelectorAll('[data-idea]:checked')].map(c => boards[Number(c.dataset.idea)]);
    if (!pick.length) { toast('Tick at least one.', true); return; }
    return busy(async () => {
      const r = await api('/api/settings/add-boards', { method: 'POST', body: { boards: pick } });
      await api('/api/run/search', { method: 'POST' });
      toast(`Added ${r.added} job board${r.added === 1 ? '' : 's'}. Searching them now.`);
      await refreshOverview(); route();
    });
  }
  if (a === 'sitesOff') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    return busy(async () => {
      await api('/api/settings/sites-off', { method: 'POST', body: { ids } });
      settingsCache = null; await refreshOverview(); route();
    }, `Turned off ${ids.length} site${ids.length === 1 ? '' : 's'} that couldn't be read. Turn any back on in Search → Set up sources.`);
  }
  if (a === 'removeBroken' || a === 'removeBoard') {
    const boards = a === 'removeBoard' ? [{ source: el.dataset.source, name: el.dataset.name }] : JSON.parse(el.dataset.boards || '[]');
    return busy(async () => {
      const r = await api('/api/settings/remove-boards', { method: 'POST', body: { boards } });
      toast(`Removed ${r.removed} board${r.removed === 1 ? '' : 's'}.`);
      if (a === 'removeBoard') { el.closest('tr').remove(); await reloadBoards(); } else { await refreshOverview(); route(); }
    });
  }
  if (a === 'tailorAnyway') {
    const id = el.dataset.job;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, { method: 'POST', body: { track: '' } });
      toast('Tailoring your CV and a cover letter for it. It appears under Ready to approve and on the Tracker.');
      await refreshOverview(); setTimeout(route, 300);
    });
  }
  if (a === 'rescore') {
    const group = el.dataset.group;
    const plan = await api(`/api/rescore?group=${group}`).catch(e => { toast(e.message, true); return null; });
    if (!plan) return;
    if (plan.running) { toast('Postings are being scored again already.'); return; }
    if (!plan.postings) { toast('Nothing to score again.'); return; }
    const r = await dialog({
      title: `Score ${plan.postings} posting${plan.postings === 1 ? '' : 's'} again?`,
      text: `Against your CVs and settings as they are now. ${plan.filtered ? `${plan.filtered} no longer pass your filters (no Claude needed). ` : ''}${plan.to_score} need Claude: ${plan.this_run} now${plan.to_score > plan.this_run ? ` (your limit per search; run it again for the rest)` : ''}, one request each. Anything you've tailored, saved or applied to stays as it is.`,
      buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: `Score ${plan.this_run || 'them'} again`, value: 'go', kind: 'primary' }],
    });
    if (!r) return;
    return busy(async () => { const x = await api('/api/rescore', { method: 'POST', body: { group } }); toast(x.deferred ? x.deferred : 'Scoring them again. You get a notice when it\'s done.'); });
  }
  if (a === 'setupSkip') {
    return busy(async () => { await api('/api/setup-skip', { method: 'POST', body: { what: el.dataset.what } }); await refreshOverview(); route(); });
  }
  if (a === 'fillFromLink') {
    const f = el.closest('form').elements;
    if (!f.url.value.trim()) { toast('Paste the posting\'s link first.', true); return; }
    toast('Reading the posting…');
    return busy(async () => {
      const p = await api('/api/read-link', { method: 'POST', body: { url: f.url.value } });
      for (const k of ['company', 'title', 'location', 'description']) if (p[k] && !f[k].value.trim()) f[k].value = p[k];
      toast(p.company && p.title ? 'Filled in from the posting. Check it, then add it.' : 'Read the posting; fill in what\'s missing.');
    });
  }
  if (a === 'scoreAnyway') {
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/score`, { method: 'POST' });
      el.outerHTML = '<span class="muted small"><span class="spin" data-kind="score"></span>Scoring… if it clears your fit bar it\'s tailored and appears under Ready to approve.</span>';
    });
  }
  if (a === 'prep') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/prep`, { method: 'POST' }); await refreshOverview(); setTimeout(route, 300); }, 'Writing your interview prep…');
  }
  if (a === 'stage' || a === 'setStage') {
    const id = el.dataset.job || jobId;
    let status = a === 'stage' ? el.dataset.status : $('#stage').value;
    const from = el.dataset.from || main().dataset.status || '';
    let note = a === 'setStage' ? $('#stageNote').value : '';
    let learn = true;
    if (status === 'dismissed' && !note) {
      const r = await dialog({
        title: 'Not interested in this role?',
        text: 'It goes to All jobs under Not interested. Job Hunt can also learn from it and score roles like it lower, or you can keep it as a backup.',
        input: 'Why not? (optional)', placeholder: 'e.g. too junior, sales role, too far',
        buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save for later', value: 'saved' },
          { label: 'Not interested, and learn from it', value: 'learn' }, { label: 'Not interested', value: 'quiet', kind: 'primary' }],
      });
      if (!r) return;
      if (r.value === 'saved') status = 'saved';
      learn = r.value === 'learn';
      note = r.text;
    }
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, note, learn } });
      await refreshOverview(); route();
      // A slip is easy to make from a list: offer to put it back.
      if (from && from !== status) {
        toast(`Moved to ${STAGES[status]}.`, false, { label: 'Undo', run: async () => {
          try { await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: from, note: 'undone' } }); toast(`Back to ${STAGES[from]}.`); await refreshOverview(); route(); }
          catch (e) { toast(e.message, true); }
        } });
      } else toast(`Moved to ${STAGES[status]}.`);
    });
  }
  if (a === 'open') return busy(async () => follow(await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/open`, { method: 'POST', body: { what: el.dataset.what } })));
  if (a === 'rateCompany') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/rating`, { method: 'POST' });
      toast(r.rating?.found ? `Employees rate it ${r.rating.rating.toFixed(1)} out of 5.` : 'No employee reviews found for this company.', !r.rating?.found);
      route();
    }, 'Looking up employee reviews (a minute or two)…');
  }
  if (a === 'syncOn') {
    return busy(async () => {
      const r = await api('/api/sync/settings', { method: 'POST', body: { where: 'drive', on: true } });
      settingsCache = null; await refreshOverview(); route();
      toast(r.sync.newer ? `Job Hunt on ${r.sync.newer.device} has newer data in your Google Drive. Choose whether to continue from it.` : 'Synced and backed up to the Job Hunt folder in your Google Drive. It keeps itself up to date.');
    }, 'Saving a copy to your Google Drive…');
  }
  if (a === 'findApply') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/apply-link`, { method: 'POST' });
      toast(r.url ? 'Found it on the company\'s site.' : 'Couldn\'t find it on the company\'s own site; apply through the posting.', !r.url);
      route();
    }, 'Looking on the company\'s site (a minute or two)…');
  }
  if (a === 'saveLetter') return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/letter`, { method: 'POST', body: { text: $('#letter').value } }); route(); }, 'Cover letter saved.');
  if (a === 'saveNotes') return busy(() => api(`/api/jobs/${encodeURIComponent(jobId)}/notes`, { method: 'POST', body: { text: $('#notes').value } }), 'Notes saved.');
  if (a === 'retailor') {
    const track = el.dataset.pick ? $('#track').value : '';
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/tailor`, { method: 'POST', body: { track } }); await refreshOverview(); setTimeout(route, 300); }, 'Tailoring…');
  }
  if (a === 'link') return api('/api/open-url', { method: 'POST', body: { url: el.dataset.url } }).then(follow).catch(e => toast(e.message, true));
  if (a === 'folder') return api('/api/open-folder', { method: 'POST', body: { which: el.dataset.which } }).catch(e => toast(e.message, true));
  if (a === 'openCv') return api(`/api/cvs/${encodeURIComponent(el.dataset.track)}/open`, { method: 'POST' }).then(follow).catch(e => toast(e.message, true));
  if (a === 'google') {
    return busy(async () => {
      const r = await api('/api/settings/google-connect', { method: 'POST' });
      // On the server or a phone: sign in in this browser, then paste back where Google ends up.
      if (r.paste) { const box = $('#googlePaste'); box.innerHTML = googlePasteBox(r.url); box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      toast('A Google sign-in page opened in your browser. Approve access there.'); pollSettings();
    });
  }
  if (a === 'googleFinish') {
    const url = $('#googlePasteUrl')?.value.trim();
    if (!url) { toast('Paste the address from the page that didn\'t open first.', true); return; }
    return busy(async () => {
      const r = await api('/api/settings/google-finish', { method: 'POST', body: { url } }); settingsCache = null; await refreshOverview();
      // Data from another computer waiting in Google Drive: the Overview offers it.
      if (overview.sync_newer) location.hash = '#overview'; else route();
      toast(`Google connected${r.email ? ` for ${r.email}` : ''}.${overview.sync_newer ? ` Job Hunt on ${overview.sync_newer.device} has data to continue from.` : ''}`);
    });
  }
  if (a === 'forget') {
    const what = { claude: 'the Claude key', google: 'Google', adzuna: 'the Adzuna key', jsearch: 'the JSearch key', jooble: 'the Jooble key', apify: 'the Apify token', signature: 'your signature' }[el.dataset.what];
    if (!await ask(`Remove ${what} from Job Hunt?`)) return;
    return busy(async () => { await api(`/api/settings/forget/${el.dataset.what}`, { method: 'POST' }); await refreshOverview(); route(); }, 'Removed.');
  }
  const cvId = el.dataset.track;
  if (a === 'saveCv') {
    const card = el.closest('[data-cv]');
    const val = k => card.querySelector(`[data-k=${k}]`).value;
    return busy(async () => { await api(`/api/cvs/${encodeURIComponent(cvId)}/meta`, { method: 'POST', body: { label: val('label'), titles: fromLines(val('titles')), keywords: fromLines(val('keywords')), letter_style: val('letter_style') } }); route(); }, 'Saved.');
  }
  if (a === 'suggestCv') {
    return busy(async () => { toast('Claude is reading your whole CV for every field you could work in…'); await api(`/api/cvs/${encodeURIComponent(cvId)}/suggest`, { method: 'POST' }); settingsCache = null; route(); }, 'More titles added to yours, with the areas of experience Claude found.');
  }
  if (a === 'convertCv') {
    return busy(async () => { toast('Converting with Claude. This can take a minute…'); await api(`/api/cvs/${encodeURIComponent(cvId)}/convert`, { method: 'POST' }); await refreshOverview(); route(); }, 'Converted. Open it to check.');
  }
  if (a === 'removeCv') {
    if (!await ask('Remove this CV from Job Hunt? Jobs it scored are scored again against your other CVs, and applications tailored from it that are waiting for your approval are tailored again from the CV that fits best. Ones you\'ve edited, approved or sent stay as they are; on a re-tailored one, Undo last CV change and Undo last letter change bring back what it had. If this is your only CV, it all happens when you add your next one.')) return;
    return busy(async () => {
      const r = await api(`/api/cvs/${encodeURIComponent(cvId)}/remove`, { method: 'POST' });
      await refreshOverview(); route();
      toast(overview?.setup?.cvs ? `Removed.${cvChangeNote(r.change)}` : 'Removed. Jobs it scored and tailored are redone as soon as you add a CV.');
    });
  }
  if (a === 'checkClaude') { const w = $('#welcomeClaude'); if (w) return welcomeClaude(true); return checkClaude(true); }
  if (a === 'claudeSetup') {
    await busy(el, async () => { await api('/api/claude/setup', { method: 'POST', body: { install: el.dataset.install === '1' } }); });
    toast('Follow the steps in the window that opened. Job Hunt checks by itself.');
    watchClaude();
    return;
  }
}

/** What a replaced or removed CV set going: fits scored again, applications tailored again. */
function cvChangeNote(c) {
  if (!c) return '';
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const parts = [];
  if (c.retailor?.length) parts.push(`${n(c.retailor.length, 'application waiting for your approval is', 'applications waiting for your approval are')} being tailored again with it`);
  if (c.unscored?.length) parts.push(`${n(c.unscored.length, 'job is', 'jobs are')} being scored again`);
  if (c.kept) parts.push(`${n(c.kept, 'application keeps', 'applications keep')} your own file or edits (tailor ${c.kept === 1 ? 'it' : 'them'} again to use the new CV)`);
  return parts.length ? ` ${parts.join('; ')}.` : '';
}

async function uploadCvs(files, replace) {
  let done = 0;
  for (const f of files) {
    const needsClaude = !/\.docx$/i.test(f.name);
    toast(`${replace ? 'Replacing' : 'Adding'} ${f.name}… ${needsClaude ? 'Claude is converting it, which can take a minute.' : 'Claude is reading it.'}`);
    try {
      const q = `filename=${encodeURIComponent(f.name)}`;
      const r = await api(replace ? `/api/cvs/${encodeURIComponent(replace)}/file?${q}` : `/api/cvs?${q}`, { method: 'POST', raw: await f.arrayBuffer() });
      done++;
      toast(`${replace ? 'Replaced' : 'Added'} “${r.track.label}”.${cvChangeNote(r.change)}`);
    } catch (err) { toast(`${f.name}: ${err.message}`, true); }
  }
  if (done) { await refreshOverview(); route(); }
}

let sourcePoll;
async function showSourceTest(start) {
  clearTimeout(sourcePoll);
  const box = $('#sourceTest');
  if (!box) return;
  let t;
  try {
    if (start) await api('/api/sources/test', { method: 'POST' });
    t = await api('/api/sources/test');
  } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
  const btn = document.querySelector('[data-act=testSources]');
  if (btn) btn.disabled = t.running;
  const rows = t.last?.results || [];
  if (!rows.length && !t.running) { box.innerHTML = ''; return; }
  const status = x => x.ok ? '<span class="pill good">Working</span>' : x.skipped ? '<span class="pill">Not used</span>' : '<span class="pill crit">Problem</span>';
  const what = x => x.ok || x.found != null ? (x.unit ? `${x.found} ${esc(x.unit)}` : `${x.found} open${x.matching != null ? `, <b>${x.matching}</b> match your CVs` : ''}`) : esc(x.error || '');
  const broken = rows.filter(x => x.kind === 'board' && !x.ok && /not found/.test(x.error || ''));
  box.innerHTML = `<p class="muted small">Each source is tried once, with one of your job titles, to see that it works. Real searches use all your titles.</p><table><tbody>${rows.map(x => `<tr><td>${esc(x.name)}</td><td>${status(x)}</td><td class="small">${what(x)}${x.hint ? `<br><span class="muted">${esc(x.hint)}</span>` : ''}</td>
      <td>${x.kind === 'board' && !x.ok && x.source ? `<button class="btn ghost" data-act="removeBoard" data-source="${esc(x.source)}" data-name="${esc(x.board)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
    ${broken.length || rows.some(x => x.kind === 'board' && x.ok && !x.matching) ? `<div class="row"><button class="btn primary" data-act="suggestBoards" data-into="testIdeas">Suggest companies to add</button><span class="muted small">Claude suggests employers near you whose job boards have matching roles.</span></div><div id="testIdeas" class="ideas"></div>` : ''}
    <p class="muted small">${t.running ? `${testBar(t.last)} Indeed goes through Claude Code and can take a minute.` : t.last?.finished ? `Tested ${esc(ago(t.last.finished))}.` : ''}</p>`;
  if (t.running) sourcePoll = setTimeout(() => { if (location.hash.startsWith('#search/setup')) showSourceTest(); }, 2000);
}

/** Your career paths, for choosing a direction: Claude's advice, a comparison of where each path leads
 *  (now, 5 and 10 years, and its pay ceiling), then each path's ladder, pros and cons, and what it takes. */
function careerHtml(career, thinking, tracks) {
  const kindName = { now: 'Open to you now', stretch: 'A step up or sideways', switch: 'A change of direction' };
  const paths = career?.paths || [];
  const cur = c => c.currency && !['USD', 'CAD', 'AUD', 'NZD', 'SGD'].includes(c.currency) ? `${c.currency} ` : '$';
  const money = (n, c) => n ? `${cur(c)}${n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString()}` : '–';
  const range = (lo, hi, c) => lo && hi ? `${money(lo, c)}–${money(hi, c).replace(cur(c), '')}` : money(hi || lo, c);
  const step = (c, when) => (c.ladder || []).find(x => x.when.toLowerCase().includes(when)) || null;
  const top = Math.max(1, ...paths.map(c => c.ceiling_pay || c.pay_max || 0));
  const balanceName = { good: 'Good balance', mixed: 'Mixed balance', demanding: 'Demanding' };
  const balance = c => [c.hours ? `<span class="small">~${Math.round(c.hours)} h/week</span>` : '', c.balance ? `<span class="pill ${{ good: 'good', mixed: 'warn', demanding: 'crit' }[c.balance] || 'info'}" style="white-space:nowrap"${c.balance_note ? ` title="${esc(c.balance_note)}"` : ''}>${esc(balanceName[c.balance] || c.balance)}</span>` : ''].filter(Boolean).join(' ') || '–';
  const compare = paths.some(c => (c.ladder || []).length) ? `<table class="career-compare jobs" id="t-career"><thead><tr>${sortTh('Path')}${sortTh('Now', 'num')}${sortTh('In 5 years', 'num')}${sortTh('In 10 years', 'num')}${sortTh('Ceiling', 'num')}${sortTh('Hours a week', 'num')}<th>Balance</th></tr></thead><tbody>
      ${paths.map(c => { const n = step(c, 'now') || { pay_min: c.pay_min, pay_max: c.pay_max }, f = step(c, '5'), t = step(c, '10'); return `<tr><td class="path-name" data-v="${esc(c.title.toLowerCase())}"><a href="#path-${esc(c.title)}" data-act="careerJump" data-i="${paths.indexOf(c)}">${esc(c.title)}</a><br><span class="muted small">${esc(kindName[c.kind] || c.kind)}</span></td>
        <td class="num" data-v="${n.pay_max || n.pay_min || 0}">${range(n.pay_min, n.pay_max, c)}</td><td class="num" data-v="${f ? f.pay_max || 0 : 0}">${f ? range(f.pay_min, f.pay_max, c) : '–'}</td><td class="num" data-v="${t ? t.pay_max || 0 : 0}">${t ? range(t.pay_min, t.pay_max, c) : '–'}</td>
        <td class="num ceil" data-v="${c.ceiling_pay || 0}"><b>${money(c.ceiling_pay, c)}</b><div class="ceilbar"><span style="width:${(c.ceiling_pay || 0) / top * 100}%"></span></div></td>
        <td class="num" data-v="${c.hours || 0}">${c.hours ? `~${Math.round(c.hours)}` : '–'}</td>
        <td>${c.balance ? balance({ ...c, hours: 0 }) : '–'}</td></tr>`; }).join('')}</tbody></table>` : '';
  const ladder = c => (c.ladder || []).length ? `<ol class="ladder">${c.ladder.map(x => `<li><span class="when">${esc(x.when)}</span><b>${esc(x.title)}</b><span class="muted small">${range(x.pay_min, x.pay_max, c)}</span></li>`).join('')}
      ${c.ceiling_title ? `<li class="ceiling"><span class="when">Ceiling</span><b>${esc(c.ceiling_title)}</b><span class="small">up to <b>${money(c.ceiling_pay, c)}</b></span></li>` : ''}</ol>` : '';
  const list = (label, xs, cls) => xs?.length ? `<div class="small ${cls}"><b>${label}</b><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const searchFor = (c, i) => (c.titles || []).length ? `<details class="small"><summary class="muted">Look for this role now</summary>
      <p style="margin:6px 0">Job titles for it: ${c.titles.map(esc).join(', ')}</p>
      ${tracks.length ? `<div class="row">${tracks.length > 1 ? `<label class="small">Add them to the search for your<select data-path-track="${i}" style="margin-left:6px">${tracks.map(t => `<option value="${esc(t.name)}">${esc(t.label)}</option>`).join('')}</select> CV</label>` : ''}<button class="btn sm" data-act="addTitles" data-i="${i}" data-titles="${esc(JSON.stringify(c.titles))}" ${c.titles.every(t => tracks.some(x => x.titles.some(y => y.toLowerCase() === t.toLowerCase()))) ? 'disabled title="Already in your search"' : ''}>${tracks.length > 1 ? 'Add' : 'Add them to my search'}</button></div>` : ''}</details>` : '';
  return `<section class="card" id="careerCard"><header><h2>Your career paths</h2>
    ${thinking ? '<span class="muted small"><span class="spin" data-kind="career"></span>Claude is thinking… (a minute or two)</span>' : `<button class="btn" data-act="career">${career ? 'Think again' : 'Map my career paths'}</button>`}</header>
    ${career ? `${career.advice ? `<div class="advice"><b>Claude's advice</b><p>${esc(career.advice)}</p></div>` : ''}
      ${compare ? `<h3 class="sub">Where each path leads</h3>${compare}<p class="muted small">Typical yearly base pay where you search, with steady progress. The ceiling is the most the path usually pays, at its top role. Hours are a typical week in the role, all in. Claude's estimates from ${esc(fmtDate(career.at))}: use them to compare paths, not as offers.</p>` : ''}
      <div class="paths">${paths.map((c, i) => `<div class="path" id="path-${i}">
        <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><span><b>${esc(c.title)}</b><br><span class="small muted">${esc(kindName[c.kind] || c.kind)} · fit ${c.fit}</span></span>${c.ceiling_pay ? `<span class="pill good" style="white-space:nowrap" title="The most this path usually pays">up to ${money(c.ceiling_pay, c)}</span>` : `<span class="pill good" style="white-space:nowrap">${esc(c.pay)}</span>`}</div>
        <p class="small">${esc(c.why)}</p>
        ${ladder(c)}
        ${c.hours || c.balance ? `<p class="small"><b>Work-life balance:</b> ${balance(c)}${c.balance_note ? ` ${esc(c.balance_note)}` : ''}</p>` : ''}
        <div class="proscons">${list('For', c.pros, 'pro')}${list('Against', c.cons, 'con')}</div>
        ${(c.gaps || []).length ? `<p class="small"><b>What it takes:</b> ${c.gaps.map(esc).join('; ')}</p>` : ''}
        ${c.first_step ? `<p class="small"><b>First step this month:</b> ${esc(c.first_step)}</p>` : ''}
        ${searchFor(c, i)}
      </div>`).join('')}</div>`
    : `<p class="muted">Claude reads your whole CV and maps every direction it supports: where each leads in 3, 5 and 10 years, the pay at each step and the most the path can pay, the usual hours and work-life balance, with pros and cons and its advice on which to choose.${thinking ? '' : ' It does this by itself when you add a CV.'}</p>`}
  </section>`;
}

/** Setting up Claude Code, as a button where the app can do it, or plain steps where it can't. */
function claudeSetupHtml(st) {
  if (st.found && st.signed_in) {
    const how = { 'claude.ai': 'your Claude subscription', oauth_token: 'your Claude account', api_key: 'an API key (billed per use)' }[st.method] || st.method;
    return `✓ Ready: signed in with ${esc(how)}.`;
  }
  if (st.can_setup) {
    return `<p style="margin:0 0 8px">${st.found ? 'Claude Code is installed but not signed in yet.' : 'Job Hunt needs Claude Code, a free helper from Anthropic.'} Press the button: a window opens${st.found ? '' : ', installs it (a minute or two)'} and your browser asks you to sign in to Claude. Approve it there, and Job Hunt notices by itself.</p>
      <div class="row"><button class="btn primary" type="button" data-act="claudeSetup" data-install="${st.found ? '' : '1'}">${st.found ? 'Sign in to Claude' : 'Install and sign in'}</button><button class="btn ghost" type="button" data-act="checkClaude">Check again</button></div>`;
  }
  const ps = 'open PowerShell (press Start, type <b>PowerShell</b>, press Enter), type <b>claude</b>, press Enter and follow its steps to sign in';
  return st.found
    ? `Claude Code is installed but not signed in. On the computer running Job Hunt, ${ps}. Then press Check again.`
    : `Claude Code isn't installed. On the computer running Job Hunt, open the Job Hunt app and press <b>Install and sign in</b> in Settings → Accounts, or install it from <a href="#" data-act="link" data-url="https://claude.com/claude-code">claude.com/claude-code</a>, then ${ps}.`;
}

let careerWatch;
/** While Claude writes the career advice, look again every 10 seconds (for up to 5 minutes). */
function watchCareer(hash) {
  clearTimeout(careerWatch);
  const until = Date.now() + 5 * 60 * 1000;
  const tick = async () => {
    if (location.hash !== hash) return;
    const st = await api('/api/settings').catch(() => null);
    if (st && !st.career_thinking) { settingsCache = null; route(); return; }
    if (Date.now() < until) careerWatch = setTimeout(tick, 10000);
  };
  careerWatch = setTimeout(tick, 10000);
}

let claudeWatch;
/** After the setup window opens: check every few seconds until Claude Code is signed in. */
function watchClaude() {
  clearTimeout(claudeWatch);
  const until = Date.now() + 15 * 60 * 1000;
  const tick = async () => {
    try {
      const st = await api('/api/settings/claude-code');
      if (st.found && st.signed_in) { toast('Claude is ready.'); await refreshOverview(); route(); return; }
    } catch {}
    if (Date.now() < until) claudeWatch = setTimeout(tick, 5000);
  };
  claudeWatch = setTimeout(tick, 5000);
}

async function checkClaude(force) {
  const box = $('#ccStatus'), pill = $('#ccPill');
  if (!box) return;
  if (force) box.innerHTML = '<span class="spin" data-kind="check" data-secs="6"></span> Checking…';
  try {
    const st = await api('/api/settings/claude-code');
    box.innerHTML = claudeSetupHtml(st);
    if (settingsCache?.claude.engine !== 'api') pill.innerHTML = st.found && st.signed_in ? '<span class="pill good">Ready</span>' : `<span class="pill warn">${st.found ? 'Not signed in' : 'Not installed'}</span>`;
  } catch (err) { box.textContent = err.message; }
}

document.addEventListener('dragover', e => { const d = e.target.closest?.('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest?.('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => {
  const d = e.target.closest?.('#drop');
  if (!d) return;
  e.preventDefault();
  d.classList.remove('over');
  uploadCvs([...e.dataTransfer.files].filter(f => /\.(docx|pdf|txt|doc)$/i.test(f.name)), null);
});

let settingsPoll;
function pollSettings() {
  clearTimeout(settingsPoll);
  settingsPoll = setTimeout(async () => {
    // Settings, or the Welcome page (continuing from another computer starts there).
    if (!location.hash.startsWith('#settings') && !/^#(search\/(what|setup)|calendar\/settings|inbox\/settings)/.test(location.hash) && location.hash !== '#welcome') return;
    const st = await api('/api/settings').catch(() => null);
    if (!st) return;
    await refreshOverview();
    route();
    if (st.google.connecting) pollSettings();
  }, 3000);
}

document.addEventListener('click', e => {
  // A More menu closes on a click outside it, or on one of its items.
  document.querySelectorAll('details.menu[open]').forEach(m => {
    // On a phone the status lines are part of the menu sheet, which stays open until it's closed.
    if (m.id === 'statusPop' && document.body.classList.contains('more-open')) return;
    if (!m.contains(e.target) || e.target.closest('.menu-list')) m.open = false;
  });
  const to = e.target.closest('a[data-tab-to]');
  if (to) jobTabs[decodeURIComponent(to.getAttribute('href').replace('#job/', ''))] = to.dataset.tabTo;
  if (to && to.dataset.scroll) scrollToAfter = to.dataset.scroll;
  const el = e.target.closest('[data-act]');
  if (el && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') { e.preventDefault(); act(el); return; }
  const row = e.target.closest('tr[data-href]');
  if (row) location.hash = row.dataset.href;
  // In Pipeline, on a wide window, a job opens beside the list; elsewhere its row opens in place.
  const ex = e.target.closest('tr[data-expand]');
  if (ex && panelFits() && location.hash.startsWith('#applications') && !e.target.closest('a,button,.open-reviews')) { openPanel(ex.dataset.expand); return; }
  if (ex) togglePosting(ex);
  const name = e.target.closest('.jrow[data-job-row] a.qt');
  if (name && panelFits() && location.hash.startsWith('#applications') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openPanel(name.closest('.jrow').dataset.jobRow); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.act === 'smallSources') { smallSources = el.checked; route(); return; }
  if (el.dataset.act === 'repeatMode') {
    try { await api('/api/settings/repeat', { method: 'POST', body: { mode: el.value } }); settingsCache = null; toast({ light: 'Companies you applied to before: the same headline and a few changes.', same: 'Companies you applied to before: the same CV as before.', usual: 'Companies you applied to before: tailored as usual.' }[el.value]); }
    catch (e) { toast(e.message, true); }
    return;
  }
  if (el.dataset.act === 'autoSubmit') {
    try { await api('/api/answer-bank', { method: 'POST', body: { auto_submit: el.checked } }); toast(el.checked ? 'On: simple forms answered entirely from your saved answers are submitted after a 10-second countdown you can stop.' : 'Off: Job Hunt fills forms in, and you press Submit.'); }
    catch (e) { el.checked = !el.checked; toast(e.message, true); }
    return;
  }
  if (el.dataset.act === 'phoneDetails') {
    try { await api('/api/settings/phone', { method: 'POST', body: { details: el.checked } }); toast(el.checked ? 'Notices now show the company and role.' : 'Notices now keep details private.'); }
    catch (err) { el.checked = !el.checked; toast(err.message, true); }
    return;
  }
  if (el.dataset.act === 'welcomeSource') {
    try { await api(`/api/connections/${encodeURIComponent(el.dataset.id)}`, { method: 'POST', body: { on: el.checked } }); settingsCache = null; toast(el.checked ? 'Added: the next search includes it.' : 'Removed.'); }
    catch (err) { el.checked = !el.checked; toast(err.message, true); }
    return;
  }
  if (el.dataset.act === 'autostart') {
    try { await api('/api/settings/app', { method: 'POST', body: { autostart: el.checked } }); toast(el.checked ? 'Job Hunt will start when you sign in.' : 'Job Hunt won\'t start by itself.'); }
    catch (err) { el.checked = !el.checked; toast(err.message, true); }
  }
  if (el.dataset.act === 'budgetOn' || el.dataset.act === 'budgetHour') {
    const body = el.dataset.act === 'budgetOn' ? { on: el.checked } : { hour: Number(el.value) };
    await api('/api/usage/budget', { method: 'POST', body }).then(() => { toast('Saved.'); renderUsage(); }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'weeklyDay' || el.dataset.act === 'weeklyEmail') {
    const body = el.dataset.act === 'weeklyDay' ? { day: el.value } : { email: el.checked };
    await api('/api/settings/weekly', { method: 'POST', body }).then(() => toast('Saved.')).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'phoneUrgent') {
    await api('/api/settings/phone', { method: 'POST', body: { urgent_only: el.checked } }).then(() => toast('Saved.')).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'calShowGoogle') {
    await api('/api/calendar/show-google', { method: 'POST', body: { on: el.checked } }).then(() => route()).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'ratingsAuto') {
    await api('/api/settings/ratings', { method: 'POST', body: { on: el.checked } }).then(() => toast(el.checked ? 'Job Hunt will look up company ratings.' : 'Company ratings won\'t be looked up.')).catch(err => toast(err.message, true));
    return;
  }
  if (el.dataset.act === 'clipWatch') {
    await api('/api/settings/clip-watch', { method: 'POST', body: { on: el.checked } }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'browserPick') {
    await api('/api/settings/app', { method: 'POST', body: { browser: el.value } }).then(() => { settingsCache = null; toast(`Links open in ${el.options[el.selectedIndex].text}.`); }).catch(err => toast(err.message, true));
    return;
  }
  if (el.dataset.act === 'updateAuto') {
    await api('/api/settings/app', { method: 'POST', body: { update_auto: el.checked } }).then(() => { settingsCache = null; toast(el.checked ? 'On: updates install by themselves when Job Hunt isn\'t busy and you\'re not using it.' : 'Off: Job Hunt tells you when an update is ready, and you install it.'); }).catch(err => { el.checked = !el.checked; toast(err.message, true); });
    return;
  }
  if (el.dataset.act === 'wakePc') {
    await api('/api/settings/app', { method: 'POST', body: { wake: el.checked } }).then(() => { settingsCache = null; route(); toast(el.checked ? 'Job Hunt will wake this PC for its tasks. Check that Windows allows wake timers (see below).' : 'Job Hunt won\'t wake this PC.'); }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'applyMode' || el.dataset.act === 'applyCv') {
    const body = el.dataset.act === 'applyMode' ? { mode: el.value } : { attach_cv: el.checked };
    await api('/api/recruiters/settings', { method: 'POST', body }).then(() => toast(el.dataset.act === 'applyCv' ? (el.checked ? 'Your tailored CV goes with emails Job Hunt sends.' : 'No CV attached.')
      : { draft: 'When you apply, the email waits in your Gmail drafts.', send: 'When you apply, Job Hunt sends the email for you.', off: 'No emails when you apply.' }[el.value])).catch(err => toast(err.message, true));
    return;
  }
  if (el.dataset.act === 'keepAwake') {
    await api('/api/settings/app', { method: 'POST', body: { keep_awake: el.checked } }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'closeMode') {
    await api('/api/settings/app', { method: 'POST', body: { close: el.value } }).catch(err => toast(err.message, true));
  }
  if (el.dataset.upload?.startsWith('own-') && el.files.length) {
    const f = el.files[0], what = el.dataset.upload.slice(4), id = main().dataset.job;
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}/own-file?what=${what}&filename=${encodeURIComponent(f.name)}`, { method: 'POST', raw: await f.arrayBuffer() });
      toast(`Using your ${what === 'cv' ? 'CV' : 'cover letter'} for this role.`); route();
    } catch (err) { toast(err.message, true); }
    el.value = '';
    return;
  }
  if (el.dataset.upload && el.files.length) {
    if (el.dataset.upload === 'cv-add' || el.dataset.upload === 'cv-replace') await uploadCvs([...el.files], el.dataset.upload === 'cv-replace' ? el.dataset.track : null);
    else if (el.dataset.upload === 'restore') {
      const file = el.files[0];
      if (!await ask(`Restore from ${file.name}? Everything in Job Hunt now is replaced with this backup, and Job Hunt restarts. What's here now is kept in a "before-restore" folder.`)) { el.value = ''; return; }
      try {
        toast('Restoring… Job Hunt restarts in a moment.');
        await api('/api/backup/restore', { method: 'POST', raw: await file.arrayBuffer() });
        setTimeout(() => location.reload(), 6000);
      } catch (err) { toast(err.message, true); }
    } else if (el.dataset.upload === 'network') {
      try {
        const r = await api('/api/network', { method: 'POST', raw: await el.files[0].text() });
        toast(`${r.count} connections saved. Jobs at their companies now show who you know there.`);
        route();
      } catch (err) { toast(err.message, true); }
    } else if (el.dataset.upload === 'signature') {
      try {
        await api('/api/settings/signature', { method: 'POST', raw: await el.files[0].arrayBuffer() });
        toast('Signature added. New cover letters will include it.');
        route();
      } catch (err) { toast(err.message, true); }
    } else {
      try {
        await api('/api/settings/google-client', { method: 'POST', raw: await el.files[0].text() });
        toast('Connection file saved. Now press Connect Google.');
        await refreshOverview(); route();
      } catch (err) { toast(err.message, true); }
    }
    el.value = '';
  }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    const kind = form.dataset.form;
    const f = form.elements;
    if (kind === 'add') {
      const claude = form.querySelector('[name=claude]:checked')?.value === '1';
      await api('/api/add', { method: 'POST', body: { company: f.company.value, title: f.title.value, url: f.url.value, location: f.location.value, description: f.description.value, claude } });
      toast(claude ? 'Added. Once it\'s scored and tailored it appears under Ready to approve; you get a notice.' : 'Saved. It\'s in Pipeline, Saved for later.');
      location.hash = '#overview';
    } else if (kind === 'other') {
      await api('/api/settings/other', { method: 'POST', body: { for: f.for.value, url: f.service.value || f.url.value, key: f.key.value, model: f.model.value } });
      toast(f.for.value ? 'Saved. The next search uses it.' : 'Saved. Claude does everything.');
      await refreshOverview(); route();
    } else if (kind === 'claude') {
      await api('/api/settings/claude', { method: 'POST', body: { engine: form.querySelector('[name=engine]:checked').value, claude_key: f.claude_key.value, model: f.model.value, tailor_model: f.tailor_model.value, tailor_effort: f.tailor_effort.value, score_model: f.score_model.value, score_batch: Number(f.score_batch.value), path: f.path.value } });
      toast('Saved.');
      await refreshOverview(); route();
    } else if (kind === 'apify') {
      await api('/api/settings/keys', { method: 'POST', body: { apify_key: f.apify_key.value, apify_actor: f.apify_actor.value } });
      toast('Saved. Turn LinkedIn on if it isn\'t, then Test it in the Status list.');
      settingsCache = null; route();
    } else if (kind === 'recruiterEdit') {
      const body = Object.fromEntries(['email', 'name', 'company', 'phone', 'linkedin', 'notes'].filter(k => f[k]).map(k => [k, f[k].value]));
      await api('/api/recruiters/edit', { method: 'POST', body });
      toast('Saved.'); route();
    } else if (kind === 'sites') {
      const sites = [...form.querySelectorAll('[name=site]:checked')].map(x => x.value);
      const custom = [...form.querySelectorAll('.site-own')].map(r => ({ name: r.querySelector('[name=own_name]').value.trim(), url: r.querySelector('[name=own_url]').value.trim() })).filter(c => c.url);
      await api('/api/sites', { method: 'POST', body: { sites, custom } });
      toast(sites.length + custom.length ? 'Saved. The next search includes them; Test them to check each one now.' : 'Saved.');
      settingsCache = null; route();
    } else if (kind === 'jsearch' || kind === 'jooble') {
      await api('/api/settings/keys', { method: 'POST', body: kind === 'jsearch' ? { jsearch_key: f.jsearch_key.value, jsearch_provider: f.jsearch_provider.value } : { jooble_key: f.jooble_key.value } });
      toast('Saved. Use Test sources to check it.');
      await refreshOverview(); route();
    } else if (kind === 'adzuna') {
      await api('/api/settings/keys', { method: 'POST', body: { adzuna_id: f.adzuna_id.value, adzuna_key: f.adzuna_key.value } });
      toast('Adzuna saved.');
      await refreshOverview(); route();
    } else if (kind === 'sync') {
      const where = form.querySelector('[name=where]:checked')?.value || 'drive';
      const r = await api('/api/sync/settings', { method: 'POST', body: { where, ...(f.dir ? { dir: f.dir.value } : {}), on: f.on.checked, secrets: f.secrets.checked, ...(f.every ? { every: Number(f.every.value) } : {}) } });
      toast(r.sync.newer ? `${r.sync.newer.device} has newer data there. Choose in the Queue whether to continue from it.` : r.sync.on ? `Synced. ${where === 'drive' ? 'The Job Hunt folder in your Google Drive' : 'This folder'} now has your latest data.` : 'Saved.');
      await refreshOverview(); route();
    } else if (kind === 'welcomeWhere') {
      const p = JSON.parse(JSON.stringify(settingsCache.profile));
      p.locations = fromLines(f.locations.value); p.remote_ok = f.remote_ok.checked; p.include_metro = !!f.include_metro?.checked; p.sources.adzuna_country = f.country.value;
      if (f.timezone?.value) p.timezone = f.timezone.value;
      await api('/api/settings/profile', { method: 'POST', body: { ...p, seen_sources: settingsCache.profile.sources } });
      toast('Saved.'); route();
    } else if (kind === 'calInterview') {
      if (!f.job_id.value) { toast('Pick the application first.', true); return; }
      if (!f.start.value) { toast('Choose the date and time.', true); return; }
      await api('/api/calendar/interview', { method: 'POST', body: { job_id: f.job_id.value, start: new Date(f.start.value).toISOString(), minutes: Number(f.minutes.value), link: f.link.value, note: f.note.value } });
      toast('Interview added, with prep time and reminders.');
      await refreshOverview(); route();
    } else if (kind === 'phone') {
      await api('/api/settings/phone', { method: 'POST', body: { server: f.server.value } });
      toast('Saved.'); route();
    } else if (kind === 'filesFolder') {
      const r = await api('/api/settings/files-folder', { method: 'POST', body: { dir: f.dir.value } });
      settingsCache = null; toast(`Your files are in ${r.folder}.`); route();
    } else if (kind === 'backup') {
      await api('/api/settings/backup', { method: 'POST', body: { secrets: f.secrets.checked } });
      toast('Backup settings saved.'); route();
    } else if (kind === 'links') {
      await api('/api/settings/links', { method: 'POST', body: { base: f.base.value } });
      settingsCache = null; toast(f.base.value.trim() ? 'Saved. Links in CVs tailored from now on note when they\'re opened.' : 'Turned off.'); route();
    } else if (kind === 'remote') {
      await api('/api/settings/remote', { method: 'POST', body: { password: f.password.value, port: f.port ? Number(f.port.value) : undefined, on: f.on ? f.on.checked : undefined } });
      toast('Saved.'); route();
    } else if (kind === 'profile') {
      await api('/api/settings/profile', { method: 'POST', body: readProfile(form, form.dataset.part) });
      toast('Saved.');
      await refreshOverview(); route();
    }
  } catch (err) { toast(err.message, true); }
  finally { if (btn) btn.disabled = false; }
});

// Chart tooltips.
document.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-tip]');
  const tip = $('#tip');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});

// Appearance: Auto follows Windows; Light and Dark stay as chosen.
function showTheme() {
  const pick = document.documentElement.dataset.theme || 'auto';
  document.querySelectorAll('[data-theme-pick]').forEach(b => {
    const on = b.dataset.themePick === pick;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
document.querySelectorAll('[data-theme-pick]').forEach(b => b.addEventListener('click', () => {
  const pick = b.dataset.themePick;
  if (pick === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pick;
  try { pick === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', pick); } catch (e) {}
  showTheme();
}));
showTheme();

window.addEventListener('hashchange', () => document.body.classList.remove('more-open'));
window.addEventListener('hashchange', route);
// Keep the sidebar and the overview fresh while searches and email checks run in the background.
setInterval(async () => {
  // Housekeeping that runs every few minutes doesn't redraw the page.
  const busyWith = () => JSON.stringify((overview?.running || []).filter(r => !['care', 'calsync', 'sync', 'backup', 'check-postings'].includes(r))) + (overview?.counts?.ready || 0);
  const before = busyWith();
  await refreshOverview();
  const after = busyWith();
  const editing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const here = location.hash;
  if (before !== after && !editing && !pageDirty && !$('#calAddCard:not([hidden])') && (here === '' || ['#overview', '#results', '#calendar'].includes(here) || here.startsWith('#job/'))) route();
}, 8000);

refreshOverview().then(route).then(noteUpdated);
// Look for an update shortly after opening, then every 30 minutes.
setTimeout(checkUpdate, 4000);
setInterval(checkUpdate, 30 * 60 * 1000);
// While Job Hunt sits in the tray or behind other windows, look again whenever it comes to the front
// (the app also calls onShown when you open it from the tray or switch to its window).
let lastShownCheck = Date.now();
function onShown() {
  if (Date.now() - lastShownCheck < 60 * 1000) return;
  lastShownCheck = Date.now();
  checkUpdate();
  refreshOverview().catch(() => {}); // the counts; the page itself stays, so nothing you're typing is lost
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onShown(); });
window.addEventListener('focus', onShown);
