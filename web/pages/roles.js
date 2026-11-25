import { html, api, post, rings, tile, toast, listSize, endless, sortHead, with_, href, stageChip, freshness, BAND, STAGE, CLOSED, fitColor, employer, shortPay, picked, redraw, LATER, dayName, applicantsText } from '../app.js';

const STAGES = ['found', 'ready', 'applied', 'reply', 'interview', 'offer'];

function query(route) {
  const q = route.q, u = new URLSearchParams({ size: listSize('roles'), page: 1, sort: q.sort || 'age' });
  for (const k of ['stage', 'closed', 'band', 'minfit', 'q', 'company', 'saved', 'later']) if (q[k]) u.set(k, q[k]);
  return u.toString();
}

function filters(d, route) {
  const q = route.q, c = d.counts || {};
  const open = STAGES.reduce((n, s) => n + (c[s] || 0), 0);
  const chip = (label, n, patch, on) => html`<a class="chip ${on ? 'on' : ''}" href="${with_(route, { stage: '', closed: '', later: '', ...patch })}">${label}${n !== undefined ? html` <span style="opacity:.7">${n}</span>` : ''}</a>`;
  const closedOn = q.closed && q.closed !== 'all', ended = q.closed === 'rejected,expired,withdrawn', down = c.taken_down || 0;
  return html`<div class="stick"><div class="card col" style="gap:10px;padding:12px 14px">
    <div class="row wrap" style="gap:6px">
      ${chip('All open', open, {}, !q.stage && !q.closed && !q.later)}
      ${STAGES.map(s => chip(STAGE[s], c[s] || 0, { stage: s }, q.stage === s))}
      ${c.later || q.later ? chip('Saved for later', c.later || 0, { later: 1 }, !!q.later) : ''}
      <span class="m">|</span>
      ${chip('Set aside', c['closed:screened'] || 0, { closed: 'screened' }, q.closed === 'screened')}
      ${chip('Not interested', c['closed:no'] || 0, { closed: 'no' }, q.closed === 'no')}
      ${chip('Ended', (c['closed:rejected'] || 0) + (c['closed:expired'] || 0) + (c['closed:withdrawn'] || 0), { closed: 'rejected,expired,withdrawn' }, ended)}
      ${q.closed === 'screened' && d.rescore ? again(d.rescore) : ''}
      ${ended ? html`<span class="grow"></span><button class="btn sm" data-act="tidy" ${down ? '' : 'disabled'} data-confirm="Close ${down} role${down === 1 ? '' : 's'} whose posting is gone? Only roles you never prepared or applied to. Nothing is deleted: they are kept here, under Ended."
        title="Closes open roles whose posting was taken down, or that no search has seen for a month, and that you never prepared or applied to. Roles you applied to or prepared keep everything. ${down ? '' : 'There is nothing to clear right now.'}">Clear taken-down roles${down ? html` <span style="opacity:.7">${down}</span>` : ''}</button>` : ''}
    </div>
    <form data-act="filter" class="row" style="gap:8px">
      <input type="text" name="q" value="${q.q || ''}" placeholder="Filter by title, employer or place" aria-label="Filter by title, employer or place" style="max-width:300px">
      <select name="band" aria-label="Level" style="width:150px" data-on="change" data-act="filterchange"><option value="">Any level</option>${Object.entries(BAND).map(([k, v]) => html`<option value="${k}" ${q.band === k ? 'selected' : ''}>${v}</option>`)}</select>
      <select name="minfit" aria-label="Fit" style="width:130px" data-on="change" data-act="filterchange"><option value="">Any fit</option>${[60, 70, 80, 90].map(n => html`<option value="${n}" ${q.minfit == n ? 'selected' : ''}>Fit ${n} and up</option>`)}</select>
      <button class="btn sm">Filter</button>
      ${q.q || q.band || q.minfit || q.company || closedOn || q.stage || q.later ? html`<a class="btn sm ghost" href="#/roles">Clear</a>` : ''}
      <span class="grow"></span>
      <a class="btn sm" href="/api/roles.csv" download title="Every role Job Hunt knows, as a file a spreadsheet opens.">Save as a spreadsheet</a><a class="btn sm" href="/api/recruiters.csv" download title="Recruiters and hiring managers with their e-mail, phone and LinkedIn, as a file a spreadsheet opens.">Recruiters as a spreadsheet</a><button type="button" class="btn sm" data-act="showadd">Add a role yourself</button>
    </form></div>${bulk(d)}</div>
    <form data-act="add" id="addrole" hidden class="card col" style="gap:8px;padding:12px 14px">
      <div class="grid3"><label class="field">Employer<input type="text" name="company" required></label><label class="field">Job title<input type="text" name="title" required></label><label class="field">Place<input type="text" name="location"></label></div>
      <label class="field">Link to the posting<input type="url" name="url" placeholder="https://"></label>
      <label class="field">The posting's text <span class="h">Paste it so Job Hunt can read it against your CV.</span><textarea name="description" rows="4"></textarea></label>
      <div class="row"><button class="btn p sm">Add and read it</button></div>
    </form>`;
}

// Score again: the roles set aside lately, against the rules, CVs and settings
// as they are now, with what it costs said first. Roles said no to are never among them.
function again(rs) {
  const fetch = rs.fetch ? `, and ${rs.fetch} posting${rs.fetch === 1 ? '' : 's'} fetched again from ${rs.fetch === 1 ? 'its site' : 'their sites'}` : '';
  const reqs = n => `about ${n} request${n === 1 ? '' : 's'} to Claude`;
  return html`<span class="grow"></span>
    <button class="btn sm" data-act="rescore" ${rs.pass ? '' : 'disabled'} data-busy="Starting…" data-confirm="${rs.pass} of the ${rs.by_rules} roles the rules set aside in the last ${rs.days} days pass the rules as they are now. Reading them takes ${reqs(rs.requests)}${fetch}. Roles that fit come back; the rest stay set aside."
      title="Checks the roles the rules set aside in the last ${rs.days} days against your rules as they are now, which costs nothing, and reads the ones that now pass: ${reqs(rs.requests)}.">Score again${rs.pass ? html` <span style="opacity:.7">${rs.pass}</span>` : ''}</button>
    <button class="btn sm" data-act="rescore" data-all="1" ${rs.pass + rs.by_claude ? '' : 'disabled'} data-busy="Starting…" data-confirm="Read again the ${rs.pass + rs.by_claude} roles set aside in the last ${rs.days} days that pass the rules, including the ${rs.by_claude} Claude set aside? It takes ${reqs(rs.requests_all)}${fetch}."
      title="Also reads again the roles Claude set aside after reading them: ${reqs(rs.requests_all)}.">Score all again</button>
    <button class="btn sm ghost" data-act="force" data-busy="Starting…" data-confirm="Search every source now, whatever the schedule says, looking back a week instead of to the last search? Then the roles the rules set aside are checked again (${reqs(rs.requests)}, as well as reading what the search finds)."
      title="Searches now, looking back a week, then scores the set-aside roles again with today's rules.">Search now, ignore the schedule</button>`;
}

// What can be done to every ticked role in one go; it stays in view with the filters.
function bulk(d) {
  const mine = (d.roles || []).filter(r => !r.closed && picked.has(String(r.id)));
  if (!mine.length) return '';
  const toPrepare = mine.filter(r => r.stage === 'found' && !r.preparing).length;
  return html`<div class="bulk" style="margin-top:8px"><b>${mine.length} ticked</b>
      ${toPrepare ? html`<button class="btn sm p" data-act="bulk" data-do="prepare" data-busy="Starting…" title="Tailors your CV and writes the letter for each ticked role that isn't prepared yet.">Prepare ${toPrepare}</button>` : ''}
      <button class="btn sm" data-act="bulk" data-do="applied" title="Marks every ticked role as applied.">I applied</button>
      <button class="btn sm danger" data-act="bulk" data-do="no" data-confirm="Not interested in these ${mine.length} roles? They will never be shown again.">Not for me</button>
      <span class="grow"></span><button class="btn sm ghost" data-act="unpick">Clear ticks</button></div>`;
}

function table(d, route) {
  if (!d.roles.length) return html`<div class="card empty"><h3>No roles here</h3><p>${route.q.later ? 'Nothing is saved for later.' : route.q.q || route.q.band || route.q.minfit ? 'Nothing matches these filters.' : 'Roles appear as Job Hunt finds them. The freshest come first.'}</p></div>`;
  const open = d.roles.filter(r => !r.closed);
  return html`    <div class="card" style="padding:0"><table class="tbl long">
    <thead><tr><th class="pick" style="width:34px"><input type="checkbox" data-on="change" data-act="pickall" ${open.length && open.every(r => picked.has(String(r.id))) ? 'checked' : ''} ${open.length ? '' : 'disabled'} aria-label="Tick every open role in this list" title="Tick every open role in this list"></th><th>${sortHead('Role', 'title', route, 'age')} · ${sortHead('Employer', 'company', route, 'age')}</th><th>${sortHead('Fit now', 'fit', route, 'age')} · Tailored</th><th>${sortHead('Posted', 'age', route, 'age')}</th><th>${sortHead('Applicants', 'applicants', route, 'age')}</th><th>${sortHead('Stage', 'stage', route, 'age')}</th><th></th></tr></thead>
    <tbody>${d.roles.map(r => html`<tr class="${picked.has(String(r.id)) ? 'sel' : ''}"><td class="pick">${r.closed ? '' : html`<input type="checkbox" data-on="change" data-act="pick" data-id="${r.id}" ${picked.has(String(r.id)) ? 'checked' : ''} aria-label="Tick ${r.title}">`}</td>
      <td><div class="row">${tile(r.company, true, r.company_id)}<div class="grow"><a class="t" href="#/roles/${r.id}">${r.title}</a><span class="s m">${employer(r.company, r.company_id)}${r.rating ? html` <span class="xs" title="What employees rate ${r.company}, out of 5">★ ${r.rating.toFixed(1)}</span>` : ''}${r.location ? html` · ${r.location}` : ''}${r.workplace ? html` · ${r.workplace}` : ''}${r.pay ? html` · <b style="font-weight:600;color:var(--ink2)" title="${r.pay}">${shortPay(r.pay)}</b>` : ''}${BAND[r.band] && r.band !== 'level' ? html` · <b>${BAND[r.band]}</b>` : ''}${r.path ? html` <span class="chip ${r.path === 'on' ? 'good' : ''}" style="padding:0 7px" title="${r.path === 'on' ? 'Moves you along the career path you want' : 'Leads away from the career path you want'}">${r.path === 'on' ? 'On path' : 'Off path'}</span>` : ''}</span></div></div></td>
      <td>${rings(r.fit, r.fit_tailored, true)}</td>
      <td>${freshness(r, true)}</td>
      <td class="s">${r.applicants >= 0 ? html`<b style="${r.applicants < 10 ? 'color:var(--hot)' : 'font-weight:500'}">${applicantsText(r.applicants)}</b>${r.applicants < 10 ? html` <span class="xs" style="color:var(--hot)">be early</span>` : ''}` : html`<span class="m">–</span>`}</td>
      <td>${stageChip(r)}${r.preparing ? html` <span class="chip blue"><span class="spin" style="width:10px;height:10px"></span>Preparing</span>` : ''}${r.closed === 'screened' ? html`<div class="xs m" style="margin-top:3px">${r.closed_why}</div>` : ''}${!r.closed && r.later_until > d.now ? html`<div class="xs m" style="margin-top:3px" title="Saved for later. It comes back to Today by itself.">Later · back ${dayName(r.later_until)}</div>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${r.closed ? (r.closed !== 'no' ? html`<button class="btn sm" data-act="reopen" data-id="${r.id}">Bring back</button>` : html`<button class="btn sm ghost" data-act="reopen" data-id="${r.id}" data-confirm="Bring this role back? You said you weren't interested.">Bring back</button>`) : r.stage === 'ready' ? html`<a class="btn sm p" href="#/roles/${r.id}">Review and apply</a>` : html`<a class="btn sm" href="#/roles/${r.id}">Open</a>`}${r.closed ? '' : rowMenu(r, d.now)}</td>
    </tr>`)}</tbody></table>${endless('roles', d.roles.length, d.total)}</div>`;
}

// Putting a row away for a few days, behind the three dots.
function rowMenu(r, now) {
  return html`<details class="menu" style="display:inline-block;vertical-align:middle;text-align:left"><summary aria-label="More for ${r.title}" title="More: save this role for later.">⋯</summary><div>
    ${r.later_until > now ? html`<button data-act="later" data-id="${r.id}" data-days="0">Bring back to Today</button>` : ''}
    <span class="mh" style="${r.later_until > now ? '' : 'border-top:0;margin-top:0'}">Save for later</span>${LATER.map(([days, label]) => html`<button data-act="later" data-id="${r.id}" data-days="${days}" title="Leaves Today and comes back by itself.">${label}</button>`)}</div></details>`;
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
  async load(route) {
    if (route.parts[1] === 'board') return api('board');
    const [d, rescore] = await Promise.all([api('roles?' + query(route)), route.q.closed === 'screened' ? api('rescore').catch(() => null) : null]);
    return { ...d, rescore };
  },
  view(d, route) {
    const isBoard = route.parts[1] === 'board';
    return html`<div class="body">
      <div class="tabs"><a class="${isBoard ? '' : 'on'}" href="#/roles">List</a><a class="${isBoard ? 'on' : ''}" href="#/roles/board">Board</a></div>
      ${isBoard ? board(d) : html`${filters(d, route)}${table(d, route)}`}</div>`;
  },
  // Sent here by the "Send to Job Hunt" bookmark (add=link) or by a job link the
  // person copied (add=copied): the add form opens filled in. What came from the
  // other page only fills the boxes; nothing is added until the person presses Add.
  after(root, d, route) {
    const how = route.q.add;
    if ((how !== 'link' && how !== 'copied') || route.addDone) return;
    route.addDone = true;
    const f = root.querySelector('#addrole');
    if (!f) return;
    f.hidden = false;
    const q = route.q;
    const set = (n, v) => { if (v && !f.elements[n].value) f.elements[n].value = String(v).slice(0, n === 'description' ? 60000 : 300); };
    const fill = async url => {
      set('url', url); set('title', q.title); set('company', q.company); set('description', q.text);
      history.replaceState(null, '', '#/roles');
      f.scrollIntoView({ block: 'start' });
      if (!url || q.text) return;
      const note = document.createElement('p');
      note.className = 'xs m';
      note.textContent = 'Reading the posting…';
      f.prepend(note);
      try {
        const p = await post('peek', { url });
        set('title', p.title); set('company', p.company); set('location', p.location); set('description', p.description);
        note.textContent = p.known ? 'Job Hunt already has this role; adding it again opens it.' : 'Read from the posting. Check the boxes and press Add.';
      } catch (e) { note.textContent = e.message; }
    };
    if (how === 'copied') api('copied').then(r => fill(r.url)).catch(() => {}); else fill(q.url);
  },
  actions: {
    pick({ d, value }) { value ? picked.add(d.id) : picked.delete(d.id); redraw(); return false; },
    pickall({ value }) { document.querySelectorAll('.tbl td.pick input').forEach(i => (value ? picked.add(i.dataset.id) : picked.delete(i.dataset.id))); redraw(); return false; },
    unpick() { picked.clear(); redraw(); return false; },
    async bulk({ d, data }) {
      const mine = data.roles.filter(r => !r.closed && picked.has(String(r.id)) && (d.do !== 'prepare' || (r.stage === 'found' && !r.preparing)) && (d.do !== 'applied' || !r.applied_at));
      for (const r of mine) await post(`roles/${r.id}/${d.do}`);
      picked.clear();
      const back = { applied: 'unapply', no: 'reopen' }[d.do];
      toast({ prepare: `Preparing ${mine.length}. Each takes about a minute.`, applied: `${mine.length} marked as applied`, no: `${mine.length} won't be shown again` }[d.do], false,
        back && mine.length ? async () => { for (const r of mine) await post(`roles/${r.id}/${back}`); } : undefined);
    },
    later: ({ d }) => post(`roles/${d.id}/later`, { days: +d.days }).then(() => toast({ 0: 'Back on Today', 1: 'Saved for later. Back tomorrow.', 3: 'Saved for later. Back in 3 days.', 7: 'Saved for later. Back next week.' }[d.days], false, +d.days ? () => post(`roles/${d.id}/later`, { days: 0 }) : undefined)),
    async tidy() { const r = await post('roles/tidy'); toast(r.closed ? `${r.closed} closed. They are kept here, under Ended.` : 'Nothing to clear'); },
    filter({ f, route }) { location.hash = with_(route, { q: f.q.trim(), band: f.band, minfit: f.minfit}); return false; },
    filterchange({ el, route }) { const f = Object.fromEntries(new FormData(el.form)); location.hash = with_(route, { q: f.q.trim(), band: f.band, minfit: f.minfit}); return false; },
    showadd() { const f = document.getElementById('addrole'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); return false; },
    async add({ f }) { const r = await post('roles', f); toast('Added. Job Hunt is reading it.'); location.hash = `#/roles/${r.id}`; return false; },
    reopen: ({ d }) => post(`roles/${d.id}/reopen`).then(() => toast('Brought back')),
    rescore: ({ d }) => post('rescore', { all: !!d.all }).then(() => toast('Scoring them again. Those that fit come back as they are read.')),
    force: () => post('search/force').then(() => toast('Searching every source, a week back. Then the set-aside roles are checked again.')),
  },
};
