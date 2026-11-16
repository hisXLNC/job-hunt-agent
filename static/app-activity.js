// ---- What's running ----
// Whatever Job Hunt is doing that you might want to watch or stop (the search, Claude filling in a
// form in your browser, tailoring, a CV update, an answer being written) is asked for here every few
// seconds. Each has a progress bar (real where the work counts its steps, a guess from how long it
// usually takes elsewhere) and its own Stop. It all shows in the status button's sheet, below.

const running = { list: [], recent: [], notices: [], lastSearch: '', idleOpen: false, timer: 0, shut: false, stopping: new Set() };
try { running.shut = localStorage.getItem('running.shut') === '1'; } catch (e) {}

const actTime = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function actDraw(list) {
  running.list = list || [];
  document.getElementById('actBar')?.remove();
  // What stopped is no longer "stopping".
  for (const id of [...running.stopping]) if (!running.list.some(a => a.id === id)) running.stopping.delete(id);
  hubDraw();
}

// ---- The status button ----
// One button in the top bar for everything Job Hunt has to tell you: what it's doing now (with Stop),
// the search, email, backup, Claude, the last notices, and the Auto / Light / Dark switch. It says the
// one thing that matters most: blue while working, amber with the words when something needs you, a
// quiet green "All good" otherwise. (It replaced a row of separate chips and the panel at the bottom left.)
const hub = { open: false, which: 'status', html: '', seen: '' };
try { hub.seen = localStorage.getItem('hub.seen') || ''; } catch (e) {}

function hubState() {
  const txt = id => document.getElementById(id)?.textContent || '';
  const shown = id => { const e = document.getElementById(id); return !!e && !e.hidden; };
  const list = running.list;
  if (list.length) {
    const a = list[0];
    return list.length === 1 ? { kind: 'busy', text: `${a.label}${a.estimated ? '' : ` ${a.percent}%`}`, short: a.estimated ? 'Working' : `${a.percent}%` }
      : { kind: 'busy', text: `${list.length} things running`, short: `${list.length} running` };
  }
  if (shown('connLine')) return { kind: 'warn', text: 'Check connections', short: 'Connections' };
  if (shown('limitLine')) return { kind: 'warn', text: txt('limitNote'), short: 'Claude limit' };
  if (shown('updateNote')) return { kind: 'warn', text: 'Update ready', short: 'Update' };
  if (shown('syncLine') && /\b(warn|crit)\b/.test(document.getElementById('dotSync')?.className || '')) return { kind: 'warn', text: txt('syncNote'), short: /sync/i.test(txt('syncNote')) ? 'Sync' : 'Backup' };
  return { kind: 'ok', text: 'All good', short: 'All good' };
}
const hubUnread = () => (running.notices || []).filter(n => n.at > hub.seen).length;

function hubSheetHtml() {
  const txt = id => document.getElementById(id)?.textContent || '';
  const shown = id => { const e = document.getElementById(id); return !!e && !e.hidden; };
  const o = typeof overview === 'object' && overview ? overview : {};
  const dot = cls => `<span class="dot ${cls}"></span>`;
  const row = (cls, name, sub, action) => `<div class="hub-row">${dot(cls)}<div class="hub-what"><b>${name}</b><small>${sub}</small></div>${action || ''}</div>`;
  const go = (href, label) => `<a class="hub-do" href="${href}">${label}</a>`;
  const doing = running.list.map(a => `<li class="act-row" data-act-id="${esc(a.id)}">
      <div class="act-top"><b>${esc(a.label)}</b><span class="muted small">${actTime(a.secs)}</span></div>
      ${a.detail ? `<div class="muted small act-detail">${esc(a.detail)}</div>` : ''}
      <div class="act-line"><div class="pbar${a.estimated ? ' guess' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.percent}" title="${a.estimated ? 'A guess from how long this usually takes' : `${a.percent}% done`}"><i style="width:${Math.max(3, a.percent)}%"></i></div>
        ${a.stoppable ? `<button class="btn ghost danger sm" type="button" data-act-stop="${esc(a.id)}" ${running.stopping.has(a.id) ? 'disabled' : ''} title="Ends this now. What's done so far is kept; ask for it again when you want it.">${running.stopping.has(a.id) ? 'Stopping…' : 'Stop'}</button>` : ''}</div>
    </li>`).join('');
  const searching = running.list.some(a => a.id === 'search');
  const g = o.setup?.google, gOff = (o.setup?.skipped || []).includes('google');
  const syncCls = (document.getElementById('dotSync')?.className || '').replace('dot', '').trim();
  const rows = [
    row(searching ? 'busy' : 'on', 'Search', `${esc(txt('runNote') || (running.lastSearch ? `Searched ${ago(running.lastSearch)}` : 'Not yet'))}${o.last_report && !searching ? ` · ${o.last_report.new} new` : ''} · ${'<a href="#search">results</a>'}`,
      searching ? '' : `<button class="hub-do" type="button" data-act="run" data-task="search" ${o.setup && !o.setup.cvs ? 'disabled title="Add your CV first"' : ''}>Search now</button>`),
    g ? row('on', 'Email', o.last_inbox ? `Checked ${esc(ago(o.last_inbox))}` : 'Gmail is connected', '<button class="hub-do" type="button" data-act="run" data-task="inbox">Check now</button>')
      : gOff ? '' : row('', 'Email', 'Gmail isn\'t connected', go('#settings/connections', 'Connect')),
    shown('syncLine') ? row(syncCls, /sync/i.test(txt('syncNote')) ? 'Sync' : 'Backup', esc(txt('syncNote')), go('#settings/sync', 'Open')) : '',
    row(shown('connLine') || shown('limitLine') ? 'warn' : 'on', 'Claude', shown('connLine') ? `<a href="#settings/connections">${esc(txt('connNote'))}</a>` : shown('limitLine') ? esc(txt('limitNote')) : running.list.length ? 'Working' : 'Ready',
      '<button class="hub-do danger" type="button" data-act="searchForceStop" title="Ends the search, CV updating and tailoring, or everything Claude is doing, now">Force stop…</button>'),
    shown('updateNote') ? row('warn', 'Update', 'A newer version is ready', go('#settings/app', 'See it')) : '',
  ].join('');
  const theme = document.documentElement.dataset.theme || 'auto';
  return `${doing ? `<ul class="act-list hub-doing">${doing}</ul>${running.list.length > 1 ? '<div class="act-foot"><button class="btn ghost danger sm" type="button" data-act="searchForceStop">Stop several…</button></div>' : ''}` : ''}
    <div class="hub-rows">${rows}</div>
    <div class="hub-theme" role="radiogroup" aria-label="Appearance">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, n]) => `<button type="button" role="radio" aria-checked="${k === theme}" class="${k === theme ? 'on' : ''}" data-hub-theme="${k}">${n}</button>`).join('')}</div>
    <a class="muted small hub-ver" href="#settings/app">${esc(txt('versionNote'))} · what's new</a>`;
}
/** The bell's sheet: the notices Job Hunt sent (new ones marked), then the last things it did. */
function bellSheetHtml() {
  const notices = (running.notices || []).slice(0, 8).map(n => `<li class="${n.at > hub.seen ? 'new' : ''}"><div class="act-top"><b>${esc(n.title)}</b><span class="muted small nowrap" title="${esc(new Date(n.at).toLocaleString())}">${esc(ago(n.at))}</span></div><div class="muted small">${esc(n.body)}</div></li>`).join('');
  const recent = running.recent.slice(0, 5).map(e => `<li><div class="act-top"><span>${jobLink(e)}${eventText(e)}</span><span class="muted small nowrap">${esc(ago(e.created_at))}</span></div></li>`).join('');
  return `<h3 class="hub-h bell-h">Notifications</h3>
    ${notices ? `<ul class="hub-notes">${notices}</ul>` : '<p class="muted small bell-none">Nothing yet. Job Hunt tells you here when a search finds new matches, a reply comes in or it finds a recruiter.</p>'}
    ${recent ? `<details class="hub-recent"><summary class="small muted">The last things Job Hunt did</summary><ul class="hub-notes">${recent}</ul></details>` : ''}`;
}

function hubPlace() {
  const sheet = document.getElementById('hubSheet');
  const btn = [...document.querySelectorAll(hub.which === 'bell' ? '[data-bell]' : '[data-hub]')].find(b => b.getBoundingClientRect().width > 0);
  if (!sheet || !btn) return;
  const r = btn.getBoundingClientRect();
  sheet.style.top = `${Math.round(r.bottom + 8)}px`;
  sheet.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
  sheet.style.maxHeight = `${Math.max(200, innerHeight - r.bottom - 24)}px`;
}

function hubDraw() {
  // The buttons: one in the desktop bar, one in the phone's (whichever shows).
  const caret = '<span class="caret"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>';
  const make = cls => `<button type="button" class="hub ${cls}" data-hub aria-haspopup="dialog" aria-expanded="false"><span class="dot"></span><span class="hub-t"></span>${caret}</button><button type="button" class="bell ${cls}" data-bell aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="bell-n" hidden></span></button>`;
  const pop = document.getElementById('statusPop');
  if (pop && !document.querySelector('.hub.desk')) pop.insertAdjacentHTML('beforebegin', make('desk'));
  const top = document.querySelector('.mtop'), ask = top?.querySelector('[data-act="askOpen"]');
  if (top && !top.querySelector('.hub')) (ask || top.lastElementChild).insertAdjacentHTML(ask ? 'beforebegin' : 'afterend', make('phone'));
  const st = hubState(), unread = hubUnread();
  document.querySelectorAll('[data-hub]').forEach(b => {
    b.className = `hub ${b.classList.contains('desk') ? 'desk' : 'phone'} ${st.kind}`;
    b.querySelector('.dot').className = `dot ${st.kind === 'ok' ? 'on' : st.kind}`;
    const t = b.querySelector('.hub-t'); t.textContent = b.classList.contains('phone') ? st.short : st.text;
    b.title = `${st.text}. Press for the search, email, backup and what Job Hunt is doing.`;
    b.setAttribute('aria-label', b.title); b.setAttribute('aria-expanded', hub.open && hub.which === 'status');
  });
  document.querySelectorAll('[data-bell]').forEach(b => {
    const n = b.querySelector('.bell-n'); n.hidden = !unread; n.textContent = unread;
    b.classList.toggle('new', !!unread);
    b.title = unread ? `${unread} new notification${unread === 1 ? '' : 's'}` : 'Notifications';
    b.setAttribute('aria-label', b.title); b.setAttribute('aria-expanded', hub.open && hub.which === 'bell');
  });
  let sheet = document.getElementById('hubSheet');
  if (!sheet) { sheet = document.createElement('section'); sheet.id = 'hubSheet'; sheet.className = 'hub-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'What Job Hunt is doing'); sheet.hidden = true; document.body.appendChild(sheet); }
  sheet.hidden = !hub.open;
  if (!hub.open) return;
  const html = hub.which === 'bell' ? bellSheetHtml() : hubSheetHtml();
  sheet.setAttribute('aria-label', hub.which === 'bell' ? 'Notifications' : 'What Job Hunt is doing');
  // Redrawn only when something changed, so a list you opened or scrolled stays as it was.
  if (html !== hub.html) { const was = sheet.querySelector('.hub-recent')?.open; sheet.innerHTML = hub.html = html; if (was) sheet.querySelector('.hub-recent').open = true; }
  hubPlace();
}
function hubToggle(open, which) {
  hub.open = open; hub.html = ''; if (open) hub.which = which || 'status';
  hubDraw();
  // The bell opened: the notices have been seen (they stay marked new until it's closed).
  if (open && hub.which === 'bell') { const newest = (running.notices || [])[0]?.at; if (newest && newest > hub.seen) { setTimeout(() => { hub.seen = newest; try { localStorage.setItem('hub.seen', newest); } catch (e) {} if (!hub.open) hubDraw(); }, 0); } }
  else hubDraw();
}
document.addEventListener('click', e => {
  const btn = e.target.closest?.('[data-hub]');
  if (btn) { e.stopPropagation(); return hubToggle(!(hub.open && hub.which === 'status'), 'status'); }
  const bell = e.target.closest?.('[data-bell]');
  if (bell) { e.stopPropagation(); return hubToggle(!(hub.open && hub.which === 'bell'), 'bell'); }
  if (!hub.open) return;
  const sheet = document.getElementById('hubSheet');
  const pick = e.target.closest?.('[data-hub-theme]');
  if (pick) { setTheme(pick.dataset.hubTheme); hub.html = ''; return hubDraw(); }
  // Outside it, or a link or an action in it (not Stop, which stays to show "Stopping…"): it closes.
  if (!sheet.contains(e.target) || (e.target.closest('a, [data-act]') && !e.target.closest('summary'))) hubToggle(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && hub.open) hubToggle(false); });
addEventListener('resize', () => { if (hub.open) hubPlace(); });

async function actLoad() {
  clearTimeout(running.timer);
  let list = running.list;
  try { const r = await api('/api/activity'); list = r.running; running.recent = r.recent || []; running.lastSearch = r.last_search || ''; running.notices = r.notices || []; } catch (e) { /* the app is busy or restarting: try again */ }
  actDraw(list);
  // Often while something runs; now and then when idle, to notice work that starts by itself.
  running.timer = setTimeout(actLoad, list.length ? 2000 : 7000);
}

document.addEventListener('click', async e => {
  const stop = e.target.closest?.('[data-act-stop]');
  if (!stop) return;
  const id = stop.dataset.actStop;
  running.stopping.add(id);
  actDraw(running.list);
  try {
    const r = await api('/api/activity/stop', { method: 'POST', body: { id } });
    toast(r.stopped ? 'Stopping it now. What was done so far is kept.' : 'It had already finished.');
    if (!r.stopped) running.stopping.delete(id);
    actDraw(r.running);
    if (id === 'search') { await refreshOverview(); route(); }
  } catch (x) { running.stopping.delete(id); actDraw(running.list); toast(x.message, true); }
});
// Anything you start shows at once, not at the next look.
document.addEventListener('click', e => { if (e.target.closest?.('[data-act], [data-ask-act], .ask-go, [data-cv-chat-form] button')) setTimeout(actLoad, 700); }, true);
actLoad();

// ---- Swipes, in the Queue's one-by-one view on a touch screen ----
// Left: not interested (the notice that follows has Undo). Right: skip to the next. The card follows
// the finger, and only a mostly sideways drag past a third of a thumb's reach counts.
(() => {
  let t = null;
  const card = e => e.target.closest?.('article.card.decision');
  document.addEventListener('touchstart', e => {
    const c = card(e);
    if (!c || e.touches.length !== 1 || e.target.closest('.dbar, input, textarea, select, [contenteditable], .scroll-x, table')) { t = null; return; }
    t = { c, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!t) return;
    const dx = e.touches[0].clientX - t.x, dy = e.touches[0].clientY - t.y;
    if (!t.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { t = null; return; }   // scrolling the page
      if (Math.abs(dx) < 14) return;
      t.on = true; t.c.classList.add('swiping');
    }
    t.dx = dx;
    t.c.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`;
    t.c.style.opacity = String(Math.max(.35, 1 - Math.abs(dx) / 500));
    t.c.dataset.swipe = dx < -90 ? 'no' : dx > 90 ? 'skip' : '';
  }, { passive: true });
  const end = () => {
    if (!t) return;
    const { c, dx, on } = t; t = null;
    if (!on) return;
    c.classList.remove('swiping'); delete c.dataset.swipe;
    const btn = dx < -90 ? c.querySelector('.dbar [data-status="dismissed"]') : dx > 90 ? c.querySelector('.dbar [data-act="queueSkip"]') : null;
    if (!btn) { c.style.transform = ''; c.style.opacity = ''; return; }
    c.style.transition = 'transform .18s ease, opacity .18s ease';
    c.style.transform = `translateX(${dx < 0 ? -110 : 110}vw)`; c.style.opacity = '0';
    setTimeout(() => btn.click(), 160);
    // Not interested asks first: if you cancel, the card is still here, so it comes back.
    setTimeout(() => { if (c.isConnected) { c.style.transition = ''; c.style.transform = ''; c.style.opacity = ''; } }, 700);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { if (t?.on) { t.c.style.transform = ''; t.c.style.opacity = ''; t.c.classList.remove('swiping'); } t = null; });
})();
