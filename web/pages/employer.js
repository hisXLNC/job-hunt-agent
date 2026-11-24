import { html, api, post, put, tile, toast, day, ago, safeUrl, href, with_, fitColor, stageChip, shortPay, rowsThatFit, KIND } from '../app.js';

// One employer: its postings, what you sent there, who you know, what working there is like.
const WHERE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site' };
const short = t => ago(t).replace(/ ago$/, '');
const pair = r => (r.fit >= 0 ? html`<span class="fitpair" title="Fit now, then with your tailored CV"><b style="color:${fitColor(r.fit)}">${r.fit}</b><span class="m">→</span>${r.fit_tailored >= 0 ? html`<b style="color:${fitColor(r.fit_tailored)}">${r.fit_tailored}</b>` : html`<span class="m">–</span>`}</span>` : html`<span class="m" title="Not read against your CV yet">–</span>`);
const k = n => '$' + Math.round(n / 1000) + 'k';
const stars = r => html`<span class="stars" title="${r.rating.toFixed(1)} of 5 from public employee reviews">★ ${r.rating.toFixed(1)}</span>`;

function postings(d, route) {
  const q = route.q, all = d.roles || [];
  const applied = all.filter(r => r.applied_at > 0), open = all.filter(r => r.open), earlier = all.filter(r => !r.open);
  let rows = q.show === 'open' ? open : q.show === 'applied' ? applied : q.show === 'earlier' ? earlier : all;
  rows = rows.filter(r => (!q.where || r.workplace === q.where) && (!q.type || (r.job_type || '').startsWith(q.type)));
  const SORT = { fit: r => -Math.max(r.fit, r.fit_tailored), posted: r => -(r.posted_at || r.first_seen_at), pay: r => -(r.pay_year || 0), applicants: r => (r.applicants >= 0 ? r.applicants : 1e9), role: r => r.title.toLowerCase() };
  const by = SORT[q.sort];
  if (by) { const dir = q.dir === 'up' ? -1 : 1; rows = rows.map((r, i) => [by(r), i, r]).sort((a, b) => (a[0] < b[0] ? -dir : a[0] > b[0] ? dir : a[1] - b[1])).map(x => x[2]); }
  const size = rowsThatFit(560, 37, 5, 15), page = Math.max(1, +q.page || 1), shown = rows.slice((page - 1) * size, page * size);
  const wide = window.innerWidth >= 1280;
  const chip = (key, label, n) => html`<a class="chip ${(q.show || '') === key ? 'on' : ''}" href="${with_(route, { show: key, page: '' })}">${label} ${n}</a>`;
  const th = (key, label, w) => html`<th style="${w ? `width:${w}` : ''}"><a class="${q.sort === key ? 'on' : ''}" href="${with_(route, { sort: key, dir: q.sort === key && q.dir !== 'up' ? 'up' : '', page: '' })}">${label}${q.sort === key ? (q.dir === 'up' ? ' ▲' : ' ▼') : ''}</a></th>`;
  const sel = (name, label, opts) => html`<select name="${name}" aria-label="${label}" data-on="change" data-act="filter" class="mini"><option value="">${label}: any</option>${opts.map(([v, t]) => html`<option value="${v}" ${q[name] == v ? 'selected' : ''}>${t}</option>`)}</select>`;
  const types = [...new Set(all.map(r => (r.job_type || '').split(',')[0]).filter(Boolean))];
  return html`<div class="card span" style="padding:0">
    <div class="row wrap" style="padding:8px 14px;gap:6px"><h4 class="grow">Postings</h4>${chip('', 'All', all.length)}${chip('open', 'Open', open.length)}${chip('applied', 'Applied', applied.length)}${chip('earlier', 'Earlier', earlier.length)}
      ${sel('where', 'Where', Object.entries(WHERE))}${types.length ? sel('type', 'Type', types.map(t => [t, t])) : ''}</div>
    <table class="tbl today"><thead><tr>${th('role', 'Role')}${wide ? html`<th style="width:15%">Part of the company</th>` : ''}<th style="width:68px">Where</th><th style="width:104px">Type</th>${th('pay', 'Pay', '118px')}${th('fit', 'Fit', '76px')}${th('posted', 'Posted', '70px')}${th('applicants', 'Applicants', '90px')}<th style="width:158px">Where it stands</th></tr></thead>
      <tbody>${shown.length ? shown.map(r => html`<tr><td><a class="t" href="#/roles/${r.id}" title="${r.title}">${r.title}</a></td>${wide ? html`<td class="ink2" title="${r.division}">${r.division || ''}</td>` : ''}
        <td>${WHERE[r.workplace] || ''}</td><td>${r.job_type || ''}</td><td title="${r.pay}">${shortPay(r.pay) || html`<span class="m">Not named</span>`}</td><td>${pair(r)}</td>
        <td title="${day(r.posted_at || r.first_seen_at)}">${short(r.posted_at || r.first_seen_at)}</td><td>${r.applicants >= 0 ? html`<span style="${r.applicants < 10 ? 'color:var(--hot);font-weight:600' : ''}">${r.applicants}</span>` : html`<span class="m">—</span>`}</td>
        <td>${r.gone_at && !r.closed ? html`<span class="chip">Taken down</span>` : r.applied_at && !r.closed && r.stage === 'applied' ? html`<span class="chip blue">Applied ${day(r.applied_at)}</span>` : stageChip(r)}</td></tr>`)
        : html`<tr><td colspan="9"><div class="empty" style="padding:22px"><h3>${all.length ? 'Nothing matches' : 'No postings seen yet'}</h3><p>${all.length ? html`<a href="${href(route.parts.join('/'))}">Show all</a>` : 'When this employer posts something that could suit you, it shows up here.'}</p></div></td></tr>`}</tbody></table>
    <div class="row xs m" style="padding:6px 14px;border-top:1px solid var(--line2)">${rows.length ? html`${(page - 1) * size + 1} to ${Math.min(page * size, rows.length)} of ${rows.length}` : ''}<span class="grow"></span>
      ${page > 1 ? html`<a class="btn sm" href="${with_(route, { page: page - 1 })}">Previous</a>` : ''}${page * size < rows.length ? html`<a class="btn sm" href="${with_(route, { page: page + 1 })}">Next</a>` : ''}</div></div>`;
}

function history(d) {
  const h = d.history || [];
  const go = x => (x.mail_id ? `#/replies/${x.mail_id}` : x.talk_id ? `#/interviews/${x.talk_id}` : x.role_id ? `#/roles/${x.role_id}` : '');
  return html`<div class="card" style="padding:0"><div class="row" style="padding:8px 14px"><h4 class="grow">Your history here</h4><span class="xs m">${h.length ? html`${d.applied} application${d.applied === 1 ? '' : 's'} · ${d.talks} interview${d.talks === 1 ? '' : 's'} · first contact ${day(h[h.length - 1].at)}` : ''}</span></div>
    ${h.length ? h.slice(0, 8).map(x => html`<div class="hrow"><span class="xs m">${day(x.at)}</span><span><span class="chip ${x.tone || ''}">${x.kind}</span></span><a class="t" href="${go(x)}" title="${x.title}">${x.title}</a><span class="xs m" title="${x.detail}">${x.detail}</span></div>`)
      : html`<p class="s m" style="padding:2px 14px 12px">Nothing yet. Applications, their replies and interviews with this employer are listed here as they happen.</p>`}
    ${h.length > 8 ? html`<div class="xs m" style="padding:5px 14px;border-top:1px solid var(--line2)">and ${h.length - 8} earlier</div>` : ''}</div>`;
}

function people(d) {
  const c = d.company, ps = d.people || [];
  return html`<div class="card" style="padding:0"><div class="row" style="padding:8px 14px"><h4 class="grow">People here</h4><a class="btn sm" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.name)}" target="_blank" rel="noopener noreferrer" title="Opens LinkedIn's people search for this employer in your browser.">Find more people here ↗</a></div>
    ${ps.length ? ps.slice(0, 6).map(p => html`<div class="prow"><a class="t" href="#/people/${p.id}">${p.name}</a><span class="ink2" title="${p.title}">${p.title}</span><span><span class="chip">${KIND[p.kind] || 'Contact'}</span></span><span class="xs m" title="${p.why}">${p.why}</span><a class="btn sm" href="#/people/${p.id}">${p.state === 'drafted' ? 'Note drafted' : 'Open'}</a></div>`)
      : html`<p class="s m" style="padding:2px 14px 12px">Nobody yet. People Job Hunt finds at this employer, and anyone who writes to you from there, are listed here.</p>`}
    ${ps.length > 6 ? html`<a class="xs" style="display:block;padding:5px 14px;border-top:1px solid var(--line2)" href="${href('people', { q: c.name })}">All ${ps.length} people</a>` : ''}</div>`;
}

function reviews(d) {
  const r = d.reviews, has = r && (r.rating > 0 || r.likes?.length || r.warns?.length || r.sources?.length);
  const button = d.looking ? html`<span class="btn sm" disabled><span class="spin"></span>Reading</span>` : d.can_look ? html`<button class="btn sm" data-act="look" title="Claude reads public employee reviews of this employer and sums them up. About a minute.">${r ? 'Look again' : 'Look it up'}</button>` : html`<a class="btn sm" href="#/you/connections">Connect Claude</a>`;
  return html`<div class="card col" style="gap:7px;padding:10px 14px"><div class="row"><h4 class="grow">What working there is like</h4>${button}</div>
    ${has ? html`<div class="row wrap" style="gap:6px">${r.rating > 0 ? stars(r) : ''}${r.count ? html`<span class="xs m">${r.count.toLocaleString()} reviews</span>` : ''}${(r.sources || []).map(s => (safeUrl(s.url) ? html`<a class="chip" href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${s.name}${s.rating ? ` ${s.rating.toFixed(1)} of 5` : ''} ↗</a>` : html`<span class="chip">${s.name}${s.rating ? ` ${s.rating.toFixed(1)} of 5` : ''}</span>`))}</div>
      <div class="likewarn s"><div><b style="color:var(--good)">People like</b>${(r.likes || []).map(x => html`<div class="ink2">${x}</div>`)}</div><div><b style="color:var(--warn)">People warn about</b>${(r.warns || []).map(x => html`<div class="ink2">${x}</div>`)}</div></div>
      ${r.note ? html`<div class="s ink2">${r.note}</div>` : ''}<div class="xs m">Claude's summary of public employee reviews, read ${day(r.at)}.</div>`
      : html`<p class="s m">${r ? html`Nothing public could be found about working here (looked ${day(r.at)}).` : d.looking ? 'Claude is reading public employee reviews now.' : 'Not looked up yet. Claude can read what employees say in public and sum it up.'}</p>`}</div>`;
}

export default {
  title: d => d.company.name,
  sub: () => 'Employer',
  topics: ['companies', 'roles', 'people', 'mail', 'talks', 'status'],
  load: route => api('companies/' + route.parts[1]),
  view(d, route) {
    const c = d.company, site = d.site, careers = safeUrl(c.site) || (site ? 'https://' + site : '');
    const facts = [c.sector, site, d.pay_high ? `pays ${d.pay_low === d.pay_high ? k(d.pay_high) : k(d.pay_low) + ' to ' + k(d.pay_high)}` : ''].filter(Boolean).join(' · ');
    const stat = (n, label) => html`<div class="row" style="gap:5px"><b style="font-size:16px">${n}</b><span class="xs m">${label}</span></div>`;
    return html`<div class="body emp-page">
      <div class="card span row wrap" style="gap:12px;padding:10px 14px">${tile(c.name, 'big', c.id)}
        <div class="grow" style="min-width:220px"><div class="row wrap" style="gap:8px"><h3 style="font-size:17px">${c.name}</h3>${c.state === 'following' ? html`<span class="chip good">Watching</span>` : c.state === 'muted' ? html`<span class="chip crit">Never shown</span>` : html`<span class="chip">Seen in searches</span>`}${d.reviews?.rating > 0 ? html`${stars(d.reviews)}${d.reviews.count ? html`<span class="xs m">${d.reviews.count.toLocaleString()} employee reviews</span>` : ''}` : ''}</div>
          <div class="xs m" style="margin-top:1px">${facts || c.why}</div></div>
        <div class="row wrap" style="gap:14px">${stat(d.open, 'open for you')}${stat(d.applied, d.applied === 1 ? 'application' : 'applications')}${stat(d.talks, d.talks === 1 ? 'interview' : 'interviews')}${stat((d.people || []).length, 'people')}</div>
        <div class="row" style="gap:6px">${careers ? html`<a class="btn sm" href="${careers}" target="_blank" rel="noopener noreferrer">Their site ↗</a>` : ''}
          ${c.state === 'following' ? html`<button class="btn sm" data-act="state" data-state="suggested" title="Job Hunt stops checking this employer's own careers page. Roles found through searches still show.">Stop watching</button>` : html`<button class="btn sm" data-act="state" data-state="following" title="Job Hunt checks this employer's own careers page on every search.">Watch</button>`}
          ${c.state === 'muted' ? '' : html`<button class="btn sm danger" data-act="state" data-state="muted" data-confirm="Never show roles from ${c.name}? Roles already in your list stay; new ones are set aside." title="New roles from this employer are set aside.">Never show</button>`}</div></div>
      ${postings(d, route)}
      <div class="col" style="gap:10px;min-width:0">${history(d)}${people(d)}
        <form class="card col" data-act="note" style="gap:6px;padding:10px 14px"><div class="row"><h4 class="grow">Your notes</h4><button class="btn sm">Save</button></div>
          <textarea name="text" rows="3" aria-label="Your notes about this employer" placeholder="Anything you want to remember about this employer. Only you see it; Claude reads it when writing for roles here.">${d.notes || ''}</textarea></form></div>
      <div class="col" style="gap:10px;min-width:0">
        <div class="card col" style="gap:5px;padding:10px 14px"><div class="row"><h4 class="grow">About</h4><span class="xs m">${{ you: 'in your words', site: 'from their site', posting: 'from their postings', claude: 'from Claude' }[c.about_from] || ''}</span></div>
          <p class="s ink2">${c.about || c.why || 'Nothing known yet. Job Hunt fills this in from the employer\'s site and postings.'}</p>
          ${(d.divisions || []).length ? html`<div class="row wrap" style="gap:5px"><span class="xs m">Hiring in</span>${d.divisions.map(x => html`<span class="chip">${x}</span>`)}</div>` : ''}</div>
        ${reviews(d)}
        <div class="card col" style="gap:4px;padding:10px 14px"><h4>Lately</h4>
          ${(d.signals || []).length ? d.signals.map(x => html`<div class="row s top-al" style="gap:8px"><span class="xs m" style="width:46px;flex:none;padding-top:1px">${day(x.at)}</span><span class="grow">${safeUrl(x.url) ? html`<a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${x.text}</a>` : x.text}</span></div>`) : html`<p class="s m">Nothing noted lately.</p>`}</div>
      </div></div>`;
  },
  actions: {
    filter({ el, route }) { location.hash = with_(route, { [el.name]: el.value, page: '' }); return false; },
    look: ({ route }) => post(`companies/${route.parts[1]}/reviews`),
    note: ({ route, f }) => put(`companies/${route.parts[1]}/note`, { text: f.text }).then(() => toast('Saved')),
    state: ({ route, d }) => put(`companies/${route.parts[1]}`, { state: d.state }),
  },
};
