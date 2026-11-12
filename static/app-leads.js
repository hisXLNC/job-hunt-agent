// Job Hunt screens, continued. Leads: people saying they're hiring and companies that just raised
// money, to write to directly. You write the message; Job Hunt gives the points worth making.
'use strict';

let leadsShow = 'open';
const leadDay = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

/** One person at a lead: who they are, how to reach them, your message, and where it stands. */
function leadPersonHtml(l, p, i) {
  const id = esc(l.id), box = `leadMsg-${l.id.replace(/[^a-z0-9]/gi, '')}-${i}`;
  const state = p.replied_at ? `<span class="pill good">Replied ${esc(leadDay(p.replied_at))}</span>`
    : p.followed_at ? `<span class="pill">Followed up ${esc(leadDay(p.followed_at))}</span>`
    : p.due ? `<span class="pill warn">No reply since ${esc(leadDay(p.sent_at))}: follow up once</span>`
    : p.sent_at ? `<span class="pill">Written to ${esc(leadDay(p.sent_at))}</span>` : '';
  const done = p.followed_at || p.replied_at || (p.sent_at && !p.due);
  const mail = p.email ? `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(l.role ? `${l.role} at ${l.company}` : `Working with ${l.company}`)}&body=` : '';
  return `<div class="lead-person" data-lead="${id}" data-i="${i}">
      <div class="lead-who"><span class="grow"><b>${esc(p.name)}</b>${p.role ? ` <span class="muted">${esc(p.role)}</span>` : ''}</span>${state}</div>
      <div class="lead-reach small">
        ${p.link ? `<a href="#" data-act="openUrl" data-url="${esc(p.link)}">Their profile</a>` : '<span class="muted">No profile link</span>'}
        <label class="lead-email">Email <input type="email" data-leadf="email" value="${esc(p.email)}" placeholder="not known" autocomplete="off">${p.guess ? '<span class="pill warn" title="Their first name at the company\'s site: a common pattern, but nobody published this address. It may bounce.">likely, not checked</span>' : ''}</label>
      </div>
      ${done ? (p.message ? `<details class="lead-sent"><summary class="small muted">What you wrote</summary><div class="posting" id="${box}">${esc(p.message)}</div></details>` : '')
        : `<textarea id="${box}" data-leadf="message" rows="4" placeholder="${p.sent_at ? 'One short follow-up: a new point, and the offer of a call.' : 'Write it yourself: short and direct, the way you\'d say it. Why now, one thing you\'ve done that they need, and a question.'}">${esc(p.message)}</textarea>
        <div class="row lead-acts">
          ${p.link ? `<button class="btn sm primary" data-act="leadCopyOpen" data-from="${box}" data-url="${esc(p.link)}">Copy it and open their profile</button>` : ''}
          ${mail ? `<button class="btn sm${p.link ? '' : ' primary'}" data-act="leadMail" data-from="${box}" data-mail="${esc(mail)}">Open it as an email</button>` : ''}
          <button class="btn sm" data-act="leadSent">${p.sent_at ? 'I sent the follow-up' : 'I sent it'}</button>
          <span class="grow"></span>
          <button class="btn ghost sm" data-act="leadDraft" title="A starting point written from your CV, for you to rewrite. A message in your own words lands better than a polished one.">Rough draft</button>
        </div>`}
      ${p.sent_at ? `<div class="row lead-acts"><button class="btn ghost sm" data-act="leadReplied">${p.replied_at ? 'They didn\'t reply after all' : 'They replied'}</button></div>` : ''}
    </div>`;
}

function leadHtml(l, ready) {
  const id = esc(l.id);
  const kind = l.kind === 'funding' ? '<span class="pill info">Raised money</span>' : '<span class="pill info">Hiring post</span>';
  const from = { linkedin: 'LinkedIn', web: 'found on the web', you: 'added by you' }[l.source] || '';
  return `<section class="card lead${l.status === 'aside' ? ' aside' : ''}" data-lead-card="${id}">
      <div class="lead-top">${avatar(l.company || '?')}<div class="grow"><h2>${esc(l.company || 'A hiring post')}</h2><div class="facts">${l.about ? `<span>${esc(l.about)}</span>` : ''}${l.site ? `<span><a href="#" data-act="openUrl" data-url="https://${esc(l.site)}">${esc(l.site)}</a></span>` : ''}</div></div>
        ${l.fit == null ? `<span class="muted small">${ready ? 'Not read yet' : 'Read once Claude is set up'}</span>` : scoreBadge(l.fit)}</div>
      <div class="dtags">${kind}${l.role ? `<span class="pill">${esc(l.role)}</span>` : l.kind === 'funding' ? '<span class="pill">No role advertised yet</span>' : ''}<span class="muted small">${esc([from, ago(l.found_at)].filter(Boolean).join(' · '))}</span></div>
      ${l.kind === 'funding' || !l.text ? `<p class="lead-detail">${esc(l.detail)}${l.url ? ` <a href="#" data-act="openUrl" data-url="${esc(l.url)}">Where it was found</a>` : ''}</p>`
        : `<details class="lead-post"><summary>${esc(l.detail)}${l.detail.length >= 160 ? '…' : ''}</summary><div class="posting">${esc(l.text)}</div></details>${l.url ? `<p class="small"><a href="#" data-act="openUrl" data-url="${esc(l.url)}">Open the post</a></p>` : ''}`}
      ${(l.help || []).length ? `<div class="why"><b>Where you'd help</b><ul>${l.help.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      ${(l.points || []).length ? `<div class="why"><b>Worth saying</b><ul>${l.points.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      <h3 class="lead-h">Who to write to</h3>
      ${(l.people || []).map((p, i) => leadPersonHtml(l, p, i)).join('') || '<p class="muted small">Nobody yet. Add the founder or whoever leads this work.</p>'}
      ${(l.emails || []).length ? `<p class="small muted">On their site: ${l.emails.map(e => `<a href="#" data-act="openUrl" data-url="mailto:${esc(e)}">${esc(e)}</a>`).join(', ')}</p>` : ''}
      <div class="row lead-foot">
        <details class="lead-more"><summary class="btn ghost sm">Add someone</summary>
          <form class="lead-add" data-lead="${id}" data-i="${(l.people || []).length}"><input name="name" placeholder="Name" required><input name="role" placeholder="Role"><input name="link" placeholder="Profile link"><button class="btn sm" data-act="leadPerson">Add</button></form></details>
        ${l.site ? `<button class="btn ghost sm" data-act="leadEmails" data-lead="${id}" title="Reads the contact, about and careers pages of ${esc(l.site)} for addresses it publishes">Look for addresses on their site</button>`
          : `<details class="lead-more"><summary class="btn ghost sm">Their website</summary><form class="lead-add" data-lead="${id}"><input name="site" placeholder="acme.com" required><button class="btn sm" data-act="leadSite">Save</button></form></details>`}
        <span class="grow"></span>
        <button class="btn ghost sm" data-act="${l.status === 'aside' ? 'leadBack' : 'leadAside'}" data-lead="${id}">${l.status === 'aside' ? 'Bring it back' : 'Not for me'}</button>
      </div>
    </section>`;
}

async function showLeads() {
  const d = await api('/api/leads');
  const open = d.leads.filter(l => l.status !== 'aside' && !l.wrote), wrote = d.leads.filter(l => l.status !== 'aside' && l.wrote), aside = d.leads.filter(l => l.status === 'aside');
  if (leadsShow === 'wrote' && !wrote.length || leadsShow === 'aside' && !aside.length) leadsShow = 'open';
  const list = { open, wrote, aside }[leadsShow];
  const unread = d.leads.filter(l => l.fit == null && l.status !== 'aside').length;
  const due = wrote.filter(l => l.people.some(p => p.due)).length;
  const seg = (k, name, n) => `<button type="button" data-act="leadsShow" data-show="${k}" class="${leadsShow === k ? 'on' : ''}" ${n || k === 'open' ? '' : 'disabled'}>${name} <span class="n">${n}</span></button>`;
  page(`<div class="head">
      <div class="grow"><h1>Leads</h1><p class="muted">People saying they're hiring, and companies that just raised money. Write to them directly: there's no posting to apply to, and often no queue of applicants yet.</p></div>
    </div>
    ${queueTabs('leads')}
    <section class="card lead-ways">
      <div class="lead-way"><b>Hiring posts on LinkedIn</b>
        <p class="small muted">Open a search in your browser, then press the Job Hunt extension's button on that page and choose <b>Send this page's hiring posts</b>. Scroll first to read more of them.</p>
        <div class="row">${d.linkedin.length ? d.linkedin.map(s => `<button class="btn sm" data-act="openUrl" data-url="${esc(s.url)}" title="LinkedIn posts from the last week that say hiring and ${esc(s.title)}, newest first">${esc(s.title)}</button>`).join('') : '<span class="small muted">Add the job titles you look for (Me, Looking for) and searches for each appear here.</span>'}</div>
        ${d.extension ? '' : '<p class="small"><a href="#settings/extension">Set up the browser extension</a> first: it reads the posts on the page you\'re looking at.</p>'}</div>
      <div class="lead-way"><b>Funding news and posts on the web</b>
        <p class="small muted">Claude searches for seed and Series A rounds from the last three weeks, and for founders' own hiring posts, in your field. ${d.last ? `Last looked ${esc(ago(d.last))}.` : 'Not looked yet.'}</p>
        <div class="row"><button class="btn sm" data-act="leadsFind" ${d.searching || !d.can_search ? 'disabled' : ''}>${d.searching ? '<span class="spin"></span>Looking…' : `${svg('search')}Look now`}</button>
          <label class="check small" title="One web search a day, after your daily job search. It uses some of your Claude usage."><input type="checkbox" data-leadf="daily" ${d.daily ? 'checked' : ''} ${d.can_search ? '' : 'disabled'}> Look once a day</label></div>
        ${d.can_search ? '' : '<p class="small muted">This needs Claude Code on this PC (Settings, Accounts). Posts you send from your browser work without it.</p>'}
        ${d.error ? `<p class="small crit-text">The last look didn't work: ${esc(d.error)}</p>` : ''}</div>
      <div class="lead-way"><b>One you found yourself</b>
        <form class="lead-own"><textarea name="text" rows="2" placeholder="Paste a hiring post or a piece of funding news"></textarea>
          <div class="row"><input name="url" placeholder="Its link (optional)"><button class="btn sm" data-act="leadAdd">Add it</button></div></form></div>
    </section>
    ${d.leads.length ? `<div class="row lead-bar"><span class="seg" role="group" aria-label="Which leads">${seg('open', 'To write to', open.length)}${seg('wrote', due ? `Written to (${due} to follow up)` : 'Written to', wrote.length)}${seg('aside', 'Set aside', aside.length)}</span>
      ${unread && d.ready ? `<span class="grow"></span><button class="btn sm" data-act="leadsRead">Read ${unread} against my CV</button>` : ''}</div>` : ''}
    ${list.map(l => leadHtml(l, d.ready)).join('') || `<section class="card decision done"><div class="dtop"><span class="bigicon good">${svg('check')}</span><div class="grow"><p class="kicker">${d.leads.length ? 'Nothing here' : 'No leads yet'}</p>
      <h2>${d.leads.length ? 'No leads waiting for you' : 'Start with a LinkedIn search above'}</h2><div class="facts"><span>${d.leads.length ? 'New ones come in when you send posts from your browser or look on the web.' : 'Each post that says someone is hiring comes here with how well you fit, where you\'d help, and who to write to.'}</span></div></div></div></section>`}`);
  if (d.searching) setTimeout(() => { if (location.hash === '#leads' && !pageDirty) route(); }, 8000);
}

/** What the Leads tab's buttons do. */
async function leadAct(el) {
  const a = el.dataset.act;
  const row = el.closest('[data-lead]');
  const id = row?.dataset.lead, i = Number(row?.dataset.i || 0);
  const post = (path, body) => api(`/api/leads/${path}`, { method: 'POST', body });
  const one = (action, body) => post(`${encodeURIComponent(id)}/${action}`, body);
  const busy = async (fn, done) => {
    el.disabled = true;
    try { await fn(); if (done) toast(done); } catch (e) { toast(e.message, true); } finally { el.disabled = false; }
  };
  const redraw = async () => { pageDirty = false; await refreshOverview().catch(() => {}); route(); };
  /** What's typed in the person's box, saved before anything is done with it. */
  const keep = async () => { const t = row?.querySelector('textarea[data-leadf=message]'); if (t) await one('person', { index: i, message: t.value }); return t?.value.trim() || ''; };
  if (a === 'openUrl') return api('/api/open-url', { method: 'POST', body: { url: el.dataset.url } }).catch(e => toast(e.message, true));
  if (a === 'leadsShow') { leadsShow = el.dataset.show; return route(); }
  if (a === 'leadsFind') return busy(async () => { await post('find'); toast('Looking on the web: this takes a few minutes. New leads appear here.'); route(); });
  if (a === 'leadsRead') return busy(async () => { toast('Reading them against your CV…'); await post('read'); await redraw(); });
  if (a === 'leadAdd') {
    const f = el.closest('form');
    return busy(async () => { await post('add', { url: f.elements.url.value, text: f.elements.text.value }); leadsShow = 'open'; await redraw(); }, 'Added to your leads.');
  }
  if (a === 'leadAside' || a === 'leadBack') return busy(async () => { await one(a === 'leadAside' ? 'aside' : 'back'); await redraw(); });
  if (a === 'leadSite') { const f = el.closest('form'); return busy(async () => { await one('site', { site: f.elements.site.value }); await redraw(); }); }
  if (a === 'leadEmails') return busy(async () => { toast('Reading their site…'); const r = await one('emails'); toast(r.found ? `Found ${r.found} address${r.found === 1 ? '' : 'es'} on their site.` : 'Their site publishes no addresses.'); await redraw(); });
  if (a === 'leadPerson') {
    const f = el.closest('form');
    if (!f.elements.name.value.trim()) return toast('Give their name.', true);
    return busy(async () => { await one('person', { index: i, name: f.elements.name.value, role: f.elements.role.value, link: f.elements.link.value }); await redraw(); });
  }
  if (a === 'leadDraft') {
    const had = row.querySelector('textarea')?.value.trim();
    if (had && !confirm('Replace what you wrote with a rough draft?')) return;
    return busy(async () => { toast('Writing a rough draft…'); await one('draft', { index: i }); await redraw(); toast('A starting point. Rewrite it in your own words before you send it.'); });
  }
  if (a === 'leadCopyOpen' || a === 'leadMail') {
    const text = await keep().catch(() => '');
    if (!text) return toast('Write your message first (or ask for a rough draft).', true);
    if (a === 'leadMail') return api('/api/open-url', { method: 'POST', body: { url: el.dataset.mail + encodeURIComponent(text) } }).then(() => toast('Opened in your email. Once it\'s sent, press I sent it here.')).catch(e => toast(e.message, true));
    try { await navigator.clipboard.writeText(text); } catch (e) { return toast('Select your message and copy it, then open their profile.', true); }
    return api('/api/open-url', { method: 'POST', body: { url: el.dataset.url } }).then(() => toast('Copied. On their profile: Connect with a note, or Message, then paste. Then press I sent it here.')).catch(e => toast(e.message, true));
  }
  if (a === 'leadSent') return busy(async () => { await keep(); await one('sent', { index: i }); await redraw(); }, 'Marked sent. If there\'s no reply in a week, Job Hunt suggests one follow-up.');
  if (a === 'leadReplied') return busy(async () => { await one('replied', { index: i }); await redraw(); });
}

// What you type is kept as you leave the box: your message, an address, the daily look.
document.addEventListener('change', async e => {
  const t = e.target;
  if (!t.matches?.('[data-leadf]')) return;
  e.stopPropagation();
  try {
    if (t.dataset.leadf === 'daily') { await api('/api/leads/daily', { method: 'POST', body: { on: t.checked } }); toast(t.checked ? 'Job Hunt looks for leads on the web once a day.' : 'The daily look is off.'); return; }
    const row = t.closest('[data-lead]');
    await api(`/api/leads/${encodeURIComponent(row.dataset.lead)}/person`, { method: 'POST', body: { index: Number(row.dataset.i), [t.dataset.leadf]: t.value } });
    if (t.dataset.leadf === 'email') { pageDirty = false; route(); }
  } catch (err) { toast(err.message, true); }
});
