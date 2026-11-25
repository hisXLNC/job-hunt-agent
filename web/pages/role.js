import { html, api, post, del, ago, when, rings, ring, tile, toast, copy, safeUrl, stageChip, freshness, openAssistant, BAND, STAGE, KIND, employer, rel, LATER, dayName } from '../app.js';

const NO = ['No reason', 'Pay too low', 'Too junior', 'Too senior', 'Not my field', 'Wrong place or too far', 'Not this kind of contract', 'Not this employer'];
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
      ${d.own_cv ? '' : files(r, 'cv', 'Your CV with the changes that are switched on.')}</div>
    ${earlierNote(d)}${ownFiles(d)}
    <div class="col" style="gap:8px">${doc.changes.map((c, i) => html`<div class="row top-al" style="gap:12px;${c.off ? 'opacity:.55' : ''}">
      <button class="switch ${c.off ? '' : 'on'}" role="switch" aria-checked="${c.off ? 'false' : 'true'}" aria-label="Use this change" data-act="toggle" data-i="${i}" data-off="${c.off ? '' : '1'}"></button>
      <div class="grow s">${c.before ? html`<div><span class="del">${c.before}</span></div>` : ''}<div>${c.after ? html`<span class="ins">${c.after}</span>` : html`<i class="m">Removed</i>`}</div><div class="xs m" style="margin-top:2px">${c.why}</div>
        ${c.after ? html`<details class="xs"><summary class="link">Edit the wording</summary><form data-act="editchange" data-i="${i}" class="col" style="gap:6px;margin-top:6px"><textarea name="after" rows="3" aria-label="Your wording for this change">${c.after}</textarea><div class="row"><span class="m grow">Your words go into the CV as they are; they are not checked against your facts.</span><button class="btn sm">Use my wording</button></div></form></details>` : ''}</div></div>`)}
      ${!doc.changes.length ? html`<p class="s m">No changes were needed: your CV already speaks to this role.</p>` : ''}</div>
    ${doc.left_out?.length ? html`<details><summary class="s">${doc.left_out.length} thing${doc.left_out.length === 1 ? '' : 's'} left out on purpose</summary><ul class="s ink2" style="margin:6px 0 0 18px">${doc.left_out.map(x => html`<li><b>${x.what}</b>: ${x.why}</li>`)}</ul></details>` : ''}
    <details><summary class="s">See the whole CV as it will be sent</summary><div style="margin-top:10px">${cvSheet(d.cv.sent)}</div></details>
    ${ask('askcv', 'undocv', doc.prev, 'For example: make more of the team I managed', 'What to change in the CV')}
    <div class="hr"></div>
    <div class="row wrap"><h3 class="grow">Your letter · ${words(d.letter)} words</h3>
      <select class="mini" aria-label="Letter style" data-on="change" data-act="letterstyle" title="Writes the letter again in this style. The one you have is kept, so you can put it back.">${(d.letter_styles || []).map(s => html`<option value="${s}" ${s === d.letter_style ? 'selected' : ''}>${STYLE[s] || s}</option>`)}</select>
      <button class="btn sm" data-act="copyletter">Copy</button>${d.own_letter ? '' : files(r, 'letter', 'The letter as it is saved here.')}</div>
    <form data-act="saveletter" class="col" style="gap:6px"><textarea name="text" rows="9" aria-label="Your letter">${d.letter || ''}</textarea><div class="row"><span class="xs m grow">Edit freely; what you save here is what the download contains.</span><button class="btn sm">Save letter</button></div></form>
    ${ask('askletter', 'undoletter', d.letter_prev, 'For example: shorter, and open with the Vertex project', 'What to change in the letter')}
    ${d.own_cv || d.own_letter ? '' : html`<div class="row wrap"><span class="s m grow">${d.pdf_gap ? html`<b style="color:var(--warn)">A PDF from Job Hunt shows Western European letters only, and these have others.</b> Use Word for this one.` : 'For a form that takes one file: the letter first, then your CV.'}</span><a class="btn sm" href="/api/roles/${r.id}/both.pdf">Letter and CV in one PDF</a></div>`}
    <div class="hr"></div>
    <div class="row"><div class="grow"><h3>A note straight to the hiring manager</h3><p class="s m">Sent alongside your application, not instead of it. Job Hunt writes it; you send it.</p></div><button class="btn sm" data-act="case" data-busy="Writing…">${d.case ? 'Write it again' : 'Write it'}</button></div>
    ${d.case ? html`<div class="quote s pre">${d.case.subject ? html`<b>${d.case.subject}</b>\n\n` : ''}${d.case.body}</div><div class="row"><button class="btn sm" data-act="copycase">Copy</button></div>` : ''}
    <div class="hr"></div>
    ${questions(d)}
  </div>`;
}

// The questions an application form asks, answered from the person's own facts, to copy across.
function questions(d) {
  return html`<details ${d.answers?.length ? 'open' : ''}><summary><b>Questions on the application form</b> <span class="s m">· paste them, get answers to copy</span></summary>
    ${d.answers?.length ? html`<div class="col" style="gap:10px;margin-top:10px">${d.answers.map((a, i) => html`<div class="row top-al" style="gap:10px"><div class="grow s"><b>${a.question}</b><div class="${a.answer ? 'ink2 pre' : 'm'}">${a.answer || 'Only you know this one.'}</div>${a.answer && !a.sure ? html`<div class="xs" style="color:var(--warn)">Check this one: Job Hunt was not sure.</div>` : ''}</div>${a.answer ? html`<button class="btn sm" data-act="copyanswer" data-i="${i}">Copy</button>` : ''}</div>`)}</div>` : ''}
    <form data-act="answers" class="col" style="gap:6px;margin-top:10px"><textarea name="text" rows="4" placeholder="Why do you want to work here?&#10;Describe a project you led." aria-label="The form's questions, one on each line"></textarea>
      <div class="row"><span class="xs m grow">One question on each line. The side panel does this for you on the form itself; this is for when you would rather copy.</span><button class="btn sm" data-busy="Writing…">${d.answers?.length ? 'Answer these instead' : 'Answer them'}</button></div></form></details>`;
}

// What the tailored CV would likely reach, while nothing is prepared yet.
function forecast(d) {
  const r = d.role, f = d.reading?.if_tailored || 0;
  if (d.cv || !(r.fit >= 0) || f <= r.fit) return rings(r.fit, r.fit_tailored);
  return html`<div class="row" style="gap:10px"><div class="rings">${ring(r.fit, 'Fit now')}</div><div class="col" style="align-items:center;gap:2px" title="Claude's estimate of the fit once your CV is tailored to this posting from what is already true."><span class="xs m">once tailored</span><b style="font-size:15px;color:var(--good)">≈ ${f}</b></div></div>`;
}

const MONTH = t => new Date(t * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

// The employer already has a CV from the person: say so, and what differs.
function earlierNote(d) {
  const e = d.earlier;
  if (!e) return '';
  const n = (e.added || []).length + (e.removed || []).length;
  return html`<div class="col" style="gap:6px;padding:10px 12px;background:var(--s2);border-radius:10px"><span class="s"><b>You applied at ${d.role.company} before</b> (<a href="#/roles/${e.role_id}">${e.title}</a>, ${MONTH(e.at)}). This CV stays close to the one they have${n ? html`: ${n} line${n === 1 ? '' : 's'} differ.` : ': it is the same.'}</span>
    ${n ? html`<details class="s"><summary class="link">See what differs</summary><div class="col" style="gap:3px;margin-top:6px">${(e.removed || []).map(x => html`<div><span class="del">${x}</span></div>`)}${(e.added || []).map(x => html`<div><span class="ins">${x}</span></div>`)}</div></details>` : ''}</div>`;
}

// The person's own files, sent instead of Job Hunt's.
function ownFiles(d) {
  const r = d.role, one = (kind, word, f) => f
    ? html`<div class="row wrap s" style="gap:8px;padding:8px 12px;border:1px solid var(--line);border-radius:10px"><span class="grow"><b>You send your own ${word} file:</b> ${f.name} <span class="m">· the downloads and the side panel use it</span></span><a class="btn sm" href="/api/roles/${r.id}/${kind}.docx">Download</a><button class="btn sm ghost" data-act="dropown" data-kind="${kind}">Use Job Hunt's again</button></div>`
    : html`<label class="btn sm">Use my own ${word} file<input type="file" accept=".docx,.pdf" hidden data-on="change" data-act="addown" data-kind="${kind}"></label>`;
  return html`${d.own_cv ? one('cv', 'CV', d.own_cv) : ''}${d.own_letter ? one('letter', 'letter', d.own_letter) : ''}
    ${d.own_cv && d.own_letter ? '' : html`<div class="row wrap" style="gap:8px"><span class="xs m grow">Rather send a file of your own? Word or PDF.</span>${d.own_cv ? '' : one('cv', 'CV')}${d.own_letter ? '' : one('letter', 'letter')}</div>`}`;
}

const CHECK = { shown: ['Shown', 'good'], unclear: ['Unclear', 'warn'], missing: ['Missing', 'crit'] };

// Before the person sends: does the CV show what they ask for, does it have
// the words a screening system looks for, and will such a system read it.
function before(d) {
  if (!d.cv) return '';
  const c = d.check, lines = c?.lines || [], kw = d.keywords || [], rd = d.readable || [];
  const count = s => lines.filter(l => l.status === s).length;
  const look = count('unclear') + count('missing') + rd.filter(x => x.bad).length;
  const have = kw.filter(k => k.in), lack = kw.filter(k => !k.in);
  return html`<div class="card col" style="gap:14px">
    <div class="row"><div class="grow"><div class="eb">Before you send</div><h3 style="margin-top:4px">${c ? (look ? `Checked against this posting: ${look} thing${look === 1 ? '' : 's'} to look at` : 'Checked against this posting: nothing to fix') : 'Check the CV that gets sent'}</h3>
      ${c && d.check_stale ? html`<div class="xs" style="color:var(--warn);margin-top:2px">The CV changed since it was checked ${ago(c.at)}.</div>` : ''}</div>
      <button class="btn sm ${c ? '' : 'p'}" data-act="check" data-busy="Checking…" title="Claude reads the CV exactly as it will be sent, requirement by requirement, the way a recruiter skims it.">${c ? 'Check again' : 'Check my CV'}</button></div>
    ${c ? html`<div><div class="row" style="gap:8px"><h4 class="grow">Does your CV show what they ask for?</h4><span class="s m">${count('shown')} shown · ${count('unclear')} unclear · ${count('missing')} missing</span></div>
      <table class="tbl" style="margin-top:6px"><tbody>${lines.map((l, i) => { const [w, t] = CHECK[l.status] || CHECK.unclear; const fixable = l.status !== 'shown' && l.fix && !/^leave it out/i.test(l.fix);
        return html`<tr><td class="s" style="width:32%"><b>${l.ask}</b></td><td class="s ink2">${l.evidence}${l.status !== 'shown' && l.fix ? html`<div class="xs m" style="margin-top:2px">${l.fix}</div>` : ''}</td><td><span class="chip ${t}">${w}</span></td><td style="text-align:right">${fixable ? html`<button class="btn sm" data-act="makeclear" data-i="${i}" data-busy="Writing…" title="Tailors the CV again with this made plain. Only from what is true; the changes before are kept, so you can put them back.">Make it clear</button>` : ''}</td></tr>`; })}</tbody></table></div>` : html`<p class="s m" style="margin-top:-6px">Claude reads it as a recruiter would and says, for each thing the posting asks for, whether the CV shows it, buries it or leaves it out.</p>`}
    ${kw.length ? html`<form data-act="workin"><div class="row" style="gap:8px"><h4 class="grow">Words a screening system looks for</h4><span class="s m">${have.length} of ${kw.length} in your CV</span></div>
      <div class="row wrap" style="gap:6px;margin-top:8px">${have.map(k => html`<span class="chip good">✓ ${k.word}</span>`)}${lack.map(k => html`<label class="chip" style="gap:5px;cursor:pointer"><input type="checkbox" name="w" value="${k.word}" checked style="margin:0">${k.word}</label>`)}</div>
      ${lack.length ? html`<div class="row" style="gap:8px;margin-top:8px"><span class="xs m grow">Ticked words are worked in only where your CV or your facts support them; the rest are left out.</span><button class="btn sm" data-busy="Writing…">Work in the ticked words</button></div>` : ''}</form>` : ''}
    <div><div class="row" style="gap:8px"><h4 class="grow">Will a screening system read it?</h4>${rd.some(x => x.bad) ? html`<span class="chip warn">${rd.filter(x => x.bad).length} to fix</span>` : html`<span class="chip good">Reads cleanly</span>`}</div>
      <ul class="s ink2" style="margin:6px 0 0 18px">${rd.map(x => html`<li style="${x.bad ? 'color:var(--warn)' : ''}">${x.text}${x.fix === 'cv' ? html` <a href="#/you">Add it to your CV under You</a>` : ''}</li>`)}</ul>
      ${d.own_cv ? html`<p class="xs m" style="margin-top:4px">This part is about Job Hunt's version. Your own file is sent as you made it; the check and the words above read your file.</p>` : ''}</div>
  </div>`;
}

// Everything a form asks for, one press each.
function kit(d) {
  const k = d.kit;
  if (!k || !(k.lines || []).length) return '';
  const job = (j, i, kind) => html`<div class="row wrap s" style="gap:8px"><span class="grow" style="min-width:200px"><b>${j.title || j.org}</b>${j.title && j.org ? html` · ${j.org}` : ''}${j.dates ? html` · <span class="m">${j.dates}</span>` : ''}</span>
    <span class="row" style="gap:4px;flex:none">${j.title ? html`<button class="btn sm ghost" data-act="kitcopy" data-k="${kind}" data-i="${i}" data-f="title">Copy title</button>` : ''}${j.dates ? html`<button class="btn sm ghost" data-act="kitcopy" data-k="${kind}" data-i="${i}" data-f="dates">Copy dates</button>` : ''}${j.bullets ? html`<button class="btn sm ghost" data-act="kitcopy" data-k="${kind}" data-i="${i}" data-f="bullets">Copy the text</button>` : ''}</span></div>`;
  return html`<div class="card"><details><summary><b>Copy-and-paste kit</b> <span class="s m">· everything a form asks for, one press each</span></summary>
    <div class="col" style="gap:6px;margin-top:10px">${k.lines.map((l, i) => html`<div class="row s" style="gap:10px"><span class="m" style="width:150px;flex:none">${l.label}</span><span class="grow" style="min-width:0;overflow-wrap:anywhere">${l.value.length > 160 ? l.value.slice(0, 160) + '…' : l.value}</span><button class="btn sm ghost" data-act="kitcopy" data-k="lines" data-i="${i}" data-f="value">Copy</button></div>`)}
      ${(k.jobs || []).length ? html`<div class="eb" style="margin-top:8px">Experience, as sent</div>${k.jobs.map((j, i) => job(j, i, 'jobs'))}` : ''}
      ${(k.study || []).length ? html`<div class="eb" style="margin-top:8px">Education</div>${k.study.map((j, i) => job(j, i, 'study'))}` : ''}
      <p class="xs m" style="margin-top:6px">From your details under You and ${d.own_cv ? "Job Hunt's version of the CV for this role (you send your own file)" : 'the CV as it is sent for this role'}. The side panel fills these in on the form itself.</p></div></details></div>`;
}

// An offer: weigh it up and ask for more.
function offer(d) {
  const r = d.role, o = d.offer;
  if (r.closed || !(o || r.stage === 'offer' || r.stage === 'interview')) return '';
  const form = html`<form data-act="offer" class="col" style="gap:6px"><textarea name="text" rows="${o ? 4 : 6}" placeholder="Paste the offer letter or e-mail: pay, bonus, holiday, start date…" aria-label="The offer"></textarea><div class="row"><span class="xs m grow">Only you see it. Claude weighs it against what this kind of role pays and drafts a reply; you send it.</span><button class="btn sm ${o ? '' : 'p'}" data-busy="Reading…">${o ? 'Weigh up this one instead' : 'Weigh it up'}</button></div></form>`;
  if (!o) return html`<div class="card col" style="gap:10px"><div><div class="eb">${r.stage === 'offer' ? 'An offer' : 'If they make an offer'}</div><h3 style="margin-top:4px">Paste the offer and Job Hunt weighs it up</h3></div>${form}</div>`;
  const a = o.advice || {}, floor = d.pay_floor > 0 && a.base > 0 ? a.base - d.pay_floor : null;
  return html`<div class="card col" style="gap:10px;border-color:var(--good)">
    <div class="row"><div class="grow"><div class="eb">The offer</div><h3 style="margin-top:4px">What to ask for, and the reply</h3></div><span class="xs m">Read ${ago(o.at)}</span></div>
    <div class="grid2" style="align-items:start"><div class="col" style="gap:8px">
      <div class="s"><b>${a.terms}</b></div>
      <div class="s ink2">${a.market}${floor !== null ? html` Against your pay floor: <b>${floor >= 0 ? `${floor.toLocaleString()} above` : `${(-floor).toLocaleString()} below`}</b>.` : ''}</div>
      ${(a.asks || []).length ? html`<div class="eb" style="margin-top:4px">Worth asking for</div><ul class="s" style="margin:0 0 0 18px">${a.asks.map(x => html`<li>${x}</li>`)}</ul>` : ''}
      ${(a.watch || []).length ? html`<div class="eb" style="margin-top:4px">Careful with</div><ul class="s ink2" style="margin:0 0 0 18px">${a.watch.map(x => html`<li>${x}</li>`)}</ul>` : ''}</div>
      <div class="col" style="gap:6px"><div class="eb">Your reply, asking for more</div><div class="quote s pre">${a.subject ? html`<b>${a.subject}</b>\n\n` : ''}${a.reply}</div><div class="row" style="gap:6px"><button class="btn sm" data-act="offercopy">Copy</button><button class="btn sm" data-act="offermail" title="Opens a new message in your mail program. You press Send.">Open in my mail</button></div></div></div>
    <details class="s"><summary>Paste another offer</summary><div style="margin-top:8px">${form}</div></details></div>`;
}

// After a no: a short, gracious reply keeps the door open.
function afterNo(d) {
  const r = d.role, n = d.noreply;
  if (r.closed !== 'rejected') return '';
  if (!n) return html`<div class="card row" style="gap:12px"><div class="grow"><h4>They said no</h4><p class="s m">A short, gracious reply keeps the door open for the next role there. Job Hunt writes it; you send it.</p></div><button class="btn sm" data-act="noreply" data-busy="Writing…">Write a reply</button></div>`;
  return html`<div class="card col" style="gap:8px"><div class="row"><div class="grow"><div class="eb">They said no</div><h4 style="margin-top:4px">Your reply${n.to ? html` to ${n.to}` : ''}</h4></div><button class="btn sm ghost" data-act="noreply" data-busy="Writing…">Write it again</button></div>
    <div class="quote s pre">${n.subject ? html`<b>${n.subject}</b>\n\n` : ''}${n.body}</div><div class="row" style="gap:6px"><button class="btn sm" data-act="noreplycopy">Copy</button><button class="btn sm" data-act="noreplymail">Open in my mail</button></div></div>`;
}

// Practising the interview with Claude, in the assistant.
function practise(d) {
  const r = d.role;
  if (r.closed || r.stage !== 'interview') return '';
  const next = (d.talks || []).filter(t => t.at > d.now).sort((a, b) => a.at - b.at)[0];
  return html`<div class="card row" style="gap:12px"><div class="grow"><h4>${next ? html`Interview ${when(next.at)}` : 'Practise the interview'}</h4><p class="s m">Practise it with Claude: one question at a time, as they are likely to ask, with notes on each answer.</p></div><button class="btn sm p" data-act="practise">Practise this interview</button></div>`;
}

// The same posting on the employer's own site, for a role found on a job board.
function ownSite(d) {
  const r = d.role, o = d.own_site;
  if (!o || r.closed || stageOrder(r.stage) >= 3) return '';
  const u = safeUrl(o.url);
  if (u) return html`<div class="card row" style="gap:12px"><div class="grow"><h4>Found on ${r.company}'s own site</h4><p class="s m">Applying there, not through the job board, puts you straight into their system.</p></div><a class="btn sm p" href="${u}" target="_blank" rel="noopener noreferrer">Apply on their site</a></div>`;
  if (o.note) return html`<div class="row s m" style="gap:8px;padding:0 4px"><span class="grow">${o.note}</span><button class="link" data-act="findsite" data-busy="Looking…">Look again</button></div>`;
  if (!d.can_web) return '';
  return html`<div class="row s m" style="gap:8px;padding:0 4px"><span class="grow">Found on a job board. Applying on ${r.company}'s own site often reaches them sooner.</span><button class="btn sm" data-act="findsite" data-busy="Looking…">Look on their own site</button></div>`;
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
    <div class="card"><h4>Your notes</h4><form data-act="mynotes" class="col" style="margin-top:8px;gap:8px"><textarea name="text" rows="4" placeholder="Who referred you, what the recruiter said, the salary they named…" aria-label="Your notes on this role">${d.my_notes || ''}</textarea><button class="btn sm" style="align-self:flex-end">Save notes</button></form></div>
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
        <div class="grow col" style="gap:6px"><div class="row wrap" style="gap:8px">${stageChip(r)}${BAND[r.band] ? html`<span class="chip">${BAND[r.band]}</span>` : ''}${r.path ? html`<a class="chip ${r.path === 'on' ? 'good' : ''}" href="#/you?open=wants" title="${r.path === 'on' ? 'Moves you along the career path you want' : 'Leads away from the career path you want'}">${r.path === 'on' ? 'On path' : 'Off path'}</a>` : ''}${freshness(r)}${r.pay ? html`<span class="s m">· ${r.pay}</span>` : ''}${r.gone_at ? html`<span class="chip warn">Posting taken down ${rel(r.gone_at)}</span>` : ''}</div>
          <h2 style="font-size:21px">${r.title}</h2><div class="s m">${employer(r.company, r.company_id)}${r.location ? html` · ${r.location}` : ''}${r.closed && r.closed_why ? html` · <b>${r.closed_why}</b>` : ''}</div></div>
        ${forecast(d)}
        <div class="col" style="gap:6px">
          ${url ? html`<a class="btn p" href="${url}" target="_blank" rel="noopener noreferrer">Open the posting</a>` : ''}
          ${r.closed ? html`<button class="btn sm" data-act="reopen">Bring back</button>` : html`<div class="row" style="gap:6px">${stageOrder(r.stage) < 3 ? html`<button class="btn sm" data-act="applied">I applied</button>` : ''}${r.stage === 'applied' ? html`<button class="btn sm" data-act="unapply" title="Marked applied by mistake? This puts the role back where it was.">I didn't send it</button>` : ''}<select class="mini" aria-label="Not for me" data-on="change" data-act="no" title="It will never be shown again. Saying why helps Job Hunt read the next ones."><option value="">Not for me…</option>${NO.map(w => html`<option value="${w}">${w}</option>`)}<option value="mute">Never show ${r.company}</option></select></div>
            ${later ? html`<div class="row xs m" style="gap:6px"><span>Saved for later · back ${dayName(r.later_until)}</span><button class="link" data-act="later" data-days="0">Bring back now</button></div>`
              : html`<div class="row" style="justify-content:flex-end"><select class="mini" aria-label="Save for later" data-on="change" data-act="later" title="Leaves Today until then, and comes back by itself."><option value="">Save for later</option>${LATER.map(([n, label]) => html`<option value="${n}">${label}</option>`)}</select></div>`}`}
        </div></div>
      <div class="cols wide"><div class="col" style="gap:14px">${offer(d)}${afterNo(d)}${practise(d)}${chase(d)}${ownSite(d)}${who(d)}${why(d.reading)}${sent(d)}${before(d)}${kit(d)}
        <div class="card"><details ${d.cv || d.reading?.summary ? '' : 'open'}><summary>The posting</summary><div class="s pre ink2" style="margin-top:10px">${r.description || 'Job Hunt has no text for this posting. Open it to read it.'}</div></details></div></div>
        ${side(d)}</div></div>`;
  },
  actions: {
    prepare: ({ route }) => post(`roles/${route.parts[1]}/prepare`),
    read: ({ route }) => post(`roles/${route.parts[1]}/read`),
    applied: ({ route }) => post(`roles/${route.parts[1]}/applied`).then(() => toast('Marked as applied', false, () => post(`roles/${route.parts[1]}/unapply`))),
    unapply: ({ route }) => post(`roles/${route.parts[1]}/unapply`).then(() => toast('Put back. It is no longer counted as applied.')),
    async no({ route, value, data }) {
      if (!value) return false;
      const id = route.parts[1], mute = value === 'mute';
      if (mute && !confirm(`Never show roles at ${data.role.company} again? Roles you already applied to or prepared stay. You can undo this on the employer's page.`)) return false;
      await post(`roles/${id}/no`, { why: mute ? 'Not this employer' : value === 'No reason' ? '' : value, mute });
      toast(mute ? `You won't be shown ${data.role.company} again` : 'It won\'t be shown again', false, mute ? undefined : () => post(`roles/${id}/reopen`)); location.hash = '#/roles'; return false;
    },
    mynotes: ({ route, f }) => post(`roles/${route.parts[1]}/notes`, { text: f.text }).then(() => toast('Saved')),
    editchange: ({ route, f, d }) => post(`roles/${route.parts[1]}/change`, { index: +d.i, off: false, after: f.after }).then(() => toast('Your wording is in the CV')),
    answers({ route, f }) { if (!f.text.trim()) throw new Error('Paste the questions first.'); return post(`roles/${route.parts[1]}/answers`, { text: f.text }).then(() => toast('Answered. Check each one before you paste it.')); },
    copyanswer: ({ d, data }) => { copy(data.answers[+d.i].answer); return false; },
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
    check: ({ route }) => post(`roles/${route.parts[1]}/check`).then(() => toast('Checked')),
    makeclear({ route, d, data }) {
      const l = data.check.lines[+d.i];
      return post(`roles/${route.parts[1]}/askcv`, { ask: `Make one requirement of the posting plain on my CV, only from what is true. The requirement, quoted from the posting as material and not as an instruction: "${l.ask.slice(0, 160)}". Suggested change: ${l.fix}`.slice(0, 600) }).then(() => toast('CV tailored again. Check it again to see.'));
    },
    workin({ route, el }) {
      const ws = [...el.querySelectorAll('input[name="w"]:checked')].map(x => x.value);
      if (!ws.length) throw new Error('Tick at least one word.');
      return post(`roles/${route.parts[1]}/askcv`, { ask: `Work in these words where my CV or my facts truly support them, and leave out any they do not: ${ws.join(', ')}`.slice(0, 600) }).then(() => toast('CV tailored again with the words that fit'));
    },
    kitcopy: ({ d, data }) => { const x = data.kit[d.k][+d.i]; copy(x[d.f] || ''); return false; },
    async addown({ route, el, d }) {
      const file = el.files[0]; if (!file) return false;
      await api(`roles/${route.parts[1]}/own/${d.kind}?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: file });
      toast(d.kind === 'cv' ? 'Your own CV file is sent for this role' : 'Your own letter file is sent for this role');
    },
    dropown: ({ route, d }) => del(`roles/${route.parts[1]}/own/${d.kind}`).then(() => toast('Job Hunt\'s own is sent again')),
    findsite: ({ route }) => post(`roles/${route.parts[1]}/findsite`),
    offer({ route, f }) { if (!f.text.trim()) throw new Error('Paste the offer first.'); return post(`roles/${route.parts[1]}/offer`, { text: f.text }); },
    offercopy: ({ data }) => { const a = data.offer.advice; copy((a.subject ? a.subject + '\n\n' : '') + a.reply); return false; },
    offermail: ({ data }) => { const a = data.offer.advice; location.href = `mailto:?subject=${encodeURIComponent(a.subject || '')}&body=${encodeURIComponent(a.reply || '')}`; return false; },
    noreply: ({ route }) => post(`roles/${route.parts[1]}/noreply`),
    noreplycopy: ({ data }) => { const n = data.noreply; copy((n.subject ? n.subject + '\n\n' : '') + n.body); return false; },
    noreplymail: ({ data }) => { const n = data.noreply; location.href = `mailto:${mailAddr(n.email)}?subject=${encodeURIComponent(n.subject || '')}&body=${encodeURIComponent(n.body || '')}`; return false; },
    practise: ({ data }) => { const r = data.role; openAssistant(`Help me practise the interview for ${r.title} at ${r.company}. Ask me one question at a time, the way they are likely to ask it, wait for my answer, then give me short, honest notes on it before the next question.`, true); return false; },
    async note({ d, route }) { await post(`people/${d.id}/note`, { purpose: 'applied', role: +route.parts[1] }); location.hash = `#/people/${d.id}`; return false; },
  },
};

function stageOrder(s) { return Object.keys(STAGE).indexOf(s); }
void KIND;
