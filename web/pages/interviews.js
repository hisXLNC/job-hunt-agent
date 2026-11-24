import { html, api, post, put, del, ago, when, until, toast, safeUrl, employer } from '../app.js';

const KINDS = { chat: 'Informal conversation', screen: 'Recruiter call', interview: 'Interview', offer: 'Offer call' };
const pad = n => String(n).padStart(2, '0');
const local = ts => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function tileDay(ts, past) {
  const d = new Date(ts * 1000);
  return html`<div class="tile" style="${past ? 'background:var(--s2);color:var(--muted)' : ''}"><div class="xs" style="font-weight:700">${d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}</div><div class="d">${d.getDate()}</div></div>`;
}

function row(t, past) {
  const who = t.person || t.company ? html`${t.person}${t.person && t.company ? ' · ' : ''}${employer(t.company, t.company_id)}` : '';
  return html`<div class="row">${tileDay(t.at, past)}<div class="grow"><a href="#/interviews/${t.id}"><b>${t.title}</b></a>${who ? html` <span class="m">· ${who}</span>` : ''}
    <div class="s m">${when(t.at)} · ${t.minutes} min · ${KINDS[t.kind] || t.kind}${t.role ? html` · ${t.role}` : ''}</div></div>
    ${past ? '' : html`<span class="chip ${t.prep && Object.keys(t.prep).length ? 'good' : ''}">${t.prep && Object.keys(t.prep).length ? 'Prep ready' : 'Preparing'}</span>`}<a class="btn sm ${past ? '' : 'p'}" href="#/interviews/${t.id}">${past ? 'Notes' : 'Open prep'}</a></div>`;
}

function list(d, route) {
  const q = route.q;
  const soon = new Date(Date.now() + 86400000); soon.setMinutes(0, 0, 0);
  return html`<div class="body cols wide"><div class="col" style="gap:14px">
    <div class="card"><h3>Coming up</h3>${d.upcoming?.length ? html`<div class="col" style="margin-top:12px;gap:14px">${d.upcoming.map(t => row(t))}</div>` : html`<p class="s m" style="margin-top:8px">Nothing booked. A coffee with someone in your field counts: add it and Job Hunt prepares you for it.</p>`}</div>
    ${d.past?.length ? html`<div class="card"><h3>Behind you</h3><div class="col" style="margin-top:12px;gap:14px">${d.past.map(t => row(t, true))}</div></div>` : ''}
  </div>
  <div class="col" style="gap:14px"><div class="card"><h4>Add a conversation</h4><form data-act="add" class="col" style="margin-top:8px;gap:8px">
    <label class="field">What is it<select name="kind">${Object.entries(KINDS).map(([k, v]) => html`<option value="${k}" ${(q.role && k === 'interview') || (!q.role && q.person && k === 'chat') ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field">Title<input type="text" name="title" placeholder="Coffee with Leila"></label>
    <div class="grid2"><label class="field">When<input type="datetime-local" name="at" value="${local(soon / 1000)}" required></label><label class="field">Minutes<input type="number" name="minutes" value="30" min="10" max="480"></label></div>
    <label class="field">Link or place<input type="url" name="link" placeholder="https://"></label>
    <input type="hidden" name="role_id" value="${q.role || ''}"><input type="hidden" name="person_id" value="${q.person || ''}">
    ${q.role || q.person ? html`<p class="xs m">This will be tied to the ${q.role ? 'role' : 'person'} you came from.</p>` : ''}
    <button class="btn sm p" style="align-self:flex-start">Add and prepare me</button></form></div></div></div>`;
}

function one(d) {
  const t = d.talk, p = t.prep && Object.keys(t.prep).length ? t.prep : null, link = safeUrl(t.link), past = t.at < Date.now() / 1000 - 3600;
  return html`<div class="body cols wide"><div class="col" style="gap:14px">
    <div class="card row" style="gap:16px;padding:20px">${tileDay(t.at, past)}<div class="grow"><div class="row wrap" style="gap:8px"><span class="chip blue">${KINDS[t.kind] || t.kind}</span><span class="s m">${when(t.at)} · ${past ? ago(t.at) : until(t.at)} · ${t.minutes} min</span></div>
      <h2 style="font-size:21px;margin-top:4px">${t.title}</h2><div class="s m">${t.person}${t.person && t.company ? ' · ' : ''}${employer(t.company, t.company_id)}${t.role ? html` · ${t.role_id ? html`<a class="emp" href="#/roles/${t.role_id}">${t.role}</a>` : t.role}` : ''}</div></div>
      <div class="col" style="gap:6px">${link ? html`<a class="btn p" href="${link}" target="_blank" rel="noopener noreferrer">Join</a>` : ''}<a class="btn sm" href="/api/talks/${t.id}/invite.ics">Add to calendar</a></div></div>
    ${d.preparing ? html`<div class="card row"><span class="spin"></span><div><h4>Writing your prep pack</h4><p class="s m">About a minute. The page updates by itself.</p></div></div>` : ''}
    ${p ? html`<div class="card col" style="gap:14px">
      <div><div class="eb">Your opening · 45 seconds</div><p style="margin-top:6px;font-size:14.5px">${p.opening}</p></div>
      ${p.likely?.length ? html`<div><div class="eb">What they will probably ask</div><div class="col" style="margin-top:8px;gap:10px">${p.likely.map((x, i) => html`<div class="row top-al"><div class="num" style="width:22px;height:22px;font-size:11.5px">${i + 1}</div><div class="grow s"><b>${x.q}</b><div class="ink2">${x.a}</div></div></div>`)}</div></div>` : ''}
      ${p.stories?.length ? html`<div><div class="eb">Stories to have ready</div><ul class="s ink2" style="margin:6px 0 0 18px">${p.stories.map(x => html`<li style="margin-bottom:4px">${x}</li>`)}</ul></div>` : ''}
      ${p.ask_them?.length ? html`<div><div class="eb">Ask them</div><ul class="s ink2" style="margin:6px 0 0 18px">${p.ask_them.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
      ${p.watch_outs?.length ? html`<div><div class="eb">Be careful with</div><ul class="s ink2" style="margin:6px 0 0 18px">${p.watch_outs.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
    </div>` : d.preparing ? '' : html`<div class="card row"><div class="grow"><h4>No prep pack yet</h4><p class="s m">Likely questions with your answers, stories to have ready, and what to ask them.</p></div><button class="btn p" data-act="prep">Prepare me</button></div>`}
  </div>
  <div class="col" style="gap:14px">
    <div class="card"><h4>Your notes</h4><p class="xs m" style="margin-top:3px">What was said, what you promised, who else to talk to.</p>
      <form data-act="notes" class="col" style="margin-top:8px;gap:8px"><textarea name="notes" rows="8" aria-label="Your notes">${t.notes}</textarea><button class="btn sm" style="align-self:flex-end">Save notes</button></form></div>
    <div class="card"><h4>Change it</h4><form data-act="edit" class="col" style="margin-top:8px;gap:8px"><label class="field">Title<input type="text" name="title" value="${t.title}"></label>
      <div class="grid2"><label class="field">When<input type="datetime-local" name="at" value="${local(t.at)}"></label><label class="field">Minutes<input type="number" name="minutes" value="${t.minutes}" min="10" max="480"></label></div>
      <label class="field">Link<input type="url" name="link" value="${t.link}"></label>
      <div class="row"><button class="btn sm">Save</button>${p ? html`<button type="button" class="btn sm" data-act="prep">Prepare again</button>` : ''}<span class="grow"></span><button type="button" class="btn sm danger" data-act="remove" data-confirm="Remove this conversation?">Remove</button></div></form></div>
    ${t.person_id ? html`<a class="btn" href="#/people/${t.person_id}">Open ${t.person}</a>` : ''}${t.role_id ? html`<a class="btn" href="#/roles/${t.role_id}">Open the role</a>` : ''}
  </div></div>`;
}

const ts = v => Math.floor(new Date(v).getTime() / 1000);

export default {
  title: (d, route) => route.parts[1] ? d.talk.title : 'Interviews',
  sub: (d, route) => route.parts[1] ? when(d.talk.at) : 'Conversations and interviews, with you prepared for each',
  topics: ['talks'],
  load: route => route.parts[1] ? api('talks/' + route.parts[1]) : api('talks'),
  view: (d, route) => route.parts[1] ? one(d) : list(d, route),
  actions: {
    async add({ f }) {
      const at = ts(f.at);
      if (!at) throw new Error('Choose when it is.');
      const r = await post('talks', { kind: f.kind, title: f.title.trim(), at, minutes: +f.minutes || 30, link: f.link, role_id: +f.role_id || 0, person_id: +f.person_id || 0 });
      location.hash = `#/interviews/${r.id}`;
      return false;
    },
    prep: ({ route }) => post(`talks/${route.parts[1]}/prep`),
    notes: ({ route, f }) => put(`talks/${route.parts[1]}`, { notes: f.notes }).then(() => toast('Saved')),
    edit: ({ route, f }) => put(`talks/${route.parts[1]}`, { title: f.title, at: ts(f.at), minutes: +f.minutes, link: f.link }).then(() => toast('Saved')),
    async remove({ route }) { await del(`talks/${route.parts[1]}`); location.hash = '#/interviews'; return false; },
  },
};
