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

