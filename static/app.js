// Job Hunt screens. Everything talks to the app through /api on the private jobhunt:// address.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 7h6V4h-6z"/>',
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
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

const NAV = [['overview', 'Overview'], ['cvs', 'CV &amp; career'], ['pipeline', 'Applications'], ['calendar', 'Calendar'], ['documents', 'Documents'], ['results', 'Results'], ['inbox', 'Inbox'], ['recruiters', 'Recruiters'], ['add', 'Add a job'], ['settings', 'Settings']];
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
const scoreBadge = n => n == null ? '' : `<span class="score ${n >= 80 ? 'hi' : n >= 60 ? 'mid' : 'lo'}" title="Fit score">${n}</span>`;
/** "fit 72 → 85": your CV's fit before tailoring and the tailored CV's after. */
const fitChange = j => j.score != null && j.score_after != null && j.score_after !== j.score ? `fit ${j.score} → <b>${j.score_after}</b>` : '';
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
/** A tag for postings that have closed since they were found. */
const closedTag = j => (j.closed_at ? `<span class="pill crit" title="Closed ${esc(fmtDate(j.closed_at))}: the company took it down or stopped taking applications">Closed</span>` : '')
  + ((j.warnings || []).length ? ` <span class="pill warn" title="${esc(j.warnings.join('\n'))}">Check first</span>` : '');
function eventText(e) {
  const k = e.kind;
  if (k.startsWith('status:')) return `Moved to <b>${esc(STAGES[k.slice(7)] || k.slice(7))}</b>${e.detail ? ` · ${esc(e.detail)}` : ''}`;
  if (k.startsWith('email:')) return `Email: ${esc((CATEGORY[k.slice(6)] || [k.slice(6)])[0])} · ${esc(e.detail)}`;
  if (k.endsWith(':error')) return `<span style="color:var(--crit)">Problem</span> · ${esc(e.detail)}`;
  if (k === 'backup' && e.detail.startsWith('saved ')) return 'Backup saved';
  const names = { scored: 'Scored', tailored: 'Tailored', rescored: 'Fit re-checked', skipped: 'Skipped', search: 'Job search', inbox: 'Email check', added: 'Added', calendar: 'Calendar', revised: 'Changed', followup: 'Follow-up', closed: 'Closed', check: 'Postings checked', prep: 'Interview prep', answers: 'Application questions', offer: 'Offer', contact: 'Contact', insights: 'Insights', weekly: 'Weekly summary', discover: 'Employers', thanks: 'Thank-you note', career: 'Career paths', care: 'Interview reminders' };
  return `${esc(names[k] || k)} · ${esc(e.detail)}`;
}
const jobLink = e => e.job_id ? `<a href="#job/${encodeURIComponent(e.job_id)}">${esc(e.company)} – ${esc(e.title)}</a> · ` : '';

// ---- shell ----
function renderNav() {
  const page = (location.hash.slice(1) || 'overview').split('/')[0];
  const active = page === 'job' ? 'pipeline' : page;
  const ready = overview?.counts?.ready || 0;
  $('#nav').innerHTML = NAV.map(([id, name]) =>
    `<a href="#${id}" class="${id === active ? 'on' : ''}">${svg(id)}${name}${id === 'pipeline' && ready ? `<span class="badge">${ready}</span>` : ''}</a>`).join('');
  const running = overview?.running || [];
  const busy = running.includes('search') ? `Searching for jobs… ${overview?.progress?.percent ?? 0}%` : running.includes('inbox') ? 'Checking email…'
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
  const more = !['overview', 'pipeline', 'calendar', 'inbox'].includes(active);
  $('#tabbar').innerHTML = [['overview', 'Overview'], ['pipeline', 'Applications'], ['calendar', 'Calendar'], ['inbox', 'Inbox']].map(([id, name]) =>
    `<a href="#${id}" class="${id === active ? 'on' : ''}">${svg(id)}<span>${id === 'pipeline' ? 'Apps' : name}</span>${id === 'pipeline' && ready ? `<span class="badge">${ready}</span>` : ''}</a>`).join('')
    + `<button type="button" class="${more ? 'on' : ''}" data-act="moreMenu" aria-expanded="${document.body.classList.contains('more-open')}">${svg('more')}<span>More</span>${!$('#connLine')?.hidden || !$('#limitLine')?.hidden || !$('#updateNote')?.hidden ? '<span class="badge dot-badge"></span>' : ''}</button>`;
  $('#runNote').textContent = busy || `Searched ${ago(overview?.last_search)}${nextSearch ? ` · next ${when(nextSearch)}` : overview?.last_search ? ' · next soon' : ''}`;
  const g = overview?.setup?.google;
  $('#dotGoogle').className = 'dot' + (g ? ' on' : '');
  const off = (overview?.setup?.skipped || []).includes('google');
  $('#googleLine').hidden = !g && off;
  $('#googleNote').textContent = g ? (overview?.last_inbox ? `Email checked ${ago(overview.last_inbox)}` : 'Gmail & Calendar connected') : 'Google not connected';
  // Sync when it's on, else backups.
  const sync = side.sync_on;
  const at = sync ? side.last_sync : side.last_backup;
  const stale = !at || Date.now() - new Date(at) > (sync ? 2 : 3) * 86400000;
  $('#dotSync').className = 'dot' + (stale ? ' warn' : ' on');
  $('#syncNote').textContent = sync ? (at ? `Synced ${ago(at)}` : 'Not synced yet') : (at ? `Backed up ${ago(at)}` : 'No backup yet');
  $('#syncLine').hidden = overview?.kind === 'server' && !sync && !at;
  const lim = side.claude_limited_until && new Date(side.claude_limited_until) > new Date();
  $('#limitLine').hidden = !lim && !side.deferred;
  $('#limitNote').textContent = lim ? `Claude limit until ${new Date(side.claude_limited_until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : `${side.deferred} batch${side.deferred === 1 ? '' : 'es'} waiting for tonight`;
  $('#connLine').hidden = !side.conn_problems;
  $('#connNote').textContent = `${side.conn_problems} connection${side.conn_problems === 1 ? '' : 's'} need${side.conn_problems === 1 ? 's' : ''} attention`;
  if (overview?.version) $('#versionNote').textContent = `Job Hunt ${shortVersion(overview.version)}`;
}

async function refreshOverview() {
  try { overview = await api('/api/overview'); } catch (e) { return; }
  renderNav();
}

const main = () => $('#main');
// Something typed, ticked or chosen on this page that isn't saved yet: the background refresh
// leaves the page alone until it's redrawn by your own action.
let pageDirty = false;
document.addEventListener('input', e => { if (e.target.closest?.('#main') && !e.target.dataset.act && e.target.type !== 'search') pageDirty = true; });
function page(html) {
  pageDirty = false;
  main().innerHTML = `<div class="page">${html}</div>`;
  // Only the job page sets these; elsewhere actions name their job themselves.
  delete main().dataset.job;
  delete main().dataset.status;
}

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
    if (name === 'overview') await showOverview();
    else if (name === 'pipeline') await showPipeline(arg || 'tracker');
    else if (name === 'job') await showJob(arg);
    else if (name === 'review') await showReview();
    else if (name === 'welcome') await showWelcome();
    else if (name === 'apply') await showApply(arg);
    else if (name === 'calendar') await showCalendar();
    else if (name === 'documents') await showDocuments();
    else if (name === 'results') await showResults();
    else if (name === 'inbox') await showInbox();
    else if (name === 'recruiters') await showRecruiters();
    else if (name === 'add') showAdd();
    else if (name === 'cvs' || (name === 'settings' && arg === 'cvs')) await showSettings('cvs');
    else if (name === 'settings') await showSettings(arg || 'connections');
    else location.hash = '#overview';
  } catch (e) {
    page(`<div class="card"><h2>Couldn't load this page</h2><p class="muted">${esc(e.message)}</p></div>`);
  }
  // A new page (or the next job in Review) starts at the top; a refresh of the same one stays put.
  const key = `${location.hash}|${pageKey}`;
  if (key !== shownKey) { shownKey = key; window.scrollTo(0, 0); }
}

// ---- Overview ----
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

async function showOverview() {
  overview = await api('/api/overview');
  renderNav();
  const o = overview, c = o.counts, first = (o.name || '').split(' ')[0];
  const setup = o.setup;
  const steps = [
    [setup.claude, setup.engine === 'api' ? 'Add your Claude API key' : 'Connect Claude Code', setup.engine === 'api' ? 'Needed to score jobs and tailor your CV.' : 'Uses Claude Code on this PC and your Claude subscription. No API key needed.', '#settings/connections'],
    [setup.cvs > 0 && !setup.cvs_missing.length, setup.cvs ? 'Your CVs' : 'Add your CV', setup.cvs ? (setup.cvs_missing.length ? `Missing a file: ${setup.cvs_missing.join(', ')}` : `${setup.cvs} CV${setup.cvs === 1 ? '' : 's'} ready.`) : 'Word, PDF or text. Add as many as you like.', '#cvs'],
    [setup.google, 'Connect Gmail and Calendar (optional)', 'For job email, replies and interview booking.', '#settings/connections', 'google'],
    [setup.adzuna, 'Add a job-search service (optional)', 'Google for Jobs listings from LinkedIn, Indeed, Glassdoor and more.', '#settings/sources', 'search_service'],
  ].filter(st => !(st[4] && (setup.skipped || []).includes(st[4])));
  // Shown until the steps you need are done; optional ones can be put off with Not now.
  const showSteps = steps.some(s => !s[0]);
  const neededDone = steps.filter(s => !s[4]).every(s => s[0]); // Claude and a CV
  const delta = o.this_week - o.last_week;
  const next = o.interviews[0];
  const stages = ['queued', 'ready', 'approved', 'applied', 'interviewing', 'offer', 'rejected'];
  const maxStage = Math.max(1, ...stages.map(s => c[s] || 0));
  const maxWeek = Math.max(1, ...o.weeks.map(w => w.count));
  const searching = o.running.includes('search');
  page(`
    <div class="head">
      <div class="grow">
        <div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>${greeting()}${first ? `, ${esc(first)}` : ''}</h1>
        <p class="muted">Last job search ${ago(o.last_search)} · last email check ${ago(o.last_inbox)}</p>
      </div>
      <div class="row">
        <button class="btn" data-act="run" data-task="inbox" ${setup.google ? '' : 'disabled title="Connect Google first"'}>${svg('mail')}Check email</button>
        <button class="btn primary" data-act="run" data-task="search" ${searching ? 'disabled' : !setup.cvs ? 'disabled title="Add your CV first"' : ''}>${searching ? '<span class="spin"></span>Searching…' : `${svg('search')}Search for jobs now`}</button>
      </div>
    </div>
    ${o.sync_newer ? `<section class="card sync-banner"><header><h2>Continue where you left off</h2></header>
      <p>Job Hunt on <b>${esc(o.sync_newer.device)}</b> saved newer data ${esc(ago(o.sync_newer.saved_at))}${o.sync_newer.jobs ? ` (${o.sync_newer.jobs} roles)` : ''}. Continue from it here? Job Hunt restarts with it, and what's on this computer now is kept in a "before-restore" folder.</p>
      <div class="row"><button class="btn primary" data-act="syncContinue" data-folder="${esc(o.sync_newer.folder)}">Continue from ${esc(o.sync_newer.device)}</button>
      <button class="btn ghost" data-act="syncDecline" data-saved="${esc(o.sync_newer.saved_at)}">Keep this computer's data</button></div></section>` : ''}
    ${showSteps && !neededDone ? `<section class="card"><header><h2>Finish setting up</h2><a class="btn ghost" href="#welcome">Guided setup</a></header><div class="steps">${steps.map(([done, t, d, href, key]) =>
      `<div class="step-wrap"><a class="step ${done ? 'done' : ''}" href="${href}"><span class="tick">${done ? '✓' : ''}</span><span><b>${esc(t)}</b><br><span class="muted small">${esc(d)}</span></span></a>${key && !done ? `<button class="btn ghost sm" data-act="setupSkip" data-what="${key}" title="Hide this step">Not now</button>` : ''}</div>`).join('')}</div></section>` : ''}
    ${inUseHtml(o.in_use)}
    ${o.health?.length ? `<section class="card health"><header><h2>Needs attention</h2></header><ul class="flags">${o.health.map(h => `<li class="${h.level === 'problem' ? 'crit' : ''}">${esc(h.text)}
      ${h.action === 'removeBroken' ? `<span class="row" style="display:inline-flex;margin-left:6px"><button class="btn" data-act="removeBroken" data-boards="${esc(JSON.stringify(h.data))}">Remove ${h.data.length === 1 ? 'it' : 'them'}</button><button class="btn primary" data-act="suggestBoards" data-into="healthIdeas">Suggest companies</button></span>` : ''}
      ${h.fix ? `<button class="btn sm" style="margin-left:6px" data-act="${esc(h.fix.act)}" data-task="${esc(h.fix.task)}">${esc(h.fix.label)}</button>` : ''}
      ${h.link && h.link !== '#overview' ? `<a href="${esc(h.link)}">Fix it</a>` : ''}</li>`).join('')}</ul><div id="healthIdeas" class="ideas"></div></section>` : ''}
    ${todoHtml(o)}
    ${showSteps && neededDone ? `<section class="card optional-steps"><b>Optional:</b> ${steps.filter(st => st[4] && !st[0]).map(([, t, d, href, key]) =>
      `<span class="opt"><a href="${href}" title="${esc(d)}">${esc(t.replace(' (optional)', ''))}</a><button class="btn ghost sm" data-act="setupSkip" data-what="${key}" title="Hide this">Not now</button></span>`).join('')}</section>` : ''}
    ${o.progress ? progressHtml(o.progress) : reportHtml(o.last_report)}
    <section class="kpis">
      <a class="kpi" href="#pipeline"><span class="kpi-l">Ready to approve</span><span class="kpi-v">${c.ready || 0}</span><span class="kpi-s">${c.queued ? `${c.queued} more to pick from` : 'Tailored CV and cover letter each'}</span></a>
      <div class="kpi"><span class="kpi-l">Applied this week</span><span class="kpi-v">${o.this_week}${o.weekly_goal ? `<span class="muted" style="font-size:.5em"> / ${o.weekly_goal}</span>` : ''}</span>${o.weekly_goal ? `<span class="meter"><i style="width:${Math.min(100, o.this_week / o.weekly_goal * 100)}%"></i></span>` : ''}<span class="kpi-s">${delta === 0 ? 'Same as last week' : `<span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span> vs last week`}</span></div>
      <div class="kpi"><span class="kpi-l">Interviews coming up</span><span class="kpi-v">${o.interviews.length}</span><span class="kpi-s">${next ? `Next: ${esc(fmtWhen(next.start))}` : 'None booked yet'}</span></div>
      <div class="kpi"><span class="kpi-l">Response rate</span><span class="kpi-v">${pct(o.response_rate)}</span><span class="kpi-s">${o.applied_total ? `Of ${o.applied_total} application${o.applied_total === 1 ? '' : 's'} sent` : 'No applications sent yet'}</span></div>
    </section>
    <details class="card"><summary><b>Recent activity</b></summary>
      ${o.events.length ? `<div class="feed" style="margin-top:10px">${o.events.map(e => `<div><time title="${esc(new Date(e.created_at).toLocaleString())}">${esc(ago(e.created_at))}</time><span>${jobLink(e)}${eventText(e)}</span></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}
    </details>
    <p class="muted small" style="text-align:center"><a href="#results">Results: what's working</a> · <a href="#calendar">Calendar</a></p>`);
}

// ---- Applications ----
async function showPipeline(tab) {
  // Postings outside your locations aren't shown anywhere (the Skipped tab counts them).
  const { jobs: everything } = await api('/api/jobs');
  const elsewhere = everything.filter(outsideYours).length;
  const jobs = everything.filter(j => !outsideYours(j));
  // "All" is gone from the tabs (the Tracker and Postings cover it); #pipeline/list still works.
  const tabs = [['tracker', 'Tracker'], ['board', 'Board'], ['postings', 'Postings'], ['skipped', 'Skipped']];
  let body = '';
  if (tab === 'tracker') {
    const { rows } = await api('/api/tracker');
    const groups = {
      active: ['In progress', r => !['rejected', 'no_response', 'saved'].includes(r.status)],
      you: ['Waiting on you', r => r.who === 'you'],
      them: ['Waiting on them', r => r.who === 'them'],
      quiet: ['No reply in 2+ weeks', r => r.status === 'applied' && (r.days_since ?? 0) >= 14],
      interviewing: ['Interviewing', r => ['interviewing', 'offer'].includes(r.status)],
      saved: ['Saved for later', r => r.status === 'saved'],
      done: ['Finished', r => ['rejected', 'no_response'].includes(r.status)],
    };
    const [, keep] = groups[trackFilter] || groups.active;
    // Your move first, then whatever has waited longest.
    const list = rows.filter(keep).sort((a, b) => (a.who === 'you' ? 0 : 1) - (b.who === 'you' ? 0 : 1) || (b.days_since ?? 0) - (a.days_since ?? 0));
    body = `<div class="chips">${Object.entries(groups).map(([k, [n, f]]) => `<button class="chip ${k === trackFilter ? 'on' : ''}" data-act="trackFilter" data-f="${k}">${n} <b>${rows.filter(f).length}</b></button>`).join('')}</div>
      <section class="card" style="padding:4px 12px">${list.length ? list.map(trackRow).join('') : `<p class="empty">${rows.length ? 'Nothing here.' : 'No applications yet. Tailor a role from the Overview and it shows up here.'}</p>`}</section>`;
  } else if (tab === 'board') {
    // The lanes you work in; empty ones step aside, and finished applications go below.
    const lanes = ['queued', 'ready', 'approved', 'applied', 'interviewing'];
    const of = st => jobs.filter(j => j.status === st).sort((a, b) => (b.score || 0) - (a.score || 0));
    const shown = lanes.filter(st => of(st).length);
    const empty = lanes.filter(st => !of(st).length);
    const done = [...of('offer'), ...of('rejected'), ...of('no_response')];
    const saved = of('saved');
    body = `${shown.length ? `<div class="board" style="grid-template-columns:repeat(${shown.length}, minmax(200px, 1fr))">${shown.map(st => {
      const list = of(st);
      return `<div class="lane"><h3>${stagePill(st)}<span class="n">${list.length}</span></h3>${list.map(card).join('')}</div>`;
    }).join('')}</div>` : '<p class="empty">No applications in progress yet. Matches appear here after a search.</p>'}
      ${empty.length && shown.length ? `<p class="muted small">Nothing in ${empty.map(st => STAGES[st].split(' – ')[0]).join(', ')}.</p>` : ''}
      ${saved.length ? `<details class="card" open><summary><b>Saved for later</b> <span class="muted small">${saved.length} backup${saved.length === 1 ? '' : 's'}</span></summary>
        <div class="queue">${saved.map(j => `<div class="qitem">${scoreBadge(j.score)}<a class="grow" href="#job/${encodeURIComponent(j.id)}"><span class="qt">${esc(j.title)}</span><br><span class="muted small">${esc(j.company)}</span></a>${closedTag(j)}${deadlineTag(j)}<button class="btn sm" data-act="stage" data-status="${j.cv_path ? 'ready' : 'queued'}" data-job="${esc(j.id)}" data-from="saved">Bring back</button></div>`).join('')}</div></details>` : ''}
      ${done.length ? `<details class="card"><summary><b>Finished</b> <span class="muted small">${of('offer').length} offer${of('offer').length === 1 ? '' : 's'}, ${of('rejected').length} rejected${of('no_response').length ? `, ${of('no_response').length} no response` : ''}</span></summary>
        <div class="queue">${done.map(j => `<a class="qitem" href="#job/${encodeURIComponent(j.id)}">${scoreBadge(j.score)}<span><span class="qt">${esc(j.title)}</span><br><span class="muted small">${esc(j.company)}</span></span>${stagePill(j.status)}</a>`).join('')}</div></details>` : ''}`;
  } else if (tab === 'postings') {
    // Every posting any search found, newest first, with where it came from.
    const list = [...jobs].sort((a, b) => String(b.found_at).localeCompare(String(a.found_at)));
    const sources = [...new Set(list.map(j => j.source))].sort();
    body = `<div class="row" style="margin-bottom:10px"><input type="text" id="filter" placeholder="Filter by title, company or location" style="max-width:420px">
      <select id="srcFilter" style="width:auto"><option value="">All sources</option>${sources.map(x => `<option value="${esc(x)}">${esc(sourceName(x))} (${list.filter(j => j.source === x).length})</option>`).join('')}</select></div>
      <section class="card" style="padding:6px 10px"><table class="jobs" id="t-postings"><thead><tr>${sortTh('Age', 'date')}${sortTh('Role')}${sortTh('Salary', 'num')}${sortTh('Source')}${sortTh('Fit', 'num')}${sortTh('Stage', 'rank')}<th></th></tr></thead><tbody>
      ${list.map(j => `<tr class="click" data-expand="${esc(j.id)}" data-src="${esc(j.source)}" data-text="${esc(`${j.title} ${j.company} ${j.location}`.toLowerCase())}">
        <td class="small muted nowrap" data-v="${esc(ageValue(j))}">${ageTag(j)}</td>
        <td class="role" data-v="${esc(`${j.title} ${j.company}`.toLowerCase())}"><b>${esc(j.title)}</b><br><span class="muted small">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}</span></td>
        <td class="small salary" data-v="${salaryValue(j.salary)}">${salaryCell(j)}</td><td class="small" data-v="${esc(j.source)}">${esc(sourceName(j.source))}</td><td data-v="${j.score ?? -1}">${scoreBadge(j.score)}</td><td class="stage" data-v="${stageOrder(j.status)}">${stagePill(j.status)} ${closedTag(j)}${deadlineTag(j)}</td>
        <td>${j.url ? `<button class="btn ghost" data-act="open" data-what="posting" data-job="${esc(j.id)}" title="Open the posting">${svg('open')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table>${list.length ? '' : '<p class="empty">No postings yet. Run a search from the Overview.</p>'}</section>`;
  } else {
    const list = jobs.filter(j => tab === 'skipped' ? ['skipped', 'dismissed'].includes(j.status) : !['skipped', 'dismissed'].includes(j.status));
    let why = '';
    if (tab === 'skipped' && list.length) {
      // Group the reasons, so it's clear whether settings or fit are skipping things.
      const kind = j => {
        const r = j.reasoning || '';
        if (j.status === 'dismissed') return 'You marked them not interested';
        if (j.closed_at) return 'The posting closed';
        if (!r.startsWith('Filtered out:')) return 'Fit score below your minimum (Settings → Preferences)';
        if (r.includes('no title or keyword match')) return 'Title doesn\'t match any job title or keyword in CV & career';
        if (r.includes('location')) return 'Outside your locations';
        if (r.includes('title contains')) return 'Title has a word you skip (Skip titles containing)';
        if (r.includes('salary')) return 'Salary below your minimum';
        if (r.includes('excluded company')) return 'A company you skip';
        return 'Other';
      };
      const counts = {};
      list.forEach(j => { const k = kind(j); counts[k] = (counts[k] || 0) + 1; });
      why = `<section class="card"><header><h2>Why they were skipped</h2>
          <div class="row"><button class="btn" data-act="rescore" data-group="skipped" title="Score these again against your CVs and settings as they are now">Score again</button><button class="btn ghost" data-act="run" data-task="search-force" title="Search again, and look again at postings set aside before">Search again, including set-aside postings</button></div></header>
        <table><tbody>${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td style="text-align:right"><b>${n}</b></td></tr>`).join('')}${elsewhere ? `<tr><td>Outside your locations (not shown)</td><td style="text-align:right"><b>${elsewhere}</b></td></tr>` : ''}</tbody></table>
        <p class="muted small">Most skips happen before Claude sees a posting: its title must match a job title or keyword from <a href="#cvs">Your CVs</a>, and its location one of your <a href="#settings/search">locations</a>. Change those, then use <b>Score again</b> to check these postings against your new settings.</p></section>`;
    }
    body = `${why}<input type="text" id="filter" placeholder="Filter by title, company or location" style="max-width:420px">
      <section class="card" style="padding:6px 10px"><table class="jobs" id="t-${tab}"><thead><tr>${sortTh('Fit', 'num')}${sortTh('Role')}${sortTh('Salary', 'num')}${sortTh('Stage', 'rank')}${tab === 'skipped' ? sortTh('Why') : sortTh('Age', 'date')}${tab === 'list' ? '<th></th>' : ''}</tr></thead><tbody>
      ${list.map(j => `<tr class="click" data-expand="${esc(j.id)}" data-text="${esc(`${j.title} ${j.company} ${j.location}`.toLowerCase())}">
        <td data-v="${j.score ?? -1}">${scoreBadge(j.score)}</td><td class="role" data-v="${esc(`${j.title} ${j.company}`.toLowerCase())}"><b>${esc(j.title)}</b><br><span class="muted small">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}</span></td>
        <td class="small salary" data-v="${salaryValue(j.salary)}">${salaryCell(j)}</td><td class="stage" data-v="${stageOrder(j.status)}">${stagePill(j.status)} ${closedTag(j)}${deadlineTag(j)}</td>${tab === 'skipped'
          ? `<td class="small why" data-v="${esc((j.reasoning || '').toLowerCase())}">${esc(j.reasoning || '')}</td>`
          : `<td class="small muted nowrap" data-v="${esc(ageValue(j))}">${ageTag(j)}</td>`}${tab === 'list' ? `<td class="row-act">${rowActions(j)}</td>` : ''}</tr>`).join('')}
      </tbody></table>${list.length ? '' : '<p class="empty">Nothing here yet.</p>'}</section>`;
  }
  page(`<div class="head"><div class="grow"><h1>Applications</h1><p class="muted">${jobs.length} roles found so far.</p></div>
    <div class="row"><a class="btn ghost" href="/api/export.csv" download="Job Hunt applications.csv" title="Your applications as a spreadsheet">Export</a><a class="btn" href="#add">${svg('add')}Add a job</a></div></div>
    <nav class="tabs">${tabs.map(([id, n]) => `<a href="#pipeline/${id}" class="${id === tab ? 'on' : ''}">${n}</a>`).join('')}</nav>${body}`);
  const f = $('#filter'), src = $('#srcFilter');
  const apply = () => {
    const q = (f?.value || '').toLowerCase(), from = src?.value || '';
    main().querySelectorAll('tr[data-text]').forEach(tr => { tr.hidden = (q && !tr.dataset.text.includes(q)) || (from && tr.dataset.src !== from); });
  };
  f?.addEventListener('input', apply);
  src?.addEventListener('change', apply);
  main().querySelectorAll('table.jobs').forEach(applySort);
  // j / k on a job page walk through the list as it was shown here.
  jobOrder = [...main().querySelectorAll('[data-expand], .board .jcard')].map(el => el.dataset.expand || decodeURIComponent(el.getAttribute('href').replace('#job/', '')));
}

/** How each source is called on screen. */
const SOURCE = { adzuna: 'Adzuna', jsearch: 'Google for Jobs', jooble: 'Jooble', indeed: 'Indeed', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', smartrecruiters: 'SmartRecruiters', workable: 'Workable', linkedin: 'LinkedIn', bayt: 'Bayt', naukrigulf: 'Naukrigulf', gulftalent: 'GulfTalent', eluta: 'Eluta', workopolis: 'Workopolis', glassdoor: 'Glassdoor', jobbank: 'Job Bank', ziprecruiter: 'ZipRecruiter', manual: 'Added by you', clip: 'Sent from your browser', alert: 'Job-alert email', email: 'Job-alert email' };
const sourceName = s => SOURCE[s] || (s ? s[0].toUpperCase() + s.slice(1) : '');
/** Stages a posting can be picked from, whatever its score or location ("Tailor anyway"). */
const CAN_CHOOSE = ['skipped', 'dismissed', 'saved'];
/** The next step for a job, right on its row. */
function rowActions(j) {
  const id = esc(j.id);
  if (j.status === 'ready') return `<button class="btn primary sm" data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">Approve</button><button class="btn ghost sm" data-act="stage" data-status="dismissed" data-job="${id}" data-from="ready" title="Not interested">✕</button>`;
  if (j.status === 'approved') return `<a class="btn primary sm" href="#apply/${encodeURIComponent(j.id)}">Apply</a>`;
  if (j.status === 'queued') return `<button class="btn sm" data-act="tailorPicked" data-job="${id}">Tailor</button>`;
  if (['skipped', 'dismissed'].includes(j.status)) return `<button class="btn ghost sm" data-act="tailorAnyway" data-job="${id}">Tailor anyway</button>`;
  return '';
}

/** The posting's stated pay, or a dash. Extras some boards add ("• Offers Equity") go in the tooltip. */
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

function card(j) {
  return `<a class="jcard" href="#job/${encodeURIComponent(j.id)}">
    <span class="t">${esc(j.title)} ${closedTag(j)}${deadlineTag(j)}</span>
    <span class="muted small">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}</span>
    ${j.salary ? `<span class="small">${salaryCell(j)}</span>` : ''}
    <span class="row small">${scoreBadge(j.score)}${j.coverage_after != null ? `<span class="muted">${pct(j.coverage_after)} of the posting's keywords</span>` : ''}</span>
  </a>`;
}

// ---- Tracker ----
let trackFilter = 'active';
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
    <a class="grow tmain" href="#job/${encodeURIComponent(r.id)}"><span class="qt">${esc(r.title)}</span> ${closedTag(r)}${deadlineTag(r)}<br><span class="muted small">${esc(r.company)}${r.location ? ` · ${esc(r.location)}` : ''}</span></a>
    ${stepsHtml(r)}
    <div class="tnext"><span class="who ${esc(r.who)}">${{ you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' }[r.who] || ''}</span>
      <span class="small">${nextText(r)}</span>
      <span class="muted small">${r.last_step ? `${esc(r.last_step)} ${r.days_since === 0 ? 'today' : `${r.days_since} day${r.days_since === 1 ? '' : 's'} ago`}` : ''}</span></div>
    <span class="row todo-act">${act}</span></div>`;
}

// ---- Job ----
let jobPoll;
const JOB_TABS = [['overview', 'Overview'], ['docs', 'CV &amp; letter'], ['apply', 'Questions &amp; contacts'], ['interview', 'Interview'], ['notes', 'Notes &amp; history']];
const jobTabs = {};
async function showJob(id) {
  clearTimeout(jobPoll);
  const [{ job: j, warnings, history, progress, own, prep, preparing, cv_pdf, letter_pdf, revising, undo, follow_up: fu, following_up, thanks, thanking, answers, answering, offer, advising, contacts, writing_to, ats, claude_desktop, recruiter, recruiters_here }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(id)}`), api('/api/settings')]);
  const tailoring = (overview?.running || []).includes(`tailor:${id}`);
  const gaps = new Set((j.keyword_gaps || []).map(k => k.toLowerCase()));
  const tracks = st.profile.tracks;
  const flags = j.red_flags || [];
  j.warnings = warnings || [];
  // Open on what this stage needs, or on the tab you last used for this job.
  const stageTab = { ready: 'docs', queued: 'docs', approved: 'apply', applied: 'apply', interviewing: 'interview', offer: 'apply' }[j.status] || 'overview';
  const tab = jobTabs[id] || stageTab;
  const badge = { docs: revising || tailoring ? 'Working on it' : '', apply: answering || following_up || writing_to || advising ? 'Working on it' : (j.status === 'offer' && !offer ? 'Weigh the offer' : ''), interview: preparing ? 'Writing' : '' };
  page(`
    <div class="head">
      <div class="grow">
        <div class="eyebrow"><a href="#pipeline">Applications</a> / ${esc(STAGES[j.status] || j.status)}</div>
        <h1>${esc(j.title)}</h1>
        <div class="facts" style="margin-top:6px"><b>${esc(j.company)}</b>${j.location ? `<span>${esc(j.location)}</span>` : ''}${j.salary ? `<span>${esc(j.salary)}</span>` : ''}<span>${ageTag(j)} · found on ${esc(sourceName(j.source))}</span>${stagePill(j.status)}${closedTag(j)}${deadlineTag(j)}</div>
      </div>
    </div>
    <div class="actions">
      ${j.status === 'ready' ? `<button class="btn primary" data-act="approve" data-email="${esc(j.apply_email || '')}">${svg('check')}${j.apply_email ? `Approve and email to ${esc(j.apply_email)}` : 'Approve and apply'}</button>` : ''}
      ${j.status === 'queued' && !tailoring ? `<button class="btn primary" data-act="tailorPicked" data-job="${esc(j.id)}">Tailor my CV for this role</button>` : ''}
      ${j.status === 'approved' ? `<button class="btn" data-act="stage" data-status="applied">Mark applied</button>` : ''}
      ${j.url ? `<button class="btn" data-act="open" data-what="posting">${svg('open')}Open posting</button>` : ''}

      ${['ready', 'approved', 'queued'].includes(j.status) ? `<button class="btn" data-act="stage" data-status="saved">Save for later</button><button class="btn danger" data-act="stage" data-status="dismissed">Not interested</button>` : ''}
      ${j.status === 'saved' ? `<button class="btn primary" data-act="stage" data-status="${j.cv_path ? 'ready' : 'queued'}">Bring it back</button>` : ''}
      ${['skipped', 'dismissed'].includes(j.status) || (j.status === 'saved' && !j.cv_path) ? `<button class="btn ${j.status === 'saved' ? '' : 'primary'}" data-act="tailorAnyway" data-job="${esc(j.id)}" ${tailoring ? 'disabled' : ''}>Tailor anyway</button>` : ''}
    </div>
    ${j.warnings.length && !j.closed_at && !['applied', 'interviewing', 'offer'].includes(j.status) ? `<div class="card" style="border-color:var(--warn)"><b>Check this posting is real and open before you put time in.</b><ul class="flags">${j.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${j.closed_at && ['queued', 'ready', 'approved', 'skipped'].includes(j.status) ? `<div class="card" style="border-color:var(--crit)"><b>This posting has closed.</b><p class="muted">Job Hunt noticed on ${esc(fmtDate(j.closed_at))} that the company took it down or stopped taking applications. Open the posting to make sure, then mark it Not interested.</p></div>` : ''}
    ${j.status === 'approved' ? `<div class="card row" style="border-color:var(--accent);justify-content:space-between"><span><b>Next: submit it on the company's site.</b><br><span class="muted">The Apply screen has the posting, your files and your answers in one place.</span></span><a class="btn primary" href="#apply/${encodeURIComponent(j.id)}">Apply</a></div>` : ''}
    ${(recruiters_here || []).length ? `<div class="card"><b>Recruiter${recruiters_here.length === 1 ? '' : 's'} for this application</b>${recruiters_here.map(r => `<div class="small" style="margin-top:6px"><b>${esc(r.name)}</b> <span class="muted">${esc(r.company_of || '')}</span> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ` · <a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}${r.linkedin ? ` · <a href="#" data-act="link" data-url="${esc(r.linkedin)}">LinkedIn</a>` : ''}<br><span class="muted">${esc(r.emails)} email${r.emails === 1 ? '' : 's'} · last ${esc(ago(r.last_at))}${r.last_subject ? ` · “${esc(r.last_subject)}”` : ''}</span></div>`).join('')}<a class="small" href="#recruiters">All recruiters</a></div>` : ''}
    ${recruiter && !['rejected', 'offer', 'no_response', 'dismissed'].includes(j.status) && !(recruiters_here || []).some(r => r.email === recruiter.email && ['applied', 'interviewing'].includes(j.status)) ? recruiterCard(recruiter, j) : ''}
    ${tailoring ? `<div class="card"><p><span class="spin"></span> Tailoring your CV and cover letter for this role… this page updates by itself.</p></div>` : ''}
    ${revising ? `<div class="card"><p><span class="spin"></span> Making your changes… this page updates by itself.</p></div>` : ''}
    <nav class="tabs job-tabs" id="jobTabs">${JOB_TABS.map(([k, n]) => `<a href="#" data-jtab="${k}" class="${k === tab ? 'on' : ''}">${n}${badge[k] ? `<span class="tab-dot" title="${esc(badge[k])}"></span>` : ''}</a>`).join('')}</nav>
    <div class="jpane" data-pane="overview" ${tab === 'overview' ? '' : 'hidden'}>
      <div class="grid-2">
        <div class="stack">
        <section class="card">
          <header><h2>Fit</h2></header>
          <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
            ${j.score != null ? `<div class="fit-pair"><div><div class="ring" style="--p:${j.score}"><b>${j.score}</b></div><span class="muted small">${j.score_after != null ? 'your CV' : 'fit'}</span></div>${j.score_after != null ? `<span class="fit-arrow">→</span><div><div class="ring" style="--p:${j.score_after}"><b>${j.score_after}</b></div><span class="muted small">tailored</span></div>` : ''}</div>` : ''}
            <div><p>${esc(j.reasoning || 'Not scored yet.')}</p>${j.track ? `<p class="muted small" style="margin-top:6px">Matched to your <b>${esc((tracks.find(t => t.name === j.track) || {}).label || j.track)}</b> CV.${j.score_after != null ? ` After tailoring, the same check scores the tailored CV <b>${j.score_after}</b> (${j.score_after >= j.score ? '+' : ''}${j.score_after - j.score}).` : ''}</p>` : ''}</div>
          </div>
          ${flags.length ? `<div><b class="small">Red flags</b><ul class="flags">${flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
        </section>
        ${(j.keywords || []).length ? `<section class="card">
          <header><h2>Posting keywords</h2>${j.coverage_after != null ? `<span class="muted small">your CV covered <b>${pct(j.coverage_before)}</b> before tailoring, <b>${pct(j.coverage_after)}</b> after</span>` : ''}</header>
          <div>${j.keywords.map(k => `<span class="kw ${gaps.has(k.toLowerCase()) ? 'miss' : ''}">${esc(k)}</span>`).join('')}</div>
          ${gaps.size ? '<p class="muted small">Dashed keywords are not in the tailored CV, because nothing in your experience backs them up or they didn\'t fit. Add one yourself only if it\'s true.</p>' : ''}
        </section>` : ''}
        </div>
        <div class="stack">
        ${progress ? `<section class="card">
          <header><h2>Progress</h2><span class="who ${esc(progress.who)}">${{ you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' }[progress.who] || ''}</span></header>
          ${stepsHtml(progress)}
          <p style="margin:10px 0 0"><b>Next:</b> ${nextText(progress)}</p>
          <ul class="timeline small">${progress.steps.filter(x => x.at).map(x => `<li><b>${esc(x.step)}</b> <span class="muted">${esc(fmtDate(x.at))} · ${esc(ago(x.at))}</span></li>`).join('')}</ul>
        </section>` : ''}
        <section class="card">
          <header><h2>Stage</h2></header>
          <div class="row"><select id="stage" style="width:auto">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <input type="text" id="stageNote" placeholder="Note (optional)" style="flex:1;width:auto"><button class="btn" data-act="setStage">Save</button></div>
        </section>
        <details class="card" open><summary><b>The posting</b></summary><div class="posting">${esc(j.description)}</div></details>
        </div>
      </div>
    </div>
    <div class="jpane" data-pane="docs" ${tab === 'docs' ? '' : 'hidden'}>
    ${j.cv_path || j.cover_letter || tailoring ? '' : `<section class="card"><p class="muted">Not tailored yet.</p><div class="row"><button class="btn primary" data-act="tailorPicked" data-job="${esc(j.id)}">Tailor my CV for this role</button></div></section>`}
    ${j.cv_path || j.cover_letter ? `<section class="card">
      <div class="row file-row">${j.cv_path ? `<button class="btn" data-act="open" data-what="cv">${svg('doc')}Open tailored CV</button><button class="btn" data-act="open" data-what="letter">${svg('doc')}Open cover letter</button>
        <button class="btn ghost" data-act="open" data-what="cv-pdf" title="${cv_pdf ? 'Open the PDF copy' : 'Make a PDF copy (needs Word or LibreOffice)'}">CV PDF</button><button class="btn ghost" data-act="open" data-what="letter-pdf" title="${letter_pdf ? 'Open the PDF copy' : 'Make a PDF copy (needs Word or LibreOffice)'}">Letter PDF</button>
        <button class="btn" data-act="open" data-what="folder">${svg('folder')}Show files</button>` : ''}</div>
      <header><h2>Preview</h2><div class="seg small" id="pvTabs">
        ${j.cv_path ? '<button class="on" data-pv="cv">Tailored CV</button>' : ''}${j.cover_letter && !own?.letter ? `<button class="${j.cv_path ? '' : 'on'}" data-pv="letter">Cover letter</button>` : ''}</div></header>
      ${j.cv_path ? '<div class="paper" id="pv-cv"><p class="muted">Loading…</p></div>' : ''}
      ${j.cover_letter && !own?.letter ? `<div class="paper letter" id="pv-letter" ${j.cv_path ? 'hidden' : ''}>${letterHtml(j.cover_letter, st.signature)}</div>` : ''}
      <p class="muted small">${j.cv_path ? '<span class="chg-key">Highlighted</span> paragraphs were reworded for this posting. ' : ''}Open the Word files above to see the exact layout.</p>
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
          ${tracks.length ? `<p class="muted small">Starts from your <b>${esc(trackLabel(j.track || tracks[0].name))}</b> CV, the closest fit for this role.</p>` : '<p class="muted small">Add a CV in <a href="#cvs">CV & career</a> first.</p>'}
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
    ${['ready', 'approved', 'applied', 'interviewing'].includes(j.status) || answers ? `<section class="card">
      <header><h2>Application questions</h2>${answering ? '<span class="muted small"><span class="spin"></span>Writing…</span>' : ''}</header>
      <p class="muted small">Paste the form's questions, one per line, or leave it empty for the usual ones (why this role, salary expectations, notice period…). Answers use your CV, this posting and your <a href="#cvs">facts for forms</a>.</p>
      <textarea id="questions" placeholder="Why do you want to work at ${esc(j.company)}?\nHow many years of experience do you have with SAP?">${esc((answers || []).map(a => a.question).join('\n'))}</textarea>
      <div class="row"><button class="btn primary" data-act="answers" ${answering ? 'disabled' : ''}>${answers ? 'Write them again' : 'Write answers'}</button></div>
      ${(answers || []).map((a, i) => `<div class="qa"><b>${esc(a.question)}</b><div class="posting" id="ans${i}">${esc(a.answer)}</div><button class="btn ghost" data-act="copy" data-from="ans${i}">Copy</button></div>`).join('')}
    </section>` : ''}
    ${fu || following_up || j.status === 'applied' ? `<section class="card">
      <header><h2>Follow-up</h2>${following_up ? '<span class="muted small"><span class="spin"></span>Writing…</span>' : `<button class="btn" data-act="followUp" data-job="${esc(j.id)}">${fu ? 'Write again' : 'Write follow-up'}</button>`}</header>
      ${fu ? `<p class="small muted">${fu.draft ? 'Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>' : 'Written'} ${esc(ago(fu.at))}${fu.to ? ` · to ${esc(fu.to)}` : ' · add the recruiter\'s address before sending'}</p>
        <p><b>${esc(fu.subject)}</b></p><div class="posting" id="fuBody">${esc(fu.body)}</div>
        <div class="row"><button class="btn ghost" data-act="copy" data-from="fuBody">Copy</button></div>`
        : `<p class="muted">${following_up ? 'Claude is writing a short, polite note asking about the timeline.' : `No reply yet? Job Hunt drafts a short follow-up ${st.profile.follow_up_after ? `${st.profile.follow_up_after} days after you apply` : 'when you ask'}.`}</p>`}
    </section>` : ''}
    ${!['skipped', 'dismissed'].includes(j.status) ? `<section class="card">
      <header><h2>People at ${esc(j.company)}</h2>${writing_to ? '<span class="muted small"><span class="spin"></span>Writing…</span>' : ''}</header>
      <p class="muted small">A recruiter, the hiring manager or someone you know there. A short note to the right person often counts for more than a perfect CV. <a href="#" data-act="link" data-url="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(j.company + ' ' + j.title.split(/[,(-]/)[0])}">Look on LinkedIn</a></p>
      ${(contacts || []).map((c, i) => `<div class="qa"><div class="row" style="justify-content:space-between"><span><b>${esc(c.name)}</b>${c.role ? ` · ${esc(c.role)}` : ''}${c.email ? ` · ${esc(c.email)}` : ''}${c.link ? ` · <a href="#" data-act="link" data-url="${esc(c.link)}">profile</a>` : ''}</span>
        <span class="row"><button class="btn" data-act="outreach" data-i="${i}" ${writing_to ? 'disabled' : ''}>${c.message ? 'Write again' : 'Write a message'}</button><button class="btn ghost" data-act="removeContact" data-i="${i}">Remove</button></span></div>
        ${c.message ? `<div class="posting" id="msg${i}">${esc(c.message)}</div><button class="btn ghost" data-act="copy" data-from="msg${i}">Copy</button>` : ''}</div>`).join('')}
      <div class="row contact-add"><input type="text" id="cName" placeholder="Name"><input type="text" id="cRole" placeholder="Role (e.g. hiring manager)"><input type="text" id="cEmail" placeholder="Email or LinkedIn link (optional)">
        <button class="btn" data-act="addContact">Add</button></div>
    </section>` : ''}    ${offer || advising || j.status === 'offer' ? `<section class="card prep">
      <header><h2>The offer</h2>${advising ? '<span class="muted small"><span class="spin"></span>Weighing it…</span>' : ''}</header>
      <textarea id="offerText" placeholder="Paste the offer: base salary, bonus, equity, benefits, vacation, start date…">${esc(offer?.offer || '')}</textarea>
      <div class="row"><button class="btn primary" data-act="offerAdvice" ${advising ? 'disabled' : ''}>${offer ? 'Weigh it again' : 'Weigh the offer'}</button>
        <span class="muted small">Compared with the posted range, your minimum and any other offers, with what to ask for and a counter-offer email.</span></div>
      ${offer?.advice ? mdHtml(offer.advice) : ''}
    </section>` : ''}
    </div>
    <div class="jpane" data-pane="interview" ${tab === 'interview' ? '' : 'hidden'}>
    <section class="card prep">
      <header><h2>Interview prep</h2>${preparing ? '<span class="muted small"><span class="spin"></span>Writing…</span>' : `<button class="btn" data-act="prep">${prep ? 'Write again' : 'Write prep sheet'}</button>`}</header>
      ${prep ? mdHtml(prep) : `<p class="muted">${preparing ? 'Claude is writing likely questions, answers from your CV, gaps to prepare for and questions to ask. This page updates by itself.' : 'Likely questions with answers from your CV, what the company is up to now (from a quick web search), gaps to prepare for, and questions to ask them.'}</p>`}
      ${prep ? '<p class="muted small">Also saved as “Interview prep.md” with this application\'s files.</p>' : ''}
      <p class="muted small">The evening before an interview on your calendar, Job Hunt makes sure this sheet is ready and reminds you.</p>
      <p class="muted small">${claude_desktop ? `Practise out loud: in the Claude app, ask <b>“Practise my interview for ${esc(j.company)}”</b>. Claude plays the interviewer and gives feedback on each answer.` : 'Want a mock interview with feedback? Add Job Hunt to the Claude app in <a href="#settings/extras">Settings → Integrations</a>.'}</p>
    </section>
    ${thanks || thanking || ['interviewing', 'offer'].includes(j.status) ? `<section class="card">
      <header><h2>Thank-you note</h2>${thanking ? '<span class="muted small"><span class="spin"></span>Writing…</span>' : `<button class="btn" data-act="thanks">${thanks ? 'Write again' : 'Write it now'}</button>`}</header>
      ${thanks ? `<p class="small muted">${thanks.draft ? 'Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>' : 'Written'} ${esc(ago(thanks.at))}${thanks.to ? ` · to ${esc(thanks.to)}` : ' · add the interviewer\'s address before sending'}</p>
        <p><b>${esc(thanks.subject)}</b></p><div class="posting">${esc(thanks.body)}</div>
        <p class="muted small">Fill in the [bracketed] detail from your conversation, then send it the same day.</p>` : '<p class="muted">Job Hunt drafts one about an hour and a half after each interview on your calendar starts, so you can send it the same day.</p>'}
    </section>` : ''}
    </div>
    <div class="jpane" data-pane="notes" ${tab === 'notes' ? '' : 'hidden'}>
      <div class="grid-2"><div class="stack">
        <section class="card">
          <header><h2>Notes</h2></header>
          <textarea id="notes" placeholder="Contacts, referral, salary talk…">${esc(j.notes || '')}</textarea>
          <div class="row"><button class="btn" data-act="saveNotes">Save notes</button></div>
        </section>
      </div><div class="stack">
        <section class="card">
          <header><h2>History</h2></header>
          <div class="feed">${history.map(e => `<div><time title="${esc(new Date(e.created_at).toLocaleString())}">${esc(fmtDate(e.created_at))}</time><span>${eventText(e)}</span></div>`).join('')}</div>
        </section>
      </div></div>
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
  if (j.cv_path) api(`/api/jobs/${encodeURIComponent(id)}/preview`).then(({ cv }) => {
    const el = $('#pv-cv'); if (el) el.innerHTML = cv ? cvHtml(cv) : own?.cv ? '<p class="muted">Your own CV is a PDF: use <b>Open tailored CV</b> to see it.</p>' : '<p class="muted">The tailored CV file is missing. Re-tailor to make a new one.</p>';
  }).catch(e => { const el = $('#pv-cv'); if (el) el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
  main().dataset.contacts = JSON.stringify(contacts || []);
  if (tailoring || preparing || revising || following_up || answering || advising || writing_to || thanking) jobPoll = setTimeout(() => { if (location.hash === `#job/${encodeURIComponent(id)}`) { refreshOverview().then(route); } }, 4000);
}

// ---- Inbox ----
// ---- What to do next ----
/** One list of what's waiting on you, most urgent first, with the action right on each row. */
function todoHtml(o) {
  jobOrder = [...(o.ready || []), ...(o.approved || []), ...(o.follow_ups || [])].map(j => j.id);
  const row = (j, sub, actions) => `<div class="todo-row">
      ${scoreBadge(j.score)}
      <a class="grow" href="#job/${encodeURIComponent(j.id)}"><span class="qt">${esc(j.title)}</span> ${closedTag(j)}${deadlineTag(j)}<br><span class="muted small">${esc(j.company)}${sub ? ` · ${sub}` : ''}</span></a>
      <span class="row todo-act">${actions}</span></div>`;
  const id = j => esc(j.id);
  const groups = [];
  const soon = (o.interviews || []).filter(i => new Date(i.start) - Date.now() < 3 * 86400000);
  if (soon.length) groups.push(['Interviews in the next few days', soon.map(i => `<div class="todo-row"><span class="pill interviewing">${esc(fmtWhen(i.start))}</span>
      <span class="grow"><span class="qt">${esc(i.company || i.title)}</span>${i.job_title ? `<br><span class="muted small">${esc(i.job_title)}</span>` : ''}</span>
      ${i.job_id ? `<span class="row todo-act"><a class="btn" href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prep</a></span>` : ''}</div>`).join('')]);
  const picking = (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`));
  const inWork = (o.to_tailor || []).length - picking.length;
  if (picking.length) groups.push([`Pick the roles to tailor your CV for (${picking.length})`, `<div data-pickbox>
    <p class="muted small" style="margin:0 0 6px">These cleared your fit score. Tick the ones you want: Job Hunt picks the closest of your CVs for each, tailors it and writes a cover letter.</p>
    ${(() => {
      // Grouped by the CV each would be tailored from, best fit first.
      const byCv = {};
      [...picking].sort((a, b) => (b.score || 0) - (a.score || 0)).forEach(j => { (byCv[j.track || ''] ||= []).push(j); });
      const many = Object.keys(byCv).length > 1;
      return Object.entries(byCv).map(([t, list]) => `${many ? `<h4 class="pick-cv">From your ${esc(trackLabel(t) || 'main')} CV</h4>` : ''}${list.map(j => `<div class="pick-item"><label class="todo-row pick"><input type="checkbox" data-pick="${esc(j.id)}">
      ${scoreBadge(j.score)}
      <span class="grow"><span class="qt">${esc(j.title)}</span> ${closedTag(j)}${deadlineTag(j)}${j.recruiter ? ` <span class="pill good" title="You know ${esc(j.recruiter)}, a recruiter there">Recruiter: ${esc(firstName(j.recruiter))}</span>` : ''}<br><span class="muted small">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}${j.salary ? ` · ${esc(j.salary)}` : ''} · ${ageTag(j)}</span></span>
      <span class="row todo-act"><a class="btn ghost" href="#job/${encodeURIComponent(j.id)}">View</a><button class="btn ghost" type="button" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="queued" title="Not interested">✕</button></span></label>
      ${j.reasoning || (j.red_flags || []).length ? `<details class="pick-why"><summary class="small muted">Why it fits${(j.red_flags || []).length ? ` · ${j.red_flags.length} red flag${j.red_flags.length === 1 ? '' : 's'}` : ''}</summary><p class="small">${esc(j.reasoning || '')}</p>${(j.red_flags || []).length ? `<ul class="flags small">${j.red_flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</details>` : ''}</div>`).join('')}`).join('');
    })()}
    <div class="row" style="margin-top:8px"><button class="btn primary" data-act="tailorPicked" disabled>Tailor selected</button>${picking.length > 5 ? '<button class="btn" type="button" data-act="pickTop" data-n="5">Tick the top 5</button>' : ''}<button class="btn ghost" type="button" data-act="pickAll">Select all</button>${inWork ? `<span class="muted small"><span class="spin"></span>Tailoring ${inWork}…</span>` : ''}</div></div>`]);
  else if (inWork) groups.push(['Tailoring', `<p class="muted"><span class="spin"></span>Tailoring ${inWork} application${inWork === 1 ? '' : 's'}… they appear under Ready to approve.</p>`]);
  if (o.ready?.length) groups.push([`Ready to approve (${o.counts.ready}) <a class="btn primary sm" href="#review" style="margin-left:8px">Review them one by one</a>`, o.ready.map(j => row(j, [fitChange(j), j.coverage_after != null ? `${pct(j.coverage_after)} of the posting's keywords` : '', j.apply_email ? 'applies by email' : ''].filter(Boolean).join(' · '),
    `<a class="btn primary" href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs">Check and approve</a>
     <button class="btn ghost" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="ready" title="Not interested">✕</button>`)).join('')]);
  if (o.recruiter_asks?.length) groups.push(['Ask your recruiters to put you forward', o.recruiter_asks.map(j => row(j, `you know ${esc(j.recruiter)} there`,
    `<button class="btn primary" data-act="askRecruiter" data-job="${id(j)}" data-name="${esc(firstName(j.recruiter))}">Ask ${esc(firstName(j.recruiter))}</button>`)).join('')]);
  if (o.approved?.length) groups.push(['Submit on the company\'s site', o.approved.map(j => row(j, j.location ? esc(j.location) : '',
    `<a class="btn primary" href="#apply/${encodeURIComponent(j.id)}">Apply</a>
     <button class="btn ghost" data-act="stage" data-status="applied" data-job="${id(j)}" data-from="approved" title="Already submitted it">Mark applied</button>`)).join('')]);
  if (o.quiet?.length) groups.push([`Quiet for 4+ weeks <button class="btn sm" data-act="closeQuiet" data-ids="${esc(JSON.stringify(o.quiet.map(j => j.id)))}" style="margin-left:8px">Close ${o.quiet.length === 1 ? 'it' : `all ${o.quiet.length}`} as No response</button>`,
    o.quiet.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}, no reply`,
      `<button class="btn ghost sm" data-act="stage" data-status="no_response" data-job="${id(j)}" data-from="applied">No response</button>`)).join('')]);
  if (o.follow_ups?.length) groups.push(['No reply yet: follow up', o.follow_ups.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}`,
    `<button class="btn" data-act="followUp" data-job="${id(j)}">Write follow-up</button>`)).join('')]);
  if (!groups.length) {
    const ready = o.setup?.claude && o.setup?.cvs;
    return `<section class="card todo"><header><h2>To do</h2></header><p class="muted">${ready ? 'You\'re all caught up. New matches appear here after each search.' : 'Finish setting up above, then search for jobs.'}</p></section>`;
  }
  return `<section class="card todo"><header><h2>To do</h2><a class="btn ghost" href="#pipeline">All applications</a></header>
    ${groups.map(([h, rows]) => `<div class="todo-group"><h3>${h}</h3>${rows}</div>`).join('')}</section>`;
}

// ---- Two computers ----
function inUseHtml(u) {
  if (!u) return '';
  if (u.handed_to) return `<section class="card sync-banner"><header><h2>Job Hunt moved to ${esc(u.handed_to)}</h2></header>
    <p>${esc(u.handed_to)} took over, and your latest data was saved for it. Close Job Hunt here (on a server, just leave it): anything done here now wouldn't reach the other one. To switch back, use <b>Use it here again</b>.</p>
    <div class="row"><button class="btn" data-act="syncResume">Use it here again</button><span class="muted small">${esc(u.handed_to)} saves its latest data for this one and stops, if it's still open; then continue from it here.</span></div></section>`;
  if (u.waiting_for) return `<section class="card sync-banner"><header><h2><span class="spin"></span>Waiting for ${esc(u.waiting_for)}</h2></header>
    <p>${esc(u.waiting_for)} is saving its latest data for this computer. That takes a minute or two, plus however long Google Drive takes to bring it here. Then you'll be offered to continue from it.</p></section>`;
  if (u.other) return `<section class="card sync-banner warn"><header><h2>Job Hunt is open on ${esc(u.other)}</h2></header>
    <p>Use one computer at a time: changes made on both can't be combined. Close Job Hunt there, or take over here: ${esc(u.other)} saves its latest data and stops, and this computer continues from it.</p>
    <div class="row"><button class="btn primary" data-act="takeOver">Take over here</button></div></section>`;
  return '';
}

// ---- Search progress ----
function progressHtml(pr) {
  if (!pr) return '';
  const count = pr.total ? ` ${Math.min(pr.done + 1, pr.total)} of ${pr.total}` : '';
  return `<section class="card progress-card" id="progressCard">
    <header><h2><span class="spin"></span>${esc(pr.stage || 'Starting the search')}${count}</h2><b class="pct">${pr.percent}%</b></header>
    <div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pr.percent}"><i style="width:${pr.percent}%"></i></div>
    <p class="muted small">${esc(pr.detail || '')}</p>
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
      ${s.adzuna ? '' : '<a class="btn" href="#settings/sources">Add Google for Jobs listings</a>'}
      <a class="btn desktop-only" href="#settings/extras">Send to Job Hunt from LinkedIn</a>
      <button class="btn ghost" data-act="run" data-task="search-force" title="Looks again at postings set aside earlier, with your current settings">Search again, including set-aside postings</button>
    </div>
    <p class="muted small">Also set up daily job alerts on LinkedIn, Indeed or your country's job sites for your titles, sent to your Gmail: Job Hunt reads them on every email check. If many postings are set aside for their location or title, widen your locations or add titles in <a href="#cvs">Your CVs</a>.</p>
    <div id="moreIdeas" class="ideas"></div></details>` : '';
  return `<section class="card"><header><h2>Last search</h2><a class="btn ghost" href="#pipeline/postings">See the postings</a></header>
    <div class="facts"><span><b>${r.found}</b> postings found</span><span><b>${r.new}</b> new</span>${r.known ? `<span><b>${r.known}</b> seen before</span>` : ''}<span title="${esc(why)}"><b>${r.filtered}</b> set aside (title or place didn't match)${why ? ` <span class="muted small">(${esc(why)})</span>` : ''}</span><span><b>${r.scored}</b> checked by Claude</span><span><b>${r.tailored}</b> tailored</span>${r.to_pick ? `<span><b>${r.to_pick}</b> to pick from</span>` : ''}${r.deferred ? `<span><b>${r.deferred}</b> left for next time</span>` : ''}${r.closed ? `<span><b>${r.closed}</b> closed</span>` : ''}</div>
    ${(r.by_source || []).length ? `<p class="small muted" style="margin:8px 0 0">From: ${r.by_source.map(x => `${esc(x.name)} <b>${x.found}</b>${x.failed ? ` <span class="bad-text">(${x.failed === x.searches ? 'failed' : `${x.failed} of ${x.searches} searches failed`})</span>` : ''}`).join(' · ')}</p>` : ''}
    ${probs.length ? `<details style="margin-top:8px"><summary class="small">${probs.length} problem${probs.length === 1 ? '' : 's'}</summary><ul class="flags">${probs.slice(0, 12).map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
    ${more}
  </section>`;
}
/** Live updates while a search runs, without redrawing the page. */
setInterval(async () => {
  if (!overview?.progress) return;
  await refreshOverview();
  const card = $('#progressCard');
  if (card && overview.progress) card.outerHTML = progressHtml(overview.progress);
  else if (card || !overview.progress) { if (location.hash === '' || location.hash === '#overview') route(); }
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
  tr.insertAdjacentHTML('afterend', `<tr class="xrow"><td colspan="${cols}"><div class="xpand"><p class="muted"><span class="spin"></span>Loading the posting…</p></div></td></tr>`);
  const box = tr.nextElementSibling.querySelector('.xpand');
  try {
    const { job: j } = await api(`/api/jobs/${encodeURIComponent(tr.dataset.expand)}`);
    const id = esc(j.id);
    box.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><b>${esc(j.title)}</b> · ${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}${j.salary ? ` · ${esc(j.salary)}` : ''}
          <div class="muted small">${ageTag(j)} · found on ${esc(sourceName(j.source))}</div></div>
        <div class="row">
          ${j.url ? `<button class="btn" data-act="open" data-what="posting" data-job="${id}">${svg('open')}Open posting</button>` : ''}
          ${j.status === 'skipped' && j.score == null ? `<button class="btn" data-act="scoreAnyway" data-job="${id}">Score it anyway</button>` : ''}
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
async function showWelcome() {
  try { sessionStorage.setItem('welcomed', '1'); } catch {}
  const st = settingsCache = await api('/api/settings');
  await refreshOverview();
  const s = overview.setup, p = st.profile;
  const fresh = !(p.locations || []).length; // nothing saved yet: suggest this device's country and time zone
  const step = (n, done, title, body) => `<li class="card ${done ? 'done' : ''}"><h2>${done ? '✓ ' : ''}${esc(title)}</h2>${body}</li>`;
  page(`<div class="head"><div class="grow"><h1>Welcome to Job Hunt</h1><p class="muted">Five steps, about five minutes. You can change everything later in Settings.</p></div><a class="btn ghost" href="#overview">Skip for now</a></div>
    ${overview.sync_newer ? '' : `<section class="card"><header><h2>Already using Job Hunt on another computer?</h2></header>
      <p class="muted">If it syncs to Google Drive (Settings → App → Sync between computers), connect the same Google account here and Job Hunt offers to continue with all your CVs, applications and settings. Otherwise, start fresh below.</p>
      ${st.google.client ? `<div class="row"><button class="btn primary" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connected ? `Connected as ${esc(st.google.email || 'you')}: check again` : 'Connect Google'}</button>${st.google.connected ? '<span class="muted small">Nothing to continue from yet? Turn on sync on the other computer, wait a few minutes, then check again.</span>' : ''}</div>
        <div id="googlePaste" ${st.google.pasting ? '' : 'hidden'}>${googlePasteBox(st.google.paste_url)}</div>`
        : '<div class="row"><a class="btn" href="#settings/connections">Set up Google</a></div>'}</section>`}
    <ol class="apply-steps">
      ${step(1, s.claude, 'Connect Claude', `<p class="muted">Claude is the AI that reads postings and rewrites your CV for each. Job Hunt uses your Claude subscription (Pro or Max).</p>
        ${s.engine === 'api' ? `<p class="muted">${s.claude ? '✓ Ready, with your API key.' : 'Add your API key in <a href="#settings/connections">Settings → Accounts</a>.'}</p>`
          : `<div id="welcomeClaude" class="small muted"><span class="spin"></span> Checking…</div><p class="muted small" style="margin-top:8px">No Claude subscription? <a href="#settings/connections">Use an API key instead</a> (you pay per use).</p>`}`)}
      ${step(2, st.cvs.length > 0, 'Add your CV', `<p class="muted">Word, PDF or text. Add one per kind of role (e.g. data engineering, program delivery). Claude reads each one and suggests the job titles to search for.</p>
        <label class="drop"><input type="file" accept=".docx,.pdf,.txt" multiple data-upload="cv-add" hidden><b>Add CVs</b><br><span class="muted small">Click to choose files</span></label>
        ${st.cvs.map(c => `<p class="small" style="margin:8px 0 0"><b>${esc(c.label)}</b>: ${(c.titles || []).length} job titles to search, like ${esc((c.titles || []).slice(0, 4).join(', ') || 'none yet')}${(c.areas || []).length ? `<br><span class="muted">Experience found: ${esc(c.areas.map(a => a.split(':')[0]).join(', '))}</span>` : ''} <a href="#cvs">See all and edit</a></p>`).join('')}
        ${st.cvs.length ? `<p class="small" style="margin-top:8px">${st.career_thinking ? '<span class="spin"></span>Claude is working out your career options: every direction your CV supports, with pay, pros and cons. ' : st.career ? '' : ''}${st.career || st.career_thinking ? '<a href="#cvs">See your career options</a>' : ''}</p>` : ''}`)}
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
        <p class="muted small" style="margin-top:8px">More (Google for Jobs, recruiters, job-alert emails) in <a href="#settings/sources">Job sources</a>. Connecting Gmail lets Job Hunt read replies and book interviews.</p>
        <div class="row"><a class="btn" href="#settings/connections">Connect Gmail (optional)</a></div>`)}
      ${step(5, !!overview.last_search, 'Run your first search', `<p class="muted">It takes a few minutes. Roles that fit appear on the Overview for you to pick; tick the ones you want and Job Hunt tailors your CV and a cover letter for each.</p>
        <div class="row"><button class="btn primary" data-act="welcomeSearch" ${s.claude && st.cvs.length ? '' : 'disabled'}>Search for jobs now</button>${s.claude && st.cvs.length ? '' : '<span class="muted small">After steps 1 and 2.</span>'}</div>`)}
    </ol>`);
  if (s.engine !== 'api') welcomeClaude(false);
}

/** Welcome step 1: whether Claude Code is installed and signed in, with the button to do it. */
async function welcomeClaude(force) {
  const box = $('#welcomeClaude');
  if (!box) return;
  if (force) box.innerHTML = '<span class="spin"></span> Checking…';
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
  const queue = jobs.filter(j => !reviewSkipped.has(j.id)).sort((a, b) => (b.score_after ?? b.score ?? 0) - (a.score_after ?? a.score ?? 0));
  if (!queue.length) {
    page(`<div class="head"><div class="grow"><h1>Review</h1></div></div><section class="card review-done"><h2>All caught up</h2>
      <p class="muted">${jobs.length ? `You skipped ${jobs.length} for now. <a href="#" data-act="reviewReset">Go through them again</a>.` : 'Nothing waiting for your review. New ones appear after you tailor roles.'}</p>
      <div class="row" style="justify-content:center"><a class="btn primary" href="#overview">Back to the Overview</a><a class="btn" href="#pipeline">Applications</a></div></section>`);
    return;
  }
  const j0 = queue[0];
  pageKey = j0.id;
  const [{ job: j, warnings, revising, answers }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(j0.id)}`), settingsCache ? Promise.resolve(settingsCache) : api('/api/settings')]);
  const done = jobs.length - queue.length;
  const flags = j.red_flags || [];
  j.warnings = warnings || [];
  page(`<div class="head"><div class="grow"><div class="eyebrow">Review · ${queue.length} to go${done ? ` · ${done} skipped` : ''}</div>
      <h1>${esc(j.title)}</h1><div class="facts" style="margin-top:6px"><b>${esc(j.company)}</b>${j.location ? `<span>${esc(j.location)}</span>` : ''}${j.salary ? `<span>${esc(j.salary)}</span>` : ''}<span>${ageTag(j)}</span>${closedTag(j)}${deadlineTag(j)}</div></div>
      <a class="btn ghost" href="#overview">Exit review</a></div>
    ${revising ? '<section class="card"><p><span class="spin"></span> Making your changes… this updates by itself.</p></section>' : ''}
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
  page(`<div class="head"><div class="grow"><div class="eyebrow"><a href="#job/${encodeURIComponent(j.id)}">${esc(j.company)}</a> / Apply</div><h1>Apply: ${esc(j.title)}</h1>
      <p class="muted">${done ? 'You\'ve applied to this one.' : can_fill && j.url ? 'Job Hunt can fill in the form for you, or use the files and answers below yourself.' : 'Four steps. Your files and answers are ready below.'}</p></div></div>
    <ol class="apply-steps">
      ${can_fill && j.url && !done ? `<li class="card"><h2>Let Job Hunt fill it in</h2>
        <p class="muted">Opens the posting in a Job Hunt window. Use the company's Apply button (sign in or make an account if it asks); when the form appears, Job Hunt fills it in from your CV, letter and facts, and attaches your files. It never presses Submit: check the form, fix anything in amber, and submit it yourself. When the site confirms it, Job Hunt marks the application as applied by itself; or press <b>I submitted it</b> in that window (or <b>Mark applied</b> here) to do it yourself.</p>
        <div class="row"><button class="btn primary" data-act="fillForm" data-job="${esc(j.id)}">${svg('check')}Fill it in for me</button><button class="btn ghost" data-act="open" data-what="posting" data-job="${esc(j.id)}">${svg('open')}Open in my browser instead</button></div>
        <p class="muted small">The steps below are there if you'd rather do it yourself, or for anything it couldn't fill.</p></li>` : ''}
      <li class="card"><h2>Open the posting</h2><p class="muted">Use the company's Apply button. If it asks you to sign in or make an account, do that first.</p>
        ${j.url ? `<button class="btn ${can_fill ? '' : 'primary'}" data-act="open" data-what="posting" data-job="${esc(j.id)}">${svg('open')}Open the posting</button>` : '<p class="muted">No link saved for this posting.</p>'}</li>
      <li class="card"><h2>Attach your CV and cover letter</h2><p class="muted">Most sites take PDF; use Word only if they ask for it. <b>Show files</b> opens the folder so you can drag them in.</p>
        <div class="row">
          <button class="btn" data-act="open" data-what="cv-pdf" data-job="${esc(j.id)}">${svg('doc')}CV (PDF)</button>
          <button class="btn" data-act="open" data-what="letter-pdf" data-job="${esc(j.id)}">${svg('doc')}Cover letter (PDF)</button>
          <button class="btn ghost" data-act="open" data-what="cv" data-job="${esc(j.id)}">CV (Word)</button>
          <button class="btn ghost" data-act="open" data-what="letter" data-job="${esc(j.id)}">Letter (Word)</button>
          <button class="btn ghost" data-act="open" data-what="folder" data-job="${esc(j.id)}">${svg('folder')}Show files</button>
        </div>${cv_pdf && letter_pdf ? '' : '<p class="muted small">The PDF copies are made the first time you open them (needs Word or LibreOffice).</p>'}</li>
      <li class="card"><h2>Fill in the form</h2>
        ${facts.length ? `<div class="copy-list">${facts.map((f, i) => copyRow(i === 0 ? 'Name' : i === 1 ? 'Email' : 'From your facts for forms', f, `f${i}`)).join('')}</div>` : ''}
        ${(answers || []).length ? `<h3 class="sub" style="margin-top:12px">Answers to the usual questions</h3><div class="copy-list">${answers.map((a, i) => copyRow(a.question, a.answer, `a${i}`)).join('')}</div>`
          : `<p class="muted">For questions like “Why this company?” or salary expectations, <a href="#job/${encodeURIComponent(j.id)}" data-tab-to="apply">have Claude write answers</a> from your CV and this posting.</p>`}
        ${(p.application_facts || '').trim() ? '' : '<p class="muted small">Add the facts forms ask for (work authorization, notice period, salary expectations) in <a href="#cvs">CV & career</a> to have them here.</p>'}</li>
      <li class="card"><h2>Done?</h2><p class="muted">Job Hunt then waits for a reply, and reminds you to follow up if none comes${p.follow_up_after ? ` in ${p.follow_up_after} days` : ''}.${on_apply?.to && on_apply.mode !== 'off' && !done
        ? ` It also ${on_apply.mode === 'send' ? 'emails' : 'drafts an email to'} <b>${esc(on_apply.to.name || on_apply.to.email)}</b>${on_apply.to.known ? ', the recruiter you know there, asking them to put you forward' : ' (named in the posting) to say you\'ve applied'}. <a href="#recruiters">Change this</a>` : ''}</p>
        <div class="row">${done ? `<a class="btn" href="#job/${encodeURIComponent(j.id)}">Back to the job</a>` : `<button class="btn primary" data-act="applied" data-job="${esc(j.id)}">${svg('check')}I've submitted it</button><a class="btn ghost" href="${reviewReturn ? '#review' : `#job/${encodeURIComponent(j.id)}`}">Not now</a>`}</div></li>
    </ol>`);
}
let reviewReturn = false;

// ---- Calendar ----
let calMonth = null; // the month shown, as its first day
const CAL_KIND = { interview: ['Interview', 'interviewing'], prep: ['Prep', 'queued'], reminder: ['Reminder', 'approved'], deadline: ['Deadline', 'crit'], 'follow-up': ['Follow-up', 'info'], google: ['Google Calendar', ''] };
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeOf = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

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
    if (i.kind === 'deadline' && i.status === 'queued') acts = `<button class="btn sm" data-act="tailorPicked" data-job="${id}">Tailor</button>`;
    if (i.kind === 'deadline' && i.status === 'ready') acts = `<button class="btn primary sm" data-act="approve" data-job="${id}" data-email="${esc(i.apply_email || '')}">Approve</button>`;
    if (i.kind === 'google' && i.suggest) acts = `<span class="muted small">Interview for ${esc(i.suggest.company)}?</span><button class="btn sm" data-act="calLink" data-id="${esc(i.id)}" data-job="${esc(i.suggest.job_id)}" title="Show it with that application and move it to Interviewing">Link to application</button>`;
    if (i.local && i.kind === 'interview') acts += `<button class="btn ghost sm" data-act="calDelete" data-id="${esc(i.id)}" title="Remove this interview, its prep time and reminders">✕</button>`;
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
      <div class="row"><button class="btn primary" data-act="calAdd">${svg('add')}Add interview</button>
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
      <div class="row"><button class="btn ghost" data-act="calMonth" data-d="-1" title="Previous month">‹</button><button class="btn ghost" data-act="calMonth" data-d="0">Today</button><button class="btn ghost" data-act="calMonth" data-d="1" title="Next month">›</button></div></header>
      ${grid}
      <div class="row small muted" style="margin-top:8px;gap:14px">${Object.entries(CAL_KIND).map(([k, [n]]) => `<span><i class="cal-key ${k}"></i>${n}</span>`).join('')}</div></section>
    <section class="card"><header><h2>Next 30 days</h2></header>${soon.length ? group(soon) : `<p class="muted">Nothing coming up.${google ? '' : ' Interviews you add here, or that Job Hunt books from your email once Google is connected, show up here.'}</p>`}</section>
    ${recent.length ? `<details class="card"><summary><b>Last 2 weeks</b> <span class="muted small">${recent.length}</span></summary>${group(recent)}</details>` : ''}`);
}

let docFilter = 'all';
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
    <div class="head"><div class="grow"><h1>Documents</h1><p class="muted">Every tailored CV and cover letter, newest first. Click a role to read and edit them.</p></div>
      ${all.length ? '<input type="search" id="docFilter" class="filter" placeholder="Filter by company or title">' : ''}</div>
    ${all.length ? `<div class="chips">${Object.entries(groups).map(([k, [n, f]]) => `<button class="chip ${k === docFilter ? 'on' : ''}" data-act="docFilter" data-f="${k}">${n} <b>${all.filter(f).length}</b></button>`).join('')}</div>` : ''}
    ${docs.length ? `<section class="card"><div class="doclist">${docs.map(j => `
      <div class="docrow" data-text="${esc((j.company + ' ' + j.title).toLowerCase())}">
        <a class="grow" href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs"><b>${esc(j.title)}</b><span class="muted small">${esc(j.company)}${j.score != null ? ` · fit ${j.score}` : ''} · ${esc(fmtDate(j.updated_at))}</span></a>
        ${stagePill(j.status)}
        <div class="row">
          ${j.cv_path ? `<button class="btn" data-act="open" data-what="cv" data-job="${esc(j.id)}">${svg('doc')}CV</button>` : ''}
          ${j.letter_path ? `<button class="btn" data-act="open" data-what="letter" data-job="${esc(j.id)}">${svg('doc')}Cover letter</button>` : ''}
          ${j.cv_path ? `<button class="btn ghost" data-act="open" data-what="cv-pdf" data-job="${esc(j.id)}" title="PDF copy of the CV">CV PDF</button><button class="btn ghost" data-act="open" data-what="letter-pdf" data-job="${esc(j.id)}" title="PDF copy of the cover letter">Letter PDF</button>` : ''}
          <button class="btn ghost" data-act="open" data-what="folder" data-job="${esc(j.id)}" title="Show files">${svg('folder')}</button>
        </div>
      </div>`).join('')}</div></section>`
    : `<p class="empty">${all.length ? 'Nothing here.' : 'No tailored CVs or cover letters yet. They appear here after you tailor a role, or add a job yourself.'}</p>`}`);
  $('#docFilter')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.docrow').forEach(r => { r.hidden = q && !r.dataset.text.includes(q); });
  });
}

/** What an applicant tracking system would trip on in this CV. */
function atsHtml(list) {
  const problems = list.filter(x => x.level === 'problem');
  return `<details class="ats" ${problems.length ? 'open' : ''}><summary class="small"><b>Screening-software check:</b> ${list.length ? `${problems.length ? `<span style="color:var(--crit)">${problems.length} problem${problems.length === 1 ? '' : 's'}</span>` : 'reads cleanly'}${list.length - problems.length ? `, ${list.length - problems.length} tip${list.length - problems.length === 1 ? '' : 's'}` : ''}` : 'the software employers use to screen CVs reads it cleanly'}</summary>
    ${list.length ? `<ul class="flags">${list.map(x => `<li class="${x.level === 'problem' ? 'crit' : ''}">${esc(x.text)}</li>`).join('')}</ul>` : ''}</details>`;
}

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
      <div class="kpi"><span class="kpi-l">Your minimum</span><span class="kpi-v">${p.minimum ? k(p.minimum) : '–'}</span><span class="kpi-s">${p.minimum ? `${p.below_minimum} role${p.below_minimum === 1 ? '' : 's'} top out below it` : '<a href="#settings/search">Set one</a>'}</span></div></div>
    <div class="payline"><span class="payband" style="left:${at(p.low)}%;right:${100 - at(p.high)}%"></span>
      <span class="paymark" style="left:${at(p.median)}%" title="Typical ${k(p.median)}"></span>
      ${p.minimum ? `<span class="paymark min" style="left:${at(p.minimum)}%" title="Your minimum ${k(p.minimum)}"></span>` : ''}</div>
    <div class="row small muted" style="justify-content:space-between;margin-top:4px"><span>${k(lo)}</span><span><i class="key"></i> typical${p.minimum ? ' <i class="key min"></i> your minimum' : ''}</span><span>${k(hi)}</span></div>
    <h3 class="sub" style="margin-top:14px">Best paid</h3>
    <table><tbody>${p.roles.map(x => `<tr><td><a href="#job/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <span class="muted small">${esc(x.company)}</span></td><td class="num">${x.low === x.high ? k(x.high) : `${k(x.low)}–${k(x.high)}`}</td><td>${stagePill(x.status)}</td></tr>`).join('')}</tbody></table>
  </section>`;
}

// ---- Results ----
async function showResults() {
  const [r, st] = await Promise.all([api('/api/results'), settingsCache ? Promise.resolve(settingsCache) : api('/api/settings')]);
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
  page(`<div class="head"><div class="grow"><h1>Results</h1><p class="muted">Which CVs, sources and fit scores turn into replies and interviews. A reply is any answer from the company, a rejection included, but not an automatic “we received it”.</p></div></div>
    <section class="kpis">
      <div class="kpi"><span class="kpi-l">Applications sent</span><span class="kpi-v">${f.sent}</span><span class="kpi-s">of ${f.tailored} tailored</span></div>
      <div class="kpi"><span class="kpi-l">Reply rate</span><span class="kpi-v">${rate(f.replied, f.sent)}</span><span class="kpi-s">${f.replied} repl${f.replied === 1 ? 'y' : 'ies'}</span></div>
      <div class="kpi"><span class="kpi-l">Interview rate</span><span class="kpi-v">${rate(f.interviews, f.sent)}</span><span class="kpi-s">${f.interviews} interview${f.interviews === 1 ? '' : 's'}</span></div>
      <div class="kpi"><span class="kpi-l">Typical wait for a reply</span><span class="kpi-v">${r.days_to_reply == null ? '–' : `${r.days_to_reply} d`}</span><span class="kpi-s">Half of replies came sooner</span></div>
    </section>
    <section class="card"><header><h2>From posting to offer</h2></header>
      <div class="bars">${steps.map(([n, v], i) => `<div class="bar-row"><span>${esc(n)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(v ? 1 : 0, v / max * 100)}%"></span></span><span class="v">${v}${i && steps[i - 1][1] ? ` <span class="muted small">${Math.round(v / steps[i - 1][1] * 100)}%</span>` : ''}</span></div>`).join('')}</div>
      <p class="muted small">Each percentage is of the step above it.</p></section>
    ${f.sent >= 5 ? `    <div class="grid-2">
      ${table('By CV', r.by_cv, 'CV')}
      ${table('By source', r.by_source.map(x => ({ ...x, name: sourceName(x.name) })), 'Source')}
    </div>
    ${table('By fit score', r.by_fit, 'Fit score')}
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
          <header><h2>Applications by stage</h2><a class="btn ghost" href="#pipeline">All applications</a></header>
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
      ${r.thinking ? '<span class="muted small"><span class="spin"></span>Claude is looking…</span>' : `<button class="btn" data-act="insights">${r.insights ? 'Look again' : 'Ask Claude'}</button>`}</header>
      ${r.insights ? `<p class="muted small">From ${esc(fmtDate(r.insights.at))}. Job Hunt also does this once a month by itself.</p>${mdHtml(r.insights.text)}` : '<p class="muted">Claude reads your results and the applications behind them, and says what is working and what to change: titles, CVs, sources or your fit threshold.</p>'}
    </section>
    <section class="card row" style="justify-content:space-between"><span><b>Your career options</b><br><span class="muted small">${r.career ? `${(r.career.paths || []).length} directions with pay, pros and cons, and Claude's advice. Ask again now and then: it uses what's working above.` : 'Every direction your CVs support, with pay ranges, pros and cons, and Claude\'s advice.'}</span></span><a class="btn" href="#cvs">${svg('cvs')}Open CV &amp; career</a></section>
    ${f.sent && f.sent < 20 ? '<p class="muted small">With only a few applications in a group, its rates can swing a lot. They settle as you send more.</p>' : ''}`);
}

async function showInbox() {
  const [{ emails }, rec] = await Promise.all([api('/api/emails'), api('/api/recruiters').catch(() => null)]);
  page(`<div class="head"><div class="grow"><h1>Inbox</h1><p class="muted">Job email Job Hunt has read. Replies are saved as Gmail drafts for you to check and send, and messages are labelled under JobHunt/ in Gmail.</p></div>
    ${overview?.setup?.google ? `<button class="btn primary" data-act="run" data-task="inbox">${svg('mail')}Check email now</button>` : '<a class="btn primary" href="#settings/connections">Connect Gmail to check email</a>'}</div>
    ${rec ? `<section class="card row" style="justify-content:space-between"><span><b>Recruiters</b> <span class="muted small">${(rec.recruiters || []).filter(r => !r.hidden).length} saved, each with the applications they handled.</span></span><a class="btn" href="#recruiters">${svg('recruiters')}Open Recruiters</a></section>` : ''}
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
  page(`<div class="head"><div class="grow"><h1>Add a job you found</h1><p class="muted">For roles on LinkedIn, company sites or from referrals. Paste the posting and it gets scored and tailored like any other.</p></div></div>
    ${noCv ? '<section class="card"><p>Add your CV first: Job Hunt compares the posting with it and tailors it for the role.</p><div class="row"><a class="btn primary" href="#cvs">Add your CV</a></div></section>' : ''}
    <form class="card" data-form="add"><div class="form">
      <label class="field">Company<input type="text" name="company" required></label>
      <label class="field">Job title<input type="text" name="title" required></label>
      <label class="field">Posting link<input type="url" name="url" placeholder="https://"></label>
      <label class="field">Location<input type="text" name="location"></label>
      <label class="field wide">Full job description<textarea name="description" required style="min-height:300px"></textarea></label>
    </div><div class="row"><button class="btn primary" type="submit">Score and tailor</button></div></form>
    <p class="muted small desktop-only">Used the <a href="#settings/extras">Send to Job Hunt</a> button? Press Ctrl+V on this page to add that posting.</p>`);
}

// A posting from the Send to Job Hunt button, pasted on the Add a job page.
document.addEventListener('paste', async e => {
  if (location.hash !== '#add') return;
  const text = e.clipboardData?.getData('text') || '';
  if (!text.startsWith('JOBHUNT-CLIP:')) return;
  e.preventDefault();
  try {
    await api('/api/clip', { method: 'POST', raw: text });
    toast('Adding it now. You\'ll get a notification when it\'s scored and tailored.');
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
    <div class="chips">${picked.map(x => `<button type="button" class="chip on" data-act="placeDrop" data-place="${esc(x)}" title="Remove">${esc(x)} ✕</button>`).join('') || '<span class="muted small">None yet: anywhere in the country.</span>'}</div>
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

async function showSettings(tab) {
  const st = settingsCache = await api('/api/settings');
  const p = st.profile;
  const tabs = [['connections', 'Accounts'], ['sources', 'Job sources'], ['search', 'Preferences'], ['calendar', 'Schedule'], ['extras', 'Extras'], ['app', 'App']];
  let body = '';
  if (tab === 'connections') {
    body = `<section class="card attention" id="connStatus" hidden></section>
    <section class="card" id="claudeCard"><header><h2>Claude</h2><span id="ccPill">${st.claude.engine === 'api' ? (st.claude.key ? '<span class="pill good">API key saved</span>' : '<span class="pill warn">Needed</span>') : (st.claude.code_found ? '<span class="pill">Checking…</span>' : '<span class="pill warn">Not found</span>')}</span></header>
      <p class="muted">Claude is the AI that reads job postings, picks the ones that fit you, rewrites your CV and cover letter for each, and sorts your job email.</p>
      <form data-form="claude" class="stack" style="gap:14px">
        <label class="check"><input type="radio" name="engine" value="code" ${st.claude.engine !== 'api' ? 'checked' : ''}> <span><b>Your Claude subscription</b> <span class="muted">(recommended)</span><br><span class="muted small">Your Claude Pro or Max plan, through Claude Code, a free helper from Anthropic that Job Hunt can install for you. Nothing extra to pay; each search uses some of your plan's usage.</span></span></label>
        <div id="ccStatus" class="small muted" style="margin-left:26px" ${st.claude.engine === 'api' ? 'hidden' : ''}><span class="spin"></span> Checking…</div>
        <label class="check"><input type="radio" name="engine" value="api" ${st.claude.engine === 'api' ? 'checked' : ''}> <span><b>An API key instead</b><br><span class="muted small">For people without a Claude subscription: you pay Anthropic for what you use. Create a key at <a href="#" data-act="link" data-url="https://console.anthropic.com/settings/keys">console.anthropic.com</a>.</span></span></label>
        <label class="field" id="apiKeyField" style="margin-left:26px;max-width:420px" ${st.claude.engine === 'api' ? '' : 'hidden'}>API key<input type="password" name="claude_key" autocomplete="off" placeholder="${st.claude.key ? 'Saved. Paste a new one to replace it' : 'sk-ant-…'}"></label>
        <details ${st.claude.model || st.claude.path ? 'open' : ''}><summary class="small muted">Advanced</summary>
        <h3 class="sub">Tailoring CVs and cover letters</h3>
        <div class="form">
          <label class="field">Model<select name="tailor_model">${[['opus', 'Opus (best writing)'], ['sonnet', 'Sonnet (faster, uses less of your plan)'], ['', 'Same as for everything else']].map(([v, n]) => `<option value="${v}" ${st.claude.tailor_model === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">How hard Claude thinks<select name="tailor_effort">${[['low', 'Low (fastest)'], ['medium', 'Medium (recommended)'], ['high', 'High (slowest, a few minutes each)']].map(([v, n]) => `<option value="${v}" ${st.claude.tailor_effort === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <div class="form" style="margin-top:10px">
          <label class="field">Model for everything else<input type="text" name="model" value="${esc(st.claude.model)}" placeholder="Default"><span class="hint">Scoring, email sorting and the rest. Blank: Claude Code's own choice, or Opus for the API.</span></label>
          <label class="field">Claude Code location<input type="text" name="path" value="${esc(st.claude.path)}" placeholder="C:\\Users\\you\\.local\\bin\\claude.exe"><span class="hint">Only if Job Hunt can't find it.</span></label>
        </div></details>
        <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="checkClaude">Check again</button>${st.claude.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="claude">Remove API key</button>' : ''}</div>
      </form></section>
    <section class="card" id="googleCard"><header><h2>Gmail, Google Calendar and Drive</h2>${st.google.connected ? `<span class="pill good">Connected${st.google.email ? ` · ${esc(st.google.email)}` : ''}</span>` : '<span class="pill">Optional</span>'}</header>
      <p class="muted">Job Hunt sorts your job email, drafts replies, books interviews in your calendar and keeps a private copy of your data in your own Drive. Everything stays in your Google account.</p>
      ${st.google.connected ? `<div class="row">
          <button class="btn" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connecting ? '<span class="spin"></span>Waiting for Google…' : 'Reconnect Google'}</button>
          <button class="btn ghost" data-act="forget" data-what="google">Disconnect</button></div>`
      : st.google.client ? `<ol class="steps-list">
          <li>Press <b>Connect Google</b>. Your browser opens: sign in with your Gmail account.</li>
          <li>Google says it <b>hasn't verified</b> Job Hunt (it's a small app, not one Google has reviewed). Click <b>Advanced</b>, then <b>Go to Job Hunt</b>.</li>
          <li><b>Tick every box</b> and press <b>Continue</b>. Then come back here: Job Hunt finishes by itself.</li></ol>
        <div class="row"><button class="btn primary" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connecting ? '<span class="spin"></span>Waiting for Google… finish in your browser' : 'Connect Google'}</button></div>
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
    <section class="card" id="usageCard"><p class="muted small"><span class="spin"></span> Loading…</p></section>
    <p class="muted small">Looking for LinkedIn, Google for Jobs or recruiters? They're in <a href="#settings/sources">Job sources</a>.</p>`;
  } else if (tab === 'sources') {
    const tile = (id, name, tag, about, more = '', open = false) => `<article class="tile" data-tile="${id}" id="tile-${id}">
      <header><b>${name}</b>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="tile-state"></span></header>
      <p class="small muted">${about}</p><p class="small tile-detail"></p>
      <div class="row tile-acts"></div>${more ? `<details ${open ? 'open' : ''}>${more}</details>` : ''}</article>`;
    const keyNote = (site, url) => `<p class="small">Get a key at <a href="#" data-act="link" data-url="${url}">${site}</a>, paste it here and press Save.</p>`;
    body = `<section class="card"><header><h2>Where Job Hunt looks</h2><button class="btn" data-act="testSources">Check them all</button></header>
      <p class="muted">Turn on the places you'd like searched. The free ones need nothing else; a few need a free key from their own website, pasted in once. Every search looks for the job titles from your CVs, in your locations.</p>
      <div id="sourceTest"></div></section>
    <div class="tiles">
      ${tile('boards', 'Company job boards', 'Free', 'Job Hunt finds employers near you and searches their own careers pages. Nothing to set up.',
        `<summary class="small">Choose companies yourself</summary><form data-form="profile" data-part="boards" class="stack" style="gap:10px;margin-top:8px">
          <label class="check"><input type="checkbox" name="auto_boards" ${p.sources.auto_boards !== false ? 'checked' : ''}> <span>Find employers near me by itself<br><span class="muted small">Every week, and when a search finds little that's new.</span></span></label>
          <div class="row"><button class="btn sm" type="button" data-act="suggestBoards">Suggest companies</button></div><div id="boardIdeas" class="ideas"></div>
          <p class="muted small">Or add a company yourself: the name at the end of its careers link, like boards.greenhouse.io/<b>name</b> or jobs.lever.co/<b>name</b>. For Workday, paste the whole link.</p>
        <div class="form">
          <label class="field">Greenhouse<textarea name="greenhouse">${esc(lines(p.sources.greenhouse))}</textarea></label>
          <label class="field">Lever<textarea name="lever">${esc(lines(p.sources.lever))}</textarea></label>
          <label class="field">Ashby<textarea name="ashby">${esc(lines(p.sources.ashby))}</textarea></label>
          <label class="field">Workday<textarea name="workday" placeholder="https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1">${esc(lines(p.sources.workday))}</textarea><span class="hint">Careers links, one per line. Searched for your job titles.</span></label>
          <label class="field">SmartRecruiters<textarea name="smartrecruiters">${esc(lines(p.sources.smartrecruiters))}</textarea></label>
          <label class="field">Workable<textarea name="workable">${esc(lines(p.sources.workable))}</textarea></label>
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
      ${tile('alerts', 'Job-alert emails', 'Free', 'Set up job alerts on LinkedIn, Indeed, Bayt or your country\'s job sites, sent to your Gmail, and Job Hunt reads them on every email check. Needs Gmail connected.')}
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
    </div>`;
  } else if (tab === 'cvs') {
    const kindName = { docx: 'Word', pdf: 'Converted from PDF', text: 'Converted from text', 'docx-converted': 'Converted to Job Hunt layout' };
    body = `<section class="card"><header><h2>Your CVs</h2><button class="btn ghost" data-act="folder" data-which="cv">${svg('folder')}Open folder</button></header>
      <p class="muted">Add as many CVs as you like, one for each kind of role. Every posting is scored against all of them and tailored from the best match. Word files are edited in place, so your formatting stays. PDF and text CVs are converted, word for word, into a clean Word copy first. Only your headline, summary, skills and bullet points are ever reworded, and an edit that adds a figure your CV doesn't state is refused.</p>
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
    ${st.cvs.length ? careerHtml(st.career, st.career_thinking, st.profile.tracks || []) : '<p class="empty">No CVs yet. Add one above to start.</p>'}
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
      <label class="field">Facts for application forms<textarea name="application_facts" placeholder="e.g. Citizen, no visa sponsorship needed.\nNotice period: one month.\nSalary expectation: (your range and currency).\nOpen to hybrid; not relocating.">${esc(st.profile.application_facts || '')}</textarea><span class="hint">Used to answer application questions. Anything not here is left as “[Fill in]”.</span></label>
      <div class="row"><button class="btn primary" type="submit">Save</button></div></section></form>`;
  } else if (tab === 'search') {
    body = `<form data-form="profile" data-part="search">
      <section class="card"><header><h2>About you</h2></header><div class="form">
        <label class="field">Your name<input type="text" name="name" value="${esc(p.name)}"></label>
        <label class="field">Your email<input type="email" name="email" value="${esc(p.email)}"></label>
        <label class="field">Time zone${tzSelect('timezone', p.timezone)}</label>
      </div></section>
      <section class="card"><header><h2>Where</h2></header><div class="form">
        <div class="field">Cities or areas${placePicker('locations', p.locations, p.sources.adzuna_country)}<span class="hint">Job Hunt also looks about 50 km around each. None: anywhere in the country.</span></div>
        <div class="stack" style="gap:14px">
          <label class="field">Country${countrySelect('adzuna_country', p.sources.adzuna_country, st.countries)}<span class="hint">Where searches look, and which job sites are offered.</span></label>
          <label class="check"><input type="checkbox" name="include_metro" ${p.include_metro !== false ? 'checked' : ''}> <span>Include the area around each city<br><span class="muted small">Toronto, Oakville or any GTA city brings in the whole GTA (Mississauga, Markham, Vaughan…), Vancouver or Burnaby Metro Vancouver, Montreal Laval and Longueuil, London Greater London, New York the NYC area, Dubai Sharjah and Ajman.</span></span></label>
          <label class="check"><input type="checkbox" name="remote_ok" ${p.remote_ok ? 'checked' : ''}> <span>Include remote roles open across the country<br><span class="muted small">Remote roles based in one of your locations are always included.</span></span></label>
        </div>
      </div></section>
      <section class="card"><header><h2>Which roles</h2></header><div class="form">
        <label class="field">Skip these companies<textarea name="exclude_companies">${esc(lines(p.exclude_companies))}</textarea></label>
        <label class="field">Skip titles containing<textarea name="exclude_title_keywords">${esc(lines(p.exclude_title_keywords))}</textarea></label>
        <label class="field">Minimum yearly salary<input type="number" name="min_salary" min="0" step="1000" value="${p.min_salary ?? ''}" placeholder="No minimum, e.g. 120000"><span class="hint">Digits only. Jobs whose stated maximum is lower are skipped; jobs with no salary are kept.</span></label>
      </div>
        <label class="field" style="margin-top:14px">What matters to you<textarea name="guidance" placeholder="e.g. Prefer hybrid roles in fintech or government. Avoid pure sales roles. Open to contract roles.">${esc(p.guidance || '')}</textarea><span class="hint">Claude weighs this when scoring. Job titles and keywords for each CV are set in CV & career.</span></label>
      </section>
      <section class="card"><header><h2>Tailoring</h2></header>
        <label class="check"><input type="checkbox" name="auto_tailor" ${p.auto_tailor ? 'checked' : ''}> <span>Tailor automatically<br><span class="muted small">Off (recommended): after each search you tick which roles to tailor your CV for, on the Overview. On: every role that fits well enough is tailored right away.</span></span></label>
        <details style="margin-top:10px"><summary class="small muted">Advanced</summary><div class="form" style="margin-top:8px">
        <label class="field">Fit score needed to tailor<input type="number" min="0" max="100" name="score_threshold" value="${p.score_threshold}"><span class="hint">0–100. Roles below it are skipped.</span></label>
        <label class="field">Most new postings scored per search<input type="number" min="5" max="200" name="max_scored_per_run" value="${p.max_scored_per_run}"><span class="hint">Spares your Claude usage; the rest are scored next time.</span></label>
        <label class="field">Most applications tailored per search<input type="number" min="1" max="50" name="max_per_run" value="${p.max_per_run}"><span class="hint">Only when tailoring automatically.</span></label>
      </div><div class="form" style="margin-top:14px">
        <label class="field">Remove postings I never acted on<select name="purge_after_days">${[[0, 'Never'], [30, 'After 30 days'], [60, 'After 60 days'], [90, 'After 90 days']].map(([v, n]) => `<option value="${v}" ${(p.purge_after_days || 0) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Skipped, not-interested and closed ones only; anything tailored, saved or applied to stays. Removed postings aren't brought back as new.</span></label>
        <div class="field">Score skipped postings again<div><button class="btn" type="button" data-act="rescore" data-group="skipped">Score them again</button></div><span class="hint">After you change your CVs, titles, fit score or locations.</span></div>
      </div></details></section>
      </form>`;
  } else if (tab === 'extras') {
    const cd = st.claude_desktop, ph = st.phone, desk = st.kind !== 'server' && !st.remote.here;
    const tile = (name, tag, state, about, acts, more = '') => `<article class="tile ${state === 'On' || state === 'Added' ? '' : 'off'}">
      <header><b>${name}</b>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="tile-state">${state ? `<span class="pill ${state === 'On' || state === 'Added' ? 'good' : ''}">${state}</span>` : ''}</span></header>
      <p class="small muted">${about}</p><div class="row tile-acts">${acts}</div>${more ? `<details>${more}</details>` : ''}</article>`;
    body = `<section class="card"><header><h2>Extras</h2></header><p class="muted">Optional things that make Job Hunt handier. None of them is needed.</p></section>
    <div class="tiles">
      ${tile('Notifications on your phone', 'Free', ph.topic ? 'On' : 'Off', 'Interviews, offers and applications ready, on your phone even when you\'re away from this computer. Uses the free ntfy app; no account needed.',
        ph.topic ? '<button class="btn sm" data-act="phoneTest">Send a test</button><button class="btn ghost sm" data-act="phone" data-on="0">Turn off</button>' : '<button class="btn primary sm" data-act="phone" data-on="1">Turn on</button>',
        ph.topic ? `<summary class="small">Set up your phone</summary><ol class="small steps-list">
          <li>Install <b>ntfy</b> on your phone: <a href="#" data-act="link" data-url="https://play.google.com/store/apps/details?id=io.heckel.ntfy">Android</a> or <a href="#" data-act="link" data-url="https://apps.apple.com/app/ntfy/id1625396347">iPhone</a>.</li>
          <li>In ntfy, tap <b>+</b> and subscribe to <b class="mono">${esc(ph.topic)}</b>${ph.server && ph.server !== 'https://ntfy.sh' ? ` on ${esc(ph.server)}` : ''}.</li>
          <li>Press <b>Send a test</b> above.</li></ol>
          <label class="check"><input type="checkbox" data-act="phoneUrgent" ${ph.urgent_only ? 'checked' : ''}> <span class="small">Only what can't wait: interviews, offers, replies from employers and postings about to close.</span></label>
          <label class="check"><input type="checkbox" data-act="phoneDetails" ${ph.details ? 'checked' : ''}> <span class="small">Show the company and role in notices<br><span class="muted">Off (private): notices only say what kind they are, like “An interview update”. They travel through ntfy.sh, a public relay, so anyone who learned your topic name could read them.</span></span></label>
          <p class="muted small">Keep the topic name to yourself.</p>
          <form data-form="phone" class="form"><label class="field">Your own ntfy server (optional)<input type="url" name="server" value="${esc(ph.server)}" placeholder="https://ntfy.sh"></label><div class="row"><button class="btn sm" type="submit">Save</button></div></form>` : '')}
      ${desk ? tile('Send to Job Hunt from your browser', 'PC', st.clip_watch ? 'On' : 'Off', 'A button for your bookmarks bar: on any job posting (LinkedIn, Indeed, a company site), click it and Job Hunt adds the posting and tailors your CV for it.',
        `<a class="btn primary sm" href="${esc(bookmarklet())}" draggable="true" onclick="return false" title="Drag me to your bookmarks bar">Send to Job Hunt</a><button class="btn sm" data-act="copyBookmarklet">Copy the button's code</button>`,
        `<summary class="small">How to add it</summary><ol class="small steps-list">
          <li>Drag the blue <b>Send to Job Hunt</b> button onto your browser's bookmarks bar (show the bar with Ctrl+Shift+B). If dragging doesn't work: right-click the bookmarks bar → Add page, name it <b>Send to Job Hunt</b>, and paste the copied code as its address.</li>
          <li>Open a job posting and click it. On LinkedIn, open the job itself first.</li>
          <li>Job Hunt picks it up within a few seconds and tells you when it's ready.</li></ol>
          <label class="check"><input type="checkbox" data-act="clipWatch" ${st.clip_watch ? 'checked' : ''}> <span class="small">Pick up postings sent from the browser</span></label>`) : ''}
      ${tile('Ask Claude about your search', 'Claude app', cd.added ? 'Added' : '', 'Adds Job Hunt to the Claude desktop app, so you can ask in plain words: “What\'s waiting for my approval?”, “Make the Maple Bank letter shorter”, “Search now”.',
        cd.available ? `<button class="btn ${cd.added ? '' : 'primary'} sm" data-act="addClaudeDesktop">${cd.added ? 'Add again' : 'Add to Claude'}</button>` : '<span class="muted small">Set this up from the Job Hunt app on your PC.</span>',
        cd.available ? `<summary class="small">After adding</summary><p class="small">Quit the Claude app fully (right-click its icon by the clock → Quit) and open it again. Job Hunt appears among its tools.</p>${cd.config ? `<p class="muted small">Claude's settings file: ${esc(cd.config)}</p>` : ''}` : '')}
      ${tile('Spreadsheet of your applications', '', '', `Company, title, stage, fit, salary, dates, links and notes.${st.sync.on ? ' With sync on, it\'s kept up to date in your Google Drive too, as <b>Job Hunt applications.csv</b>.' : ''}`,
        '<a class="btn sm" href="/api/export.csv" download="Job Hunt applications.csv">Download</a>')}
    </div>`;
  } else if (tab === 'calendar') {
    const c = p.calendar;
    body = `<form data-form="profile" data-part="calendar">
      <section class="card"><header><h2>Interview booking</h2></header><div class="form">
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
      <section class="card"><header><h2>Schedule</h2></header><div class="form">
        <label class="field">Daily job search at${hourSelect('search_hour', p.search_hour)}<span class="hint">If Job Hunt isn't running then, it searches when it next opens.</span></label>
        <label class="field">Check email every (minutes)<input type="number" min="10" max="240" name="inbox_minutes" value="${p.inbox_minutes}"></label>
        <label class="field">Weekly goal (applications)<input type="number" min="0" max="100" name="weekly_goal" value="${p.weekly_goal ?? 10}"><span class="hint">Shown on the Overview, and in your weekly review. 0 for none.</span></label>
        <label class="field">Follow up on applications after (days)<input type="number" min="0" max="45" name="follow_up_after" value="${p.follow_up_after ?? 8}"><span class="hint">With no reply by then, Job Hunt drafts a short follow-up in Gmail. 0 for never.</span></label>
      </div></section>
      <div class="row"><button class="btn primary" type="submit">Save</button></div></form>
      <section class="card"><header><h2>Weekly review</h2><button class="btn" data-act="weeklyNow">Send it now</button></header>
        <p class="muted">Once a week: what you sent against your goal, who replied, what's going quiet, what to do next, and the best new roles of the week to pick.</p>
        <div class="form">
          <label class="field">When<select data-act="weeklyDay"><option value="sun" ${st.weekly.day === 'sun' ? 'selected' : ''}>Sunday at 6 PM, to plan the week ahead</option><option value="mon" ${st.weekly.day === 'mon' ? 'selected' : ''}>Monday, at the daily search hour</option></select></label>
        </div>
        <label class="check"><input type="checkbox" data-act="weeklyEmail" ${st.weekly.email ? 'checked' : ''}> <span>Email me the whole review${st.weekly.to ? ` at ${esc(st.weekly.to)}` : ''} (needs Gmail connected). Otherwise it's a short notice.</span></label>
      </section>`;
  } else {
    const server = st.kind === 'server', here = st.remote.here;
    const b = st.backup, r = st.remote;
    const kb = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const y = st.sync;
    const viaDrive = server || y.where === 'drive' || (!y.on && !y.folder); // new to syncing: Drive is the simpler way
    const sync = `<section class="card"><header><h2>Sync between computers</h2>${y.on ? '<span class="pill good">On</span>' : ''}</header>
      <p class="muted">Pick up where you left off on any computer${server ? ', or move between this NAS and a PC' : ''}. Job Hunt keeps an up-to-date copy of everything in your Google Drive; on another computer, install Job Hunt and connect the same Google account, and it finds your data and offers to continue from it. Use one at a time.</p>
      ${y.error && y.on ? `<p class="pill crit" style="white-space:normal">Last sync didn't work: ${esc(y.error)}</p>` : ''}
      <form data-form="sync" class="form">
        <fieldset class="field" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend class="small">Where</legend>
          <label class="check"><input type="radio" name="where" value="drive" ${viaDrive ? 'checked' : ''}> <span>Straight to Google Drive<br><span class="muted small">Through your Google connection: no Google Drive app needed. Job Hunt uses a "Job Hunt" folder in My Drive and can't see your other files.${y.drive_ready ? '' : ' <b>Connect Google in Settings → Accounts first.</b>'} Connected before this option existed? Reconnect Google once to allow Drive.</span></span></label>
          ${server ? '' : `<label class="check"><input type="radio" name="where" value="folder" ${viaDrive ? '' : 'checked'}> <span>Through a folder on this computer<br><span class="muted small">One that Google Drive for desktop, OneDrive or Dropbox keeps in the cloud.</span></span></label>`}
        </fieldset>
        ${server ? '' : `<div class="sync-folder" style="grid-column:1/-1" ${viaDrive ? 'hidden' : ''}><label class="field">Folder<span class="row" style="flex-wrap:nowrap;gap:6px"><input type="text" name="dir" value="${esc(y.folder || '')}" placeholder="${esc(y.suggest || 'G:\\My Drive\\Job Hunt')}" style="flex:1">${here ? '' : '<button class="btn" type="button" data-act="pickFolder" data-into="dir">Browse…</button>'}</span>
          <span class="hint">${y.suggest ? `<a href="#" data-act="useDrive" data-path="${esc(y.suggest)}">Use ${esc(y.suggest)}</a>` : 'Install <a href="#" data-act="link" data-url="https://www.google.com/drive/download/">Google Drive for desktop</a>, then use a folder in My Drive, like G:\\My Drive\\Job Hunt.'}</span></label></div>`}
        <label class="check"><input type="checkbox" name="on" ${y.on ? 'checked' : ''}> Keep it up to date (a few minutes after a change, and when Job Hunt exits)</label>
        <label class="check"><input type="checkbox" name="secrets" ${y.secrets ? 'checked' : ''}> <span>Include saved keys and sign-ins<br><span class="muted small">So another computer needs no setting up. They stay in your own Google Drive.</span></span></label>
        <div class="row"><button class="btn primary" type="submit">Save</button>${y.on ? '<button class="btn" type="button" data-act="syncNow">Sync now</button>' : ''}</div>
      </form>
      <p class="muted small">${y.last ? `Last synced ${esc(ago(y.last))} from ${esc(y.device)}.` : 'Not synced yet.'}</p></section>`;
    const backups = `<section class="card"><header><h2>Backups</h2><button class="btn primary" data-act="backupNow">Back up now</button></header>
      <p class="muted">Every day Job Hunt saves one zip file with everything: your applications, CVs, cover letters, settings and signature. The last ${14} are kept.
        ${server ? 'They go to the <b>/backups</b> folder you mapped to a NAS share, so Hyper Backup or Cloud Sync can copy them off the NAS.' : 'Choose your OneDrive or Google Drive folder and every backup is copied to the cloud too.'}</p>
      <form data-form="backup" class="form">
        ${server ? '' : '<p class="muted small" style="grid-column:1/-1">Daily backups go to the sync folder above (or the data folder until you choose one).</p>'}
        <label class="check"><input type="checkbox" name="secrets" ${b.secrets ? 'checked' : ''}> <span>Include saved keys and sign-ins (Claude API key, Google, Adzuna)<br><span class="muted small">So a restore on a new computer or the NAS needs no signing in again. Keep the backup folder private if you tick this.</span></span></label>
        <div class="row"><button class="btn" type="submit">Save</button></div>
      </form>
      <p class="muted small">${b.last ? `Last backup ${esc(ago(b.last))}` : 'No backup yet.'} · Saved in ${esc(b.folder)}</p>
      ${b.files.length ? `<table><tbody>${b.files.slice(0, 5).map(f => `<tr><td class="small">${esc(f.name.replace('JobHunt backup ', '').replace('.zip', ''))}</td><td class="small muted">${kb(f.size)}</td><td style="text-align:right"><a class="btn ghost" href="/api/backup/download/${encodeURIComponent(f.name)}" download>Download</a></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="row" style="margin-top:10px"><label class="btn">Restore from a backup…<input type="file" accept=".zip" data-upload="restore" hidden></label>
        <span class="muted small">Replaces everything here with the backup and restarts Job Hunt. What's here now is kept in a "before-restore" folder.</span></div>
    </section>`;
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
    body = `<section class="card"><header><h2>Updates</h2><span class="muted small">Version ${esc(shortVersion(st.app.version))}</span></header>
      <p class="muted small" id="updateStatus">${server ? 'The server version updates with its container image: when a new version is out, update the image in Container Manager.' : 'Job Hunt checks for updates every 30 minutes and lets you know when one is ready.'}</p>
      <div class="row"><button class="btn" data-act="updateCheck">Check for updates</button><button class="btn primary" data-act="updateInstall" id="updateInstallBtn" hidden>Install and restart</button></div></section>
      ${sync}
      ${backups}
      ${remote}
      <section class="card" id="whatsnew"><header><h2>What's new</h2></header><p class="muted small">Loading…</p></section>
      ${server || here ? `<section class="card"><header><h2>App</h2></header><p class="muted small">Your data: ${esc(st.app.data)}</p></section>` : `<section class="card"><header><h2>App</h2></header>
      <label class="check"><input type="checkbox" data-act="autostart" ${st.app.autostart ? 'checked' : ''}> Start Job Hunt when I sign in to Windows (in the tray, so searches and email checks keep running)</label>
      <label class="check"><input type="checkbox" data-act="wakePc" ${st.app.wake ? 'checked' : ''}> <span>Wake this PC from sleep to run Job Hunt's tasks<br><span class="muted small">For the daily search, the weekly review and interview prep, while Job Hunt is in the tray. It can't wake a PC that's shut down. Not waking? Windows' wake timers may be off: Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep → Allow wake timers → Enable.${st.app.wake && st.app.next_wake ? `<br>Next wake: ${esc(new Date(st.app.next_wake).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}${st.app.last_wake ? ` · last ${esc(ago(st.app.last_wake))}` : ''}</span></span></label>
      <label class="check"><input type="checkbox" data-act="keepAwake" ${st.app.keep_awake ? 'checked' : ''}> <span>Keep this PC awake while Job Hunt is working<br><span class="muted small">While it searches, tailors, checks email or backs up, Windows won't go to sleep (the screen can still turn off). Once it's done, your usual sleep settings apply.</span></span></label>
      <label class="field" style="max-width:420px">When I close the window<select data-act="closeMode"><option value="tray" ${st.app.close === 'tray' ? 'selected' : ''}>Keep running in the tray</option><option value="exit" ${st.app.close === 'exit' ? 'selected' : ''}>Exit Job Hunt</option></select></label>
      <div class="row"><button class="btn" data-act="folder" data-which="data">${svg('folder')}Open data folder</button><button class="btn" data-act="folder" data-which="applications">${svg('folder')}Open tailored applications</button></div>
      <p class="muted small">Your data: ${esc(st.app.data)}</p></section>`}`;
  }
  if (tab === 'cvs') {
    page(`<div class="head"><div class="grow"><h1>CV &amp; career</h1><p class="muted">Where everything starts: your CVs, the job titles they search for, and where your career could go next.</p></div><span class="save-state" id="saveState" aria-live="polite">Changes save by themselves</span></div>
      ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${body}`);
    if (st.career_thinking) watchCareer(location.hash);
    return;
  }
  page(`<div class="head"><div class="grow"><h1>Settings</h1></div><span class="save-state" id="saveState" aria-live="polite">${['search', 'calendar', 'cvs', 'sources'].includes(tab) ? 'Changes save by themselves' : ''}</span></div>
    ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <nav class="tabs">${tabs.map(([id, n]) => `<a href="#settings/${id}" class="${id === tab ? 'on' : ''}">${n}</a>`).join('')}</nav>${body}`);
  if (tab === 'connections' && st.claude.engine !== 'api') checkClaude(false);
  if (tab === 'connections') { renderConnStatus(); renderUsage(); }
  if (connScrollTo) { const t = document.getElementById(connScrollTo); connScrollTo = null; if (t) { t.scrollIntoView({ block: 'start' }); t.querySelector('details')?.setAttribute('open', ''); } }
  if (tab === 'sources') { showSourceTest(); renderConnStatus(); }
  if (tab === 'app') { showWhatsNew(); if (update?.available) showUpdate(update); }
}

/** The Send to Job Hunt button: reads the posting on the page you're on and puts it on the clipboard. */
function clipPage() {
  var M = 'JOBHUNT-CLIP:', job = null;
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    try {
      var d = JSON.parse(s.textContent), list = [].concat(d['@graph'] || d);
      list.forEach(function (x) { if (!job && x && [].concat(x['@type']).indexOf('JobPosting') >= 0) job = x; });
    } catch (e) {}
  });
  var t = function (x) { return (x == null ? '' : String(x)).trim(); };
  var plain = function (h) { return new DOMParser().parseFromString(String(h || '').replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n'), 'text/html').body.textContent; };
  var sel = t(getSelection());
  var c = { v: 1, url: location.href, title: '', company: '', location: '', text: '', structured: !!job };
  if (job) {
    c.title = t(job.title);
    c.company = t(job.hiringOrganization && job.hiringOrganization.name);
    var place = [].concat(job.jobLocation || [])[0], a = (place && place.address) || {};
    c.location = [a.addressLocality, a.addressRegion, a.addressCountry && a.addressCountry.name || a.addressCountry].filter(function (x) { return typeof x === 'string'; }).join(', ');
    c.text = t(plain(job.description));
    if (sel.length > 200) c.text = sel;
  } else {
    var h = document.querySelector('h1');
    c.title = t(h && h.innerText) || document.title;
    c.text = sel || t((document.querySelector('main') || document.body).innerText);
  }
  c.text = c.text.slice(0, 30000);
  var out = M + JSON.stringify(c);
  var done = function () { alert('Sent to Job Hunt: ' + (c.title || document.title) + '\n\nJob Hunt picks it up in a few seconds.'); };
  var fallback = function () { var ta = document.createElement('textarea'); ta.value = out; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out).then(done, fallback); else fallback();
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

let update = null;
function showUpdate(u) {
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

function readProfile(form, part) {
  const p = JSON.parse(JSON.stringify(settingsCache.profile));
  const v = n => form.elements[n]?.value ?? '';
  if (part === 'stories') {
    p.stories = v('stories').trim();
    p.application_facts = v('application_facts').trim();
  } else if (part === 'search') {
    p.name = v('name').trim(); p.email = v('email').trim(); p.timezone = v('timezone').trim();
    p.locations = fromLines(v('locations')); p.remote_ok = form.elements.remote_ok.checked; p.include_metro = !!form.elements.include_metro?.checked;
    p.min_salary = v('min_salary') ? Number(v('min_salary')) : null;
    p.score_threshold = Number(v('score_threshold')); p.max_per_run = Number(v('max_per_run'));
    p.auto_tailor = !!form.elements.auto_tailor?.checked;
    p.purge_after_days = Number(v('purge_after_days') || 0);
    p.max_scored_per_run = Number(v('max_scored_per_run')); p.guidance = v('guidance').trim();
    p.exclude_companies = fromLines(v('exclude_companies')); p.exclude_title_keywords = fromLines(v('exclude_title_keywords'));

    Object.assign(p.sources, { adzuna_where: [], adzuna_country: v('adzuna_country') || 'ca' });
  } else if (part === 'boards') {
    p.sources.auto_boards = !!form.querySelector('[name=auto_boards]')?.checked;
    // Workday links can hold commas in rare cases, so they're split by line only.
    const byLine = x => x.split('\n').map(y => y.trim()).filter(Boolean);
    Object.assign(p.sources, { greenhouse: fromLines(v('greenhouse')), lever: fromLines(v('lever')), ashby: fromLines(v('ashby')),
      workday: byLine(v('workday')), smartrecruiters: fromLines(v('smartrecruiters')), workable: fromLines(v('workable')) });
  } else {
    Object.assign(p.calendar, {
      work_start: Number(v('work_start')), work_end: Number(v('work_end')), slot_minutes: Number(v('slot_minutes')),
      propose_slots: Number(v('propose_slots')), prep_minutes: Number(v('prep_minutes')), calendar_id: v('calendar_id').trim() || 'primary',
      followup_days: fromLines(v('followup_days')).map(Number).filter(n => n > 0),
    });
    p.search_hour = Number(v('search_hour')); p.inbox_minutes = Number(v('inbox_minutes'));
    p.follow_up_after = Number(v('follow_up_after') || 0);
    p.weekly_goal = Number(v('weekly_goal') || 0);
  }
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
  for (const k of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable']) {
    const el = f.elements[k];
    if (el && el !== document.activeElement) el.value = lines(settingsCache.profile.sources[k]);
  }
}

// Ticking roles to tailor
function pickChanged(box) {
  const n = box.querySelectorAll('[data-pick]:checked').length;
  const btn = box.querySelector('button[data-act=tailorPicked]');
  if (btn) { btn.disabled = !n; btn.textContent = n ? `Tailor ${n} selected` : 'Tailor selected'; }
  const all = box.querySelector('[data-act=pickAll]');
  if (all) all.textContent = n && n === box.querySelectorAll('[data-pick]').length ? 'Clear' : 'Select all';
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
const CONN_PILL = { ok: ['good', 'Working'], problem: ['crit', 'Needs attention'], off: ['', 'Off'], setup: ['', 'Not set up'], unknown: ['good', 'On'], na: ['', 'Not in your country'] };
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
  page(`<div class="head"><div class="grow"><h1>Recruiters</h1><p class="muted">Everyone who emailed you about a role, saved with the applications they handled. When you got to an interview there was nearly always a recruiter: they know you, so ask them to put you forward for new roles at their company.</p></div>
      <div class="row">${rec.gmail ? `<button class="btn" data-act="recruiterScan" ${rec.scanning ? 'disabled' : ''}>${rec.scanning ? '<span class="spin"></span>Looking…' : 'Find them in my email'}</button>` : ''}
        <button class="btn" data-act="recruiterNew">Add a recruiter</button><a class="btn ghost" href="/api/recruiters.csv" download>Download spreadsheet</a></div></div>
    <section class="card"><header><h2>When you apply</h2></header>
      <p class="muted small">When you mark an application as submitted (or Job Hunt sees the confirmation email), it writes to the recruiter on it, or one you know at that company, or the person named in the posting: that you've applied, and, if they know you, could they put you forward. Never more than once a week to the same person, and never to the address the application went to.</p>
      <div class="row" style="gap:16px;flex-wrap:wrap">${[['draft', 'Draft it in Gmail for me to send'], ['send', 'Send it for me'], ['off', 'Off']].map(([v, n]) => `<label class="check"><input type="radio" name="applyMode" data-act="applyMode" value="${v}" ${(rec.on_apply?.mode || 'draft') === v ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" data-act="applyCv" ${rec.on_apply?.attach_cv ? 'checked' : ''}> <span>Attach my tailored CV to emails Job Hunt sends</span></label>
      ${rec.gmail ? '' : '<p class="muted small">Needs Gmail connected (Settings → Accounts); until then the email is written on the application\'s People list for you to copy.</p>'}</section>
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
  const line = id => status[id] && status[id].state !== 'unknown' ? `<br><span class="small ${status[id].state === 'problem' ? '' : 'muted'}">${esc(status[id].detail)}${status[id].at ? ` · ${esc(ago(status[id].at))}` : ''}</span>` : '';
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

const CONN_ACT = {
  test: () => ['Test', 'connTest'], checkClaude: () => ['Check again', 'checkClaude'], google: () => ['Connect', 'google'],
  on: () => ['Turn on', 'connIndeed', 'data-on="1"'], off: () => ['Turn off', 'connIndeed', 'data-on="0"'],
  removeBroken: r => ['Remove broken boards', 'removeBroken', `data-boards="${esc(JSON.stringify(r.data || []))}"`],
  phoneTest: () => ['Send a test', 'phoneTest'], syncNow: () => ['Sync now', 'syncNow'], backupNow: () => ['Back up now', 'backupNow'],
};
let connPoll;
const USAGE_KIND = { score: 'Scoring postings', tailor: 'Tailoring CVs and letters', email: 'Reading job email', indeed: 'Searching Indeed', titles: 'Checking near-miss titles', alerts: 'Job-alert emails', employers: 'Finding employers', prep: 'Interview prep', revise: 'Your changes to documents', answers: 'Application questions', offer: 'Offers', outreach: 'Messages to contacts', insights: "What's working", thanks: 'Thank-you notes', career: 'Career paths', postings: 'Reading postings', followup: 'Follow-ups', cv: 'Reading your CVs', fill: 'Filling in forms', recruiters: 'Finding your recruiters' };
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
    return `<a class="btn ghost sm" href="#settings/${esc(to)}">Open</a>`;
  }
  if (a.startsWith('link:')) return `<button class="btn sm" data-act="link" data-url="${esc(a.slice(5))}">Open Claude connectors</button>`;
  const [label, act, extra] = (CONN_ACT[a] || (() => [a, a]))(r);
  const cls = a === 'on' ? 'primary' : a === 'off' ? 'ghost' : r.status === 'problem' || a === 'test' ? '' : 'ghost';
  return `<button class="btn ${cls} sm" data-act="${act}" data-id="${esc(r.id)}" ${extra || ''} ${testing && act === 'connTest' ? 'disabled' : ''}>${label}</button>`;
}

/** Fill in each source's tile, and on Accounts, what needs attention (nothing shows when all is well). */
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
    t.classList.toggle('problem', r.status === 'problem');
    t.querySelector('.tile-detail').innerHTML = ['off', 'setup'].includes(r.status) ? ''
      : `${esc(r.detail)}${r.at ? ` <span class="muted">· ${esc(ago(r.at))}</span>` : ''}`;
    t.querySelector('.tile-acts').innerHTML = (r.actions || []).filter(a => !a.startsWith('goto:')).map(a => connBtn(r, a, d.testing)).join('');
  });
  const box = $('#connStatus');
  if (box) {
    const probs = d.rows.filter(r => r.status === 'problem');
    box.hidden = !probs.length;
    box.innerHTML = `<header><h2>Needs attention</h2></header>${probs.map(r => `<div class="conn-row problem">
      <span class="conn-name"><b>${esc(r.name)}</b></span><span class="grow small">${esc(r.detail)}</span>
      <span class="row todo-act">${(r.actions || []).map(a => connBtn(r, a, d.testing)).join('')}</span></div>`).join('')}`;
  }
  if (d.testing) connPoll = setTimeout(() => { if (location.hash.startsWith('#settings')) renderConnStatus(); }, 3000);
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

// ---- Keyboard ----
// / search the list · a approve · j / k next and previous job · Esc back · ? this help
let jobOrder = [];
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
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
  const onJob = location.hash.startsWith('#job/');
  const id = onJob ? decodeURIComponent(location.hash.slice(5)) : null;
  if (e.key === '/') {
    const f = $('#filter') || $('#docFilter');
    if (f) { e.preventDefault(); f.focus(); }
  } else if (e.key === '?') {
    toast('Keys: / search the list · a approve · j / k next or previous job · Esc back to the list');
  } else if (e.key === 'Escape' && onJob) {
    history.length > 1 ? history.back() : (location.hash = '#pipeline');
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
  if (a === 'updateCheck') {
    return busy(async () => {
      const u = await checkUpdate();
      if (!u.error && !u.available) toast("You're on the newest version.");
      showWhatsNew();
    });
  }
  if (a === 'updateInstall') {
    return busy(async () => {
      toast('Downloading the update… Job Hunt restarts by itself when it is installed.');
      const r = await api('/api/update/install', { method: 'POST' });
      if (!r.installed) { toast("You're already on the newest version."); checkUpdate(); }
    });
  }
  if (a === 'run') {
    return busy(async () => {
      const r = await api(`/api/run/${el.dataset.task}`, { method: 'POST' });
      toast(r.started ? (el.dataset.task.startsWith('search') ? (el.dataset.task === 'search-force' ? 'Searching and re-checking postings filtered out before…' : 'Searching for jobs. New matches appear as they are tailored.') : 'Checking your email…') : 'Already running.');
      await refreshOverview();
      if (location.hash === '' || location.hash === '#overview') route();
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
    return busy(async () => { await api('/api/run/search', { method: 'POST' }); await refreshOverview(); location.hash = '#overview'; }, 'Searching for jobs. Matches appear on the Overview.');
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
  if (a === 'connTest') {
    const sites = el.dataset.id === 'agencies' ? document.querySelectorAll('#tile-agencies [name=site]:checked, #tile-agencies .site-own').length : 0;
    return busy(async () => {
      await api('/api/connections/test', { method: 'POST', body: { id: el.dataset.id } }); renderConnStatus();
      // The sites' card shows each one's result once the test is through.
      if (sites) setTimeout(() => { if (location.hash.startsWith('#settings/sources')) { settingsCache = null; route(); } }, 5000 + sites * 4000);
    }, sites ? `Testing ${sites} site${sites === 1 ? '' : 's'}… results show here in about ${Math.ceil((5 + sites * 4) / 10) * 10} seconds.` : 'Testing…');
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
  if (a === 'moreMenu') { document.body.classList.toggle('more-open'); renderNav(); return; }
  if (a === 'connGoto') {
    const id = CONN_HOME[el.dataset.to] || el.dataset.to, target = document.getElementById(id);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.querySelector('details')?.setAttribute('open', ''); return; }
    connScrollTo = id; location.hash = id.startsWith('tile-') ? '#settings/sources' : '#settings/connections'; return;
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
      else { reviewReturn = location.hash === '#review'; location.hash = `#apply/${encodeURIComponent(id)}`; }
    });
  }
  if (a === 'applied') {
    const id = el.dataset.job;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'applied', note: 'submitted on the company site' } });
      await refreshOverview();
      toast('Marked applied. Job Hunt will remind you to follow up.');
      location.hash = reviewReturn ? '#review' : '#pipeline';
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
  if (a === 'trackFilter') { trackFilter = el.dataset.f; route(); return; }
  if (a === 'docFilter') { docFilter = el.dataset.f; route(); return; }
  if (a === 'pickTop') {
    const box = el.closest('[data-pickbox]');
    const all = [...box.querySelectorAll('[data-pick]')];
    // The best scores, whichever CV they're under.
    const score = c => Number(c.closest('.todo-row').querySelector('.score')?.textContent || 0);
    const top = new Set([...all].sort((a, b) => score(b) - score(a)).slice(0, Number(el.dataset.n)));
    all.forEach(c => { c.checked = top.has(c); });
    pickChanged(box);
    return;
  }
  if (a === 'pickAll') {
    const box = el.closest('[data-pickbox]');
    const all = [...box.querySelectorAll('[data-pick]')];
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
  if (a === 'approve') {
    if (el.dataset.email && !await ask(`Send your tailored CV and cover letter to ${el.dataset.email} from your Gmail?`)) return;
    return busy(async () => {
      const id = el.dataset.job || jobId;
      const r = await api(`/api/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      await refreshOverview();
      if (r.outcome === 'applied') { toast('Sent. Marked as applied.'); route(); }
      else location.hash = `#apply/${encodeURIComponent(id)}`;
    });
  }
  if (a === 'syncResume') {
    return busy(async () => { await api('/api/sync/resume', { method: 'POST' }); await refreshOverview(); route(); }, 'Switching back here… when the other computer\'s data arrives, Continue from it on the Overview.');
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
  if (a === 'outreach') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: Number(el.dataset.i) } }); setTimeout(route, 300); }, 'Writing the message…');
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
    return busy(async () => { const r = await api('/api/recruiters/scan', { method: 'POST' }); toast(r.started === false ? 'Already looking.' : 'Looking through your email for recruiters. A notice comes when it\'s done, in a few minutes.'); setTimeout(() => { if (location.hash === '#recruiters') route(); }, 4000); });
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
  if (a === 'copyBookmarklet') {
    try { await navigator.clipboard.writeText(bookmarklet()); toast('Copied. Paste it as the URL of a new bookmark.'); } catch (e) { toast('Couldn\'t copy. Drag the blue button to your bookmarks bar instead.', true); }
    return;
  }
  if (a === 'addClaudeDesktop') {
    return busy(async () => { await api('/api/settings/claude-desktop', { method: 'POST' }); route(); }, 'Added. Quit Claude Desktop fully and open it again.');
  }
  if (a === 'phone') return busy(async () => { await api('/api/settings/phone', { method: 'POST', body: { on: el.dataset.on === '1' } }); route(); }, el.dataset.on === '1' ? 'Turned on. Now subscribe on your phone.' : 'Turned off.');
  if (a === 'phoneTest') return busy(() => api('/api/settings/phone-test', { method: 'POST' }), 'Sent. It should be on your phone now.');
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
  if (a === 'followUp') {
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/followup`, { method: 'POST' });
      if (location.hash.startsWith('#job/')) setTimeout(route, 300);
      else el.outerHTML = '<span class="muted small"><span class="spin"></span>Writing…</span>';
    }, 'Writing the follow-up…');
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
      box.innerHTML = '<p class="muted small"><span class="spin"></span>Claude is picking employers near you, and Job Hunt is checking each one\'s job board. This takes a minute or two…</p>';
      try {
        const { boards } = await api('/api/settings/suggest-boards', { method: 'POST' });
        box.dataset.ideas = JSON.stringify(boards);
        box.innerHTML = boards.length ? `<div class="card ideas-card">
          <p><b>${boards.length} employers with live job boards.</b> The ones with matching jobs are ticked.</p>
          <table><tbody>${boards.map((b, i) => `<tr><td><label class="check"><input type="checkbox" data-idea="${i}" ${b.matching ? 'checked' : ''}> ${esc(b.company)}</label></td>
            <td class="small muted">${esc(b.board)}</td><td class="small">${b.matching} of ${b.jobs} jobs match</td></tr>`).join('')}</tbody></table>
          <div class="row"><button class="btn primary" type="button" data-act="addIdeas">Add ticked and search</button></div></div>`
          : '<p class="muted">None of the suggested employers had a live job board this time. Try again later, or add companies yourself in Settings → Job sources → Company job boards.</p>';
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
  if (a === 'scoreAnyway') {
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/score`, { method: 'POST' });
      el.outerHTML = '<span class="muted small"><span class="spin"></span>Scoring… if it clears your fit bar it\'s tailored and appears under Ready to approve.</span>';
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
        text: 'Job Hunt can learn from it and score roles like it lower, or you can keep it as a backup.',
        input: 'Why not? (optional)', placeholder: 'e.g. too junior, sales role, too far',
        buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save for later', value: 'saved' },
          { label: 'Not interested, don\'t learn', value: 'quiet' }, { label: 'Not interested', value: 'learn', kind: 'primary' }],
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
    if (!await ask('Remove this CV from Job Hunt? Applications already tailored from it are kept.')) return;
    return busy(async () => { await api(`/api/cvs/${encodeURIComponent(cvId)}/remove`, { method: 'POST' }); await refreshOverview(); route(); }, 'Removed.');
  }
  if (a === 'checkClaude') { const w = $('#welcomeClaude'); if (w) return welcomeClaude(true); return checkClaude(true); }
  if (a === 'claudeSetup') {
    await busy(el, async () => { await api('/api/claude/setup', { method: 'POST', body: { install: el.dataset.install === '1' } }); });
    toast('Follow the steps in the window that opened. Job Hunt checks by itself.');
    watchClaude();
    return;
  }
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
      toast(`${replace ? 'Replaced' : 'Added'} “${r.track.label}”.`);
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
    <p class="muted small">${t.running ? '<span class="spin"></span>Testing… Indeed goes through Claude Code and can take a minute.' : t.last?.finished ? `Tested ${esc(ago(t.last.finished))}.` : ''}</p>`;
  if (t.running) sourcePoll = setTimeout(() => { if (location.hash.startsWith('#settings/sources')) showSourceTest(); }, 2000);
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
  const compare = paths.some(c => (c.ladder || []).length) ? `<table class="career-compare"><thead><tr><th>Path</th><th class="num">Now</th><th class="num">In 5 years</th><th class="num">In 10 years</th><th class="num">Ceiling</th></tr></thead><tbody>
      ${paths.map(c => { const n = step(c, 'now'), f = step(c, '5'), t = step(c, '10'); return `<tr><td><a href="#path-${esc(c.title)}" data-act="careerJump" data-i="${paths.indexOf(c)}">${esc(c.title)}</a><br><span class="muted small">${esc(kindName[c.kind] || c.kind)}</span></td>
        <td class="num">${n ? range(n.pay_min, n.pay_max, c) : range(c.pay_min, c.pay_max, c)}</td><td class="num">${f ? range(f.pay_min, f.pay_max, c) : '–'}</td><td class="num">${t ? range(t.pay_min, t.pay_max, c) : '–'}</td>
        <td class="num"><b>${money(c.ceiling_pay, c)}</b><div class="ceilbar"><span style="width:${(c.ceiling_pay || 0) / top * 100}%"></span></div></td></tr>`; }).join('')}</tbody></table>` : '';
  const ladder = c => (c.ladder || []).length ? `<ol class="ladder">${c.ladder.map(x => `<li><span class="when">${esc(x.when)}</span><b>${esc(x.title)}</b><span class="muted small">${range(x.pay_min, x.pay_max, c)}</span></li>`).join('')}
      ${c.ceiling_title ? `<li class="ceiling"><span class="when">Ceiling</span><b>${esc(c.ceiling_title)}</b><span class="small">up to <b>${money(c.ceiling_pay, c)}</b></span></li>` : ''}</ol>` : '';
  const list = (label, xs, cls) => xs?.length ? `<div class="small ${cls}"><b>${label}</b><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const searchFor = (c, i) => (c.titles || []).length ? `<details class="small"><summary class="muted">Look for this role now</summary>
      <p style="margin:6px 0">Job titles for it: ${c.titles.map(esc).join(', ')}</p>
      ${tracks.length ? `<div class="row">${tracks.length > 1 ? `<label class="small">Add them to the search for your<select data-path-track="${i}" style="margin-left:6px">${tracks.map(t => `<option value="${esc(t.name)}">${esc(t.label)}</option>`).join('')}</select> CV</label>` : ''}<button class="btn sm" data-act="addTitles" data-i="${i}" data-titles="${esc(JSON.stringify(c.titles))}" ${c.titles.every(t => tracks.some(x => x.titles.some(y => y.toLowerCase() === t.toLowerCase()))) ? 'disabled title="Already in your search"' : ''}>${tracks.length > 1 ? 'Add' : 'Add them to my search'}</button></div>` : ''}</details>` : '';
  return `<section class="card" id="careerCard"><header><h2>Your career paths</h2>
    ${thinking ? '<span class="muted small"><span class="spin"></span>Claude is thinking… (a minute or two)</span>' : `<button class="btn" data-act="career">${career ? 'Think again' : 'Map my career paths'}</button>`}</header>
    ${career ? `${career.advice ? `<div class="advice"><b>Claude's advice</b><p>${esc(career.advice)}</p></div>` : ''}
      ${compare ? `<h3 class="sub">Where each path leads</h3>${compare}<p class="muted small">Typical yearly base pay where you search, with steady progress. The ceiling is the most the path usually pays, at its top role. Claude's estimates from ${esc(fmtDate(career.at))}: use them to compare paths, not as offers.</p>` : ''}
      <div class="paths">${paths.map((c, i) => `<div class="path" id="path-${i}">
        <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><span><b>${esc(c.title)}</b><br><span class="small muted">${esc(kindName[c.kind] || c.kind)} · fit ${c.fit}</span></span>${c.ceiling_pay ? `<span class="pill good" style="white-space:nowrap" title="The most this path usually pays">up to ${money(c.ceiling_pay, c)}</span>` : `<span class="pill good" style="white-space:nowrap">${esc(c.pay)}</span>`}</div>
        <p class="small">${esc(c.why)}</p>
        ${ladder(c)}
        <div class="proscons">${list('For', c.pros, 'pro')}${list('Against', c.cons, 'con')}</div>
        ${(c.gaps || []).length ? `<p class="small"><b>What it takes:</b> ${c.gaps.map(esc).join('; ')}</p>` : ''}
        ${c.first_step ? `<p class="small"><b>First step this month:</b> ${esc(c.first_step)}</p>` : ''}
        ${searchFor(c, i)}
      </div>`).join('')}</div>`
    : `<p class="muted">Claude reads your whole CV and maps every direction it supports: where each leads in 3, 5 and 10 years, the pay at each step and the most the path can pay, with pros and cons and its advice on which to choose.${thinking ? '' : ' It does this by itself when you add a CV.'}</p>`}
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
  if (force) box.innerHTML = '<span class="spin"></span> Checking…';
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
    if (!location.hash.startsWith('#settings')) return;
    const st = await api('/api/settings').catch(() => null);
    if (!st) return;
    await refreshOverview();
    route();
    if (st.google.connecting) pollSettings();
  }, 3000);
}

document.addEventListener('click', e => {
  const to = e.target.closest('a[data-tab-to]');
  if (to) jobTabs[decodeURIComponent(to.getAttribute('href').replace('#job/', ''))] = to.dataset.tabTo;
  const el = e.target.closest('[data-act]');
  if (el && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') { e.preventDefault(); act(el); return; }
  const row = e.target.closest('tr[data-href]');
  if (row) location.hash = row.dataset.href;
  const ex = e.target.closest('tr[data-expand]');
  if (ex) togglePosting(ex);
});

document.addEventListener('change', async e => {
  const el = e.target;
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
  if (el.dataset.act === 'clipWatch') {
    await api('/api/settings/clip-watch', { method: 'POST', body: { on: el.checked } }).catch(err => toast(err.message, true));
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
      await api('/api/add', { method: 'POST', body: { company: f.company.value, title: f.title.value, url: f.url.value, location: f.location.value, description: f.description.value } });
      toast('Added. It appears under Ready to approve in a minute or two.');
      location.hash = '#overview';
    } else if (kind === 'claude') {
      await api('/api/settings/claude', { method: 'POST', body: { engine: form.querySelector('[name=engine]:checked').value, claude_key: f.claude_key.value, model: f.model.value, tailor_model: f.tailor_model.value, tailor_effort: f.tailor_effort.value, path: f.path.value } });
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
      const r = await api('/api/sync/settings', { method: 'POST', body: { where, ...(f.dir ? { dir: f.dir.value } : {}), on: f.on.checked, secrets: f.secrets.checked } });
      toast(r.sync.newer ? `${r.sync.newer.device} has newer data there. Choose on the Overview whether to continue from it.` : r.sync.on ? `Synced. ${where === 'drive' ? 'The Job Hunt folder in your Google Drive' : 'This folder'} now has your latest data.` : 'Saved.');
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
    } else if (kind === 'backup') {
      await api('/api/settings/backup', { method: 'POST', body: { secrets: f.secrets.checked } });
      toast('Backup settings saved.'); route();
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
  if (before !== after && !editing && !pageDirty && !$('#calAddCard:not([hidden])') && (here === '' || ['#overview', '#results', '#calendar'].includes(here) || here.startsWith('#pipeline') || here.startsWith('#job/'))) route();
}, 8000);

refreshOverview().then(route);
// Look for an update shortly after opening, then every 30 minutes.
setTimeout(checkUpdate, 4000);
setInterval(checkUpdate, 30 * 60 * 1000);
