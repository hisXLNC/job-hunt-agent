// Job Hunt screens, continued. One job's page.
'use strict';

// ---- Job ----
let jobPoll;
const JOB_TABS = [['overview', 'Overview'], ['docs', 'CV &amp; letter'], ['apply', 'Questions &amp; contacts'], ['interview', 'Interview'], ['chat', 'Ask Claude']];
const jobTabs = {};
/** The job's buttons: its next step first, as the main one, then the rest, all in view. */
function jobActions(j, tailoring, progress) {
  const id = esc(j.id), on = `data-job="${id}" data-from="${esc(j.status)}"`;
  const enc = encodeURIComponent(j.id);
  // What to do now, in a sentence, with its button (or two).
  let next = '', main = [];
  if (tailoring) next = 'Job Hunt is tailoring your CV and cover letter. This page updates by itself.';
  else if (j.status === 'queued') { next = 'Read the posting and why it fits. Worth applying to? Job Hunt tailors your CV and writes a cover letter.'; main = [`<button class="btn primary" data-act="tailorPicked" data-job="${id}">Tailor my CV for this role</button>`]; }
  else if (j.status === 'ready') { next = 'Read your tailored CV and cover letter below, change what you like, then approve.'; main = [`<button class="btn primary" data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">${svg('check')}${j.apply_email ? `Approve and email to ${esc(j.apply_email)}` : 'Approve and apply'}</button>`]; }
  else if (j.status === 'approved') { next = 'Submit it on the company\'s site. Job Hunt fills in the form in your browser; you check it and press Submit.';
    const fills = overview?.can_fill && j.url;
    if (!fills) next = 'Submit it on the company\'s site. Your files are under CV & letter, and every detail a form asks for, ready to copy, is under Questions & contacts.';
    main = [fills ? `<button class="btn primary" data-act="fillBrowser" data-job="${id}">${svg('open')}Fill it in my browser</button>`
        : j.url || j.apply_url ? `<button class="btn primary" data-act="open" data-job="${id}" data-what="${j.apply_url ? 'company' : 'posting'}">${svg('open')}Open the application</button>` : '',
      `<button class="btn" data-act="stage" ${on} data-status="applied">${svg('check')}Mark applied</button>`]; }
  else if (j.status === 'saved') { next = 'Saved for later.'; main = [`<button class="btn primary" data-act="stage" ${on} data-status="${j.cv_path ? 'ready' : 'queued'}">Bring it back</button>`]; }
  else if (['skipped', 'dismissed'].includes(j.status)) next = j.status === 'skipped' ? 'Set aside: its fit was below your minimum, or a filter caught it. You can still tailor it.' : 'You marked it Not interested. You can still tailor it.';
  else if (progress && ['applied', 'interviewing', 'offer'].includes(j.status)) next = nextText(progress);
  if (['skipped', 'dismissed'].includes(j.status) || (j.status === 'saved' && !j.cv_path)) main.push(`<button class="btn ${j.status === 'saved' ? '' : 'primary'}" data-act="tailorAnyway" data-job="${id}" ${tailoring ? 'disabled' : ''}>Tailor anyway</button>`);
  // The rest: always there, never in the way.
  const b = [];
  if (j.apply_url) b.push(`<button class="btn ghost sm" data-act="open" data-job="${id}" data-what="company">${svg('open')}On the company's site</button>`);
  if (j.url) b.push(`<button class="btn ghost sm" data-act="open" data-job="${id}" data-what="posting">${svg('open')}Open posting</button>`);
  // Applying: the other ways to get to the form.
  if (['ready', 'approved'].includes(j.status) && !j.apply_url && j.url) b.push(`<button class="btn ghost sm" data-act="findApply" data-job="${id}" title="Claude searches the company's careers site for this job, so you apply to them and not through a job board">${svg('search')}Find it on the company's site</button>`);
  if (['ready', 'approved', 'queued'].includes(j.status)) b.push(`<button class="btn ghost sm" data-act="stage" ${on} data-status="saved">Save for later</button>`, `<button class="btn ghost sm danger" data-act="stage" ${on} data-status="dismissed">Not interested</button>`);
  return `<section class="card next-step actions">
      <div class="next-main">${next ? `<p class="grow"><b>Next:</b> ${next}</p>` : '<span class="grow"></span>'}<div class="row">${main.filter(Boolean).join('')}</div></div>
      ${b.length ? `<div class="row next-more">${b.join('')}</div>` : ''}</section>`;
}
/** "Why it fits", up top: the strongest match, the biggest gap, and anything to check. */
function whyBox(j, flags, note = '') {
  if (!j.reasoning && !flags.length && j.score == null) return '';
  const r = (j.reasoning || '').trim();
  const m = r.match(/^(.*?)(?:\.?\s*)(?:Gap|Biggest gap|Main gap)s?:\s*(.*)$/i);
  const match = (m ? m[1] : r).replace(/^(Strong(est)? match|Match):\s*/i, '').replace(/\.$/, '');
  const gap = m ? m[2].replace(/\.$/, '') : '';
  const must = mustHaves(j), other = flags.filter(f => !/^must have:/i.test(f));
  return `<section class="card why-box">
    ${j.score != null ? `<div class="why-score">${scoreBadge(j.score)}${reachTag(j)}</div>` : ''}
    <div class="grow">
      ${match ? `<p><span class="why-label good-text">Why it fits</span> ${esc(match)}</p>` : ''}
      ${gap ? `<p><span class="why-label warn-text">Biggest gap</span> ${esc(gap)}</p>` : ''}
      ${must.length ? `<p><span class="why-label warn-text">Required, not on your CV</span> ${esc(must.join('; '))}</p>` : ''}
      ${other.length ? `<p><span class="why-label bad-text">Check</span> ${esc(other.join('; '))}</p>` : ''}
      ${note ? `<p class="muted small">${note}</p>` : ''}
    </div></section>`;
}
async function showJob(id) {
  clearTimeout(jobPoll);
  const [{ job: j, effort, warnings, history, progress, own, prep, preparing, rating, rating_busy, cv_pdf, letter_pdf, revising, undo, follow_up: fu, following_up, thanks, thanking, decline, declining, system: sys, review, reviewing, answers, answering, offer, advising, contacts, playbook, revision, company_history, company_notes, sent_compare, repeat_mode, know, chat, chatting, links, writing_to, ats, claude_desktop, recruiter, recruiters_here }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(id)}`), api('/api/settings')]);
  j.effort = effort;
  const tailoring = (overview?.running || []).includes(`tailor:${id}`);
  const gaps = new Set((j.keyword_gaps || []).map(k => k.toLowerCase()));
  const tracks = st.profile.tracks;
  const flags = j.red_flags || [];
  j.warnings = warnings || [];
  // Open on what this stage needs, or on the tab you last used for this job.
  const stageTab = { ready: 'docs', queued: 'overview', approved: 'apply', applied: 'apply', interviewing: 'interview', offer: 'apply' }[j.status] || 'overview';
  // Only the tabs this stage needs: questions and contacts once there's an application, the
  // interview once it's sent. Notes and history are on the Overview.
  const sent = ['applied', 'interviewing', 'offer', 'rejected', 'no_response'].includes(j.status);
  const tabs = JOB_TABS.filter(([k]) => k === 'apply' ? !['queued', 'skipped', 'dismissed'].includes(j.status) || (contacts || []).length || (answers || []).length
    : k === 'interview' ? sent || !!prep || preparing : true);
  const want = jobTabs[id] === 'notes' ? 'overview' : jobTabs[id] || stageTab;
  const tab = tabs.some(([k]) => k === want) ? want : 'overview';
  const badge = { docs: revising || tailoring ? 'Working on it' : '', apply: answering || following_up || writing_to || advising ? 'Working on it' : (j.status === 'offer' && !offer ? 'Weigh the offer' : ''), interview: preparing ? 'Writing' : '' };
  page(`
    <div class="head">
      <div class="grow">
        <div class="eyebrow"><a href="#applications">Jobs</a> / ${esc(STAGES[j.status] || j.status)}</div>
        <h1>${esc(j.title)}</h1>
        <div class="facts" style="margin-top:6px"><b>${esc(j.company)}</b>${j.location ? `<span>${placeHtml(j)}</span>` : ''}${j.salary ? `<span>${esc(j.salary)}</span>` : ''}<span>${ageTag(j)} · found on ${esc(sourceName(j.source))}</span>${stagePill(j.status)}${closedTag(j)}${belowMinTag(j)}${deadlineTag(j)}${stretchTag(j)}${effortTag(j)}${(company_history || []).length ? ' <span class="pill info">Applied here before</span>' : ''}</div>
      </div>
    </div>
    ${jobActions(j, tailoring, progress)}
    ${sys ? `<details class="card ats-tips"${review || reviewing ? ' open' : ''}><summary><b>${esc(j.company)} takes applications through ${esc(sys.name)}.</b> <span class="muted">What that means for this one</span></summary>
      ${(sys.here || []).length ? `<p style="color:var(--warn)">You've applied to ${sys.here.length} other role${sys.here.length === 1 ? '' : 's'} here in the last 90 days (${sys.here.slice(0, 3).map(h => esc(h.title) + (h.status === 'rejected' ? ', turned down' : '')).join('; ')}). ${esc(sys.name)} lets employers block repeat applications, so check this one is worth it.</p>` : ''}
      <div class="ats-review"><header><h3>How ${esc(sys.name)}'s AI check would read your CV</h3>
        ${reviewing ? '<span class="muted small"><span class="spin" data-kind="review"></span>Checking…</span>' : j.cv_path ? `<button class="btn" data-act="review">${review ? 'Check again' : 'Check my CV'}</button>` : ''}</header>
        ${review ? `<p><b>Meets ${review.met} of ${review.total}</b>${review.undecided ? `, ${review.undecided} it can't decide` : ''}${review.not ? `, ${review.not} not shown` : ''}. ${esc(review.note || '')}</p>
          ${review.sharpened ? `<p class="muted small">Job Hunt reworded your CV to state ${review.sharpened} requirement${review.sharpened === 1 ? '' : 's'} outright, then checked again. The changes are listed with the CV, and can be undone there.</p>` : ''}
          <table><thead><tr><th>Requirement</th><th>Reads as</th><th>The line of your CV it would quote</th></tr></thead><tbody>${review.criteria.map(c => `<tr><td>${esc(c.criterion)}</td>
            <td><span class="pill ${c.verdict === 'meets' ? 'good' : c.verdict === 'not' ? 'crit' : 'warn'}">${c.verdict === 'meets' ? 'Meets' : c.verdict === 'not' ? 'Not shown' : 'Undecided'}</span></td>
            <td class="small">${c.evidence ? `“${esc(c.evidence)}”` : c.verdict === 'meets' ? '' : '<span class="muted">Nothing in your CV shows this.</span>'}${c.verdict === 'undecided' && c.fix ? `<br><span class="muted">To settle it: ${esc(c.fix)}</span>` : ''}</td></tr>`).join('')}</tbody></table>
          ${review.fixable && !reviewing ? `<p><button class="btn primary" data-act="reviewFix">State the undecided ones outright</button> <span class="muted small">Wording only: nothing is added that your CV doesn't already state.</span></p>` : ''}
          <p class="muted small">Checked ${esc(ago(review.at))}. The employer's own criteria can't be seen; these are the ones the posting implies, read as strictly as the AI reads them. “Not shown” is honest: leave it, or add it to your CV if you really have it.</p>`
        : `<p class="muted">${j.cv_path ? 'Claude writes the criteria a recruiter would set from this posting and reads your tailored CV against each one, as strictly as the AI does: met, not shown, or undecided, with the line it would quote.' : 'Once the CV is tailored, Claude checks it against the criteria a recruiter would set from this posting, the way the AI does, and states outright anything it could not decide.'}</p>`}
      </div>
      <h3>What else to know</h3>
      <ul>${sys.tips.map(t => `<li><b>${esc(t.title)}.</b> ${esc(t.text)}</li>`).join('')}</ul>
      <p class="muted small">From ${esc(sys.name)}'s own published help pages. Employers choose which of these they switch on, so not all of it applies to every company.</p></details>` : ''}
    ${decline || declining || j.status === 'rejected' ? `<section class="card">
      <header><h2>Reply to the rejection</h2>${declining ? '<span class="muted small"><span class="spin" data-kind="decline"></span>Writing…</span>' : `<button class="btn" data-act="decline">${decline ? 'Write again' : 'Draft a reply'}</button>`}</header>
      ${decline ? `<p class="small muted">${decline.draft ? `Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>${decline.in_thread ? ', as a reply to their email' : ''}` : 'Written'} ${esc(ago(decline.at))}${decline.to ? ` · to ${esc(decline.to)}` : ' · add the address of the person you dealt with before sending'}</p>
        ${decline.robot ? '<p class="small" style="color:var(--warn)">Their email came from an address that doesn\'t take replies. Send this to the recruiter or interviewer you dealt with, or leave it.</p>' : ''}
        <p><b>${esc(decline.subject)}</b></p><div class="posting">${esc(decline.body)}</div>
        <p class="muted small">Nothing is sent: read it, change what you like, and ${decline.draft ? 'send it from Gmail' : 'copy it into an email (connect Gmail in Settings and it is saved as a draft for you)'}.</p>` : '<p class="muted">A short, gracious note: thanks, a request for feedback if you interviewed, and that you\'d like to be kept in mind. Worth sending when you dealt with a person; it is often how the next opening reaches you first.</p>'}
    </section>` : ''}
    ${j.warnings.length && !j.closed_at && !['applied', 'interviewing', 'offer'].includes(j.status) ? `<div class="card" style="border-color:var(--warn)"><b>Check this posting is real and open before you put time in.</b><ul class="flags">${j.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${expiredWhy(j) ? `<div class="card" style="border-color:var(--crit)"><b>This opening has expired.</b><p class="muted">${esc(expiredWhy(j).replace(/^Expired: /, '').replace(/^./, c => c.toUpperCase()))}. Open the posting to make sure, then mark it Not interested.</p></div>` : ''}
    ${(recruiters_here || []).length ? `<div class="card"><b>Recruiter${recruiters_here.length === 1 ? '' : 's'} for this application</b>${recruiters_here.map(r => `<div class="small" style="margin-top:6px"><b>${esc(r.name)}</b> <span class="muted">${esc(r.company_of || '')}</span> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? ` · <a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}${r.linkedin ? ` · <a href="#" data-act="link" data-url="${esc(r.linkedin)}">LinkedIn</a>` : ''}<br><span class="muted">${esc(r.emails)} email${r.emails === 1 ? '' : 's'} · last ${esc(ago(r.last_at))}${r.last_subject ? ` · “${esc(r.last_subject)}”` : ''}</span></div>`).join('')}<a class="small" href="#inbox/recruiters">All recruiters</a></div>` : ''}
    ${recruiter && !['rejected', 'offer', 'no_response', 'dismissed'].includes(j.status) && !(recruiters_here || []).some(r => r.email === recruiter.email && ['applied', 'interviewing'].includes(j.status)) ? recruiterCard(recruiter, j) : ''}
    ${tailoring ? `<p class="muted small"><span class="spin" data-kind="tailor+score"></span> Tailoring…</p>` : ''}
    ${revising ? `<div class="card"><p><span class="spin" data-kind="revise"></span> Making your changes… this page updates by itself.</p></div>` : ''}
    <nav class="tabs job-tabs" id="jobTabs">${tabs.map(([k, n]) => `<a href="#" data-jtab="${k}" class="${k === tab ? 'on' : ''}">${n}${badge[k] ? `<span class="tab-dot" title="${esc(badge[k])}"></span>` : ''}</a>`).join('')}</nav>
    <div class="jpane" data-pane="overview" ${tab === 'overview' ? '' : 'hidden'}>
      <section class="card progress-main">
        <header><h2>${progress ? 'Progress' : 'Stage'}</h2>${progress ? `<span class="who ${esc(progress.who)}">${{ you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' }[progress.who] || ''}</span>` : ''}</header>
        ${progress ? stepsHtml(progress) : ''}
        <div class="progress-foot">
          ${progress ? `<div class="grow"><p style="margin:0"><b>Next:</b> ${nextText(progress)}</p>
            <p class="muted small timeline-inline">${progress.steps.filter(x => x.at).map(x => `<b>${esc(x.step)}</b> ${esc(fmtDate(x.at))}`).join(' · ')}</p></div>` : '<div class="grow"></div>'}
          <div class="row stage-set"><select id="stage" style="width:auto" aria-label="Stage">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${k === j.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
            <input type="text" id="stageNote" placeholder="Note (optional)"><button class="btn" data-act="setStage">Save</button></div>
        </div>
      </section>
      <div class="job-grid">
        <div class="stack">
          ${whyBox(j, flags, j.track ? `Matched to your <b>${esc((tracks.find(t => t.name === j.track) || {}).label || j.track)}</b> CV${j.score_after != null ? `; tailored, it scores <b>${j.score_after}</b> (${j.score_after >= j.score ? '+' : ''}${j.score_after - j.score})` : canReach(j) ? `; tailored, it could reach about <b>${canReach(j)}</b>` : ''}.` : '')}
          <section class="card posting-card"><header><h2>The posting</h2>${j.url ? `<button class="btn ghost sm" data-act="open" data-what="${j.apply_url ? 'company' : 'posting'}">${svg('open')}Open it on the site</button>` : ''}</header>
            <div class="posting">${esc(j.description || 'The source gave no description. Open it on the site to read it.')}</div></section>
        </div>
        <div class="stack">
          ${ratingCard(rating, rating_busy, j.company)}
          ${(j.keywords || []).length ? `<section class="card">
            <header><h2>Posting keywords</h2></header>
            ${j.coverage_after != null ? `<p class="muted small">Your CV covered <b>${pct(j.coverage_before)}</b> before tailoring, <b>${pct(j.coverage_after)}</b> after.</p>` : ''}
            <div>${j.keywords.map(k => `<span class="kw ${gaps.has(k.toLowerCase()) ? 'miss' : ''}">${esc(k)}</span>`).join('')}</div>
            ${gaps.size ? '<p class="muted small">Dashed keywords are not in the tailored CV, because nothing in your experience backs them up or they didn\'t fit. Add one yourself only if it\'s true.</p>' : ''}
          </section>` : ''}
          <section class="card">
            <header><h2>Notes</h2></header>
            <textarea id="notes" placeholder="Contacts, referral, salary talk…">${esc(j.notes || '')}</textarea>
            <div class="row"><button class="btn" data-act="saveNotes">Save notes</button></div>
          </section>
          <details class="card"><summary><b>History</b> <span class="muted small">${history.length} event${history.length === 1 ? '' : 's'}</span></summary>
            <div class="feed">${history.map(e => `<div><time title="${esc(new Date(e.created_at).toLocaleString())}">${esc(fmtDate(e.created_at))}</time><span>${eventText(e)}</span></div>`).join('')}</div>
          </details>
        </div>
      </div>
    </div>
    <div class="jpane" data-pane="docs" ${tab === 'docs' ? '' : 'hidden'}>
    ${j.cv_path || j.cover_letter || tailoring ? '' : `<section class="card"><p class="muted">Not tailored yet. Let Job Hunt tailor your CV, or attach one you tailored yourself: it moves to Approve and is used when you apply.</p>
      <div class="row"><button class="btn primary" data-act="tailorPicked" data-job="${esc(j.id)}">Tailor my CV for this role</button><label class="btn">${svg('doc')}Attach my own CV<input type="file" accept=".docx,.pdf" data-upload="own-cv" hidden></label></div></section>`}
    ${(links || []).length ? `<section class="card"><header><h2>Your links</h2></header>${links.map(l => `<p class="small"><b>${esc(l.site)}</b>: ${l.opened ? `<span class="good-text">opened ${l.opened} time${l.opened === 1 ? '' : 's'}</span>, last ${esc(ago(l.last))}` : '<span class="muted">not opened yet</span>'}${l.previews ? ` <span class="muted">(${l.previews} by link checkers)</span>` : ''}</p>`).join('')}</section>` : ''}
    ${revisionHtml(revision)}
    ${sentCompareHtml(j, sent_compare)}
    ${historyHtml(j, company_history, company_notes, repeat_mode)}
    ${j.cv_path || j.cover_letter ? `<section class="card">
      <div class="row file-row">${j.cv_path ? `<button class="btn" data-act="open" data-what="cv">${svg('doc')}${own?.cv ? 'Open your CV' : 'Open tailored CV'}</button><button class="btn" data-act="open" data-what="letter">${svg('doc')}Open cover letter</button>
        <button class="btn ghost" data-act="open" data-what="cv-pdf" title="${cv_pdf ? 'Open the PDF copy' : 'Make a PDF copy (needs Word or LibreOffice)'}">CV PDF</button><button class="btn ghost" data-act="open" data-what="letter-pdf" title="${letter_pdf ? 'Open the PDF copy' : 'Make a PDF copy (needs Word or LibreOffice)'}">Letter PDF</button>
        <button class="btn" data-act="open" data-what="folder">${svg('folder')}Show files</button>` : ''}</div>
      <header><h2>Preview</h2><div class="seg small" id="pvTabs">
        ${j.cv_path ? `<button class="on" data-pv="cv">${own?.cv ? 'Your CV' : 'Tailored CV'}</button>` : ''}${j.cover_letter && !own?.letter ? `<button class="${j.cv_path ? '' : 'on'}" data-pv="letter">Cover letter</button>` : ''}</div></header>
      ${j.cv_path ? (own?.cv && /\.pdf$/i.test(j.cv_path) ? `<div id="pv-cv"><iframe class="pdf-view" src="/api/jobs/${encodeURIComponent(j.id)}/view/cv" title="Your CV"></iframe></div>` : '<div class="paper" id="pv-cv"><p class="muted">Loading…</p></div>') : ''}
      ${j.cover_letter && !own?.letter ? `<div class="paper letter" id="pv-letter" ${j.cv_path ? 'hidden' : ''}>${letterHtml(j.cover_letter, st.signature)}</div>` : ''}
      <p class="muted small">${own?.cv ? 'This is the CV you attached; it\'s the one used when you apply. ' : j.cv_path ? '<span class="chg-key">Highlighted</span> paragraphs were reworded for this posting. ' : ''}Open the Word files above to see the exact layout.</p>
      ${ats ? atsHtml(ats) : ''}
    </section>
    <section class="card">
      <header><h2>Ask for changes</h2>${undo.cv || undo.letter ? `<div class="row">${undo.cv ? '<button class="btn ghost" data-act="undoRevision" data-what="cv">Undo last CV change</button>' : ''}${undo.letter ? '<button class="btn ghost" data-act="undoRevision" data-what="letter">Undo last letter change</button>' : ''}</div>` : ''}</header>
      <div class="row" style="align-items:flex-start">
        <select id="reviseWhat" style="width:auto">${j.cv_path && !own?.cv ? '<option value="cv">Tailored CV</option>' : ''}${j.cover_letter && !own?.letter ? '<option value="letter">Cover letter</option>' : ''}</select>
        <textarea id="reviseNote" style="flex:1;min-height:64px" placeholder="e.g. Make it shorter · Lead with the ERP rollout · Put SAP in the summary · Less formal"></textarea>
      </div>
      <div class="row"><button class="btn primary" data-act="revise" ${revising || tailoring ? 'disabled' : ''}>Make the change</button>
        <span class="muted small">Claude changes only what you ask, using what's true in your CV. You can undo the last change.</span></div>
    </section>` : ''}
      <div class="grid-2">
        <div class="stack">
        ${(j.cv_changes || []).length && !own?.cv ? `<section class="card">
          <header><h2>What changed in your CV</h2><span class="muted small">${j.cv_changes.length} paragraph${j.cv_changes.length === 1 ? '' : 's'} reworded</span></header>
          ${gapsHtml(j)}
          ${changesHtml(j, false)}
        </section>` : ''}
        ${j.cv_path || j.cover_letter ? `<section class="card">
          <header><h2>Your own files</h2></header>
          <p class="muted small">Tailored a CV or letter for this role yourself? Attach it (Word or PDF) and Job Hunt uses it instead, in the Apply screen and in emailed applications. Job Hunt's version is kept.</p>
          ${['cv', 'letter'].map(w => own?.[w]
            ? `<div class="row"><span class="pill good">Using your own ${w === 'cv' ? 'CV' : 'cover letter'}</span><span class="small">${esc(((w === 'cv' ? j.cv_path : j.letter_path) || '').split(/[\\/]/).pop())}</span>
                <button class="btn ghost sm" data-act="ownOff" data-what="${w}">Use Job Hunt's ${w === 'cv' ? 'CV' : 'letter'}</button>
                <label class="btn ghost sm">Replace<input type="file" accept=".docx,.pdf" data-upload="own-${w}" hidden></label></div>`
            : `<label class="btn">${svg('doc')}Attach my own ${w === 'cv' ? 'CV' : 'cover letter'}<input type="file" accept=".docx,.pdf" data-upload="own-${w}" hidden></label>`).join(' ')}
        </section>` : ''}
        <section class="card">
          <header><h2>${j.cv_path ? 'Tailor again' : 'Tailor'}</h2></header>
          ${tracks.length ? `<p class="muted small">Starts from your <b>${esc(trackLabel(j.track || tracks[0].name))}</b> CV, the closest fit for this role.</p>` : '<p class="muted small">Add a CV in <a href="#cvs">Profile</a> first.</p>'}
          <div class="row" ${tracks.length && j.cv_path ? '' : 'hidden'}><button class="btn" data-act="retailor" ${tailoring ? 'disabled' : ''}>Tailor again</button></div>
          ${tracks.length > 1 ? `<details class="small" style="margin-top:6px"><summary class="muted">Use a different CV</summary><div class="row" style="margin-top:6px"><select id="track" style="width:auto">${tracks.map(t => `<option value="${esc(t.name)}" ${t.name === j.track ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select><button class="btn" data-act="retailor" data-pick="1" ${tailoring ? 'disabled' : ''}>Tailor from it</button></div></details>` : ''}
        </section>
        </div>
        <div class="stack">
        ${j.cover_letter != null && !own?.letter ? `<details class="card">
          <summary><b>Edit the cover letter yourself</b> <span class="muted small">or ask for changes above</span></summary>
          <p class="muted small">Your edits update the Word file too. Put ** around words to make them bold.</p>
          <textarea id="letter" style="min-height:340px">${esc(j.cover_letter)}</textarea>
          <div class="row"><button class="btn" data-act="saveLetter">Save cover letter</button></div>
        </details>` : ''}
        </div>
      </div>
    </div>
    <div class="jpane" data-pane="apply" ${tab === 'apply' ? '' : 'hidden'}>
    ${['ready', 'approved', 'applied', 'interviewing', 'offer'].includes(j.status) || answers ? `<section class="card">
      <header><h2>What the form asks</h2>${answering ? '<span class="muted small"><span class="spin" data-kind="answers"></span>Writing…</span>' : ''}</header>
      <p class="muted small">Paste the form's questions, one per line, or leave it empty for the usual ones (why this role, salary expectations, notice period…). Answers use your CV, this posting and your <a href="#cvs/details">facts for forms</a>.</p>
      <textarea id="questions" placeholder="Why do you want to work at ${esc(j.company)}?\nHow many years of experience do you have with SAP?">${esc((answers || []).map(a => a.question).join('\n'))}</textarea>
      <div class="row"><button class="btn primary" data-act="answers" ${answering ? 'disabled' : ''}>${answers ? 'Write them again' : 'Write answers'}</button></div>
      ${(answers || []).map((a, i) => `<div class="qa"><b>${esc(a.question)}</b><div class="posting" id="ans${i}">${esc(a.answer)}</div><button class="btn ghost" data-act="copy" data-from="ans${i}">Copy</button></div>`).join('')}
      ${['ready', 'approved', 'applied', 'interviewing', 'offer'].includes(j.status) ? `<details class="kit" id="kitCard" ${j.status === 'approved' ? 'open' : ''}><summary><b>Every detail, to copy</b> <span class="muted small">every detail a form asks for, to copy one at a time when Fill this form doesn't work</span></summary><div id="kitBody" data-job="${esc(j.id)}"><p class="muted small">Loading…</p></div></details>` : ''}
    </section>` : ''}
    ${fu || following_up || j.status === 'applied' ? `<section class="card">
      <header><h2>Follow-up</h2>${following_up ? '<span class="muted small"><span class="spin" data-kind="followup"></span>Writing…</span>' : `<button class="btn" data-act="followUp" data-job="${esc(j.id)}">${fu ? 'Write again' : 'Write follow-up'}</button>`}</header>
      ${fu ? `<p class="small muted">${fu.draft ? 'Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>' : 'Written'} ${esc(ago(fu.at))}${fu.to ? ` · to ${esc(fu.to)}` : ' · add the recruiter\'s address before sending'}</p>
        <p><b>${esc(fu.subject)}</b></p><div class="posting" id="fuBody">${esc(fu.body)}</div>
        <div class="row"><button class="btn ghost" data-act="copy" data-from="fuBody">Copy</button></div>`
        : `<p class="muted">${following_up ? 'Claude is writing a short, polite note asking about the timeline.' : `No reply yet? Job Hunt drafts a short follow-up ${st.profile.follow_up_after ? `${st.profile.follow_up_after} days after you apply` : 'when you ask'}.`}</p>`}
    </section>` : ''}
    ${!['skipped', 'dismissed'].includes(j.status) ? `<section class="card" id="people">
      <header><h2>People at ${esc(j.company)}</h2>${writing_to ? '<span class="muted small"><span class="spin" data-kind="outreach"></span>Working on it: finding people and writing the note…</span>' : (contacts || []).length ? '<button class="btn ghost" data-act="findPeople">Find the recruiter on LinkedIn</button>' : ''}</header>
      <p class="muted small">A recruiter, the hiring manager or someone you know there. A short note to the right person often counts for more than a perfect CV. <a href="#" data-act="link" data-url="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(j.company + ' ' + (playbook?.kind === 'agency' ? 'recruiter' : j.title.split(/[,(-]/)[0]))}">Look on LinkedIn</a></p>
      ${overview?.can_fill !== false ? `<div class="qa team-get"><div class="row" style="justify-content:space-between;align-items:center"><span class="small"><b>The hiring team, from LinkedIn.</b> Many postings there list who posted the job and who it reports to. Open ${/linkedin\.com\/jobs/.test(j.url || '') ? 'the posting' : 'the job on LinkedIn'} signed in, click the Job Hunt extension and press <b>Send to Job Hunt</b>: the people it lists are added here, with a note to the first.</span>
        <button class="btn" data-act="link" data-url="${esc(/linkedin\.com\/jobs/.test(j.url || '') ? j.url : `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(`${j.title.split(/[,(]/)[0].trim()} ${j.company}`)}`)}">${svg('open')}${/linkedin\.com\/jobs/.test(j.url || '') ? 'Open the posting' : 'Find it on LinkedIn'}</button></div></div>` : ''}
      ${playbookHtml(playbook, contacts || [], j)}
      ${(know || []).filter(p => !(contacts || []).some(c => c.name === p.name)).map(p => `<div class="qa"><div class="row" style="justify-content:space-between"><span><span class="pill good">You know them</span> <b>${esc(p.name)}</b>${p.position ? ` · ${esc(p.position)}` : ''}${p.link ? ` · <a href="#" data-act="link" data-url="${esc(p.link)}">profile</a>` : ''}</span>
        <button class="btn primary" data-act="askReferral" data-person="${esc(JSON.stringify(p))}" ${writing_to ? 'disabled' : ''}>Ask ${esc(firstName(p.name))} for a referral</button></div></div>`).join('')}
      ${(contacts || []).map((c, i) => contactHtml(c, i, writing_to, playbook)).join('')}
      ${!(contacts || []).length && ['approved', 'applied', 'interviewing'].includes(j.status) ? `<div class="qa"><div class="row" style="justify-content:space-between;align-items:center">
        <span class="small">${recruiter ? `You know <b>${esc(recruiter.name)}</b>, a recruiter there.` : 'Job Hunt looks on LinkedIn for the recruiter who hires for this role (or the hiring manager) and writes a short note to them, to send from their profile.'}</span>
        <span class="row">${recruiter ? '' : `<button class="btn primary" data-act="findPeople" ${writing_to ? 'disabled' : ''}>Find the recruiter on LinkedIn</button>`}
        <button class="btn${recruiter ? ' primary' : ''}" data-act="noteRecruiter" data-name="${esc(recruiter?.name || '')}" data-email="${esc(recruiter?.email || '')}" ${writing_to ? 'disabled' : ''}>${recruiter ? `Write a note to ${esc(firstName(recruiter.name))}` : 'Write it without a name'}</button></span></div></div>` : ''}
      <div class="row contact-add"><input type="text" id="cName" placeholder="Name"><input type="text" id="cRole" placeholder="Role (e.g. hiring manager)"><input type="text" id="cEmail" placeholder="Email or LinkedIn link (optional)">
        <button class="btn" data-act="addContact">Add</button></div>
    </section>` : ''}    ${offer || advising || j.status === 'offer' ? `<section class="card prep">
      <header><h2>The offer</h2>${advising ? '<span class="muted small"><span class="spin" data-kind="offer"></span>Weighing it…</span>' : ''}</header>
      <textarea id="offerText" placeholder="Paste the offer: base salary, bonus, equity, benefits, vacation, start date…">${esc(offer?.offer || '')}</textarea>
      <div class="row"><button class="btn primary" data-act="offerAdvice" ${advising ? 'disabled' : ''}>${offer ? 'Weigh it again' : 'Weigh the offer'}</button>
        <span class="muted small">Compared with the posted range, your minimum and any other offers, with what to ask for and a counter-offer email.</span></div>
      ${offer?.advice ? mdHtml(offer.advice) : ''}
    </section>` : ''}
    </div>
    <div class="jpane" data-pane="chat" ${tab === 'chat' ? '' : 'hidden'}>
    <section class="card chat">
      <header><h2>Ask Claude about this job</h2>${(chat || []).length ? '<button class="btn ghost sm" data-act="chatClear">Start over</button>' : ''}</header>
      <p class="muted small">Claude knows this posting, your CV for it and your notes. Ask for an answer to a form question, a shorter cover letter, what to say about salary, or how to prepare.</p>
      <div class="chat-log">${(chat || []).map((m, i) => `<div class="chat-msg ${m.who === 'you' ? 'me' : 'them'}">${m.who === 'you' ? esc(m.text) : `<div id="chat${i}">${mdHtml(m.text)}</div><button class="btn ghost sm" data-act="copy" data-from="chat${i}">Copy</button>`}</div>`).join('')}
        ${chatting ? '<div class="chat-msg them"><span class="spin" data-kind="chat"></span>Writing…</div>' : ''}</div>
      <div class="chat-send"><textarea id="chatMsg" rows="2" placeholder="e.g. Write a 100-word answer to “Why do you want to work here?”" ${chatting ? 'disabled' : ''}></textarea>
        <button class="btn primary" data-act="chatSend" ${chatting ? 'disabled' : ''}>Send</button></div>
    </section>
    </div>
    <div class="jpane" data-pane="interview" ${tab === 'interview' ? '' : 'hidden'}>
    <section class="card prep">
      <header><h2>Interview prep</h2>${preparing ? '<span class="muted small"><span class="spin" data-kind="prep"></span>Writing…</span>' : `<button class="btn" data-act="prep">${prep ? 'Write again' : 'Write prep sheet'}</button>`}</header>
      ${prep ? mdHtml(prep) : `<p class="muted">${preparing ? 'Claude is writing likely questions, answers from your CV, gaps to prepare for and questions to ask. This page updates by itself.' : 'Likely questions with answers from your CV, what the company is up to now (from a quick web search), gaps to prepare for, and questions to ask them.'}</p>`}
      ${prep ? '<p class="muted small">Also saved as “Interview prep.md” with this application\'s files.</p>' : ''}
      <p class="muted small">The evening before an interview on your calendar, Job Hunt makes sure this sheet is ready and reminds you.</p>
      <p><button class="btn" type="button" data-act="practise">Practise this interview</button> <span class="muted small">Claude plays the interviewer here, one question at a time, with feedback on each answer.</span></p>
      <p class="muted small">${claude_desktop ? `Practise out loud: in the Claude app, ask <b>“Practise my interview for ${esc(j.company)}”</b>. Claude plays the interviewer and gives feedback on each answer.` : 'Want a mock interview with feedback? Add Job Hunt to the Claude app in <a href="#settings/app">Settings → App</a>.'}</p>
    </section>
    ${thanks || thanking || ['interviewing', 'offer'].includes(j.status) ? `<section class="card">
      <header><h2>Thank-you note</h2>${thanking ? '<span class="muted small"><span class="spin" data-kind="thanks"></span>Writing…</span>' : `<button class="btn" data-act="thanks">${thanks ? 'Write again' : 'Write it now'}</button>`}</header>
      ${thanks ? `<p class="small muted">${thanks.draft ? 'Saved in your <a href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Gmail drafts</a>' : 'Written'} ${esc(ago(thanks.at))}${thanks.to ? ` · to ${esc(thanks.to)}` : ' · add the interviewer\'s address before sending'}</p>
        <p><b>${esc(thanks.subject)}</b></p><div class="posting">${esc(thanks.body)}</div>
        <p class="muted small">Fill in the [bracketed] detail from your conversation, then send it the same day.</p>` : '<p class="muted">Job Hunt drafts one about an hour and a half after each interview on your calendar starts, so you can send it the same day.</p>'}
    </section>` : ''}
    </div>
    </div>`);
  main().dataset.job = id;
  main().dataset.status = j.status;
  changeList = j.cv_changes || [];
  document.querySelectorAll('#jobTabs [data-jtab]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    jobTabs[id] = a.dataset.jtab;
    document.querySelectorAll('#jobTabs [data-jtab]').forEach(x => x.classList.toggle('on', x === a));
    document.querySelectorAll('.jpane').forEach(p => { p.hidden = p.dataset.pane !== a.dataset.jtab; });
  }));
  document.querySelectorAll('#pvTabs [data-pv]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#pvTabs [data-pv]').forEach(x => x.classList.toggle('on', x === b));
    ['cv', 'letter'].forEach(k => { const el = $(`#pv-${k}`); if (el) el.hidden = k !== b.dataset.pv; });
  }));
  if (j.cv_path && !(own?.cv && /\.pdf$/i.test(j.cv_path))) api(`/api/jobs/${encodeURIComponent(id)}/preview`).then(({ cv }) => {
    const el = $('#pv-cv'); if (el) el.innerHTML = cv ? cvHtml(cv) : own?.cv ? '<p class="muted">Your own CV is a PDF: use <b>Open tailored CV</b> to see it.</p>' : '<p class="muted">The tailored CV file is missing. Re-tailor to make a new one.</p>';
    if (revision?.what === 'cv') markRevision(revision);
  }).catch(e => { const el = $('#pv-cv'); if (el) el.innerHTML = `<p class="muted">${esc(e.message)}</p>`; });
  // Just changed the letter: show it, with the changed paragraphs marked.
  if (revision?.what === 'letter') { document.querySelector('#pvTabs [data-pv=letter]')?.click(); markRevision(revision); }
  main().dataset.contacts = JSON.stringify(contacts || []);
  // Opened for one part of the page (Write a note → People at the company): go there.
  if (scrollToAfter) { const at = document.getElementById(scrollToAfter); scrollToAfter = ''; if (at) setTimeout(() => at.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
  loadKit();
  if (tailoring || preparing || revising || following_up || answering || advising || writing_to || thanking || chatting) jobPoll = setTimeout(() => { if (location.hash === `#job/${encodeURIComponent(id)}`) { refreshOverview().then(route); } }, 4000);
}

/** The copy-and-paste kit on a job's Apply tab: each detail with its own Copy button. */
async function loadKit() {
  const box = $('#kitBody');
  if (!box) return;
  let k;
  try { k = await api(`/api/jobs/${encodeURIComponent(box.dataset.job)}/kit`); } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
  let n = 0;
  // A row: its label, the value (long ones folded), and Copy.
  const row = (label, value, long) => {
    if (!value || !String(value).trim()) return '';
    const id = 'kit' + n++;
    return `<div class="kit-row"><span class="kit-l">${esc(label)}</span><span class="kit-v${long ? ' long' : ''}" id="${id}">${esc(value)}</span><button class="btn ghost sm" data-act="copy" data-from="${id}">Copy</button></div>`;
  };
  const entry = (e, i, what) => {
    const parts = (e.parts || []).length > 1 ? e.parts.map((p, j) => row(j === 0 ? `${what} ${i + 1}` : '', p)).join('') : row(`${what} ${i + 1}`, e.heading);
    return `<div class="kit-entry">${parts}${row('From', e.from_mm || e.from)}${e.from && e.from_mm && e.from !== e.from_mm ? row('From (as on CV)', e.from) : ''}${row('To', e.to_mm || e.to)}${/present|current|now|date|ongoing/i.test(e.to || '') ? row('Current', 'Yes, I currently work here') : ''}${row('Description', e.description, true)}</div>`;
  };
  const group = (title, inner) => inner.trim() ? `<h3 class="kit-h">${title}</h3>${inner}` : '';
  box.innerHTML = `<div class="kit">
    ${group('You', k.contact.map(c => row(c.label, c.value)).join(''))}
    ${group('Your facts for forms', (k.facts || []).map(f => row(f.label || 'Fact', f.value)).join(''))}
    ${group('Work experience', (k.jobs || []).map((e, i) => entry(e, i, 'Job')).join(''))}
    ${group('Education', (k.schools || []).map((e, i) => entry(e, i, 'School')).join(''))}
    ${group('Skills', (k.skills ? k.skills.split(/\s*[;,|•·\n]\s*/).map(x => x.replace(/^[-–*\s]+|[.\s]+$/g, '')).filter(x => x && x.length < 60) : []).map(x => row('Skill', x)).join('') + row('All of them', k.skills, true))}
    ${group('Languages', (k.languages || []).map(l => row('Language', l)).join(''))}
    ${group('Answers written for this application', (k.answers || []).map(a => row(a.question, a.answer, true)).join(''))}
    ${group('Cover letter', row('Letter', k.letter, true))}
    ${group('Whole CV as text', row('CV', k.cv, true))}
    <p class="muted small">From the CV this application uses${(k.jobs || []).length ? '' : ' (Job Hunt found no dated jobs in it: copy from the whole CV below)'} and your <a href="#cvs/details">facts for forms</a>. Edit those to change what's here.</p></div>`;
}
