// Job Hunt screens, continued. The steps of the hunt and their rows, search progress, a posting opened in place, and tailored files.
'use strict';

// ---- Inbox ----
// ---- What to do next ----
/** One list of what's waiting on you, most urgent first, with the action right on each row. */
/** "Why it fits" for a role to pick: Claude's reasons, folded to two lines, and its red flags. */
const whyFits = j => {
  const flags = j.red_flags || [];
  if (!j.reasoning && !flags.length) return '<span class="muted">–</span>';
  return `<details class="why-fits"><summary><span class="why-text">${esc(j.reasoning || '')}</span>${flags.length ? `<span class="bad-text">${flags.length} red flag${flags.length === 1 ? '' : 's'}</span>` : ''}</summary>
    ${flags.length ? `<ul class="flags">${flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</details>`;
};
/** The posting's hard requirements the CV doesn't show (red flags Claude marks "Must have:"): a stretch to apply for. */
const mustHaves = j => (j.red_flags || []).filter(f => /^must have:/i.test(f)).map(f => f.replace(/^must have:\s*/i, ''));
/** How the role reads against the career path you chose (Me, Career): on it, or leading away from it. */
// Only a warning, and only for a role that would set your career back badly. (Nothing is said for
// the rest: every role is shown, and a role that suits a path isn't marked.)
const pathTag = j => !j.career || j.career.toward ? '' : ` <span class="pill crit" title="${esc(j.career.why || 'Taking this could set your career back')}">Could set you back</span>`;
const stretchTag = j => { const m = mustHaves(j); return m.length ? ` <span class="pill warn" title="Required, and not on your CV: ${esc(m.join('; '))}">Stretch</span>` : ''; };
/** The one tag a row in a list shows, the most important first: closed, closing soon, a stretch,
 *  someone you know there. The rest are on the job itself. */
function oneTag(j) {
  const closed = closedTag(j); if (closed) return ` ${closed}`;
  const low = belowMinTag(j); if (low) return low;
  const dl = deadlineTag(j); if (dl && /crit|bad|warn/.test(dl)) return ` ${dl}`;
  if (j.career && !j.career.toward) return pathTag(j);
  const st = stretchTag(j); if (st) return st;
  if (j.career) return pathTag(j);
  if (j.recruiter) return ` <span class="pill good" title="You know ${esc(j.recruiter)}, a recruiter there">Recruiter: ${esc(firstName(j.recruiter))}</span>`;
  if (j.know?.length) return ` <span class="pill good" title="Connected on LinkedIn: ${esc(j.know.join(', '))}">You know ${esc(j.know.length === 1 ? firstName(j.know[0]) : `${j.know.length} people`)}</span>`;
  return dl ? ` ${dl}` : '';
}
/** You closed the Apply window without the site's confirmation being recognised: did it go through? */
window.askApplied = async j => {
  if (await ask(`Did your application to ${j.title} at ${j.company} go through?`, 'Yes, mark it applied')) {
    try { await api(`/api/jobs/${encodeURIComponent(j.id)}/submitted`, { method: 'POST' }); toast('Marked as applied. Job Hunt reminds you to follow up if there\'s no reply.'); await refreshOverview(); route(); }
    catch (e) { toast(e.message, true); }
  }
};
/** After Approve: open the job's form in your own browser (your sign-ins and saved passwords work
 *  there), where the Job Hunt extension fills it in; false when that can't be done here (the phone,
 *  no link), and the Apply page takes over. */
/** Applying to several in your browser, one after another: the list ({id, name}), where we are, and how many went. */
let applyRun = null;
/** The bar that carries a run: which application is open, and what to do when it's sent. */
function runBar() {
  let bar = $('#applyRun');
  if (!applyRun) { bar?.remove(); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'applyRun'; bar.className = 'apply-run'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
  const cur = applyRun.list[applyRun.at];
  bar.innerHTML = `<span class="grow"><b>Applying in your browser · ${applyRun.at + 1} of ${applyRun.list.length}</b><span class="muted small">${esc(cur.name)}. On the form, click the Job Hunt extension, then Fill this form.</span></span>
    <button class="btn primary sm" data-act="runApplied">I submitted it: next</button><button class="btn sm" data-act="runSkip">Skip</button><button class="btn ghost sm" data-act="runAgain" title="Open this one's form again">Open again</button><button class="btn ghost sm" data-act="runStop">Stop</button>`;
}
/** Open the run's current application in your browser, or finish. */
async function runOpen() {
  if (!applyRun) return;
  if (applyRun.at >= applyRun.list.length) {
    const n = applyRun.done;
    applyRun = null; runBar();
    return toast(n ? `Done: ${n} marked as applied. Job Hunt reminds you to follow up if there's no reply.` : 'Done. None were marked as applied.');
  }
  runBar();
  const cur = applyRun.list[applyRun.at];
  try {
    const r = await api(`/api/jobs/${encodeURIComponent(cur.id)}/fill-browser`, { method: 'POST' });
    await api('/api/open-url', { method: 'POST', body: { url: r.url } });
  } catch (e) { toast(`${cur.name}: ${e.message} Skip it, or press Open again.`, true); }
}
async function applyNow(id) {
  if (!overview?.can_fill) return false;
  try {
    const r = await api(`/api/jobs/${encodeURIComponent(id)}/fill-browser`, { method: 'POST' });
    await api('/api/open-url', { method: 'POST', body: { url: r.url } });
    toast('Approved. It\'s opening in your browser: on the form, click the Job Hunt extension and press Fill this form.');
    return true;
  } catch (e) { return false; }
}
/** A salary below your minimum (Search → What to search), as a tag. */
const minSalary = () => overview?.min_salary ?? settingsCache?.profile?.min_salary ?? null;
const money = n => '$' + Math.round(n).toLocaleString();
/** The top of a role's pay, against your minimum: a range that reaches it is fine, and a starting
 *  point alone ("From $90,000", "$90,000+") isn't the most it pays. */
const openEnded = s => /\b(from|starting|starts? at|minimum|at least|and up|or more)\b|\d\s*[kK]?\s*\+/i.test(s) && (String(s).match(/\d[\d,]*(?:\.\d+)?\s*[kK]?/g) || []).length < 2;
const belowMin = j => { const m = minSalary(); if (!m || !j.salary || openEnded(j.salary)) return null; const top = salaryValue(j.salary); return top > 1000 && top < m ? top : null; };
const belowMinTag = j => belowMin(j) ? ` <span class="pill crit" title="Pays up to ${money(belowMin(j))}, below your minimum of ${money(minSalary())}">Below your minimum</span>` : '';
/** How you'd apply, and how long it takes: email, a quick form, an account to make first… */
const EFFORT_CLS = { email: 'good', quick: 'good', account: 'warn', board: 'warn', site: '' };
const effortTag = j => j.effort && ['ready', 'approved'].includes(j.status) ? ` <span class="pill effort ${EFFORT_CLS[j.effort.kind] || ''}" title="${esc(j.effort.about || 'How you apply to this one')}">${esc(j.effort.label)}</span>` : '';
/** Where Apply goes, for a posting found on a job board: the company's own site, once Job Hunt finds it there. */
const onCompanySite = j => j.apply_url ? `<span class="good-text" title="${esc(j.apply_url)}">applies on ${esc(j.company)}'s own site</span>` : '';

/** Reaching out to recruiters (see core/src/playbook.rs): the advice for this kind of employer, and a
 *  word if you've already messaged someone at the company. */
const PLAYBOOK_LABEL = { private: 'Private employer', agency: 'Staffing agency', federal: 'Government of Canada', public: 'Provincial or municipal government' };
function playbookHtml(pb, contacts, j) {
  if (!pb) return '';
  // Anyone messaged at the company (for this job or another), when there's someone else you might write to.
  const messaged = pb.messaged || [];
  const warn = messaged.length && (contacts.some(c => !c.sent_at) || messaged.some(m => m.job !== j.id));
  const names = [...new Set(messaged.map(m => m.name))];
  return `<div class="playbook ${esc(pb.kind)}"><b>${esc(PLAYBOOK_LABEL[pb.kind] || '')}.</b> ${esc(pb.advice)}
    ${warn ? `<p class="small"><b>You've messaged ${esc(names.join(', '))} at ${esc(j.company)}</b> (${esc(ago(messaged.map(m => m.at).sort().pop()))}). One recruiter at a company at a time: wait for a reply before writing to someone else there.</p>` : ''}
    <details class="small"><summary class="muted">How to reach out</summary><ul>
      <li>One short message: the role and its job ID, one concrete line on your strongest proof for what they need, your availability, and an offer of a quick call.</li>
      <li>Don't ask “what's the status?”, paste your CV into the message, or send attachments unless they ask.</li>
      <li>No reply? One follow-up ${pb.follow_up_after} to ${pb.follow_up_by} days later, then stop. Never more than twice.</li>
      <li>Don't message several recruiters at the same company at once.</li></ul></details></div>`;
}
/** One person at the company, and where your messages to them stand: write, send, follow up once, done. */
function contactHtml(c, i, writing, pb) {
  const day = t => fmtDate(t);
  const sent = c.sent_at && new Date(c.sent_at), followed = c.followed_at && new Date(c.followed_at);
  const due = sent && !followed && Date.now() - sent >= (pb?.follow_up_after || 7) * 86400000;
  const writtenNow = c.message && (followed ? false : sent ? c.message_kind === 'follow-up' : true);
  let state = '', acts = '';
  const replied = c.replied_at && new Date(c.replied_at);
  if (replied) state = `${esc(firstName(c.name))} replied ${esc(day(c.replied_at))}. No follow-up needed: carry on the conversation where they wrote.`;
  else if (followed) state = `Messaged ${esc(day(c.sent_at))}, followed up ${esc(day(c.followed_at))}. That's it: no more messages to ${esc(firstName(c.name))}.`;
  else if (sent && !due) state = `Sent ${esc(day(c.sent_at))}. No reply by ${esc(day(new Date(+sent + (pb?.follow_up_after || 7) * 86400000).toISOString()))}? Follow up once then.`;
  else if (due) state = `Sent ${esc(day(c.sent_at))}, no reply yet: time for the one follow-up.`;
  if (sent) acts += `<button class="btn${replied ? ' ghost' : ''}" data-act="contactReplied" data-i="${i}" title="${replied ? 'They didn\'t reply after all' : 'They wrote back, on LinkedIn say, where Job Hunt can\'t see it: no follow-up is asked for'}">${replied ? 'Not a reply after all' : 'They replied'}</button>`;
  if (!followed && !replied) {
    if (writtenNow) acts += `<button class="btn primary" data-act="contactSent" data-i="${i}" title="Mark it sent, so Job Hunt knows when to follow up">I sent it</button>`;
    if (!sent || due) acts += `<button class="btn${writtenNow ? ' ghost' : ''}" data-act="outreach" data-i="${i}" ${writing ? 'disabled' : ''}>${writtenNow ? 'Write again' : due ? 'Write the follow-up' : 'Write a message'}</button>`;
  }
  acts += `<button class="btn ghost" data-act="removeContact" data-i="${i}">Remove</button>`;
  return `<div class="qa"><div class="row" style="justify-content:space-between"><span><b>${esc(c.name)}</b>${c.role ? ` · ${esc(c.role)}` : ''}${c.email ? ` · ${esc(c.email)}` : ''}${c.link ? ` · <a href="#" data-act="link" data-url="${esc(c.link)}">profile</a>` : ''}
      ${state ? `<br><span class="small ${due ? '' : 'muted'}">${state}</span>` : ''}</span>
    <span class="row">${acts}</span></div>
    ${c.message && !followed && !replied ? `<div class="posting" id="msg${i}">${esc(c.message)}</div><div class="row">${c.link && !c.email ? `<button class="btn" data-act="copyOpen" data-from="msg${i}" data-url="${esc(c.link)}" title="Copies the note and opens their profile: press Connect, Add a note, paste, Send">${svg('open')}Copy it and open their profile</button>` : ''}<button class="btn ghost" data-act="copy" data-from="msg${i}">Copy</button>${c.link && !c.email ? `<span class="muted small">${c.message.length} characters. A connection note takes 300 (200 on a free account, where LinkedIn also limits how many you can send a month).</span>` : ''}</div>` : ''}</div>`;
}

/** One step of the job hunt on the Overview: its roles, each with the next thing to do. `tracked`
 *  (the Tracker's rows) fills in the steps after you apply. */
/** A company's initial on a tile whose colour comes from its name: the same company, the same colour. */
const avatar = name => { const s = String(name || '?').trim(); let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return `<span class="avatar" style="--h:${h}" title="${esc(s)}" aria-hidden="true">${esc((s.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase())}${name && !(Date.now() - (noLogo.get(s) || 0) < 90000) ? `<img class="logo" src="/api/logo?c=${encodeURIComponent(s)}" alt="" loading="lazy" decoding="async">` : ''}</span>`; };
/** A company's own logo over its letter, once Job Hunt has it (see logos.rs): shown when it loads,
 *  and where there's none the letter stays, without asking again on every redraw this session. */
const noLogo = new Map(); // company: when its logo last wasn't there (asked again after a minute and a half, by when Job Hunt may have found it)
document.addEventListener('load', e => { const i = e.target; if (i.matches?.('img.logo')) { if (i.naturalWidth >= 16) i.classList.add('ok'); else i.remove(); } }, true);
document.addEventListener('error', e => { const i = e.target; if (i.matches?.('img.logo')) { try { noLogo.set(new URL(i.src).searchParams.get('c'), Date.now()); } catch (x) {} i.remove(); } }, true);
/** What a posting pays, for a job's line of facts: the figure it states (its full wording on hover,
 *  and a mark when it's below your minimum), or that it states none. Always there, so no pay is
 *  something you see, not something missing. */
const payFact = j => j.salary
  ? `<span class="pay${belowMin(j) ? ' low' : ''}" title="${esc(j.salary)}${belowMin(j) ? `. Below your minimum of ${money(minSalary())}` : ''}">${esc(String(j.salary).split(/\s+[•·|]\s+/)[0])}</span>`
  : '<span class="pay none" title="The posting doesn\'t say what it pays">No pay stated</span>';
/** Under this share of a posting's keywords, a tailored CV is thin for it. */
const THIN_COVER = 0.6;
/** How much of a posting's keywords the tailored CV covers, as a fact for its row: marked when thin. */
const coverFact = j => j.coverage_after == null ? '' : j.coverage_after < THIN_COVER
  ? `<span class="warn-text" title="Under ${pct(THIN_COVER)}: screening software may rank it low. Open it to add the keywords you do have.">only ${pct(j.coverage_after)} of the posting's keywords</span>`
  : `${pct(j.coverage_after)} of the posting's keywords`;
/** For a thin CV: the posting's keywords it lacks, to tick the ones you really have. Job Hunt left
 *  them out because nothing in your CV backs them; ticking one is you saying it's true. */
const gapsHtml = j => j.coverage_after != null && j.coverage_after < THIN_COVER && (j.keyword_gaps || []).length ? `<div class="advice warn gaps" data-gaps="${esc(j.id)}">
    <b>This CV covers ${pct(j.coverage_after)} of the posting's keywords.</b>
    <p class="small">Job Hunt left these out because nothing in your CV backs them. Tick the ones you really have and it works them in; leave the rest.</p>
    <div class="gap-list">${j.keyword_gaps.slice(0, 14).map(k => `<label class="check small"><input type="checkbox" value="${esc(k)}"> ${esc(k)}</label>`).join('')}</div>
    <div class="row"><button class="btn sm" type="button" data-act="gapsAdd" data-job="${esc(j.id)}">Work in the ticked ones</button></div></div>` : '';
/** How good a match is to apply to now, for ordering: its fit, less for each day the posting has
 *  been up after the first two (a role's first days are when applications get read), less for red
 *  flags and pay below your minimum, a little more when it applies on the company's own site or
 *  says what it pays. An expired posting goes to the bottom. */
function applyRank(j) {
  const days = Math.max(0, (Date.now() - (+new Date(ageValue(j) || 0) || Date.now())) / 86400000);
  let n = (j.score ?? 0) - Math.min(30, Math.max(0, days - 2) * 1.5) - Math.min(12, (j.red_flags || []).length * 4);
  if (belowMin(j)) n -= 10;
  if (j.apply_url) n += 3;
  if (salaryValue(j.salary) > 0) n += 2;
  if (expiredWhy(j)) n -= 60;
  return Math.round(n * 10) / 10;
}
/** Days a posting has been up (or since Job Hunt found it). */
const daysUp = j => Math.max(0, (Date.now() - (+new Date(ageValue(j) || 0) || Date.now())) / 86400000);
/** One job in a step's list. The tick box, fit and name are one label when the row can be ticked
 *  (a press anywhere on them ticks it); the why line and the buttons are outside it. */
function jobRow(j, { tick = '', sub = '', actions = '', tags = '', cls = '', attrs = '', facts = '' }) {
  const meta = [coCell(j), j.location ? placeHtml(j) : '', payFact(j), j.employment ? esc(j.employment) : '', facts].filter(Boolean).join('<i class="sep">·</i>');
  const head = `${tick ? `<span class="jtick">${tick}</span>` : ''}${avatar(j.company)}<span class="jfit${j.score != null && j.score_after != null && j.score_after !== j.score ? ' has-after' : canReach(j) ? ' has-fore' : ''}">${scoreBadge(j.score)}${reachTag(j)}${fitNote(j)}</span>
      <span class="jmain"><span class="jtitle"><a class="qt" href="#job/${encodeURIComponent(j.id)}">${esc(j.title)}</a>${tags}</span><span class="jmeta">${meta}</span></span>`;
  return `<div class="jrow${cls ? ` ${cls}` : ''}${tick ? ' ticks' : ''}${expiredWhy(j) ? ' expired-row' : ''}" data-job-row="${esc(j.id)}" ${attrs} data-lrole="${esc(String(j.title || '').toLowerCase())}" data-lco="${esc(String(j.company || '').toLowerCase())}" data-lloc="${esc(String(j.location || '').toLowerCase())}" data-qnow="${applyRank(j)}" data-qfit="${j.score_after ?? j.score ?? 0}" data-qnew="${+new Date(ageValue(j) || 0) || 0}" data-qpay="${Math.max(0, salaryValue(j.salary))}" data-qhaspay="${j.salary ? 1 : 0}" data-qflags="${(j.red_flags || []).length}">${tick ? `<label class="jhead">${head}</label>` : `<div class="jhead">${head}</div>`}
      <span class="row jact">${actions}</span>${sub ? `<div class="jwhy small">${sub}</div>` : ''}</div>`;
}

function stepHtml(o, step, tracked) {
  jobOrder = [...(o.ready || []), ...(o.approved || []), ...(o.follow_ups || [])].map(j => j.id);
  const row = (j, sub, actions, tick = '') => jobRow(j, { tick, sub: sub ? `<span class="muted">${sub}</span>` : '', actions, tags: `${oneTag(j)}${effortTag(j)}${appliedBeforeTag(j)}` });
  const id = j => esc(j.id);
  const groups = [];
  const soon = (o.interviews || []).filter(i => new Date(i.start) - Date.now() < 3 * 86400000);
  if (soon.length) groups.push(['Interviews in the next few days', soon.map(i => `<div class="jrow"><div class="jhead"><span class="jfit"><span class="pill interviewing">${esc(fmtWhen(i.start))}</span></span>
      <span class="jmain"><span class="jtitle"><span class="qt">${esc(i.company || i.title)}</span></span>${i.job_title ? `<span class="jmeta">${esc(i.job_title)}</span>` : ''}</span></div>
      ${i.job_id ? `<span class="row jact"><a class="btn sm" href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prepare</a></span>` : ''}</div>`).join('')]);
  const picking = (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`));
  const inWork = (o.to_tailor || []).length - picking.length;
  if (picking.length) {
    // One list, best fit first; the filters reorder and hide rows in place (see applyPickView).
    const places = [...new Set((o.places || []).map(p => String(p).split(',')[0].trim()).filter(Boolean))];
    const opt = (v, n) => `<option value="${v}">${n}</option>`;
    const rows = [...picking].sort((a, b) => applyRank(b) - applyRank(a)).map(j => jobRow(j, {
      cls: 'pick', tick: `<input type="checkbox" data-pick="${esc(j.id)}" aria-label="Pick ${esc(j.title)}">`, tags: `${oneTag(j)}${appliedBeforeTag(j)}`, facts: ageTag(j), sub: whyFits(j),
      attrs: `data-expired="${expiredWhy(j) ? 1 : 0}" data-now="${applyRank(j)}" data-score="${j.score ?? 0}" data-reach="${j.score_after ?? canReach(j) ?? j.score ?? 0}" data-age="${+new Date(ageValue(j) || 0) || 0}" data-pay="${Math.max(0, salaryValue(j.salary))}" data-rating="${j.rating?.found ? j.rating.rating : 0}" data-flags="${(j.red_flags || []).length}" data-place="${esc(`${j.location || ''}${j.remote ? ' remote' : ''}`.toLowerCase())}"`,
      actions: `${j.score == null ? `<button class="btn sm" type="button" data-act="scoreAnyway" data-job="${id(j)}">Score it</button>` : ''}<a class="btn sm" href="#job/${encodeURIComponent(j.id)}" data-tab-to="overview">View</a><button class="btn ghost sm icon-only" type="button" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="queued" title="Not interested">${svg('close')}</button>` })).join('');
    groups.push([`Pick from <span data-pickhead>${picking.length} new match${picking.length === 1 ? '' : 'es'}</span>`, `<div data-pickbox>
    <div class="row" style="margin:2px 0 8px">${picking.length > 5 ? '<button class="btn sm" type="button" data-act="pickTop" data-n="5">Tick the top 5</button>' : ''}<button class="btn ghost sm" type="button" data-act="pickAll">Select all</button>${(() => { const old = picking.filter(j => daysUp(j) > 21 || expiredWhy(j)); return old.length ? `<button class="btn ghost sm" type="button" data-act="pickStale" data-ids="${esc(JSON.stringify(old.map(j => j.id)))}" title="Postings up for more than three weeks, or expired: an application now is rarely read. It doesn't change how Job Hunt scores.">Set aside ${old.length} older than 3 weeks</button>` : ''; })()}${inWork ? `<span class="muted small"><span class="spin" data-kind="tailor+score" data-n="${Math.ceil(inWork / 3)}"></span>Tailoring ${inWork}…</span>` : ''}</div>
    ${foldFilters(`<div class="pick-filters">
      <label class="small">Sort by <select data-pickf="sort">${opt('now', 'Best to apply to now')}${opt('fit', 'Best fit')}${opt('reach', 'Fit after tailoring')}${opt('new', 'Newest')}${opt('pay', 'Highest pay')}${opt('rating', 'Best-rated company')}</select></label>
      <label class="small">Fit <select data-pickf="min">${opt('0', 'Any')}${opt('60', '60 or more')}${opt('70', '70 or more')}${opt('80', '80 or more')}${opt('-60', 'Under 60')}${opt('-70', 'Under 70')}</select></label>
      <label class="small">Found <select data-pickf="age">${opt('', 'Any time')}${opt('3', 'Last 3 days')}${opt('7', 'Last 7 days')}${opt('-14', 'Over 2 weeks ago')}</select></label>
      ${places.length > 1 || o.remote_ok ? `<label class="small">Where <select data-pickf="place">${opt('', 'Anywhere')}${places.map(p => opt(esc(p.toLowerCase()), esc(p))).join('')}${opt('remote', 'Remote')}</select></label>` : ''}
      <label class="check small"><input type="checkbox" data-pickf="pay"> Shows pay</label>
      <label class="check small"><input type="checkbox" data-pickf="flags"> No red flags</label>
      <label class="check small" title="The ten best to apply to now, by the order you chose. The rest wait."><input type="checkbox" data-pickf="top"> Best 10 only</label>
      <span class="muted small" data-pickcount></span>
    </div>`, picking.length < 8)}
    <p class="muted small pick-keys desktop-only" ${picking.length < 8 ? 'hidden' : ''}><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Space</kbd> tick · <kbd>Enter</kbd> open · <kbd>X</kbd> not interested · <kbd>T</kbd> tailor the ticked ones</p>
    <div class="pick-list">${rows}</div>
    <p class="muted small pick-more" data-pickmore hidden></p>
    <div class="select-bar" hidden><span class="select-n"></span><button class="btn primary" data-act="tailorPicked">Tailor selected</button><button class="btn" data-act="dismissPicked">${svg('close')}Not interested</button><button class="btn ghost" data-act="pickClear">Clear</button></div>
</div>`]);
  }
  else if (inWork) groups.push(['Tailoring', `<p class="muted"><span class="spin" data-kind="tailor+score" data-n="${Math.ceil(inWork / 3)}"></span>Tailoring ${inWork} application${inWork === 1 ? '' : 's'}… they appear under Ready to approve.</p>`]);
  const ready = [];
  const many = o.ready?.length > 1;
  if (o.ready?.length) ready.push(['Ready to approve', `<div data-approvebox>
    ${many ? `<div class="row" style="margin:2px 0 8px"><button class="btn ghost sm" type="button" data-act="approveAll">Select all</button></div>` : ''}
    ${[...o.ready].sort((a, b) => applyRank(b) - applyRank(a)).map(j => row(j, [coverFact(j), j.apply_email ? 'applies by email' : '', onCompanySite(j)].filter(Boolean).join(' · '),
    `<a class="btn sm" href="#job/${encodeURIComponent(j.id)}" data-tab-to="docs">Check and approve</a>
     <button class="btn ghost sm icon-only" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="ready" title="Not interested">${svg('close')}</button>`,
    o.ready.length > 1 ? `<input type="checkbox" data-appr="${id(j)}" data-email="${esc(j.apply_email || '')}" aria-label="Select ${esc(j.company)}">` : '')).join('')}
    ${many ? `<div class="select-bar" hidden><span class="select-n"></span><button class="btn primary" data-act="approvePicked">Approve selected</button><button class="btn ghost" data-act="approveClear">Clear</button></div>` : ''}</div>`]);
  if (o.recruiter_asks?.length) groups.push(['Ask your recruiters to put you forward', o.recruiter_asks.map(j => row(j, `you know ${esc(j.recruiter)} there`,
    `<button class="btn sm" data-act="askRecruiter" data-job="${id(j)}" data-name="${esc(firstName(j.recruiter))}">Ask ${esc(firstName(j.recruiter))}</button>`)).join('')]);
  // Forms Job Hunt filled in that aren't marked applied: most went through, so ask.
  const unconfirmed = o.filled_unconfirmed || [];
  if (unconfirmed.length) groups.push([`Filled in by Job Hunt: did these go through?${unconfirmed.length > 1 ? ` <button class="btn primary sm" data-act="appliedAll" data-ids="${esc(JSON.stringify(unconfirmed.map(j => j.id)))}" style="margin-left:8px">All went through</button>` : ''}`,
    unconfirmed.map(j => row(j, 'Job Hunt filled in the form; it isn\'t marked applied yet',
      `<button class="btn primary sm" data-act="stage" data-status="applied" data-job="${id(j)}" data-from="approved">Yes, applied</button>
       <a class="btn ghost sm" href="#job/${encodeURIComponent(j.id)}" title="Not submitted yet: open it again">Not yet</a>`)).join('')]);
  // Quickest first: one-click emails and short forms, then the ones that need an account.
  const toSubmit = [...(o.approved || [])].filter(j => !unconfirmed.some(u => u.id === j.id)).sort((a, b) => (a.effort?.minutes ?? 10) - (b.effort?.minutes ?? 10));
  const formable = toSubmit.filter(j => j.url && j.effort?.kind !== 'email');
  const runIds = list => esc(JSON.stringify(list.map(j => ({ id: j.id, name: `${j.company}: ${j.title}` }))));
  const quick = formable.filter(j => (j.effort?.minutes ?? 10) <= 5);
  if (toSubmit.length) groups.push([`Submit on the company's site${formable.length > 1 && o.can_fill ? ` ${quick.length > 1 && quick.length < formable.length ? `<button class="btn primary sm" data-act="applyAll" data-ids="${runIds(quick)}" style="margin-left:8px" title="The short forms, a few minutes each: each opens in your browser, the extension fills it, you press Submit, then the next">Apply to the ${quick.length} quick ones</button>` : ''}<button class="btn ${quick.length > 1 && quick.length < formable.length ? '' : 'primary '}sm" data-act="applyAll" data-ids="${runIds(formable)}" style="margin-left:8px" title="Each opens in your browser, quickest first; the extension fills it, you check it and press Submit, then the next one opens">Apply to all ${formable.length}</button>` : ''}`, toSubmit.map(j => row(j, onCompanySite(j),
    `${o.can_fill && j.url && j.effort?.kind !== 'email' ? `<button class="btn sm" data-act="fillBrowser" data-job="${id(j)}" title="Opens the form in your browser, for the extension to fill in">Apply</button>` : `<a class="btn sm" href="#job/${encodeURIComponent(j.id)}">Apply</a>`}
     <button class="btn ghost sm" data-act="stage" data-status="applied" data-job="${id(j)}" data-from="approved" title="Already submitted it">Mark applied</button>
     <button class="btn ghost sm icon-only" data-act="stage" data-status="dismissed" data-job="${id(j)}" data-from="approved" title="Not interested after all (the pay, say)">${svg('close')}</button>`)).join('')]);
  if (o.quiet?.length) groups.push([`Quiet for 4+ weeks <button class="btn sm" data-act="closeQuiet" data-ids="${esc(JSON.stringify(o.quiet.map(j => j.id)))}" style="margin-left:8px">Close ${o.quiet.length === 1 ? 'it' : `all ${o.quiet.length}`} as No response</button>`,
    o.quiet.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}, no reply`,
      `<button class="btn sm" data-act="stage" data-status="no_response" data-job="${id(j)}" data-from="applied">No response</button>`)).join('')]);
  if (o.reach_out?.length) groups.push(['Message the recruiter or hiring team', o.reach_out.slice(0, 6).map(j => row(j, j.applied_at ? `applied ${esc(ago(j.applied_at))}. A short note within 1 to 3 days helps` : 'you know who to write to there: a short note the day you apply helps most',
    `<a class="btn sm" href="#job/${encodeURIComponent(j.id)}" data-tab-to="apply" data-scroll="people">Write a note</a>`)).join('')]);
  if (o.turned_down?.length) groups.push(['Turned down: read it, reply if a person wrote', o.turned_down.slice(0, 8).map(t => row(t.job, `they said no ${esc(ago(t.at))}${t.said ? `: ${esc(t.said)}` : ''}${t.stale_follow_up ? ' <span style="color:var(--warn)">A follow-up drafted before this is still in your Gmail drafts: delete it.</span>' : ''}`,
    `<a class="btn sm" href="#job/${encodeURIComponent(t.job.id)}">Draft a reply</a>
     <button class="btn ghost sm" data-act="seen" data-what="turned" data-job="${id(t.job)}" title="Take it off this list">Got it</button>`)).join('')]);
  if (o.drafts_waiting?.length) groups.push(['In your Gmail drafts: read and send', o.drafts_waiting.slice(0, 8).map(d => row(d.job, `follow-up written ${esc(ago(d.at))}${d.to ? `, to ${esc(d.to)}` : ''}. Nothing is sent until you send it`,
    `<a class="btn sm" href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Open Gmail drafts</a>
     <button class="btn ghost sm" data-act="seen" data-what="draft" data-job="${id(d.job)}" title="Sent or deleted: take it off this list">Done</button>`)).join('')]);
  if (o.contact_follow_ups?.length) groups.push(['No reply from the recruiter: follow up once', o.contact_follow_ups.slice(0, 6).map(f => row(f.job, `messaged ${esc(f.name)} ${esc(ago(f.sent_at))}${f.late ? '. Follow up now or let it go' : ''}`,
    `<a class="btn sm" href="#job/${encodeURIComponent(f.job.id)}" data-tab-to="apply">Write the follow-up</a>`)).join('')]);
  if (o.follow_ups?.length) groups.push([`No reply yet: follow up${o.follow_ups.length > 1 ? ` <button class="btn primary sm" data-act="followUpAll" data-ids="${esc(JSON.stringify(o.follow_ups.slice(0, 6).map(j => j.id)))}" style="margin-left:8px" title="Job Hunt writes a short follow-up for each; they're saved as Gmail drafts (or on each job) for you to read and send">Write all ${Math.min(6, o.follow_ups.length)}</button>` : ''}`, o.follow_ups.slice(0, 6).map(j => row(j, `applied ${esc(ago(j.applied_at))}`,
    `<button class="btn sm" data-act="followUp" data-job="${id(j)}">Write follow-up</button>`)).join('')]);
  // Each step's groups; the ones above were made for all of them.
  const has = h => groups.find(g => String(g[0]).startsWith(h));
  const listed = new Set([...(o.drafts_waiting || []).map(d => d.job), ...(o.follow_ups || []), ...(o.reach_out || []), ...(o.contact_follow_ups || []).map(f => f.job), ...(o.quiet || []), ...(o.approved || [])].map(j => j.id));
  const rest = (title, keep) => {
    const rows = tracked.filter(r => keep(r) && !listed.has(r.id));
    return rows.length ? [[title, rows.map(trackRow).join('')]] : [];
  };
  const by = {
    pick: [has('Pick'), has('Tailoring')].filter(Boolean),
    approve: ready,
    submit: [has('Filled in by Job Hunt'), has('Ask your recruiters'), has('Submit')].filter(Boolean),
    waiting: [has('Turned down'), has('In your Gmail drafts'), has('Message the recruiter'), has('No reply from the recruiter'), has('No reply yet'), has('Quiet'), ...rest('Everything else you applied to', r => r.status === 'applied')].filter(Boolean),
    interviews: [has('Interviews in the next'), ...rest('Interviewing and offers', r => ['interviewing', 'offer'].includes(r.status))].filter(Boolean),
  }[step];
  const empty = {
    pick: o.setup?.claude && o.setup?.cvs ? 'No new matches to pick from. New ones appear here after each search.' : 'Finish setting up above, then search for jobs.',
    approve: 'Nothing to approve. Tailor some roles in Pick, and they appear here.',
    submit: 'Nothing waiting to be submitted.',
    waiting: 'No applications waiting on a reply.',
    interviews: 'No interviews yet.',
  }[step];
  // The groups' headings name the step's parts; the step's own name is on its tab.
  const card = by.length ? by.map(([h, rows]) => `<section class="card todo step-${step}"><div class="todo-group">${h ? `<h2 class="group-h">${h}</h2>` : ''}${rows}</div></section>`).join('') : `<section class="card todo step-${step}"><p class="empty">${empty}</p></section>`;
  return card;
}

// ---- Two computers ----
function inUseHtml(u) {
  if (!u) return '';
  if (u.handed_to) return `<section class="card sync-banner"><header><h2>Job Hunt moved to ${esc(u.handed_to)}</h2></header>
    <p>${esc(u.handed_to)} took over, and your latest data was saved for it. Close Job Hunt here (on a server, just leave it): anything done here now wouldn't reach the other one. To switch back, use <b>Use it here again</b>.</p>
    <div class="row"><button class="btn" data-act="syncResume">Use it here again</button><span class="muted small">${esc(u.handed_to)} saves its latest data for this one and stops, if it's still open; then continue from it here.</span></div></section>`;
  if (u.waiting_for) return `<section class="card sync-banner"><header><h2><span class="spin" data-kind="wait" data-secs="120"></span>Waiting for ${esc(u.waiting_for)}</h2></header>
    <p>${esc(u.waiting_for)} is saving its latest data for this computer. That takes a minute or two, plus however long Google Drive takes to bring it here. Then you'll be offered to continue from it.</p></section>`;
  if (u.other) return `<section class="card sync-banner warn"><header><h2>Job Hunt is open on ${esc(u.other)}</h2></header>
    <p>Use one computer at a time: changes made on both can't be combined. Close Job Hunt there, or take over here: ${esc(u.other)} saves its latest data and stops, and this computer continues from it.</p>
    <div class="row"><button class="btn primary" data-act="takeOver">Take over here</button></div></section>`;
  return '';
}

// ---- Search progress ----
/** What the search is doing, in a line: "Scoring postings (12 of 40)". */
function stageLine(pr) {
  if (!pr) return '';
  const count = pr.scoring ? ` (${pr.done} of ${pr.total})` : pr.total ? ` (${Math.min(pr.done + 1, pr.total)} of ${pr.total})` : '';
  return `${pr.paused ? 'Paused: ' : ''}${pr.stage || 'Starting the search'}${count}${pr.also ? ` · ${pr.also}` : ''}`;
}
/** The running search at the top of the Overview: its progress, and a menu with what it's doing
 * now and Pause / Resume / Stop. Kept up to date in place by updateSearchCtl. */
function searchCtl(pr) {
  pr = pr || {};
  return `<details class="menu" id="searchCtl"><summary class="btn${pr.paused ? ' primary' : ''}" data-sv="summary" title="${esc(stageLine(pr))}">
      <span class="spin" data-sv="bar" data-p="${pr.percent ?? 0}"></span><span data-sv="label">${esc(ctlLabel(pr))}</span><span class="caret">▾</span></summary>
    <div class="menu-list right search-now">
      <b data-sv="stage">${esc(stageLine(pr))}</b>
      <span class="muted small" data-sv="detail">${esc(pr.detail || '')}</span>
      <span class="small" data-sv="counts">${searchCounts(pr)}</span>
      <div class="row">
        <button class="btn sm${pr.paused ? ' primary' : ''}" data-act="searchHold" data-sv="hold" data-on="${pr.paused ? '0' : '1'}">${pr.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn ghost danger sm" data-act="searchStop" title="Ends it after the step it's on; what it found or scored so far is kept">Stop</button>
      </div>
    </div></details>`;
}
const searchCounts = pr => pr.scoring ? `${pr.done ?? 0} of ${pr.total ?? 0} scored · ${pr.tailored ?? 0} tailored` : `${pr.found ?? 0} found · ${pr.new ?? 0} new · ${pr.scored ?? 0} scored · ${pr.tailored ?? 0} tailored`;
/** The search button's words: searching, or scoring what was waiting ("Scoring 40 of 379"). */
const ctlLabel = pr => pr.paused ? `Paused · ${pr.percent ?? 0}%` : pr.scoring ? `Scoring ${pr.done ?? 0} of ${pr.total ?? 0}` : `Searching · ${pr.percent ?? 0}%`;
/** Bring the search menu and the sidebar's line up to date without redrawing anything else. */
function updateSearchCtl() {
  const pr = overview?.progress;
  $('#runLine').title = pr ? `${stageLine(pr)}${pr.detail ? ` – ${pr.detail}` : ''}` : '';
  const box = $('#searchCtl');
  if (!box || !pr) return;
  const set = (k, v) => { const el = box.querySelector(`[data-sv="${k}"]`); if (el && el.textContent !== v) el.textContent = v; };
  set('label', ctlLabel(pr));
  set('stage', stageLine(pr));
  set('detail', pr.detail || '');
  set('counts', searchCounts(pr));
  box.querySelector('[data-sv="bar"]').dataset.p = pr.percent;
  const sum = box.querySelector('[data-sv="summary"]');
  sum.title = stageLine(pr);
  sum.classList.toggle('primary', !!pr.paused);
  const hold = box.querySelector('[data-sv="hold"]');
  if (hold.dataset.on !== (pr.paused ? '0' : '1')) {
    hold.dataset.on = pr.paused ? '0' : '1';
    hold.textContent = pr.paused ? 'Resume' : 'Pause';
    hold.classList.toggle('primary', !!pr.paused);
  }
}

function progressHtml(pr) {
  if (!pr) return '';
  const count = pr.total ? ` ${Math.min(pr.done + 1, pr.total)} of ${pr.total}` : '';
  return `<section class="card progress-card" id="progressCard">
    <header><h2>${pr.paused ? 'Paused: ' : ''}${esc(pr.stage || 'Starting the search')}${count}</h2><b class="pct">${pr.percent}%</b></header>
    <div class="pbar${pr.paused ? ' paused' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pr.percent}"><i style="width:${pr.percent}%"></i></div>
    <p class="muted small">${pr.paused ? 'Everything found so far is kept. Resume carries on from this step.' : esc(pr.detail || '')}${!pr.paused && pr.also ? `<br><b>Meanwhile:</b> ${esc(pr.also)}` : ''}</p>
    ${pr.paused ? `<div class="row"><button class="btn primary sm" data-act="searchHold" data-on="0">${pr.scoring ? 'Resume scoring' : 'Resume search'}</button><button class="btn ghost danger sm" data-act="searchStop">Stop</button></div>` : ''}
    <div class="facts small"><span><b>${pr.found}</b> postings found</span><span><b>${pr.new}</b> new</span><span><b>${pr.scored}</b> scored</span><span><b>${pr.tailored}</b> tailored</span></div>
  </section>`;
}
function reportHtml(r) {
  if (!r) return '';
  const probs = [...(r.source_problems || []), ...(r.errors || [])];
  const why = Object.entries(r.why_filtered || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ');
  // Few new postings: say why, and offer the ways to get more.
  const few = r.new < 25 || r.tailored === 0;
  const s = overview?.setup || {};
  const more = few ? `<details class="more" ${r.new === 0 ? 'open' : ''}><summary><b>Get more postings</b></summary><p><b>${r.new === 0 ? 'Nothing new this time.' : `Only ${r.new} new posting${r.new === 1 ? '' : 's'}.`}</b>
      ${r.known ? `${r.known} of the ${r.found} postings were already seen in earlier searches, so the boards you search have little that's new.` : ''}
      ${overview?.auto_boards ? 'Job Hunt is looking for more employers in your locations by itself and will search them when it finds some. To speed things up:' : 'More sources bring more postings:'}</p>
    <div class="row">
      <button class="btn primary" data-act="suggestBoards" data-into="moreIdeas">Find employers near me now</button>
      ${s.adzuna ? '' : '<a class="btn" href="#search/setup">Add Google for Jobs listings</a>'}
      <a class="btn desktop-only" href="#search/setup">Send to Job Hunt from LinkedIn</a>
      <button class="btn ghost" data-act="run" data-task="search-force" title="Looks again at postings set aside earlier, with your current settings">Search again, including set-aside postings</button>
    </div>
    <p class="muted small">Also set up daily job alerts on LinkedIn, Indeed or your country's job sites for your titles, sent to your Gmail: Job Hunt reads them on every email check. If many postings are set aside for their location or title, widen your locations or add titles in <a href="#cvs">Your CVs</a>.</p>
    <div id="moreIdeas" class="ideas"></div></details>` : '';
  const WHY_FIX = { 'outside your locations': 'Change your places', 'title doesn\'t match your CVs': 'Add job titles', 'a title word you skip': 'Change the words you skip', 'salary below your minimum': 'Change your minimum salary', 'a company you skip': 'Change the companies you skip', 'company rated below your minimum': 'Change the minimum rating' };
  const whyRows = Object.entries(r.why_filtered || {}).sort((a, b) => b[1] - a[1]);
  const aside = whyRows.length ? `<details class="more"><summary><b>Why ${r.filtered} ${r.filtered === 1 ? 'was' : 'were'} set aside before scoring</b></summary>
      <div class="why-rows">${whyRows.map(([k, n]) => `<div><b class="num">${n}</b><span class="grow">${esc(k)}</span>${WHY_FIX[k] ? `<a class="btn ghost sm" href="#search/what">${WHY_FIX[k]}</a>` : ''}</div>`).join('')}</div>
      <p class="muted small">They used no Claude. They're in <a href="#applications/skipped">All jobs</a> with the stage Skipped, each with its reason and Tailor anyway.</p></details>` : '';
  return `<section class="card"><header><h2>Last search</h2><a class="btn ghost" href="#applications/new">See the postings</a></header>
    <div class="facts"><span><b>${r.found}</b> postings found</span><span><b>${r.new}</b> new</span>${r.known ? `<span><b>${r.known}</b> seen before</span>` : ''}<span title="${esc(why)}"><b>${r.filtered}</b> set aside before scoring</span><span><b>${r.scored}</b> checked by Claude</span><span><b>${r.tailored}</b> tailored</span>${r.to_pick ? `<span><b>${r.to_pick}</b> to pick from</span>` : ''}${r.deferred ? `<span><b>${r.deferred}</b> left for next time</span>` : ''}${r.closed ? `<span><b>${r.closed}</b> closed</span>` : ''}</div>
    ${(r.by_source || []).length ? `<p class="small muted" style="margin:8px 0 0">From: ${r.by_source.map(x => `${esc(x.name)} <b>${x.found}</b>${x.failed ? ` <span class="bad-text">(${x.failed === x.searches ? 'failed' : `${x.failed} of ${x.searches} searches failed`})</span>` : ''}`).join(' · ')}</p>` : ''}
    ${probs.length ? `<details style="margin-top:8px"><summary class="small">${probs.length} problem${probs.length === 1 ? '' : 's'}</summary><ul class="flags">${probs.slice(0, 12).map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
    ${aside}
    ${more}
  </section>`;
}
/** Live updates while a search runs, without redrawing the page. */
setInterval(async () => {
  if (!overview?.progress) return;
  await refreshOverview();
  updateSearchCtl();
  const card = $('#progressCard');
  if (card && overview.progress) card.outerHTML = progressHtml(overview.progress);
  else if (card || !overview.progress) { if (location.hash === '' || location.hash.startsWith('#overview')) route(); }
}, 1500);

/** A little Markdown: ## headings, - bullets, **bold**. */
function mdHtml(text) {
  const out = []; let list = [];
  const flush = () => { if (list.length) out.push(`<ul>${list.map(i => `<li>${marked(i)}</li>`).join('')}</ul>`); list = []; };
  String(text || '').split('\n').forEach(l => {
    const t = l.trim();
    if (!t) { flush(); return; }
    const h = t.match(/^#{1,4}\s+(.*)$/), b = t.match(/^[-*•]\s+(.*)$/);
    if (h) { flush(); out.push(`<h3>${marked(h[1])}</h3>`); }
    else if (b) list.push(b[1]);
    else { flush(); out.push(`<p>${marked(t)}</p>`); }
  });
  flush();
  return out.join('');
}

// ---- A posting, opened in place in a list ----
async function togglePosting(tr) {
  const next = tr.nextElementSibling;
  if (next?.classList.contains('xrow')) { next.remove(); tr.classList.remove('open'); return; }
  const cols = tr.children.length;
  tr.classList.add('open');
  tr.insertAdjacentHTML('afterend', `<tr class="xrow"><td colspan="${cols}"><div class="xpand"><p class="muted"><span class="spin" data-kind="posting" data-secs="3"></span>Loading the posting…</p></div></td></tr>`);
  const box = tr.nextElementSibling.querySelector('.xpand');
  // As wide as the card shows, even when the table scrolls sideways.
  const card = tr.closest('.card');
  if (card) box.style.maxWidth = `${card.clientWidth - 40}px`;
  try {
    const { job: j } = await api(`/api/jobs/${encodeURIComponent(tr.dataset.expand)}`);
    const id = esc(j.id);
    box.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><b>${esc(j.title)}</b> ${closedTag(j)} · ${esc(j.company)}${j.location ? ` · ${placeHtml(j)}` : ''}${j.salary ? ` · ${esc(j.salary)}` : ''}
          <div class="muted small">${ageTag(j)} · found on ${esc(sourceName(j.source))}</div></div>
        <div class="row">
          ${j.url ? `<button class="btn" data-act="open" data-what="posting" data-job="${id}">${svg('open')}Open posting</button>` : ''}
          ${['skipped', 'saved', 'queued'].includes(j.status) && j.score == null ? `<button class="btn" data-act="scoreAnyway" data-job="${id}">Score it anyway</button>` : ''}
          ${CAN_CHOOSE.includes(j.status) ? `<button class="btn primary" data-act="tailorAnyway" data-job="${id}">Tailor anyway</button>` : ''}
          <a class="btn ghost" href="#job/${encodeURIComponent(j.id)}">Full details</a>
        </div>
      </div>
      ${j.reasoning ? `<p class="small" style="margin:10px 0 0"><b>${j.score != null ? `Fit ${j.score}:` : 'Why skipped:'}</b> ${esc(j.reasoning.replace(/^Filtered out: /, 'Filtered out before scoring: '))}</p>` : ''}
      <div class="posting" style="margin-top:10px">${esc(j.description || 'The source gave no description. Use Open posting to read it on the site.')}</div>`;
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

// ---- Documents ----
/** Escaped text with **bold** marks turned into bold. */
const marked = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** The cover letter as it prints: paragraphs, bullets, bold, and your signature above your name. */
function letterHtml(text, signature) {
  const blocks = String(text || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map((b, bi) => {
    const lines = b.split('\n').filter(l => l.trim());
    let html = '', run = [], items = [];
    const flushRun = () => { if (run.length) html += `<p>${run.map(marked).join('<br>')}</p>`; run = []; };
    const flushList = () => { if (items.length) html += `<ul>${items.map(i => `<li>${marked(i)}</li>`).join('')}</ul>`; items = []; };
    lines.forEach((l, li) => {
      if (signature && bi === blocks.length - 1 && li === lines.length - 1) { flushRun(); flushList(); html += `<p><img class="sig" src="${signature}" alt="Signature"></p>`; }
      const m = l.trim().match(/^[-•]\s+(.*)$/);
      if (m) { flushRun(); items.push(m[1]); } else { flushList(); run.push(l); }
    });
    flushRun(); flushList();
    return html;
  }).join('');
}

function cvHtml(blocks) {
  return blocks.map(b => b.kind === 'blank' ? '' :
    b.kind === 'heading' ? `<h4>${marked(b.text)}</h4>` :
    b.kind === 'name' ? `<p class="name">${esc(b.text.replace(/\*\*/g, ''))}</p>` :
    `<p class="${b.kind === 'bullet' ? 'li' : ''}${b.changed ? ' chg' : ''}${b.center ? ' c' : ''}">${marked(b.text)}</p>`).join('');
}

// ---- The Queue's lists sort by their headers, like the tables do ----
/** What a list of jobs can be put in order by: (key, its name, whether it's a number). Numbers start
 *  largest first (best fit, highest pay, newest); names start at A. */
const LIST_COLS = [['role', 'Role'], ['co', 'Company'], ['loc', 'Location'], ['pay', 'Pay', 1], ['new', 'Found', 1], ['fit', 'Fit', 1]];
let listSort = null;
try { listSort = JSON.parse(localStorage.getItem('jh.listSort') || 'null'); } catch (e) {}
const jobLists = () => [...new Set([...document.querySelectorAll('.page .jrow[data-job-row]')].map(r => r.parentElement))];
/** A row of headers over each list of jobs (two or more): press one to sort by it, again to turn it round. */
function listHeads() {
  for (const p of jobLists()) {
    const rows = [...p.children].filter(c => c.matches('.jrow[data-job-row]'));
    if (rows.length < 2 || p.querySelector(':scope > .list-head')) continue;
    rows[0].insertAdjacentHTML('beforebegin', `<div class="list-head" role="group" aria-label="Sort this list"><span>Sort by</span>${LIST_COLS.map(([k, name]) => `<button type="button" data-lsort="${k}" title="Sort by ${name.toLowerCase()}">${name}<span class="arrow"></span></button>`).join('')}</div>`);
    const at = {};
    rows.forEach(r => { if (r.dataset.lco) at[r.dataset.lco] = (at[r.dataset.lco] || 0) + 1; });
    rows.forEach(r => { const n = at[r.dataset.lco]; if (n > 1 && !r.querySelector('.co-more')) r.querySelector('.jtitle')?.insertAdjacentHTML('beforeend', ` <button type="button" class="pill co-more" data-lsort="co" data-together="1" title="This company has ${n} roles in this list. Press to put them side by side.">${n} roles here</button>`); });
    // Select all sits at the start of the headers, and the row it had to itself goes.
    const all = p.closest('[data-pickbox], [data-approvebox]')?.querySelector('[data-act=approveAll], [data-act=pickAll]'), was = all?.parentElement;
    if (all && !was.classList.contains('list-head')) {
      p.querySelector(':scope > .list-head').prepend(all);
      if (!was.children.length) was.hidden = true;
    }
  }
  applyListSort();
}
function applyListSort() {
  const col = listSort && LIST_COLS.find(c => c[0] === listSort.key);
  document.querySelectorAll('.list-head [data-lsort]').forEach(b => { const on = col && b.dataset.lsort === col[0]; b.classList.toggle('on', !!on); b.querySelector('.arrow').textContent = on ? (listSort.dir === 'asc' ? ' ▲' : ' ▼') : ''; });
  if (!col) return;
  const val = r => col[2] ? Number(r.dataset['q' + col[0]]) || 0 : r.dataset['l' + col[0]] || '';
  for (const p of jobLists()) {
    const rows = [...p.children].filter(c => c.matches('.jrow[data-job-row]'));
    const after = rows[rows.length - 1].nextSibling;
    // Expired postings last, and a name that's missing after the ones that are there.
    rows.sort((a, b) => (a.dataset.expired === '1') - (b.dataset.expired === '1') || (col[2] ? 0 : !val(a) - !val(b)) || ((x, y) => (x < y ? -1 : x > y ? 1 : 0) * (listSort.dir === 'asc' ? 1 : -1))(val(a), val(b)))
      .forEach(r => p.insertBefore(r, after));
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lsort]');
  if (!b) return;
  const col = LIST_COLS.find(c => c[0] === b.dataset.lsort), first = col[2] ? 'desc' : 'asc';
  // A third press lets go: back to each list's own order.
  const off = !b.dataset.together && listSort && listSort.key === col[0] && listSort.dir !== first;
  if (b.dataset.together) { e.preventDefault(); listSort = null; }
  listSort = off ? null : { key: col[0], dir: listSort && listSort.key === col[0] ? (first === 'asc' ? 'desc' : 'asc') : first };
  try { localStorage.setItem('jh.listSort', JSON.stringify(listSort)); } catch (err) {}
  if (off) route(); else applyListSort();
});
// Choosing an order from a list's own Sort by menu takes over from the headers.
document.addEventListener('change', e => {
  if (!e.target.matches?.('[data-queuef=sort], [data-pickf=sort]') || !listSort) return;
  listSort = null;
  try { localStorage.removeItem('jh.listSort'); } catch (err) {}
  applyListSort();
}, true);
