// Job Hunt screens, continued. The Pipeline: every job, its tables and the tracker.
'use strict';

// ---- Applications ----
/** The list of every job, and its narrower views: each a set of stages. */
/** The Pipeline's one row of tabs: where a job stands. Each is the stages it covers. */
const APP_TABS = [['all', 'All jobs'], ['new', 'New'], ['tailored', 'Tailored'], ['approved', 'Approved'], ['applied', 'Applied'], ['interviewing', 'Interviews'], ['closed', 'Closed'], ['saved', 'Saved'], ['skipped', 'Set aside'], ['dismissed', 'Not interested']];
const APP_TAB_STAGES = { new: ['queued'], tailored: ['ready'], approved: ['approved'], applied: ['applied'], interviewing: ['interviewing', 'offer'], closed: ['rejected', 'no_response'], saved: ['saved'], skipped: ['skipped'], dismissed: ['dismissed'] };
/** Tabs shown even when empty, and the ones that say how many (a count of what was set aside would only be noise). */
const APP_ALWAYS = ['all', 'new', 'applied'];
const APP_COUNTED = ['new', 'tailored', 'approved', 'applied', 'interviewing', 'closed', 'saved'];
async function showPipeline(view) {
  if (view === 'files') return showDocuments();
  if (!APP_TABS.some(([id]) => id === view)) {
    // Opened from the menu: every job. (What to do next is the Queue's.)
    view = 'all';
  }
  // Every job in one table (applications, new postings, skipped ones): click a column's heading to
  // sort by it. Postings outside your locations aren't shown.
  const [{ jobs: everything }, { rows }] = await Promise.all([api('/api/jobs'), api('/api/tracker')]);
  // All jobs leaves out what you said no to (its own tab has those) and postings outside your locations.
  const inTab = j => view === 'all' ? j.status !== 'dismissed' : (APP_TAB_STAGES[view] || []).includes(j.status);
  const jobs = everything.filter(j => !outsideYours(j) && inTab(j));
  const tracked = Object.fromEntries(rows.map(r => [r.id, r]));
  const WHO = { you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' };
  // A skipped role whose forecast clears your fit score is worth a second look: tailored, it could make it.
  const bar = (settingsCache || await api('/api/settings').catch(() => null))?.profile?.score_threshold ?? 101;
  const worth = j => canReach(j) != null && canReach(j) >= bar ? `<span class="pill good" title="Its fit is below your minimum (${bar}), but tailored it could reach about ${canReach(j)}">Worth a look tailored</span> ` : '';
  const next = j => {
    const r = tracked[j.id];
    if (r) return `<span class="who ${esc(r.who)}">${WHO[r.who] || ''}</span> <span class="small">${nextText(r)}</span>`;
    if (j.status === 'queued') return '<span class="small">Pick it to tailor</span>';
    if (j.status === 'skipped') return `<span class="small muted" title="${esc(j.reasoning || '')}">${worth(j)}${esc((j.reasoning || '').slice(0, 60))}${(j.reasoning || '').length > 60 ? '…' : ''}</span>`;
    return '';
  };
  const nextKey = j => ({ you: 0, them: 1, later: 2, done: 3 }[tracked[j.id]?.who] ?? (j.status === 'queued' ? 0.5 : 4));
  // Until you sort it yourself: what needs you first.
  if (!sortState['t-all']) sortState['t-all'] = { col: 5, dir: 'asc' };
  const opt = (v, n) => `<option value="${esc(v)}">${esc(n)}</option>`;
  const sources = [...new Set(jobs.map(j => j.source))].sort((a, b) => sourceName(a).localeCompare(sourceName(b)));
  const stagesHere = Object.keys(STAGES).filter(k => jobs.some(j => j.status === k));
  const empKinds = ['Full-time', 'Contract', 'Temporary', 'Part-time', 'Internship', 'Co-op', 'Freelance', 'Not stated'].filter(k => jobs.some(j => empKind(j) === k));
  page(`${jobsHead(view, `<a class="btn ghost" href="/api/export.csv" download="Job Hunt applications.csv" title="Company, title, stage, fit, salary, dates, links and notes, for Excel or Google Sheets">${svg('download')}Spreadsheet</a>`)}
    ${foldFilters(`<div class="all-filters" id="allFilters">
      <input type="search" data-allf="q" placeholder="Company, role or place" aria-label="Find in the list">
      <label class="small">Stage <select data-allf="stage">${opt('', 'Any')}${opt('you', 'Your move')}${opt('them', 'Waiting on them')}${stagesHere.map(k => opt(k, STAGES[k])).join('')}</select></label>
      <label class="small">Fit <select data-allf="fit">${opt('0', 'Any')}${opt('60', '60 or more')}${opt('70', '70 or more')}${opt('80', '80 or more')}</select></label>
      ${sources.length > 1 ? `<label class="small">Source <select data-allf="source">${opt('', 'Any')}${sources.map(x => opt(x, sourceName(x))).join('')}</select></label>` : ''}
      <label class="small">Found <select data-allf="age">${opt('', 'Any time')}${opt('7', 'Last 7 days')}${opt('30', 'Last 30 days')}</select></label>
      ${empKinds.length > 1 ? `<label class="small">Type <select data-allf="emp">${opt('', 'Any')}${empKinds.map(k => opt(k, k)).join('')}</select></label>` : ''}
      <label class="check small"><input type="checkbox" data-allf="pay"> Shows pay</label>
      <label class="small">Sort by <select data-allf="sort">${opt('5', 'What needs you first')}${opt('4', 'Best fit')}${opt('7', 'Newest')}${opt('3', 'Highest pay')}${opt('0', 'Company')}</select></label>
      <span class="muted small" id="allCount">${jobs.length} job${jobs.length === 1 ? '' : 's'}</span>
    </div>`)}
    <section class="card" style="padding:6px 10px"><table class="jobs" id="t-all"><thead><tr>${sortTh('Company')}${sortTh('Role')}${sortTh('Location')}${sortTh('Salary', 'num')}${sortTh('Fit', 'num')}${sortTh('Stage', 'rank')}${sortTh('Next step', 'num')}${sortTh('Age', 'date')}${sortTh('Type')}</tr></thead><tbody>
      ${jobs.map(j => `<tr class="click" data-expand="${esc(j.id)}" data-who="${esc(tracked[j.id]?.who || '')}" data-status="${esc(j.status)}" data-source="${esc(j.source)}"
        data-fit="${j.score_after ?? j.score ?? 0}" data-emp="${esc(empKind(j))}" data-pay="${salaryValue(j.salary) > 0 ? 1 : 0}" data-found="${+new Date(j.found_at || 0) || 0}" data-text="${esc(`${j.company} ${j.title} ${j.location || ''}`.toLowerCase())}">
        <td class="co" data-v="${esc(j.company.toLowerCase())}">${coCell(j)}</td>
        <td class="role" data-v="${esc(j.title.toLowerCase())}"><b>${esc(j.title)}</b> ${closedTag(j)}${deadlineTag(j)}${coLocLine(j)}<span class="phone-only"><br>${stagePill(j.status)}</span></td>
        <td class="loc small" data-v="${esc((j.location || '').toLowerCase())}">${locCell(j)}</td>
        <td class="small salary" data-v="${salaryValue(j.salary)}">${salaryCell(j)}</td>
        <td class="fit" data-v="${j.score_after ?? j.score ?? -1}"><span class="jfit${j.score != null && j.score_after != null && j.score_after !== j.score ? ' has-after' : canReach(j) ? ' has-fore' : ''}">${scoreBadge(j.score)}${reachTag(j)}${fitNote(j)}</span></td>
        <td class="stage" data-v="${stageOrder(j.status)}">${stagePill(j.status)}</td>
        <td class="next" data-v="${nextKey(j)}">${rowActions(j) ? `<div class="row-act" title="${esc(next(j).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}">${rowActions(j)}</div>` : next(j)}</td>
        <td class="small muted nowrap" data-v="${esc(ageValue(j))}" title="Found on ${esc(sourceName(j.source))}">${ageTag(j)}</td>
        <td class="small emp" data-v="${esc(j.employment || '~')}">${empCell(j)}</td></tr>`).join('')}
    </tbody></table>${jobs.length ? '' : `<p class="empty">${{ applied: 'Nothing applied to yet. Jobs show here once you apply (or Job Hunt sees the confirmation email).', tailored: 'No tailored applications waiting to be approved.', approved: 'Nothing approved and waiting to be sent.', new: 'No new postings to pick from.', dismissed: 'Nothing you said no to.' }[view] || 'No jobs yet. Search for jobs from the Queue.'}</p>`}</section>`);
  restoreAllFilters();
  main().querySelectorAll('table.jobs').forEach(applySort);
  // j / k on a job page walk through the list as it was shown here.
  jobOrder = [...main().querySelectorAll('[data-expand]')].map(el => el.dataset.expand);
}

/** All jobs' filters: hide rows that don't match, sort by the choice, remember both in this browser. */
function applyAllFilters(save = true) {
  const box = $('#allFilters'), table = $('#t-all');
  if (!box || !table) return;
  const v = {};
  box.querySelectorAll('[data-allf]').forEach(el => { v[el.dataset.allf] = el.type === 'checkbox' ? el.checked : el.value; });
  if (save) try { localStorage.setItem('jh.allFilters', JSON.stringify(v)); } catch (e) {}
  const words = (v.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const since = v.age ? Date.now() - Number(v.age) * 86400000 : 0;
  let shown = 0;
  table.querySelectorAll('tr.xrow').forEach(r => r.remove());
  for (const r of table.tBodies[0].rows) {
    const d = r.dataset;
    const ok = words.every(w => d.text.includes(w))
      && (!v.stage || (v.stage === 'you' || v.stage === 'them' ? d.who === v.stage : d.status === v.stage))
      && Number(d.fit) >= Number(v.fit || 0) && (!v.source || d.source === v.source)
      && (!since || Number(d.found) >= since) && (!v.pay || d.pay === '1') && (!v.emp || d.emp === v.emp);
    r.hidden = !ok; r.classList.remove('open');
    if (ok) shown++;
  }
  $('#allCount').textContent = `${shown < table.tBodies[0].rows.length ? `${shown} of ` : ''}${table.tBodies[0].rows.length} jobs`;
  const col = Number(v.sort || 5);
  if (!sortState['t-all'] || sortState['t-all'].col !== col || save) {
    sortState['t-all'] = { col, dir: [0, 5].includes(col) ? 'asc' : 'desc' };
    applySort(table);
  }
}
function restoreAllFilters() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('jh.allFilters') || '{}') || {}; } catch (e) {}
  document.querySelectorAll('#allFilters [data-allf]').forEach(el => { if (el.dataset.allf in saved) el.type === 'checkbox' ? el.checked = !!saved[el.dataset.allf] : el.value = saved[el.dataset.allf]; });
  applyAllFilters(false);
}
document.addEventListener('input', e => { if (e.target.matches?.('[data-allf]')) applyAllFilters(); });
document.addEventListener('change', e => { if (e.target.matches?.('select[data-allf], input[type=checkbox][data-allf]')) applyAllFilters(); });

/** How each source is called on screen. */
const SOURCE = { adzuna: 'Adzuna', jsearch: 'Google for Jobs', jooble: 'Jooble', indeed: 'Indeed', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', smartrecruiters: 'SmartRecruiters', workable: 'Workable', bamboohr: 'BambooHR', linkedin: 'LinkedIn', bayt: 'Bayt', naukrigulf: 'Naukrigulf', gulftalent: 'GulfTalent', eluta: 'Eluta', workopolis: 'Workopolis', glassdoor: 'Glassdoor', jobbank: 'Job Bank', freehire: 'FreeHire', ziprecruiter: 'ZipRecruiter', manual: 'Added by you', clip: 'Sent from your browser', alert: 'Job-alert email', email: 'Job-alert email' };
const sourceName = s => SOURCE[s] || (s ? s[0].toUpperCase() + s.slice(1) : '');
/** Stages a posting can be picked from, whatever its score or location ("Tailor anyway"). */
const CAN_CHOOSE = ['skipped', 'dismissed', 'saved'];
/** The next step for a job, right on its row. */
function rowActions(j) {
  const id = esc(j.id);
  if (j.status === 'ready') return `<button class="btn primary sm" data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">Approve</button><button class="btn ghost sm" data-act="stage" data-status="dismissed" data-job="${id}" data-from="ready" title="Not interested">${svg('close')}</button>`;
  if (j.status === 'approved') return `<a class="btn primary sm" href="#apply/${encodeURIComponent(j.id)}">Apply</a>`;
  if (j.status === 'queued') return `<button class="btn sm" data-act="tailorPicked" data-job="${id}">Tailor</button>`;
  if (['skipped', 'dismissed'].includes(j.status)) return `<button class="btn ghost sm" data-act="tailorAnyway" data-job="${id}">Tailor anyway</button>`;
  return '';
}

/** The posting's stated pay, or a dash. Extras some boards add ("• Offers Equity") go in the tooltip. */
/** Full-time, contract (and for how long), part-time…, as the posting says; "—" when it doesn't. */
const empCell = j => j.employment ? `<span class="emp-${esc(empKind(j).toLowerCase().replace(/[^a-z]/g, ''))}">${esc(j.employment)}</span>` : '<span class="muted">—</span>';
/** The kind alone, for the Type filter: "Contract · 12 months" is a Contract. */
const empKind = j => !j.employment ? 'Not stated' : j.employment.startsWith('Full-time or') ? 'Part-time' : j.employment.split(' · ')[0];
/** You've sent this company a CV before (for another role): a tag, with which ones. */
const appliedBeforeTag = j => (j.applied_before || []).length ? ` <span class="pill info" title="${esc(`You applied to ${j.company} before: ${j.applied_before.map(x => `${x.title} (${STAGES[x.status] || x.status}${x.applied_at ? `, ${fmtDate(x.applied_at)}` : ''})`).join('; ')}`)}">Applied here before</span>` : '';
/** Your history with the company: where you applied before, and your own notes. */
function historyHtml(j, history, notes, mode) {
  if (!(history || []).length && !notes) return '';
  return `<section class="card company-history"><header><h2>Your history with ${esc(j.company)}</h2></header>
    ${(history || []).length ? `<ul class="small">${history.map(x => `<li><a href="#job/${encodeURIComponent(x.id)}">${esc(x.title)}</a> · ${esc(STAGES[x.status] || x.status)}${x.applied_at ? ` · applied ${esc(fmtDate(x.applied_at))}` : ''}</li>`).join('')}</ul>
      <p class="muted small">${mode === 'same' ? `This role gets the same CV you sent them.` : mode === 'usual' ? 'Tailored as usual (Search → What to search → Tailoring).' : `${esc(j.company)} keeps the CVs you sent on file, so this one stays close to the last: the same headline, at most 4 paragraphs changed.`}</p>` : ''}
    <label class="field small">Your notes on ${esc(j.company)}<textarea id="companyNotes" placeholder="e.g. The recruiter said to wait six months before applying again." style="min-height:60px">${esc(notes || '')}</textarea></label>
    <div class="row"><button class="btn sm" data-act="saveCompanyNotes" data-company="${esc(j.company)}">Save notes</button></div></section>`;
}
/** This CV beside the one you last sent the company: what differs, and a way back to that one. */
function sentCompareHtml(j, c) {
  if (!c || !j.cv_path) return '';
  const n = (c.changes || []).length;
  return `<section class="card sent-compare"><header><h2>Beside the CV you sent ${esc(j.company)} before</h2>${n ? '<button class="btn sm" data-act="reuseCv">Use the CV you sent before</button>' : ''}</header>
    <p class="small">${n ? `<b>${n} paragraph${n === 1 ? '' : 's'}</b> differ from the CV you sent for <a href="#job/${encodeURIComponent(c.job.id)}">${esc(c.job.title)}</a>${c.job.applied_at ? ` (${esc(fmtDate(c.job.applied_at))})` : ''}. They keep both on file; small, keyword-level differences are normal, a different headline or story is what stands out.` : `The same as the CV you sent for <a href="#job/${encodeURIComponent(c.job.id)}">${esc(c.job.title)}</a>.`}</p>
    ${n ? `<details ${n <= 4 ? 'open' : ''}><summary class="small muted">What differs</summary>${c.changes.map(x => `<div class="rev-para">${wordDiff(x.before, x.after)}</div>`).join('')}</details>` : ''}</section>`;
}
/** Two versions of a paragraph, word by word: removed words struck through, added ones highlighted. */
function wordDiff(before, after) {
  const a = String(before || '').split(/(\s+)/).filter(Boolean), b = String(after || '').split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 250000) return `<del>${esc(before)}</del> <ins>${esc(after)}</ins>`;
  const n = a.length, m = b.length, l = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) l[i][j] = a[i] === b[j] ? l[i + 1][j + 1] + 1 : Math.max(l[i + 1][j], l[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out += esc(a[i]); i++; j++; }
    else if (i < n && (j === m || l[i + 1][j] >= l[i][j + 1])) { out += /^\s+$/.test(a[i]) ? '' : `<del>${esc(a[i])}</del>`; i++; }
    else { out += /^\s+$/.test(b[j]) ? esc(b[j]) : `<ins>${esc(b[j])}</ins>`; j++; }
  }
  return out.replace(/<\/ins>(\s*)<ins>/g, '$1').replace(/<\/del><del>/g, ' ');
}
/** The last change you asked for (or made) to the tailored CV or letter, highlighted word by word. */
function revisionHtml(r) {
  if (!r || !(r.changes || []).length) return '';
  const what = r.what === 'letter' ? 'cover letter' : 'CV';
  return `<section class="card revision"><header><h2>What changed just now</h2><button class="btn sm" data-act="revisionSeen">Done</button></header>
    <p class="muted small">In your ${what}${r.note && r.note !== 'your edit' ? `, for “${esc(r.note)}”` : r.note === 'your edit' ? ', by you' : ''} · ${esc(ago(r.at))}. <del>Struck through</del> is gone, <ins>highlighted</ins> is new; the paragraphs are marked in the preview too.</p>
    ${r.changes.map(c => `<div class="rev-para">${!c.before ? '<span class="pill good">New paragraph</span> ' : !c.after ? '<span class="pill crit">Removed</span> ' : ''}${wordDiff(c.before, c.after)}</div>`).join('')}</section>`;
}
/** Mark the changed paragraphs in the preview, once it's drawn. */
function markRevision(r) {
  if (!r) return;
  const norm = t => String(t || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const after = new Set((r.changes || []).map(c => norm(c.after)).filter(Boolean));
  const box = document.getElementById(r.what === 'letter' ? 'pv-letter' : 'pv-cv');
  if (!box || !after.size) return;
  box.querySelectorAll('p, li, div').forEach(el => { if (!el.children.length || el.tagName !== 'DIV') { if (after.has(norm(el.textContent))) { el.classList.add('just-changed'); el.title = 'Changed just now'; } } });
}
const salaryCell = j => {
  if (!j.salary) return '<span class="muted">—</span>';
  const [pay, ...rest] = String(j.salary).split(/\s+[•·|]\s+/);
  return `<span title="${esc(j.salary)}">${esc(pay)}</span>${rest.length ? `<br><span class="muted">${esc(rest.join(' · '))}</span>` : ''}`;
};

/** The top of a salary as a yearly number, for sorting: "$110,000–$135,000" → 135000, "CA$95K–120K" → 120000, "$45–$55/hour" → 114400. */
function salaryValue(s) {
  if (!s) return -1;
  const t = String(s).split(/\s+[•·|]\s+/)[0];
  const nums = [...t.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*([kK])?/g)].map(m => Number(m[1]) * (m[2] ? 1000 : 1));
  if (!nums.length) return -1;
  let top = Math.max(...nums);
  if (/hour|\/hr/i.test(t)) top *= 2080;
  return Math.round(top);
}
const stageOrder = s => ['ready', 'approved', 'queued', 'applied', 'interviewing', 'offer', 'rejected', 'no_response', 'saved', 'skipped', 'dismissed'].indexOf(s);

// ---- sortable tables ----
const sortState = {};
/** A header cell that sorts its column: "date" and "num" sort largest first on the first click; "text" and "rank" (stage order) smallest first. */
const sortTh = (label, type = 'text') => `<th class="sortable" data-type="${type}" title="Sort by ${esc(label.toLowerCase())}">${esc(label)}<span class="arrow"></span></th>`;

function applySort(table) {
  const st = sortState[table.id];
  if (!st) return;
  const th = table.tHead.rows[0].cells[st.col];
  if (!th) return;
  // Close any open postings first; their detail rows would end up out of place.
  table.querySelectorAll('tr.xrow').forEach(r => r.remove());
  table.querySelectorAll('tr.open').forEach(r => r.classList.remove('open'));
  const body = table.tBodies[0];
  const num = ['num', 'rank'].includes(th.dataset.type);
  const val = r => { const v = r.cells[st.col]?.dataset.v ?? r.cells[st.col]?.textContent ?? ''; return num ? Number(v) : v; };
  const rows = [...body.rows].sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return st.dir === 'asc' ? c : -c; });
  rows.forEach(r => body.appendChild(r));
  [...table.tHead.rows[0].cells].forEach((c, i) => { c.classList.toggle('sorted', i === st.col); const a = c.querySelector('.arrow'); if (a) a.textContent = i === st.col ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''; });
}

document.addEventListener('click', e => {
  const th = e.target.closest('th.sortable');
  if (!th) return;
  const table = th.closest('table');
  const col = th.cellIndex, prev = sortState[table.id];
  const first = ['text', 'rank'].includes(th.dataset.type) ? 'asc' : 'desc';
  sortState[table.id] = { col, dir: prev && prev.col === col ? (prev.dir === 'asc' ? 'desc' : 'asc') : first };
  try { localStorage.setItem('sort', JSON.stringify(sortState)); } catch (err) {}
  applySort(table);
});
try { Object.assign(sortState, JSON.parse(localStorage.getItem('sort') || '{}')); } catch (err) {}

// ---- Tracker ----
/** The steps an application has reached, as dots on a line, with dates on hover. */
function stepsHtml(r) {
  const at = r.steps.map(x => x.at);
  const lastDone = at.reduce((m, a, i) => a ? i : m, -1);
  return `<ol class="tsteps">${r.steps.map((x, i) => `<li class="${x.at ? 'done' : i < lastDone ? 'skip' : ''}${x.bad ? ' bad' : ''}" title="${esc(x.step)}${x.at ? `: ${esc(fmtDate(x.at))}` : ''}"><i></i><span>${esc(x.step)}</span></li>`).join('')}</ol>`;
}
function nextText(r) {
  return r.next_interview ? `Interview ${esc(fmtWhen(r.next_interview))}` : esc(r.next);
}
function trackRow(r) {
  const id = esc(r.id);
  const act = r.follow_up_due ? `<button class="btn sm" data-act="followUp" data-job="${id}">Write follow-up</button>` : rowActions(r);
  return `<div class="trow">
    <span class="co">${coCell(r)}</span>
    <a class="grow tmain" href="#job/${encodeURIComponent(r.id)}"><span class="qt">${esc(r.title)}</span> ${closedTag(r)}${deadlineTag(r)}${coLocLine(r)}</a>
    <span class="loc small">${locCell(r)}</span>
    ${stepsHtml(r)}
    <div class="tnext"><span class="who ${esc(r.who)}">${{ you: 'Your move', them: 'Waiting on them', later: 'Saved', done: 'Done' }[r.who] || ''}</span>
      <span class="small">${nextText(r)}</span>
      <span class="muted small">${r.last_step ? `${esc(r.last_step)} ${r.days_since === 0 ? 'today' : `${r.days_since} day${r.days_since === 1 ? '' : 's'} ago`}` : ''}</span></div>
    <span class="row todo-act">${act}</span></div>`;
}
