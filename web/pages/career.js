import { html, api, post, put, toast, day, rel, with_, BAND } from '../app.js';

// Career path: where the CV can go from here, and the smallest steps that get there.
// Claude reads the routes and the gaps; every count of postings is Job Hunt's own.

const TONE = { step_up: 'blue', sideways: 'info', level: '' };
const SIGN = { CAD: 'C$', USD: 'US$', AUD: 'A$', NZD: 'NZ$', GBP: '£', EUR: '€' };
const money = (n, cur) => (n > 0 ? `${SIGN[cur] ?? (cur ? cur + ' ' : '')}${n >= 10000 ? Math.round(n / 1000) + 'k' : n.toLocaleString()}` : '–');
// "Indirect tax" reads as "indirect tax" mid-sentence; "SAP" stays.
const lower = s => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const fitTone = v => (v >= 80 ? 'good' : v >= 60 ? 'warn' : 'crit');

function seenLine(r) {
  if (r.enough) return `${r.seen} postings Job Hunt saw in the last 90 days.`;
  return r.searching ? 'Not enough postings seen yet; they come in as Job Hunt searches these titles.' : 'Not enough postings seen yet. Search these titles to see how many there are.';
}

function routeCard(r, i, d, chosen, at) {
  const cur = d.now.currency;
  return html`<div class="card col" style="gap:10px;${i === chosen ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)' : ''}">
    <div class="row" style="gap:6px"><span class="chip ${TONE[r.band]}">${BAND[r.band] || r.band}</span>${r.recommended ? html`<span class="chip good">Recommended</span>` : ''}<span class="grow"></span><span class="s m" style="white-space:nowrap" title="Claude's judgement of how your CV as it stands would do for this role">fit today</span><b style="font-size:17px;color:var(--${fitTone(r.fit)})">${r.fit}</b></div>
    <h3 style="font-size:17px">${r.title}</h3>
    <p class="s ink2">${r.why} <span class="m">${seenLine(r)}</span></p>
    <table class="tbl ladder" style="margin:0 -2px;table-layout:fixed"><thead><tr><th>Now</th><th>In 3 years</th><th>In 5</th><th>In 10</th><th title="The top of this path as people usually reach it, and the most it typically pays">Ceiling</th></tr></thead>
      <tbody><tr><td class="s" style="vertical-align:top">${money(d.now.pay, cur)}</td>${[[r.pay3, r.title3], [r.pay5, r.title5], [r.pay10, r.title10], [r.ceiling, r.ceiling_title]].map(([p, t]) => html`<td class="s" style="vertical-align:top;overflow-wrap:anywhere" title="${t || ''}"><b>${money(p, cur)}</b>${t ? html`<span class="xs m" style="display:block;white-space:normal;line-height:1.25;margin-top:2px">${t}</span>` : ''}</td>`)}</tr></tbody></table>
    ${r.gaps.length ? html`<div><div class="eb" style="margin-bottom:4px">What's missing</div>${r.gaps.map(g => html`<div class="s row" style="gap:6px"><span style="color:var(--${g.done ? 'good' : 'warn'})">${g.done ? '✓' : '●'}</span><span style="${g.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${g.gap}</span></div>`)}</div>` : ''}
    <div class="row wrap" style="gap:6px;margin-top:auto">
      ${r.searching ? html`<span class="btn sm p" title="${r.titles.join(', ')}" aria-disabled="true">Searching these titles</span>` : html`<button class="btn sm" data-act="search" data-route="${i}" data-busy title="Adds ${r.titles.join(', ')} to what Job Hunt searches for. Change them under Radar → Titles.">Search these titles</button>`}
      ${i === chosen ? '' : html`<a class="btn sm ghost" href="${with_(at, { plan: i })}">The plan</a>`}
      ${d.path === r.title ? html`<span class="chip good" title="Roles are tagged On path or Off path for this. Change it under You → What you want.">Your path</span>` : html`<button class="btn sm ghost" data-act="mypath" data-title="${r.title}" title="Tags every role Job Hunt reads On path or Off path for ${r.title}, and Claude weighs roles by it.">Make this my path</button>`}</div></div>`;
}

function plan(r, d) {
  return html`<div class="card" style="padding:0"><div class="row wrap" style="padding:14px 16px 10px;gap:8px"><h3 class="grow">The plan for ${r.title}</h3><span class="s m">Each gap, and the smallest thing that closes it</span></div>
    <table class="tbl"><thead><tr><th>Gap</th><th title="Of the postings Job Hunt saw for this route in the last 90 days, how many ask for it">Why it matters</th><th>What closes it</th><th>Time</th><th></th></tr></thead><tbody>
    ${r.gaps.map(g => html`<tr><td class="s" style="min-width:150px"><b style="${g.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${g.gap}</b></td>
      <td class="s m" style="white-space:nowrap">${r.enough ? `In ${g.asked} of ${r.seen}` : 'Not enough seen'}</td>
      <td class="s">${g.how}</td><td class="s" style="white-space:nowrap">${g.time}</td>
      <td style="text-align:right;white-space:nowrap">${g.done ? html`<button class="btn sm ghost" data-act="done" data-id="${g.id}" data-done="" title="Put it back on the plan"><span class="chip good">Done</span></button>` : html`<button class="btn sm" data-act="done" data-id="${g.id}" data-done="1">Mark done</button>`}</td></tr>`)}
    </tbody></table>
    <p class="xs m" style="padding:10px 16px 14px">${r.enough ? 'Counted from the postings for this route that Job Hunt saw in the last 90 days.' : 'The counts appear once Job Hunt has seen a few postings for this route.'} A step marked done stays done when the plan is read again on Monday.</p></div>`;
}

function onTheWay(r, d) {
  const lv = d.level;
  const mine = r.applied ? `Of ${r.applied} application${r.applied === 1 ? '' : 's'} to ${r.title}-type roles, ${r.heard} heard back and ${r.talks} led to a conversation.` : `No applications to ${r.title}-type roles yet.`;
  const level = lv.applied ? ` At your level: ${lv.applied} sent, ${lv.heard} heard back, ${lv.talks} led to a conversation.` : '';
  return html`<div class="card"><h4>How you're doing on the way</h4><p class="s ink2" style="margin-top:6px">${mine}${level}</p><p class="xs m" style="margin-top:6px">From your own applications, matched by title.</p></div>`;
}

export default {
  title: 'Career path',
  sub: () => 'Where your CV can take you, and what gets you there',
  topics: ['career', 'status', 'you'],
  load: () => Promise.all([api('career'), api('profile').catch(() => ({}))]).then(([c, p]) => ({ ...c, path: p.career_path || '' })),
  view(d, route) {
    const lookBtn = d.looking ? html`<span class="btn" disabled><span class="spin"></span>Reading</span>`
      : d.can_look ? html`<button class="btn" data-act="look" data-busy title="Claude reads your CV against what employers post. About two minutes.">${d.has ? 'Look again now' : 'Look now'}</button>`
      : html`<a class="btn" href="#/you/connections?open=claude">Connect Claude</a>`;
    if (!d.has) {
      return html`<div class="body col" style="gap:14px"><div class="card row wrap" style="gap:20px;align-items:center">
        <div class="grow" style="min-width:280px"><h3>Where can your CV take you?</h3><p class="s ink2" style="margin-top:6px">${d.looking ? 'Claude is reading your CV against the postings Job Hunt has seen. This page fills in when it is done.' : 'Claude reads your CV and what employers post, and shows three ways your career can go from here: what each pays, what is missing, and the smallest steps that close the gap. It is read again every Monday.'}</p></div>${lookBtn}</div></div>`;
    }
    const pick = Number.parseInt(route.q.plan ?? '', 10);
    const chosen = d.routes[pick] ? pick : Math.max(0, d.routes.findIndex(r => r.recommended));
    const r = d.routes[chosen];
    const n = d.now;
    return html`<div class="body col" style="gap:14px">
      <div class="card row wrap" style="gap:24px;align-items:center">
        <div><div class="eb">Where you are</div><div style="font-size:19px;font-weight:700;margin-top:2px">${n.title}</div>
          <div class="s m">${[n.pay ? `About ${money(n.pay, n.currency)} a year` : '', n.years ? `${n.years} year${n.years === 1 ? '' : 's'}${n.summary ? ' in ' + lower(n.summary) : ''}` : n.summary].filter(Boolean).join(' · ')}</div></div>
        <div class="grow s ink2" style="min-width:300px">Three ways your CV can go from here. Pay is yearly base pay in ${{ CAD: 'Canadian dollars', USD: 'US dollars', GBP: 'pounds', EUR: 'euros', AUD: 'Australian dollars' }[d.now?.currency] || d.now?.currency || 'local currency'}, Claude's estimate${d.web ? ' from public pay data' : ''}; check it before you rely on it. Read ${day(d.at)} (${rel(d.at)}), and again every Monday.${d.note ? html`<div class="m" style="margin-top:4px">${d.note}</div>` : ''}</div>
        ${lookBtn}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px;align-items:stretch">${d.routes.map((x, i) => routeCard(x, i, d, chosen, route))}</div>
      <div class="cols wide"><div class="col" style="gap:14px">${r ? plan(r, d) : ''}</div>
        <div class="col" style="gap:14px">
          ${d.try.length ? html`<div class="card"><h4>Titles to try this week</h4><p class="xs m" style="margin-top:3px">Close to your CV, not searched yet.</p>
            <div class="col" style="margin-top:10px;gap:8px">${d.try.map(t => html`<div class="row" style="gap:8px"><span class="grow s"><b>${t.title}</b> <span class="m">· ${(BAND[t.band] || t.band).toLowerCase()}</span></span>${t.searching ? html`<span class="chip good">Searching</span>` : html`<button class="btn sm" data-act="search" data-title="${t.title}" data-busy>Add to search</button>`}</div>`)}</div></div>` : ''}
          ${r ? onTheWay(r, d) : ''}
        </div></div></div>`;
  },
  actions: {
    look: () => post('career/look').then(() => toast('Reading where your CV can go. About two minutes.')),
    done: ({ d }) => post('career/done', { id: d.id, done: !!d.done }),
    mypath: ({ d }) => put('profile', { career_path: d.title }).then(() => toast(`Your path is ${d.title}. Roles read from now on are tagged On path or Off path.`)),
    async search({ d }) {
      const body = d.route !== undefined ? { route: Number(d.route) } : { title: d.title };
      const out = await post('career/search', body);
      toast(out.added?.length ? `Searching for ${out.added.join(', ')} too. Change them under Radar → Titles.` : 'Already searched for.');
    },
  },
};
