import { html, api, post, put, del, ago, tile, toast, copy, listSize, endless, with_, safeUrl, app, KIND, employer, rel } from '../app.js';

const FIVE = ['knows_work', 'made_move', 'same_roots', 'same_craft', 'mentor'];
const HINT = {
  knows_work: 'People at firms that already know your work.', made_move: 'People who made the same move you are making.',
  same_roots: 'People who share a school, employer or community with you.', same_craft: 'People who do the same specialised work.', mentor: 'Newcomer mentoring programmes in your field.',
};

function status(p) {
  const n = p.note;
  if (p.knows_you_at) return html`<span class="chip good">Knows you</span>`;
  if (!n) return html`<span class="chip">Not written to</span>`;
  if (n.state === 'draft') return html`<span class="chip warn">Note drafted</span>`;
  if (n.state === 'sent') return html`<span class="chip blue">Written ${rel(n.sent_at)}</span>`;
  if (n.state === 'quiet') return html`<span class="chip">No answer</span>`;
  return html`<span class="chip good">Answered</span>`;
}

function list(d, route) {
  const q = route.q;
  const count = k => (d.kinds || []).find(x => x.label === k)?.n || 0;
  return html`<div class="body">
    <div class="card row" style="gap:24px;padding:20px">
      <div style="text-align:center"><div class="big" style="font-size:40px;color:${d.know ? 'var(--good)' : 'var(--ink)'}">${d.know}</div><div class="xs" style="font-weight:600">${d.know === 1 ? 'person' : 'people'} in ${app.state.city || 'your city'}<br>${d.know === 1 ? 'knows' : 'know'} who you are</div></div>
      <div class="grow"><h2 style="font-size:20px">Newcomers get hired through conversations.</h2><p class="m" style="margin-top:4px;max-width:640px">Five kinds of people answer a short, specific note from someone new. Job Hunt finds them and writes the note; you read it, change what you like, and send it yourself.</p></div>
      <button class="btn p" data-act="find">${d.finding ? html`<span class="spin"></span>Looking…` : 'Find people for me'}</button></div>
    <div class="cols wide"><div class="col" style="gap:14px">
      <div class="stick"><div class="card col" style="gap:10px;padding:12px 14px"><div class="row wrap" style="gap:6px">
        <a class="chip ${!q.kind && !q.know ? 'on' : ''}" href="#/people">Everyone</a>
        ${FIVE.map(k => html`<a class="chip ${q.kind === k ? 'on' : ''}" href="${with_(route, { kind: k, know: ''})}" title="${HINT[k]}">${KIND[k]} <span style="opacity:.7">${count(k)}</span></a>`)}
        <a class="chip ${q.kind === 'recruiter' ? 'on' : ''}" href="${with_(route, { kind: 'recruiter', know: ''})}">Recruiters ${count('recruiter')}</a>
        <a class="chip ${q.kind === 'contact' ? 'on' : ''}" href="${with_(route, { kind: 'contact', know: ''})}">You know them ${count('contact')}</a>
        <a class="chip ${q.know ? 'on' : ''}" href="${with_(route, { know: 1, kind: ''})}">Know you ${d.know}</a></div>
        ${q.kind && HINT[q.kind] ? html`<p class="s m">${HINT[q.kind]}</p>` : ''}</div></div>
      ${d.people.length ? html`<div class="card" style="padding:0"><table class="tbl long"><thead><tr><th>Person</th><th>Why they would answer</th><th>Where it stands</th><th></th></tr></thead><tbody>
        ${d.people.map(p => html`<tr><td style="width:30%"><div class="row">${tile(p.name, true)}<div><a class="t" href="#/people/${p.id}">${p.name}</a><span class="xs m">${p.title}${p.title && p.company ? ' · ' : ''}${employer(p.company, p.company_id)}</span></div></div></td>
          <td class="s ink2"><span class="chip" style="margin-bottom:3px">${KIND[p.kind] || 'Contact'}</span><div>${p.why}</div></td><td>${status(p)}</td>
          <td style="text-align:right;white-space:nowrap">${p.note?.state === 'draft' ? html`<a class="btn sm p" href="#/people/${p.id}">Read and send</a>` : p.note ? html`<a class="btn sm" href="#/people/${p.id}">Open</a>` : html`<button class="btn sm" data-act="draft" data-id="${p.id}" data-busy="Writing…">Write a note</button>`}</td></tr>`)}</tbody></table></div>${endless('people', (d.people || []).length, d.total)}`
        : html`<div class="card empty"><h3>Nobody here yet</h3><p>Press “Find people for me”, or add someone you came across.</p></div>`}
    </div>
    <div class="col" style="gap:14px">
      ${d.doors?.doors?.length ? html`<div class="card"><h4>Who to look for</h4><p class="xs m" style="margin-top:3px">Kinds of people Job Hunt couldn't name. Each search opens on LinkedIn; add whoever looks right.</p>
        <div class="col" style="margin-top:10px;gap:10px">${d.doors.doors.slice(0, 5).map(x => html`<div class="s"><span class="chip">${KIND[x.kind] || ''}</span> <b>${x.title}</b>${x.company ? html` <span class="m">· ${x.company}</span>` : ''}<div class="ink2">${x.why}</div>
          <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(x.search || x.title)}" target="_blank" rel="noopener noreferrer">Search: ${x.search || x.title}</a></div>`)}</div></div>` : ''}
      <div class="card"><h4>Add someone</h4><form data-act="add" class="col" style="margin-top:8px;gap:8px">
        <div class="grid2"><label class="field">Name<input type="text" name="name" required></label><label class="field">Employer<input type="text" name="company_name"></label></div>
        <label class="field">Their role<input type="text" name="title"></label>
        <label class="field">Profile link<input type="url" name="url" placeholder="https://www.linkedin.com/in/…"></label>
        <label class="field">What you share<select name="kind">${Object.entries(KIND).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
        <label class="field">Why they might answer <span class="h">One line; it shapes the note.</span><input type="text" name="why"></label>
        <button class="btn sm p" style="align-self:flex-start">Add</button></form></div>
      <div class="card"><h4>People you already know</h4><p class="s m" style="margin-top:3px">Upload LinkedIn's Connections.csv (Settings → Data privacy → Get a copy of your data). Job Hunt keeps only the people who work at employers on your list; the rest of the file is not stored.</p>
        <label class="btn sm" style="margin-top:8px">Choose Connections.csv<input type="file" accept=".csv" hidden data-on="change" data-act="import"></label></div>
      <div class="card col" style="gap:8px">${noteLength(d)}</div>
    </div></div></div>`;
}

// How long a LinkedIn connect note may be: 300 characters with Premium, 200 on a free account.
const noteLimit = d => d.note_chars === 200 ? 200 : 300;
const noteLength = d => html`<label class="field">Your LinkedIn account <span class="h">A connect note can be 300 characters with Premium and 200 on a free account. Notes are written to fit.</span><select data-on="change" data-act="notechars"><option value="300" ${noteLimit(d) === 300 ? 'selected' : ''}>Premium: 300 characters</option><option value="200" ${noteLimit(d) === 200 ? 'selected' : ''}>Free: 200 characters</option></select></label>`;

function one(d) {
  const p = d.person, n = d.notes?.[0], url = safeUrl(p.url);
  const limit = n?.channel === 'linkedin' ? noteLimit(d) : 0;
  return html`<div class="body cols wide"><div class="col" style="gap:14px">
    <div class="card row" style="gap:16px;padding:20px">${tile(p.name)}<div class="grow"><div class="row wrap" style="gap:8px"><span class="chip">${KIND[p.kind] || 'Contact'}</span>${status({ ...p, note: n })}</div>
      <h2 style="font-size:21px;margin-top:4px">${p.name}</h2><div class="s m">${p.title}${p.title && p.company ? ' · ' : ''}${employer(p.company, p.company_id)}</div><p class="s ink2" style="margin-top:6px">${p.why}</p></div>
      <div class="col" style="gap:6px">${url ? html`<a class="btn" href="${url}" target="_blank" rel="noopener noreferrer">Open profile</a>` : ''}
        <button class="btn sm" data-act="knows" data-on-val="${p.knows_you_at ? '' : '1'}">${p.knows_you_at ? 'Doesn\'t know me yet' : 'We\'ve spoken'}</button></div></div>
    ${n ? html`<div class="card col" style="gap:10px"><div class="row"><div class="grow"><div class="eb">${n.state === 'draft' ? 'Your note · draft' : n.state === 'sent' ? html`Your note · sent ${rel(n.sent_at)}` : 'Your note'}</div>
        <p class="xs m" style="margin-top:2px">${n.channel === 'linkedin' ? 'For the LinkedIn connect box.' : 'An email.'} Job Hunt wrote it. Nothing is sent until you send it yourself.</p></div>
        ${limit ? html`<span class="chip ${n.body.length > limit ? 'crit' : ''}" id="count">${n.body.length} of ${limit}</span>` : ''}</div>
      <form data-act="save" data-id="${n.id}" class="col" style="gap:8px">
        ${n.channel === 'email' ? html`<label class="field">Subject<input type="text" name="subject" value="${n.subject}"></label>` : ''}
        <textarea name="body" rows="${n.channel === 'email' ? 9 : 5}" aria-label="Your note" data-limit="${limit}">${n.body}</textarea>
        <div class="row wrap">
          ${n.state === 'draft' ? html`<button type="button" class="btn p" data-act="copyopen" data-url="${url}">Copy${url ? ' and open their profile' : ''}</button><button type="button" class="btn" data-act="sent" data-id="${n.id}">I sent it</button>` : ''}
          ${n.state === 'sent' ? html`<button type="button" class="btn p" data-act="replied" data-id="${n.id}">They answered</button><button type="button" class="btn" data-act="nudge" data-busy="Writing…">Write a follow-up</button><button type="button" class="btn" data-act="quiet" data-id="${n.id}">Let it go</button>` : ''}
          ${n.state === 'replied' ? html`<button type="button" class="btn" data-act="thanks" data-busy="Writing…">Write a thank-you</button><a class="btn" href="#/interviews?person=${p.id}">Book a conversation</a>` : ''}
          <span class="grow"></span><button class="btn sm">Save changes</button><button type="button" class="btn sm" data-act="again" data-busy="Writing…">Write it again</button></div></form></div>`
      : html`<div class="card row"><div class="grow"><h4>No note yet</h4><p class="s m">Job Hunt writes a short, specific note with one clear ask. You read it and send it.</p></div><button class="btn p" data-act="again" data-busy="Writing…">Write a note</button></div>`}
    ${d.notes?.length > 1 ? html`<div class="card"><h4>Earlier notes</h4><div class="col" style="margin-top:10px;gap:10px">${d.notes.slice(1).map(x => html`<div class="s"><span class="xs m">${rel(x.sent_at || x.created_at)} · ${x.state}</span><div class="quote pre">${x.body}</div></div>`)}</div></div>` : ''}
  </div>
  <div class="col" style="gap:14px">
    <div class="card"><h4>About them</h4><form data-act="edit" class="col" style="margin-top:8px;gap:8px">
      <label class="field">Name<input type="text" name="name" value="${p.name}" required></label><label class="field">Their role<input type="text" name="title" value="${p.title}"></label>
      <label class="field">Profile link<input type="url" name="url" value="${p.url}"></label><label class="field">Email<input type="email" name="email" value="${p.email}"></label>
      <label class="field">What you share<select name="kind">${Object.entries(KIND).map(([k, v]) => html`<option value="${k}" ${p.kind === k ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field">Why they might answer<textarea name="why" rows="2">${p.why}</textarea></label>
      <div class="row"><button class="btn sm">Save</button><span class="grow"></span><button type="button" class="btn sm danger" data-act="remove" data-confirm="Remove ${p.name} and the notes to them?">Remove</button></div></form></div>
    ${n?.channel === 'linkedin' ? html`<div class="card col" style="gap:8px">${noteLength(d)}</div>` : ''}
    <div class="card"><h4>What happened</h4><div class="col s" style="margin-top:10px;gap:8px">${(d.activity || []).map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:62px;flex:none">${rel(a.at)}</span><span>${a.text}</span></div>`)}${!(d.activity || []).length ? html`<span class="m">Nothing yet.</span>` : ''}</div></div>
  </div></div>`;
}

export default {
  title: (d, route) => route.parts[1] ? d.person.name : 'People',
  sub: (d, route) => route.parts[1] ? [d.person.title, d.person.company].filter(Boolean).join(' · ') : 'Who to write to, and who has answered',
  topics: ['people'],
  load(route) {
    const chars = api('profile').then(p => p.note_chars || 300).catch(() => 300);
    if (route.parts[1]) return Promise.all([api('people/' + route.parts[1]), chars]).then(([d, c]) => ({ ...d, note_chars: c }));
    const q = route.q, u = new URLSearchParams({ size: listSize('people'), page: 1, kind: q.kind || '', know: q.know || '' });
    return Promise.all([api('people?' + u), chars]).then(([d, c]) => ({ ...d, note_chars: c }));
  },
  view: (d, route) => route.parts[1] ? one(d) : list(d, route),
  after(root) {
    const ta = root.querySelector('textarea[data-limit]'), c = root.querySelector('#count');
    if (ta && c && +ta.dataset.limit) ta.addEventListener('input', () => { c.textContent = `${ta.value.length} of ${ta.dataset.limit}`; c.classList.toggle('crit', ta.value.length > +ta.dataset.limit); });
  },
  actions: {
    notechars: ({ el }) => put('profile', { note_chars: +el.value }).then(() => toast(`Notes are written to fit ${el.value} characters from now on.`)),
    find: () => post('people/find').then(() => toast('Looking. This takes a minute or two.')),
    async draft({ d }) { await post(`people/${d.id}/note`, {}); location.hash = `#/people/${d.id}`; return false; },
    async add({ f }) { const r = await post('people', f); location.hash = `#/people/${r.id}`; return false; },
    async import({ el }) {
      const file = el.files[0];
      if (!file) return false;
      const r = await api('people/import', { method: 'POST', raw: file });
      toast(r.at_watched ? `${r.at_watched} of your connections work at employers on your list (${r.added} new).` : 'None of your connections work at employers on your list yet.');
    },
    save: ({ d, f }) => put(`notes/${d.id}`, { subject: f.subject || '', body: f.body }).then(() => toast('Saved')),
    async copyopen({ el, d }) { const form = el.closest('form'), body = form.querySelector('textarea').value; await put(`notes/${form.dataset.id}`, { subject: form.querySelector('[name=subject]')?.value || '', body }); await copy(body); if (d.url) window.open(d.url, '_blank', 'noopener'); },
    sent: ({ d }) => post(`notes/${d.id}/sent`).then(() => toast('Noted. Job Hunt reminds you in a week if they are quiet.')),
    replied: ({ d }) => post(`notes/${d.id}/replied`).then(() => toast('One more person who knows you')),
    quiet: ({ d }) => post(`notes/${d.id}/quiet`),
    again: ({ route }) => post(`people/${route.parts[1]}/note`, {}),
    nudge: ({ route }) => post(`people/${route.parts[1]}/note`, { purpose: 'nudge' }),
    thanks: ({ route }) => post(`people/${route.parts[1]}/note`, { purpose: 'thanks' }),
    knows: ({ route, el }) => put(`people/${route.parts[1]}`, { knows_you: !!el.dataset.onVal }),
    edit: ({ route, f }) => put(`people/${route.parts[1]}`, f).then(() => toast('Saved')),
    async remove({ route }) { await del(`people/${route.parts[1]}`); location.hash = '#/people'; return false; },
  },
};
