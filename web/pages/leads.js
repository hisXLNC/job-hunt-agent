import { html, api, post, put, toast, copy, listSize, endless, href, safeUrl, rel, employer } from '../app.js';

// Leads: ways in that are not postings. Hiring posts the side panel reads on
// LinkedIn, funding and growth news, and what the person pastes in. Claude
// sizes each one up; a first note and one follow-up are written only when the
// person presses the button for each, and they send them. Everything a lead says came from outside: it is only shown.

const KINDS = { post: 'Hiring post', news: 'News', yours: 'Added by you' };
const WORTH = { yes: ['good', 'Worth writing to'], maybe: ['warn', 'Maybe'], no: ['', 'Probably not'] };
const SHOW = [['open', 'To write to'], ['written', 'Written to'], ['dismissed', 'Set aside']];
const fitTone = v => (v >= 80 ? 'var(--fit-good)' : v >= 60 ? 'var(--fit-ok)' : 'var(--fit-low)');

function where(l) {
  if (l.replied_at) return html`<span class="chip good">Answered</span>`;
  if (l.due) return html`<span class="chip warn">Follow-up due</span>`;
  if (l.followed_at) return html`<span class="chip blue">Followed up ${rel(l.followed_at)}</span>`;
  if (l.sent_at) return html`<span class="chip blue">Written ${rel(l.sent_at)}</span>`;
  if (!l.read_at) return html`<span class="chip">Being read</span>`;
  const w = WORTH[l.read.worth] || WORTH.maybe;
  return html`<span class="chip ${w[0]}">${w[1]}</span>`;
}

function title(l) {
  return l.read.role && l.read_at ? l.read.role : l.headline || (l.author ? `Post by ${l.author}` : 'A lead');
}

function list(d, route) {
  const show = route.q.show || 'open', c = d.counts || {};
  const look = d.looking ? html`<span class="btn" disabled><span class="spin"></span>Looking…</span>`
    : d.can_search ? html`<button class="btn" data-act="find" data-busy="Starting…" title="Claude searches the news for employers in your field and city that raised money or are growing. About two minutes.">Look for news now</button>`
    : html`<a class="btn" href="#/settings/connections?open=claude" title="Searching the web needs your Claude sign-in or an API key.">Connect Claude</a>`;
  return html`<div class="body">
    <div class="card row wrap" style="gap:20px;padding:20px">
      <div class="grow" style="min-width:260px"><h2 style="font-size:20px">Write before the posting goes up.</h2>
        <p class="m" style="margin-top:4px;max-width:660px">Someone saying “we're hiring”, a company that just raised money or opened an office: a short note now reaches a person before a hundred applications do. Job Hunt sizes each lead up and says who to write to. Ask, and it writes the note; you read it, change what you like, and send it yourself.</p></div>
      <div class="col" style="gap:8px;align-items:flex-end">${look}
        <label class="row s" style="gap:8px"><button class="switch ${d.auto ? 'on' : ''}" role="switch" aria-checked="${d.auto ? 'true' : 'false'}" aria-label="Look for news by itself" data-act="auto" data-to="${d.auto ? '' : '1'}"></button>Look by itself a few times a week</label>
        ${d.looked ? html`<span class="xs m">Last looked ${rel(d.looked)}</span>` : ''}</div></div>
    <div class="cols wide"><div class="col" style="gap:14px">
      <div class="stick"><div class="tabs">${SHOW.map(([k, v]) => html`<a class="${k === show ? 'on' : ''}" href="${href('leads', k === 'open' ? {} : { show: k })}">${v} <span class="m">${c[k] || 0}</span>${k === 'written' && c.due ? html` <span class="chip warn" style="margin-left:4px;padding:1px 7px" title="Written to a week ago with no answer: one follow-up is worth sending.">${c.due} due</span>` : ''}</a>`)}</div></div>
      ${d.reading ? html`<p class="s m"><span class="spin"></span> Sizing up new leads…</p>` : ''}
      ${d.leads.length ? html`<div class="card" style="padding:0"><table class="tbl long"><thead><tr><th>Lead</th><th>Who to write to</th><th>Fit</th><th>Where it stands</th><th></th></tr></thead><tbody>
        ${d.leads.map(l => html`<tr><td style="width:40%"><a class="t" href="#/leads/${l.id}">${title(l)}</a><span class="xs m"><span class="chip" style="margin-right:4px">${KINDS[l.kind] || 'Lead'}</span>${l.company}${l.company && l.headline && l.read.role ? ' · ' : ''}${l.read.role ? l.headline : ''} · found ${rel(l.found_at)}</span></td>
          <td class="s ink2">${l.read.who?.[0] ? html`<b>${l.read.who[0].name || l.read.who[0].title}</b>${l.read.who[0].name ? html`<span class="xs m" style="display:block">${l.read.who[0].title}</span>` : ''}` : html`<span class="m">–</span>`}</td>
          <td>${l.read_at && l.read.hiring ? html`<b style="color:${fitTone(l.fit)}">${l.fit}</b>` : html`<span class="m">–</span>`}</td>
          <td>${where(l)}</td>
          <td style="text-align:right;white-space:nowrap">${show === 'dismissed' ? html`<button class="btn sm" data-act="restore" data-id="${l.id}">Bring back</button>` : html`<a class="btn sm ${!l.sent_at && l.read_at ? 'p' : ''}" href="#/leads/${l.id}">${l.due ? 'Follow up' : 'Open'}</a>`}</td></tr>`)}</tbody></table></div>${endless('leads', d.leads.length, d.total)}`
        : html`<div class="card empty"><h3>${show === 'written' ? 'Nobody written to yet' : show === 'dismissed' ? 'Nothing set aside' : 'No leads yet'}</h3><p>${show === 'open' ? 'Look for news, paste a post you came across, or open a LinkedIn search beside the side panel.' : ''}</p></div>`}
    </div>
    <div class="col" style="gap:14px">
      <div class="card"><h4>Add a lead</h4><p class="xs m" style="margin-top:3px">Paste a post or an article: someone hiring, a funding round, a new office. Job Hunt does not open LinkedIn pages itself.</p>
        <form data-act="add" class="col" style="margin-top:8px;gap:8px">
          <label class="field">What it says<textarea name="text" rows="5" required placeholder="Paste the post or the article"></textarea></label>
          <div class="grid2"><label class="field">Employer <span class="h">If you know it</span><input type="text" name="company"></label><label class="field">Link<input type="url" name="url" placeholder="https://"></label></div>
          <button class="btn sm p" style="align-self:flex-start">Add and size it up</button></form></div>
      <div class="card"><h4>Hiring posts on LinkedIn</h4><p class="xs m" style="margin-top:3px">Open a search, then press “Send hiring posts to Leads” in the side panel. It keeps the posts that read like someone hiring.</p>
        ${d.searches?.length ? html`<div class="col s" style="margin-top:10px;gap:6px">${d.searches.map(x => html`<a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">“hiring” ${x.title}</a>`)}</div>` : html`<p class="s m" style="margin-top:8px">Add the titles you look for under Radar first.</p>`}</div>
    </div></div></div>`;
}

function note(l, which, label) {
  const m = l.read[which] || {};
  if (!m.body) {
    // Nothing is written until the person asks for it.
    if (which === 'follow_up' && !l.read.note?.body) return html`<p class="s m">Write the first note before a follow-up.</p>`;
    return html`<div><button class="btn ${which === 'note' || l.due ? 'p' : ''}" data-act="write" data-which="${which}" data-busy="Writing…" title="Claude writes it now, from your CV and this lead. Nothing is sent.">${which === 'note' ? 'Write a note' : 'Write the follow-up'}</button></div>`;
  }
  return html`<form data-act="save" data-which="${which}" class="col" style="gap:8px">
    <label class="field">Subject <span class="h">For an e-mail; leave it out on LinkedIn</span><input type="text" name="subject" value="${m.subject || ''}"></label>
    <textarea name="body" rows="${which === 'note' ? 8 : 5}" aria-label="${label}">${m.body || ''}</textarea>
    <div class="row wrap"><button type="button" class="btn ${which === 'note' ? (l.sent_at ? '' : 'p') : (l.due ? 'p' : '')}" data-act="copy">Copy</button>
      ${which === 'note' && !l.sent_at ? html`<button type="button" class="btn" data-act="step" data-step="sent" data-to="1">I sent it</button>` : ''}
      ${which === 'follow_up' && l.sent_at && !l.followed_at && !l.replied_at ? html`<button type="button" class="btn" data-act="step" data-step="followed" data-to="1">I sent the follow-up</button>` : ''}
      <span class="grow"></span><button class="btn sm">Save changes</button><button type="button" class="btn sm ghost" data-act="write" data-which="${which}" data-busy="Writing…" data-confirm="Write it again? What is in the box now is replaced.">Write it again</button></div></form>`;
}

function one(l) {
  const r = l.read, url = safeUrl(l.url), authorUrl = safeUrl(l.author_url);
  const w = WORTH[r.worth] || WORTH.maybe;
  return html`<div class="body cols wide"><div class="col" style="gap:14px">
    <div class="card col" style="gap:8px;padding:20px"><div class="row wrap" style="gap:6px"><span class="chip">${KINDS[l.kind] || 'Lead'}</span>${l.read_at ? html`<span class="chip ${r.hiring ? w[0] : ''}">${r.hiring ? w[1] : 'Not hiring, as far as Job Hunt can tell'}</span>` : html`<span class="chip">Being read</span>`}${l.sent_at ? where(l) : ''}
        <span class="grow"></span>${l.read_at && r.hiring ? html`<span class="s m">fit</span><b style="font-size:18px;color:${fitTone(l.fit)}">${l.fit}</b>` : ''}</div>
      <h2 style="font-size:21px">${title(l)}</h2>
      <div class="s m">${l.company_id ? employer(l.company, l.company_id) : l.company}${r.place ? ` · ${r.place}` : ''} · found ${rel(l.found_at)}${l.source === 'linkedin' ? ' on LinkedIn' : l.source === 'web' ? ' in the news' : ''}</div>
      ${r.why ? html`<p class="ink2">${r.why}</p>` : ''}
      ${r.help?.length ? html`<div><div class="eb" style="margin:4px 0">Where you would help</div><ul style="margin:0 0 0 18px" class="s">${r.help.map(h => html`<li>${h}</li>`)}</ul></div>` : ''}</div>
    ${l.read_at ? html`<div class="card col" style="gap:10px"><div><div class="eb">${l.sent_at ? html`Your note · sent ${rel(l.sent_at)}` : r.note?.body ? 'Your note · draft' : 'Your note'}</div>
        <p class="xs m" style="margin-top:2px">${r.note?.body ? html`Job Hunt wrote it when you asked${r.edited ? '; you changed it' : ''}.` : 'Job Hunt writes a short note to the first person under “Who to write to” when you ask.'} Nothing is sent until you send it yourself.</p></div>${note(l, 'note', 'Your note')}</div>
      <div class="card col" style="gap:10px"><div class="row"><div class="grow"><div class="eb">${l.followed_at ? html`Follow-up · sent ${rel(l.followed_at)}` : 'One follow-up'}</div>
        <p class="xs m" style="margin-top:2px">${l.sent_at ? (l.due ? 'A week has gone by with no answer. One follow-up is worth sending; after that, let it go.' : 'For a week after your note, if there is no answer.') : 'For a week after your note, if there is no answer.'}</p></div>${l.due ? html`<span class="chip warn">Due</span>` : ''}</div>${note(l, 'follow_up', 'Follow-up')}</div>`
      : html`<div class="card"><p class="s"><span class="spin"></span> Claude is sizing this lead up.</p></div>`}
    <div class="card"><div class="row"><h4 class="grow">What it said</h4>${url ? html`<a class="s" href="${url}" target="_blank" rel="noopener noreferrer">Open the ${l.kind === 'news' ? 'article' : 'post'}</a>` : ''}</div>
      ${l.author ? html`<p class="s" style="margin-top:6px">${authorUrl ? html`<a href="${authorUrl}" target="_blank" rel="noopener noreferrer"><b>${l.author}</b></a>` : html`<b>${l.author}</b>`}${l.author_title ? html` <span class="m">· ${l.author_title}</span>` : ''}</p>` : ''}
      ${l.headline ? html`<p class="s" style="margin-top:6px"><b>${l.headline}</b></p>` : ''}
      <div class="quote pre s" style="margin-top:8px;max-height:none">${l.text}</div></div>
  </div>
  <div class="col" style="gap:14px">
    ${r.who?.length ? html`<div class="card"><h4>Who to write to</h4><div class="col" style="margin-top:10px;gap:12px">${r.who.map((x, i) => html`<div class="s"><b>${x.name || x.title}</b>${x.name ? html` <span class="m">· ${x.title}</span>` : ''}<div class="ink2">${x.why}</div>
        <div class="row wrap" style="gap:8px;margin-top:4px">${x.search ? html`<a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(x.search)}" target="_blank" rel="noopener noreferrer">Find on LinkedIn</a>` : ''}
        ${x.name && !(l.person_id && i === 0) ? html`<button class="btn sm ghost" data-act="person" data-who="${i}" title="Adds them under People, so the note and their answer are kept with them.">Add to People</button>` : ''}${l.person_id && i === 0 ? html`<a href="#/people/${l.person_id}">In People</a>` : ''}</div></div>`)}</div></div>` : ''}
    <div class="card col" style="gap:8px"><h4>What to do with it</h4>
      ${l.sent_at ? html`${l.replied_at ? html`<button class="btn sm" data-act="step" data-step="replied" data-to="">They didn't answer after all</button>` : html`<button class="btn sm p" data-act="step" data-step="replied" data-to="1">They answered</button>`}` : ''}
      ${l.role_id ? html`<a class="btn sm" href="#/roles/${l.role_id}">Open the role${l.role_name ? `: ${l.role_name}` : ''}</a>` : html`<button class="btn sm" data-act="role" data-busy="Adding…" title="Adds it to Roles, where it is read against your CV and a CV and letter are written if it fits.">Make it a role</button>`}
      ${l.company_id ? html`<a class="btn sm" href="#/employer/${l.company_id}">Open the employer</a>` : html`<button class="btn sm" data-act="employer" title="Watches this employer's job board for new postings.">Watch this employer</button>`}
      <button class="btn sm ghost" data-act="again" data-busy="Reading…" title="Claude sizes it up again. Notes already written stay as they are.">Read it again</button>
      ${l.state === 'dismissed' ? html`<button class="btn sm ghost" data-act="restore" data-id="${l.id}">Bring it back</button>` : html`<button class="btn sm ghost" data-act="dismiss">Set aside</button>`}</div>
  </div></div>`;
}

export default {
  title: (d, route) => (route.parts[1] ? title(d) : 'Leads'),
  sub: (d, route) => (route.parts[1] ? d.company || 'A lead' : 'People hiring before the posting, and who to write to'),
  topics: ['leads', 'status'],
  load(route) {
    if (route.parts[1]) return api('leads/' + route.parts[1]);
    return api('leads?' + new URLSearchParams({ show: route.q.show || 'open', size: listSize('leads') }));
  },
  view: (d, route) => (route.parts[1] ? one(d) : list(d, route)),
  actions: {
    find: () => post('leads/find').then(() => toast('Looking. This takes a minute or two.')),
    auto: ({ d }) => put('leads/auto', { on: !!d.to }),
    async add({ f }) { const r = await post('leads', f); location.hash = `#/leads/${r.id}`; return false; },
    restore: ({ d, route }) => post(`leads/${d.id || route.parts[1]}/restore`),
    dismiss: async ({ route }) => { await post(`leads/${route.parts[1]}/dismiss`); toast('Set aside'); location.hash = '#/leads'; return false; },
    save: ({ el, f, route }) => put(`leads/${route.parts[1]}`, { which: el.dataset.which, subject: f.subject || '', body: f.body }).then(() => toast('Saved')),
    async copy({ el, route }) {
      const form = el.closest('form'), body = form.querySelector('textarea').value;
      await put(`leads/${route.parts[1]}`, { which: form.dataset.which, subject: form.querySelector('[name=subject]').value, body });
      await copy(body);
    },
    step: ({ d, route }) => post(`leads/${route.parts[1]}/${d.step}`, { on: !!d.to }).then(() => {
      if (d.to && d.step === 'sent') toast('Noted. In a week with no answer, the follow-up is ready.');
    }),
    again: ({ route }) => post(`leads/${route.parts[1]}/again`),
    write: ({ d, route }) => post(`leads/${route.parts[1]}/write`, { which: d.which }),
    async role({ route }) { const r = await post(`leads/${route.parts[1]}/role`); location.hash = `#/roles/${r.id}`; return false; },
    employer: ({ route }) => post(`leads/${route.parts[1]}/employer`).then(() => toast('Watching this employer')),
    person: ({ d, route }) => post(`leads/${route.parts[1]}/person`, { who: +d.who }).then(() => toast('Added to People')),
  },
};
