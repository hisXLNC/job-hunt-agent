// The frame around every page: navigation, the find box, the status pill,
// and the small helpers pages share. No build step; plain modules.

import { assistantButton, assistantFrame, mountAssistant, assistantRoute, refreshAssistant, openAssistant } from './assistant.js';
export { openAssistant };

// ---- safe HTML -----------------------------------------------------------------
// Everything interpolated into html`` is escaped unless it is itself the
// result of html``. Postings, mail and names are outside text: they only
// ever reach the page through this.
export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v).replace(/[&<>"']/g, c => ESC[c]);
function piece(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += piece(vals[i]) + strings[i + 1];
  return new Safe(out);
}
// Only http(s) links from outside are ever made clickable.
export const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');

// ---- talking to the program ------------------------------------------------------
export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (init.method !== 'GET') init.headers['X-JobHunt'] = '1';
  if (opts.raw !== undefined) init.body = opts.raw;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch('/api/' + path, init); } catch { throw new Error('Job Hunt is not running. Start it again from the Start menu.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status >= 500) note(`${init.method} ${path} answered ${r.status}: ${data.error || ''}`); throw new Error(data.error || 'Something went wrong.'); }
  return data;
}
// Anything that goes wrong in a page is written to the debugging record.
let notes = 0;
export function note(text) {
  if (++notes > 40) return;
  try { fetch('/api/debug/note', { method: 'POST', headers: { 'X-JobHunt': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(text).slice(0, 1800), page: location.hash }) }).catch(() => {}); } catch { /* nothing to do */ }
}
window.addEventListener('error', ev => note(`page error: ${ev.message} at ${(ev.filename || '').replace(location.origin, '')}:${ev.lineno}:${ev.colno} ${ev.error?.stack || ''}`));
window.addEventListener('unhandledrejection', ev => note(`unhandled: ${ev.reason?.stack || ev.reason?.message || ev.reason}`));
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = p => api(p, { method: 'DELETE' });

// ---- small pieces pages share ----------------------------------------------------
export function ago(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 0) return until(ts);
  if (s < 90) return 'just now';
  if (s < 90 * 60) return Math.round(s / 60) + ' min ago';
  if (s < 36 * 3600) return Math.round(s / 3600) + ' h ago';
  if (s < 14 * 86400) return Math.round(s / 86400) + ' days ago';
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export function until(ts) {
  const s = ts - Date.now() / 1000;
  if (s < 60) return 'now';
  if (s < 90 * 60) return 'in ' + Math.round(s / 60) + ' min';
  if (s < 36 * 3600) return 'in ' + Math.round(s / 3600) + ' h';
  return 'in ' + Math.round(s / 86400) + ' days';
}
export const when = ts => new Date(ts * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = ts => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const clock = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
// "3 days ago" on the page, the exact day and time when the pointer rests on it.
export const exact = ts => new Date(ts * 1000).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const rel = ts => (ts ? html`<span class="rel" title="${exact(ts)}">${ago(ts)}</span>` : '');
export const soon = ts => (ts ? html`<span class="rel" title="${exact(ts)}">${until(ts)}</span>` : '');

// A fit score's colour, as the old Job Hunt had it: green from 80, amber from 60, red below.
// The shades themselves are in app.css, one set for light and one for dark.
export const fitColor = v => (v >= 80 ? 'var(--fit-good)' : v >= 60 ? 'var(--fit-ok)' : 'var(--fit-low)');
const ringColor = v => (v >= 80 ? 'var(--fit-good)' : v >= 60 ? 'var(--fit-ok-ring)' : 'var(--fit-low)');
export function ring(v, label) {
  const c = 2 * Math.PI * 22, has = v >= 0;
  const col = fitColor(v);
  return html`<div class="ring" title="${label}"><svg viewBox="0 0 54 54"><circle class="track" cx="27" cy="27" r="22" fill="none" stroke-width="5"/>${has ? html`<circle cx="27" cy="27" r="22" fill="none" style="stroke:${ringColor(v)}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 27 27)"/>` : ''}</svg><b style="${has ? `color:${col}` : ''}">${has ? v : '–'}</b><span>${label}</span></div>`;
}
// Two rings, always: how the CV fits as it is, and after tailoring.
export const rings = (fit, tailored, small) => html`<div class="rings ${small ? 'small' : ''}">${ring(fit, 'Fit now')}${ring(tailored, 'Tailored')}</div>`;

const TILE = ['#2F4FC4', '#0B7A3B', '#C2410C', '#7A3FB8', '#0E7490', '#8F5B00', '#B42D2D', '#374151'];
// An employer's picture comes from its own site, through the program; where
// there is none, the letters stay. Pictures that failed are not asked for again.
const noLogo = new Set();
document.addEventListener('error', ev => {
  const t = ev.target;
  if (t?.tagName === 'IMG' && t.classList.contains('lgi')) { noLogo.add(t.dataset.co); t.remove(); }
}, true);
document.addEventListener('load', ev => {
  const t = ev.target;
  if (t?.tagName === 'IMG' && t.classList.contains('lgi')) t.parentElement.classList.add('has');
}, true);
export function tile(name, small, id) {
  const n = (name || '?').trim();
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const init = n.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => [...w][0].toUpperCase()).join('') || '?';
  const pic = id && !noLogo.has(String(id)) ? html`<img class="lgi" data-co="${id}" src="/api/companies/${id}/logo" alt="" loading="lazy">` : '';
  return html`<div class="lg ${small === 'big' ? 'big' : small ? 'sm' : ''}" style="background:${TILE[h % TILE.length]}">${init}${pic}</div>`;
}
// An employer's name, always a way to its page.
export const employer = (name, id, cls) => (id && name ? html`<a class="emp ${cls || ''}" href="#/employer/${id}" title="Opens ${name}: its postings, your history there, people, and what working there is like.">${name}</a>` : name || '');
// "$110,000–$150,000 a year" said short, so it fits a column: "$110k–$150k".
export function shortPay(p) {
  if (!p) return '';
  return String(p).replace(/(\d{2,3}),000(\.00)?/g, '$1k').replace(/(\d),(\d)00(?!\d)/g, '$1.$2k').replace(/\.0k/g, 'k').replace(/\s*(a|per|\/)\s*(year|yr|annum)\b\.?/gi, '').replace(/\s*(a|per|\/)\s*(hour|hr)\b\.?/gi, '/h').replace(/\s+(to|-|–|—)\s+/g, '–').trim();
}
// How many rows of a list fit the window, so lists page instead of scrolling.
export const rowsThatFit = (used, rowHeight, min = 6, max = 40) => Math.max(min, Math.min(max, Math.floor((window.innerHeight - used) / rowHeight)));
// Rows ticked in a list, kept while the page redraws.
export const picked = new Set();

export const BAND = { level: 'At your level', step_up: 'A step up', sideways: 'Sideways' };
export const STAGE = { new: 'Unread', found: 'Worth a look', ready: 'Ready to send', applied: 'Applied', reply: 'In conversation', interview: 'Interview', offer: 'Offer' };
export const CLOSED = { screened: 'Set aside', no: 'Not interested', rejected: 'They said no', expired: 'Taken down', withdrawn: 'Withdrawn' };
export const KIND = { knows_work: 'Knows your work', made_move: 'Made the same move', same_roots: 'Shares your roots', same_craft: 'Does your work', mentor: 'Mentor', recruiter: 'Recruiter', manager: 'Hiring manager', contact: 'You know them' };

export function stageChip(r) {
  if (r.closed) return html`<span class="chip ${r.closed === 'rejected' ? 'crit' : ''}">${CLOSED[r.closed] || r.closed}</span>`;
  const cls = { ready: 'hot', applied: 'blue', reply: 'good', interview: 'good', offer: 'good' }[r.stage] || '';
  return html`<span class="chip ${cls}">${STAGE[r.stage] || r.stage}</span>`;
}
// "18 min ago · 4 applicants", coloured while it is still early.
export function freshness(r, timeOnly) {
  const at = r.posted_at || r.first_seen_at, age = Date.now() / 1000 - at;
  const hot = age < 86400, few = r.applicants >= 0 && r.applicants < 10;
  return html`<span class="s m">${r.posted_at ? 'Posted' : 'Seen'} <b style="${hot ? 'color:var(--hot)' : ''}">${rel(at)}</b>${!timeOnly && r.applicants >= 0 ? html` · <b style="${few ? 'color:var(--hot)' : ''}">${r.applicants} applicant${r.applicants === 1 ? '' : 's'}</b>` : ''}</span>`;
}

// ---- routing ----------------------------------------------------------------------
export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, qs] = h.split('?');
  return { parts: p.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function href(path, q = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== '' && v !== undefined && v !== null) u.set(k, v);
  const s = u.toString();
  return '#/' + path + (s ? '?' + s : '');
}
// A link to the current page with some of its settings changed.
export function with_(route, patch) {
  return href(route.parts.join('/'), { ...route.q, ...patch });
}
export function pager(total, page, size, route) {
  if (total <= size) return total ? html`<div class="pager s m">${total} in all</div>` : '';
  const from = (page - 1) * size + 1, to = Math.min(page * size, total);
  return html`<div class="pager s"><span class="m">${from}–${to} of ${total}</span>
    ${page > 1 ? html`<a class="btn sm" href="${with_(route, { page: page - 1 })}">Previous</a>` : html`<span class="btn sm" disabled>Previous</span>`}
    ${to < total ? html`<a class="btn sm" href="${with_(route, { page: page + 1 })}">Next</a>` : html`<span class="btn sm" disabled>Next</span>`}</div>`;
}
// A column heading that sorts; clicking again reverses.
export function sortHead(label, key, route, def) {
  const cur = route.q.sort || def, on = cur === key || cur === '-' + key;
  const next = cur === key ? '-' + key : key;
  return html`<a class="${on ? 'on' : ''}" href="${with_(route, { sort: next, page: '' })}">${label}${on ? (cur.startsWith('-') ? ' ▲' : ' ▼') : ''}</a>`;
}

let toastTimer;
// undo, when given, is how to take back what was just done: the message then
// stays ten seconds with an Undo button.
export function toast(msg, bad, undo) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  t.setAttribute('role', 'status');
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Undo';
    b.onclick = async () => {
      b.disabled = true;
      try { await undo(); toast('Undone'); await refreshState(); await reload(true); } catch (e) { toast(e.message, true); }
    };
    t.append(b);
  }
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), undo ? 10000 : bad ? 7000 : 3500);
}
// The three ways to save a role for later, and how the day it comes back reads.
export const LATER = [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']];
export const dayName = t => new Date(t * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Couldn\'t copy. Select the text and press Ctrl+C.', true); }
}

// ---- the frame ----------------------------------------------------------------------
const IC = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  radar: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/></svg>',
  roles: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.600 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500M16 4.800a3.500 3.500 0 010 6.400M18.500 14.800c1.700.8 2.700 2.500 3 5.200"/></svg>',
  replies: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  interviews: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  progress: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  you: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.200 4-6 8-6s7 1.800 8 6"/></svg>',
};
const NAV = [['today', 'Today'], ['radar', 'Radar'], ['roles', 'Roles'], ['people', 'People'], ['replies', 'Replies'], ['interviews', 'Interviews'], ['progress', 'Progress'], ['you', 'You']];
const PAGES = {
  today: () => import('./pages/today.js'), radar: () => import('./pages/radar.js'), roles: () => import('./pages/roles.js'),
  role: () => import('./pages/role.js'), people: () => import('./pages/people.js'), replies: () => import('./pages/replies.js'),
  employer: () => import('./pages/employer.js'),
  interviews: () => import('./pages/interviews.js'), progress: () => import('./pages/progress.js'), you: () => import('./pages/you.js'),
  setup: () => import('./pages/setup.js'),
};

export const app = { state: null, route: null, page: null, data: null };
const $app = document.getElementById('app');

function badge(key) {
  const c = app.state?.counts || {};
  const n = { today: c.ready + c.questions, radar: c.fresh, roles: c.roles, people: c.people, replies: c.mail, interviews: c.talks }[key];
  if (!n) return '';
  const hot = key === 'radar' || key === 'replies';
  return html`<b class="${hot ? 'hot' : ''}">${n}</b>`;
}

function frame() {
  const st = app.state, on = app.route.parts[0] || 'today';
  const active = on === 'roles' || on === 'role' || on === 'employer' ? 'roles' : on;
  const cl = st.claude;
  return html`<div class="app"><aside class="side"><a class="logo" href="#/today" style="text-decoration:none"><img src="/logo.svg" alt="" width="28" height="28">Job Hunt</a>
    <nav class="col" style="gap:2px" aria-label="Main">${NAV.map(n => html`<a class="nav ${n[0] === active ? 'on' : ''}" href="#/${n[0]}" ${n[0] === active ? new Safe('aria-current="page"') : ''}>${new Safe(IC[n[0]])}${n[1]}<span id="b-${n[0]}" style="margin-left:auto;display:contents">${badge(n[0])}</span></a>`)}</nav>
    <div class="sp"></div>
    <div class="pilot" id="pilot">${pilot()}</div></aside>
    <div class="main"><div class="top"><h1 id="title"></h1><span class="sub" id="sub"></span>
      <div class="find"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/></svg><input id="find" type="text" placeholder="Find a role, employer or person" aria-label="Find a role, employer or person" autocomplete="off" style="height:32px;padding:0;border:0;box-shadow:none"><kbd>Ctrl K</kbd><div class="found" id="found" hidden></div></div>
      ${bellFrame()}${assistantButton()}</div>
      <div class="page" id="page" tabindex="-1"></div></div>${assistantFrame()}</div>`;
  void cl;
}
// The one place that says what Job Hunt is doing: bottom left, on every page.
function pilot() {
  const st = app.state, cl = st.claude, s = st.status;
  const how = { 'claude-code': 'your Claude sign-in', api: 'your API key', demo: 'sample answers (no Claude)' }[cl.engine] || '';
  const installing = (st.status.jobs || []).some(j => j.name === 'update');
  const up = !st.update || installing ? '' : st.can_install
    ? html`<button class="upd" data-update title="Downloads version ${st.update.version}, checks it and installs it. Job Hunt comes back by itself in about a minute; your data stays.">Version ${st.update.version} is ready · Install now</button>`
    : html`<a class="upd" href="${st.update.url}" title="Downloads the installer. Run it and Job Hunt restarts on the new version; your data stays.">Version ${st.update.version} is ready · Download</a>`;
  const ver = html`<a class="ver" href="#/you/app" title="The version you are running. Opens You, The app: updates, your data folder and the debugging record.">Job Hunt ${st.version}</a>`;
  if (!cl.engine) return html`${up}<h6><span class="dot off"></span>Not connected</h6><a href="#/you/connections" style="color:#9DB0FF">Connect Claude</a> and Job Hunt starts searching.${ver}`;
  const jobs = s.jobs || [];
  const foot = html`<div class="foot">Watching ${s.sources} sources · ${cl.calls} Claude calls today via ${how}${cl.engine === 'api' ? html` · $${cl.today.toFixed(2)}` : ''}</div>${ver}`;
  if (!cl.ok) return html`${up}<h6><span class="dot off"></span>Claude is resting</h6><a href="#/you/connections" style="color:#9DB0FF" title="${cl.note}">${cl.until ? html`Until ${clock(cl.until)}. ` : ''}See why</a>${foot}`;
  if (jobs.length) {
    const many = jobs.length > 1;
    return html`${up}<h6><span class="dot busy"></span><span class="grow">Working now</span>${many ? html`<button class="stop" data-stop="" title="Stops everything Job Hunt is doing right now. It will not start again by itself for half an hour.">Stop all</button>` : ''}</h6>
      ${jobs.slice(0, 3).map(j => html`<div class="job" title="${j.doing}${j.step ? ': ' + j.step : ''}"><div class="row" style="gap:6px"><b class="grow">${j.doing}</b><span>${j.percent}%</span><button class="stop" data-stop="${j.name}" title="Stops this now. What is already done stays. Job Hunt will not start it again by itself for half an hour.">Stop</button></div>
        ${j.step ? html`<div class="step">${j.step}</div>` : ''}<div class="bar" role="progressbar" aria-label="${j.doing}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${j.percent}"><i style="width:${j.percent}%"></i></div></div>`)}
      ${jobs.length > 3 ? html`<div class="step">and ${jobs.length - 3} more</div>` : ''}${foot}`;
  }
  if (s.paused) return html`${up}<h6><span class="dot off"></span>Searching is paused</h6><a href="#/radar" style="color:#9DB0FF">Turn it back on in Radar</a>${foot}`;
  if (s.held) return html`${up}<h6><span class="dot off"></span>Stopped by you</h6>Job Hunt starts by itself again at ${clock(s.held)}. <button class="stop go" data-resume title="Lets Job Hunt carry on now instead of waiting.">Carry on now</button>${foot}`;
  const next = Math.min(s.next_fast || Infinity, s.next_full || Infinity);
  return html`${up}<h6><span class="dot"></span>Watching for you</h6>${s.doing || html`Next check ${isFinite(next) ? soon(next) : 'soon'}.`}${foot}`;
}

// ---- the bell ------------------------------------------------------------------------
// Everything Job Hunt told the person is kept (the last fifty) and listed
// here, ten to a page. A click opens the page the notice is about.
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 0112 0c0 6 2.500 7.500 2.500 7.500h-17S6 15 6 9z"/><path d="M10 20a2.200 2.200 0 004 0"/></svg>';
const bell = { open: false, page: 1, list: [] };
// Ten to a page, fewer when the window is too short to show ten without scrolling inside the list.
const bellSize = () => Math.max(3, Math.min(10, Math.floor((window.innerHeight - 160) / 54)));
const bellFrame = () => html`<div class="bell" id="bell"><button type="button" id="bell-btn" aria-label="Notices" aria-expanded="false" aria-controls="bell-list" title="What Job Hunt told you: fresh roles that fit, replies, new versions and problems. Kept here so nothing is missed.">${new Safe(BELL)}<b id="bell-n" hidden></b></button><div class="bell-list" id="bell-list" role="dialog" aria-label="Notices" hidden></div></div>`;
function bellCount() {
  const b = document.getElementById('bell-n'), n = app.state?.notices || 0;
  if (!b) return;
  b.textContent = n > 99 ? '99+' : n;
  b.hidden = !n;
  document.getElementById('bell-btn').setAttribute('aria-label', n ? `Notices, ${n} unread` : 'Notices');
}
function bellDraw() {
  const box = document.getElementById('bell-list');
  if (!box) return;
  const BELL_SIZE = bellSize(), all = bell.list, pages = Math.max(1, Math.ceil(all.length / BELL_SIZE));
  bell.page = Math.max(1, Math.min(bell.page, pages));
  const from = (bell.page - 1) * BELL_SIZE, shown = all.slice(from, from + BELL_SIZE), unread = all.filter(n => !n.read).length;
  box.innerHTML = html`<header><b class="grow">Notices</b>${unread ? html`<button type="button" class="btn sm ghost" data-bell="all" title="Marks every notice as read. They stay in the list.">Mark all read</button>` : html`<span class="xs m">All read</span>`}</header>
    ${shown.length ? shown.map(n => html`<a class="n ${n.read ? '' : 'new'} ${n.kind === 'problem' ? 'problem' : ''}" href="${/^#\//.test(n.page || '') ? n.page : '#/today'}" data-bell="go" data-id="${n.id}"><b title="${n.title}">${n.title}</b><span class="xs m">${rel(n.at)}</span><span class="tx" title="${n.text}">${n.text}</span></a>`)
      : html`<p class="s m" style="padding:14px 12px">Nothing yet. Fresh roles that fit, replies and problems are kept here.</p>`}
    ${all.length > BELL_SIZE ? html`<footer><span class="xs m grow">${from + 1} to ${from + shown.length} of ${all.length}</span><button type="button" class="btn sm" data-bell="prev" ${bell.page > 1 ? '' : 'disabled'}>Previous</button><button type="button" class="btn sm" data-bell="next" ${bell.page < pages ? '' : 'disabled'}>Next</button></footer>` : ''}`.s;
}
async function bellLoad() {
  try { const r = await api('notices'); bell.list = r.notices || []; if (app.state) app.state.notices = r.unread; } catch { return; }
  bellCount();
  bellDraw();
}
function bellShow(open) {
  const box = document.getElementById('bell-list');
  if (!box) return;
  bell.open = open;
  box.hidden = !open;
  document.getElementById('bell-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { bell.page = 1; bellDraw(); bellLoad(); }
}
document.addEventListener('click', async ev => {
  if (ev.target.closest('#bell-btn')) { bellShow(!bell.open); return; }
  const el = ev.target.closest('[data-bell]');
  if (!el) { if (bell.open && !ev.target.closest('#bell')) bellShow(false); return; }
  switch (el.dataset.bell) {
    case 'prev': bell.page--; bellDraw(); break;
    case 'next': bell.page++; bellDraw(); break;
    case 'all': await post('notices/read').catch(() => {}); await bellLoad(); break;
    case 'go': bellShow(false); post('notices/read', { id: +el.dataset.id }).then(r => { if (app.state) app.state.notices = r.unread; bellCount(); }).catch(() => {}); break;
  }
});

// Light, dark, or whatever Windows is set to. The choice is kept by the
// program; theme.js applies it before the first paint, this keeps it right.
export function applyTheme(t) {
  if (t && document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}

// The version these pages were loaded from. When the program comes back as another one, the pages load again.
let loadedVersion = '';
// What changed, shown once after an update. Only the plain marks the change list uses are understood.
function mark(text) {
  const line = t => new Safe(esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '$1'));
  const items = text.split('\n').map(l => l.trim()).filter(Boolean);
  return html`<ul>${items.map(l => html`<li>${line(l.replace(/^[-*]\s+/, ''))}</li>`)}</ul>`;
}
function whatsNew() {
  const w = app.state?.whats_new;
  if (!w || document.getElementById('whatsnew')) return;
  const box = document.createElement('div');
  box.id = 'whatsnew';
  box.className = 'modal';
  box.innerHTML = html`<div class="card" role="dialog" aria-label="What's new"><div class="row"><h3 class="grow">Job Hunt updated itself to ${app.state.version}</h3><button class="btn sm p" data-seen>Got it</button></div>
    <p class="s m">You were on ${w.from}. This is what changed.</p>
    <div class="news">${w.changes.map(c => html`${w.changes.length > 1 ? html`<h4>${c.version}</h4>` : ''}${mark(c.text)}`)}</div></div>`.s;
  document.body.append(box);
}
async function refreshState() {
  try { app.state = await api('state'); } catch { return; }
  if (loadedVersion && app.state.version !== loadedVersion) { location.reload(); return; }
  loadedVersion = app.state.version;
  applyTheme(app.state.theme);
  bellCount();
  whatsNew();
  const pl = document.getElementById('pilot');
  if (pl) pl.innerHTML = pilot().s;
  for (const n of NAV) { const b = document.getElementById('b-' + n[0]); if (b) b.innerHTML = piece(badge(n[0])); }
}

// Stop and Carry on, in the bottom left, work on every page.
document.addEventListener('click', async ev => {
  const go = ev.target.closest('[data-resume]');
  if (go) { ev.preventDefault(); try { await post('jobs/resume'); } catch (e) { toast(e.message, true); } refreshState(); return; }
  if (ev.target.closest('[data-seen]')) { document.getElementById('whatsnew')?.remove(); post('update/seen').catch(() => {}); return; }
  const upd = ev.target.closest('[data-update]');
  if (upd) { ev.preventDefault(); upd.disabled = true; try { const r = await post('update/install'); toast(r?.waiting ? 'It installs as soon as what Job Hunt is doing now has finished. Nothing is cut short.' : 'Installing. Job Hunt comes back by itself in about a minute.'); } catch (e) { toast(e.message, true); } refreshState(); return; }
  const b = ev.target.closest('[data-stop]');
  if (!b) return;
  ev.preventDefault();
  b.disabled = true;
  try { await post('jobs/stop', { name: b.dataset.stop }); toast('Stopped'); } catch (e) { toast(e.message, true); }
  refreshState();
});
// While something is running, the bar is kept moving.
setInterval(() => { if (app.state?.status?.jobs?.length && !document.hidden) refreshState(); }, 1500);
// While an update installs the program is away for a moment; keep asking until it is back.
setInterval(() => { if ((app.state?.status?.jobs || []).some(j => j.name === 'update')) refreshState(); }, 2500);

function typing() {
  const a = document.activeElement;
  return a && a.closest('#page') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
}

let loadSeq = 0;
export async function reload(quiet) {
  const page = app.page, route = app.route, seq = ++loadSeq;
  if (!page) return;
  const root = document.getElementById('page');
  if (!root) return; // the frame is gone while Job Hunt restarts
  try {
    const data = await page.load(route);
    if (seq !== loadSeq || !root.isConnected) return;
    app.data = data;
    const keep = root.scrollTop;
    root.innerHTML = page.view(data, route).s;
    if (quiet) root.scrollTop = keep;
    document.getElementById('title').textContent = typeof page.title === 'function' ? page.title(data, route) : page.title;
    document.getElementById('sub').textContent = page.sub ? page.sub(data, route) : '';
    page.after?.(root, data, route);
    if (cursor >= 0) { if (quiet) moveCursor(cursor); else cursor = -1; }
  } catch (e) {
    if (seq !== loadSeq || !root.isConnected) return;
    document.getElementById('title').textContent = typeof page.title === 'string' ? page.title : 'Job Hunt';
    document.getElementById('sub').textContent = '';
    root.innerHTML = html`<div class="body"><div class="card empty"><h3>This page couldn't load</h3><p>${e.message}</p><p style="margin-top:12px"><button class="btn" data-act="_retry">Try again</button></p></div></div>`.s;
  }
}

// Draws the page again from what is already loaded: after ticking rows, or when the window changes size.
export function redraw() {
  const root = document.getElementById('page');
  if (!root || !app.page || !app.data) return;
  const keep = root.scrollTop;
  root.innerHTML = app.page.view(app.data, app.route).s;
  root.scrollTop = keep;
  app.page.after?.(root, app.data, app.route);
  if (cursor >= 0) moveCursor(cursor);
}
let sizeTimer, lastSize = '';
// The page's own room changes with the window and when the Claude panel opens beside it.
function sized() {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => {
    const pg = document.getElementById('page');
    const now = Math.round((pg?.clientWidth || innerWidth) / 40) + 'x' + Math.round(innerHeight / 30);
    if (now === lastSize || typing()) return;
    const first = !lastSize;
    lastSize = now;
    if (first) return;
    app.page?.sized ? reload(true) : redraw();
  }, 160);
}
window.addEventListener('resize', sized);
let sizeWatch;
function watchSize() {
  const pg = document.getElementById('page');
  if (!pg || !window.ResizeObserver) return;
  sizeWatch?.disconnect();
  sizeWatch = new ResizeObserver(sized);
  sizeWatch.observe(pg);
}

async function navigate() {
  const route = parseHash();
  if (!app.state) { try { app.state = await api('state'); loadedVersion = app.state.version; applyTheme(app.state.theme); whatsNew(); } catch (e) { $app.innerHTML = html`<div class="setup"><div class="card empty"><h3>Job Hunt is not running</h3><p>${e.message}</p></div></div>`.s; return; } }
  let key = route.parts[0] || 'today';
  if (!app.state.setup_done && key !== 'setup') { location.hash = '#/setup'; return; }
  if (key === 'roles' && route.parts[1] && route.parts[1] !== 'board') key = 'role';
  if (!PAGES[key]) { location.hash = '#/today'; return; }
  if (app.route?.parts.join('/') !== route.parts.join('/')) picked.clear();
  app.route = route;
  const mod = (await PAGES[key]()).default;
  app.page = mod;
  if (key === 'setup') { $app.innerHTML = '<div class="page" id="page" style="height:100vh"></div><h1 id="title" hidden></h1><span id="sub" hidden></span>'; }
  else if (!$app.querySelector('.app')) { $app.innerHTML = frame().s; mountAssistant(); bellCount(); watchSize(); }
  else {
    const active = key === 'role' || key === 'employer' ? 'roles' : key;
    $app.querySelectorAll('.nav').forEach(a => { const on = a.getAttribute('href') === '#/' + active; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  }
  document.title = 'Job Hunt';
  await reload();
  document.getElementById('page').scrollTop = 0;
  assistantRoute();
}

// Clicks, form submits and changes are routed to the page's actions by name.
async function act(el, ev, name, extra = {}) {
  if (name === '_retry') return reload();
  const fn = app.page?.actions?.[name];
  if (!fn) return;
  ev.preventDefault();
  if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
  const btn = el.tagName === 'FORM' ? el.querySelector('button[type=submit],button:not([type])') : el;
  const was = btn?.textContent;
  if (btn && btn.tagName === 'BUTTON') { btn.disabled = true; if (el.dataset.busy || btn.dataset.busy) btn.textContent = el.dataset.busy || btn.dataset.busy; }
  try {
    const res = await fn({ el, d: el.dataset, ev, route: app.route, data: app.data, ...extra });
    if (res !== false) { await refreshState(); await reload(true); }
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn && btn.isConnected && btn.tagName === 'BUTTON') { btn.disabled = false; if (was) btn.textContent = was; }
  }
}
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (el && el.tagName !== 'FORM' && !el.dataset.on) act(el, ev, el.dataset.act);
  if (!ev.target.closest('.find')) document.getElementById('found')?.setAttribute('hidden', '');
});
document.addEventListener('submit', ev => {
  const el = ev.target.closest('form[data-act]');
  if (!el) return;
  const f = Object.fromEntries(new FormData(el));
  act(el, ev, el.dataset.act, { f });
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-on=change]');
  if (el) act(el, ev, el.dataset.act, { value: el.type === 'checkbox' ? el.checked : el.value });
});

// The find box.
let findTimer;
document.addEventListener('input', ev => {
  if (ev.target.id !== 'find') return;
  clearTimeout(findTimer);
  const q = ev.target.value.trim(), box = document.getElementById('found');
  if (q.length < 2) { box.hidden = true; return; }
  findTimer = setTimeout(async () => {
    const r = await api('find?q=' + encodeURIComponent(q)).catch(() => null);
    if (!r) return;
    const any = r.roles.length + r.people.length + r.companies.length;
    box.innerHTML = (any ? html`${r.roles.length ? html`<div class="eb">Roles</div>${r.roles.map(x => html`<a href="#/roles/${x.id}"><b>${x.title}</b> <span class="m">· ${x.company}</span></a>`)}` : ''}
      ${r.companies.length ? html`<div class="eb">Employers</div>${r.companies.map(x => html`<a href="#/employer/${x.id}"><b>${x.name}</b> <span class="m">· ${x.open_roles} open</span></a>`)}` : ''}
      ${r.people.length ? html`<div class="eb">People</div>${r.people.map(x => html`<a href="#/people/${x.id}"><b>${x.name}</b> <span class="m">· ${x.company}</span></a>`)}` : ''}` : html`<div class="s m" style="padding:10px">Nothing matches “${q}”.</div>`).s;
    box.hidden = false;
  }, 180);
});
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); document.getElementById('find')?.focus(); }
  if (ev.key === 'Escape') { document.getElementById('found')?.setAttribute('hidden', ''); if (bell.open) { bellShow(false); document.getElementById('bell-btn')?.focus(); } }
  if (ev.key === 'Enter' && ev.target.id === 'find') { const a = document.querySelector('#found a'); if (a) { location.hash = a.getAttribute('href'); ev.target.value = ''; document.getElementById('found').hidden = true; } }
});
// Keyboard flow in lists: j and k move, Enter opens, x ticks, p prepares, a marks applied, n is "not for me", ? shows the keys.
let cursor = -1;
function listRows() { return [...document.querySelectorAll('#page table.tbl tbody tr')].filter(r => r.querySelector('a.t')); }
function moveCursor(to) {
  const rows = listRows();
  if (!rows.length) return;
  cursor = Math.max(0, Math.min(rows.length - 1, to));
  rows.forEach((r, i) => r.classList.toggle('cur', i === cursor));
  rows[cursor].scrollIntoView({ block: 'nearest' });
}
document.addEventListener('keydown', ev => {
  const t = ev.target;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.getElementById('whatsnew')) return;
  const rows = listRows(), row = rows[cursor];
  const press = sel => { const b = row?.querySelector(sel); if (b) { b.click(); return true; } return false; };
  switch (ev.key) {
    case 'j': case 'ArrowDown': if (rows.length) { ev.preventDefault(); moveCursor(cursor + 1); } break;
    case 'k': case 'ArrowUp': if (rows.length) { ev.preventDefault(); moveCursor(cursor - 1); } break;
    case 'Enter': if (row && t === document.body) { const a = row.querySelector('a.t'); if (a) location.hash = a.getAttribute('href'); } break;
    case 'x': if (press('td.pick input')) ev.preventDefault(); break;
    case 'p': press('[data-act=prepare]'); break;
    case 'a': press('[data-act=applied]'); break;
    case 'n': press('[data-act=no]'); break;
    case 'o': { const a = row?.querySelector('a[target=_blank]'); if (a) window.open(a.href, '_blank', 'noopener'); break; }
    case 'c': ev.preventDefault(); openAssistant(); break;
    case '/': ev.preventDefault(); document.getElementById('find')?.focus(); break;
    case '?': toast('Keys: j/k move · Enter open · c ask Claude · x tick · p prepare · a I applied · n not for me · o open the posting · / find · g then t/r/p for Today/Roles/People'); break;
    case 'g': goKey = Date.now(); break;
    case 't': if (Date.now() - goKey < 1200) location.hash = '#/today'; break;
    case 'r': if (Date.now() - goKey < 1200) location.hash = '#/roles'; break;
  }
});
let goKey = 0;
window.addEventListener('hashchange', () => { if (bell.open) bellShow(false); const f = document.getElementById('find'); if (f) f.value = ''; document.getElementById('found')?.setAttribute('hidden', ''); navigate(); });

// The program says when something changed; open pages bring themselves up to date.
let pendingTopics = new Set(), flushTimer;
function flush() {
  if (typing()) { flushTimer = setTimeout(flush, 1500); return; }
  const topics = pendingTopics;
  pendingTopics = new Set();
  refreshState();
  if (bell.open && topics.has('notices')) bellLoad();
  const mine = app.page?.topics || [];
  if (mine.some(t => topics.has(t))) reload(true);
}
function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = m => {
    let topics;
    try { topics = JSON.parse(m.data); } catch { return; }
    topics.forEach(t => pendingTopics.add(t));
    // The conversation with Claude keeps up even while the person is typing.
    if (topics.includes('assistant')) refreshAssistant();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 250);
  };
}
setInterval(refreshState, 60000);
listen();
navigate();
