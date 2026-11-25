import { html, api, post, put, ago, until, when, clock, rings, tile, toast, listSize, endless, sortHead, with_, href, freshness, BAND, employer, rel, soon, dayName } from '../app.js';

const BOARD = { greenhouse: 'Its own board (Greenhouse)', lever: 'Its own board (Lever)', ashby: 'Its own board (Ashby)', smartrecruiters: 'Its own board (SmartRecruiters)', workday: 'Its own board (Workday)', workable: 'Its own board (Workable)', bamboohr: 'Its own board (BambooHR)', recruitee: 'Its own board (Recruitee)', page: 'Its own careers page' };

function run(r) {
  const s = r.stats || {}, kind = r.kind === 'search:fast' ? 'Quick check' : 'Full search';
  const probs = s.problems || [];
  return html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:74px;flex:none;padding-top:1px">${rel(r.started_at)}</span>
    <span class="grow s"><b>${kind}</b>${r.state === 'running' ? html` <span class="chip blue">running</span>` : html`: ${s.seen || 0} postings in ${s.looked || 0} places, <b>${s.new || 0} new</b>, ${s.cleared || 0} set aside by the rules, ${s.kept || 0} worth a look${s.prepared ? html`, ${s.prepared} prepared` : ''}.`}
      ${probs.length ? html`<details style="margin-top:2px"><summary class="xs" style="color:var(--warn)">${probs.length} place${probs.length === 1 ? '' : 's'} didn't answer</summary><div class="xs m pre">${probs.join('\n')}</div></details>` : ''}</span></div>`;
}

// Every place Job Hunt looks, worst first, with its switch and what to do about it.
const SRC_STATE = { problem: ['crit', 'Not working'], working: ['good', 'Working'], waiting: ['blue', 'Not run yet'], off: ['', 'Off'], none: ['', 'Not set up'] };
const ORDER = { problem: 0, working: 2, waiting: 3, off: 4, none: 5 };
const bad = s => s.state === 'problem' || !!s.failed?.length;
function sourcesCard(list, pv, route) {
  if (!list?.length) return '';
  const none = html`<span class="m">–</span>`;
  const place = id => (pv?.places || []).find(p => p.id === id);
  const sites = (pv?.places || []).filter(p => p.kind !== 'Search');
  const rows = [...list].sort((a, b) => (bad(a) ? 0 : ORDER[a.state] ?? 6) - (bad(b) ? 0 : ORDER[b.state] ?? 6));
  const sw = p => p ? html`<button class="switch ${p.on ? 'on' : ''}" role="switch" aria-checked="${p.on ? 'true' : 'false'}" aria-label="Search ${p.name}" data-act="placeon" data-id="${p.id}" data-to="${p.on ? '' : '1'}"></button>` : '';
  const act = s => html`${s.at && s.id !== 'alerts' ? html`<a class="btn sm ghost" href="${with_(route, { src: s.id, show: '' })}" title="Every posting it gave last time: new, already here, or skipped and why.">Postings</a> ` : ''}${s.setup ? html`<a class="btn sm" href="${s.setup}">Set it up</a>`
    : s.failed?.length ? html`<button class="btn sm p" data-act="showfailed" data-id="${s.id}">Fix the ${s.failed.length}</button>`
    : s.state === 'problem' ? html`<button class="btn sm p" data-act="search" data-kind="fast" title="Asks again now, with a quick check.">Try now</button>` : ''}`;
  const adding = route.q.add === '1';
  return html`<div class="card" style="padding:0" id="sources">
    <div class="row wrap" style="padding:12px 16px;gap:8px"><span class="grow s m">Every place Job Hunt looks, worst first. A switch turns one off.</span>
      <a class="btn sm ${adding ? 'on' : ''}" href="${with_(route, { add: adding ? '' : '1' })}">Add a job site or recruiter</a>
      ${pv?.suggested?.length ? html`<a class="btn sm ghost" href="${with_(route, { add: '1' })}">${pv.suggested.length} suggested</a>` : ''}</div>
    ${adding ? addSite(pv) : ''}
    <table class="tbl"><thead><tr><th style="width:52px"></th><th>Source</th><th>State</th><th>Last looked</th><th>Postings then</th><th></th></tr></thead>
    <tbody>${rows.map(s => { const [tone, word] = bad(s) ? SRC_STATE.problem : SRC_STATE[s.state] || SRC_STATE.none, p = place(s.id); return html`<tr>
      <td>${sw(p)}</td>
      <td class="s"><b>${s.name}</b>${s.what ? html` <span class="m">· ${s.what}</span>` : ''}
        ${s.failed?.length ? html`<div class="xs" style="margin-top:2px;color:var(--crit)">${s.failed.length} didn't answer: ${s.failed.map(f => f.split(': ')[0]).join(', ')}</div>
          <div class="xs m pre" id="failed-${s.id}" hidden style="margin-top:4px">${s.failed.join('\n')}
Each employer's page has its careers page address, which you can correct.</div>`
          : s.note ? html`<div class="xs" style="margin-top:2px;color:var(--${s.state === 'problem' ? 'crit' : 'muted'})">${s.note}</div>` : ''}
        ${s.id === 'sites' && sites.length ? html`<div class="col" style="margin-top:6px;gap:5px">${sites.map(x => html`<div class="row xs" style="gap:8px">${sw(x)}<span class="grow"><b>${x.name}</b> <span class="m">· ${x.kind}${x.note ? html` · <span style="color:var(--warn)">${x.note}</span>` : x.seen ? ` · ${x.seen} postings last time` : ''}</span></span>${x.mine ? html`<button class="btn sm ghost" data-act="placeoff" data-id="${x.id}" data-confirm="Stop watching ${x.name}? Roles already found there stay.">Remove</button>` : ''}</div>`)}</div>` : ''}</td>
      <td><span class="chip ${tone}">${word}</span></td><td class="s" style="white-space:nowrap">${s.at ? ago(s.at) : none}</td>
      <td class="s" style="white-space:nowrap">${s.at ? html`<b>${s.seen}</b> <span class="m">· ${s.new} new</span>` : none}</td>
      <td style="text-align:right;white-space:nowrap">${act(s)}</td></tr>`; })}</tbody></table>
    ${pv && !pv.browser ? html`<p class="xs m" style="padding:10px 16px">Some sites only open in a real browser. Job Hunt found neither Edge nor Chrome on this computer, so those will not answer.</p>` : ''}</div>`;
}
// Every posting one source gave the last time it was asked, and what became of each.
const SHOW = [['', 'All'], ['new', 'New'], ['here', 'Already here'], ['skipped', 'Skipped']];
const SAY_TONE = { new: 'good', here: '', skipped: 'warn' };
function sourcePostings(sp, route) {
  const show = route.q.show || '', c = sp.counts || {};
  const all = (c.new || 0) + (c.here || 0) + (c.skipped || 0);
  return html`<div class="col" style="gap:14px" id="srcposts"><div class="stick"><div class="card row wrap" style="gap:6px;padding:12px 14px"><a class="btn sm ghost" href="${with_(route, { src: '', show: '' })}">← All sources</a><b class="grow" style="margin-left:6px">${sp.name}</b>
      ${SHOW.map(([k, v]) => html`<a class="chip ${show === k ? 'on' : ''}" href="${with_(route, { show: k })}">${v} ${k ? c[k] || 0 : all}</a>`)}</div></div>
    <div class="card" style="padding:0"><p class="s m" style="padding:12px 16px">${sp.at ? html`Every posting it gave in the ${sp.run === 'fast' ? 'quick check' : 'full search'} ${rel(sp.at)}, and what Job Hunt did with each. The fit is from reading it against your CV.${sp.kept < sp.total ? ` The first ${sp.kept.toLocaleString()} of ${sp.total.toLocaleString()} are kept.` : ''}` : 'No search has asked it since Job Hunt began keeping this list. It fills in after the next search.'}</p>
    ${sp.postings.length ? html`<table class="tbl long"><thead><tr><th>Posting</th><th>Seen through</th><th>Fit</th><th>What happened</th></tr></thead>
    <tbody>${sp.postings.map(x => html`<tr><td class="s">${x.role_id ? html`<a class="t" href="#/roles/${x.role_id}">${x.title}</a>` : html`<b>${x.title}</b>`}<div class="xs m">${x.company}${x.location ? ` · ${x.location}` : ''}</div></td>
      <td class="s m">${x.from || '–'}</td><td class="s">${x.fit >= 0 ? html`<b>${x.fit}</b>` : html`<span class="m">–</span>`}</td>
      <td class="s"><span class="chip ${SAY_TONE[x.outcome] ?? ''}">${x.saying}</span></td></tr>`)}</tbody></table>
    <div style="padding:0 14px 12px">${endless('srcposts', sp.postings.length, sp.shown)}</div>` : sp.at ? html`<p class="s m" style="padding:0 16px 16px">Nothing here.</p>` : ''}</div></div>`;
}
// Adding a job site or recruiter: your own address, or one of the suggested.
function addSite(pv) {
  return html`<div style="padding:4px 16px 14px;border-bottom:1px solid var(--line2)" class="col">
    <form data-act="addplace" data-busy="Trying it…" class="row wrap" style="gap:8px;align-items:end"><label class="field grow" style="min-width:320px">The page that lists the jobs <span class="h">Put {title} where its search takes a job title.</span>
      <input type="text" name="url" placeholder="https://example.com/jobs?q={title}" required></label><button class="btn sm p">Watch this site</button></form>
    ${pv?.suggested?.length ? html`<div class="eb" style="margin-top:14px">Suggested for you</div><div class="col" style="margin-top:6px;gap:8px">${pv.suggested.map(p => html`<div class="row top-al" style="gap:10px"><div class="grow"><div class="s"><b>${p.name}</b> <span class="m">· ${p.kind}</span></div><div class="xs m">${p.about}</div></div><button class="btn sm" data-act="addknown" data-id="${p.id}" data-busy="Trying it…">Add</button></div>`)}</div>` : ''}</div>`;
}
// One line on how the sources are doing, with a way to the list.
function health(list) {
  if (!list?.length) return '';
  const bad = list.filter(s => s.state === 'problem' || s.failed?.length), ok = list.filter(s => s.state === 'working').length;
  return html`<div>${bad.length ? html`<b style="color:var(--crit)">${bad.length === 1 ? `${bad[0].name} isn't working` : `${bad.length} sources aren't working`}.</b> ` : ok ? html`<span style="color:var(--good)">Every source answered last time.</span> ` : ''}<a class="s" href="#/radar?tab=sources">${bad.length ? 'See them' : 'See where Job Hunt looks'}</a></div>`;
}
const TABS = [['fresh', 'Fresh now'], ['sources', 'Sources'], ['employers', 'Employers'], ['titles', 'Titles']];
const tried = r => toast(r.found ? `Watching ${r.place.name}: it showed ${r.found} posting${r.found === 1 ? '' : 's'} just now` : `Watching ${r.place.name}, but it ${r.note || 'showed nothing just now'}`);

export default {
  title: 'Radar',
  sub: () => 'What Job Hunt watches, and what just appeared',
  topics: ['roles', 'companies', 'runs', 'status'],
  async load(route) {
    const q = route.q, u = new URLSearchParams({ size: listSize('radar'), page: 1, sort: q.sort || '', state: q.state || 'following', q: q.q || '' });
    const one = q.tab === 'sources' && q.src ? api(`sources/${encodeURIComponent(q.src)}/postings?` + new URLSearchParams({ size: listSize('srcposts'), show: q.show || '' })).catch(() => null) : null;
    const [radar, comp, places, src, ss, srcposts] = await Promise.all([api('radar'), api('companies?' + u), api('places'), api('sources').catch(() => null), api('searchset').catch(() => null), one]);
    return { ...radar, comp, places, sources: src?.sources, budget: ss?.budget, srcposts };
  },
  view(d, route) {
    const st = d.status, c = d.comp, state = route.q.state || 'following', tab = TABS.some(([k]) => k === route.q.tab) ? route.q.tab : 'fresh';
    const probs = (d.sources || []).filter(bad).length;
    const titles = [...(d.titles.level || []).map(t => [t, 'level']), ...(d.titles.step_up || []).map(t => [t, 'step_up']), ...(d.titles.sideways || []).map(t => [t, 'sideways'])];
    return html`<div class="body">
      <div class="card row wrap" style="gap:18px">
        <div><div class="eb">Watching</div><div class="big">${st.sources}</div><div class="xs m">sources</div></div>
        <div class="grow s ink2" style="min-width:300px">${health(d.sources)}
          <div style="margin-top:3px">${st.paused ? html`<b style="color:var(--warn)">Searching is paused${st.paused_until ? html` until ${dayName(st.paused_until)}, then starts again by itself` : ''}.</b>` : html`Next quick check <b>${soon(st.next_fast)}</b> · next full search <b>${soon(st.next_full)}</b>`}${d.search.last_full ? html` · last full search ${rel(d.search.last_full)}` : ''}${d.unread ? html` · ${d.unread} new roles waiting to be read` : ''}</div>
          ${d.search.linkedin_note ? html`<div style="color:var(--warn);margin-top:2px">${d.search.linkedin_note}</div>` : ''}</div>
        <div class="row"><button class="btn p" data-act="search" data-kind="full" title="Searches every source now, whatever the schedule says.">Search now</button><button class="btn ghost" data-act="force" data-confirm="Search every source now, whatever the schedule says, looking back a week instead of to the last search? Then the roles the rules set aside lately are checked again with your rules as they are now; reading those that pass takes one request to Claude each. Roles → Set aside says how many first." title="Looks back a week instead of to the last search, then checks the roles the rules set aside lately against your rules as they are now.">Search now, ignore the schedule</button>${st.paused ? html`<button class="btn" data-act="pause" data-paused="">Resume searching</button>` : html`<select class="mini" style="max-width:150px" aria-label="Pause searching" data-on="change" data-act="pausefor" title="Stops the searches Job Hunt runs by itself. Search now still works."><option value="">Pause…</option><option value="0">Until I turn it back on</option><option value="1">For a day</option><option value="3">For 3 days</option><option value="7">For a week</option><option value="14">For two weeks</option></select>`}</div>
      </div>
      ${d.budget?.run_at ? html`<div class="card row wrap" style="gap:10px"><span class="grow s"><b>Budget mode: ${d.budget.waiting} new posting${d.budget.waiting === 1 ? '' : 's'} wait to be read at ${clock(d.budget.run_at)}${d.budget.run_at - Date.now() / 1000 > 86400 ? ` on ${dayName(d.budget.run_at)}` : ''}.</b> <span class="m">A big batch is read at night, when it costs least.</span></span>
        <button class="btn sm p" data-act="budgetrun" data-busy="Starting…" title="Reads them now, against your CV.">Run now</button><button class="btn sm" data-act="budgetcancel" data-confirm="Set these ${d.budget.waiting} postings aside without reading them? Nothing is deleted: they stay under Roles, Set aside, and each can be brought back.">Cancel</button></div>` : ''}
      <div class="tabs">${TABS.map(([k, v]) => html`<a class="${k === tab ? 'on' : ''}" href="${href('radar', k === 'fresh' ? {} : { tab: k })}">${v}${k === 'fresh' && d.fresh?.length ? html` <span class="m">${d.fresh.length}</span>` : ''}${k === 'sources' && probs ? html` <span class="chip crit" style="margin-left:4px;padding:1px 7px">${probs}</span>` : ''}${k === 'employers' && c.following ? html` <span class="m">${c.following}</span>` : ''}</a>`)}</div>
      ${tab === 'sources' ? (d.srcposts ? sourcePostings(d.srcposts, route) : sourcesCard(d.sources, d.places, route)) : tab === 'employers' ? html`<div class="cols wide"><div class="col" style="gap:14px">
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
        </div><div class="col" style="gap:14px">
          <div class="card"><h4>Add an employer</h4><form data-act="addco" class="col" style="margin-top:8px;gap:8px"><label class="field">Name<input type="text" name="name" required></label>
            <label class="field">Careers page <span class="h">Optional. Job Hunt works out where they post.</span><input type="url" name="site" placeholder="https://"></label>
            <div class="row"><button class="btn sm p">Watch this employer</button><button type="button" class="btn sm" data-act="more">Suggest more</button></div></form></div>
        </div></div>` : tab === 'titles' ? html`<div class="cols wide"><div class="col" style="gap:14px">
          <div class="card"><div class="row"><h4 class="grow">Titles searched</h4><a class="s" href="#/you">Change</a></div>
            <p class="xs m" style="margin-top:3px">Every title is searched equally often, a step up and sideways included${d.searched_in?.length > 1 ? `, in each of ${d.searched_in.join(', ')}` : ''}.</p>
            <div class="row wrap" style="margin-top:8px;gap:6px">${titles.map(([t, b]) => html`<span class="chip ${b === 'step_up' ? 'blue' : b === 'sideways' ? 'info' : ''}" title="${BAND[b]}">${t}</span>`)}</div>
            ${d.avoid?.length ? html`<p class="xs m" style="margin-top:8px">Never shown: ${d.avoid.join(', ')}</p>` : ''}</div>
        </div><div class="col" style="gap:14px"><div class="card"><h4>When Job Hunt searches</h4><p class="s ink2" style="margin-top:6px">Full searches run at the times you set; in between, Job Hunt keeps checking for postings under two hours old, so you can be among the first ten applicants.</p><p class="s" style="margin-top:8px"><a href="#/you/connections">Change the times</a></p></div></div></div>` : html`<div class="cols wide"><div class="col" style="gap:14px">
          <div class="card"><div class="row"><h3 class="grow">Fresh now</h3><span class="s m">Posted or first seen in the last two days</span></div>
            ${d.fresh?.length ? html`<div class="col" style="margin-top:12px;gap:12px">${d.fresh.map(r => html`<div class="row">${tile(r.company, true, r.company_id)}<div class="grow"><a href="#/roles/${r.id}"><b>${r.title}</b></a><div class="s m">${employer(r.company, r.company_id)}${r.location ? html` · ${r.location}` : ''}${BAND[r.band] && r.band !== 'level' ? html` · <b>${BAND[r.band]}</b>` : ''}</div><div>${freshness(r)}</div></div>${rings(r.fit, r.fit_tailored, true)}<a class="btn sm ${r.stage === 'ready' ? 'p' : ''}" href="#/roles/${r.id}">${r.stage === 'ready' ? 'Review and apply' : 'Open'}</a></div>`)}</div>`
              : html`<p class="s m" style="margin-top:8px">Nothing new in the last two days that fits. ${d.cleared} postings have been set aside by the rules so far; see them under <a href="${href('roles', { closed: 'screened' })}">Roles → Set aside</a>.</p>`}</div>
        </div><div class="col" style="gap:14px">
          <div class="card"><h4>Recent searches</h4><div class="col" style="margin-top:10px;gap:10px">${(d.runs || []).filter(r => r.kind.startsWith('search')).slice(0, 5).map(run)}${!(d.runs || []).some(r => r.kind.startsWith('search')) ? html`<span class="s m">No search has run yet.</span>` : ''}</div></div>
        </div></div>`}
    </div>`;
  },
  actions: {
    showfailed({ d }) { const x = document.getElementById('failed-' + d.id); if (x) x.hidden = !x.hidden; return false; },
    search: ({ d }) => post('search', { kind: d.kind }).then(() => toast('Searching. New roles appear as they are read.')),
    force: () => post('search/force').then(() => toast('Searching every source, a week back. Then the set-aside roles are checked again.')),
    pause: ({ d }) => post('pause', { paused: !!d.paused }),
    pausefor: ({ value }) => value === '' ? false : post('pause', { paused: true, days: +value }),
    filter({ f, route }) { location.hash = with_(route, { q: f.q.trim()}); return false; },
    state: ({ d }) => put(`companies/${d.id}`, { state: d.state }),
    addco: ({ f, el }) => post('companies', f).then(() => { el.reset(); toast('Watching it from now on'); }),
    placeon: ({ d }) => post('places/switch', { id: d.id, on: !!d.to }),
    placeoff: ({ d }) => post('places/remove', { id: d.id }),
    addplace: ({ f, el }) => post('places', { url: f.url }).then(r => { el.reset(); tried(r); }),
    addknown: ({ d }) => post('places', { id: d.id }).then(tried),
    budgetrun: () => post('budget/run').then(() => toast('Reading them now. New roles appear as they are read.')),
    budgetcancel: () => post('budget/cancel').then(r => toast(`${r.set_aside} set aside unread. They are under Roles, Set aside.`)),
    more: () => post('companies/more').then(() => toast('Looking for more employers that hire people like you')),
  },
};
void when;
