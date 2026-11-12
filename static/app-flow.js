// Job Hunt screens, continued. The guided setup, reviewing tailored applications one at a time, and applying.
'use strict';

// ---- First-time setup, in one guided page ----
const welcomed = () => { try { return !!sessionStorage.getItem('welcomed'); } catch { return true; } };
/** Newer data from another computer (in Google Drive or a sync folder): continue from it here? */
const syncNewerHtml = n => n ? `<section class="card sync-banner"><header><h2>Continue where you left off</h2></header>
      <p>Job Hunt on <b>${esc(n.device)}</b> saved newer data ${esc(ago(n.saved_at))}${n.jobs ? ` (${n.jobs} roles)` : ''}. Continue from it here? Job Hunt restarts with it, and what's on this computer now is kept in a "before-restore" folder.</p>
      <div class="row"><button class="btn primary" data-act="syncContinue" data-folder="${esc(n.folder)}">Continue from ${esc(n.device)}</button>
      <button class="btn ghost" data-act="syncDecline" data-saved="${esc(n.saved_at)}">Keep this computer's data</button></div></section>` : '';
async function showWelcome() {
  try { sessionStorage.setItem('welcomed', '1'); } catch {}
  const st = settingsCache = await api('/api/settings');
  await refreshOverview();
  const s = overview.setup, p = st.profile;
  const fresh = !(p.locations || []).length; // nothing saved yet: suggest this device's country and time zone
  let wantDone = false;
  try { wantDone = !!localStorage.getItem('jh.wantDone'); } catch (e) {}
  const browserName = st.app?.browser === 'chrome' ? 'Chrome' : 'Edge';
  // Each step: [done, title, what's in it, optional]. The first one not done is open; the rest fold.
  const steps = [
    [s.claude, 'Connect Claude', `<p class="muted">Claude is the AI that reads job postings and rewrites your CV for each one. It's a paid service from Anthropic, separate from Job Hunt: you need your own Claude plan (Pro or Max). ${s.engine === 'api' ? 'Job Hunt uses your Claude API key.' : 'Job Hunt uses your Claude subscription (Pro or Max).'}</p>
        ${s.engine === 'api' ? `<p class="muted">${s.claude ? '✓ Ready, with your API key.' : 'Add your API key in <a href="#settings/connections">Settings → Accounts</a>.'}</p>`
          : `<div id="welcomeClaude" class="small muted"><span class="spin" data-kind="check" data-secs="6"></span> Checking…</div><p class="muted small" style="margin-top:8px">No Claude subscription? <a href="#settings/connections">Use an API key instead</a> (you pay per use).</p>`}`],
    [st.cvs.length > 0, 'Add your CV', `<p class="muted">Word, PDF or text. Add one per kind of role (e.g. data engineering, program delivery). Claude reads each one and suggests the job titles to search for.</p>
        <label class="drop"><input type="file" accept=".docx,.pdf,.txt" multiple data-upload="cv-add" hidden><b>Add CVs</b><br><span class="muted small">Click to choose files</span></label>
        ${st.cvs.map(c => `<p class="small" style="margin:8px 0 0"><b>${esc(c.label)}</b>: ${(c.titles || []).length} job titles to search, like ${esc((c.titles || []).slice(0, 4).join(', ') || 'none yet')}${(c.areas || []).length ? `<br><span class="muted">Experience found: ${esc(c.areas.map(a => a.split(':')[0]).join(', '))}</span>` : ''} <a href="#cvs">See all and edit</a></p>`).join('')}
        ${st.cvs.length ? `<p class="small" style="margin-top:8px">${st.career_thinking ? '<span class="spin" data-kind="career"></span>Claude is working out your career options: every direction your CV supports, with pay, pros and cons. ' : st.career ? '' : ''}${st.career || st.career_thinking ? '<a href="#cvs/career">See your career options</a>' : ''}</p>` : ''}`],
    [(p.locations || []).length > 0, 'Where you want to work', `<form data-form="welcomeWhere" class="form">
          <div class="field">Cities or areas${placePicker('locations', p.locations, (fresh && tzCountry(deviceTz(), st.countries)) || p.sources.adzuna_country)}</div>
          <div class="stack" style="gap:12px">
            <label class="field">Country${countrySelect('country', (fresh && tzCountry(deviceTz(), st.countries)) || p.sources.adzuna_country, st.countries)}</label>
            <label class="field">Your time zone${tzSelect('timezone', fresh && deviceTz() ? deviceTz() : p.timezone)}<span class="hint">For interview times and when the daily search runs.</span></label>
            <label class="check"><input type="checkbox" name="include_metro" ${p.include_metro !== false ? 'checked' : ''}> <span>Include the area around each city<br><span class="muted small">Toronto, Oakville or any GTA city brings in the whole GTA (Mississauga, Markham, Vaughan…), Vancouver or Burnaby Metro Vancouver, Montreal Laval and Longueuil, London Greater London, New York the NYC area, Dubai Sharjah and Ajman.</span></span></label>
            <label class="check"><input type="checkbox" name="remote_ok" ${p.remote_ok ? 'checked' : ''}> <span>Include remote roles open across the country</span></label>
            <div><button class="btn primary" type="submit">Save</button></div>
          </div></form>`],
    [wantDone || !!p.min_salary || !!p.wants?.level || !!p.wants?.work, 'What you\'re looking for', `<p class="muted">A few things that save you from reading postings you'd turn down. Leave any of them empty; you can change them later in Me.</p>
        <form data-form="welcomeWant" class="form">
          <label class="field">The lowest yearly pay you'd take<input type="number" name="min_salary" min="0" step="1000" value="${p.min_salary ?? ''}" placeholder="No minimum, e.g. 90000"><span class="hint">Jobs that state less are set aside. Most postings don't say, and those are kept.</span></label>
          <label class="field">The level you're going for<input type="text" name="want_level" value="${esc(p.wants?.level || '')}" placeholder="e.g. senior analyst, or manager"></label>
          <label class="field">Permanent or contract<select name="want_work">${[['', 'Either'], ['permanent', 'Permanent only'], ['contract', 'Contract only']].map(([v, n]) => `<option value="${v}" ${(p.wants?.work || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="check" style="grid-column:1/-1"><input type="checkbox" name="strong" ${p.auto_tailor || p.auto_tailor_min > 0 || !wantDone ? 'checked' : ''}> <span>Get the best matches ready by themselves<br><span class="muted small">After each search, Job Hunt rewrites your CV and writes a cover letter for the strongest few matches, so they're waiting for you to read and approve. It uses some of your Claude plan.</span></span></label>
          <div><button class="btn primary" type="submit">Save and go on</button></div></form>`],
    [true, 'Where to look', `<p class="muted">Nothing to do here unless you want to: Job Hunt already finds employers near you and searches their job pages. These add more:</p>
        <div class="stack" style="gap:8px">
          <label class="check"><input type="checkbox" data-act="welcomeSource" data-id="linkedin" ${p.sources.linkedin ? 'checked' : ''}> <span><b>LinkedIn</b> <span class="muted small">free, in any country; never touches your LinkedIn account</span></span></label>
          ${p.sources.adzuna_country === 'ca' ? `<label class="check"><input type="checkbox" data-act="welcomeSource" data-id="jobbank" ${p.sources.jobbank ? 'checked' : ''}> <span><b>Job Bank</b> <span class="muted small">Canada's national job board, free</span></span></label>` : ''}
        </div>
        <p class="muted small" style="margin-top:8px">More job sites and recruiters any time in <a href="#search/setup">Settings → Job sources</a>.</p>`],
    [!!overview.last_search, 'Run your first search', `<p class="muted">It takes a few minutes, and you can leave it to it. Jobs that fit come to your <b>Queue</b>. For each one you tick, Job Hunt rewrites your CV and writes a cover letter; you read them, approve, and apply.</p>
        <div class="row"><button class="btn primary big" data-act="welcomeSearch" ${s.claude && st.cvs.length ? '' : 'disabled'}>Search for jobs now</button>${s.claude && st.cvs.length ? '' : '<span class="muted small">After Connect Claude and Add your CV.</span>'}</div>`],
    [!!st.ext_last, 'Have Job Hunt fill in application forms', `<p class="muted">When you apply, Job Hunt opens the company's form in ${browserName} and a small add-on fills it in from your CV: your details, work history, the questions. You check it and press Submit yourself. Setting it up takes about two minutes, once.</p>
        <div class="row"><a class="btn" href="#settings/extension">Set it up</a><span class="muted small">You can apply without it: you'd fill the forms in by hand, with your tailored CV and letter ready to attach.</span></div>`, true],
    [!!st.google.connected, 'Connect your email and calendar', `<p class="muted">With your Gmail connected, Job Hunt notices replies from employers, drafts your answers, puts interviews in your calendar and keeps a private backup in your own Google Drive. It never sends an email without you.</p>
        <div class="row"><a class="btn" href="#settings/connections">Connect Gmail</a></div>`, true],
  ];
  const need = steps.filter(x => !x[3]);
  const doneCount = need.filter(x => x[0]).length;
  const open = steps.findIndex(x => !x[0] && !x[3]) >= 0 ? steps.findIndex(x => !x[0] && !x[3]) : steps.findIndex(x => !x[0]);
  page(`<div class="head"><div class="grow"><h1>${doneCount === need.length ? 'You\'re all set' : 'Welcome to Job Hunt'}</h1>
      <p class="muted">${doneCount === need.length ? 'Everything it needs is in place. The two optional steps below make it do more for you.' : 'Job Hunt looks for jobs that fit you every day, rewrites your CV for each one you choose, and helps you apply. Setting it up takes about ten minutes: do the step that\'s open, and the next one opens.'}</p></div>
      <a class="btn ${doneCount === need.length ? 'primary' : 'ghost'}" href="#overview">${doneCount === need.length ? 'Go to your Queue' : 'Skip for now'}</a></div>
    ${doneCount === need.length ? '' : `<section class="card setup-need"><b>What you need</b>
      <ul><li><b>Your CV</b>, as a Word file, a PDF or plain text.</li>
      <li><b>A Claude plan</b> (Pro or Max) from <a href="#" data-act="link" data-url="https://claude.ai/upgrade">claude.ai</a>. It's the AI that does the reading and writing, and you pay Anthropic for it, not Job Hunt. Job Hunt itself is free.</li>
      <li>Optional: <b>your Gmail</b>, so replies and interviews are handled too.</li></ul></section>`}
    <div class="setup-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${need.length}" aria-valuenow="${doneCount}"><span style="width:${Math.round(100 * doneCount / need.length)}%"></span></div>
    <p class="muted small setup-count">${doneCount} of ${need.length} steps done${doneCount === need.length ? '' : `. Next: ${esc(steps[open][1])}.`}</p>
    <ol class="apply-steps setup-steps">
      ${steps.map(([done, title, body, optional], i) => `<li class="card wstep ${done ? 'done' : ''} ${i === open ? 'now' : ''}"><details ${i === open ? 'open' : ''}><summary><h2>${done ? '✓ ' : ''}${esc(title)}</h2>${optional ? '<span class="pill">Optional</span>' : ''}<span class="muted small wstep-state">${done ? 'Done. Open to change it' : i === open ? '' : 'Open'}</span></summary>${body}</details></li>`).join('')}
    </ol>
    <details class="card setup-more"><summary><b>Moving from another computer, or want your files kept somewhere else?</b></summary>
    ${overview.sync_newer ? syncNewerHtml(overview.sync_newer) : `<section class="card flat"><header><h2>Already using Job Hunt on another computer?</h2></header>
      <p class="muted">Connect the same Google account here: Job Hunt finds your data in your Google Drive and offers to continue with all your CVs, applications and settings. (On the other computer, connecting Google turns that on.) Otherwise, start fresh below.</p>
      ${st.google.client ? `<div class="row"><button class="btn primary" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connected ? `Connected as ${esc(st.google.email || 'you')}: check again` : 'Connect Google'}</button>${st.google.connected ? '<span class="muted small">Nothing to continue from yet? Turn on sync on the other computer, wait a few minutes, then check again.</span>' : ''}</div>
        <div id="googlePaste" ${st.google.pasting ? '' : 'hidden'}>${googlePasteBox(st.google.paste_url)}</div>`
        : '<div class="row"><a class="btn" href="#settings/connections">Set up Google</a></div>'}</section>`}
    ${st.kind === 'server' ? '' : filesCard(st, true)}
    </details>`);
  if (s.engine !== 'api') welcomeClaude(false);
}

/** Welcome step 1: whether Claude Code is installed and signed in, with the button to do it. */
async function welcomeClaude(force) {
  const box = $('#welcomeClaude');
  if (!box) return;
  if (force) box.innerHTML = '<span class="spin" data-kind="check" data-secs="6"></span> Checking…';
  try {
    const st = await api('/api/settings/claude-code');
    if (!$('#welcomeClaude')) return;
    box.innerHTML = claudeSetupHtml(st);
    const li = box.closest('li'), ready = st.found && st.signed_in;
    li.classList.toggle('done', ready);
    li.querySelector('h2').textContent = (ready ? '✓ ' : '') + 'Connect Claude';
    // Just connected, while this page is open: on to the next step.
    if (ready && !overview?.setup?.claude) { await refreshOverview(); if (location.hash === '#welcome') route(); }
  } catch (err) { box.textContent = err.message; }
}

/** What changed in the tailored CV, each with Edit (your own wording) and Put back (your CV's line). */
function changesHtml(j, own) {
  if (own) return '<p class="muted">You\'re using your own CV file for this role, so there\'s no list of changes.</p>';
  if (!(j.cv_changes || []).length) return '<p class="muted">Your CV already matches this posting well, so nothing needed rewording. The cover letter was written for this role.</p>';
  return `<div class="diff">${j.cv_changes.map((c, i) => `<div class="chg-row" data-chg="${i}"><span class="was">${esc(c.before)}</span><span class="now">${esc(c.after)}</span>
    <span class="row chg-acts"><button class="btn ghost sm" data-act="chgEdit" data-i="${i}">Edit</button><button class="btn ghost sm" data-act="chgPutBack" data-i="${i}" title="Use the line from your CV">Put back</button></span>
    <span class="chg-form" hidden><textarea>${esc(c.after)}</textarea><span class="row"><button class="btn primary sm" data-act="chgSave" data-i="${i}">Save</button><button class="btn ghost sm" data-act="chgCancel" data-i="${i}">Cancel</button><span class="muted small">Your words, as you write them. Keep it true: you'll be asked about it.</span></span></span></div>`).join('')}</div>`;
}
let changeList = []; // the changes on the page, for Edit / Put back

// ---- Review: ready applications one at a time ----
const reviewSkipped = new Set(); // skipped for now, this session
let reviewPoll;
async function showReview() {
  clearTimeout(reviewPoll);
  const { jobs } = await api('/api/jobs?status=ready');
  const queue = jobs.filter(j => !reviewSkipped.has(j.id)).sort((a, b) => applyRank(b) - applyRank(a));
  if (!queue.length) {
    page(`<div class="head"><div class="grow"><h1>Review</h1></div></div><section class="card review-done"><h2>All caught up</h2>
      <p class="muted">${jobs.length ? `You skipped ${jobs.length} for now. <a href="#" data-act="reviewReset">Go through them again</a>.` : 'Nothing waiting for your review. New ones appear after you tailor roles.'}</p>
      <div class="row" style="justify-content:center"><a class="btn primary" href="#applications">Back to Jobs</a><a class="btn" href="#overview">Today</a></div></section>`);
    return;
  }
  const j0 = queue[0];
  pageKey = j0.id;
  const [{ job: j, effort, warnings, revising, answers, revision, sent_compare }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(j0.id)}`), settingsCache ? Promise.resolve(settingsCache) : api('/api/settings')]);
  j.effort = effort;
  const done = jobs.length - queue.length;
  const flags = j.red_flags || [];
  j.warnings = warnings || [];
  page(`<div class="head"><div class="grow"><div class="eyebrow">Review · ${queue.length} to go${done ? ` · ${done} skipped` : ''}</div>
      <h1>${esc(j.title)}</h1><div class="facts" style="margin-top:6px"><b>${esc(j.company)}${ratingTag(j.rating)}</b>${j.location ? `<span>${placeHtml(j)}</span>` : ''}${j.salary ? `<span>${esc(j.salary)}</span>` : ''}<span>${ageTag(j)}</span>${closedTag(j)}${belowMinTag(j)}${deadlineTag(j)}${effortTag(j)}</div></div>
      <a class="btn ghost" href="#applications/approve">Exit review</a></div>
    ${expiredWhy(j) ? `<div class="card" style="border-color:var(--crit)"><b>This opening has expired.</b> <span class="muted">${esc(expiredWhy(j).replace(/^Expired: /, ''))}. Check the posting before approving it.</span></div>` : ''}
    ${revising ? '<section class="card"><p><span class="spin" data-kind="revise"></span> Making your changes… this updates by itself.</p></section>' : revisionHtml(revision)}
    ${sentCompareHtml(j, sent_compare)}
    <div class="grid-2">
      <div class="stack">
        <section class="card"><header><h2>Why it fits</h2>${j.url ? `<button class="btn ghost" data-act="open" data-what="posting" data-job="${esc(j.id)}">${svg('open')}Posting</button>` : ''}</header>
          <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
            ${j.score != null ? `<div class="fit-pair"><div><div class="ring" style="--p:${j.score}"><b>${j.score}</b></div><span class="muted small">your CV</span></div>${j.score_after != null ? `<span class="fit-arrow">→</span><div><div class="ring" style="--p:${j.score_after}"><b>${j.score_after}</b></div><span class="muted small">tailored</span></div>` : ''}</div>` : ''}
            <p>${esc(j.reasoning || '')}</p></div>
          ${flags.length ? `<ul class="flags">${flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
          ${j.coverage_after != null ? `<p class="muted small">Posting keywords in your CV: <b>${pct(j.coverage_before)}</b> before, <b>${pct(j.coverage_after)}</b> after.${(j.keyword_gaps || []).length ? ` Not added (nothing in your CV backs them): ${esc(j.keyword_gaps.slice(0, 6).join(', '))}.` : ''}</p>` : ''}
        </section>
        <section class="card"><header><h2>What changed in your CV</h2><button class="btn ghost" data-act="open" data-what="cv" data-job="${esc(j.id)}">${svg('doc')}Open</button></header>
          ${gapsHtml(j)}
          ${changesHtml(j, false)}
        </section>
      </div>
      <div class="stack">
        <section class="card"><header><h2>Cover letter</h2><a class="btn ghost" href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs">Edit</a></header>
          ${j.cover_letter ? `<div class="paper letter">${letterHtml(j.cover_letter, st.signature)}</div>` : '<p class="muted">No letter.</p>'}</section>
        <section class="card"><header><h2>Want something changed?</h2></header>
          <div class="row" style="align-items:flex-start"><select id="reviseWhat" style="width:auto"><option value="cv">CV</option>${j.cover_letter ? '<option value="letter">Cover letter</option>' : ''}</select>
            <textarea id="reviseNote" style="flex:1;min-height:56px" placeholder="e.g. Lead with the Snowflake work · Shorter letter"></textarea></div>
          <div class="row"><button class="btn" data-act="revise" ${revising ? 'disabled' : ''}>Make the change</button></div></section>
      </div>
    </div>
    <div class="review-bar">
      <button class="btn primary" data-act="reviewApprove" data-job="${esc(j.id)}" data-email="${esc(j.apply_email || '')}" title="A">${svg('check')}${j.apply_email ? 'Approve and email it' : 'Approve and apply'}</button>
      <button class="btn" data-act="stage" data-status="saved" data-job="${esc(j.id)}" data-from="ready" title="S">Save for later</button>
      <button class="btn danger" data-act="stage" data-status="dismissed" data-job="${esc(j.id)}" data-from="ready" title="X">Not interested</button>
      <button class="btn ghost" data-act="reviewSkip" data-job="${esc(j.id)}" title="N">Skip for now →</button>
      <span class="muted small desktop-only">Keys: A approve · S save · X not interested · N skip</span>
    </div>`);
  main().dataset.job = j.id;
  main().dataset.status = j.status;
  changeList = j.cv_changes || [];
  if (revising) reviewPoll = setTimeout(() => { if (location.hash === '#review') route(); }, 4000);
}

// ---- Apply: everything for submitting on the company's site, then one click ----
async function showApply(id) {
  const [{ job: j, answers, cv_pdf, letter_pdf, can_fill, on_apply }, st] = await Promise.all([api(`/api/jobs/${encodeURIComponent(id)}`), api('/api/settings')]);
  const p = st.profile;
  const facts = [p.name, p.email, ...(p.application_facts || '').split('\n')].map(x => (x || '').trim()).filter(Boolean);
  const copyRow = (label, text, i) => `<div class="copy-row"><span class="grow"><span class="muted small">${esc(label)}</span><br><span id="cp${i}">${esc(text)}</span></span><button class="btn ghost sm" data-act="copy" data-from="cp${i}">Copy</button></div>`;
  const done = ['applied', 'interviewing', 'offer', 'rejected'].includes(j.status);
  page(`<div class="head"><div class="grow"><div class="eyebrow"><a href="#job/${encodeURIComponent(j.id)}">${esc(j.company)}</a> / Apply</div><h1>Apply: ${esc(j.title)} ${closedTag(j)}</h1>
      <p class="muted">${!done && expiredWhy(j) ? `<b style="color:var(--crit)">${esc(expiredWhy(j))}.</b> Check the posting is still open before you apply.` : done ? 'You\'ve applied to this one.' : can_fill && j.url ? 'Job Hunt can fill in the form for you, or use the files and answers below yourself.' : 'Four steps. Your files and answers are ready below.'}</p></div></div>
    <ol class="apply-steps">
      ${can_fill && j.url && !done ? `<li class="card"><h2>Let Job Hunt fill it in</h2>
        <p class="muted">Opens ${j.apply_url ? 'the job on the company\'s own site' : 'the posting'} in your own browser, where your sign-ins and saved passwords work. On the form, click the Job Hunt extension and press <b>Fill this form</b>: it fills it in from your CV, letter, facts and saved answers, and attaches your files. You check it and press Submit.</p>
        <div class="row"><button class="btn primary" data-act="fillBrowser" data-job="${esc(j.id)}" title="Opens it in Chrome or Edge; the Job Hunt extension fills it in">${svg('open')}Fill it in my browser</button><button class="btn" data-act="fillForm" data-job="${esc(j.id)}" title="Opens it in a Job Hunt window and fills it in there. Sites that need you to sign in are easier in your own browser.">${svg('check')}In a Job Hunt window instead</button></div>
        <details class="more"><summary class="small muted">How it works, and marking it applied</summary><p class="muted small">Job Hunt doesn't press Submit (unless you turned that on for simple forms): check the form, fix anything in amber, and submit it yourself. When the site confirms it, Job Hunt marks the application as applied by itself; or press <b>Mark applied</b> here. The extension is set up in <a href="#settings/extension">Settings → Browser extension</a>. The steps below are there if you'd rather do it yourself, or for anything it couldn't fill.</p></details></li>` : ''}
      <li class="card"><h2>${j.apply_url ? 'Open it on the company\'s site' : 'Open the posting'}</h2><p class="muted">${j.apply_url ? 'Applying on the company\'s own site goes straight to them, not through a job board.' : 'Use the company\'s Apply button.'} If it asks you to sign in or make an account, do that first.</p>
        <div class="row">${j.apply_url ? `<button class="btn ${can_fill ? '' : 'primary'}" data-act="open" data-what="company" data-job="${esc(j.id)}">${svg('open')}Apply on the company's site</button>` : ''}
        ${j.url ? `<button class="btn ${j.apply_url ? 'ghost' : can_fill ? '' : 'primary'}" data-act="open" data-what="posting" data-job="${esc(j.id)}">${svg('open')}${j.apply_url ? 'The job board posting' : 'Open the posting'}</button>` : ''}
        ${!j.apply_url && j.url && !done ? `<button class="btn ghost" data-act="findApply" data-job="${esc(j.id)}" title="Claude searches the company's careers site for this job">${svg('search')}Find it on the company's site</button>` : ''}</div>
        ${j.url || j.apply_url ? '' : '<p class="muted">No link saved for this posting.</p>'}</li>
      <li class="card"><h2>Attach your CV and cover letter</h2><p class="muted">Most sites take PDF; use Word only if they ask for it. <b>Show files</b> opens the folder so you can drag them in.</p>
        <div class="row">
          <button class="btn" data-act="open" data-what="cv-pdf" data-job="${esc(j.id)}">${svg('doc')}CV (PDF)</button>
          <button class="btn" data-act="open" data-what="letter-pdf" data-job="${esc(j.id)}">${svg('doc')}Cover letter (PDF)</button>
          <button class="btn ghost" data-act="open" data-what="cv" data-job="${esc(j.id)}">CV (Word)</button>
          <button class="btn ghost" data-act="open" data-what="letter" data-job="${esc(j.id)}">Letter (Word)</button>
          <button class="btn ghost" data-act="open" data-what="folder" data-job="${esc(j.id)}">${svg('folder')}Show files</button>
        </div>${cv_pdf && letter_pdf ? '' : '<p class="muted small">The PDF copies are made when you open them, and made again after you change the Word file (needs Word or LibreOffice).</p>'}</li>
      <li class="card"><h2>Fill in the form</h2>
        ${facts.length ? `<div class="copy-list">${facts.map((f, i) => copyRow(i === 0 ? 'Name' : i === 1 ? 'Email' : 'From your facts for forms', f, `f${i}`)).join('')}</div>` : ''}
        ${(answers || []).length ? `<h3 class="sub" style="margin-top:12px">Answers to the usual questions</h3><div class="copy-list">${answers.map((a, i) => copyRow(a.question, a.answer, `a${i}`)).join('')}</div>`
          : `<p class="muted">For questions like “Why this company?” or salary expectations, <a href="#job/${encodeURIComponent(j.id)}" data-tab-to="apply">have Claude write answers</a> from your CV and this posting.</p>`}
        ${(p.application_facts || '').trim() ? '' : '<p class="muted small">Add the facts forms ask for (work authorization, notice period, salary expectations) in <a href="#cvs/details">Me → About me</a> to have them here.</p>'}</li>
      <li class="card"><h2>Done?</h2><p class="muted">Job Hunt then waits for a reply, and reminds you to follow up if none comes${p.follow_up_after ? ` in ${p.follow_up_after} days` : ''}.${on_apply?.to && on_apply.mode !== 'off' && !done
        ? ` It also ${on_apply.mode === 'send' ? 'emails' : 'drafts an email to'} <b>${esc(on_apply.to.name || on_apply.to.email)}</b>${on_apply.to.known ? ', the recruiter you know there, asking them to put you forward' : ' (named in the posting) to say you\'ve applied'}. <a href="#inbox/recruiters">Change this</a>` : ''}</p>
        <div class="row">${done ? `<a class="btn" href="#job/${encodeURIComponent(j.id)}">Back to the job</a>` : `<button class="btn primary" data-act="applied" data-job="${esc(j.id)}">${svg('check')}I've submitted it</button><a class="btn ghost" href="${reviewReturn ? '#review' : `#job/${encodeURIComponent(j.id)}`}">Not now</a>`}</div></li>
    </ol>`);
}
let reviewReturn = false;
