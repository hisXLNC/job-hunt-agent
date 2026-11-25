import { html, api, post, put, toast, ago, app, KIND, rel, href } from '../app.js';

const pct = (a, b) => (b ? Math.round(a * 100 / b) + '%' : '–');

function rates(title, rows, head = 'Where') {
  if (!rows?.length) return '';
  return html`<div class="card" style="padding:0"><div style="padding:14px 16px 8px"><h4>${title}</h4></div><table class="tbl"><thead><tr><th>${head}</th><th>Applied</th><th>Heard back</th><th>Interviews</th></tr></thead><tbody>
    ${rows.map(r => html`<tr><td class="s"><b>${r.label}</b></td><td class="s">${r.applied}</td><td class="s">${r.heard} <span class="m">· ${pct(r.heard, r.applied)}</span></td><td class="s">${r.talks} <span class="m">· ${pct(r.talks, r.applied)}</span></td></tr>`)}</tbody></table></div>`;
}

// ---- in depth: a 7, 30 or 90-day view ------------------------------------------------
const DAYS = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
const k = n => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0));

function change(n, before) {
  if (n === before) return html`<span class="xs m">same as before</span>`;
  const up = n > before;
  return html`<span class="xs" style="color:var(--${up ? 'good' : 'muted'})">${up ? '▲' : '▼'} ${Math.abs(n - before)}</span>`;
}

function reading(x) {
  const r = x.reading;
  const btn = x.busy ? html`<span class="btn sm" disabled><span class="spin"></span>Reading</span>`
    : x.can_read && x.applied >= 3 ? html`<button class="btn sm" data-act="readresults" data-busy="Starting…" title="Claude reads your numbers and the no's. It also does this by itself once a week.">${r ? 'Read again now' : 'Read my results'}</button>` : '';
  if (!r) {
    return html`<div class="card row wrap" style="gap:14px"><div class="grow"><h4>Claude's reading</h4><p class="s m" style="margin-top:3px">${x.applied >= 3 ? "A short reading of your results and what your no's say, once a week by itself or when you ask." : 'Once you have applied to a few roles, Claude reads your results here once a week.'}</p></div>${btn}</div>`;
  }
  return html`<div class="card col" style="gap:8px"><div class="row"><div class="grow"><div class="eb">Claude's reading · ${rel(r.at)}</div></div>${btn}</div>
    <p style="font-size:14.5px">${r.summary}</p>
    ${r.points?.length ? html`<ul style="margin:0 0 0 18px" class="s">${r.points.map(p => html`<li style="margin-bottom:3px">${p}</li>`)}</ul>` : ''}
    ${r.rejections?.length ? html`<div><div class="eb" style="margin:6px 0 4px">What your no's say</div><ul style="margin:0 0 0 18px" class="s">${r.rejections.map(p => html`<li style="margin-bottom:3px">${p}</li>`)}</ul></div>` : ''}
    ${r.guidance ? html`<div class="row top-al" style="gap:12px;margin-top:6px;padding:10px 12px;border-radius:10px;background:var(--s2)"><div class="grow"><b class="s">When tailoring</b><p class="s ink2" style="margin-top:2px">${r.guidance}</p></div>
      <label class="row xs m" style="gap:6px;white-space:nowrap"><button class="switch ${x.guidance_on ? 'on' : ''}" role="switch" aria-checked="${x.guidance_on ? 'true' : 'false'}" aria-label="Follow this when tailoring" data-act="guidance" data-to="${x.guidance_on ? '' : '1'}"></button>${x.guidance_on ? 'Used' : 'Not used'}</label></div>` : ''}
    <p class="xs m">The numbers are Job Hunt's own counts; Claude only reads them.</p></div>`;
}

function depth(x) {
  const top = Math.max(1, ...x.funnel.map(f => Math.max(f.n, f.before)));
  const p = x.pay;
  return html`<div class="col" style="gap:14px;margin-top:22px">
    <div class="row wrap" style="gap:12px"><h3 class="grow">In depth</h3><div class="seg" role="group" aria-label="Period">${DAYS.map(([n, l]) => html`<a class="btn sm" style="${x.days === n ? 'background:var(--accent-soft);color:var(--accent)' : ''}" href="${href('progress', n === 30 ? {} : { days: n })}" ${x.days === n ? html`aria-current="true"` : ''}>${l}</a>`)}</div></div>
    ${reading(x)}
    ${x.lines?.length ? html`<div class="card"><div class="eb">In these ${x.days} days</div><ul style="margin:8px 0 0 18px;font-size:14.5px">${x.lines.map(l => html`<li style="margin-bottom:4px">${l}</li>`)}</ul></div>` : ''}
    <div class="cols wide"><div class="col" style="gap:14px">
      <div class="card"><h4>The last ${x.days} days, beside the ${x.days} before</h4><div class="col" style="margin-top:12px;gap:8px">${x.funnel.map(f => html`<div class="row"><span class="s" style="width:120px;flex:none">${f.label}</span><div class="col grow" style="gap:2px"><div class="bar" style="height:12px"><i style="width:${f.n * 100 / top}%"></i></div><div class="bar" style="height:5px;opacity:.45"><i style="width:${f.before * 100 / top}%"></i></div></div><b style="width:44px;text-align:right">${f.n}</b><span style="width:64px">${change(f.n, f.before)}</span></div>`)}</div>
        <p class="xs m" style="margin-top:8px">The thin line is the ${x.days} days before.</p></div>
      ${rates('By CV', x.by_cv, 'CV')}${rates('By fit score', x.by_fit, 'Fit')}${rates('By kind of role', x.by_kind, 'Title')}${rates('By pay', x.by_pay, 'Pay a year')}
      ${!x.by_cv.length ? html`<div class="card empty"><h3>No applications in these ${x.days} days</h3><p>Results by CV, fit, kind of role and pay appear once you apply.</p></div>` : ''}
    </div><div class="col" style="gap:14px">
      <div class="card"><h4>Pay</h4>${x.pay_lines?.length ? html`<ul style="margin:8px 0 0 18px" class="s">${x.pay_lines.map(l => html`<li style="margin-bottom:3px">${l}</li>`)}</ul>` : html`<p class="s m" style="margin-top:6px">No postings seen in these ${x.days} days.</p>`}
        ${p.shown >= 3 ? html`<div class="row" style="margin-top:12px;gap:0"><div class="stat" style="padding-left:0"><div class="big">${k(p.median)}</div><div class="xs m">middle of<br>all postings</div></div><div class="stat"><div class="big">${p.good ? k(p.good) : '–'}</div><div class="xs m">good fits<br>(70 and up)</div></div><div class="stat"><div class="big" style="color:var(--good)">${p.heard ? k(p.heard) : '–'}</div><div class="xs m">roles that<br>answered</div></div></div>` : ''}
        <p class="xs m" style="margin-top:8px">Yearly figures, from the pay the postings name.</p></div>
      ${x.overlap.length ? html`<div class="card" style="padding:0"><div style="padding:14px 16px 8px"><h4>Where roles turn up</h4><p class="xs m" style="margin-top:3px">${x.both} role${x.both === 1 ? ' was' : 's were'} found in more than one place. “Only here” is what a source adds that the others miss.</p></div>
        <table class="tbl"><thead><tr><th>Source</th><th>Roles</th><th>Only here</th></tr></thead><tbody>${x.overlap.map(o => html`<tr><td class="s"><b>${o.label}</b></td><td class="s">${o.seen}</td><td class="s">${o.only} <span class="m">· ${pct(o.only, o.seen)}</span></td></tr>`)}</tbody></table></div>` : ''}
      ${x.rejects.total ? html`<div class="card"><h4>The no's</h4><div class="row" style="margin-top:12px;gap:0"><div class="stat" style="padding-left:0"><div class="big">${x.rejects.total}</div><div class="xs m">in these<br>${x.days} days</div></div><div class="stat"><div class="big">${x.rejects.before_reply}</div><div class="xs m">before anyone<br>answered</div></div><div class="stat"><div class="big">${x.rejects.after_talk}</div><div class="xs m">after an<br>interview</div></div></div>
        ${x.rejects.fit_no && x.rejects.fit_heard ? html`<p class="xs m" style="margin-top:8px">Typical fit of the no's: ${x.rejects.fit_no}; of the roles that answered: ${x.rejects.fit_heard}.</p>` : ''}</div>` : ''}
    </div></div></div>`;
}

export default {
  title: 'Progress',
  sub: () => 'Where you stand, said plainly',
  topics: ['progress', 'roles', 'people'],
  load: async route => {
    const [p, acts, x] = await Promise.all([api('progress'), api('activity?limit=12'), api('insights?days=' + (+route.q.days || 30))]);
    return { p, acts, x };
  },
  view({ p, acts, x }) {
    const top = Math.max(1, ...p.funnel.map(f => f.n)), goal = p.goal || 0, wk = Math.max(1, goal, ...p.weeks.map(w => Math.max(w.applied, w.notes))), met = p.weeks.filter(w => goal && w.applied >= goal).length;
    const sp = p.speed, med = sp.median_hours < 0 ? '–' : sp.median_hours < 48 ? Math.round(sp.median_hours) + ' h' : Math.round(sp.median_hours / 24) + ' days';
    return html`<div class="body">
      ${p.lessons?.length ? html`<div class="card"><div class="eb">What the numbers say</div><ul style="margin:8px 0 0 18px;font-size:14.5px">${p.lessons.map(l => html`<li style="margin-bottom:4px">${l}</li>`)}</ul></div>` : ''}
      <div class="cols wide"><div class="col" style="gap:14px">
        <div class="card"><h3>From posting to offer</h3><div class="col" style="margin-top:14px;gap:10px">${p.funnel.map((f, i) => html`<div class="row"><span class="s" style="width:120px;flex:none">${f.label}</span><div class="bar grow" style="height:18px"><i style="width:${Math.max(f.n * 100 / top, f.n ? 1.5 : 0)}%;background:${i >= 4 ? 'var(--good)' : 'var(--accent)'}"></i></div><b style="width:52px;text-align:right">${f.n}</b><span class="xs m" style="width:44px">${i > 0 && p.funnel[i - 1].n ? pct(f.n, p.funnel[i - 1].n) : ''}</span></div>`)}</div>
          <p class="xs m" style="margin-top:10px">The small figure is the share that made it from the line above.</p></div>
        <div class="card"><div class="row"><h3 class="grow">The last eight weeks</h3><span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:var(--accent);display:inline-block"></i>Applications</span><span class="chip"><i style="width:8px;height:8px;border-radius:2px;background:var(--good);display:inline-block"></i>Notes to people</span>${goal ? html`<span class="chip" title="Your goal. Change it under You."><i style="width:10px;border-top:1.5px dashed var(--warn);display:inline-block"></i>Goal: ${goal} a week</span>` : ''}</div>
          <div class="vbars" style="margin-top:14px">${p.weeks.map(w => html`<div class="vb"><div class="row" style="gap:3px;align-items:flex-end;height:100%;width:100%;justify-content:center;position:relative">${goal ? html`<span class="goalline" style="bottom:${goal * 100 / wk}%"></span>` : ''}<i style="height:${w.applied * 100 / wk}%;width:16px;border-radius:4px 4px 0 0;background:var(--accent);display:block;min-height:2px" title="${w.applied} applications"></i><i style="height:${w.notes * 100 / wk}%;width:16px;border-radius:4px 4px 0 0;background:var(--good);display:block;min-height:2px" title="${w.notes} notes"></i></div><span class="xs m">${new Date(w.start * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><span class="xs"><b style="${goal && w.applied >= goal ? 'color:var(--good)' : ''}" title="${goal ? (w.applied >= goal ? 'Goal met' : `${goal - w.applied} short of your goal`) : ''}">${w.applied}${goal && w.applied >= goal ? ' ✓' : ''}</b> · ${w.notes}${w.replies ? html` · <b style="color:var(--good)">${w.replies}↩</b>` : ''}</span></div>`)}</div>
          ${goal ? html`<p class="xs m" style="margin-top:10px">You reached ${goal} applications in ${met} of the last ${p.weeks.length} weeks. The dashed line is your goal; change it under <a href="#/you">You</a>.</p>` : ''}</div>
        ${rates('By where the role came from', p.by_source)}${rates('By level', p.by_band)}
      </div>
      <div class="col" style="gap:14px">
        <div class="card"><h4>How early you apply</h4><p class="xs m" style="margin-top:3px">The first ten applicants are the ones a person reads.</p>
          <div class="row" style="margin-top:12px;gap:0"><div class="stat" style="padding-left:0"><div class="big">${med}</div><div class="xs m">typical time from<br>posting to applying</div></div><div class="stat"><div class="big">${sp.first_day}</div><div class="xs m">of ${sp.applied} sent within<br>a day of posting</div></div><div class="stat"><div class="big" style="color:var(--hot)">${sp.first_ten}</div><div class="xs m">sent while under<br>ten had applied</div></div></div></div>
        <div class="card"><h4>People</h4><div class="row" style="margin-top:12px;gap:0"><div class="stat" style="padding-left:0"><div class="big">${p.people.written}</div><div class="xs m">written to</div></div><div class="stat"><div class="big">${p.people.replied}</div><div class="xs m">answered · ${pct(p.people.replied, p.people.written)}</div></div><div class="stat"><div class="big" style="color:var(--good)">${p.people.know_you}</div><div class="xs m">know who you are</div></div></div>
          ${Object.keys(p.people.by_kind || {}).length ? html`<div class="row wrap" style="margin-top:10px;gap:6px">${Object.entries(p.people.by_kind).map(([k, n]) => html`<span class="chip">${KIND[k] || k} ${n}</span>`)}</div>` : ''}
          ${p.people.waiting ? html`<p class="xs m" style="margin-top:8px">${p.people.waiting} note${p.people.waiting === 1 ? '' : 's'} out with no answer yet.</p>` : ''}</div>
        ${p.cleared?.length ? html`<div class="card"><div class="row"><h4 class="grow">Set aside without bothering you</h4><a class="s" href="#/roles?closed=screened">See them</a></div><div class="col s" style="margin-top:10px;gap:6px">${p.cleared.map(c => html`<div class="row"><span class="grow ink2">${c.label || 'Other'}</span><b>${c.n}</b></div>`)}</div></div>` : ''}
        <div class="card"><h4>Lately</h4><div class="col s" style="margin-top:10px;gap:8px">${acts.map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:62px;flex:none">${rel(a.at)}</span><span>${a.text}</span></div>`)}</div></div>
      </div></div>${depth(x)}</div>`;
  },
  actions: {
    readresults: () => post('insights/read').then(() => toast('Reading. This takes a minute.')),
    guidance: ({ d }) => put('insights/guidance', { on: !!d.to }),
  },
};
void app;
