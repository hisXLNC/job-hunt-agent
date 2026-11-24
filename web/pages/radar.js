import { html, api, post, put, ago, until, when, rings, tile, toast, pager, sortHead, with_, href, freshness, BAND } from '../app.js';

const BOARD = { greenhouse: 'Its own board (Greenhouse)', lever: 'Its own board (Lever)', ashby: 'Its own board (Ashby)', smartrecruiters: 'Its own board (SmartRecruiters)', workday: 'Its own board (Workday)' };

function run(r) {
  const s = r.stats || {}, kind = r.kind === 'search:fast' ? 'Quick check' : 'Full search';
  const probs = s.problems || [];
  return html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:74px;flex:none;padding-top:1px">${ago(r.started_at)}</span>
    <span class="grow s"><b>${kind}</b>${r.state === 'running' ? html` <span class="chip blue">running</span>` : html`: ${s.seen || 0} postings in ${s.looked || 0} places, <b>${s.new || 0} new</b>, ${s.cleared || 0} set aside by the rules, ${s.kept || 0} worth a look${s.prepared ? html`, ${s.prepared} prepared` : ''}.`}
      ${probs.length ? html`<details style="margin-top:2px"><summary class="xs" style="color:var(--warn)">${probs.length} place${probs.length === 1 ? '' : 's'} didn't answer</summary><div class="xs m pre">${probs.join('\n')}</div></details>` : ''}</span></div>`;
}

export default {
  title: 'Radar',
  sub: () => 'What Job Hunt watches, and what just appeared',
  topics: ['roles', 'companies', 'runs', 'status'],
  async load(route) {
    const q = route.q, u = new URLSearchParams({ size: 8, page: q.page || 1, sort: q.sort || '', state: q.state || 'following', q: q.q || '' });
    const [radar, comp] = await Promise.all([api('radar'), api('companies?' + u)]);
    return { ...radar, comp };
  },
  view(d, route) {
    const st = d.status, c = d.comp, state = route.q.state || 'following';
    const titles = [...(d.titles.level || []).map(t => [t, 'level']), ...(d.titles.step_up || []).map(t => [t, 'step_up']), ...(d.titles.sideways || []).map(t => [t, 'sideways'])];
    return html`<div class="body">
      <div class="card row wrap" style="gap:18px">
        <div><div class="eb">Watching</div><div class="big">${st.sources}</div><div class="xs m">sources</div></div>
        <div class="grow s ink2" style="min-width:300px">A full search runs three times a day. In between, Job Hunt checks every 20 minutes for postings under two hours old, so you can be among the first ten applicants.
          <div style="margin-top:4px">${st.paused ? html`<b style="color:var(--warn)">Searching is paused.</b>` : html`Next quick check <b>${until(st.next_fast)}</b> · next full search <b>${until(st.next_full)}</b>`}${d.search.last_full ? html` · last full search ${ago(d.search.last_full)}` : ''}${d.unread ? html` · ${d.unread} new roles waiting to be read` : ''}</div>
          ${d.search.linkedin_note ? html`<div style="color:var(--warn);margin-top:2px">${d.search.linkedin_note}</div>` : ''}</div>
        <div class="row"><button class="btn p" data-act="search" data-kind="full">Search now</button><button class="btn" data-act="pause" data-paused="${st.paused ? '' : '1'}">${st.paused ? 'Resume searching' : 'Pause'}</button></div>
      </div>
      <div class="cols wide">
        <div class="col" style="gap:14px">
          <div class="card"><div class="row"><h3 class="grow">Fresh now</h3><span class="s m">Posted or first seen in the last two days</span></div>
            ${d.fresh?.length ? html`<div class="col" style="margin-top:12px;gap:12px">${d.fresh.map(r => html`<div class="row">${tile(r.company, true)}<div class="grow"><a href="#/roles/${r.id}"><b>${r.title}</b></a><div class="s m">${r.company}${r.location ? html` · ${r.location}` : ''}${BAND[r.band] && r.band !== 'level' ? html` · <b>${BAND[r.band]}</b>` : ''}</div><div>${freshness(r)}</div></div>${rings(r.fit, r.fit_tailored, true)}<a class="btn sm ${r.stage === 'ready' ? 'p' : ''}" href="#/roles/${r.id}">${r.stage === 'ready' ? 'Review and apply' : 'Open'}</a></div>`)}</div>`
              : html`<p class="s m" style="margin-top:8px">Nothing new in the last two days that fits. ${d.cleared} postings have been set aside by the rules so far; see them under <a href="${href('roles', { closed: 'screened' })}">Roles → Set aside</a>.</p>`}</div>
          <div class="card" style="padding:0"><div class="row" style="padding:14px 16px 10px"><h3 class="grow">Employers</h3>
              <a class="chip ${state === 'following' ? 'on' : ''}" href="${with_(route, { state: '', page: '' })}">Watching</a>
              <a class="chip ${state === 'suggested' ? 'on' : ''}" href="${with_(route, { state: 'suggested', page: '' })}">Seen in searches ${c.suggested}</a>
              <a class="chip ${state === 'muted' ? 'on' : ''}" href="${with_(route, { state: 'muted', page: '' })}">Muted ${c.muted}</a>
              <form data-act="filter" class="row" style="gap:6px"><input type="text" name="q" value="${route.q.q || ''}" placeholder="Filter employers" aria-label="Filter employers" style="width:170px;height:30px"><button class="btn sm">Filter</button></form></div>
            <table class="tbl emp"><thead><tr><th>${sortHead('Employer', 'name', route, 'open')}</th><th>Where it posts</th><th>${sortHead('Open roles', 'open', route, 'open')}</th><th>${sortHead('Best fit', 'fit', route, 'open')}</th><th>${sortHead('People', 'people', route, 'open')}</th><th></th></tr></thead>
            <tbody>${c.companies.map(x => html`<tr class="${x.about ? 'has-about' : ''}"><td><div class="row">${tile(x.name, true)}<div><a class="t" href="${href('roles', { company: x.id, closed: 'all' })}">${x.name}</a><span class="xs m">${x.sector || x.why}</span></div></div></td>
              <td class="s">${BOARD[x.board_kind] || html`<span class="m">${x.board_note || 'LinkedIn search'}</span>`}</td>
              <td class="s"><b>${x.open_roles}</b>${x.applied ? html` <span class="m">· ${x.applied} applied</span>` : ''}</td><td class="s">${x.best_fit > 0 ? x.best_fit : html`<span class="m">–</span>`}</td>
              <td class="s">${x.people ? html`${x.people}${x.know_you ? html` <b style="color:var(--good)">· ${x.know_you} know you</b>` : ''}` : html`<span class="m">–</span>`}</td>
              <td style="text-align:right;white-space:nowrap">${x.state === 'following' ? html`<button class="btn sm ghost" data-act="state" data-id="${x.id}" data-state="muted">Mute</button>` : html`<button class="btn sm" data-act="state" data-id="${x.id}" data-state="following">Watch</button>`}</td></tr>
              ${x.about ? html`<tr class="about"><td colspan="6" class="s ink2">${x.about}</td></tr>` : ''}`)}
              ${!c.companies.length ? html`<tr><td colspan="6" class="s m" style="padding:22px;text-align:center">No employers here.</td></tr>` : ''}</tbody></table>
            <div style="padding:0 14px 12px">${pager(c.total, c.page, c.size, route)}</div></div>
        </div>
        <div class="col" style="gap:14px">
          <div class="card"><h4>Add an employer</h4><form data-act="addco" class="col" style="margin-top:8px;gap:8px"><label class="field">Name<input type="text" name="name" required></label>
            <label class="field">Careers page <span class="h">Optional. Job Hunt works out where they post.</span><input type="url" name="site" placeholder="https://"></label>
            <div class="row"><button class="btn sm p">Watch this employer</button><button type="button" class="btn sm" data-act="more">Suggest more</button></div></form></div>
          <div class="card"><div class="row"><h4 class="grow">Titles searched</h4><a class="s" href="#/you">Change</a></div>
            <p class="xs m" style="margin-top:3px">Every title is searched equally often, a step up and sideways included.</p>
            <div class="row wrap" style="margin-top:8px;gap:6px">${titles.map(([t, b]) => html`<span class="chip ${b === 'step_up' ? 'blue' : b === 'sideways' ? 'info' : ''}" title="${BAND[b]}">${t}</span>`)}</div>
            ${d.avoid?.length ? html`<p class="xs m" style="margin-top:8px">Never shown: ${d.avoid.join(', ')}</p>` : ''}</div>
          <div class="card"><h4>Recent searches</h4><div class="col" style="margin-top:10px;gap:10px">${(d.runs || []).filter(r => r.kind.startsWith('search')).slice(0, 5).map(run)}${!(d.runs || []).some(r => r.kind.startsWith('search')) ? html`<span class="s m">No search has run yet.</span>` : ''}</div></div>
        </div></div></div>`;
  },
  actions: {
    search: ({ d }) => post('search', { kind: d.kind }).then(() => toast('Searching. New roles appear as they are read.')),
    pause: ({ d }) => post('pause', { paused: !!d.paused }),
    filter({ f, route }) { location.hash = with_(route, { q: f.q.trim(), page: '' }); return false; },
    state: ({ d }) => put(`companies/${d.id}`, { state: d.state }),
    addco: ({ f, el }) => post('companies', f).then(() => { el.reset(); toast('Watching it from now on'); }),
    more: () => post('companies/more').then(() => toast('Looking for more employers that hire people like you')),
  },
};
void when;
