import { html, api, post, ago, when, tile, toast, copy, safeUrl, app, openAssistant, with_, fitColor, employer, shortPay, rowsThatFit, picked, redraw, rel, exact, LATER } from '../app.js';

// What each row asks of the person: the word in the first column and the one main button.
const TODO = {
  apply: ['Send', 'hot', 'send'], decide: ['Prepare', 'blue', 'prepare'], mail: ['Reply', 'info', 'reply'], talk: ['Interview', 'info', 'talk'],
  nudge: ['Follow up', 'warn', 'follow'], chase: ['Follow up', 'warn', 'follow'], silent: ['No reply', '', 'follow'], send: ['Send note', 'good', 'people'], meet: ['Write to', 'good', 'people'],
};
const GROUPS = [['', 'Everything'], ['send', 'Send'], ['prepare', 'Prepare'], ['reply', 'Replies'], ['talk', 'Interviews'], ['follow', 'Follow up'], ['people', 'People']];
const WHERE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site' };
// "Best 10" shows only this many rows, the ones Job Hunt puts first; "Top 5" ticks this many roles.
const BEST = 10, TOP = 5;
const roleRow = c => c.kind === 'apply' || c.kind === 'decide';
const short = t => ago(t).replace(/ ago$/, '');
const employerLink = c => employer(c.company, c.company_id);
// Which columns the window has room for. The list keeps its shape; the less important columns step aside.
function fits() {
  const w = document.getElementById('page')?.clientWidth || window.innerWidth - 212;
  return { w, where: w >= 1000, type: w >= 1120, seen: w >= 880, tags: w >= 1180, pay: w >= 760 };
}

function mainButton(c) {
  const url = safeUrl(c.url);
  switch (c.kind) {
    case 'apply': return url ? html`<a class="btn p sm" href="${url}" target="_blank" rel="noopener noreferrer" title="Opens the posting in your browser. Your CV and letter are ready; the side panel fills the form. You press Submit.">Open and fill</a>` : html`<a class="btn p sm" href="#/roles/${c.role_id}">Open</a>`;
    case 'decide': return c.busy ? html`<span class="btn sm" disabled><span class="spin"></span>Writing</span>` : html`<button class="btn p sm" data-act="prepare" data-id="${c.role_id}" title="Tailors your CV and writes the letter for this role. About a minute.">Prepare</button>`;
    case 'mail': return html`<a class="btn p sm" href="#/replies/${c.mail_id}">Read the reply</a>`;
    case 'talk': return html`<a class="btn p sm" href="#/interviews/${c.talk_id}">Open prep</a>`;
    case 'send': return html`<button class="btn p sm" data-act="copyopen" data-note="${c.note_id}" data-url="${url}" title="Copies your note${url ? ' and opens their profile' : ''}. You paste and send it.">Copy note</button>`;
    case 'nudge': return html`<button class="btn p sm" data-act="nudge" data-id="${c.person_id}" data-busy="Writing…">Write follow-up</button>`;
    case 'chase': return c.body ? html`<a class="btn p sm" href="#/roles/${c.role_id}" title="Your follow-up is written. Read it, then send it from your own mail.">Read and send</a>` : html`<button class="btn p sm" data-act="chase" data-id="${c.role_id}" data-busy="Writing…" title="Writes one short follow-up e-mail for you to read and send yourself.">Write follow-up</button>`;
    case 'silent': return html`<button class="btn p sm" data-act="silent" data-id="${c.role_id}" title="Closes this application as no reply. Its documents and history stay, and it opens again by itself if they write.">Close as no reply</button>`;
    case 'meet': return html`<button class="btn p sm" data-act="draft" data-id="${c.person_id}" data-busy="Writing…">Write a note</button>`;
  }
  return '';
}

// Everything else a row can do, behind the three dots.
function more(c) {
  const url = safeUrl(c.url), items = [];
  if (c.role_id) items.push(html`<a href="#/roles/${c.role_id}">${c.kind === 'apply' ? 'Read what\'s sent' : 'Open the role'}</a>`);
  if (c.kind === 'apply' || c.kind === 'decide') {
    if (url && c.kind === 'decide') items.push(html`<a href="${url}" target="_blank" rel="noopener noreferrer">Open the posting</a>`);
    items.push(html`<button data-act="applied" data-id="${c.role_id}">I applied</button>`);
    items.push(html`<button data-act="no" data-id="${c.role_id}" data-confirm="Not interested in this role? It will never be shown again.">Not for me</button>`);
  }
  if (c.kind === 'chase') {
    if (c.body) items.push(html`<button data-act="chasesent" data-id="${c.role_id}">I sent it</button>`);
    items.push(html`<button data-act="chasedrop" data-id="${c.role_id}" title="Stops suggesting a follow-up for this application. The application stays as it is.">Let it go</button>`);
  }
  if (c.kind === 'apply' || c.kind === 'decide' || c.kind === 'chase') {
    items.push(html`<span class="mh">Save for later</span>`);
    for (const [days, label] of LATER) items.push(html`<button data-act="later" data-id="${c.role_id}" data-days="${days}" title="Leaves Today and comes back by itself.">${label}</button>`);
  }
  if (c.kind === 'silent') items.push(html`<button data-act="later" data-id="${c.role_id}" data-days="7" title="Leaves Today for a week, then asks again.">Keep waiting a week</button>`);
  if (c.kind === 'talk' && url) items.push(html`<a href="${url}" target="_blank" rel="noopener noreferrer">Join link</a>`);
  if (c.kind === 'send') { items.push(html`<button data-act="sent" data-id="${c.note_id}">I sent it</button>`); items.push(html`<a href="#/people/${c.person_id}">Edit the note</a>`); }
  if (c.kind === 'nudge') items.push(html`<button data-act="quiet" data-id="${c.note_id}">Let it go</button>`);
  if (c.kind === 'meet' && url) items.push(html`<a href="${url}" target="_blank" rel="noopener noreferrer">See their profile</a>`);
  if (c.person_id && c.kind !== 'send') items.push(html`<a href="#/people/${c.person_id}">Open the person</a>`);
  if (!items.length) return '';
  return html`<details class="menu"><summary aria-label="More for this row" title="More: everything else you can do with this row.">⋯</summary><div>${items}</div></details>`;
}

function row(c, f) {
  const [label, cls] = TODO[c.kind] || [c.kind, ''];
  const isRole = c.kind === 'apply' || c.kind === 'decide';
  const go = c.role_id ? `#/roles/${c.role_id}` : c.mail_id ? `#/replies/${c.mail_id}` : c.talk_id ? `#/interviews/${c.talk_id}` : c.person_id ? `#/people/${c.person_id}` : '';
  const age = Date.now() / 1000 - c.at;
  const line2 = isRole ? html`${employerLink(c)}${c.place ? html` <span class="m">· ${c.place}</span>` : ''}` : c.kind === 'talk' ? html`${c.sub} <span class="m">· ${when(c.at)}</span>` : c.kind === 'chase' || c.kind === 'silent' ? html`${employerLink(c)} <span class="m">· ${c.sub}</span>` : html`${c.company_id ? html`${employerLink(c)} <span class="m">·</span> ` : ''}${c.sub}`;
  const tick = html`<td class="pick">${isRole ? html`<input type="checkbox" data-on="change" data-act="pick" data-id="${c.role_id}" ${picked.has(String(c.role_id)) ? 'checked' : ''} aria-label="Tick ${c.title}">` : ''}</td>`;
  const first = html`<td><span class="chip ${c.fresh && c.kind === 'apply' ? 'hot' : cls}" title="${c.fresh && c.kind === 'apply' ? 'Still early: few people have applied.' : ''}">${label}</span></td>`;
  const who = html`<div class="row" style="gap:9px">${tile(c.company || c.title, true, c.company_id)}<div class="two"><a class="t" href="${go}" title="${c.title}${c.why ? '\n\n' + c.why : ''}">${c.title}</a><span class="xs ink2">${line2}</span></div></div>`;
  const last = html`<td class="do"><div class="row" style="gap:4px;justify-content:flex-end">${mainButton(c)}${more(c)}</div></td>`;
  const tail = f.seen + f.tags;
  if (!isRole) return html`<tr>${tick}${first}<td class="rc" colspan="${2 + f.where + f.type + f.pay}">${who}</td><td title="${c.kind === 'mail' ? exact(c.at) : ''}">${c.kind === 'mail' ? short(c.at) : ''}</td>${tail ? html`<td colspan="${tail}" class="xs m" title="${c.why || ''}">${c.why || ''}</td>` : ''}${last}</tr>`;
  return html`<tr class="${picked.has(String(c.role_id)) ? 'sel' : ''}">${tick}${first}<td class="rc">${who}</td>
    ${f.where ? html`<td>${WHERE[c.workplace] || ''}</td>` : ''}${f.type ? html`<td>${c.job_type || ''}</td>` : ''}${f.pay ? html`<td title="${c.pay || ''}">${shortPay(c.pay) || html`<span class="m">Not named</span>`}</td>` : ''}
    <td>${c.fit >= 0 ? html`<span class="fitpair" title="Fit now, then with your tailored CV"><b style="color:${fitColor(c.fit)}">${c.fit}</b><span class="m">→</span>${c.tailored >= 0 && c.kind === 'apply' ? html`<b style="color:${fitColor(c.tailored)}">${c.tailored}</b>` : html`<span class="m">–</span>`}</span>` : ''}</td>
    <td title="${exact(c.at)}"><span style="${age < 86400 ? 'color:var(--hot);font-weight:600' : ''}">${short(c.at)}</span></td>
    ${f.seen ? html`<td>${c.seen >= 0 ? html`<span style="${c.seen < 10 ? 'color:var(--hot);font-weight:600' : ''}">${c.seen}</span>` : html`<span class="m" title="The posting doesn't say how many have applied.">—</span>`}</td>` : ''}
    ${f.tags ? html`<td class="tags">${(c.tags || []).map(x => html`<span class="chip ${x.tone || ''}">${x.text}</span>`)}</td>` : ''}${last}</tr>`;
}

const SORTS = {
  fit: c => -(c.fit ?? -1), posted: c => -(c.at || 0), applicants: c => (c.seen >= 0 ? c.seen : 1e9), pay: c => -(c.pay_year || 0),
  employer: c => (c.company || '￿').toLowerCase(), todo: c => Object.keys(TODO).indexOf(c.kind),
};

// The rows the filters leave, in the order chosen. "Best 10" keeps only the ten Job Hunt puts first.
function visible(all, q) {
  const group = c => (TODO[c.kind] || [])[2], best = new Set(q.best ? all.slice(0, BEST) : []);
  const rows = all.filter(c => (!q.best || best.has(c)) && (!q.show || group(c) === q.show) && (!q.where || c.workplace === q.where) && (!q.type || (c.job_type || '').startsWith(q.type))
    && (!q.minfit || c.fit >= +q.minfit) && (!q.within || Date.now() / 1000 - c.at < +q.within * 86400) && (!q.minpay || c.pay_year >= +q.minpay));
  const by = SORTS[q.sort];
  if (!by) return rows;
  const dir = q.dir === 'up' ? -1 : 1;
  return rows.map((c, i) => [by(c), i, c]).sort((a, b) => (a[0] < b[0] ? -dir : a[0] > b[0] ? dir : a[1] - b[1])).map(x => x[2]);
}

function list(d, route) {
  const q = route.q, all = d.cards || [];
  const group = c => (TODO[c.kind] || [])[2];
  const rows = visible(all, q);
  const f = fits(), SIZE = rowsThatFit(292 + (d.question ? 96 : 0) + (d.problems?.length ? 46 : 0), 45, 8, 40);
  const page = Math.max(1, Math.min(+q.page || 1, Math.ceil(rows.length / SIZE) || 1)), shown = rows.slice((page - 1) * SIZE, page * SIZE);
  const top5 = rows.filter(c => roleRow(c) && !c.busy && !picked.has(String(c.role_id))).slice(0, TOP);
  const th = (key, label, tip, w, lead) => html`<th style="${w ? `width:${w}px` : ''}">${lead || ''}<a class="${q.sort === key ? 'on' : ''}" href="${with_(route, { sort: key, dir: q.sort === key && q.dir !== 'up' ? 'up' : '', page: '' })}" title="${tip}">${label}${q.sort === key ? (q.dir === 'up' ? ' ▲' : ' ▼') : ''}</a></th>`;
  const sel = (name, label, opts) => html`<select name="${name}" aria-label="${label}" data-on="change" data-act="filter" class="mini f"><option value="">${label}</option>${opts.map(([v, t]) => html`<option value="${v}" ${q[name] == v ? 'selected' : ''}>${t}</option>`)}</select>`;
  const ticks = shown.filter(c => c.kind === 'apply' || c.kind === 'decide');
  const types = [...new Set(all.map(c => (c.job_type || '').split(',')[0]).filter(Boolean))];
  const filtered = q.best || q.show || q.where || q.type || q.minfit || q.within || q.minpay;
  return html`<div class="row wrap" style="gap:6px">${GROUPS.map(([k, v]) => { const n = k ? all.filter(c => group(c) === k).length : all.length; return n || !k ? html`<a class="chip ${(q.show || '') === k ? 'on' : ''}" style="padding:4px 11px;font-size:12px" href="${with_(route, { show: k, page: '' })}">${v} ${n}</a>` : ''; })}
      ${all.length > BEST || q.best ? html`<a class="chip ${q.best ? 'on' : ''}" style="padding:4px 11px;font-size:12px" href="${with_(route, { best: q.best ? '' : 1, page: '' })}" aria-pressed="${q.best ? 'true' : 'false'}" title="Only the ten rows most worth doing now, in Job Hunt's own order. The rest wait. Press again to see everything.">Best ${BEST}</a>` : ''}
      <span class="grow"></span>
      ${sel('where', 'Where', Object.entries(WHERE))}${types.length ? sel('type', 'Type', types.map(t => [t, t])) : ''}${sel('minpay', 'Pay', [[80000, '$80k and up'], [100000, '$100k and up'], [120000, '$120k and up'], [150000, '$150k and up']])}${sel('minfit', 'Fit', [60, 70, 80, 90].map(n => [n, `Fit ${n} and up`]))}${sel('within', 'Posted', [[1, 'In the last day'], [3, 'In 3 days'], [7, 'In a week']])}
      ${filtered || q.sort ? html`<a class="btn sm ghost" href="#/today" title="Shows everything again, in Job Hunt's own order.">Clear</a>` : ''}</div>
    ${bulkBar(all)}
    <div class="card" style="padding:0"><table class="tbl today">
      <thead><tr><th class="pick" style="width:34px"><input type="checkbox" data-on="change" data-act="pickall" ${ticks.length && ticks.every(c => picked.has(String(c.role_id))) ? 'checked' : ''} ${ticks.length ? '' : 'disabled'} aria-label="Tick every role on this page" title="Tick every role on this page"></th>${th('todo', 'To do', 'Sort by what the row asks of you', top5.length ? 114 : 96, top5.length ? html`<button type="button" class="chip top5" data-act="picktop" title="Tick the top ${TOP}: the ${top5.length === TOP ? TOP : top5.length} best roles in this list you haven't ticked yet, so you can prepare or clear them in one go.">Top ${TOP}</button>` : '')}${th('employer', 'Role · Employer', 'Sort by employer')}${f.where ? html`<th style="width:70px">Where</th>` : ''}${f.type ? html`<th style="width:${f.w >= 1500 ? 124 : 100}px">Type</th>` : ''}${f.pay ? th('pay', 'Pay', 'Sort by pay, highest first', f.w >= 1500 ? 150 : 120) : ''}${th('fit', 'Fit', 'Sort by fit: as your CV stands, then tailored', 76)}${th('posted', 'Posted', 'Sort by when it was posted, newest first', 68)}${f.seen ? th('applicants', 'Applicants', 'Sort by how many have applied, fewest first', 92) : ''}${f.tags ? html`<th style="width:${f.w >= 1600 ? 26 : 18}%">Worth knowing</th>` : ''}<th style="width:146px"></th></tr></thead>
      <tbody>${shown.length ? shown.map(c => row(c, f)) : html`<tr><td colspan="${6 + f.where + f.type + f.pay + f.seen + f.tags}"><div class="empty" style="padding:26px"><h3>${all.length ? 'Nothing matches these filters' : 'Your list is clear'}</h3><p>${all.length ? html`<a href="#/today">Show everything</a>` : 'New roles show up here within minutes of being posted, with your CV and letter already written.'}</p></div></td></tr>`}</tbody></table>
      <div class="row xs m" style="padding:6px 12px;border-top:1px solid var(--line2)">${rows.length ? html`${(page - 1) * SIZE + 1} to ${Math.min(page * SIZE, rows.length)} of ${rows.length}` : ''}${q.sort ? '' : html` · in the order that gets you closest to an interview`}<span class="grow"></span>
        ${rows.length > SIZE ? html`${page > 1 ? html`<a class="btn sm" href="${with_(route, { page: page - 1 })}">Previous</a>` : ''}${page * SIZE < rows.length ? html`<a class="btn sm" href="${with_(route, { page: page + 1 })}">Next</a>` : ''}` : html`A title opens it · an employer's name opens the employer · tick rows to do several at once`}</div></div>`;
}

// What can be done to every ticked role in one go.
function bulkBar(all) {
  if (!picked.size) return '';
  const mine = all.filter(c => picked.has(String(c.role_id)) && (c.kind === 'apply' || c.kind === 'decide'));
  const toPrepare = mine.filter(c => c.kind === 'decide' && !c.busy).length;
  return html`<div class="bulk"><b>${mine.length} ticked</b>
    ${toPrepare ? html`<button class="btn sm p" data-act="bulk" data-do="prepare" data-busy="Starting…" title="Tailors your CV and writes the letter for each ticked role that isn't prepared yet.">Prepare ${toPrepare}</button>` : ''}
    <button class="btn sm" data-act="bulk" data-do="applied" title="Marks every ticked role as applied.">I applied</button>
    <button class="btn sm danger" data-act="bulk" data-do="no" data-confirm="Not interested in these ${mine.length} roles? They will never be shown again.">Not for me</button>
    <span class="grow"></span><button class="btn sm ghost" data-act="unpick">Clear ticks</button></div>`;
}

function question(q, waiting) {
  return html`<div class="card" style="border-color:var(--warn);background:var(--warn-card);padding:9px 14px"><div class="row wrap" style="gap:8px">
    <span class="grow" style="min-width:260px" title="${q.why || ''}"><b>${q.text}</b>${q.why ? html` <span class="xs m">${q.why}</span>` : ''}</span>${waiting ? html`<span class="chip warn">${waiting} more after this</span>` : ''}</div>
    <div class="row wrap" style="gap:6px;margin-top:7px">${(q.options || []).map(o => html`<button class="btn sm" data-act="answer" data-id="${q.id}" data-answer="${o}">${o}</button>`)}
    <form data-act="answer" data-id="${q.id}" class="row grow" style="gap:6px;min-width:260px"><input type="text" name="answer" placeholder="${q.options?.length ? 'Or type your own answer' : 'Type your answer'}" aria-label="Your answer" style="height:30px"><button class="btn sm p">Save</button><button type="button" class="btn sm ghost" data-act="answer" data-id="${q.id}" data-answer="skip">Skip</button></form></div></div>`;
}

function landing(l) {
  return html`<div class="card"><div class="row"><h4>Before you land in ${l.city}</h4><span class="chip blue" style="margin-left:auto">${l.days} days</span></div>
    <div class="bar" style="margin-top:10px"><i style="width:${Math.round(l.done * 100 / l.steps.length)}%"></i></div>
    <div class="col" style="margin-top:12px;gap:9px">${l.steps.map(s => html`<a class="row top-al" href="${s.go}" style="color:inherit;text-decoration:none;gap:9px"><span class="check ${s.done ? 'on' : ''}">${s.done ? '✓' : ''}</span><span class="grow"><b class="s" style="${s.done ? 'color:var(--muted);font-weight:500' : ''}">${s.text}</b>${s.done ? '' : html`<span class="xs m" style="display:block">${s.sub}</span>`}</span></a>`)}</div></div>`;
}

export default {
  title: 'Today',
  sub: d => d.date + (app.state.moving ? ` · you land in ${app.state.days} days` : ''),
  topics: ['today', 'roles', 'people', 'mail', 'talks', 'status'],
  load: () => api('today'),
  view(d, route) {
    return html`<div class="body col" style="gap:10px">
      <div class="card row wrap" style="padding:8px 14px;gap:22px">${d.numbers.map(n => html`<div class="row" style="gap:6px" title="${n.sub}"><b style="font-size:17px;${n.tone === 'hot' ? 'color:var(--hot)' : n.tone === 'good' ? 'color:var(--good)' : ''}">${n.value}</b><span class="s m">${n.label.toLowerCase()}</span>${n.of ? html`<span class="bar goal ${n.done >= n.of ? 'met' : ''}" title="Your goal is ${n.of} applications a week. Change it under You."><i style="width:${Math.min(100, Math.round((n.done || 0) * 100 / n.of))}%"></i></span>` : ''}<span class="xs m">· ${n.sub}</span></div>`)}</div>
      ${d.problems?.length ? html`<div class="card" style="border-color:var(--crit);background:var(--crit-card);padding:9px 14px">${d.problems.map(p => html`<p class="s"><b style="color:var(--crit)">Needs attention.</b> ${p.text} <span class="m">· ${rel(p.at)}</span></p>`)}</div>` : ''}
      ${d.question ? question(d.question, d.waiting) : ''}
      ${list(d, route)}
      <div class="${d.landing ? 'grid2' : ''}" style="align-items:start">
        ${d.landing ? landing(d.landing) : ''}
        <div class="card" style="padding:10px 14px"><h4>While you were away</h4><div class="col s" style="margin-top:7px;gap:5px">
          ${d.done?.length ? d.done.map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:62px;flex:none;padding-top:1px">${rel(a.at)}</span><span>${a.text}</span></div>`) : html`<span class="m">Nothing yet. The first search starts as soon as Claude is connected.</span>`}</div></div>
      </div></div>`;
  },
  actions: {
    pick({ d, value }) { value ? picked.add(d.id) : picked.delete(d.id); redraw(); return false; },
    pickall({ value }) { document.querySelectorAll('.tbl.today td.pick input').forEach(i => (value ? picked.add(i.dataset.id) : picked.delete(i.dataset.id))); redraw(); return false; },
    unpick() { picked.clear(); redraw(); return false; },
    // Ticks the five best roles not ticked yet, in the order the list is in now (filters and sorting included).
    picktop({ route, data }) {
      const rows = visible(data.cards || [], route.q);
      const add = rows.filter(c => roleRow(c) && !c.busy && !picked.has(String(c.role_id))).slice(0, TOP);
      add.forEach(c => picked.add(String(c.role_id)));
      redraw();
      toast(add.length ? `Ticked ${add.length}. Prepare them or clear them from the bar above the list.` : 'Nothing left to tick.');
      return false;
    },
    async bulk({ d, data }) {
      const mine = data.cards.filter(c => picked.has(String(c.role_id)) && (c.kind === 'apply' || c.kind === 'decide') && (d.do !== 'prepare' || (c.kind === 'decide' && !c.busy)));
      let done = 0;
      for (const c of mine) { await post(`roles/${c.role_id}/${d.do}`); done++; }
      picked.clear();
      const back = { applied: 'unapply', no: 'reopen' }[d.do];
      toast({ prepare: `Preparing ${done}. Each takes about a minute.`, applied: `${done} marked as applied`, no: `${done} won't be shown again` }[d.do], false,
        back && done ? async () => { for (const c of mine) await post(`roles/${c.role_id}/${back}`); } : undefined);
    },
    filter({ el, route }) { location.hash = with_(route, { [el.name]: el.value, page: '' }); return false; },
    applied: ({ d }) => post(`roles/${d.id}/applied`).then(() => toast('Marked as applied', false, () => post(`roles/${d.id}/unapply`))),
    no: ({ d }) => post(`roles/${d.id}/no`).then(() => toast('It won\'t be shown again', false, () => post(`roles/${d.id}/reopen`))),
    later: ({ d }) => post(`roles/${d.id}/later`, { days: +d.days }).then(() => toast({ 1: 'Saved for later. Back tomorrow.', 3: 'Saved for later. Back in 3 days.', 7: 'Saved for later. Back next week.' }[d.days], false, () => post(`roles/${d.id}/later`, { days: 0 }))),
    async chase({ d }) { await post(`roles/${d.id}/chase`); location.hash = `#/roles/${d.id}`; return false; },
    chasesent: ({ d }) => post(`roles/${d.id}/chasesent`).then(() => toast('Noted in the role\'s history.')),
    chasedrop: ({ d }) => post(`roles/${d.id}/chasedrop`),
    silent: ({ d }) => post(`roles/${d.id}/close`, { stage: 'expired', why: 'No reply after four weeks' }).then(() => toast('Closed as no reply', false, () => post(`roles/${d.id}/reopen`))),
    prepare: ({ d }) => post(`roles/${d.id}/prepare`),
    async answer({ d, f }) {
      const answer = (d.answer || f?.answer || '').trim();
      if (!answer) throw new Error('Type an answer, or press Skip.');
      await post(`questions/${d.id}/answer`, { answer });
    },
    async copyopen({ d, data }) {
      const c = data.cards.find(x => String(x.note_id) === d.note);
      await copy(c?.body || '');
      if (d.url) window.open(d.url, '_blank', 'noopener');
      return false;
    },
    sent: ({ d }) => post(`notes/${d.id}/sent`).then(() => toast('Noted. Job Hunt will remind you in a week if they are quiet.')),
    quiet: ({ d }) => post(`notes/${d.id}/quiet`),
    async nudge({ d }) { await post(`people/${d.id}/note`, { purpose: 'nudge' }); location.hash = `#/people/${d.id}`; return false; },
    async draft({ d }) { await post(`people/${d.id}/note`, {}); location.hash = `#/people/${d.id}`; return false; },
    ask({ f, el }) {
      if (!f.text.trim()) return false;
      openAssistant(f.text.trim(), true);
      el.reset();
      return false;
    },
  },
};
