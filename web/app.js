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
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
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

export function ring(v, label) {
  const c = 2 * Math.PI * 22, has = v >= 0;
  const col = v >= 85 ? '#0B7A3B' : v >= 70 ? '#2F4FC4' : '#8F5B00';
  return html`<div class="ring" title="${label}"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" fill="none" stroke="#E8EBF2" stroke-width="5"/>${has ? html`<circle cx="27" cy="27" r="22" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 27 27)"/>` : ''}</svg><b>${has ? v : '–'}</b><span>${label}</span></div>`;
}
// Two rings, always: how the CV fits as it is, and after tailoring.
export const rings = (fit, tailored, small) => html`<div class="rings ${small ? 'small' : ''}">${ring(fit, 'Fit now')}${ring(tailored, 'Tailored')}</div>`;

const TILE = ['#2F4FC4', '#0B7A3B', '#C2410C', '#7A3FB8', '#0E7490', '#8F5B00', '#B42D2D', '#374151'];
export function tile(name, small) {
  const n = (name || '?').trim();
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const init = n.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).slice(0, 2).map(w => [...w][0].toUpperCase()).join('') || '?';
  return html`<div class="lg ${small ? 'sm' : ''}" style="background:${TILE[h % TILE.length]}">${init}</div>`;
}

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
  return html`<span class="s m">${r.posted_at ? 'Posted' : 'Seen'} <b style="${hot ? 'color:var(--hot)' : ''}">${ago(at)}</b>${!timeOnly && r.applicants >= 0 ? html` · <b style="${few ? 'color:var(--hot)' : ''}">${r.applicants} applicant${r.applicants === 1 ? '' : 's'}</b>` : ''}</span>`;
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
export function toast(msg, bad) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  t.setAttribute('role', 'status');
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
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

function pill() {
  const st = app.state;
  if (!st) return '';
  if (!st.claude.engine) return html`<a class="work" href="#/you/connections"><span class="dot off"></span>Connect Claude to start</a>`;
  if (!st.claude.ok) return html`<a class="work" href="#/you/connections" title="${st.claude.note}"><span class="dot off"></span>Claude is resting${st.claude.until ? html` until ${clock(st.claude.until)}` : ''}</a>`;
  if (st.status.doing) return html`<span class="work"><span class="dot busy"></span>${st.status.doing}</span>`;
  if (st.status.paused) return html`<a class="work" href="#/radar"><span class="dot off"></span>Searching is paused</a>`;
  const next = Math.min(st.status.next_fast || Infinity, st.status.next_full || Infinity);
  return html`<span class="work"><span class="dot"></span>Next check ${isFinite(next) ? until(next) : 'soon'}</span>`;
}

function frame() {
  const st = app.state, on = app.route.parts[0] || 'today';
  const active = on === 'roles' || on === 'role' ? 'roles' : on;
  const cl = st.claude;
  return html`<div class="app"><aside class="side"><a class="logo" href="#/today" style="text-decoration:none"><i>J</i>Job Hunt</a>
    <nav class="col" style="gap:2px" aria-label="Main">${NAV.map(n => html`<a class="nav ${n[0] === active ? 'on' : ''}" href="#/${n[0]}" ${n[0] === active ? new Safe('aria-current="page"') : ''}>${new Safe(IC[n[0]])}${n[1]}<span id="b-${n[0]}" style="margin-left:auto;display:contents">${badge(n[0])}</span></a>`)}</nav>
    <div class="sp"></div>
    <div class="pilot" id="pilot">${pilot()}</div></aside>
    <div class="main"><div class="top"><h1 id="title"></h1><span class="sub" id="sub"></span>
      <div class="find"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/></svg><input id="find" type="text" placeholder="Find a role, employer or person" aria-label="Find a role, employer or person" autocomplete="off" style="height:32px;padding:0;border:0;box-shadow:none"><kbd>Ctrl K</kbd><div class="found" id="found" hidden></div></div>
      <span id="pill">${pill()}</span>${assistantButton()}</div>
      <div class="page" id="page" tabindex="-1"></div></div>${assistantFrame()}</div>`;
  void cl;
}
function pilot() {
  const st = app.state, cl = st.claude;
  const head = cl.engine ? (st.status.paused ? 'Paused' : 'Working for you') : 'Not connected';
  const how = { 'claude-code': 'your Claude sign-in', api: 'your API key', demo: 'sample answers (no Claude)' }[cl.engine] || '';
  return html`<h6><span class="dot ${cl.engine && cl.ok && !st.status.paused ? '' : 'off'}"></span>${head}</h6>
    ${cl.engine ? html`Watching ${st.status.sources} sources. ${st.status.doing || ''}<div style="margin-top:6px;color:#8F98B3">${cl.calls} Claude calls today via ${how}${cl.engine === 'api' ? html` · $${cl.today.toFixed(2)}` : ''}</div>` : html`<a href="#/you/connections" style="color:#9DB0FF">Connect Claude</a> and Job Hunt starts searching.`}`;
}

async function refreshState() {
  try { app.state = await api('state'); } catch { return; }
  const p = document.getElementById('pill'), pl = document.getElementById('pilot');
  if (p) p.innerHTML = pill().s;
  if (pl) pl.innerHTML = pilot().s;
  for (const n of NAV) { const b = document.getElementById('b-' + n[0]); if (b) b.innerHTML = piece(badge(n[0])); }
}

function typing() {
  const a = document.activeElement;
  return a && a.closest('#page') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
}

let loadSeq = 0;
export async function reload(quiet) {
  const page = app.page, route = app.route, seq = ++loadSeq;
  if (!page) return;
  const root = document.getElementById('page');
  try {
    const data = await page.load(route);
    if (seq !== loadSeq) return;
    app.data = data;
    const keep = root.scrollTop;
    root.innerHTML = page.view(data, route).s;
    if (quiet) root.scrollTop = keep;
    document.getElementById('title').textContent = typeof page.title === 'function' ? page.title(data, route) : page.title;
    document.getElementById('sub').textContent = page.sub ? page.sub(data, route) : '';
    page.after?.(root, data, route);
  } catch (e) {
    if (seq !== loadSeq) return;
    document.getElementById('title').textContent = typeof page.title === 'string' ? page.title : 'Job Hunt';
    document.getElementById('sub').textContent = '';
    root.innerHTML = html`<div class="body"><div class="card empty"><h3>This page couldn't load</h3><p>${e.message}</p><p style="margin-top:12px"><button class="btn" data-act="_retry">Try again</button></p></div></div>`.s;
  }
}

async function navigate() {
  const route = parseHash();
  if (!app.state) { try { app.state = await api('state'); } catch (e) { $app.innerHTML = html`<div class="setup"><div class="card empty"><h3>Job Hunt is not running</h3><p>${e.message}</p></div></div>`.s; return; } }
  let key = route.parts[0] || 'today';
  if (!app.state.setup_done && key !== 'setup') { location.hash = '#/setup'; return; }
  if (key === 'roles' && route.parts[1] && route.parts[1] !== 'board') key = 'role';
  if (!PAGES[key]) { location.hash = '#/today'; return; }
  app.route = route;
  const mod = (await PAGES[key]()).default;
  app.page = mod;
  if (key === 'setup') { $app.innerHTML = '<div class="page" id="page" style="height:100vh"></div><h1 id="title" hidden></h1><span id="sub" hidden></span>'; }
  else if (!$app.querySelector('.app')) { $app.innerHTML = frame().s; mountAssistant(); }
  else {
    const active = key === 'role' ? 'roles' : key;
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
      ${r.companies.length ? html`<div class="eb">Employers</div>${r.companies.map(x => html`<a href="${href('roles', { company: x.id, closed: 'all' })}"><b>${x.name}</b> <span class="m">· ${x.open_roles} open</span></a>`)}` : ''}
      ${r.people.length ? html`<div class="eb">People</div>${r.people.map(x => html`<a href="#/people/${x.id}"><b>${x.name}</b> <span class="m">· ${x.company}</span></a>`)}` : ''}` : html`<div class="s m" style="padding:10px">Nothing matches “${q}”.</div>`).s;
    box.hidden = false;
  }, 180);
});
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); document.getElementById('find')?.focus(); }
  if (ev.key === 'Escape') { document.getElementById('found')?.setAttribute('hidden', ''); }
  if (ev.key === 'Enter' && ev.target.id === 'find') { const a = document.querySelector('#found a'); if (a) { location.hash = a.getAttribute('href'); ev.target.value = ''; document.getElementById('found').hidden = true; } }
});
window.addEventListener('hashchange', () => { const f = document.getElementById('find'); if (f) f.value = ''; document.getElementById('found')?.setAttribute('hidden', ''); navigate(); });

// The program says when something changed; open pages bring themselves up to date.
let pendingTopics = new Set(), flushTimer;
function flush() {
  if (typing()) { flushTimer = setTimeout(flush, 1500); return; }
  const topics = pendingTopics;
  pendingTopics = new Set();
  refreshState();
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
