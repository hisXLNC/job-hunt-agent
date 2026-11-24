import { html, api, post, put, ago, until, when, rings, tile, toast, listSize, endless, sortHead, with_, href, freshness, BAND, employer, rel, soon, dayName } from '../app.js';

const BOARD = { greenhouse: 'Its own board (Greenhouse)', lever: 'Its own board (Lever)', ashby: 'Its own board (Ashby)', smartrecruiters: 'Its own board (SmartRecruiters)', workday: 'Its own board (Workday)', workable: 'Its own board (Workable)', bamboohr: 'Its own board (BambooHR)', recruitee: 'Its own board (Recruitee)', page: 'Its own careers page' };

function run(r) {
  const s = r.stats || {}, kind = r.kind === 'search:fast' ? 'Quick check' : 'Full search';
  const probs = s.problems || [];
  return html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:74px;flex:none;padding-top:1px">${rel(r.started_at)}</span>
    <span class="grow s"><b>${kind}</b>${r.state === 'running' ? html` <span class="chip blue">running</span>` : html`: ${s.seen || 0} postings in ${s.looked || 0} places, <b>${s.new || 0} new</b>, ${s.cleared || 0} set aside by the rules, ${s.kept || 0} worth a look${s.prepared ? html`, ${s.prepared} prepared` : ''}.`}
      ${probs.length ? html`<details style="margin-top:2px"><summary class="xs" style="color:var(--warn)">${probs.length} place${probs.length === 1 ? '' : 's'} didn't answer</summary><div class="xs m pre">${probs.join('\n')}</div></details>` : ''}</span></div>`;
}

// Where Job Hunt looks besides employers' own boards. Each place has a
// switch; the ones the person added can be taken off the list.
function placesCard(pv) {
  if (!pv) return '';
  const row = p => html`<div class="row top-al" style="gap:10px">
    <button class="switch ${p.on ? 'on' : ''}" role="switch" aria-checked="${p.on ? 'true' : 'false'}" aria-label="Search ${p.name}" data-act="placeon" data-id="${p.id}" data-to="${p.on ? '' : '1'}" style="margin-top:2px"></button>
    <div class="grow"><div class="s"><b>${p.name}</b> <span class="m">· ${p.kind === 'Search' ? 'every title' : p.kind}</span></div>
      <div class="xs m">${p.note ? html`<span style="color:var(--warn)">${p.note}${p.rest_until ? html`. Trying again ${soon(p.rest_until)}` : ''}</span>` : p.on ? (p.seen ? html`${p.seen} postings last full search, ${p.new} new` : p.about) : 'Off'}</div></div>
    ${p.mine ? html`<button class="btn sm ghost" data-act="placeoff" data-id="${p.id}" data-confirm="Stop watching ${p.name}? Roles already found there stay.">Remove</button>` : ''}</div>`;
  return html`<div class="card"><h4>Searches, job sites and recruiters</h4><p class="xs m" style="margin-top:3px">Switch each on or off, or add your own. Job sites and recruiters are asked on full searches only, slowly. <a href="#/you/connections">More job sources</a> take a key.</p>
    <div class="col" style="margin-top:10px;gap:10px">${pv.places.map(row)}</div>
    <form data-act="addplace" data-busy="Trying it…" class="col" style="margin-top:12px;gap:6px"><label class="field">Add a job site or recruiter <span class="h">The page that lists the jobs. Put {title} where its search takes a job title.</span>
      <input type="text" name="url" placeholder="https://example.com/jobs?q={title}" required></label><div class="row"><button class="btn sm">Watch this site</button></div></form>
    ${pv.suggested?.length ? html`<details style="margin-top:10px"><summary class="s">${pv.suggested.length} recruiters and job sites you could add</summary>
      <div class="col" style="margin-top:8px;gap:8px">${pv.suggested.map(p => html`<div class="row top-al" style="gap:10px"><div class="grow"><div class="s"><b>${p.name}</b> <span class="m">· ${p.kind}</span></div><div class="xs m">${p.about}</div></div><button class="btn sm" data-act="addknown" data-id="${p.id}" data-busy="Trying it…">Add</button></div>`)}</div></details>` : ''}
    ${pv.browser ? '' : html`<p class="xs m" style="margin-top:8px">Some sites only open in a real browser. Job Hunt found neither Edge nor Chrome on this computer, so those will not answer.</p>`}</div>`;
}
// Every kind of place Job Hunt looks, and how each did the last time it was asked.
const SRC_STATE = { working: ['good', 'Working'], problem: ['crit', 'Problem'], off: ['', 'Off'], none: ['', 'Not set up'], waiting: ['blue', 'Not run yet'] };
function sourcesCard(list) {
  if (!list?.length) return '';
  const none = html`<span class="m">–</span>`;
  return html`<div class="card" style="padding:0" id="sources"><div class="row" style="padding:14px 16px 10px"><h3 class="grow">Where Job Hunt looks</h3><span class="s m">Every kind of source, and how each did last time</span></div>
    <table class="tbl"><thead><tr><th>Source</th><th>State</th><th>Last looked</th><th>Postings then</th></tr></thead>
    <tbody>${list.map(s => { const [tone, word] = SRC_STATE[s.state] || SRC_STATE.none; return html`<tr><td class="s"><b>${s.name}</b>${s.what ? html` <span class="m">· ${s.what}</span>` : ''}
        ${s.note || s.setup ? html`<div class="xs" style="margin-top:2px;color:var(--${s.state === 'problem' ? 'crit' : 'muted'})">${s.note}${s.setup ? html` <a href="${s.setup}">Set it up</a>` : ''}</div>` : ''}${s.failed?.length ? html`<details style="margin-top:3px"><summary class="xs" style="color:var(--warn)">${s.failed.length} didn't answer: which</summary><div class="xs m pre" style="margin-top:3px">${s.failed.join('\n')}</div></details>` : ''}</td>
      <td><span class="chip ${tone}">${word}</span></td><td class="s" style="white-space:nowrap">${s.at ? ago(s.at) : none}</td>
      <td class="s" style="white-space:nowrap">${s.at ? html`<b>${s.seen}</b> <span class="m">· ${s.new} new</span>` : none}</td></tr>`; })}</tbody></table></div>`;
}
// One line on how the sources are doing, with a way to the list.
function health(list) {
  if (!list?.length) return '';
  const bad = list.filter(s => s.state === 'problem' || s.failed?.length), ok = list.filter(s => s.state === 'working').length;
  return html`<div style="margin-top:4px">${bad.length ? html`<b style="color:var(--crit)">${bad.length === 1 ? `${bad[0].name} isn't working` : `${bad.length} sources aren't working`}.</b> ` : ok ? html`<span style="color:var(--good)">Every source answered last time.</span> ` : ''}<button class="link s" data-act="tosources">See where Job Hunt looks</button></div>`;
}
const tried = r => toast(r.found ? `Watching ${r.place.name}: it showed ${r.found} posting${r.found === 1 ? '' : 's'} just now` : `Watching ${r.place.name}, but it ${r.note || 'showed nothing just now'}`);

export default {
  title: 'Radar',
  sub: () => 'What Job Hunt watches, and what just appeared',
  topics: ['roles', 'companies', 'runs', 'status'],
  async load(route) {
    const q = route.q, u = new URLSearchParams({ size: listSize('radar'), page: 1, sort: q.sort || '', state: q.state || 'following', q: q.q || '' });
    const [radar, comp, places, src] = await Promise.all([api('radar'), api('companies?' + u), api('places'), api('sources').catch(() => null)]);
    return { ...radar, comp, places, sources: src?.sources };
  },
  view(d, route) {
    const st = d.status, c = d.comp, state = route.q.state || 'following';
    const titles = [...(d.titles.level || []).map(t => [t, 'level']), ...(d.titles.step_up || []).map(t => [t, 'step_up']), ...(d.titles.sideways || []).map(t => [t, 'sideways'])];
    return html`<div class="body">
      <div class="card row wrap" style="gap:18px">
        <div><div class="eb">Watching</div><div class="big">${st.sources}</div><div class="xs m">sources</div></div>
        <div class="grow s ink2" style="min-width:300px">Full searches run at the times you set; in between, Job Hunt keeps checking for postings under two hours old, so you can be among the first ten applicants. <a href="#/you/connections">Change the times</a>.
          <div style="margin-top:4px">${st.paused ? html`<b style="color:var(--warn)">Searching is paused${st.paused_until ? html` until ${dayName(st.paused_until)}, then starts again by itself` : ''}.</b>` : html`Next quick check <b>${soon(st.next_fast)}</b> · next full search <b>${soon(st.next_full)}</b>`}${d.search.last_full ? html` · last full search ${rel(d.search.last_full)}` : ''}${d.unread ? html` · ${d.unread} new roles waiting to be read` : ''}</div>
          ${d.search.linkedin_note ? html`<div style="color:var(--warn);margin-top:2px">${d.search.linkedin_note}</div>` : ''}${health(d.sources)}</div>
        <div class="row"><button class="btn p" data-act="search" data-kind="full">Search now</button>${st.paused ? html`<button class="btn" data-act="pause" data-paused="">Resume searching</button>` : html`<select class="mini" style="max-width:150px" aria-label="Pause searching" data-on="change" data-act="pausefor" title="Stops the searches Job Hunt runs by itself. Search now still works."><option value="">Pause…</option><option value="0">Until I turn it back on</option><option value="1">For a day</option><option value="3">For 3 days</option><option value="7">For a week</option><option value="14">For two weeks</option></select>`}</div>
      </div>
      <div class="cols wide">
        <div class="col" style="gap:14px">
          <div class="card"><div class="row"><h3 class="grow">Fresh now</h3><span class="s m">Posted or first seen in the last two days</span></div>
            ${d.fresh?.length ? html`<div class="col" style="margin-top:12px;gap:12px">${d.fresh.map(r => html`<div class="row">${tile(r.company, true, r.company_id)}<div class="grow"><a href="#/roles/${r.id}"><b>${r.title}</b></a><div class="s m">${employer(r.company, r.company_id)}${r.location ? html` · ${r.location}` : ''}${BAND[r.band] && r.band !== 'level' ? html` · <b>${BAND[r.band]}</b>` : ''}</div><div>${freshness(r)}</div></div>${rings(r.fit, r.fit_tailored, true)}<a class="btn sm ${r.stage === 'ready' ? 'p' : ''}" href="#/roles/${r.id}">${r.stage === 'ready' ? 'Review and apply' : 'Open'}</a></div>`)}</div>`
              : html`<p class="s m" style="margin-top:8px">Nothing new in the last two days that fits. ${d.cleared} postings have been set aside by the rules so far; see them under <a href="${href('roles', { closed: 'screened' })}">Roles → Set aside</a>.</p>`}</div>
          ${sourcesCard(d.sources)}
          <div class="card" style="padding:0"><div class="row" style="padding:14px 16px 10px"><h3 class="grow">Employers</h3>
              <a class="chip ${state === 'following' ? 'on' : ''}" href="${with_(route, { state: ''})}">Watching</a>
              <a class="chip ${state === 'suggested' ? 'on' : ''}" href="${with_(route, { state: 'suggested'})}">Seen in searches ${c.suggested}</a>
              <a class="chip ${state === 'muted' ? 'on' : ''}" href="${with_(route, { state: 'muted'})}">Muted ${c.muted}</a>
              <form data-act="filter" class="row" style="gap:6px"><input type="text" name="q" value="${route.q.q || ''}" placeholder="Filter employers" aria-label="Filter employers" style="width:170px;height:30px"><button class="btn sm">Filter</button></form></div>
            <table class="tbl emp long"><thead><tr><th>${sortHead('Employer', 'name', route, 'open')}</th><th>Where it posts</th><th>${sortHead('Open roles', 'open', route, 'open')}</th><th>${sortHead('Best fit', 'fit', route, 'open')}</th><th>${sortHead('People', 'people', route, 'open')}</th><th></th></tr></thead>
            <tbody>${c.companies.map(x => html`<tr class="${x.about ? 'has-about' : ''}"><td><div class="row">${tile(x.name, true, x.id)}<div><a class="t" href="#/employer/${x.id}" title="Opens ${x.name}: its postings, your history there, people, and what working there is like.">${x.name}</a><span class="xs m">${x.sector || x.why}</span></div></div></td>
              <td class="s">${BOARD[x.board_kind] || html`<span class="m">${x.board_note || 'LinkedIn search'}</span>`}</td>
              <td class="s"><b>${x.open_roles}</b>${x.applied ? html` <span class="m">· ${x.applied} applied</span>` : ''}</td><td class="s">${x.best_fit > 0 ? x.best_fit : html`<span class="m">–</span>`}</td>
              <td class="s">${x.people ? html`${x.people}${x.know_you ? html` <b style="color:var(--good)">· ${x.know_you} know you</b>` : ''}` : html`<span class="m">–</span>`}</td>
              <td style="text-align:right;white-space:nowrap">${x.state === 'following' ? html`<button class="btn sm ghost" data-act="state" data-id="${x.id}" data-state="muted">Mute</button>` : html`<button class="btn sm" data-act="state" data-id="${x.id}" data-state="following">Watch</button>`}</td></tr>
              ${x.about ? html`<tr class="about"><td colspan="6" class="s ink2">${x.about}</td></tr>` : ''}`)}
              ${!c.companies.length ? html`<tr><td colspan="6" class="s m" style="padding:22px;text-align:center">No employers here.</td></tr>` : ''}</tbody></table>
            <div style="padding:0 14px 12px">${endless('radar', (c.companies || []).length, c.total)}</div></div>
        </div>
        <div class="col" style="gap:14px">
          <div class="card"><h4>Add an employer</h4><form data-act="addco" class="col" style="margin-top:8px;gap:8px"><label class="field">Name<input type="text" name="name" required></label>
            <label class="field">Careers page <span class="h">Optional. Job Hunt works out where they post.</span><input type="url" name="site" placeholder="https://"></label>
            <div class="row"><button class="btn sm p">Watch this employer</button><button type="button" class="btn sm" data-act="more">Suggest more</button></div></form></div>
          ${placesCard(d.places)}
          <div class="card"><div class="row"><h4 class="grow">Titles searched</h4><a class="s" href="#/you">Change</a></div>
            <p class="xs m" style="margin-top:3px">Every title is searched equally often, a step up and sideways included.</p>
            <div class="row wrap" style="margin-top:8px;gap:6px">${titles.map(([t, b]) => html`<span class="chip ${b === 'step_up' ? 'blue' : b === 'sideways' ? 'info' : ''}" title="${BAND[b]}">${t}</span>`)}</div>
            ${d.avoid?.length ? html`<p class="xs m" style="margin-top:8px">Never shown: ${d.avoid.join(', ')}</p>` : ''}</div>
          <div class="card"><h4>Recent searches</h4><div class="col" style="margin-top:10px;gap:10px">${(d.runs || []).filter(r => r.kind.startsWith('search')).slice(0, 5).map(run)}${!(d.runs || []).some(r => r.kind.startsWith('search')) ? html`<span class="s m">No search has run yet.</span>` : ''}</div></div>
        </div></div></div>`;
  },
  actions: {
    tosources() { document.getElementById('sources')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return false; },
    search: ({ d }) => post('search', { kind: d.kind }).then(() => toast('Searching. New roles appear as they are read.')),
    pause: ({ d }) => post('pause', { paused: !!d.paused }),
    pausefor: ({ value }) => value === '' ? false : post('pause', { paused: true, days: +value }),
    filter({ f, route }) { location.hash = with_(route, { q: f.q.trim()}); return false; },
    state: ({ d }) => put(`companies/${d.id}`, { state: d.state }),
    addco: ({ f, el }) => post('companies', f).then(() => { el.reset(); toast('Watching it from now on'); }),
    placeon: ({ d }) => post('places/switch', { id: d.id, on: !!d.to }),
    placeoff: ({ d }) => post('places/remove', { id: d.id }),
    addplace: ({ f, el }) => post('places', { url: f.url }).then(r => { el.reset(); tried(r); }),
    addknown: ({ d }) => post('places', { id: d.id }).then(tried),
    more: () => post('companies/more').then(() => toast('Looking for more employers that hire people like you')),
  },
};
void when;
