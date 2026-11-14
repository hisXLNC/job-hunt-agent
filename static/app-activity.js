// ---- What's running ----
// A small panel, bottom left, whenever Job Hunt is doing something you might want to watch or stop:
// the search, Claude filling in a form in your browser, tailoring, a CV update, an answer being
// written. Each has a progress bar (real where the work counts its steps, a guess from how long it
// usually takes elsewhere) and its own Stop. Nothing running: nothing shown.

const running = { list: [], timer: 0, shut: false, stopping: new Set() };
try { running.shut = localStorage.getItem('running.shut') === '1'; } catch (e) {}

const actTime = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function actHtml(list) {
  if (!list.length) return '';
  const rows = list.map(a => `<li class="act-row" data-act-id="${esc(a.id)}">
      <div class="act-top"><b>${esc(a.label)}</b><span class="muted small">${actTime(a.secs)}</span></div>
      ${a.detail ? `<div class="muted small act-detail">${esc(a.detail)}</div>` : ''}
      <div class="act-line"><div class="pbar${a.estimated ? ' guess' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${a.percent}" title="${a.estimated ? 'A guess from how long this usually takes' : `${a.percent}% done`}"><i style="width:${Math.max(3, a.percent)}%"></i></div>
        ${a.stoppable ? `<button class="btn ghost danger sm" type="button" data-act-stop="${esc(a.id)}" ${running.stopping.has(a.id) ? 'disabled' : ''} title="Ends this now. What's done so far is kept; ask for it again when you want it.">${running.stopping.has(a.id) ? 'Stopping…' : 'Stop'}</button>` : ''}</div>
    </li>`).join('');
  return `<button class="act-head" type="button" data-act-toggle aria-expanded="${!running.shut}" title="${running.shut ? 'Show what\'s running' : 'Hide'}"><span class="act-dot"></span><b>${list.length === 1 ? esc(list[0].label) : `${list.length} things running`}</b><span class="caret">${running.shut ? '▴' : '▾'}</span></button>
    ${running.shut ? '' : `<ul class="act-list">${rows}</ul>${list.length > 1 ? '<div class="act-foot"><button class="btn ghost danger sm" type="button" data-act="searchForceStop">Stop several…</button></div>' : ''}`}`;
}

function actDraw(list) {
  running.list = list || [];
  let box = document.getElementById('actBar');
  if (!box) { box = document.createElement('section'); box.id = 'actBar'; box.className = 'act-bar'; box.setAttribute('aria-label', 'What Job Hunt is doing'); document.body.appendChild(box); }
  box.hidden = !running.list.length;
  box.classList.toggle('shut', running.shut);
  box.innerHTML = actHtml(running.list);
  // What stopped is no longer "stopping".
  for (const id of [...running.stopping]) if (!running.list.some(a => a.id === id)) running.stopping.delete(id);
}

async function actLoad() {
  clearTimeout(running.timer);
  let list = running.list;
  try { list = (await api('/api/activity')).running; } catch (e) { /* the app is busy or restarting: try again */ }
  actDraw(list);
  // Often while something runs; now and then when idle, to notice work that starts by itself.
  running.timer = setTimeout(actLoad, list.length ? 2000 : 7000);
}

document.addEventListener('click', async e => {
  if (e.target.closest?.('[data-act-toggle]')) {
    running.shut = !running.shut;
    try { localStorage.setItem('running.shut', running.shut ? '1' : ''); } catch (x) {}
    return actDraw(running.list);
  }
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
