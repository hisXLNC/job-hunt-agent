import { html, api, post, ago, when, rings, tile, toast, copy, safeUrl, stageChip, freshness, openAssistant, BAND, STAGE, KIND } from '../app.js';

const STRENGTH = { strong: ['You have it', 'good'], partly: ['Partly', 'warn'], gap: ['Gap', 'crit'] };

function cvSheet(c) {
  const contact = [c.contact?.location, c.contact?.email, c.contact?.phone, ...(c.contact?.links || [])].filter(Boolean).join(' · ');
  return html`<div class="sheet"><h5>${c.name}</h5>${c.headline ? html`<div>${c.headline}</div>` : ''}<div class="m" style="font-size:11.5px">${contact}</div>
    ${c.summary ? html`<p style="margin-top:8px">${c.summary}</p>` : ''}
    ${(c.sections || []).map(s => html`<h6>${s.title}</h6>${(s.items || []).map(it => html`${it.heading || it.org || it.dates ? html`<div class="ih"><span>${[it.heading, it.org].filter(Boolean).join(', ')}</span><span style="font-weight:400">${it.dates}</span></div>` : ''}${it.text ? html`<p>${it.text}</p>` : ''}${it.bullets?.length ? html`<ul>${it.bullets.map(b => html`<li>${b}</li>`)}</ul>` : ''}`)}`)}</div>`;
}

function why(rd) {
  if (!rd || (!rd.summary && !rd.asks?.length)) return '';
  return html`<div class="card"><div class="eb">Why</div><p style="margin-top:6px;font-size:14.5px">${rd.summary}</p>
    ${rd.asks?.length ? html`<table class="tbl" style="margin-top:10px"><thead><tr><th>What they ask for</th><th>What you have</th><th></th></tr></thead><tbody>
      ${rd.asks.map(a => { const [l, c] = STRENGTH[a.strength] || ['', '']; return html`<tr><td class="s" style="width:38%"><b>${a.ask}</b></td><td class="s ink2">${a.evidence}</td><td><span class="chip ${c}">${l}</span></td></tr>`; })}</tbody></table>` : ''}
    ${rd.concerns?.length ? html`<div style="margin-top:10px"><div class="eb">Worth knowing</div><ul class="s ink2" style="margin:4px 0 0 18px">${rd.concerns.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}</div>`;
}

// Who the person would be working for: the employer in general, and the part
// of it this posting is for. Shown only when there is something to say.
function who(d) {
  // A recruiter's posting is about its client, so there the posting's own account comes first.
  const viaAgency = d.reading?.agency && d.reading?.employer;
  const about = viaAgency ? d.reading.employer : d.company?.about || d.reading?.employer || '', team = d.reading?.division || '';
  if (!about && !team) return '';
  return html`<div class="card who">
    ${about ? html`<div><div class="eb">${viaAgency ? 'The employer, through a recruiter' : 'The employer'}</div><p>${about}</p>
      <div class="xs m">${viaAgency ? 'From this posting' : html`${d.company?.sector ? html`${d.company.sector} · ` : ''}${FROM[d.company?.about_from] || 'From this posting'} · <button class="link" data-act="fixabout">Correct this</button>`}</div></div>` : ''}
    ${team ? html`<div><div class="eb">The team this role is in</div><p>${team}</p><div class="xs m">From this posting</div></div>` : ''}
  </div>`;
}
const FROM = { posting: 'From its postings', claude: 'What Claude knows of it; check before you rely on it', you: 'In your words' };

function sent(d) {
  const r = d.role;
  if (d.preparing) return html`<div class="card row"><span class="spin"></span><div><h4>Writing your CV and letter</h4><p class="s m">Both at once. This takes about a minute and the page updates by itself.</p></div></div>`;
  if (!d.cv && (d.old_cv || d.letter)) return html`<div class="card col" style="gap:12px">
    <div class="row"><div class="grow"><div class="eb">From the old Job Hunt</div><h3 style="margin-top:4px">What you ${stageOrder(r.stage) >= 3 ? 'sent' : 'prepared'} for this role</h3></div>
      ${d.old_cv ? html`<a class="btn sm" href="/api/roles/${r.id}/old-cv">Download the CV</a>` : ''}</div>
    ${d.old_cv ? '' : html`<p class="s m">The CV file written for this role was not in what was brought over.</p>`}
    ${d.letter ? html`<div class="row"><h4 class="grow">Your letter · ${d.letter.trim().split(/\s+/).filter(Boolean).length} words</h4><button class="btn sm" data-act="copyletter">Copy</button><a class="btn sm" href="/api/roles/${r.id}/letter.docx">Download .docx</a></div>
      <form data-act="saveletter" class="col" style="gap:6px"><textarea name="text" rows="9" aria-label="Your letter">${d.letter}</textarea><div class="row"><span class="grow"></span><button class="btn sm">Save letter</button></div></form>` : ''}
    ${!r.closed && stageOrder(r.stage) < 3 ? html`<div class="hr"></div><div class="row"><p class="s m grow">Job Hunt can write both again from your CV as it is now, with every change shown.</p><button class="btn" data-act="prepare">Write them again</button></div>` : ''}
  </div>`;
  if (!d.cv) {
    if (r.fit < 0) return html`<div class="card row"><span class="spin"></span><div><h4>${d.reading_now ? 'Reading this role against your CV' : 'Not read yet'}</h4><p class="s m">Job Hunt reads each new role as soon as it finds it.</p></div>${d.reading_now ? '' : html`<span class="grow"></span><button class="btn sm" data-act="read">Read it now</button>`}</div>`;
    return html`<div class="card row"><div class="grow"><h4>Nothing is prepared for this role yet</h4><p class="s m">Job Hunt prepares strong fits by itself. Ask and it writes a tailored CV and a letter for this one.</p></div><button class="btn p" data-act="prepare">Prepare CV and letter</button></div>`;
  }
  const doc = d.cv.doc, on = doc.changes.filter(c => !c.off).length;
  return html`<div class="card col" style="gap:14px">
    <div class="row"><div class="grow"><div class="eb">What gets sent</div><h3 style="margin-top:4px">Your CV · ${on} of ${doc.changes.length} changes on, all from your own facts</h3></div>
      <select aria-label="CV to start from" data-on="change" data-act="switchcv" style="width:220px">${d.cvs.map(c => html`<option value="${c.id}" ${c.id === doc.cv_id ? 'selected' : ''}>From: ${c.name}</option>`)}</select>
      <a class="btn sm" href="/api/roles/${r.id}/cv.docx">Download .docx</a></div>
    <div class="col" style="gap:8px">${doc.changes.map((c, i) => html`<div class="row top-al" style="gap:12px;${c.off ? 'opacity:.55' : ''}">
      <button class="switch ${c.off ? '' : 'on'}" role="switch" aria-checked="${c.off ? 'false' : 'true'}" aria-label="Use this change" data-act="toggle" data-i="${i}" data-off="${c.off ? '' : '1'}"></button>
      <div class="grow s">${c.before ? html`<div><span class="del">${c.before}</span></div>` : ''}<div>${c.after ? html`<span class="ins">${c.after}</span>` : html`<i class="m">Removed</i>`}</div><div class="xs m" style="margin-top:2px">${c.why}</div></div></div>`)}
      ${!doc.changes.length ? html`<p class="s m">No changes were needed: your CV already speaks to this role.</p>` : ''}</div>
    ${doc.left_out?.length ? html`<details><summary class="s">${doc.left_out.length} thing${doc.left_out.length === 1 ? '' : 's'} left out on purpose</summary><ul class="s ink2" style="margin:6px 0 0 18px">${doc.left_out.map(x => html`<li><b>${x.what}</b>: ${x.why}</li>`)}</ul></details>` : ''}
    <details><summary class="s">See the whole CV as it will be sent</summary><div style="margin-top:10px">${cvSheet(d.cv.sent)}</div></details>
    <div class="hr"></div>
    <div class="row"><h3 class="grow">Your letter · ${(d.letter || '').trim().split(/\s+/).filter(Boolean).length} words</h3><button class="btn sm" data-act="copyletter">Copy</button><a class="btn sm" href="/api/roles/${r.id}/letter.docx">Download .docx</a></div>
    <form data-act="saveletter" class="col" style="gap:6px"><textarea name="text" rows="9" aria-label="Your letter">${d.letter || ''}</textarea><div class="row"><span class="xs m grow">Edit freely; what you save here is what the download contains.</span><button class="btn sm">Save letter</button></div></form>
    <div class="hr"></div>
    <div class="row"><div class="grow"><h3>A note straight to the hiring manager</h3><p class="s m">Sent alongside your application, not instead of it. Job Hunt writes it; you send it.</p></div><button class="btn sm" data-act="case" data-busy="Writing…">${d.case ? 'Write it again' : 'Write it'}</button></div>
    ${d.case ? html`<div class="quote s pre">${d.case.subject ? html`<b>${d.case.subject}</b>\n\n` : ''}${d.case.body}</div><div class="row"><button class="btn sm" data-act="copycase">Copy</button></div>` : ''}
  </div>`;
}

function side(d) {
  const r = d.role;
  return html`<div class="col" style="gap:14px">
    <div class="card"><h4>People at ${r.company}</h4>
      ${d.people?.length ? html`<div class="col" style="margin-top:10px;gap:10px">${d.people.map(p => html`<div class="row top-al">${tile(p.name, true)}<div class="grow"><a href="#/people/${p.id}"><b class="s">${p.name}</b></a><div class="xs m">${p.title}${p.knows_you_at ? html` · <b style="color:var(--good)">knows you</b>` : ''}</div></div><button class="btn sm" data-act="note" data-id="${p.id}" data-busy="Writing…">Write</button></div>`)}</div>`
        : html`<p class="s m" style="margin-top:6px">Nobody yet. A short note to someone on the team doubles the odds your application is read.</p>`}
      <a class="btn sm" style="margin-top:10px" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(r.company + ' ' + r.title.split(/[,(-]/)[0])}" target="_blank" rel="noopener noreferrer">Look for the team on LinkedIn</a></div>
    ${d.mail?.length ? html`<div class="card"><h4>Mail about this role</h4><div class="col" style="margin-top:10px;gap:8px">${d.mail.map(m => html`<a href="#/replies/${m.id}" class="s" style="color:inherit"><b>${m.subject || m.summary}</b><div class="xs m">${m.from_name} · ${ago(m.at)}</div></a>`)}</div></div>` : ''}
    ${d.talks?.length ? html`<div class="card"><h4>Conversations</h4><div class="col" style="margin-top:10px;gap:8px">${d.talks.map(t => html`<a href="#/interviews/${t.id}" class="s" style="color:inherit"><b>${t.title}</b><div class="xs m">${when(t.at)}</div></a>`)}</div></div>` : ''}
    <div class="card"><h4>What happened</h4><div class="col s" style="margin-top:10px;gap:8px">${(d.activity || []).map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:62px;flex:none;padding-top:1px">${ago(a.at)}</span><span>${a.text}</span></div>`)}${!(d.activity || []).length ? html`<span class="m">Found ${ago(r.first_seen_at)}.</span>` : ''}</div></div>
    <div class="card"><h4>Keep the record straight</h4><p class="xs m" style="margin-top:3px">If something happened outside Job Hunt, set it here.</p>
      <div class="row" style="margin-top:8px"><select aria-label="Stage" data-on="change" data-act="stage">${Object.entries(STAGE).filter(([k]) => k !== 'new').map(([k, v]) => html`<option value="${k}" ${r.stage === k ? 'selected' : ''}>${v}</option>`)}</select></div>
      <div class="row wrap" style="margin-top:8px;gap:6px">${r.closed ? html`<button class="btn sm" data-act="reopen">Bring back</button>` : html`<button class="btn sm" data-act="close" data-how="rejected">They said no</button><button class="btn sm" data-act="close" data-how="withdrawn">I withdrew</button>`}</div></div>
  </div>`;
}

export default {
  title: d => d.role.title,
  sub: d => [d.role.company, d.role.location, d.role.workplace].filter(Boolean).join(' · '),
  topics: ['roles', 'docs', 'people', 'mail'],
  load: route => api('roles/' + route.parts[1]),
  view(d) {
    const r = d.role, url = safeUrl(r.apply_url || r.url);
    return html`<div class="body">
      <div class="card row" style="gap:16px;padding:20px">${tile(r.company)}
        <div class="grow col" style="gap:6px"><div class="row wrap" style="gap:8px">${stageChip(r)}${BAND[r.band] ? html`<span class="chip">${BAND[r.band]}</span>` : ''}${freshness(r)}${r.pay ? html`<span class="s m">· ${r.pay}</span>` : ''}${r.gone_at ? html`<span class="chip warn">Posting taken down ${ago(r.gone_at)}</span>` : ''}</div>
          <h2 style="font-size:21px">${r.title}</h2><div class="s m">${r.company}${r.location ? html` · ${r.location}` : ''}${r.closed && r.closed_why ? html` · <b>${r.closed_why}</b>` : ''}</div></div>
        ${rings(r.fit, r.fit_tailored)}
        <div class="col" style="gap:6px">
          ${url ? html`<a class="btn p" href="${url}" target="_blank" rel="noopener noreferrer">Open the posting</a>` : ''}
          ${r.closed ? html`<button class="btn sm" data-act="reopen">Bring back</button>` : html`<div class="row" style="gap:6px">${stageOrder(r.stage) < 3 ? html`<button class="btn sm" data-act="applied">I applied</button>` : ''}<button class="btn sm ghost" data-act="no" data-confirm="Not interested in this role? It will never be shown again.">Not for me</button></div>`}
        </div></div>
      <div class="cols wide"><div class="col" style="gap:14px">${who(d)}${why(d.reading)}${sent(d)}
        <div class="card"><details ${d.cv || d.reading?.summary ? '' : 'open'}><summary>The posting</summary><div class="s pre ink2" style="margin-top:10px">${r.description || 'Job Hunt has no text for this posting. Open it to read it.'}</div></details></div></div>
        ${side(d)}</div></div>`;
  },
  actions: {
    prepare: ({ route }) => post(`roles/${route.parts[1]}/prepare`),
    read: ({ route }) => post(`roles/${route.parts[1]}/read`),
    applied: ({ route }) => post(`roles/${route.parts[1]}/applied`).then(() => toast('Marked as applied')),
    async no({ route }) { await post(`roles/${route.parts[1]}/no`); toast('It won\'t be shown again'); location.hash = '#/roles'; return false; },
    reopen: ({ route }) => post(`roles/${route.parts[1]}/reopen`),
    close: ({ route, d }) => post(`roles/${route.parts[1]}/close`, { stage: d.how }),
    stage: ({ route, value }) => post(`roles/${route.parts[1]}/stage`, { stage: value }),
    toggle: ({ route, d }) => post(`roles/${route.parts[1]}/change`, { index: +d.i, off: !!d.off }),
    switchcv: ({ route, value }) => { toast('Tailoring from the other CV…'); return post(`roles/${route.parts[1]}/cv`, { cv: +value }); },
    saveletter: ({ route, f }) => post(`roles/${route.parts[1]}/letter`, { text: f.text }).then(() => toast('Letter saved')),
    copyletter: ({ data }) => { copy(data.letter || ''); return false; },
    fixabout: ({ data }) => { openAssistant(`About ${data.role.company}: `, false); return false; },
    case: ({ route }) => post(`roles/${route.parts[1]}/case`),
    copycase: ({ data }) => { copy((data.case.subject ? data.case.subject + '\n\n' : '') + data.case.body); return false; },
    async note({ d, route }) { await post(`people/${d.id}/note`, { purpose: 'applied', role: +route.parts[1] }); location.hash = `#/people/${d.id}`; return false; },
  },
};

function stageOrder(s) { return Object.keys(STAGE).indexOf(s); }
void KIND;
