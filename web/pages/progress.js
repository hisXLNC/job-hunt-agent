import { html, api, ago, app, KIND, rel } from '../app.js';

const pct = (a, b) => (b ? Math.round(a * 100 / b) + '%' : '–');

function rates(title, rows) {
  if (!rows?.length) return '';
  return html`<div class="card" style="padding:0"><div style="padding:14px 16px 8px"><h4>${title}</h4></div><table class="tbl"><thead><tr><th>Where</th><th>Applied</th><th>Heard back</th><th>Interviews</th></tr></thead><tbody>
    ${rows.map(r => html`<tr><td class="s"><b>${r.label}</b></td><td class="s">${r.applied}</td><td class="s">${r.heard} <span class="m">· ${pct(r.heard, r.applied)}</span></td><td class="s">${r.talks} <span class="m">· ${pct(r.talks, r.applied)}</span></td></tr>`)}</tbody></table></div>`;
}

export default {
  title: 'Progress',
  sub: () => 'Where you stand, said plainly',
  topics: ['progress', 'roles', 'people'],
  load: async () => ({ p: await api('progress'), acts: await api('activity?limit=12') }),
  view({ p, acts }) {
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
      </div></div></div>`;
  },
};
void app;
