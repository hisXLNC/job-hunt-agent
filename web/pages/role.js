import { html, api, post, ago, when, rings, tile, toast, copy, safeUrl, stageChip, freshness, openAssistant, BAND, STAGE, KIND, employer, rel, LATER, dayName } from '../app.js';

const STYLE = { standard: 'Standard', formal: 'Formal', short: 'Short', warm: 'Warm' };
const words = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
const days = (from, now) => Math.max(1, Math.floor((now - from) / 86400));

// The files: Word to keep editing, PDF to send as it is.
function files(r, what, hint) {
  return html`<span class="xs m" title="${hint}">Download</span><a class="btn sm" href="/api/roles/${r.id}/${what}.docx" title="A Word file you can still edit.">Word</a><a class="btn sm" href="/api/roles/${r.id}/${what}.pdf" title="A PDF, ready to upload as it is.">PDF</a>`;
}

// Asking for a piece of writing to be done again, and the way back.
function ask(act, undo, prev, placeholder, label) {
  return html`<form data-act="${act}" class="row" style="gap:6px"><input type="text" name="ask" maxlength="600" placeholder="${placeholder}" aria-label="${label}"><button class="btn sm" data-busy="Writing…" title="Job Hunt writes it again with that done. What you have now is kept, so you can put it back.">Ask for changes</button></form>
    ${prev ? html`<div class="row xs m" style="gap:8px"><span>${prev.ask ? html`Written again as you asked: “${prev.ask}”.` : 'Written again in another style.'} The one before is kept.</span><button class="link" data-act="${undo}">Put it back</button></div>` : ''}`;
}

// The one follow-up to an application that has gone quiet.
function chase(d) {
  const r = d.role, c = d.chase;
  if (r.closed || r.stage !== 'applied' || !r.applied_at) return '';
  const quiet = `Applied ${days(r.applied_at, d.now)} days ago, no reply`;
  if (c?.sent_at) return html`<div class="card row"><div class="grow"><h4>You followed up ${ago(c.sent_at)}</h4><p class="s m">One follow-up is enough. If they answer, it shows under Replies.</p></div></div>`;
  if (c?.body && !c.dropped_at) return html`<div class="card col" style="gap:10px;border-color:var(--warn)">
    <div class="row"><div class="grow"><div class="eb">Follow up</div><h3 style="margin-top:4px">${quiet}</h3></div>${c.to ? html`<span class="s m">To ${c.to}${c.email ? html` · ${c.email}` : ''}</span>` : ''}</div>
    <form data-act="chasesave" class="col" style="gap:6px"><input type="text" name="subject" value="${c.subject}" aria-label="Subject"><textarea name="text" rows="8" aria-label="Your follow-up">${c.body}</textarea>
      <div class="row wrap" style="gap:6px"><span class="xs m grow" style="min-width:200px">Job Hunt wrote it; you send it, from your own mail.</span>
        <button class="btn sm">Save</button><button type="button" class="btn sm" data-act="chasecopy">Copy</button>
        <button type="button" class="btn sm" data-act="chasemail" title="Opens a new message in your mail program with this text in it. You press Send.">Open in my mail</button>
        <button type="button" class="btn sm p" data-act="chasesent" title="Records it in this role's history. Job Hunt won't suggest another.">I sent it</button>
        <button type="button" class="btn sm ghost" data-act="chasedrop" title="Stops suggesting a follow-up for this application.">Let it go</button></div></form></div>`;
  if (!d.chase_due) return '';
  return html`<div class="card row" style="border-color:var(--warn)"><div class="grow"><h4>${quiet}</h4><p class="s m">One short follow-up is normal; after that, let it go. Job Hunt writes it; you send it.</p></div>
    <button class="btn p sm" data-act="chase" data-busy="Writing…">Write follow-up</button><button class="btn sm ghost" data-act="chasedrop">Let it go</button></div>`;
}
const mailAddr = s => (/^[^\s@<>"',;:?&%#]+@[^\s@<>"',;:?&%#]+\.[^\s@<>"',;:?&%#]+$/.test(s || '') ? s : '');

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
    ${d.letter ? html`<div class="row wrap"><h4 class="grow">Your letter · ${words(d.letter)} words</h4><button class="btn sm" data-act="copyletter">Copy</button>${files(r, 'letter', 'The letter as it is saved here.')}</div>
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
      ${files(r, 'cv', 'Your CV with the changes that are switched on.')}</div>
    <div class="col" style="gap:8px">${doc.changes.map((c, i) => html`<div class="row top-al" style="gap:12px;${c.off ? 'opacity:.55' : ''}">
      <button class="switch ${c.off ? '' : 'on'}" role="switch" aria-checked="${c.off ? 'false' : 'true'}" aria-label="Use this change" data-act="toggle" data-i="${i}" data-off="${c.off ? '' : '1'}"></button>
      <div class="grow s">${c.before ? html`<div><span class="del">${c.before}</span></div>` : ''}<div>${c.after ? html`<span class="ins">${c.after}</span>` : html`<i class="m">Removed</i>`}</div><div class="xs m" style="margin-top:2px">${c.why}</div></div></div>`)}
      ${!doc.changes.length ? html`<p class="s m">No changes were needed: your CV already speaks to this role.</p>` : ''}</div>
    ${doc.left_out?.length ? html`<details><summary class="s">${doc.left_out.length} thing${doc.left_out.length === 1 ? '' : 's'} left out on purpose</summary><ul class="s ink2" style="margin:6px 0 0 18px">${doc.left_out.map(x => html`<li><b>${x.what}</b>: ${x.why}</li>`)}</ul></details>` : ''}
    <details><summary class="s">See the whole CV as it will be sent</summary><div style="margin-top:10px">${cvSheet(d.cv.sent)}</div></details>
    ${ask('askcv', 'undocv', doc.prev, 'For example: make more of the team I managed', 'What to change in the CV')}
    <div class="hr"></div>
    <div class="row wrap"><h3 class="grow">Your letter · ${words(d.letter)} words</h3>
      <select class="mini" aria-label="Letter style" data-on="change" data-act="letterstyle" title="Writes the letter again in this style. The one you have is kept, so you can put it back.">${(d.letter_styles || []).map(s => html`<option value="${s}" ${s === d.letter_style ? 'selected' : ''}>${STYLE[s] || s}</option>`)}</select>
      <button class="btn sm" data-act="copyletter">Copy</button>${files(r, 'letter', 'The letter as it is saved here.')}</div>
    <form data-act="saveletter" class="col" style="gap:6px"><textarea name="text" rows="9" aria-label="Your letter">${d.letter || ''}</textarea><div class="row"><span class="xs m grow">Edit freely; what you save here is what the download contains.</span><button class="btn sm">Save letter</button></div></form>
    ${ask('askletter', 'undoletter', d.letter_prev, 'For example: shorter, and open with the Vertex project', 'What to change in the letter')}
    <div class="row wrap"><span class="s m grow">${d.pdf_gap ? html`<b style="color:var(--warn)">A PDF from Job Hunt shows Western European letters only, and these have others.</b> Use Word for this one.` : 'For a form that takes one file: the letter first, then your CV.'}</span><a class="btn sm" href="/api/roles/${r.id}/both.pdf">Letter and CV in one PDF</a></div>
    <div class="hr"></div>
    <div class="row"><div class="grow"><h3>A note straight to the hiring manager</h3><p class="s m">Sent alongside your application, not instead of it. Job Hunt writes it; you send it.</p></div><button class="btn sm" data-act="case" data-busy="Writing…">${d.case ? 'Write it again' : 'Write it'}</button></div>
    ${d.case ? html`<div class="quote s pre">${d.case.subject ? html`<b>${d.case.subject}</b>\n\n` : ''}${d.case.body}</div><div class="row"><button class="btn sm" data-act="copycase">Copy</button></div>` : ''}
  </div>`;
}

function side(d) {
  const r = d.role;
  return html`<div class="col" style="gap:14px">
    <div class="card"><h4>People at ${employer(r.company, r.company_id)}</h4>
      ${d.people?.length ? html`<div class="col" style="margin-top:10px;gap:10px">${d.people.map(p => html`<div class="row top-al">${tile(p.name, true)}<div class="grow"><a href="#/people/${p.id}"><b class="s">${p.name}</b></a><div class="xs m">${p.title}${p.knows_you_at ? html` · <b style="color:var(--good)">knows you</b>` : ''}</div></div><button class="btn sm" data-act="note" data-id="${p.id}" data-busy="Writing…">Write</button></div>`)}</div>`
        : html`<p class="s m" style="margin-top:6px">Nobody yet. A short note to someone on the team doubles the odds your application is read.</p>`}
      <a class="btn sm" style="margin-top:10px" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(r.company + ' ' + r.title.split(/[,(-]/)[0])}" target="_blank" rel="noopener noreferrer">Look for the team on LinkedIn</a></div>
    ${d.mail?.length ? html`<div class="card"><h4>Mail about this role</h4><div class="col" style="margin-top:10px;gap:8px">${d.mail.map(m => html`<a href="#/replies/${m.id}" class="s" style="color:inherit"><b>${m.subject || m.summary}</b><div class="xs m">${m.from_name} · ${rel(m.at)}</div></a>`)}</div></div>` : ''}
    ${d.talks?.length ? html`<div class="card"><h4>Conversations</h4><div class="col" style="margin-top:10px;gap:8px">${d.talks.map(t => html`<a href="#/interviews/${t.id}" class="s" style="color:inherit"><b>${t.title}</b><div class="xs m">${when(t.at)}</div></a>`)}</div></div>` : ''}
    <div class="card"><h4>What happened</h4><div class="col s" style="margin-top:10px;gap:8px">${(d.activity || []).map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:62px;flex:none;padding-top:1px">${rel(a.at)}</span><span>${a.text}</span></div>`)}${!(d.activity || []).length ? html`<span class="m">Found ${rel(r.first_seen_at)}.</span>` : ''}</div></div>
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
    const r = d.role, url = safeUrl(r.apply_url || r.url), later = !r.closed && r.later_until > d.now;
    return html`<div class="body">
      <div class="card row" style="gap:16px;padding:20px">${tile(r.company, false, r.company_id)}
        <div class="grow col" style="gap:6px"><div class="row wrap" style="gap:8px">${stageChip(r)}${BAND[r.band] ? html`<span class="chip">${BAND[r.band]}</span>` : ''}${freshness(r)}${r.pay ? html`<span class="s m">· ${r.pay}</span>` : ''}${r.gone_at ? html`<span class="chip warn">Posting taken down ${rel(r.gone_at)}</span>` : ''}</div>
          <h2 style="font-size:21px">${r.title}</h2><div class="s m">${employer(r.company, r.company_id)}${r.location ? html` · ${r.location}` : ''}${r.closed && r.closed_why ? html` · <b>${r.closed_why}</b>` : ''}</div></div>
        ${rings(r.fit, r.fit_tailored)}
        <div class="col" style="gap:6px">
          ${url ? html`<a class="btn p" href="${url}" target="_blank" rel="noopener noreferrer">Open the posting</a>` : ''}
          ${r.closed ? html`<button class="btn sm" data-act="reopen">Bring back</button>` : html`<div class="row" style="gap:6px">${stageOrder(r.stage) < 3 ? html`<button class="btn sm" data-act="applied">I applied</button>` : ''}${r.stage === 'applied' ? html`<button class="btn sm" data-act="unapply" title="Marked applied by mistake? This puts the role back where it was.">I didn't send it</button>` : ''}<button class="btn sm ghost" data-act="no" data-confirm="Not interested in this role? It will never be shown again.">Not for me</button></div>
            ${later ? html`<div class="row xs m" style="gap:6px"><span>Saved for later · back ${dayName(r.later_until)}</span><button class="link" data-act="later" data-days="0">Bring back now</button></div>`
              : html`<div class="row" style="justify-content:flex-end"><select class="mini" aria-label="Save for later" data-on="change" data-act="later" title="Leaves Today until then, and comes back by itself."><option value="">Save for later</option>${LATER.map(([n, label]) => html`<option value="${n}">${label}</option>`)}</select></div>`}`}
        </div></div>
      <div class="cols wide"><div class="col" style="gap:14px">${chase(d)}${who(d)}${why(d.reading)}${sent(d)}
        <div class="card"><details ${d.cv || d.reading?.summary ? '' : 'open'}><summary>The posting</summary><div class="s pre ink2" style="margin-top:10px">${r.description || 'Job Hunt has no text for this posting. Open it to read it.'}</div></details></div></div>
        ${side(d)}</div></div>`;
  },
  actions: {
    prepare: ({ route }) => post(`roles/${route.parts[1]}/prepare`),
    read: ({ route }) => post(`roles/${route.parts[1]}/read`),
    applied: ({ route }) => post(`roles/${route.parts[1]}/applied`).then(() => toast('Marked as applied', false, () => post(`roles/${route.parts[1]}/unapply`))),
    unapply: ({ route }) => post(`roles/${route.parts[1]}/unapply`).then(() => toast('Put back. It is no longer counted as applied.')),
    async no({ route }) { const id = route.parts[1]; await post(`roles/${id}/no`); toast('It won\'t be shown again', false, () => post(`roles/${id}/reopen`)); location.hash = '#/roles'; return false; },
    later({ route, d, value }) {
      const n = +(d.days ?? value);
      if (!(n >= 0) || (value === '' && d.days === undefined)) return false;
      return post(`roles/${route.parts[1]}/later`, { days: n }).then(() => toast(n ? 'Saved for later. It comes back to Today by itself.' : 'Back on Today', false, n ? () => post(`roles/${route.parts[1]}/later`, { days: 0 }) : undefined));
    },
    letterstyle: ({ route, value }) => { toast('Writing the letter again…'); return post(`roles/${route.parts[1]}/letterstyle`, { style: value }).then(() => toast('Written again. "Put it back" under the letter restores the one before.')); },
    askletter({ route, f }) { if (!f.ask.trim()) throw new Error('Say what to change.'); return post(`roles/${route.parts[1]}/askletter`, { ask: f.ask }).then(() => toast('Letter written again')); },
    askcv({ route, f }) { if (!f.ask.trim()) throw new Error('Say what to change.'); return post(`roles/${route.parts[1]}/askcv`, { ask: f.ask }).then(() => toast('CV tailored again')); },
    undoletter: ({ route }) => post(`roles/${route.parts[1]}/undoletter`).then(() => toast('The letter is as it was')),
    undocv: ({ route }) => post(`roles/${route.parts[1]}/undocv`).then(() => toast('The CV changes are as they were')),
    chase: ({ route }) => post(`roles/${route.parts[1]}/chase`),
    chasesave: ({ route, f }) => post(`roles/${route.parts[1]}/chasesave`, { subject: f.subject, text: f.text }).then(() => toast('Saved')),
    chasecopy: ({ el }) => { copy(el.form.text.value); return false; },
    async chasemail({ route, el, data }) {
      const subject = el.form.subject.value, text = el.form.text.value;
      await post(`roles/${route.parts[1]}/chasesave`, { subject, text });
      location.href = `mailto:${mailAddr(data.chase?.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
      toast('Opened in your mail. Press "I sent it" once it has gone.');
    },
    chasesent: ({ route }) => post(`roles/${route.parts[1]}/chasesent`).then(() => toast('Noted in this role\'s history')),
    chasedrop: ({ route }) => post(`roles/${route.parts[1]}/chasedrop`),
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
