import { html, api, post, put, del, ago, when, tile, toast, copy, pager, with_, employer, rel } from '../app.js';

const KINDS = { interview: ['Wants to talk', 'good'], assessment: ['Assessment', 'warn'], question: ['Asks you something', 'blue'], offer: ['Offer', 'good'], rejection: ['Said no', 'crit'], receipt: ['Received', ''], person: ['From a person', 'blue'], other: ['Other', ''] };
const chip = k => { const [l, c] = KINDS[k] || [k, '']; return html`<span class="chip ${c}">${l}</span>`; };

function list(d, route) {
  const q = route.q;
  return html`<div class="body cols wide"><div class="col" style="gap:14px">
    ${!d.on ? html`<div class="card row"><div class="grow"><h4>Your inbox isn't connected</h4><p class="s m">Connect it and Job Hunt notices replies by itself: it opens only mail from employers you applied to, hiring systems and people you wrote to. It never sends anything. Or paste a message on the right.</p></div><a class="btn p" href="#/you/connections">Connect inbox</a></div>` : ''}
    ${d.note ? html`<div class="card" style="border-color:var(--crit)"><p class="s"><b style="color:var(--crit)">The inbox couldn't be read.</b> ${d.note}</p></div>` : ''}
    <div class="card row wrap" style="gap:6px;padding:12px 14px">
      <a class="chip ${!q.state && !q.kind ? 'on' : ''}" href="#/replies">Needs you <span style="opacity:.7">${d.waiting}</span></a>
      <a class="chip ${q.state === 'all' && !q.kind ? 'on' : ''}" href="${with_(route, { state: 'all', kind: '', page: '' })}">Everything</a>
      ${['interview', 'question', 'person', 'rejection', 'receipt'].map(k => html`<a class="chip ${q.kind === k ? 'on' : ''}" href="${with_(route, { state: 'all', kind: k, page: '' })}">${KINDS[k][0]}</a>`)}
      <span class="grow"></span>${d.on ? html`<span class="xs m">${d.last_at ? html`Checked ${rel(d.last_at)}` : ''}</span><button class="btn sm" data-act="check">${d.checking ? 'Checking…' : 'Check now'}</button>` : ''}</div>
    ${d.mail?.length ? html`<div class="card" style="padding:0"><table class="tbl"><thead><tr><th>From</th><th>What they say</th><th>About</th><th>When</th><th></th></tr></thead><tbody>
      ${d.mail.map(m => html`<tr><td style="width:22%"><div class="row">${tile(m.company || m.from_name, true, m.company_id)}<div><a class="t" href="#/replies/${m.id}">${m.from_name || m.from_addr || 'Unknown sender'}</a><span class="xs m">${employer(m.company, m.company_id)}</span></div></div></td>
        <td class="s">${chip(m.kind)} <span class="ink2">${m.summary || m.subject}</span>${m.state === 'new' && m.next ? html`<div class="xs" style="margin-top:2px"><b>Next:</b> ${m.next}</div>` : ''}</td>
        <td class="s">${m.role_id ? html`<a href="#/roles/${m.role_id}">${m.role}</a>` : html`<span class="m">–</span>`}</td><td class="s m" style="white-space:nowrap">${rel(m.at)}</td>
        <td style="text-align:right"><a class="btn sm ${m.state === 'new' ? 'p' : ''}" href="#/replies/${m.id}">${m.state === 'new' ? 'Read and reply' : 'Open'}</a></td></tr>`)}</tbody></table></div>${pager(d.total, d.page, d.size, route)}`
      : html`<div class="card empty"><h3>${q.state || q.kind ? 'Nothing here' : 'Nothing is waiting for you'}</h3><p>When an employer or someone you wrote to answers, it shows up here with a drafted reply.</p></div>`}
  </div>
  <div class="col" style="gap:14px"><div class="card"><h4>Paste a message</h4><p class="xs m" style="margin-top:3px">Got a reply somewhere Job Hunt can't see? Paste it and it is read, filed and answered like the rest.</p>
    <form data-act="paste" data-busy="Reading…" class="col" style="margin-top:8px;gap:8px"><label class="field">From<input type="text" name="from" placeholder="Dana Lee &lt;dana@company.com&gt;"></label><label class="field">Subject<input type="text" name="subject"></label>
      <label class="field">The message<textarea name="body" rows="7" required></textarea></label><button class="btn sm p" style="align-self:flex-start">Read it</button></form></div></div></div>`;
}

function one(m) {
  const to = m.from_addr, subj = /^re:/i.test(m.subject) ? m.subject : 'Re: ' + (m.subject || '');
  const mailto = to ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(m.draft || '')}` : '';
  return html`<div class="body cols wide"><div class="col" style="gap:14px">
    <div class="card col" style="gap:8px;padding:20px"><div class="row wrap" style="gap:8px">${chip(m.kind)}<span class="s m">${when(m.at)}</span>${m.role_id ? html`<a class="chip" href="#/roles/${m.role_id}">${m.role}</a>` : ''}${m.company_id ? html`<a class="chip" href="#/employer/${m.company_id}">${m.company}</a>` : ''}</div>
      <h2 style="font-size:20px">${m.summary || m.subject}</h2>${m.next ? html`<p><b>What to do:</b> ${m.next}</p>` : ''}</div>
    <div class="card"><div class="row"><div class="grow"><div class="eb">Their message</div><div class="s" style="margin-top:4px"><b>${m.from_name}</b> <span class="m">${m.from_addr}</span></div><div class="s m">${m.subject}</div></div></div>
      <div class="s pre" style="margin-top:12px;border-top:1px solid var(--line2);padding-top:12px">${m.body || 'The text of this message was not kept.'}</div></div>
  </div>
  <div class="col" style="gap:14px">
    <div class="card col" style="gap:8px"><div class="eb">Your reply · draft</div><p class="xs m">Job Hunt wrote it; fill the gaps in [brackets]. It opens in your own mail program and you press send.</p>
      <form data-act="savedraft" class="col" style="gap:8px"><textarea name="draft" rows="11" aria-label="Your reply">${m.draft}</textarea>
        <div class="row wrap"><button type="button" class="btn p" data-act="copydraft">Copy</button>${mailto ? html`<a class="btn" href="${mailto}" data-act="openmail">Open in my mail</a>` : ''}<span class="grow"></span><button class="btn sm">Save</button></div></form></div>
    <div class="card col" style="gap:8px"><h4>After that</h4>
      ${m.kind === 'interview' || m.kind === 'person' || m.kind === 'offer' ? html`<a class="btn" href="#/interviews?role=${m.role_id || ''}&person=${m.person_id || ''}&mail=${m.id}">Add the conversation to Interviews</a>` : ''}
      ${m.state === 'new' ? html`<button class="btn" data-act="done">Done with this one</button>` : html`<button class="btn" data-act="undone">Needs me again</button>`}
      <button class="btn sm danger" data-act="remove" data-confirm="Remove this message from Job Hunt? It stays in your inbox.">Remove from Job Hunt</button></div>
  </div></div>`;
}

export default {
  title: (d, route) => route.parts[1] ? (d.from_name || 'A reply') : 'Replies',
  sub: (d, route) => route.parts[1] ? d.subject : 'What came back, and what to answer',
  topics: ['mail'],
  load(route) {
    if (route.parts[1]) return api('mail/' + route.parts[1]);
    const q = route.q, u = new URLSearchParams({ size: 8, page: q.page || 1, state: q.state === 'all' ? '' : 'new', kind: q.kind || '' });
    return api('mail?' + u);
  },
  view: (d, route) => route.parts[1] ? one(d) : list(d, route),
  actions: {
    check: () => post('mail/check').then(() => toast('Checking your inbox')),
    async paste({ f }) { const r = await post('mail', f); toast('Read and filed'); if (r.id) { location.hash = `#/replies/${r.id}`; return false; } },
    savedraft: ({ route, f }) => put(`mail/${route.parts[1]}`, { draft: f.draft }).then(() => toast('Saved')),
    copydraft: ({ el }) => { copy(el.closest('form').querySelector('textarea').value); return false; },
    openmail({ el, data }) {
      const body = el.closest('form').querySelector('textarea').value, subj = /^re:/i.test(data.subject) ? data.subject : 'Re: ' + (data.subject || '');
      location.href = `mailto:${encodeURIComponent(data.from_addr)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
      return false;
    },
    done: ({ route }) => put(`mail/${route.parts[1]}`, { state: 'done' }),
    undone: ({ route }) => put(`mail/${route.parts[1]}`, { state: 'new' }),
    async remove({ route }) { await del(`mail/${route.parts[1]}`); location.hash = '#/replies'; return false; },
  },
};
