// Job Hunt screens, continued. The calendar, Insights, and adding a job by hand.
'use strict';

// ---- Calendar ----
let calMonth = null; // the month shown, as its first day
const CAL_KIND = { interview: ['Interview', 'interviewing'], prep: ['Prep', 'queued'], reminder: ['Reminder', 'approved'], deadline: ['Deadline', 'crit'], 'follow-up': ['Follow-up', 'info'], google: ['Google Calendar', ''] };
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const timeOf = iso => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The Calendar page's tabs: the calendar, and its settings (email, interviews, reminders; moved from Settings). */
const calHead = () => `<div class="head"><div class="grow"><div class="eyebrow"><a href="#calendar">Calendar</a> / Settings</div><h1>Calendar settings</h1><p class="muted">Your time zone, and how Job Hunt books interviews and reminds you.</p></div>
  <div class="row"><a class="btn" href="#calendar">${svg('calendar')}Back to the calendar</a></div></div>`;
async function showCalendar() {
  const [{ items, google, synced, show_google, syncing }, { jobs }] = await Promise.all([api('/api/calendar?back=60&ahead=120'), api('/api/jobs')]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  calMonth = calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  const byDay = {};
  items.forEach(i => { (byDay[dayKey(new Date(i.at))] ||= []).push(i); });
  // The month grid, Monday first.
  const first = calMonth, lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1))];
  const grid = `<div class="cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-h">${d}</div>`).join('')}
    ${cells.map(d => {
      if (!d) return '<div class="cal-d empty"></div>';
      const list = byDay[dayKey(d)] || [];
      return `<a href="#" class="cal-d ${+d === +today ? 'today' : ''} ${d < today ? 'past' : ''}" data-act="calDay" data-day="${dayKey(d)}"><span class="n">${d.getDate()}</span>
        ${list.slice(0, 3).map(i => `<span class="cal-e ${esc(i.kind)}">${i.all_day ? '' : `${esc(timeOf(i.at))} `}${esc(i.company || i.title)}</span>`).join('')}${list.length > 3 ? `<span class="muted small">+${list.length - 3} more</span>` : ''}</a>`;
    }).join('')}</div>`;
  // The agenda: what's coming, then what just happened.
  const row = i => {
    const [label, cls] = CAL_KIND[i.kind] || [esc(i.kind), ''];
    const past = new Date(i.at) < new Date() && !i.all_day;
    const job = i.job_id ? `<a href="#job/${encodeURIComponent(i.job_id)}" ${i.kind === 'interview' || i.kind === 'prep' ? 'data-tab-to="interview"' : ''}>${esc(i.job_title || 'Open the job')}</a>` : '';
    const id = esc(i.job_id || '');
    let acts = '';
    if (i.kind === 'interview' && !past && i.job_id) acts = `<a class="btn sm" href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prep</a>`;
    if (i.kind === 'interview' && past && i.job_id) acts = `<span class="muted small">How did it go?</span><button class="btn sm" data-act="calNext" data-job="${id}" data-label="${esc(`${i.company || ''} – ${i.job_title || ''}`)}">Next round</button><button class="btn sm" data-act="stage" data-status="offer" data-job="${id}">Offer</button><button class="btn ghost sm" data-act="stage" data-status="rejected" data-job="${id}">Rejected</button>`;
    if (i.kind === 'follow-up' && i.job_id) acts = `<button class="btn sm" data-act="followUp" data-job="${id}">Write follow-up</button>`;
    // A last day to apply that has passed: expired, nothing left to do there.
    const gone = i.kind === 'deadline' && new Date(new Date(i.at).setHours(23, 59, 59)) < new Date();
    if (gone) acts = '<span class="pill crit expired" title="The last day to apply has passed">Expired</span>';
    else if (i.kind === 'deadline' && i.status === 'queued') acts = `<button class="btn sm" data-act="tailorPicked" data-job="${id}">Tailor</button>`;
    else if (i.kind === 'deadline' && i.status === 'ready') acts = `<button class="btn primary sm" data-act="approve" data-job="${id}" data-email="${esc(i.apply_email || '')}">Approve</button>`;
    if (i.kind === 'google' && i.suggest) acts = `<span class="muted small">Interview for ${esc(i.suggest.company)}?</span><button class="btn sm" data-act="calLink" data-id="${esc(i.id)}" data-job="${esc(i.suggest.job_id)}" title="Show it with that application and move it to Interviewing">Link to application</button>`;
    if (i.local && i.kind === 'interview') acts += `<button class="btn ghost sm" data-act="calDelete" data-id="${esc(i.id)}" title="Remove this interview, its prep time and reminders">${svg('close')}</button>`;
    return `<div class="cal-row ${past ? 'past' : ''} ${i.kind === 'google' ? 'gcal' : ''}"><span class="cal-t">${i.all_day ? (i.overdue ? '<b style="color:var(--crit)">Due</b>' : 'All day') : esc(timeOf(i.at))}</span>
      <span class="pill ${cls}">${label}</span><span class="grow"><b>${esc(i.title)}</b>${job ? `<br><span class="small">${job}</span>` : ''}</span><span class="row todo-act">${acts}</span></div>`;
  };
  const group = list => {
    const out = {};
    list.forEach(i => { (out[dayKey(new Date(i.at))] ||= []).push(i); });
    return Object.entries(out).map(([k, l]) => `<div class="cal-day" id="day-${k}"><h3>${esc(new Date(k + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}${k === dayKey(today) ? ' <span class="pill good">Today</span>' : ''}</h3>${l.map(row).join('')}</div>`).join('');
  };
  const soon = items.filter(i => new Date(i.at) >= today && new Date(i.at) < new Date(+today + 31 * 86400000));
  const recent = items.filter(i => new Date(i.at) < today && new Date(i.at) >= new Date(+today - 14 * 86400000)).reverse();
  const pickable = jobs.filter(j => ['ready', 'approved', 'applied', 'interviewing', 'saved'].includes(j.status)).sort((a, b) => a.company.localeCompare(b.company));
  page(`<div class="head"><div class="grow"><h1>Calendar</h1><p class="muted">Interviews, prep time and reminders${google ? ' (also in your Google Calendar)' : ''}, application deadlines and follow-ups that are due.</p></div>
      <div class="row"><a class="btn ghost set-btn" href="#calendar/settings">${svg('settings')}Calendar settings</a><button class="btn primary" data-act="calAdd">${svg('add')}Add interview</button>
        <a class="btn" href="/api/calendar.ics" download="Job Hunt.ics" title="Import into Outlook or Apple Calendar">Download for Outlook / Apple</a>
        ${google ? `<button class="btn" data-act="calSync" ${syncing ? 'disabled' : ''} title="Copy Job Hunt's entries there, and bring back interviews you moved or deleted">${syncing ? 'Syncing…' : 'Sync with Google'}</button>
          <button class="btn ghost" data-act="link" data-url="https://calendar.google.com">Google Calendar</button>` : ''}</div></div>
    ${google ? `<p class="muted small" style="margin:-6px 0 12px">${synced ? `Synced with Google Calendar ${esc(ago(synced))}; it syncs every 30 minutes.` : 'Not synced with Google Calendar yet.'}
      <label class="check inline"><input type="checkbox" data-act="calShowGoogle" ${show_google ? 'checked' : ''}> Show my other Google Calendar events</label></p>` : ''}
    <section class="card" id="calAddCard" hidden><header><h2>Add an interview</h2></header>
      <form data-form="calInterview" class="form">
        <label class="field">Application<select name="job_id" required>${pickable.length ? pickable.map(j => `<option value="${esc(j.id)}">${esc(j.company)} – ${esc(j.title)}</option>`).join('') : '<option value="">No applications yet</option>'}</select></label>
        <label class="field">Date and time<input type="datetime-local" name="start" required></label>
        <label class="field">Length<select name="minutes">${[[30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']].map(([v, n]) => `<option value="${v}" ${v === 60 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field">Video link or place (optional)<input type="text" name="link" placeholder="https://teams.microsoft.com/… or 100 King St W"></label>
        <label class="field">Notes (optional)<input type="text" name="note" placeholder="Who you'll meet, what round"></label>
        <div class="row" style="align-self:end"><button class="btn primary" type="submit">Add it</button><button class="btn ghost" type="button" data-act="calAdd">Cancel</button></div>
      </form>
      <p class="muted small">Adds prep time before it and thank-you and follow-up reminders after (Settings → Schedule)${google ? ', in your Google Calendar too' : ''}, and moves the application to Interviewing.</p></section>
    <section class="card"><header><h2>${esc(calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2>
      <div class="row"><button class="btn ghost" data-act="calMonth" data-d="-1" title="Previous month" aria-label="Previous month">‹</button><button class="btn ghost" data-act="calMonth" data-d="0">Today</button><button class="btn ghost" data-act="calMonth" data-d="1" title="Next month" aria-label="Next month">›</button></div></header>
      ${grid}
      <div class="row small muted" style="margin-top:8px;gap:14px">${Object.entries(CAL_KIND).map(([k, [n]]) => `<span><i class="cal-key ${k}"></i>${n}</span>`).join('')}</div></section>
    <section class="card"><header><h2>Next 30 days</h2></header>${soon.length ? group(soon) : `<p class="muted">Nothing coming up.${google ? '' : ' Interviews you add here, or that Job Hunt books from your email once Google is connected, show up here.'}</p>`}</section>
    ${recent.length ? `<details class="card"><summary><b>Last 2 weeks</b> <span class="muted small">${recent.length}</span></summary>${group(recent)}</details>` : ''}`);
}

let docFilter = 'all';
/** Titles the career coach suggested this week: add one to its CV's searches, or say no. */
function titleIdeasHtml(ideas) {
  if (!ideas?.length) return '';
  return `<section class="card title-ideas"><header><h2>New titles to try</h2><a class="btn ghost sm" href="#cvs/coach">Why these</a></header>
    <p class="muted small">Your career coach thinks these would find good matches. Add one and the next search looks for it.</p>
    ${ideas.map(i => `<div class="idea-row"><div class="grow"><b>${esc(i.title)}</b>${i.cv ? ` <span class="muted small">· with your ${esc(i.cv)} CV</span>` : ''}<div class="muted small">${esc(i.why || '')}</div></div>
      <button class="btn sm primary" data-act="titleIdea" data-add="1" data-title="${esc(i.title)}">Add to my search</button><button class="btn sm ghost" data-act="titleIdea" data-title="${esc(i.title)}">No thanks</button></div>`).join('')}
  </section>`;
}

const COACH_KIND = { show: ['good', 'Say it on your CV'], learn: ['', 'Learn it'], experience: ['warn', 'Get the experience'] };
let coachWatch;
async function showCoach() {
  const r = await api('/api/coach');
  const g = r.gaps || { postings: 0, skills: [], must_haves: [] }, c = r.coach;
  const ideas = overview?.title_ideas || [];
  const jobsOf = x => (x.jobs || []).map(j => `<a href="#job/${encodeURIComponent(j.id)}">${esc(j.company)}</a>`).join(', ');
  page(`
    ${meHead('career', 'The skills the roles you go for ask for that your CV doesn\'t show, and what would help most.')}
    ${careerSeg('skills')}
    <section class="card coach-plan"><header><h2>Your career coach</h2>
      ${r.thinking ? '<span class="pill"><span class="spin" data-kind="coach"></span>Thinking…</span>' : `<button class="btn ${c ? 'ghost' : 'primary'}" data-act="coachRun" ${r.claude && g.postings ? '' : 'disabled'}>${c ? 'Look again' : 'Get my plan'}</button>`}</header>
      ${c ? `<p>${esc(c.advice)}</p><p class="muted small">From ${esc(fmtDate(c.at))}. Job Hunt looks again every week with your weekly review.</p>
        <div class="coach-skills">${(c.skills || []).map(k => { const [cls, label] = COACH_KIND[k.kind] || ['', k.kind]; return `<div class="coach-skill">
          <div class="row" style="justify-content:space-between"><b>${esc(k.skill)}</b><span class="pill ${cls}">${label}</span></div>
          <p class="small">${esc(k.why)}</p><p class="small"><b>How:</b> ${esc(k.how)}</p>${k.time ? `<p class="muted small">About ${esc(k.time)}</p>` : ''}</div>`; }).join('')}</div>`
        : `<p class="muted">${!g.postings ? 'After a search or two, your coach looks at the roles you go for and says which missing skills would help most, how to get each one, and new titles to try.' : !r.claude ? 'Connect Claude to get a plan (Settings → Accounts).' : 'Claude looks at the skills below and your CVs, then says which ones are worth the effort, how to get each, and new titles to try. It takes a minute.'}</p>`}
    </section>
    ${ideas.length ? titleIdeasHtml(ideas) : ''}
    <section class="card"><header><h2>Skills your CV doesn't show</h2><span class="muted small">From ${g.postings} role${g.postings === 1 ? '' : 's'} near your fit score in the last 90 days</span></header>
      ${g.skills.length ? `<table class="jobs" id="t-gaps"><thead><tr>${sortTh('Skill')}${sortTh('Not in your CV', 'num')}${sortTh('Asked for', 'num')}<th>For example</th></tr></thead><tbody>
        ${g.skills.map(x => `<tr><td data-v="${esc(x.skill.toLowerCase())}"><b>${esc(x.skill)}</b></td>
          <td data-v="${x.missing}"><div class="gap-bar"><span style="width:${Math.min(100, x.share)}%"></span></div><span class="small">${x.missing} role${x.missing === 1 ? '' : 's'} · ${x.share}%</span></td>
          <td data-v="${x.asked}" class="small">${x.asked}</td><td class="small">${jobsOf(x)}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">If you have one of these, add it to your CV in your own words, and tailoring will use it. Never claim one you don't have.</p>`
        : `<p class="muted">${g.postings ? 'Your CV covers what these roles ask for. Nice.' : 'Nothing yet: run a search first.'}</p>`}
    </section>
    ${g.must_haves.length ? `<section class="card"><header><h2>Hard requirements you missed</h2></header><ul class="flags">
      ${g.must_haves.map(m => `<li>${esc(m.text)} <span class="muted small">· <a href="#job/${encodeURIComponent(m.id)}">${esc(m.company)} – ${esc(m.title)}</a></span></li>`).join('')}</ul></section>` : ''}`);
  const t = document.getElementById('t-gaps');
  if (t) { if (!sortState['t-gaps']) sortState['t-gaps'] = { col: 1, dir: 'desc' }; applySort(t); }
  clearTimeout(coachWatch);
  if (r.thinking) { const here = location.hash; coachWatch = setTimeout(() => { if (location.hash === here) route(); }, 8000); }
}

async function showDocuments() {
  const { jobs } = await api('/api/jobs');
  const all = jobs.filter(j => j.cv_path || j.letter_path).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const week = Date.now() - 7 * 86400000;
  const groups = {
    all: ['All', () => true],
    ready: ['Ready to approve', j => j.status === 'ready'],
    sent: ['Applied', j => ['approved', 'applied'].includes(j.status)],
    interviewing: ['Interviewing', j => ['interviewing', 'offer'].includes(j.status)],
    week: ['This week', j => new Date(j.updated_at) >= week],
    saved: ['Saved for later', j => j.status === 'saved'],
    closed: ['Rejected or closed', j => ['rejected', 'no_response'].includes(j.status) || !!j.closed_at],
  };
  const docs = all.filter((groups[docFilter] || groups.all)[1]);
  page(`
    ${meHead('files', 'Every CV and cover letter tailored from yours. Click a heading to sort; click a role to read and edit them.')}
    ${all.length ? '<input type="search" id="docFilter" class="filter" placeholder="Filter by company or title" style="max-width:420px;margin-bottom:10px">' : ''}
    ${all.length ? `<div class="chips">${Object.entries(groups).map(([k, [n, f]]) => `<button class="chip ${k === docFilter ? 'on' : ''}" data-act="docFilter" data-f="${k}">${n} <b>${all.filter(f).length}</b></button>`).join('')}</div>` : ''}
    ${docs.length ? `<section class="card" style="padding:6px 10px"><table class="jobs" id="t-docs"><thead><tr>${sortTh('Company')}${sortTh('Role')}${sortTh('Location')}${sortTh('Stage', 'rank')}${sortTh('Fit', 'num')}${sortTh('Updated', 'date')}<th>Files</th></tr></thead><tbody>
      ${docs.map(j => `<tr class="docrow-t" data-text="${esc((j.company + ' ' + j.title).toLowerCase())}">
        <td class="co" data-v="${esc(j.company.toLowerCase())}">${coCell(j)}</td>
        <td class="role" data-v="${esc(j.title.toLowerCase())}"><a href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs"><b>${esc(j.title)}</b></a>${closedTag(j)}</td>
        <td class="loc small" data-v="${esc((j.location || '').toLowerCase())}">${locCell(j)}</td>
        <td data-v="${stageOrder(j.status)}">${stagePill(j.status)}</td>
        <td data-v="${j.score_after ?? j.score ?? -1}">${j.score != null ? scoreBadge(j.score_after ?? j.score) : '<span class="muted">–</span>'}</td>
        <td class="small muted nowrap" data-v="${esc(j.updated_at || '')}">${esc(fmtDate(j.updated_at))}</td>
        <td class="files"><div class="file-slots">
          ${j.cv_path ? `<button class="btn sm" data-act="open" data-what="cv" data-job="${esc(j.id)}" title="Open the CV in Word">${svg('doc')}CV</button>` : '<span></span>'}
          ${j.letter_path ? `<button class="btn sm" data-act="open" data-what="letter" data-job="${esc(j.id)}" title="Open the cover letter in Word">${svg('doc')}Letter</button>` : '<span></span>'}
          ${j.cv_path ? `<button class="btn ghost sm" data-act="open" data-what="cv-pdf" data-job="${esc(j.id)}" title="PDF copy of the CV">CV PDF</button>` : '<span></span>'}
          ${j.letter_path ? `<button class="btn ghost sm" data-act="open" data-what="letter-pdf" data-job="${esc(j.id)}" title="PDF copy of the cover letter">Letter PDF</button>` : '<span></span>'}
          <button class="btn ghost sm icon-only" data-act="open" data-what="folder" data-job="${esc(j.id)}" title="Show files">${svg('folder')}</button>
        </div>
        </td></tr>`).join('')}</tbody></table></section>`
    : `<p class="empty">${all.length ? 'Nothing here.' : 'No tailored CVs or cover letters yet. They appear here after you tailor a role, or add a job yourself.'}</p>`}`);
  $('#docFilter')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.docrow-t').forEach(r => { r.hidden = q && !r.dataset.text.includes(q); });
  });
  if (!sortState['t-docs']) sortState['t-docs'] = { col: 5, dir: 'desc' };
  main().querySelectorAll('table.jobs').forEach(applySort);
}

/** What an applicant tracking system would trip on in this CV. */
function atsHtml(list) {
  const problems = list.filter(x => x.level === 'problem');
  return `<details class="ats" ${problems.length ? 'open' : ''}><summary class="small"><b>Screening-software check:</b> ${list.length ? `${problems.length ? `<span style="color:var(--crit)">${problems.length} problem${problems.length === 1 ? '' : 's'}</span>` : 'reads cleanly'}${list.length - problems.length ? `, ${list.length - problems.length} tip${list.length - problems.length === 1 ? '' : 's'}` : ''}` : 'the software employers use to screen CVs reads it cleanly'}</summary>
    ${list.length ? `<ul class="flags">${list.map(x => `<li class="${x.level === 'problem' ? 'crit' : 'ats-tip'}">${esc(x.text)}</li>`).join('')}</ul>` : ''}
    ${(() => {
      // What was checked, ticked when nothing above is about it.
      const said = list.map(x => x.text.toLowerCase()).join(' ');
      const ok = ATS_CHECKS.filter(([, key]) => !said.includes(key));
      return ok.length ? `<p class="small muted" style="margin:8px 0 4px">${list.length ? 'Also checked, and fine:' : 'What was checked:'}</p><ul class="ats-ok small">${ok.map(([what]) => `<li>${esc(what)}</li>`).join('')}</ul>` : '';
    })()}</details>`;
}
/** What the screening-software check looks at, with a word its warning about it would contain. */
const ATS_CHECKS = [
  ['Your email and phone are in the body, not only in the page header or footer', 'header or footer'],
  ['No text hidden in text boxes', 'text boxes'],
  ['No newspaper-style columns', 'columns'],
  ['No tables that older systems jumble', 'table'],
  ['No pictures (photos, logos or icons)', 'picture'],
  ['An email address the system can find', 'no email'],
  ['Standard section names: Experience, Education, Skills', 'section names'],
  ['A usual length (no more than about three pages)', 'words'],
];

/** Pay across your tailored roles, as a range bar with the typical figure and your minimum. */
function payHtml(p) {
  if (!p || !p.tailored) return '';
  const k = v => `$${Math.round(v / 1000)}K`;
  if (!p.stated) return `<section class="card"><header><h2>Pay in the roles you tailored</h2></header><p class="muted">None of your ${p.tailored} tailored role${p.tailored === 1 ? '' : 's'} states a yearly salary yet.</p></section>`;
  const lo = Math.min(p.low, p.minimum ?? p.low), hi = Math.max(p.high, p.minimum ?? p.high);
  const at = v => hi > lo ? ((v - lo) / (hi - lo) * 100).toFixed(1) : 50;
  return `<section class="card"><header><h2>Pay in the roles you tailored</h2><span class="muted small">${p.stated} of ${p.tailored} state a yearly salary</span></header>
    <div class="kpis" style="margin:0 0 14px"><div class="kpi"><span class="kpi-l">Lowest</span><span class="kpi-v">${k(p.low)}</span></div>
      <div class="kpi"><span class="kpi-l">Typical (middle)</span><span class="kpi-v">${k(p.median)}</span></div>
      <div class="kpi"><span class="kpi-l">Highest</span><span class="kpi-v">${k(p.high)}</span></div>
      <div class="kpi"><span class="kpi-l">Your minimum</span><span class="kpi-v">${p.minimum ? k(p.minimum) : '–'}</span><span class="kpi-s">${p.minimum ? `${p.below_minimum} role${p.below_minimum === 1 ? '' : 's'} top out below it` : '<a href="#search/what">Set one</a>'}</span></div></div>
    <div class="payline"><span class="payband" style="left:${at(p.low)}%;right:${100 - at(p.high)}%"></span>
      <span class="paymark" style="left:${at(p.median)}%" title="Typical ${k(p.median)}"></span>
      ${p.minimum ? `<span class="paymark min" style="left:${at(p.minimum)}%" title="Your minimum ${k(p.minimum)}"></span>` : ''}</div>
    <div class="row small muted" style="justify-content:space-between;margin-top:4px"><span>${k(lo)}</span><span><i class="key"></i> typical${p.minimum ? ' <i class="key min"></i> your minimum' : ''}</span><span>${k(hi)}</span></div>
    <h3 class="sub" style="margin-top:14px">Best paid</h3>
    <table><thead><tr><th>Role</th><th class="num">Pay</th><th>Stage</th></tr></thead><tbody>${p.roles.map(x => `<tr><td><a href="#job/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <span class="muted small">${esc(x.company)}</span></td><td class="num" data-v="${x.high || 0}">${x.low === x.high ? k(x.high) : `${k(x.low)}–${k(x.high)}`}</td><td>${stagePill(x.status)}</td></tr>`).join('')}</tbody></table>
  </section>`;
}

// ---- Results ----
/** Where jobs come from: per source, the roles it listed in the last 90 days, how many only it
 *  found, and which other sources listed the same ones. */
function overlapCard(list) {
  const name = x => x.name || sourceName(x.source);
  const pc = (a, b) => b ? Math.round(a / b * 100) : 0;
  if (!list.length) return `<section class="card"><header><h2>Where jobs come from</h2></header><p class="muted">How much your job sources overlap shows here after your next search: Job Hunt now notes every source that lists each role.</p></section>`;
  const low = list.filter(x => x.roles >= 10).sort((a, b) => pc(a.only, a.roles) - pc(b.only, b.roles))[0];
  return `<section class="card"><header><h2>Where jobs come from</h2><span class="muted small">last 90 days</span></header>
    <p class="muted small">The same role on several sources counts once per source. <b>Only here</b> is what you'd miss without that source.${low && pc(low.only, low.roles) < 25 ? ` ${esc(name(low))} adds the least: ${100 - pc(low.only, low.roles)}% of its roles are on another source too.` : ''}</p>
    <table class="jobs"><thead><tr>${sortTh('Source', 'text')}${sortTh('Roles', 'num')}${sortTh('Only here', 'num')}<th>Also listed on</th></tr></thead><tbody>
    ${list.map(x => `<tr><td>${esc(name(x))}</td><td class="num" data-v="${x.roles}">${x.roles}</td>
      <td class="num" data-v="${pc(x.only, x.roles)}">${x.only} <span class="muted small">${pc(x.only, x.roles)}%</span></td>
      <td class="small">${x.also.length ? x.also.slice(0, 4).map(a => `${esc(name(a))} <span class="muted">${pc(a.roles, x.roles)}%</span>`).join(' · ') : '<span class="muted">nowhere else</span>'}</td></tr>`).join('')}
    </tbody></table></section>`;
}
/** The period Results covers: 7, 30 or 90 days, or 0 for everything. Remembered in this browser. */
let resultsDays = (() => { try { return Number(localStorage.getItem('jh.resultsDays') || 0); } catch (e) { return 0; } })();
/** Reply rate by source, best first, with how many applications each rests on; small ones hidden unless asked. */
function sourceRates(rows, all) {
  const rate = x => x.sent ? x.replied / x.sent : 0;
  const list = rows.filter(x => all || x.sent >= 5).sort((a, b) => rate(b) - rate(a));
  const hidden = rows.length - list.length;
  return `<section class="card"><header><h2>Reply rate by source</h2>
      ${rows.some(x => x.sent < 5) ? `<label class="check small"><input type="checkbox" data-act="smallSources" ${all ? 'checked' : ''}> Include sources with fewer than 5</label>` : ''}</header>
    ${list.length ? `<div class="bars">${list.map(x => `<div class="bar-row" data-tip="${esc(sourceName(x.name))}: ${x.replied} replies, ${x.interviews} interviews from ${x.sent} sent"><span>${esc(sourceName(x.name))}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(x.replied ? 2 : 0, rate(x) * 100)}%"></span></span><span class="v">${Math.round(rate(x) * 100)}% <span class="muted small">(n=${x.sent})</span></span></div>`).join('')}</div>`
      : '<p class="muted">No source has 5 applications yet.</p>'}
    ${hidden && !all ? `<p class="muted small">${hidden} source${hidden === 1 ? '' : 's'} with fewer than 5 applications hidden: one lucky reply would look like a trend.</p>` : ''}</section>`;
}
let smallSources = false;
async function showResults() {
  const [r, st] = await Promise.all([api(`/api/results${resultsDays ? `?days=${resultsDays}` : ''}`), settingsCache ? Promise.resolve(settingsCache) : api('/api/settings')]);
  const tracks = st.profile.tracks || [];
  const f = r.funnel;
  const rate = (a, b) => b ? `${Math.round(a / b * 100)}%` : '–';
  const steps = [['Postings found', f.found], ['Scored by Claude', f.scored], ['Tailored', f.tailored], ['Applications sent', f.sent], ['Replies', f.replied], ['Interviews', f.interviews], ['Offers', f.offers]];
  const max = Math.max(1, f.found);
  const table = (title, rows, what) => `<section class="card"><header><h2>${esc(title)}</h2></header>
    ${rows.length ? `<table><thead><tr><th>${esc(what)}</th><th class="num">Sent</th><th class="num">Replies</th><th class="num">Interviews</th><th class="num">Offers</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${esc(x.name)}</td><td class="num"><b>${x.sent}</b></td>
      <td class="num">${x.replied} <span class="muted small">${rate(x.replied, x.sent)}</span></td>
      <td class="num">${x.interviews} <span class="muted small">${rate(x.interviews, x.sent)}</span></td>
      <td class="num">${x.offers}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing sent yet.</p>'}</section>`;
  const days = r.per_day || [], maxDay = Math.max(1, ...days.map(d => d.sent)), sentDays = days.reduce((a, d) => a + d.sent, 0);
  const label = d => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const every = Math.ceil(days.length / 8);
  page(`${meHead('insights', 'Which CVs, sources and fit scores turn into replies and interviews. A reply is any answer from the company, a rejection included, but not an automatic “we received it”.')}
      <nav class="mode" aria-label="Period">${[[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'All']].map(([v, n]) => `<a href="#results" data-act="resultsDays" data-days="${v}" class="${resultsDays === v ? 'on' : ''}">${n}</a>`).join('')}</nav></div>
    ${Object.keys(r.outreach || {}).length ? `<section class="card"><header><h2>Your messages to people</h2></header>
      <p class="muted small">How often a note got a reply, by who it went to. A reply is one you marked with They replied, or an email back about that job.</p>
      <div class="facts">${[['recruiter', 'Recruiters'], ['manager', 'Hiring managers and team leads'], ['other', 'Others']].filter(([k]) => r.outreach[k]).map(([k, n]) => `<span><b>${n}:</b> ${r.outreach[k].replied} of ${r.outreach[k].sent} replied${r.outreach[k].sent >= 5 ? ` (${Math.round(100 * r.outreach[k].replied / r.outreach[k].sent)}%)` : ''}</span>`).join('')}</div>
      ${Object.values(r.outreach).reduce((n, x) => n + x.sent, 0) < 10 ? '<p class="muted small">Too few yet to say which works better for you.</p>' : ''}</section>` : ''}
    ${r.week_words?.length ? `<section class="card week-words"><header><h2>Your week</h2></header>${r.week_words.map(w => `<p>${esc(w)}</p>`).join('')}</section>` : ''}
    <section class="kpis">
      <div class="kpi"><span class="kpi-l">Applications sent</span><span class="kpi-v">${f.sent}</span><span class="kpi-s">of ${f.tailored} tailored</span></div>
      <div class="kpi"><span class="kpi-l">Reply rate</span><span class="kpi-v">${rate(f.replied, f.sent)}</span><span class="kpi-s">${f.replied} repl${f.replied === 1 ? 'y' : 'ies'}</span></div>
      <div class="kpi"><span class="kpi-l">Interview rate</span><span class="kpi-v">${rate(f.interviews, f.sent)}</span><span class="kpi-s">${f.interviews} interview${f.interviews === 1 ? '' : 's'}</span></div>
      <div class="kpi"><span class="kpi-l">Typical wait for a reply</span><span class="kpi-v">${r.days_to_reply == null ? '–' : `${r.days_to_reply} d`}</span><span class="kpi-s">${r.days_to_reply == null ? 'Not enough replies yet' : 'Half of replies came sooner'}</span></div>
    </section>
    <section class="card"><header><h2>Applications per day</h2><span class="muted small">${resultsDays ? `Last ${days.length} days` : 'Last 90 days'} · ${sentDays} sent · ${(sentDays / Math.max(1, days.length)).toFixed(1)} a day</span></header>
      ${sentDays ? `<div class="cols days">${days.map(d => `<div class="col" data-tip="${esc(label(d.day))}: ${d.sent} sent"><span class="c" style="height:${d.sent / maxDay * 100}%"></span></div>`).join('')}</div>
      <div class="col-labels days">${days.map((d, i) => `<span>${i % every === 0 ? esc(label(d.day)) : ''}</span>`).join('')}</div>` : '<p class="muted">No applications sent in this period.</p>'}</section>
    ${sourceRates(r.by_source || [], smallSources)}
    ${overlapCard(r.overlap || [])}
    <section class="card"><header><h2>From posting to offer</h2></header>
      <div class="bars">${steps.map(([n, v], i) => `<div class="bar-row"><span>${esc(n)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(v ? 1 : 0, v / max * 100)}%"></span></span><span class="v">${v}${i && steps[i - 1][1] ? ` <span class="muted small">${Math.round(v / steps[i - 1][1] * 100)}%</span>` : ''}</span></div>`).join('')}</div>
      <p class="muted small">Each percentage is of the step above it.</p></section>
    ${f.sent >= 5 ? `    <div class="grid-2">
      ${table('By CV', r.by_cv, 'CV')}
      ${table('By fit score', r.by_fit, 'Fit score')}
    </div>
    <div class="grid-2">
      ${table('By kind of role', r.by_title || [], 'Role (as your search titles)')}
      ${table('By pay', r.by_pay || [], 'Yearly pay stated')}
    </div>` : '<section class="card"><p class="muted">Breakdowns by CV, source, fit score and pay appear once you\'ve sent 5 applications.</p></section>'}
    ${(r.market_pay || []).length ? `<section class="card"><header><h2>What the roles you find pay</h2><span class="muted small">Every scored posting that states a yearly salary</span></header>
      <table><thead><tr><th>Role</th><th class="num">Postings</th><th class="num">Lowest</th><th class="num">Typical</th><th class="num">Highest</th></tr></thead><tbody>
      ${r.market_pay.map(m => `<tr><td>${esc(m.name)}</td><td class="num">${m.postings}</td><td class="num">${Math.round(m.low / 1000)}K</td><td class="num"><b>${Math.round(m.median / 1000)}K</b></td><td class="num">${Math.round(m.high / 1000)}K</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${(() => {
      const o = overview || {}, c = o.counts || {};
      if (!o.weeks) return '';
      const stages = ['queued', 'ready', 'approved', 'applied', 'interviewing', 'offer', 'rejected', 'no_response'];
      const maxStage = Math.max(1, ...stages.map(x => c[x] || 0));
      const maxWeek = Math.max(1, ...o.weeks.map(w => w.count));
      return `<div class="grid-2">        <section class="card">
          <header><h2>Applications by stage</h2><a class="btn ghost" href="#applications/applied">All applications</a></header>
          <div class="bars">${stages.map(s => `<div class="bar-row"><span>${esc(STAGES[s])}</span><span class="track"><span class="fill" style="display:block;width:${(c[s] || 0) / maxStage * 100}%"></span></span><span class="v">${c[s] || 0}</span></div>`).join('')}</div>
        </section>
        <section class="card">
          <header><h2>Applications sent per week</h2></header>
          ${o.weeks.every(w => !w.count) ? '<p class="muted">Your applications per week show here once you start applying.</p>' : `<div class="cols">${o.weeks.map((w, i) => `<div class="col" data-tip="Week of ${esc(fmtDate(w.week))}: ${w.count} sent">${i === o.weeks.length - 1 || w.count === maxWeek && w.count ? `<span class="cv">${w.count}</span>` : ''}<span class="c" style="height:${w.count / maxWeek * 100}%"></span></div>`).join('')}</div>
          <div class="col-labels">${o.weeks.map(w => `<span>${esc(fmtDate(w.week))}</span>`).join('')}</div>`}
        </section>
</div>`;
    })()}
    ${payHtml(r.pay)}
    <section class="card prep"><header><h2>What's working, and what to change</h2>
      ${r.thinking ? '<span class="muted small"><span class="spin" data-kind="insights"></span>Claude is looking…</span>' : `<button class="btn" data-act="insights">${r.insights ? 'Look again' : 'Ask Claude'}</button>`}</header>
      ${r.insights ? `<p class="muted small">From ${esc(fmtDate(r.insights.at))}. Job Hunt also does this once a month by itself.</p>${mdHtml(r.insights.text)}` : '<p class="muted">Claude reads your results and the applications behind them, and says what is working and what to change: titles, CVs, sources or your fit threshold.</p>'}
    </section>
    <section class="card row" style="justify-content:space-between"><span><b>Your career options</b><br><span class="muted small">${r.career ? `${(r.career.paths || []).length} directions with pay, pros and cons, and Claude's advice. Ask again now and then: it uses what's working above.` : 'Every direction your CVs support, with pay ranges, pros and cons, and Claude\'s advice.'}</span></span><a class="btn" href="#cvs/career">${svg('cvs')}Open Me</a></section>
    ${f.sent && f.sent < 20 ? '<p class="muted small">With only a few applications in a group, its rates can swing a lot. They settle as you send more.</p>' : ''}`);
}

async function showInbox() {
  const { emails } = await api('/api/emails');
  page(`${inboxHead('email', 'Job email Job Hunt has read. Replies are saved as Gmail drafts for you to check and send.',
      `<a class="btn ghost set-btn" href="#settings/inbox">${svg('settings')}Email settings</a>${overview?.setup?.google ? `<button class="btn primary" data-act="run" data-task="inbox">${svg('mail')}Check email now</button>` : '<a class="btn primary" href="#settings/connections">Connect Gmail</a>'}`)}
    <section class="card" style="padding:6px 10px">${emails.length ? `<table><thead><tr><th>Received</th><th>Type</th><th>Email</th><th>Application</th></tr></thead><tbody>
    ${emails.map(m => { const [name, cls] = CATEGORY[m.category] || [m.category, '']; return `<tr>
      <td class="small muted" style="white-space:nowrap">${esc(fmtWhen(m.received_at))}</td>
      <td><span class="pill ${cls}">${esc(name)}</span>${m.draft_id ? '<br><span class="small muted">Draft reply ready</span>' : ''}</td>
      <td><b>${esc(m.subject)}</b><br><span class="small muted">${esc(m.sender)}</span><p class="small" style="margin-top:4px">${esc(m.summary)}</p></td>
      <td class="small">${m.job_id ? `<a href="#job/${encodeURIComponent(m.job_id)}">${esc(m.company)} – ${esc(m.title)}</a>` : ''}</td></tr>`; }).join('')}
    </tbody></table>` : `<p class="empty">${overview?.setup?.google ? 'No job email yet.' : 'Connect Google and Job Hunt sorts your job email by itself. <a href="#settings/connections">Connect Google</a>'}</p>`}</section>`);
}

// ---- Add a job ----
function showAdd() {
  const noCv = overview && !overview.setup?.cvs;
  // Without Claude connected (or a CV to compare with) the posting is saved as it is.
  const canClaude = !!(overview?.setup?.claude && overview?.setup?.cvs);
  page(`<div class="head"><div class="grow"><div class="eyebrow"><a href="#applications">Jobs</a> / Add a job</div><h1>Add a job you found</h1><p class="muted">For roles on LinkedIn, company sites or from referrals. Paste the link to fill this in, then have it scored and tailored, or just save it to track.</p></div></div>
    ${noCv ? '<section class="card"><p>No CV yet, so a job you add here is saved without a score. Add your CV and Job Hunt can score it and tailor your CV for it.</p><div class="row"><a class="btn" href="#cvs">Add your CV</a></div></section>' : ''}
    <form class="card" data-form="add"><div class="form">
      <div class="field wide">Posting link<div class="row" style="flex-wrap:nowrap"><input type="url" name="url" placeholder="https://" style="flex:1"><button class="btn" type="button" data-act="fillFromLink">Fill in from link</button></div>
        <span class="hint">Reads the posting from its page (LinkedIn and most company job sites), without using Claude.</span></div>
      <label class="field">Company<input type="text" name="company" required></label>
      <label class="field">Job title<input type="text" name="title" required></label>
      <label class="field">Location<input type="text" name="location"></label>
      <label class="field wide">Full job description<textarea name="description" style="min-height:300px" placeholder="Needed to score and tailor; optional if you only save it."></textarea></label>
      <div class="field wide">What to do with it
        <label class="check"><input type="radio" name="claude" value="1" ${canClaude ? 'checked' : 'disabled'}> <span>Score it and tailor my CV and a cover letter<br><span class="muted small">${canClaude ? 'Uses Claude: two or three requests.' : 'Needs Claude connected and your CV added.'}</span></span></label>
        <label class="check"><input type="radio" name="claude" value="0" ${canClaude ? '' : 'checked'}> <span>Just save it, without Claude<br><span class="muted small">Saved in All jobs. Use Tailor anyway on it whenever you like.</span></span></label>
      </div>
    </div><div class="row"><button class="btn primary" type="submit">Add the job</button></div></form>
    <p class="muted small desktop-only">Used the <a href="#search/setup">Send to Job Hunt</a> button? Press Ctrl+V on this page to add that posting.</p>`);
}

// A posting from the Send to Job Hunt button, pasted on the Add a job page.
document.addEventListener('paste', async e => {
  if (location.hash !== '#add') return;
  const text = e.clipboardData?.getData('text') || '';
  if (!text.startsWith('JOBHUNT-CLIP:')) return;
  e.preventDefault();
  try {
    await api('/api/clip', { method: 'POST', raw: text });
    toast('Adding it now. Once it\'s scored it\'s in your Queue to pick; you get a notification.');
    location.hash = '#overview';
  } catch (err) { toast(err.message, true); }
});

/** This device's time zone, like "Europe/London". */
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
/** A time-zone dropdown (every zone the browser knows), or a text box where it knows none. */
function tzSelect(name, value) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch {}
  if (!zones.length) return `<input type="text" name="${name}" value="${esc(value)}" placeholder="Like Europe/London">`;
  if (value && !zones.includes(value)) zones = [value, ...zones];
  return `<select name="${name}">${zones.map(z => `<option value="${esc(z)}" ${z === value ? 'selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('')}</select>`;
}
/** The likely country from a time zone, for the first run ("" when it isn't one Job Hunt knows). */
const tzCountry = (tz, countries) => (countries || []).find(c => c.tz.includes(tz))?.code || '';
/** Places you pick, as chips: your country's popular cities one click away, and a box for any other place.
 *  A hidden textarea (`name`) keeps the list, one per line, so forms read it as before. */
function placePicker(name, values, country) {
  const c = (settingsCache?.countries || []).find(x => x.code === country);
  const picked = values || [];
  const has = x => picked.some(p => p.toLowerCase() === x.toLowerCase());
  const more = (c?.cities || []).filter(x => !has(x));
  return `<div class="places" data-places="${name}" data-country="${esc(country)}">
    <textarea name="${name}" hidden>${esc(lines(picked))}</textarea>
    <div class="chips">${picked.map(x => `<button type="button" class="chip on" data-act="placeDrop" data-place="${esc(x)}" title="Remove">${esc(x)} ${svg('close')}</button>`).join('') || '<span class="muted small">None yet: anywhere in the country.</span>'}</div>
    <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input type="text" class="place-input" list="cities-${name}" placeholder="Type a city or area" style="flex:1"><datalist id="cities-${name}">${(c?.cities || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist><button type="button" class="btn sm" data-act="placeAdd">Add</button></div>
    ${more.length ? `<div class="small muted" style="margin-top:8px">Popular in ${esc(c.name)}:</div><div class="chips">${more.map(x => `<button type="button" class="chip" data-act="placePick" data-place="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>` : ''}
  </div>`;
}
/** Change a place picker's list, draw it again, and let its form know (so it saves). */
function placesSet(box, list, country) {
  const name = box.dataset.places;
  box.outerHTML = placePicker(name, list, country || box.dataset.country);
  const ta = document.querySelector(`[data-places="${name}"] textarea`);
  ta?.dispatchEvent(new Event('input', { bubbles: true }));
  return ta;
}
const placesOf = box => fromLines(box.querySelector('textarea').value);

/** A country dropdown from the core's list. */
const countrySelect = (name, value, countries) => `<select name="${name}">${(countries || []).map(c => `<option value="${c.code}" ${c.code === value ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;

/** An hour of the day as a dropdown: "9 AM", "5 PM" (24 is midnight, the end of the day). */
function hourSelect(name, value, from = 0, to = 23) {
  const label = h => h === 0 || h === 24 ? 'Midnight' : h === 12 ? 'Noon' : `${h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return `<select name="${name}">${hours.map(h => `<option value="${h}" ${Number(value) === h ? 'selected' : ''}>${label(h)}</option>`).join('')}</select>`;
}
