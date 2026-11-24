import { html, api, post, rings, tile, toast, pager, sortHead, with_, href, stageChip, freshness, BAND, STAGE, CLOSED, fitColor, employer, shortPay, rowsThatFit, picked, redraw } from '../app.js';

const size = () => rowsThatFit(318, 57, 5, 30);
const STAGES = ['found', 'ready', 'applied', 'reply', 'interview', 'offer'];

function query(route) {
  const q = route.q, u = new URLSearchParams({ size: size(), page: q.page || 1, sort: q.sort || 'age' });
  for (const k of ['stage', 'closed', 'band', 'minfit', 'q', 'company', 'saved']) if (q[k]) u.set(k, q[k]);
  return u.toString();
}

function filters(d, route) {
  const q = route.q, c = d.counts || {};
  const open = STAGES.reduce((n, s) => n + (c[s] || 0), 0);
  const chip = (label, n, patch, on) => html`<a class="chip ${on ? 'on' : ''}" href="${with_(route, { stage: '', closed: '', page: '', ...patch })}">${label}${n !== undefined ? html` <span style="opacity:.7">${n}</span>` : ''}</a>`;
  const closedOn = q.closed && q.closed !== 'all';
  return html`<div class="card col" style="gap:10px;padding:12px 14px">
    <div class="row wrap" style="gap:6px">
      ${chip('All open', open, {}, !q.stage && !q.closed)}
      ${STAGES.map(s => chip(STAGE[s], c[s] || 0, { stage: s }, q.stage === s))}
      <span class="m">|</span>
      ${chip('Set aside', c['closed:screened'] || 0, { closed: 'screened' }, q.closed === 'screened')}
      ${chip('Not interested', c['closed:no'] || 0, { closed: 'no' }, q.closed === 'no')}
      ${chip('Ended', (c['closed:rejected'] || 0) + (c['closed:expired'] || 0) + (c['closed:withdrawn'] || 0), { closed: 'rejected,expired,withdrawn' }, q.closed === 'rejected,expired,withdrawn')}
    </div>
    <form data-act="filter" class="row" style="gap:8px">
      <input type="text" name="q" value="${q.q || ''}" placeholder="Filter by title, employer or place" aria-label="Filter by title, employer or place" style="max-width:300px">
      <select name="band" aria-label="Level" style="width:150px" data-on="change" data-act="filterchange"><option value="">Any level</option>${Object.entries(BAND).map(([k, v]) => html`<option value="${k}" ${q.band === k ? 'selected' : ''}>${v}</option>`)}</select>
      <select name="minfit" aria-label="Fit" style="width:130px" data-on="change" data-act="filterchange"><option value="">Any fit</option>${[60, 70, 80, 90].map(n => html`<option value="${n}" ${q.minfit == n ? 'selected' : ''}>Fit ${n} and up</option>`)}</select>
      <button class="btn sm">Filter</button>
      ${q.q || q.band || q.minfit || q.company || closedOn || q.stage ? html`<a class="btn sm ghost" href="#/roles">Clear</a>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn sm" data-act="showadd">Add a role yourself</button>
    </form>
    <form data-act="add" id="addrole" hidden class="col" style="gap:8px;border-top:1px solid var(--line2);padding-top:10px">
      <div class="grid3"><label class="field">Employer<input type="text" name="company" required></label><label class="field">Job title<input type="text" name="title" required></label><label class="field">Place<input type="text" name="location"></label></div>
      <label class="field">Link to the posting<input type="url" name="url" placeholder="https://"></label>
      <label class="field">The posting's text <span class="h">Paste it so Job Hunt can read it against your CV.</span><textarea name="description" rows="4"></textarea></label>
      <div class="row"><button class="btn p sm">Add and read it</button></div>
    </form></div>`;
}

function table(d, route) {
  if (!d.roles.length) return html`<div class="card empty"><h3>No roles here</h3><p>${route.q.q || route.q.band || route.q.minfit ? 'Nothing matches these filters.' : 'Roles appear as Job Hunt finds them. The freshest come first.'}</p></div>`;
  const open = d.roles.filter(r => !r.closed), mine = open.filter(r => picked.has(String(r.id)));
  const toPrepare = mine.filter(r => r.stage === 'found' && !r.preparing).length;
  return html`${mine.length ? html`<div class="bulk"><b>${mine.length} ticked</b>
      ${toPrepare ? html`<button class="btn sm p" data-act="bulk" data-do="prepare" data-busy="Starting…" title="Tailors your CV and writes the letter for each ticked role that isn't prepared yet.">Prepare ${toPrepare}</button>` : ''}
      <button class="btn sm" data-act="bulk" data-do="applied" title="Marks every ticked role as applied.">I applied</button>
      <button class="btn sm danger" data-act="bulk" data-do="no" data-confirm="Not interested in these ${mine.length} roles? They will never be shown again.">Not for me</button>
      <span class="grow"></span><button class="btn sm ghost" data-act="unpick">Clear ticks</button></div>` : ''}
    <div class="card" style="padding:0"><table class="tbl">
    <thead><tr><th class="pick" style="width:34px"><input type="checkbox" data-on="change" data-act="pickall" ${open.length && open.every(r => picked.has(String(r.id))) ? 'checked' : ''} ${open.length ? '' : 'disabled'} aria-label="Tick every open role on this page" title="Tick every open role on this page"></th><th>${sortHead('Role', 'title', route, 'age')} · ${sortHead('Employer', 'company', route, 'age')}</th><th>${sortHead('Fit now', 'fit', route, 'age')} · Tailored</th><th>${sortHead('Posted', 'age', route, 'age')}</th><th>${sortHead('Applicants', 'applicants', route, 'age')}</th><th>${sortHead('Stage', 'stage', route, 'age')}</th><th></th></tr></thead>
    <tbody>${d.roles.map(r => html`<tr class="${picked.has(String(r.id)) ? 'sel' : ''}"><td class="pick">${r.closed ? '' : html`<input type="checkbox" data-on="change" data-act="pick" data-id="${r.id}" ${picked.has(String(r.id)) ? 'checked' : ''} aria-label="Tick ${r.title}">`}</td>
      <td><div class="row">${tile(r.company, true, r.company_id)}<div class="grow"><a class="t" href="#/roles/${r.id}">${r.title}</a><span class="s m">${employer(r.company, r.company_id)}${r.location ? html` · ${r.location}` : ''}${r.workplace ? html` · ${r.workplace}` : ''}${r.pay ? html` · <b style="font-weight:600;color:var(--ink2)" title="${r.pay}">${shortPay(r.pay)}</b>` : ''}${BAND[r.band] && r.band !== 'level' ? html` · <b>${BAND[r.band]}</b>` : ''}</span></div></div></td>
      <td>${rings(r.fit, r.fit_tailored, true)}</td>
      <td>${freshness(r, true)}</td>
      <td class="s">${r.applicants >= 0 ? html`<b style="${r.applicants < 10 ? 'color:var(--hot)' : 'font-weight:500'}">${r.applicants}</b>${r.applicants < 10 ? html` <span class="xs" style="color:var(--hot)">be early</span>` : ''}` : html`<span class="m">–</span>`}</td>
      <td>${stageChip(r)}${r.preparing ? html` <span class="chip blue"><span class="spin" style="width:10px;height:10px"></span>Preparing</span>` : ''}${r.closed === 'screened' ? html`<div class="xs m" style="margin-top:3px">${r.closed_why}</div>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${r.closed ? (r.closed !== 'no' ? html`<button class="btn sm" data-act="reopen" data-id="${r.id}">Bring back</button>` : html`<button class="btn sm ghost" data-act="reopen" data-id="${r.id}" data-confirm="Bring this role back? You said you weren't interested.">Bring back</button>`) : r.stage === 'ready' ? html`<a class="btn sm p" href="#/roles/${r.id}">Review and apply</a>` : html`<a class="btn sm" href="#/roles/${r.id}">Open</a>`}</td>
    </tr>`)}</tbody></table></div>${pager(d.total, d.page, d.size, route)}`;
}

function board(d) {
  return html`<div class="kan">${STAGES.map(s => html`<div><div class="colh"><h4>${STAGE[s]}</h4><span class="chip">${d.counts[s] || 0}</span></div>
    ${(d[s] || []).map(r => html`<a class="kc" href="#/roles/${r.id}"><b class="s" style="display:block">${r.title}</b><span class="xs m">${r.company}</span><div class="row" style="margin-top:6px;justify-content:space-between">${freshness(r)}<b class="s" style="color:${fitColor(Math.max(r.fit, r.fit_tailored))}">${Math.max(r.fit, r.fit_tailored) >= 0 ? Math.max(r.fit, r.fit_tailored) : ''}</b></div></a>`)}
    ${(d.counts[s] || 0) > (d[s] || []).length ? html`<a class="s" href="${href('roles', { stage: s })}" style="padding-left:4px">${(d.counts[s] || 0) - d[s].length} more</a>` : ''}
    ${!(d[s] || []).length ? html`<p class="xs m" style="padding:0 4px">Nothing here yet.</p>` : ''}</div>`)}</div>`;
}

export default {
  title: 'Roles',
  sub: (d, route) => route.parts[1] === 'board' ? 'Where every role stands' : 'Everything Job Hunt found, freshest first',
  topics: ['roles'],
  sized: true,
  load: route => route.parts[1] === 'board' ? api('board') : api('roles?' + query(route)),
  view(d, route) {
    const isBoard = route.parts[1] === 'board';
    return html`<div class="body">
      <div class="tabs"><a class="${isBoard ? '' : 'on'}" href="#/roles">List</a><a class="${isBoard ? 'on' : ''}" href="#/roles/board">Board</a></div>
      ${isBoard ? board(d) : html`${filters(d, route)}${table(d, route)}`}</div>`;
  },
  actions: {
    pick({ d, value }) { value ? picked.add(d.id) : picked.delete(d.id); redraw(); return false; },
    pickall({ value }) { document.querySelectorAll('.tbl td.pick input').forEach(i => (value ? picked.add(i.dataset.id) : picked.delete(i.dataset.id))); redraw(); return false; },
    unpick() { picked.clear(); redraw(); return false; },
    async bulk({ d, data }) {
      const mine = data.roles.filter(r => !r.closed && picked.has(String(r.id)) && (d.do !== 'prepare' || (r.stage === 'found' && !r.preparing)) && (d.do !== 'applied' || !r.applied_at));
      for (const r of mine) await post(`roles/${r.id}/${d.do}`);
      picked.clear();
      toast({ prepare: `Preparing ${mine.length}. Each takes about a minute.`, applied: `${mine.length} marked as applied`, no: `${mine.length} won't be shown again` }[d.do]);
    },
    filter({ f, route }) { location.hash = with_(route, { q: f.q.trim(), band: f.band, minfit: f.minfit, page: '' }); return false; },
    filterchange({ el, route }) { const f = Object.fromEntries(new FormData(el.form)); location.hash = with_(route, { q: f.q.trim(), band: f.band, minfit: f.minfit, page: '' }); return false; },
    showadd() { const f = document.getElementById('addrole'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); return false; },
    async add({ f }) { const r = await post('roles', f); toast('Added. Job Hunt is reading it.'); location.hash = `#/roles/${r.id}`; return false; },
    reopen: ({ d }) => post(`roles/${d.id}/reopen`).then(() => toast('Brought back')),
  },
};
