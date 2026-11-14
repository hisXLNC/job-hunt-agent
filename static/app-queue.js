// Job Hunt screens, continued. The Queue: what is waiting for you, as a list or one decision at a time, and a job beside the Pipeline's list.
'use strict';

// ---- Overview ----
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// ---- A job beside the Pipeline's list ----
let panelJob = '';
/** Room for a job beside the list: a wide window with a mouse. Elsewhere a job opens its own page. */
const panelFits = () => matchMedia('(min-width: 1180px)').matches && !matchMedia('(pointer: coarse) and (max-height: 700px)').matches;
function closePanel() {
  panelJob = '';
  const el = $('#jobPanel');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('panel-open');
  document.querySelectorAll('.in-panel').forEach(x => x.classList.remove('in-panel'));
}
/** Open a job beside the list: what it is, where it stands, the next thing to do with its buttons,
 *  and why it fits. The whole job (letter, questions, interview, notes) is a click further. */
async function openPanel(id) {
  const el = $('#jobPanel');
  if (!el) return;
  const again = panelJob === id && !el.hidden;
  panelJob = id;
  el.hidden = false;
  document.body.classList.add('panel-open');
  document.querySelectorAll('.in-panel').forEach(x => x.classList.remove('in-panel'));
  document.querySelectorAll(`tr[data-expand="${CSS.escape(id)}"], .jrow[data-job-row="${CSS.escape(id)}"]`).forEach(x => x.classList.add('in-panel'));
  if (!again) el.innerHTML = '<p class="muted jp-wait">Loading…</p>';
  let d;
  try { d = await api(`/api/jobs/${encodeURIComponent(id)}`); } catch (e) { if (panelJob === id) el.innerHTML = `<div class="jp-top"><button class="x" data-act="panelClose" title="Close (Esc)">×</button></div><p class="muted jp-wait">${esc(e.message)}</p>`; return; }
  if (panelJob !== id) return;
  const j = d.job;
  j.effort = d.effort;
  const tailoring = (overview?.running || []).includes(`tailor:${id}`);
  const w = fitWords(j), must = mustHaves(j), flags = (j.red_flags || []).filter(x => !/^must have:/i.test(x));
  const lacks = [w.gap, ...must.map(m => `Required, not on your CV: ${m}`), ...flags, j.career && !j.career.toward ? `Could set your career back: ${j.career.why || 'a step down, or work it would be hard to come back from'}` : ''].filter(Boolean);
  const facts = [`<b>${coCell(j)}</b>`, j.location ? placeHtml(j) : '', payFact(j), j.employment ? esc(j.employment) : '', ageTag(j)].filter(Boolean).map(x => `<span>${x}</span>`).join('');
  el.innerHTML = `<div class="jp-top"><span class="kicker">${esc(STAGES[j.status] || j.status)}</span><span class="grow"></span><a class="btn ghost sm" href="#job/${encodeURIComponent(id)}">Open the full page</a><button class="x" data-act="panelClose" title="Close (Esc)">×</button></div>
    <div class="jp-scroll">
      <div class="jp-head">${avatar(j.company)}<div class="grow"><h2>${esc(j.title)}</h2><div class="facts">${facts}</div></div>${fitRing(j.score_after ?? j.score)}</div>
      <div class="dtags">${oneTag(j)}${effortTag(j)}${closedTag(j)}${deadlineTag(j)}${belowMinTag(j)}${(d.company_history || []).length ? '<span class="pill info">Applied here before</span>' : ''}</div>
      ${d.progress ? `<div class="jp-track">${stepsHtml(d.progress)}</div>` : ''}
      ${jobActions(j, tailoring, d.progress)}
      ${w.match ? `<div class="why"><b>Why it fits</b>${esc(w.match)}${j.score_after == null && canReach(j) ? ` <span class="muted">Tailored, it could reach about <b class="in">${canReach(j)}</b>.</span>` : ''}</div>` : ''}
      ${lacks.length ? `<div class="why warnish"><b>Gaps and things to check</b><ul>${lacks.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
      ${j.cv_path ? `<div class="jp-files"><button class="btn sm" data-act="open" data-what="cv" data-job="${esc(id)}">${svg('doc')}Tailored CV</button><button class="btn sm" data-act="open" data-what="letter" data-job="${esc(id)}">${svg('doc')}Cover letter</button>${j.coverage_after != null ? `<span class="muted small">${pct(j.coverage_after)} of the posting's keywords</span>` : ''}</div>` : ''}
      ${j.notes ? `<div class="jp-notes"><b class="small">Your notes</b><p class="small">${esc(j.notes)}</p></div>` : ''}
      <details class="jp-posting"><summary><b>The posting</b></summary><div class="posting">${esc(j.description || 'The source gave no description. Open it on the site to read it.')}</div></details>
    </div>`;
}
/** After a page is drawn: the job beside the list stays open (and up to date) while you're in Pipeline. */
function syncPanel() {
  const inPipeline = /^#(applications|results)/.test(location.hash);
  if (panelJob && inPipeline && panelFits()) openPanel(panelJob); else if (panelJob || !$('#jobPanel')?.hidden) closePanel();
}

// ---- Queue: one decision at a time ----
/** What a fit's reasoning says for the role, and against: "Strong match on X. Biggest gap: Y." */
function fitWords(j) {
  const r = (j.reasoning || '').trim();
  const m = r.match(/^(.*?)(?:\.?\s*)(?:The )?(?:Gap|Biggest gap|Main gap)s?(?: is|:)\s*(.*)$/i);
  return { match: (m ? m[1] : r).replace(/^(Strong(est)? match|Match):\s*/i, '').replace(/\.$/, ''), gap: m ? m[2].replace(/\.$/, '') : '' };
}
/** A fit score as a ring that fills with it. */
const fitRing = n => n == null ? '<div class="ring none" title="Not scored yet">–</div>' : `<div class="ring ${scoreBand(n)}" style="--p:${Math.max(0, Math.min(100, n))}" title="Fit score">${n}</div>`;
/** Everything waiting for a decision from you, most pressing first. Each: the step it belongs to
 *  (Pick, Approve, Submit, Waiting, Interviews, or fix for a problem), its kind, and what it's about. */
function queueItems(o) {
  const items = [];
  const add = (step, kind, key, x) => items.push({ step, kind, id: `${kind}:${key}`, ...x });
  const health = o.health || [];
  health.forEach((h, i) => { if (h.level === 'problem') add('fix', 'health', i, { h }); });
  (o.interviews || []).filter(i => new Date(i.start) - Date.now() < 3 * 86400000).forEach(i => add('interviews', 'interview', i.job_id || i.start, { i }));
  const unconfirmed = o.filled_unconfirmed || [];
  unconfirmed.forEach(j => add('submit', 'filled', j.id, { j }));
  (o.ready || []).forEach(j => add('approve', 'approve', j.id, { j }));
  // Quickest first: one-click emails and short forms, then the ones that need an account.
  [...(o.approved || [])].filter(j => !unconfirmed.some(u => u.id === j.id)).sort((a, b) => (a.effort?.minutes ?? 10) - (b.effort?.minutes ?? 10)).forEach(j => add('submit', 'submit', j.id, { j }));
  (o.recruiter_asks || []).forEach(j => add('submit', 'ask', j.id, { j }));
  (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`)).sort((a, b) => applyRank(b) - applyRank(a)).forEach(j => add('pick', 'pick', j.id, { j }));
  // A no, and drafts Job Hunt left in Gmail: said here, not only in a notice that's gone in a moment.
  (o.turned_down || []).forEach(t => add('waiting', 'turned', t.job.id, { j: t.job, t }));
  (o.drafts_waiting || []).forEach(d => add('waiting', 'draft', d.job.id, { j: d.job, d }));
  (o.contact_follow_ups || []).forEach(f => add('waiting', 'contact', f.job.id, { j: f.job, f }));
  (o.follow_ups || []).forEach(j => add('waiting', 'follow', j.id, { j }));
  (o.reach_out || []).forEach(j => add('waiting', 'reach', j.id, { j }));
  if (o.quiet?.length) add('waiting', 'quiet', 'all', { list: o.quiet });
  if (o.held && !(o.running || []).includes('search')) add('pick', 'held', 'all', { n: o.held });
  health.forEach((h, i) => { if (h.level !== 'problem') add('fix', 'health', `w${i}`, { h }); });
  return items;
}
/** How many decisions are waiting: everything but the notes that are merely worth a look. */
const queueCount = items => items.filter(x => x.kind !== 'health' || x.h.level === 'problem').length;
const QUEUE_KIND = { pick: 'Pick', approve: 'Approve', submit: 'Submit', filled: 'Submit', ask: 'Ask a recruiter', turned: 'Turned down', draft: 'Draft to send', contact: 'Follow up', follow: 'Follow up', reach: 'Say hello', quiet: 'Tidy up', interview: 'Interview', health: 'Needs attention', held: 'Waiting to be scored' };
let queueSkipped = new Set(), queueAt = '';
/** How the Queue is shown: every listing at once ('list', unless you choose otherwise) or one decision at a time ('one'). Remembered on this device. */
const queueView = () => { try { return localStorage.getItem('jh.queueView') === 'one' ? 'one' : 'list'; } catch (e) { return 'list'; } };
/** A decision's buttons: the quiet ones on the left, a gap, then the one that moves it on. */
const dbar = (quiet, main) => `<div class="dbar">${quiet}<span class="sp"></span>${main}<button class="btn ghost skip" type="button" data-act="queueSkip" title="Leave it for now and see the next one (→)">Skip${svg('next')}</button></div>`;
const key = k => `<kbd class="k">${k}</kbd>`;
/** The top of a decision about a job: its company tile, what kind of decision, its name and facts, its fit. */
function decisionTop(j, kicker, fit = fitRing(j.score_after ?? j.score)) {
  const facts = [`<b>${coCell(j)}</b>`, j.location ? placeHtml(j) : '', payFact(j), j.employment ? esc(j.employment) : '', ageTag(j)].filter(Boolean).map(x => `<span>${x}</span>`).join('');
  return `<div class="dtop">${avatar(j.company)}<div class="grow"><p class="kicker">${kicker}</p><h2><a href="#job/${encodeURIComponent(j.id)}">${esc(j.title)}</a></h2>
      <div class="facts">${facts}</div><div class="dtags">${oneTag(j)}${effortTag(j)}${appliedBeforeTag(j)}${closedTag(j)}${deadlineTag(j)}${belowMinTag(j)}</div></div>${fit}</div>`;
}
/** One decision, drawn in full: what it is, what you need to know to decide, and its buttons. */
function decisionHtml(x, at, of) {
  const where = `${QUEUE_KIND[x.kind]} · ${at} of ${of}`;
  const j = x.j, id = j ? esc(j.id) : '', enc = j ? encodeURIComponent(j.id) : '';
  const notNow = from => `<button class="btn quiet" data-act="stage" data-status="dismissed" data-job="${id}" data-from="${from}">Not interested${key('X')}</button><button class="btn quiet" data-act="stage" data-status="saved" data-job="${id}" data-from="${from}" title="Save it for later: it leaves the queue and stays in Pipeline">Later${key('L')}</button>`;
  if (x.kind === 'pick') {
    const w = fitWords(j), gaps = new Set((j.keyword_gaps || []).map(k => k.toLowerCase()));
    const have = (j.keywords || []).filter(k => !gaps.has(k.toLowerCase())).slice(0, 7);
    const must = mustHaves(j), flags = (j.red_flags || []).filter(f => !/^must have:/i.test(f));
    const lacks = [w.gap, ...must.map(m => `Required, not on your CV: ${m}`), ...flags, j.career && !j.career.toward ? `Could set your career back: ${j.career.why || 'a step down, or work it would be hard to come back from'}` : ''].filter(Boolean);
    const reach = j.score_after ?? canReach(j);
    return `<article class="card decision" data-kind="pick">${decisionTop(j, where, fitRing(j.score))}
      <div class="dbody">
        ${w.match || reach ? `<div class="why"><b>Why it fits</b>${esc(w.match || 'It cleared your fit score.')}${reach && reach !== j.score ? ` <span class="muted">Tailored, your CV could reach about <b class="in">${reach}</b>.</span>` : ''}</div>` : ''}
        ${have.length || lacks.length ? `<div class="two">${have.length ? `<div><span class="pill good">You have</span><div class="kws">${have.map(k => `<span class="kw">${esc(k)}</span>`).join('')}</div></div>` : ''}
          ${lacks.length ? `<div><span class="pill warn">Gaps and things to check</span><ul>${lacks.map(g => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
        ${expiredWhy(j) ? `<p class="bad-text small">${esc(expiredWhy(j))}. Check the posting is still open.</p>` : ''}
      </div>
      ${dbar(`${notNow('queued')}<a class="btn ghost" href="#job/${enc}" data-tab-to="overview">Read the posting</a>`,
        j.score == null ? `<button class="btn primary big" data-primary data-act="scoreAnyway" data-job="${id}">Score it${key('Enter')}</button>` : `<button class="btn primary big" data-primary data-act="tailorPicked" data-job="${id}">Tailor my CV for it${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'approve') {
    return `<article class="card decision" data-kind="approve">${decisionTop(j, where)}
      <div class="dbody">
        <div class="why blue"><b>Your CV and cover letter are tailored</b>${j.coverage_after != null ? `They now cover ${pct(j.coverage_after)} of the posting's keywords${j.coverage_before != null ? ` (your CV covered ${pct(j.coverage_before)} before)` : ''}. ` : ''}${j.score_after != null && j.score != null && j.score_after !== j.score ? `Tailored, it scores <b class="in">${j.score_after}</b> (was ${j.score}). ` : ''}Read them, change what you like, then approve.</div>
        <p class="small muted">${j.apply_email ? `Approving emails them to ${esc(j.apply_email)} from your Gmail.` : 'Approving opens the form in your browser for Job Hunt to fill in. You press Submit.'} ${onCompanySite(j)}</p>
      </div>
      ${dbar(`${notNow('ready')}<a class="btn" href="#job/${enc}" data-tab-to="docs">Read CV and letter</a>`,
        `<button class="btn primary big" data-primary data-act="approve" data-job="${id}" data-email="${esc(j.apply_email || '')}">${j.apply_email ? 'Approve and email it' : 'Approve and apply'}${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'submit') {
    const can = overview?.can_fill && j.url && j.effort?.kind !== 'email';
    return `<article class="card decision" data-kind="submit">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>Approved: submit it</b>${can ? 'It opens in your own browser, where your sign-ins work. On the form, click the Job Hunt extension and press Fill this form; check it over and press Submit.' : 'Open the Apply page: the posting, your files and your answers are there in one place.'}</div>
        <p class="small muted">${onCompanySite(j)}</p><div class="precheck" data-precheck="${id}" hidden></div></div>
      ${dbar(`<button class="btn quiet" data-act="stage" data-status="dismissed" data-job="${id}" data-from="approved">Not interested${key('X')}</button><button class="btn" data-act="stage" data-status="applied" data-job="${id}" data-from="approved" title="Already submitted it">Mark applied</button>${can ? `<a class="btn ghost" href="#job/${enc}" data-tab-to="apply">Files and answers</a>` : ''}`,
        can ? `<button class="btn primary big" data-primary data-act="fillBrowser" data-job="${id}">Fill it in my browser${key('Enter')}</button>` : `<a class="btn primary big" data-primary href="#job/${enc}" data-tab-to="apply">Apply${key('Enter')}</a>`)}</article>`;
  }
  if (x.kind === 'filled') {
    return `<article class="card decision" data-kind="filled">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>Did it go through?</b>Job Hunt filled in this form, but it isn't marked applied yet. Most go through.</div></div>
      ${dbar(`<a class="btn" href="#job/${enc}">Not yet: open it again</a>`, `<button class="btn primary big" data-primary data-act="stage" data-status="applied" data-job="${id}" data-from="approved">Yes, I applied${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'ask') {
    return `<article class="card decision" data-kind="ask">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>You know a recruiter there</b>${esc(j.recruiter || 'A recruiter')} handled an application of yours before. Ask them to put you forward: Job Hunt writes the note.</div></div>
      ${dbar('', `<button class="btn primary big" data-primary data-act="askRecruiter" data-job="${id}" data-name="${esc(firstName(j.recruiter))}">Ask ${esc(firstName(j.recruiter))}${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'turned') {
    return `<article class="card decision" data-kind="turned">${decisionTop(j, where)}
      <div class="dbody"><div class="why"><b>They said no ${esc(ago(x.t.at))}</b>${x.t.said ? esc(x.t.said) : 'The email gave no reason.'}${x.t.stale_follow_up ? ' <span style="color:var(--warn)">A follow-up Job Hunt drafted before this arrived is still in your Gmail drafts: delete it.</span>' : ''}</div></div>
      ${dbar(`<button class="btn quiet" data-act="seen" data-what="turned" data-job="${id}">Got it</button>`, `<a class="btn primary big" data-primary href="#job/${enc}">Draft a reply${key('Enter')}</a>`)}</article>`;
  }
  if (x.kind === 'draft') {
    return `<article class="card decision" data-kind="draft">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>A follow-up is in your Gmail drafts</b>Job Hunt wrote it ${esc(ago(x.d.at))}${x.d.to ? `, to ${esc(x.d.to)}` : ''}: “${esc(x.d.subject || '')}”. Nothing is sent until you send it.</div></div>
      ${dbar(`<button class="btn quiet" data-act="seen" data-what="draft" data-job="${id}">Done (sent or deleted)</button>`, `<a class="btn primary big" data-primary href="#" data-act="link" data-url="https://mail.google.com/mail/u/0/#drafts">Open Gmail drafts${key('Enter')}</a>`)}</article>`;
  }
  if (['follow', 'reach', 'contact'].includes(x.kind)) {
    const text = x.kind === 'follow' ? ['No reply yet', `You applied ${esc(ago(j.applied_at))}. A short, polite follow-up is worth sending; Job Hunt writes it for you to read and send.`]
      : x.kind === 'reach' ? j.applied_at ? ['Just applied: say hello', `You applied ${esc(ago(j.applied_at))}. A short note to the recruiter within one to three days helps you stand out.`] : ['Say hello before you apply', 'You know who to write to there. A short note the day you apply gets read before the pile does.']
      : ['No reply from the recruiter', `You messaged ${esc(x.f.name)} ${esc(ago(x.f.sent_at))}${x.f.late ? '. Follow up now, or let it go' : ''}.`];
    const main = x.kind === 'follow' ? `<button class="btn primary big" data-primary data-act="followUp" data-job="${id}">Write the follow-up${key('Enter')}</button>`
      : `<a class="btn primary big" data-primary href="#job/${enc}" data-tab-to="apply" ${x.kind === 'reach' ? 'data-scroll="people"' : ''}>${x.kind === 'reach' ? 'Write a note' : 'Write the follow-up'}${key('Enter')}</a>`;
    return `<article class="card decision" data-kind="${x.kind}">${decisionTop(j, where)}
      <div class="dbody"><div class="why blue"><b>${text[0]}</b>${text[1]}</div></div>
      ${dbar(x.kind === 'follow' ? `<button class="btn quiet" data-act="stage" data-status="no_response" data-job="${id}" data-from="applied" title="Stop waiting for this one">Close as No response</button>` : '', main)}</article>`;
  }
  if (x.kind === 'quiet') {
    const l = x.list;
    return `<article class="card decision" data-kind="quiet"><div class="dtop"><span class="bigicon">${svg('clock')}</span><div class="grow"><p class="kicker">${where}</p><h2>${l.length} quiet for four weeks or more</h2>
        <div class="facts"><span>${l.slice(0, 4).map(q => esc(q.company)).join(', ')}${l.length > 4 ? ` and ${l.length - 4} more` : ''}</span></div></div></div>
      <div class="dbody"><div class="why"><b>Keep your list true</b>No reply in a month rarely turns into one. Closing them as No response keeps Waiting to the ones still alive; they stay in Pipeline.</div></div>
      ${dbar(`<a class="btn" href="#applications/applied">See them</a>`, `<button class="btn primary big" data-primary data-act="closeQuiet" data-ids="${esc(JSON.stringify(l.map(q => q.id)))}">Close ${l.length === 1 ? 'it' : `all ${l.length}`} as No response${key('Enter')}</button>`)}</article>`;
  }
  if (x.kind === 'interview') {
    const i = x.i;
    return `<article class="card decision" data-kind="interview"><div class="dtop">${avatar(i.company || i.title)}<div class="grow"><p class="kicker">${where}</p><h2>${esc(i.company || i.title)}</h2>
        <div class="facts"><span><b>${esc(fmtWhen(i.start))}</b></span>${i.job_title ? `<span>${esc(i.job_title)}</span>` : ''}</div></div><span class="bigicon good">${svg('calendar')}</span></div>
      <div class="dbody"><div class="why"><b>Coming up</b>Job Hunt writes prep notes for each interview: likely questions, your stories that answer them, and what to ask.</div></div>
      ${dbar(`<a class="btn" href="#calendar">Calendar</a>`, i.job_id ? `<a class="btn primary big" data-primary href="#job/${encodeURIComponent(i.job_id)}" data-tab-to="interview">Prepare${key('Enter')}</a>` : '')}</article>`;
  }
  if (x.kind === 'held') {
    return `<article class="card decision" data-kind="held"><div class="dtop"><span class="bigicon">${svg('search')}</span><div class="grow"><p class="kicker">${where}</p><h2>${x.n} posting${x.n === 1 ? '' : 's'} found, not scored yet</h2>
        <div class="facts"><span>Job Hunt scores them newest first, a batch every 45 minutes.</span></div></div></div>
      <div class="dbody"><div class="why"><b>Or now</b>Scoring them all uses more of your Claude plan at once. The ones that clear your fit score come here to pick.</div></div>
      ${dbar('', `<button class="btn primary big" data-primary data-act="scoreHeld">Score them all now${key('Enter')}</button>`)}</article>`;
  }
  const h = x.h, bad = h.level === 'problem';
  return `<article class="card decision ${bad ? 'crit' : 'warn'}" data-kind="health"><div class="dtop"><span class="bigicon ${bad ? 'crit' : 'warn'}">!</span><div class="grow"><p class="kicker">${where}</p><h2>${bad ? 'Something needs fixing' : 'Worth a look'}</h2></div></div>
    <div class="dbody"><p class="lead">${esc(h.text)}</p><div id="healthIdeas" class="ideas"></div></div>
    ${dbar(h.action === 'removeBroken' ? `<button class="btn" data-act="removeBroken" data-boards="${esc(JSON.stringify(h.data))}">Remove ${h.data.length === 1 ? 'it' : 'them'}</button>` : '',
      `${h.action === 'removeBroken' ? `<button class="btn primary big" data-primary data-act="suggestBoards" data-into="healthIdeas">Suggest companies</button>` : ''}${h.fix ? `<button class="btn primary big" data-primary data-act="${esc(h.fix.act)}" data-task="${esc(h.fix.task)}">${esc(h.fix.label)}</button>` : ''}${h.link && h.link !== '#overview' ? `<a class="btn primary big" data-primary href="${esc(h.link)}">Fix it${key('Enter')}</a>` : ''}`)}</article>`;
}
/** A decision as one line of Up next. */
function queueMini(x) {
  const j = x.j;
  const name = j ? j.title : x.kind === 'interview' ? `Interview: ${x.i.company || x.i.title}` : x.kind === 'quiet' ? `${x.list.length} quiet for 4+ weeks` : x.kind === 'held' ? `${x.n} waiting to be scored` : x.h.level === 'problem' ? 'Something needs fixing' : 'Worth a look';
  const who = j ? j.company : x.kind === 'interview' ? fmtWhen(x.i.start) : '';
  const tile = j ? avatar(j.company) : x.kind === 'interview' ? avatar(x.i.company || x.i.title) : `<span class="avatar plain">${x.kind === 'health' ? '!' : svg(x.kind === 'held' ? 'search' : 'clock')}</span>`;
  return `<button type="button" class="mini" data-act="queueGo" data-id="${esc(x.id)}">${tile}<span class="grow"><b>${esc(name)}</b><span class="small muted">${esc(who)}${who ? ' · ' : ''}${QUEUE_KIND[x.kind]}</span></span>${j && j.score != null ? `<span class="score ${scoreBand(j.score_after ?? j.score)}" style="--p:${j.score_after ?? j.score}">${j.score_after ?? j.score}</span>` : ''}</button>`;
}

/** Queue: the next decision, in full, and what's behind it. The lists of jobs are in Pipeline. */
async function showOverview(arg) {
  arg = String(arg || '').split('/')[0]; // a step, perhaps with /list after it (see the route)
  // Just fetched (opening Job Hunt fetches it before drawing the page): no need to ask twice.
  // Going from tab to tab draws at once from what's here, and asks behind it whether anything
  // changed (the app answers only that when nothing did); the page is drawn again only if so.
  if (!overview) { overview = await api('/api/overview'); overviewAt = Date.now(); }
  else if (Date.now() - overviewAt > 1500) {
    const had = overview.rev, here = location.hash;
    overviewAt = Date.now();
    refreshOverview().then(() => { if (overview.rev !== had && location.hash === here && !pageDirty && !document.querySelector('.modal-back')) route(); });
  }
  renderNav();
  const o = overview;
  const setup = o.setup;
  const steps = [
    [setup.claude, setup.engine === 'api' ? 'Add your Claude API key' : 'Connect Claude Code', setup.engine === 'api' ? 'Needed to score jobs and tailor your CV.' : 'Uses Claude Code on this PC and your Claude subscription. No API key needed.', '#settings/connections'],
    [setup.cvs > 0 && !setup.cvs_missing.length, setup.cvs ? 'Your CVs' : 'Add your CV', setup.cvs ? (setup.cvs_missing.length ? `Missing a file: ${setup.cvs_missing.join(', ')}` : `${setup.cvs} CV${setup.cvs === 1 ? '' : 's'} ready.`) : 'Word, PDF or text. Add as many as you like.', '#cvs'],
    [setup.google, 'Connect Gmail and Calendar (optional)', 'For job email, replies and interview booking.', '#settings/connections', 'google'],
    [setup.adzuna, 'Add a job-search service (optional)', 'Google for Jobs listings from LinkedIn, Indeed, Glassdoor and more.', '#search/setup', 'search_service'],
  ].filter(st => !(st[4] && (setup.skipped || []).includes(st[4])));
  // Shown until the steps you need are done; optional ones can be put off with Not now.
  const showSteps = steps.some(s => !s[0]);
  const neededDone = steps.filter(s => !s[4]).every(s => s[0]); // Claude and a CV
  const searching = (o.running || []).includes('search');
  const side = o.side || {};
  const nextSearch = side.next_search ? new Date(side.next_search) : null;
  const googleOff = (setup.skipped || []).includes('google');
  const first = (o.name || '').split(' ')[0];
  // The queue, the step you're looking at, and the decision you're on.
  const all = queueItems(o);
  const step = FLOW.some(([id]) => id === arg) ? arg : '';
  const list = step ? all.filter(x => x.step === step) : all;
  if (list.length && list.every(x => queueSkipped.has(x.id))) list.forEach(x => queueSkipped.delete(x.id));
  const cur = list.find(x => x.id === queueAt) || list.find(x => !queueSkipped.has(x.id)) || list[0];
  if (cur) queueAt = cur.id;
  jobOrder = all.filter(x => x.j).map(x => x.j.id);
  // Every listing at once (the usual way), or one decision at a time.
  // Sent here from a link to one step's list: a list this once, whatever the view you keep.
  const view = /^#overview\/[a-z]+\/list$/.test(location.hash) ? 'list' : queueView();
  let listing = '';
  if (view === 'list' && all.length) {
    const tracked = ['waiting', 'interviews'].includes(step) ? (await kept('/api/tracker')).rows : [];
    const notes = step ? [] : all.filter(x => x.kind === 'health');
    const noteRow = x => `<div class="next-row ${x.h.level === 'problem' ? 'crit' : 'warn'}"><span class="next-n">!</span><span class="grow">${esc(x.h.text)}</span><span class="row next-act">
        ${x.h.action === 'removeBroken' ? `<button class="btn sm" data-act="removeBroken" data-boards="${esc(JSON.stringify(x.h.data))}">Remove ${x.h.data.length === 1 ? 'it' : 'them'}</button><button class="btn sm" data-act="suggestBoards" data-into="healthIdeas">Suggest companies</button>` : ''}
        ${x.h.fix ? `<button class="btn sm" data-act="${esc(x.h.fix.act)}" data-task="${esc(x.h.fix.task)}">${esc(x.h.fix.label)}</button>` : ''}${x.h.link && x.h.link !== '#overview' ? `<a class="btn sm" href="${esc(x.h.link)}">Fix it</a>` : ''}</span></div>`;
    // What's furthest along first, as in the one-by-one order; a step you chose shows all of itself.
    const order = step ? [step] : ['interviews', 'approve', 'submit', 'pick', 'waiting'].filter(s => all.some(x => x.step === s));
    const qopt = (v, n) => `<option value="${v}">${n}</option>`;
    const qbar = all.filter(x => x.j).length > 1 ? `<div class="queue-filters" data-queuebox>
        <label class="small">Sort by <select data-queuef="sort">${qopt('', 'Each step\'s own order')}${qopt('now', 'Best to apply to now')}${qopt('fit', 'Best fit')}${qopt('new', 'Newest')}${qopt('pay', 'Highest pay')}</select></label>
        <label class="check small"><input type="checkbox" data-queuef="pay"> Shows pay</label>
        <label class="check small"><input type="checkbox" data-queuef="flags"> No red flags</label>
        <span class="muted small" data-queuecount></span></div>` : '';
    listing = `${qbar}${notes.some(x => x.h.level === 'problem') ? `<section class="card next-card">${notes.filter(x => x.h.level === 'problem').map(noteRow).join('')}</section>` : ''}
      ${order.map(s => `${s === 'pick' ? heldLine() : ''}${stepHtml(o, s, s === step ? tracked : [])}`).join('')}
      ${notes.some(x => x.h.level !== 'problem') ? `<section class="card next-card">${notes.filter(x => x.h.level !== 'problem').map(noteRow).join('')}</section>` : ''}
      <div id="healthIdeas" class="ideas"></div>`;
    jobOrder = all.filter(x => x.j).map(x => x.j.id);
  }
  const rest = cur ? [...list.slice(list.indexOf(cur) + 1), ...list.slice(0, list.indexOf(cur))] : [];
  const tailoring = (o.to_tailor || []).length - (o.to_tailor || []).filter(j => !(o.running || []).includes(`tailor:${j.id}`)).length;
  const n = k => all.filter(x => x.step === k).length;
  const delta = o.this_week - o.last_week;
  const picks = n('pick');
  page(`<div class="head">
      <div class="grow">
        <div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${first ? ` · ${greeting()}, ${esc(first)}` : ''}</div>
        <h1>${queueCount(all) ? `${queueCount(all)} waiting for you` : all.length ? 'No decisions waiting' : neededDone ? 'Nothing needs you right now' : 'Let\'s get you set up'}</h1>
        ${neededDone ? `<p class="week-line"><span class="week-label">This week</span>
          <a href="#results" title="Applications sent this week${o.weekly_goal ? `, against your goal of ${o.weekly_goal}` : ''}${delta ? ` (${delta > 0 ? delta + ' more' : -delta + ' fewer'} than last week)` : ''}"><b>${o.this_week}</b>${o.weekly_goal ? ` of ${o.weekly_goal}` : ''} applied${delta ? ` <span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</span>` : ''}</a>
          <a href="#calendar" title="Interviews coming up"><b>${o.interviews.length}</b> interview${o.interviews.length === 1 ? '' : 's'}</a>
          <a href="#results" title="How many of your applications got a reply"><b>${pct(o.response_rate)}</b> replied</a></p>` : ''}
      </div>
      <div class="row head-acts">
        <a class="btn ghost" href="#add">${svg('add')}Add a job</a>
        ${setup.google ? `<button class="btn ghost mail-btn" data-act="run" data-task="inbox" title="Your job email was checked ${esc(ago(o.last_inbox))}. Press to check it now.">${svg('mail')}<span>${esc(ago(o.last_inbox))}</span></button>`
          : googleOff ? '' : `<a class="btn ghost mail-btn" href="#settings/connections" title="Gmail isn't connected: connect it and Job Hunt sorts your job email and drafts replies">${svg('mail')}<span>Connect email</span></a>`}
        ${searching ? searchCtl(o.progress)
          : `<span class="split"><button class="btn${all.length ? '' : ' primary'}" data-act="run" data-task="search" ${!o.setup?.cvs ? 'disabled title="Add your CV first"' : ''}>${svg('search')}Search for jobs now</button><details class="menu search-menu"><summary class="btn${all.length ? '' : ' primary'}${side.paused ? ' paused' : ''}" title="The last search, its results, and the daily search" aria-label="Search: results and schedule"><span class="caret">▾</span></summary><div class="menu-list right">
              <p class="menu-note"><b>Last search</b> ${o.last_search ? `${esc(ago(o.last_search))}${o.last_report ? `: ${o.last_report.new} new` : ''}` : 'not yet'}</p>
              <a href="#search">See what it found</a>
              <p class="menu-note"><b>${side.paused ? (side.paused === 'off' ? 'The daily search is off' : esc(pausedWords(side.paused))) : nextSearch ? `Next search ${esc(nextSearch.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : 'The next search is due now'}</b></p>
              ${side.paused ? '<button data-act="searchPause" data-days="0">Turn the daily search back on</button>' : ''}
              <button data-act="searchPause" data-days="1">Pause for a day</button><button data-act="searchPause" data-days="3">Pause for 3 days</button><button data-act="searchPause" data-days="7">Pause for a week</button>
              ${side.paused === 'off' ? '' : '<button data-act="searchPause" data-days="off">Turn the daily search off</button>'}
              <a href="#settings/search">When it searches, and how often</a>
            </div></details></span>`}
      </div>
    </div>
    ${neededDone || all.length ? queueTabs(step, view) : ''}
    ${syncNewerHtml(o.sync_newer)}
    ${showSteps && !neededDone ? `<section class="card"><header><h2>Finish setting up</h2><a class="btn ghost" href="#welcome">Guided setup</a></header><div class="steps">${steps.map(([done, t, d, href, key]) =>
      `<div class="step-wrap"><a class="step ${done ? 'done' : ''}" href="${href}"><span class="tick">${done ? '✓' : ''}</span><span><b>${esc(t)}</b><br><span class="muted small">${esc(d)}</span></span></a>${key && !done ? `<button class="btn ghost sm" data-act="setupSkip" data-what="${key}" title="Hide this step">Not now</button>` : ''}</div>`).join('')}</div></section>` : ''}
    ${inUseHtml(o.in_use)}
    ${o.progress ? progressHtml(o.progress) : ''}
    <div class="deck${!listing && rest.length ? '' : ' solo'}">
      <div class="deck-main">
        ${listing ? listing : cur ? decisionHtml(cur, list.indexOf(cur) + 1, list.length)
          : `<section class="card decision done"><div class="dtop"><span class="bigicon good">${svg('check')}</span><div class="grow"><p class="kicker">${step ? 'Nothing here' : neededDone ? 'All caught up' : 'Getting started'}</p>
              <h2>${step ? `No ${step === 'waiting' ? 'follow-ups' : `${FLOW.find(f => f[0] === step)[1].toLowerCase()} decisions`} waiting` : neededDone ? 'Your queue is empty' : 'Connect Claude and add your CV'}</h2>
              <div class="facts"><span>${!neededDone ? 'Then search for jobs: the ones that fit come here, one at a time.' : searching ? 'A search is running: new matches come here when it\'s done.' : side.paused ? `${esc(pausedWords(side.paused))}.` : nextSearch ? `Job Hunt searches again ${esc(nextSearch.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' }))}.` : 'Search for jobs to find new matches.'}</span></div></div></div></section>`}
        ${!listing && cur && cur.kind === 'pick' && picks > 3 ? `<p class="muted small deck-note">${picks} to pick from. Rather tick several at once? <a href="#" data-act="queueView" data-view="list">See them as a list</a>.</p>` : ''}
        ${tailoring ? `<p class="muted small deck-note"><span class="spin" data-kind="tailor+score" data-n="${Math.ceil(tailoring / 3)}"></span>Tailoring ${tailoring} application${tailoring === 1 ? '' : 's'}… they come back here to approve.</p>` : ''}
        ${titleIdeasHtml(o.title_ideas)}
        ${showSteps && neededDone && steps.some(st => st[4] && st[4] !== 'google' && !st[0]) ? `<section class="card optional-steps"><b>Optional:</b> ${steps.filter(st => st[4] && st[4] !== 'google' && !st[0]).map(([, t, d, href, key]) =>
          `<span class="opt"><a href="${href}" title="${esc(d)}">${esc(t.replace(' (optional)', ''))}</a><button class="btn ghost sm" data-act="setupSkip" data-what="${key}" title="Hide this">Not now</button></span>`).join('')}</section>` : ''}
      </div>
      ${!listing && rest.length ? `<aside class="deck-side"><h3>Up next</h3><div class="upnext">${rest.slice(0, 5).map(queueMini).join('')}${rest.length > 5 ? `<p class="muted small" style="margin:2px 4px">and ${rest.length - 5} more</p>` : ''}</div></aside>` : ''}
    </div>
    <details class="card activity" ${localStorage.getItem('jh.activityShut') === '1' ? '' : 'open'} data-keep="jh.activityShut"><summary><b>What Job Hunt did lately</b></summary>
      ${o.events.length ? `<div class="feed" style="margin-top:10px">${o.events.slice(0, 12).map(e => `<div><time title="${esc(new Date(e.created_at).toLocaleString())}">${esc(ago(e.created_at))}</time><span>${jobLink(e)}${eventText(e)}</span></div>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}
    </details>`);
  if (listing) { restorePickViews(); listHeads(); }
}

