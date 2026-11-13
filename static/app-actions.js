// Job Hunt screens, continued. What every button does, the forms, and starting up.
'use strict';

// ---- actions ----
async function act(el) {
  const a = el.dataset.act;
  const jobId = main().dataset.job;
  const busy = async (fn, done) => {
    el.disabled = true;
    try { await fn(); if (done) toast(done); } catch (e) { toast(e.message, true); } finally { el.disabled = false; }
  };
  if (a.startsWith('lead') || a === 'openUrl') return leadAct(el);
  if (a === 'updatedOk') { updated = null; $('#updatedBar')?.remove(); if (el.getAttribute('href')) location.hash = el.getAttribute('href'); return; }
  if (a === 'updateLater') { updateBarLater = update?.version || null; $('#updateBar')?.remove(); return; }
  if (a === 'updateCheck') {
    return busy(async () => {
      const u = await checkUpdate();
      if (!u.error && !u.available) toast("You're on the newest version.");
      showWhatsNew();
    });
  }
  if (a === 'updateInstall') {
    return busy(async () => {
      toast('Getting the update…');
      const before = settingsCache?.app?.version || (await api('/api/settings').catch(() => null))?.app?.version || '';
      const r = await api('/api/update/install', { method: 'POST' });
      if (r.waiting) {
        const what = (r.for || []).some(n => n === 'search') ? 'the job search' : 'the tailoring';
        toast(`Installing after ${what} finishes: Job Hunt restarts by itself then. Nothing is lost.`);
        document.querySelectorAll('[data-act=updateInstall]').forEach(b => { b.disabled = true; b.textContent = `Installs after ${what}`; });
      } else if (!r.installed) { toast("You're already on the newest version."); checkUpdate(); }
      else { toast('Installing the update… Job Hunt restarts by itself in a moment.'); waitForRestart(before); }
    });
  }
  if (a === 'addBoardLink') {
    const input = $('#boardLink');
    if (!input?.value.trim()) { toast('Paste the company\'s careers link first.', true); return; }
    toast('Finding its job board…');
    return busy(async () => {
      const KIND = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', smartrecruiters: 'SmartRecruiters', workable: 'Workable', bamboohr: 'BambooHR' };
      const r = await api('/api/settings/add-board-link', { method: 'POST', body: { url: input.value.trim() } });
      toast(r.new ? `Added: ${KIND[r.board] || r.board} “${r.name}”. The next search looks at its jobs.` : `${KIND[r.board] || r.board} “${r.name}” is already in your list.`);
      input.value = '';
      await reloadBoards();
    });
  }
  if (a === 'searchHold') {
    const on = el.dataset.on === '1';
    return busy(async () => {
      const r = await api('/api/search/hold', { method: 'POST', body: { on } });
      toast(!r.running ? 'No search is running.' : on ? 'Pausing the search after the step it\'s on. Resume carries on from there.' : 'Resuming the search.');
      await refreshOverview();
      const card = $('#progressCard');
      if (card && overview?.progress) card.outerHTML = progressHtml(overview.progress);
    });
  }
  if (a === 'searchStop') {
    return busy(async () => {
      const r = await api('/api/search/stop', { method: 'POST' });
      toast(r.stopping ? 'Stopping the search after the step it\'s on. What it found so far is kept.' : 'No search is running.');
      el.disabled = true;
      await refreshOverview();
      if (location.hash.startsWith('#search')) route();
    });
  }
  if (a === 'searchPause') {
    el.closest('details')?.removeAttribute('open');
    return busy(async () => {
      const days = el.dataset.days === 'off' ? 'off' : Number(el.dataset.days);
      const r = await api('/api/search/pause', { method: 'POST', body: { days } });
      toast(r.paused ? `${pausedWords(r.paused)}. You can still search by hand.` : 'The daily search is back on.');
      await refreshOverview();
      route();
    });
  }
  if (a === 'run') {
    return busy(async () => {
      const r = await api(`/api/run/${el.dataset.task}`, { method: 'POST' });
      toast(r.started ? (el.dataset.task.startsWith('search') ? (el.dataset.task === 'search-force' ? 'Searching and re-checking postings filtered out before…' : 'Searching for jobs. New matches appear as they are tailored.') : 'Checking your email…') : 'Already running.');
      await refreshOverview();
      if (location.hash === '' || location.hash.startsWith('#overview') || location.hash.startsWith('#search')) route();
    });
  }
  if (a === 'pickFolder') {
    const input = el.closest('form')?.elements[el.dataset.into];
    try {
      const r = await api('/api/pick-folder', { method: 'POST', body: { start: input?.value || '' } });
      if (r.path && input) { input.value = r.path; input.dispatchEvent(new Event('input', { bubbles: true })); }
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (a === 'closeQuiet') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    if (!await ask(`Close ${ids.length === 1 ? 'this application' : `these ${ids.length} applications`} as No response? They move to Finished; you can reopen any of them.`, 'Close them')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'no_response', note: 'no reply after 4+ weeks' } });
      await refreshOverview(); route();
    }, 'Closed. Your Tracker now shows only what\'s still live.');
  }
  if (a === 'placePick' || a === 'placeDrop' || a === 'placeAdd') {
    const box = el.closest('[data-places]');
    let list = placesOf(box);
    const add = x => { x = x.trim(); if (x && !list.some(y => y.toLowerCase() === x.toLowerCase())) list.push(x); };
    if (a === 'placePick') add(el.dataset.place);
    if (a === 'placeDrop') list = list.filter(y => y !== el.dataset.place);
    if (a === 'placeAdd') add(box.querySelector('.place-input').value);
    placesSet(box, list);
    return;
  }
  if (a === 'welcomeRecheck') { await refreshOverview(); route(); return; }
  if (a === 'welcomeSearch') {
    return busy(async () => { await api('/api/run/search', { method: 'POST' }); await refreshOverview(); location.hash = '#overview'; }, 'Searching for jobs. Matches come to your Queue.');
  }
  if (a === 'chgEdit' || a === 'chgCancel') {
    const row = el.closest('.chg-row');
    row.querySelector('.chg-form').hidden = a === 'chgCancel';
    row.querySelector('.now').hidden = a === 'chgEdit';
    row.querySelector('.chg-acts').hidden = a === 'chgEdit';
    if (a === 'chgEdit') row.querySelector('textarea').focus();
    return;
  }
  if (a === 'chgSave' || a === 'chgPutBack') {
    const c = changeList[Number(el.dataset.i)]; if (!c) return;
    const text = a === 'chgPutBack' ? c.before : el.closest('.chg-row').querySelector('textarea').value;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/cv-edit`, { method: 'POST', body: { current: c.after, text } });
      route();
    }, a === 'chgPutBack' ? 'Put back as in your CV. Undo is at the top of CV & letter.' : 'Saved in the tailored CV.');
  }
  if (a === 'ownOff') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/own-file-off`, { method: 'POST', body: { what: el.dataset.what } }); route(); }, 'Back to Job Hunt\'s version.');
  }
  if (a === 'srcSearch') return busy(() => searchSource(el.dataset.id));
  if (a === 'contactReplied') return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/contact-replied`, { method: 'POST', body: { index: Number(el.dataset.i) } }); await refreshOverview(); route(); });
  if (a === 'contactSent') return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/contact-sent`, { method: 'POST', body: { index: Number(el.dataset.i) } }); route(); }, 'Marked sent. Job Hunt reminds you once if there\'s no reply in a week.');
  if (a === 'srcFilter') {
    const tab = location.hash.split('/')[1] || '';
    const f = srcFilter[tab] || (srcFilter[tab] = { outcome: 'all', site: '' });
    if (el.dataset.outcome != null) f.outcome = el.dataset.outcome;
    if (el.dataset.site != null) { f.site = el.dataset.site; f.outcome = 'all'; }
    route(); return;
  }
  if (a === 'connTest') {
    const sites = el.dataset.id === 'agencies' ? document.querySelectorAll('#tile-agencies [name=site]:checked, #tile-agencies .site-own').length : 0;
    return busy(async () => { await api('/api/connections/test', { method: 'POST', body: { id: el.dataset.id } }); renderConnStatus(); },
      sites ? `Testing ${sites} site${sites === 1 ? '' : 's'}… each one's result shows here when it's through.` : 'Testing…');
  }
  if (a === 'connIndeed') {
    const on = el.dataset.on === '1';
    const id = el.dataset.id || 'indeed';
    const name = el.closest('.conn-row')?.querySelector('.conn-name b')?.textContent || { linkedin: 'LinkedIn', indeed: 'Indeed' }[id] || 'It';
    return busy(async () => { await api(`/api/connections/${encodeURIComponent(id)}`, { method: 'POST', body: { on } }); settingsCache = null; route(); }, on ? `${name} is on. The next search includes it.` : `${name} is off. Its settings stay saved; turn it back on here any time.`);
  }
  if (a === 'siteAdd') {
    const box = $('#ownSites'); if (!box) return;
    box.insertAdjacentHTML('beforeend', `<div class="row site-own"><input type="text" name="own_name" placeholder="Name" style="max-width:180px"><input type="text" name="own_url" placeholder="https://… with {title} and {place}" style="flex:1"><button class="btn ghost sm" type="button" data-act="siteDrop">Remove</button></div>`);
    box.lastElementChild.querySelector('[name=own_url]').focus();
    return;
  }
  if (a === 'siteDrop') { el.closest('.site-own')?.remove(); toast('Removed. Save to keep the change.'); return; }
  if (a === 'queueView') {
    try { localStorage.setItem('jh.queueView', el.dataset.view === 'one' ? 'one' : 'list'); } catch (e) { /* storage off: it stays a list */ }
    route(); return;
  }
  if (a === 'queueSkip' || a === 'queueGo') {
    // Leave this decision for now, or go to one of the next: nothing is changed, only what's shown.
    if (a === 'queueSkip') queueSkipped.add(queueAt);
    queueAt = a === 'queueGo' ? el.dataset.id : '';
    if (a === 'queueGo') queueSkipped.delete(el.dataset.id);
    route(); window.scrollTo(0, 0);
    return;
  }
  if (a === 'panelClose') return closePanel();
  // The phone's one theme button: Auto, then Light, then Dark, and round again.
  if (a === 'themeCycle') { const order = ['auto', 'light', 'dark']; setTheme(order[(order.indexOf(document.documentElement.dataset.theme || 'auto') + 1) % 3]); toast(`Appearance: ${MODES[document.documentElement.dataset.theme || 'auto'][0]}`); return; }
  if (a === 'moreMenu') { document.body.style.setProperty('--mtop-h', `${document.querySelector('.mtop')?.offsetHeight || 64}px`); document.body.classList.toggle('more-open'); const pop = $('#statusPop'); if (pop) pop.open = document.body.classList.contains('more-open'); renderNav(); return; }
  if (a === 'connGoto') {
    const id = CONN_HOME[el.dataset.to] || el.dataset.to, target = document.getElementById(id);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.querySelector('details')?.setAttribute('open', ''); return; }
    connScrollTo = id; location.hash = id.startsWith('tile-') ? '#search/setup' : '#settings/connections'; return;
  }
  if (a === 'applied') {
    const id = el.dataset.job;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'applied', note: 'submitted on the company site' } });
      await refreshOverview();
      toast('Marked applied. Job Hunt will remind you to follow up.');
      location.hash = '#overview';
    });
  }
  if (a === 'calMonth') {
    const d = Number(el.dataset.d), t = new Date();
    calMonth = d === 0 ? new Date(t.getFullYear(), t.getMonth(), 1) : new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1);
    route(); return;
  }
  if (a === 'calDay') {
    const box = document.getElementById(`day-${el.dataset.day}`);
    if (box) { const d = box.closest('details'); if (d) d.open = true; box.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    // Outside the list below: say what's on that day here.
    const items = [...el.querySelectorAll('.cal-e')].map(x => x.textContent.trim());
    toast(items.length ? items.join(' · ') : 'Nothing on that day.');
    return;
  }
  if (a === 'calAdd' || a === 'calNext') {
    const card = $('#calAddCard'); if (!card) return;
    card.hidden = a === 'calAdd' ? !card.hidden : false;
    if (el.dataset.job) {
      const sel = card.querySelector('[name=job_id]');
      // An application not in the list (an offer, say): add it, so the interview goes on the right one.
      if (![...sel.options].some(o => o.value === el.dataset.job)) sel.add(new Option(el.dataset.label || 'This application', el.dataset.job));
      sel.value = el.dataset.job;
    }
    if (!card.hidden) { card.scrollIntoView({ behavior: 'smooth' }); card.querySelector('[name=start]').focus(); }
    return;
  }
  if (a === 'calSync') {
    return busy(async () => {
      const r = await api('/api/calendar/sync', { method: 'POST', body: {} });
      const bits = [r.pushed && `${r.pushed} copied to Google`, r.moved && `${r.moved} moved`, r.removed && `${r.removed} removed`].filter(Boolean);
      route(); toast(bits.length ? `Synced: ${bits.join(', ')}.` : 'Synced. Nothing had changed.');
    });
  }
  if (a === 'calLink') {
    return busy(async () => { await api('/api/calendar/link', { method: 'POST', body: { event_id: el.dataset.id, job_id: el.dataset.job } }); route(); }, 'Linked. The application is now in Interviewing.');
  }
  if (a === 'calDelete') {
    if (!await ask('Remove this interview, with its prep time and reminders?', 'Remove', true)) return;
    return busy(async () => { await api('/api/calendar/delete', { method: 'POST', body: { id: el.dataset.id } }); route(); }, 'Removed.');
  }
  if (a === 'docFilter') { docFilter = el.dataset.f; route(); return; }
  if (a === 'pickTop') {
    const box = el.closest('[data-pickbox]');
    const all = [...box.querySelectorAll('.jrow:not([hidden]) [data-pick]')];
    const top = new Set(all.slice(0, Number(el.dataset.n)));
    all.forEach(c => { c.checked = top.has(c); });
    pickChanged(box);
    return;
  }
  if (a === 'pickShowAll') {
    const box = el.closest('[data-pickbox]');
    box.querySelectorAll('[data-pickf]').forEach(f => { if (f.type === 'checkbox') f.checked = false; else if (f.dataset.pickf !== 'sort') f.value = f.querySelector('option')?.value ?? ''; });
    applyPickView(box);
    return;
  }
  if (a === 'pickAll') {
    const box = el.closest('[data-pickbox]');
    const all = [...box.querySelectorAll('.jrow:not([hidden]) [data-pick]')];
    const on = !all.every(c => c.checked);
    all.forEach(c => { c.checked = on; });
    pickChanged(box);
    return;
  }
  if (a === 'tailorPicked') {
    const box = el.closest('[data-pickbox]');
    const ids = el.dataset.job ? [el.dataset.job] : [...box.querySelectorAll('[data-pick]:checked')].map(c => c.dataset.pick);
    if (!ids.length) return;
    return busy(async () => {
      const r = await api('/api/tailor', { method: 'POST', body: { ids } });
      if (r.deferred) { toast(`${r.deferred} See Settings → Accounts → Claude usage to run it now.`); await refreshOverview(); route(); return; }
      toast(`Tailoring ${r.started} application${r.started === 1 ? '' : 's'}. ${r.started === 1 ? 'It appears' : 'They appear'} under Ready to approve when done.`);
      await refreshOverview(); route();
    });
  }
  if (a === 'approveAll') {
    const box = el.closest('[data-approvebox]');
    const all = [...box.querySelectorAll('[data-appr]')];
    const on = !all.every(c => c.checked);
    all.forEach(c => { c.checked = on; });
    approveChanged(box);
    return;
  }
  if (a === 'approvePicked') {
    const picked = [...el.closest('[data-approvebox]').querySelectorAll('[data-appr]:checked')];
    if (!picked.length) return;
    const emails = picked.filter(c => c.dataset.email).length;
    if (!await ask(`Approve ${picked.length} application${picked.length === 1 ? '' : 's'}?${emails ? ` ${emails === 1 ? 'One applies' : `${emails} apply`} by email: the tailored CV and cover letter go out from your Gmail now.` : ''} The rest wait under Submit for you to apply on the company's site.`)) return;
    return busy(async () => {
      let sent = 0, approved = 0;
      const failed = [];
      for (const c of picked) {
        try {
          const r = await api(`/api/jobs/${encodeURIComponent(c.dataset.appr)}/approve`, { method: 'POST' });
          if (r.outcome === 'applied') sent++; else approved++;
        } catch (e) { failed.push(e.message || String(e)); }
      }
      await refreshOverview();
      toast([approved ? `${approved} approved: submit ${approved === 1 ? 'it' : 'them'} under Submit.` : '', sent ? `${sent} sent by email.` : '', failed.length ? `${failed.length} didn't go: ${failed[0]}` : ''].filter(Boolean).join(' '));
      location.hash = approved ? '#overview/submit' : '#overview/approve';
      route();
    });
  }
  if (a === 'approve') {
    if (el.dataset.email && !await ask(`Send your tailored CV and cover letter to ${el.dataset.email} from your Gmail?`)) return;
    return busy(async () => {
      const id = el.dataset.job || jobId;
      const r = await api(`/api/jobs/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      await refreshOverview();
      if (r.outcome === 'applied') { toast('Sent. Marked as applied.'); route(); }
      else if (!await applyNow(id)) { jobTabs[id] = 'apply'; if (location.hash === `#job/${encodeURIComponent(id)}`) route(); else location.hash = `#job/${encodeURIComponent(id)}`; }
      else route();
    });
  }
  if (a === 'syncResume') {
    return busy(async () => { await api('/api/sync/resume', { method: 'POST' }); await refreshOverview(); route(); }, 'Switching back here… when the other computer\'s data arrives, Continue from it in the Queue.');
  }
  if (a === 'syncContinue') {
    if (!await ask('Continue from the other computer\'s data? Job Hunt restarts with it.')) return;
    return busy(async () => { await api('/api/sync/continue', { method: 'POST', body: { folder: el.dataset.folder } }); toast('Continuing… Job Hunt restarts in a moment.'); setTimeout(() => location.reload(), 6000); });
  }
  if (a === 'syncDecline') {
    if (!await ask('Keep this computer\'s data? The next sync replaces the other computer\'s copy with this one.')) return;
    return busy(async () => { await api('/api/sync/decline', { method: 'POST', body: { saved_at: el.dataset.saved } }); await refreshOverview(); route(); }, 'Keeping this computer\'s data.');
  }
  if (a === 'syncNow') return busy(async () => { await api('/api/sync/now', { method: 'POST' }); route(); }, 'Synced.');
  if (a === 'takeOver') {
    if (!await ask('Take over here? The other computer saves its latest data and stops, then this one offers to continue from it.')) return;
    return busy(async () => { const r = await api('/api/sync/takeover', { method: 'POST' }); toast(`Asked ${r.from} to hand over. This takes a few minutes.`); await refreshOverview(); route(); });
  }
  if (a === 'testSources') return busy(() => showSourceTest(true));
  if (a === 'answers') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/answers`, { method: 'POST', body: { questions: $('#questions').value } }); setTimeout(route, 300); }, 'Writing answers…');
  }
  if (a === 'offerAdvice') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/offer`, { method: 'POST', body: { offer: $('#offerText').value } }); setTimeout(route, 300); }, 'Weighing the offer…');
  }
  if (a === 'palette') return jobPalette();
  if (a === 'pickClear' || a === 'approveClear') {
    const box = el.closest('[data-pickbox], [data-approvebox]');
    box.querySelectorAll('[data-pick]:checked, [data-appr]:checked').forEach(c => { c.checked = false; });
    return a === 'pickClear' ? pickChanged(box) : approveChanged(box);
  }
  if (a === 'pickStale') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    if (!ids.length || !await ask(`Set aside ${ids.length === 1 ? 'the one posting' : `the ${ids.length} postings`} that ${ids.length === 1 ? 'has' : 'have'} been up for more than three weeks or expired? ${ids.length === 1 ? 'It goes' : 'They go'} to All jobs under the stage Not interested, where you can still tailor ${ids.length === 1 ? 'it' : 'any of them'}. It doesn't change how Job Hunt scores.`, 'Set them aside')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'dismissed', note: 'older than three weeks', learn: false } });
      await refreshOverview(); route(); toast(`${ids.length} set aside.`);
    });
  }
  if (a === 'dismissPicked') {
    const ids = [...el.closest('[data-pickbox]').querySelectorAll('[data-pick]:checked')].map(c => c.dataset.pick);
    // Set aside without changing how Job Hunt scores: to teach it, use Not interested on one job
    // and choose "and learn from it".
    const learn = false;
    if (!ids.length || !await ask(`Not interested in ${ids.length === 1 ? 'this one' : `these ${ids.length}`}? ${ids.length === 1 ? 'It goes' : 'They go'} to All jobs under Not interested. It doesn't change how Job Hunt scores.`, 'Not interested')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: 'dismissed', note: '', learn } });
      await refreshOverview(); route(); toast(`${ids.length} set aside as not interested.`);
    });
  }
  if (a === 'resultsDays') {
    resultsDays = Number(el.dataset.days);
    try { localStorage.setItem('jh.resultsDays', String(resultsDays)); } catch (e) {}
    return route();
  }
  if (a === 'chatSend') {
    const msg = $('#chatMsg').value.trim();
    if (!msg) { toast('Write a message first.', true); return; }
    jobTabs[jobId] = 'chat';
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/chat`, { method: 'POST', body: { message: msg } }); setTimeout(route, 300); });
  }
  // A mock interview, in the job's own chat: Claude asks, you answer, it says how the answer landed.
  if (a === 'practise') {
    jobTabs[jobId] = 'chat';
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/chat`, { method: 'POST', body: { message: "Let's practise my interview for this role. You play the interviewer. Ask one question at a time, the kind this company would really ask for this role, and wait for my answer. After each answer, say in two or three plain sentences what worked and what to change, then ask the next question. Start with the first question now." } });
      setTimeout(route, 300);
    }, 'Starting the practice…');
  }
  if (a === 'chatClear') {
    if (!await ask('Start the conversation over? This one is deleted.')) return;
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/chat`, { method: 'POST', body: { clear: true } }); route(); });
  }
  if (a === 'forgetNetwork') {
    if (!await ask('Remove your LinkedIn connections from Job Hunt?')) return;
    return busy(async () => { await api('/api/network/forget', { method: 'POST' }); route(); }, 'Removed.');
  }
  if (a === 'askReferral') {
    const list = JSON.parse(main().dataset.contacts || '[]');
    const p = JSON.parse(el.dataset.person);
    let i = list.findIndex(c => c.name === p.name);
    if (i < 0) {
      list.push({ name: p.name, role: p.position || '', email: p.email || '', link: p.link || '', note: 'A LinkedIn connection of mine who works there. Ask, warmly and briefly, whether they would refer me or pass my CV to the hiring manager, and offer to send the posting and my CV.' });
      i = list.length - 1;
    }
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, { method: 'POST', body: { contacts: list } });
      await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: i } });
      setTimeout(route, 300);
    }, `Writing to ${firstName(p.name)}…`);
  }
  if (a === 'outreach') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: Number(el.dataset.i) } }); setTimeout(route, 300); }, 'Writing the message…');
  }
  // A note to the recruiter, with no name needed: added as a contact, then written.
  if (a === 'findPeople') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/find-people`, { method: 'POST' }); setTimeout(route, 300); },
      'Looking on LinkedIn for the recruiter, then writing the note. This takes a minute or two.');
  }
  if (a === 'noteRecruiter') {
    const list = JSON.parse(main().dataset.contacts || '[]');
    const name = el.dataset.name;
    list.push({ name: name || 'Recruiter', role: 'Recruiter', email: el.dataset.email || '', link: '', note: name ? '' : 'Name not known yet: greet them without a name ("Hello,"), never "Dear Recruiter".' });
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, { method: 'POST', body: { contacts: list } });
      await api(`/api/jobs/${encodeURIComponent(jobId)}/outreach`, { method: 'POST', body: { index: list.length - 1 } });
      setTimeout(route, 300);
    }, 'Writing the note…');
  }
  if (a === 'addContact' || a === 'removeContact') {
    const list = JSON.parse(main().dataset.contacts || '[]');
    if (a === 'addContact') {
      const name = $('#cName').value.trim(), extra = $('#cEmail').value.trim();
      if (!name) { toast('Add their name.', true); return; }
      list.push({ name, role: $('#cRole').value.trim(), email: extra.includes('@') && !extra.startsWith('http') ? extra : '', link: extra.startsWith('http') ? extra : '' });
    } else list.splice(Number(el.dataset.i), 1);
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/contacts`, { method: 'POST', body: { contacts: list } }); route(); });
  }
  if (a === 'coachRun') {
    return busy(async () => { const r = await api('/api/coach/run', { method: 'POST' }); if (!r.started) toast('Your coach is already thinking, or Claude isn\'t connected.'); route(); }, 'Your coach is looking at the skills you\'re missing. This takes a minute or two.');
  }
  if (a === 'titleIdea') {
    const add = !!el.dataset.add;
    return busy(async () => {
      await api('/api/titles/idea', { method: 'POST', body: { title: el.dataset.title, add } });
      settingsCache = null; await refreshOverview(); route();
      toast(add ? `Added “${el.dataset.title}”. The next search looks for it.` : 'Dropped.');
    });
  }
  if (a === 'useHours') { const f = el.closest('form') || document; const h1 = f.querySelector('[name=search_hour]'), h2 = f.querySelector('[name=search_hour_2]'); if (h2) h2.value = el.dataset.b; if (h1) { h1.value = el.dataset.a; h1.dispatchEvent(new Event('change', { bubbles: true })); } return; }
  if (a === 'careerJump') { document.getElementById(`path-${el.dataset.i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (a === 'career') {
    const here = location.hash;
    return busy(async () => { await api('/api/results/career', { method: 'POST' }); settingsCache = null; route(); watchCareer(here); }, 'Claude is thinking about your career options. This takes a minute or two.');
  }
  if (a === 'choosePath') return busy(() => savePath(el.dataset.title || ''));
  // Several paths can be kept open: one is added to the list, or taken off it.
  if (a === 'addPath' || a === 'dropPath') return busy(async () => { const now = pathList((settingsCache || await api('/api/settings')).profile?.wants?.path), t = el.dataset.title || ''; return savePath(a === 'addPath' ? [...now, t] : now.filter(x => x.toLowerCase() !== t.toLowerCase())); });
  if (a === 'addTitles') {
    const titles = JSON.parse(el.dataset.titles || '[]');
    const sel = document.querySelector(`[data-path-track="${el.dataset.i}"]`);
    return busy(async () => {
      const track = sel ? sel.value : (settingsCache || await api('/api/settings')).profile.tracks[0].name;
      const x = await api('/api/results/add-titles', { method: 'POST', body: { track, titles } }); settingsCache = null; route(); toast(x.added ? `Added ${x.added} title${x.added === 1 ? '' : 's'}. The next search looks for them.` : 'Those titles are already in your search.'); });
  }
  if (a === 'bankAdd') {
    const list = $('#bankCard .bank') || (() => { $('#bankCard .empty')?.remove(); const d = document.createElement('div'); d.className = 'bank'; $('#bankCard .row').before(d); return d; })();
    list.insertAdjacentHTML('beforeend', `<div class="bank-row"><input type="text" class="bank-q" placeholder="The question, as forms ask it" aria-label="Question"><input type="text" class="bank-a" placeholder="Your answer" aria-label="Your answer"><span></span><span></span></div>`);
    if (!$('#bankCard [data-act=bankSave]')) $('#bankCard .row').insertAdjacentHTML('beforeend', '<button class="btn primary" data-act="bankSave">Save changes</button>');
    list.lastElementChild.querySelector('input').focus();
    return;
  }
  if (a === 'bankSave' || a === 'bankDrop') {
    const rows = bankRows().filter((_, i) => a !== 'bankDrop' || i !== Number(el.dataset.i));
    return busy(async () => { await api('/api/answer-bank', { method: 'POST', body: { answers: rows } }); renderBank(); }, a === 'bankDrop' ? 'Forgotten.' : 'Saved.');
  }
  if (a === 'rescanSalaries') {
    return busy(async () => { const r = await api('/api/salaries/rescan', { method: 'POST' }); if (!r.started) toast('Already looking.'); },
      'Looking for the pay of every posting without one: its text, its page and the company\'s own posting. A notice says what was found.');
  }
  if (a === 'saveCompanyNotes') {
    return busy(async () => { await api('/api/company-notes', { method: 'POST', body: { company: el.dataset.company, notes: $('#companyNotes').value } }); }, 'Saved. They show on every role at this company.');
  }
  if (a === 'reuseCv') {
    if (!await ask('Use the CV you sent this company before, word for word? Undo puts this one back.', 'Use it')) return;
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/reuse-cv`, { method: 'POST' }); route(); }, 'Now the same CV as before. Undo last CV change puts this one back.');
  }
  if (a === 'revisionSeen') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/revision-seen`, { method: 'POST' }); route(); });
  }
  if (a === 'appliedAll') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    if (!await ask(`Mark all ${ids.length} as applied?`, 'Mark them applied')) return;
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/submitted`, { method: 'POST' });
      await refreshOverview(); route();
    }, `Marked ${ids.length} as applied. Job Hunt reminds you to follow up on each.`);
  }
  if (a === 'applyAll') { applyRun = { list: JSON.parse(el.dataset.ids || '[]'), at: 0, done: 0 }; return runOpen(); }
  if (a === 'runApplied') {
    const cur = applyRun?.list[applyRun.at];
    if (!cur) return;
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(cur.id)}/submitted`, { method: 'POST' }); applyRun.done++; applyRun.at++; await runOpen(); refreshOverview().then(() => { if (/^#(overview|applications)/.test(location.hash)) route(); }); });
  }
  if (a === 'runSkip') { if (applyRun) { applyRun.at++; return runOpen(); } return; }
  if (a === 'runAgain') { if (applyRun) return runOpen(); return; }
  if (a === 'queueFClear') { document.querySelectorAll('[data-queuef]').forEach(c => { if (c.type === 'checkbox') c.checked = false; }); return applyQueueView(false); }
  if (a === 'versionInfo') {
    // What's new, in Settings, App: there once the page has drawn.
    document.body.classList.remove('more-open');
    location.hash = '#settings/app';
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 150)); const box = $('#whatsnew'); if (box) { box.scrollIntoView({ block: 'start' }); break; } }
    return;
  }
  if (a === 'runStop') { applyRun = null; return runBar(); }
  if (a === 'fillBrowser') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/fill-browser`, { method: 'POST' });
      await api('/api/open-url', { method: 'POST', body: { url: r.url } });
      refreshOverview();
    }, 'Opened in your browser. On the form, click the Job Hunt extension and press Fill this form.');
  }
  if (a === 'askRecruiter') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/ask-recruiter`, { method: 'POST' });
      await refreshOverview(); route();
      toast(r.drafted ? `The email to ${r.name} is in your Gmail drafts. Read it over, then send it.` : `Written: it's on the application's Apply tab under People, to copy into an email to ${r.to}.`);
    }, `Writing to ${el.dataset.name || 'them'}…`);
  }
  if (a === 'recruiterScan') {
    return busy(async () => { const r = await api('/api/recruiters/scan', { method: 'POST' }); toast(r.started === false ? 'Already looking.' : 'Looking through your email for recruiters. A notice comes when it\'s done, in a few minutes.'); setTimeout(() => { if (['#recruiters', '#inbox/recruiters'].includes(location.hash)) route(); }, 4000); });
  }
  if (a === 'recruiterNew') { const f = $('#recruiterNew'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('[name=name]').focus(); return; }
  if (a === 'recruiterEdit') { const f = el.closest('.rec')?.querySelector('.rec-edit'); if (f) f.hidden = !f.hidden; return; }
  if (a === 'recruiterHide') {
    return busy(async () => { await api('/api/recruiters/hide', { method: 'POST', body: { email: el.dataset.email, hidden: el.dataset.hidden === '1' } }); route(); });
  }
  if (a === 'weeklyNow') {
    return busy(async () => { const r = await api('/api/weekly/send', { method: 'POST' }); toast(r.emailed ? 'Sent. Check your inbox.' : 'Sent as a notice. Connect Gmail and tick the email option to get the whole review by email.'); });
  }
  if (a === 'runHeld') {
    return busy(async () => { await api('/api/usage/run-held', { method: 'POST' }); renderUsage(); refreshOverview(); }, 'Started.');
  }
  if (a === 'clearHeld') {
    return busy(async () => { await api('/api/usage/clear-held', { method: 'POST' }); renderUsage(); refreshOverview(); }, 'Cancelled.');
  }
  if (a === 'lessons') {
    return busy(async () => { await api('/api/results/lessons', { method: 'POST' }); route(); setTimeout(() => { if (location.hash === '#results') route(); }, 20000); }, 'Claude is reading your rejections…');
  }
  if (a === 'insights') {
    return busy(async () => { await api('/api/results/insights', { method: 'POST' }); route(); setTimeout(() => { if (location.hash === '#results') route(); }, 30000); }, 'Claude is looking at your results. This takes a minute.');
  }
  if (a === 'copyPhone') {
    const st = await api('/api/settings');
    try { await navigator.clipboard.writeText(phoneBookmark(st)); toast('Copied. Send it to your phone and paste it as a bookmark\'s address.'); } catch (e) { toast('Couldn\'t copy.', true); }
    return;
  }
  if (a === 'scoreHeld') {
    if (!confirm('Score every waiting posting now? It uses your Claude plan (about one request per posting, in batches of 25), and stops at its usage limit; the rest then wait for the usual batches.')) return;
    return busy(async () => { await api('/api/run/score-held', { method: 'POST' }); refreshOverview(); }, 'Scoring them all: matches show up under Pick as they come in.');
  }
  if (a === 'copyShare') {
    const st = await api('/api/settings');
    try { await navigator.clipboard.writeText(`${st.phone_url}/m/add?k=${encodeURIComponent(st.ext_key)}&u=`); toast('Copied. Send it to your phone for the shortcut.'); } catch (e) { toast('Couldn\'t copy.', true); }
    return;
  }
  if (a === 'phoneTailscale') return busy(async () => { await api('/api/phone', { method: 'POST', body: { action: 'tailscale' } }); route(); }, 'Set up: Job Hunt can be reached from your phone through Tailscale.');
  if (a === 'phoneSave') return busy(async () => { await api('/api/phone', { method: 'POST', body: { url: $('#phoneUrl').value } }); route(); }, 'Saved.');
  if (a === 'phoneReset') return busy(async () => { await api('/api/phone', { method: 'POST', body: { url: '' } }); route(); });
  if (a === 'copyBookmarklet') {
    try { await navigator.clipboard.writeText(bookmarklet()); toast('Copied. Paste it as the URL of a new bookmark.'); } catch (e) { toast('Couldn\'t copy. Drag the blue button to your bookmarks bar instead.', true); }
    return;
  }
  if (a === 'addClaudeDesktop') {
    return busy(async () => { await api('/api/settings/claude-desktop', { method: 'POST' }); route(); }, 'Added. Quit Claude Desktop fully and open it again.');
  }
  if (a === 'phone') return busy(async () => { await api('/api/settings/phone', { method: 'POST', body: { on: el.dataset.on === '1' } }); route(); }, el.dataset.on === '1' ? 'Turned on. Now subscribe on your phone.' : 'Turned off.');
  if (a === 'phoneTest') return busy(() => api('/api/settings/phone-test', { method: 'POST' }), 'Sent. It should be on your phone now.');
  if (a === 'otherModels') {
    const form = el.closest('form'), f = form.elements;
    return busy(async () => {
      const r = await api('/api/settings/other/models', { method: 'POST', body: { url: f.service.value || f.url.value, key: f.key.value } });
      const had = f.model.value;
      f.model.innerHTML = r.models.length ? r.models.map(m => `<option ${m === had ? 'selected' : ''}>${esc(m)}</option>`).join('') : '<option value="">It lists no models</option>';
      toast(r.models.length ? `It answered: ${r.models.length} model${r.models.length === 1 ? '' : 's'}. Choose one, then Save.` : 'It answered, but lists no models.');
    }, 'Checking…');
  }
  if (a === 'otherForget') {
    if (!await ask('Remove the other AI and its key? Claude does everything again.', 'Remove it')) return;
    return busy(async () => { await api('/api/settings/other', { method: 'POST', body: { forget: true } }); toast('Removed.'); route(); });
  }
  if (a === 'gapsAdd') {
    const have = [...el.closest('[data-gaps]').querySelectorAll('input:checked')].map(c => c.value);
    if (!have.length) return toast('Tick the keywords you really have first.', true);
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/revise`, { method: 'POST', body: { what: 'cv', note: `I do have real experience with each of these, though my CV doesn't say so: ${have.join(', ')}. Work each one into the CV where it honestly fits, in the posting's own wording. Change nothing else.` } });
      await refreshOverview(); setTimeout(route, 300);
    }, 'Working them in…');
  }
  if (a === 'revise') {
    const what = $('#reviseWhat').value, note = $('#reviseNote').value.trim();
    if (!note) { toast('Say what to change first.', true); return; }
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/revise`, { method: 'POST', body: { what, note } }); await refreshOverview(); setTimeout(route, 300); }, 'Making the change…');
  }
  if (a === 'undoRevision') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/undo`, { method: 'POST', body: { what: el.dataset.what } }); route(); }, 'Put back as it was.');
  }
  if (a === 'emailReply') {
    return busy(async () => { await api(`/api/emails/${encodeURIComponent(t.dataset.id)}/reply`, { method: 'POST' }); toast('The reply is in your Gmail drafts, in that email\'s thread. Read it, change what you like, and send it from Gmail.'); route(); }, 'Writing the reply…');
  }
  if (a === 'seen') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/seen`, { method: 'POST', body: { what: t.dataset.what } }); await refreshOverview(); route(); });
  }
  if (a === 'review' || a === 'reviewFix') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/review`, { method: 'POST', body: { fix: a === 'reviewFix' } }); setTimeout(route, 300); }, a === 'reviewFix' ? 'Rewording, then checking again…' : 'Checking your CV…');
  }
  if (a === 'decline') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/decline`, { method: 'POST' }); setTimeout(route, 300); }, 'Writing the reply…');
  }
  if (a === 'thanks') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/thanks`, { method: 'POST' }); setTimeout(route, 300); }, 'Writing the thank-you note…');
  }
  if (a === 'followUpAll') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    return busy(async () => {
      for (const id of ids) await api(`/api/jobs/${encodeURIComponent(id)}/followup`, { method: 'POST' });
      document.querySelectorAll('[data-act=followUp]').forEach(b => { if (ids.includes(b.dataset.job)) b.outerHTML = '<span class="muted small"><span class="spin" data-kind="followup"></span>Writing…</span>'; });
      el.remove();
    }, `Writing ${ids.length} follow-ups. Read each one before you send it.`);
  }
  if (a === 'followUp') {
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/followup`, { method: 'POST' });
      if (location.hash.startsWith('#job/')) setTimeout(route, 300);
      else el.outerHTML = '<span class="muted small"><span class="spin" data-kind="followup"></span>Writing…</span>';
    }, 'Writing the follow-up…');
  }
  if (a === 'bookmarkSetup') {
    return busy(async () => { await api('/api/bookmark-page', { method: 'POST', body: { html: await bookmarkPage() } }); }, 'The setup page opened in your browser.');
  }
  if (a === 'copyText') {
    try { await navigator.clipboard.writeText(el.dataset.text || ''); toast('Copied.'); } catch (e) { toast('Select the text and copy it.', true); }
    return;
  }
  if (a === 'copyOpen') {
    const text = $(`#${el.dataset.from}`)?.textContent || '';
    try { await navigator.clipboard.writeText(text); } catch (e) { return toast('Select the note and copy it, then open their profile.', true); }
    return api('/api/open-url', { method: 'POST', body: { url: el.dataset.url } }).then(() => toast('Copied. On their profile: Connect, Add a note, paste, Send. Then press I sent it here.')).catch(e => toast(e.message, true));
  }
  if (a === 'copy') {
    const text = $(`#${el.dataset.from}`)?.textContent || '';
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Select the text and copy it.', true); }
    return;
  }
  if (a === 'useDrive') { const f = el.closest('form'); f.elements.dir.value = el.dataset.path; return; }
  if (a === 'backupNow') {
    return busy(async () => { const r = await api('/api/backup/now', { method: 'POST' }); toast(`Backed up: ${r.file}`); route(); });
  }
  if (a === 'suggestBoards') {
    // The list appears in the box named by data-into (or the one in this card).
    const box = (el.dataset.into && document.getElementById(el.dataset.into)) || el.closest('section')?.querySelector('.ideas') || $('#boardIdeas');
    return busy(async () => {
      box.innerHTML = '<p class="muted small"><span class="spin" data-kind="employers"></span>Claude is picking employers near you, and Job Hunt is checking each one\'s job board. This takes a minute or two…</p>';
      try {
        const { boards } = await api('/api/settings/suggest-boards', { method: 'POST' });
        box.dataset.ideas = JSON.stringify(boards);
        box.innerHTML = boards.length ? `<div class="card ideas-card">
          <p><b>${boards.length} employers with live job boards.</b> The ones with matching jobs are ticked.</p>
          <table><thead><tr><th>Company</th><th>Job board</th><th>Matching jobs</th></tr></thead><tbody>${boards.map((b, i) => `<tr><td data-v="${esc(b.company.toLowerCase())}"><label class="check"><input type="checkbox" data-idea="${i}" ${b.matching ? 'checked' : ''}> ${esc(b.company)}</label></td>
            <td class="small muted">${esc(b.board)}</td><td class="small" data-v="${b.matching}">${b.matching} of ${b.jobs} jobs match</td></tr>`).join('')}</tbody></table>
          <div class="row"><button class="btn primary" type="button" data-act="addIdeas">Add ticked and search</button></div></div>`
          : '<p class="muted">None of the suggested employers had a live job board this time. Try again later, or add companies yourself in Search → Set up sources → Company job boards.</p>';
      } catch (e) { box.innerHTML = ''; throw e; }
    });
  }
  if (a === 'addIdeas') {
    const box = el.closest('[data-ideas]');
    const boards = JSON.parse(box?.dataset.ideas || '[]');
    const pick = [...box.querySelectorAll('[data-idea]:checked')].map(c => boards[Number(c.dataset.idea)]);
    if (!pick.length) { toast('Tick at least one.', true); return; }
    return busy(async () => {
      const r = await api('/api/settings/add-boards', { method: 'POST', body: { boards: pick } });
      await api('/api/run/search', { method: 'POST' });
      toast(`Added ${r.added} job board${r.added === 1 ? '' : 's'}. Searching them now.`);
      await refreshOverview(); route();
    });
  }
  if (a === 'sitesOff') {
    const ids = JSON.parse(el.dataset.ids || '[]');
    return busy(async () => {
      await api('/api/settings/sites-off', { method: 'POST', body: { ids } });
      settingsCache = null; await refreshOverview(); route();
    }, `Turned off ${ids.length} site${ids.length === 1 ? '' : 's'} that couldn't be read. Turn any back on in Search → Set up sources.`);
  }
  if (a === 'removeBroken' || a === 'removeBoard') {
    const boards = a === 'removeBoard' ? [{ source: el.dataset.source, name: el.dataset.name }] : JSON.parse(el.dataset.boards || '[]');
    return busy(async () => {
      const r = await api('/api/settings/remove-boards', { method: 'POST', body: { boards } });
      toast(`Removed ${r.removed} board${r.removed === 1 ? '' : 's'}.`);
      if (a === 'removeBoard') { el.closest('tr').remove(); await reloadBoards(); } else { await refreshOverview(); route(); }
    });
  }
  if (a === 'tailorAnyway') {
    const id = el.dataset.job;
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(id)}/tailor`, { method: 'POST', body: { track: '' } });
      toast('Tailoring your CV and a cover letter for it. It appears under Ready to approve and on the Tracker.');
      await refreshOverview(); setTimeout(route, 300);
    });
  }
  // The update after a new CV: stop it (it finishes the request it's on), or close its card.
  if (a === 'cvUpdateStop' || a === 'cvUpdateClose') {
    el.disabled = true;
    try {
      await api('/api/cv-update', { method: 'POST', body: { forget: a === 'cvUpdateClose' } });
      const st = await api('/api/settings');
      const box = document.getElementById('cvUpdate');
      if (box) box.innerHTML = cvUpdateHtml(st.cv_update);
      if (a === 'cvUpdateStop') { toast('Stopping: it finishes what it is on and starts nothing more.'); watchCvUpdate(); }
    } catch (err) { el.disabled = false; toast(err.message, true); }
    return;
  }
  if (a === 'rescore') {
    const group = el.dataset.group;
    const plan = await api(`/api/rescore?group=${group}`).catch(e => { toast(e.message, true); return null; });
    if (!plan) return;
    if (plan.running) { toast('Postings are being scored again already.'); return; }
    if (!plan.postings) { toast('Nothing to score again.'); return; }
    const r = await dialog({
      title: `Score ${plan.postings} posting${plan.postings === 1 ? '' : 's'} again?`,
      text: `Against your CVs and settings as they are now. ${plan.filtered ? `${plan.filtered} no longer pass your filters (no Claude needed). ` : ''}${plan.to_score} need Claude: ${plan.this_run} now${plan.to_score > plan.this_run ? ` (your limit per search; run it again for the rest)` : ''}, one request each. Anything you've tailored, saved or applied to stays as it is.`,
      buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: `Score ${plan.this_run || 'them'} again`, value: 'go', kind: 'primary' }],
    });
    if (!r) return;
    return busy(async () => { const x = await api('/api/rescore', { method: 'POST', body: { group } }); toast(x.deferred ? x.deferred : 'Scoring them again. You get a notice when it\'s done.'); });
  }
  if (a === 'setupSkip') {
    return busy(async () => { await api('/api/setup-skip', { method: 'POST', body: { what: el.dataset.what } }); await refreshOverview(); route(); });
  }
  if (a === 'fillFromLink') {
    const f = el.closest('form').elements;
    if (!f.url.value.trim()) { toast('Paste the posting\'s link first.', true); return; }
    toast('Reading the posting…');
    return busy(async () => {
      const p = await api('/api/read-link', { method: 'POST', body: { url: f.url.value } });
      for (const k of ['company', 'title', 'location', 'description']) if (p[k] && !f[k].value.trim()) f[k].value = p[k];
      toast(p.company && p.title ? 'Filled in from the posting. Check it, then add it.' : 'Read the posting; fill in what\'s missing.');
    });
  }
  if (a === 'scoreAnyway') {
    return busy(async () => {
      await api(`/api/jobs/${encodeURIComponent(el.dataset.job)}/score`, { method: 'POST' });
      el.outerHTML = '<span class="muted small"><span class="spin" data-kind="score"></span>Scoring… if it clears your fit bar it\'s tailored and appears under Ready to approve.</span>';
    });
  }
  if (a === 'prep') {
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/prep`, { method: 'POST' }); await refreshOverview(); setTimeout(route, 300); }, 'Writing your interview prep…');
  }
  if (a === 'stage' || a === 'setStage') {
    const id = el.dataset.job || jobId;
    let status = a === 'stage' ? el.dataset.status : $('#stage').value;
    const from = el.dataset.from || main().dataset.status || '';
    let note = a === 'setStage' ? $('#stageNote').value : '';
    let learn = true;
    let block = false;
    if (status === 'dismissed' && !note) {
      const co = (await api(`/api/jobs/${encodeURIComponent(id)}`).catch(() => null))?.job?.company || '';
      const r = await dialog({
        title: 'Not interested in this role?',
        text: 'It goes to All jobs under Not interested. Job Hunt can also learn from it and score roles like it lower, or you can keep it as a backup.',
        input: 'Why not? (optional)', placeholder: 'e.g. too junior, sales role, too far',
        buttons: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save for later', value: 'saved' },
          ...(co && co !== 'Unknown' ? [{ label: `Never show ${co}`, value: 'block' }] : []),
          { label: 'Not interested, and learn from it', value: 'learn' }, { label: 'Not interested', value: 'quiet', kind: 'primary' }],
      });
      if (!r) return;
      if (r.value === 'saved') status = 'saved';
      block = r.value === 'block';
      learn = r.value === 'learn';
      note = r.text;
    }
    return busy(async () => {
      const done = await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status, note, learn, block } });
      await refreshOverview(); route();
      if (block) { toast(`You won't be shown this company again${done.also ? ` (${done.also} more of its postings went too)` : ''}. Change it under Me, in the companies to skip.`); return; }
      // A slip is easy to make from a list: offer to put it back.
      if (from && from !== status) {
        toast(`Moved to ${STAGES[status]}.`, false, { label: 'Undo', run: async () => {
          try { await api(`/api/jobs/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: from, note: 'undone' } }); toast(`Back to ${STAGES[from]}.`); await refreshOverview(); route(); }
          catch (e) { toast(e.message, true); }
        } });
      } else toast(`Moved to ${STAGES[status]}.`);
    });
  }
  if (a === 'open') return busy(async () => follow(await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/open`, { method: 'POST', body: { what: el.dataset.what } })));
  if (a === 'rateCompany') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/rating`, { method: 'POST' });
      toast(r.rating?.found ? `Employees rate it ${r.rating.rating.toFixed(1)} out of 5.` : 'No employee reviews found for this company.', !r.rating?.found);
      route();
    }, 'Looking up employee reviews (a minute or two)…');
  }
  if (a === 'syncOn') {
    return busy(async () => {
      const r = await api('/api/sync/settings', { method: 'POST', body: { where: 'drive', on: true } });
      settingsCache = null; await refreshOverview(); route();
      toast(r.sync.newer ? `Job Hunt on ${r.sync.newer.device} has newer data in your Google Drive. Choose whether to continue from it.` : 'Synced and backed up to the Job Hunt folder in your Google Drive. It keeps itself up to date.');
    }, 'Saving a copy to your Google Drive…');
  }
  if (a === 'findApply') {
    return busy(async () => {
      const r = await api(`/api/jobs/${encodeURIComponent(el.dataset.job || jobId)}/apply-link`, { method: 'POST' });
      toast(r.url ? 'Found it on the company\'s site.' : 'Couldn\'t find it on the company\'s own site; apply through the posting.', !r.url);
      route();
    }, 'Looking on the company\'s site (a minute or two)…');
  }
  if (a === 'saveLetter') return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/letter`, { method: 'POST', body: { text: $('#letter').value } }); route(); }, 'Cover letter saved.');
  if (a === 'saveNotes') return busy(() => api(`/api/jobs/${encodeURIComponent(jobId)}/notes`, { method: 'POST', body: { text: $('#notes').value } }), 'Notes saved.');
  if (a === 'retailor') {
    const track = el.dataset.pick ? $('#track').value : '';
    return busy(async () => { await api(`/api/jobs/${encodeURIComponent(jobId)}/tailor`, { method: 'POST', body: { track } }); await refreshOverview(); setTimeout(route, 300); }, 'Tailoring…');
  }
  if (a === 'link') return api('/api/open-url', { method: 'POST', body: { url: el.dataset.url } }).then(follow).catch(e => toast(e.message, true));
  if (a === 'folder') return api('/api/open-folder', { method: 'POST', body: { which: el.dataset.which } }).catch(e => toast(e.message, true));
  if (a === 'openCv') return api(`/api/cvs/${encodeURIComponent(el.dataset.track)}/open`, { method: 'POST' }).then(follow).catch(e => toast(e.message, true));
  if (a === 'google') {
    return busy(async () => {
      const r = await api('/api/settings/google-connect', { method: 'POST' });
      // On the server or a phone: sign in in this browser, then paste back where Google ends up.
      if (r.paste) { const box = $('#googlePaste'); box.innerHTML = googlePasteBox(r.url); box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      toast('A Google sign-in page opened in your browser. Approve access there.'); pollSettings();
    });
  }
  if (a === 'googleFinish') {
    const url = $('#googlePasteUrl')?.value.trim();
    if (!url) { toast('Paste the address from the page that didn\'t open first.', true); return; }
    return busy(async () => {
      const r = await api('/api/settings/google-finish', { method: 'POST', body: { url } }); settingsCache = null; await refreshOverview();
      // Data from another computer waiting in Google Drive: the Overview offers it.
      if (overview.sync_newer) location.hash = '#overview'; else route();
      toast(`Google connected${r.email ? ` for ${r.email}` : ''}.${overview.sync_newer ? ` Job Hunt on ${overview.sync_newer.device} has data to continue from.` : ''}`);
    });
  }
  if (a === 'forget') {
    const what = { claude: 'the Claude key', google: 'Google', adzuna: 'the Adzuna key', jsearch: 'the JSearch key', jooble: 'the Jooble key', apify: 'the Apify token', signature: 'your signature' }[el.dataset.what];
    if (!await ask(`Remove ${what} from Job Hunt?`)) return;
    return busy(async () => { await api(`/api/settings/forget/${el.dataset.what}`, { method: 'POST' }); await refreshOverview(); route(); }, 'Removed.');
  }
  const cvId = el.dataset.track;
  if (a === 'saveCv') {
    const card = el.closest('[data-cv]');
    const val = k => card.querySelector(`[data-k=${k}]`).value;
    return busy(async () => { await api(`/api/cvs/${encodeURIComponent(cvId)}/meta`, { method: 'POST', body: { label: val('label'), titles: fromLines(val('titles')), keywords: fromLines(val('keywords')), letter_style: val('letter_style') } }); route(); }, 'Saved.');
  }
  if (a === 'suggestCv') {
    return busy(async () => { toast('Claude is reading your whole CV for every field you could work in…'); await api(`/api/cvs/${encodeURIComponent(cvId)}/suggest`, { method: 'POST' }); settingsCache = null; route(); }, 'More titles added to yours, with the areas of experience Claude found.');
  }
  if (a === 'convertCv') {
    return busy(async () => { toast('Converting with Claude. This can take a minute…'); await api(`/api/cvs/${encodeURIComponent(cvId)}/convert`, { method: 'POST' }); await refreshOverview(); route(); }, 'Converted. Open it to check.');
  }
  if (a === 'removeCv') {
    if (!await ask('Remove this CV from Job Hunt? Jobs it scored are scored again against your other CVs, and applications tailored from it that are waiting for your approval are tailored again from the CV that fits best. Ones you\'ve edited, approved or sent stay as they are; on a re-tailored one, Undo last CV change and Undo last letter change bring back what it had. If this is your only CV, it all happens when you add your next one.')) return;
    return busy(async () => {
      const r = await api(`/api/cvs/${encodeURIComponent(cvId)}/remove`, { method: 'POST' });
      await refreshOverview(); route();
      toast(overview?.setup?.cvs ? `Removed.${cvChangeNote(r.change)}` : 'Removed. Jobs it scored and tailored are redone as soon as you add a CV.');
    });
  }
  if (a === 'checkClaude') { const w = $('#welcomeClaude'); if (w) return welcomeClaude(true); return checkClaude(true); }
  if (a === 'claudeSetup') {
    await busy(el, async () => { await api('/api/claude/setup', { method: 'POST', body: { install: el.dataset.install === '1' } }); });
    toast('Follow the steps in the window that opened. Job Hunt checks by itself.');
    watchClaude();
    return;
  }
}

/** What a replaced or removed CV set going: fits scored again, applications tailored again. */
function cvChangeNote(c) {
  if (!c) return '';
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const parts = [];
  if (c.retailor?.length) parts.push(`${n(c.retailor.length, 'application waiting for your approval is', 'applications waiting for your approval are')} being tailored again with it`);
  if (c.unscored?.length) parts.push(`${n(c.unscored.length, 'job is', 'jobs are')} being scored again`);
  if (c.kept) parts.push(`${n(c.kept, 'application keeps', 'applications keep')} your own file or edits (tailor ${c.kept === 1 ? 'it' : 'them'} again to use the new CV)`);
  return parts.length ? ` ${parts.join('; ')}.` : '';
}

/** What Job Hunt is redoing after a CV got a new file, each step with its own bar (the CVs page). */
function cvUpdateHtml(u) {
  if (!u || (!u.running && !u.tailoring && Date.now() - new Date(u.finished || u.at).getTime() > 36 * 3600 * 1000)) return '';
  const order = ['titles', 'scoring', 'tailoring', 'career', 'leads', 'done'], at = order.indexOf(u.step);
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  if (u.cancelled && !u.running) u = { ...u, step: 'done' };
  // One step: its state (done, now, next), what it says, and how far it is: [done, of] when it
  // counts, else a bar that moves while it works. `state` is given for a step that keeps its own time.
  const line = (step, text, count, state) => {
    const i = order.indexOf(step);
    state ||= !u.running || at > i ? 'done' : at === i ? 'now' : 'next';
    const [did, of] = count || [];
    const share = state === 'done' ? 100 : of ? Math.round(100 * Math.min(did, of) / of) : 0;
    // A bar only where there is something to watch: the step being done, and the ones to come.
    // A finished step is a tick and a line.
    const bar = state === 'done' ? '' : state === 'now' && !of ? '<span class="step-bar busy"><i></i></span>' : `<span class="step-bar"><i style="width:${share}%"></i></span>`;
    const said = state === 'done' ? (of ? `${Math.min(did, of)}` : '') : state === 'now' ? (of ? `${Math.min(did, of)} of ${of}` : 'Working') : of ? `${of}` : '';
    return `<li class="${state}">${state === 'done' ? '<span class="tick">✓</span>' : state === 'now' ? '<span class="dot now"></span>' : '<span class="dot"></span>'}<span class="step-text"><span>${text}</span>${bar}</span><span class="step-n">${said}</span></li>`;
  };
  const added = (u.titles_added || []).length;
  const toTailor = (u.retailor || []).length || u.to_tailor || 0, tailored = Math.min(u.tailored ?? (u.running ? 0 : toTailor), toTailor);
  const tailorState = !toTailor ? undefined : tailored >= toTailor ? 'done' : u.tailoring || (u.running && at >= 2) ? 'now' : !u.running ? 'done' : 'next';
  const approvedDone = u.approved_done || 0;
  const lines = [
    line('titles', !u.claude ? 'Job titles: not read (Claude isn\'t set up)' : at > 0 || !u.running ? (added ? `${n(added, 'new job title', 'new job titles')} to search for, from the new CV: ${esc(u.titles_added.slice(0, 3).join(', '))}${added > 3 ? ` and ${added - 3} more` : ''}` : 'Job titles and keywords: nothing new to add') : 'Reading the new CV for job titles and keywords'),
    line('scoring', u.to_score ? `${at > 1 || !u.running ? 'Fits scored again' : 'Scoring fits again'} (the roles that had cleared your bar)${u.held ? '. Claude reached its limit: the rest are scored when it resets' : ''}` : 'Fits: none to score again', u.to_score ? [u.scored || 0, u.to_score] : null),
    ...(u.approved ? [line('tailoring', `Approved and ready to submit, tailored again from the new CV${u.approved_failed && (!u.running || at > 2) ? ` (${u.approved_failed} couldn't be: open ${u.approved_failed === 1 ? 'it' : 'them'} under Submit and press Tailor again before sending)` : approvedDone < u.approved ? '. Wait for these before you submit them' : '. They stay approved: read each over before you submit it'}`, [approvedDone, u.approved], approvedDone >= u.approved ? 'done' : undefined)] : []),
    line('tailoring', toTailor ? `Applications waiting for your approval, tailored again${tailored >= toTailor ? '' : ' (each comes back to Approve when it\'s ready)'}` : 'Applications waiting for approval: none from this CV', toTailor ? [tailored, toTailor] : null, tailorState) ,
    line('career', u.career ? `Career paths rewritten${u.coach ? ', and the coach\'s advice' : ''}: <a href="#cvs/career">see them</a>` : !u.running ? 'Career paths: not rewritten this time (press Think again on Career)' : 'Career paths and the coach\'s advice'),
    line('leads', u.leads ? `${n(u.leads, 'open lead', 'open leads')} read against it again` : !u.running || at > 4 ? 'Leads: none waiting to be read again' : 'Open leads, read against it again'),
  ];
  const working = u.running || u.tailoring;
  const all = lines.length, finished = lines.filter(l => l.startsWith('<li class="done"')).length;
  return `<section class="card cv-update ${working ? 'running' : ''}"><header><h2>${u.stopping ? `Stopping the update for your ${esc(u.cv)} CV…` : working ? `Updating everything for your new ${esc(u.cv)} CV` : u.cancelled ? `You stopped the update for your new ${esc(u.cv)} CV` : u.stopped ? `The update for your new ${esc(u.cv)} CV was cut short` : `Up to date with your new ${esc(u.cv)} CV`}</h2>${working ? `<span class="pill">Step ${Math.min(finished + 1, all)} of ${all}</span>${u.running && !u.stopping ? '<button class="btn sm" type="button" data-act="cvUpdateStop" title="Finishes what it is on and starts nothing more. What it has done stays done.">Stop</button>' : ''}` : `${u.stopped || u.cancelled ? '<span class="pill warn">Stopped</span>' : '<span class="pill good">Done</span>'}<button class="btn ghost sm" type="button" data-act="cvUpdateClose" title="Take this off the page" aria-label="Close">${svg('close')}</button>`}</header>
    <ul class="steps-list">${lines.join('')}</ul>${u.kept ? `<p class="small">${n(u.kept, 'application keeps', 'applications keep')} your own file or edits (tailor ${u.kept === 1 ? 'it' : 'them'} again to use the new CV).</p>` : ''}
    <p class="muted small">${u.cancelled ? 'What it had done stays done. Roles it had not reached show Not scored: press Score it anyway on one, or Update this CV to run it again.' : u.stopped ? 'Job Hunt was closed part-way. Press Update this CV with the same file to finish it.' : `Roles that were set aside keep the fit they had. What you sent stays as it went out, and what you typed yourself (titles, facts, saved answers) is never changed.${working ? ' You can keep using Job Hunt while this runs.' : ''}`}</p></section>`;
}
let cvUpdatePoll;
/** Keep the card current while the update runs, without redrawing the page (you may be typing in it). */
function watchCvUpdate() {
  clearTimeout(cvUpdatePoll);
  cvUpdatePoll = setTimeout(async () => {
    const box = document.getElementById('cvUpdate');
    if (!box) return;
    try {
      const st = await api('/api/settings');
      box.innerHTML = cvUpdateHtml(st.cv_update);
      if (st.cv_update?.running || st.cv_update?.tailoring || st.cv_update?.stopping) return watchCvUpdate();
      refreshOverview();
    } catch (err) { watchCvUpdate(); }
  }, 2500);
}

async function uploadCvs(files, replace) {
  let done = 0;
  for (const f of files) {
    const needsClaude = !/\.docx$/i.test(f.name);
    toast(`${replace ? 'Replacing' : 'Adding'} ${f.name}… ${needsClaude ? 'Claude is converting it, which can take a minute.' : 'Claude is reading it.'}`);
    try {
      const q = `filename=${encodeURIComponent(f.name)}`;
      const r = await api(replace ? `/api/cvs/${encodeURIComponent(replace)}/file?${q}` : `/api/cvs?${q}`, { method: 'POST', raw: await f.arrayBuffer() });
      done++;
      toast(replace ? `Updated “${r.track.label}”. Job Hunt is bringing everything else up to date with it: see the top of this page.` : `Added “${r.track.label}”.${cvChangeNote(r.change)}`);
    } catch (err) { toast(`${f.name}: ${err.message}`, true); }
  }
  if (done) { await refreshOverview(); if (replace) location.hash = '#cvs'; route(); }
}

let sourcePoll;
async function showSourceTest(start) {
  clearTimeout(sourcePoll);
  const box = $('#sourceTest');
  if (!box) return;
  let t;
  try {
    if (start) await api('/api/sources/test', { method: 'POST' });
    t = await api('/api/sources/test');
  } catch (e) { box.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
  const btn = document.querySelector('[data-act=testSources]');
  if (btn) btn.disabled = t.running;
  const rows = t.last?.results || [];
  if (!rows.length && !t.running) { box.innerHTML = ''; return; }
  const status = x => x.ok ? '<span class="pill good">Working</span>' : x.skipped ? '<span class="pill">Not used</span>' : '<span class="pill crit">Problem</span>';
  const what = x => x.ok || x.found != null ? (x.unit ? `${x.found} ${esc(x.unit)}` : `${x.found} open${x.matching != null ? `, <b>${x.matching}</b> match your CVs` : ''}`) : esc(x.error || '');
  const broken = rows.filter(x => x.kind === 'board' && !x.ok && /not found/.test(x.error || ''));
  box.innerHTML = `<p class="muted small">Each source is tried once, with one of your job titles, to see that it works. Real searches use all your titles.</p><table><thead><tr><th>Source</th><th>Result</th><th>What it found</th><th></th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(x.name)}</td><td>${status(x)}</td><td class="small">${what(x)}${x.hint ? `<br><span class="muted">${esc(x.hint)}</span>` : ''}</td>
      <td>${x.kind === 'board' && !x.ok && x.source ? `<button class="btn ghost" data-act="removeBoard" data-source="${esc(x.source)}" data-name="${esc(x.board)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
    ${broken.length || rows.some(x => x.kind === 'board' && x.ok && !x.matching) ? `<div class="row"><button class="btn primary" data-act="suggestBoards" data-into="testIdeas">Suggest companies to add</button><span class="muted small">Claude suggests employers near you whose job boards have matching roles.</span></div><div id="testIdeas" class="ideas"></div>` : ''}
    <p class="muted small">${t.running ? `${testBar(t.last)} Indeed goes through Claude Code and can take a minute.` : t.last?.finished ? `Tested ${esc(ago(t.last.finished))}.` : ''}</p>`;
  if (t.running) sourcePoll = setTimeout(() => { if (location.hash.startsWith('#search/setup')) showSourceTest(); }, 2000);
}

/** Your career paths, for choosing a direction: Claude's advice, a comparison of where each path leads
 *  (now, 5 and 10 years, and its pay ceiling), then each path's ladder, pros and cons, and what it takes. */
/** The paths you keep open, as a list: kept as one line with ";" between (one path is just itself). */
const pathList = text => String(text || '').split(/[;\n]/).map(x => x.trim()).filter(Boolean);
/** Save the career paths you keep open (none clears them); every posting scored from now on is read against them. */
async function savePath(paths) {
  const list = (Array.isArray(paths) ? paths : pathList(paths)).filter((x, i, a) => a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i);
  const st = settingsCache || await api('/api/settings');
  const p = JSON.parse(JSON.stringify(st.profile));
  p.wants = { ...(p.wants || {}), path: list.join('; ') };
  await api('/api/settings/profile', { method: 'POST', body: { ...p, seen_sources: st.profile.sources } });
  settingsCache = null; route();
  toast(!list.length ? 'Cleared. Postings are no longer read against a path.' : list.length === 1 ? `Your path: ${list[0]}. New postings are read against it.` : `${list.length} paths kept open. A posting is on your path when it moves you along any of them.`);
}
function careerHtml(career, thinking, tracks, chosen = '') {
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const mine = pathList(chosen), onList = t => mine.some(x => same(x, t));
  const chosenCard = `<section class="card" id="pathCard"><header><h2>Your career paths</h2>${mine.length ? `<span class="pill good">${mine.length === 1 ? 'One chosen' : `${mine.length} kept open`}</span>` : ''}</header>
    <p class="muted small">Where you're heading: one path, or several you want to keep open while you decide. Job Hunt reads each new posting against them: one that moves you along any of them is marked <b>On your path</b>, one that leads to none is marked <b>Off your path</b> with the reason, and when you weigh an offer it says plainly if accepting would set you back.</p>
    ${mine.length ? `<div class="path-chips">${mine.map(x => `<span class="path-chip">${esc(x)}<button type="button" data-act="dropPath" data-title="${esc(x)}" title="Take it off your list" aria-label="Remove ${esc(x)}">${svg('close')}</button></span>`).join('')}</div>` : ''}
    <form data-form="careerPath" class="row" style="align-items:flex-end;flex-wrap:wrap"><label class="field grow" style="min-width:240px;margin:0">${mine.length ? 'Add another, in your own words' : 'A path, in your own words'}<input type="text" name="path" value="" placeholder="e.g. product management, in any industry"></label><button class="btn primary" type="submit">Add</button>${mine.length ? '<button class="btn" type="button" data-act="choosePath" data-title="">Clear them all</button>' : ''}</form>
    ${mine.length ? '<div class="row" style="margin-top:10px"><button class="btn sm" type="button" data-act="rescore" data-group="waiting">Read my waiting matches against ' + (mine.length === 1 ? 'it' : 'them') + '</button><span class="muted small">Matches found before aren\'t marked until they\'re scored again.</span></div>' : (career?.paths || []).length ? '<p class="muted small" style="margin-top:8px">Or press Keep this path open on any of the paths below: as many as you like.</p>' : ''}</section>`;
  const kindName = { now: 'Open to you now', stretch: 'A step up or sideways', switch: 'A change of direction' };
  const paths = career?.paths || [];
  const recs = paths.filter(c => c.recommended);
  const cur = c => c.currency && !['USD', 'CAD', 'AUD', 'NZD', 'SGD'].includes(c.currency) ? `${c.currency} ` : '$';
  const money = (n, c) => n ? `${cur(c)}${n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString()}` : '–';
  const range = (lo, hi, c) => lo && hi ? `${money(lo, c)}–${money(hi, c).replace(cur(c), '')}` : money(hi || lo, c);
  const step = (c, when) => (c.ladder || []).find(x => x.when.toLowerCase().includes(when)) || null;
  const top = Math.max(1, ...paths.map(c => c.ceiling_pay || c.pay_max || 0));
  const balanceName = { good: 'Good balance', mixed: 'Mixed balance', demanding: 'Demanding' };
  const balance = c => [c.hours ? `<span class="small">~${Math.round(c.hours)} h/week</span>` : '', c.balance ? `<span class="pill ${{ good: 'good', mixed: 'warn', demanding: 'crit' }[c.balance] || 'info'}" style="white-space:nowrap"${c.balance_note ? ` title="${esc(c.balance_note)}"` : ''}>${esc(balanceName[c.balance] || c.balance)}</span>` : ''].filter(Boolean).join(' ') || '–';
  const compare = paths.some(c => (c.ladder || []).length) ? `<table class="career-compare jobs" id="t-career"><thead><tr>${sortTh('Path')}${sortTh('Now', 'num')}${sortTh('In 5 years', 'num')}${sortTh('In 10 years', 'num')}${sortTh('Ceiling', 'num')}${sortTh('Hours a week', 'num')}<th>Balance</th></tr></thead><tbody>
      ${paths.map(c => { const n = step(c, 'now') || { pay_min: c.pay_min, pay_max: c.pay_max }, f = step(c, '5'), t = step(c, '10'); return `<tr${c.recommended ? ' class="rec"' : ''}><td class="path-name" data-v="${esc(c.title.toLowerCase())}"><a href="#path-${esc(c.title)}" data-act="careerJump" data-i="${paths.indexOf(c)}">${esc(c.title)}</a><span class="path-sub small">${c.recommended ? '<span class="rec-mark" title="' + esc(c.recommended_why || 'Claude recommends this path') + '">★ Recommended</span><span class="muted"> · </span>' : ''}<span class="muted">${esc(kindName[c.kind] || c.kind)}</span></span></td>
        <td class="num" data-v="${n.pay_max || n.pay_min || 0}">${range(n.pay_min, n.pay_max, c)}</td><td class="num" data-v="${f ? f.pay_max || 0 : 0}">${f ? range(f.pay_min, f.pay_max, c) : '–'}</td><td class="num" data-v="${t ? t.pay_max || 0 : 0}">${t ? range(t.pay_min, t.pay_max, c) : '–'}</td>
        <td class="num ceil" data-v="${c.ceiling_pay || 0}"><b>${money(c.ceiling_pay, c)}</b><div class="ceilbar"><span style="width:${(c.ceiling_pay || 0) / top * 100}%"></span></div></td>
        <td class="num" data-v="${c.hours || 0}">${c.hours ? `~${Math.round(c.hours)}` : '–'}</td>
        <td>${c.balance ? balance({ ...c, hours: 0 }) : '–'}</td></tr>`; }).join('')}</tbody></table>` : '';
  const ladder = c => (c.ladder || []).length ? `<ol class="ladder">${c.ladder.map(x => `<li><span class="when">${esc(x.when)}</span><b>${esc(x.title)}</b><span class="muted small">${range(x.pay_min, x.pay_max, c)}</span></li>`).join('')}
      ${c.ceiling_title ? `<li class="ceiling"><span class="when">Ceiling</span><b>${esc(c.ceiling_title)}</b><span class="small">up to <b>${money(c.ceiling_pay, c)}</b></span></li>` : ''}</ol>` : '';
  const list = (label, xs, cls) => xs?.length ? `<div class="small ${cls}"><b>${label}</b><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  const searchFor = (c, i) => (c.titles || []).length ? `<details class="small"><summary class="muted">Look for this role now</summary>
      <p style="margin:6px 0">Job titles for it: ${c.titles.map(esc).join(', ')}</p>
      ${tracks.length ? `<div class="row">${tracks.length > 1 ? `<label class="small">Add them to the search for your<select data-path-track="${i}" style="margin-left:6px">${tracks.map(t => `<option value="${esc(t.name)}">${esc(t.label)}</option>`).join('')}</select> CV</label>` : ''}<button class="btn sm" data-act="addTitles" data-i="${i}" data-titles="${esc(JSON.stringify(c.titles))}" ${c.titles.every(t => tracks.some(x => x.titles.some(y => y.toLowerCase() === t.toLowerCase()))) ? 'disabled title="Already in your search"' : ''}>${tracks.length > 1 ? 'Add' : 'Add them to my search'}</button></div>` : ''}</details>` : '';
  return `${chosenCard}<section class="card" id="careerCard"><header><h2>Your career paths</h2>
    ${thinking ? '<span class="muted small"><span class="spin" data-kind="career"></span>Claude is thinking… (a minute or two)</span>' : `<button class="btn" data-act="career">${career ? 'Think again' : 'Map my career paths'}</button>`}</header>
    ${career ? `${career.advice ? `<div class="advice"><b>Claude's advice</b><p>${esc(career.advice)}</p></div>` : ''}
      ${recs.length ? `<div class="recs" id="careerRecs"><b>★ ${recs.length === 1 ? 'The path Claude recommends' : `The ${recs.length} paths Claude recommends`}</b><ul>${recs.map(c => `<li><a href="#path-${esc(c.title)}" data-act="careerJump" data-i="${paths.indexOf(c)}"><b>${esc(c.title)}</b></a> <span class="muted small">${esc(kindName[c.kind] || c.kind)}</span>${c.recommended_why ? `<br><span class="small">${esc(c.recommended_why)}</span>` : ''}</li>`).join('')}</ul></div>`
        : paths.length ? '<p class="muted small" id="careerRecs">These paths were mapped before Job Hunt marked which ones Claude recommends. Press Think again to see its picks and why.</p>' : ''}
      ${compare ? `<h3 class="sub">Where each path leads</h3>${compare}<p class="muted small">Typical yearly base pay where you search, with steady progress. The ceiling is the most the path usually pays, at its top role. Hours are a typical week in the role, all in. Claude's estimates from ${esc(fmtDate(career.at))}: use them to compare paths, not as offers.</p>` : ''}
      <div class="paths">${paths.map((c, i) => `<div class="path${c.recommended ? ' rec' : ''}" id="path-${i}">
        ${c.recommended ? '<span class="rec-flag">★ Recommended</span>' : ''}
        <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap"><span><b>${esc(c.title)}</b><br><span class="small muted">${esc(kindName[c.kind] || c.kind)} · fit ${c.fit}</span></span>${c.ceiling_pay ? `<span class="pill good" style="white-space:nowrap" title="The most this path usually pays">up to ${money(c.ceiling_pay, c)}</span>` : `<span class="pill good" style="white-space:nowrap">${esc(c.pay)}</span>`}</div>
        ${c.recommended && c.recommended_why ? `<p class="small rec-why"><b>Why Claude recommends it:</b> ${esc(c.recommended_why)}</p>` : ''}
        <p class="small">${esc(c.why)}</p>
        ${ladder(c)}
        ${c.hours || c.balance ? `<p class="small"><b>Work-life balance:</b> ${balance(c)}${c.balance_note ? ` ${esc(c.balance_note)}` : ''}</p>` : ''}
        <div class="proscons">${list('For', c.pros, 'pro')}${list('Against', c.cons, 'con')}</div>
        ${(c.gaps || []).length ? `<p class="small"><b>What it takes:</b> ${c.gaps.map(esc).join('; ')}</p>` : ''}
        ${c.first_step ? `<p class="small"><b>First step this month:</b> ${esc(c.first_step)}</p>` : ''}
        ${searchFor(c, i)}
        <div class="row" style="margin-top:8px">${onList(c.title) ? `<span class="pill good">On your list</span><button class="btn ghost sm" data-act="dropPath" data-title="${esc(c.title)}">Take it off</button>` : `<button class="btn sm" data-act="addPath" data-title="${esc(c.title)}">${mine.length ? 'Keep this path open too' : 'Keep this path open'}</button>`}</div>
      </div>`).join('')}</div>`
    : `<p class="muted">Claude reads your whole CV and maps every direction it supports: where each leads in 3, 5 and 10 years, the pay at each step and the most the path can pay, the usual hours and work-life balance, with pros and cons and its advice on which to choose.${thinking ? '' : ' It does this by itself when you add a CV.'}</p>`}
  </section>`;
}

/** Setting up Claude Code, as a button where the app can do it, or plain steps where it can't. */
function claudeSetupHtml(st) {
  if (st.found && st.signed_in) {
    const how = { 'claude.ai': 'your Claude subscription', oauth_token: 'your Claude account', api_key: 'an API key (billed per use)' }[st.method] || st.method;
    return `✓ Ready: signed in with ${esc(how)}.`;
  }
  if (st.can_setup) {
    return `<p style="margin:0 0 8px">${st.found ? 'Claude Code is installed but not signed in yet.' : 'Job Hunt needs Claude Code, a free helper from Anthropic.'} Press the button: a window opens${st.found ? '' : ', installs it (a minute or two)'} and your browser asks you to sign in to Claude. Approve it there, and Job Hunt notices by itself.</p>
      <div class="row"><button class="btn primary" type="button" data-act="claudeSetup" data-install="${st.found ? '' : '1'}">${st.found ? 'Sign in to Claude' : 'Install and sign in'}</button><button class="btn ghost" type="button" data-act="checkClaude">Check again</button></div>`;
  }
  const ps = 'open PowerShell (press Start, type <b>PowerShell</b>, press Enter), type <b>claude</b>, press Enter and follow its steps to sign in';
  return st.found
    ? `Claude Code is installed but not signed in. On the computer running Job Hunt, ${ps}. Then press Check again.`
    : `Claude Code isn't installed. On the computer running Job Hunt, open the Job Hunt app and press <b>Install and sign in</b> in Settings → Accounts, or install it from <a href="#" data-act="link" data-url="https://claude.com/claude-code">claude.com/claude-code</a>, then ${ps}.`;
}

let careerWatch;
/** While Claude writes the career advice, look again every 10 seconds (for up to 5 minutes). */
function watchCareer(hash) {
  clearTimeout(careerWatch);
  const until = Date.now() + 5 * 60 * 1000;
  const tick = async () => {
    if (location.hash !== hash) return;
    const st = await api('/api/settings').catch(() => null);
    if (st && !st.career_thinking) { settingsCache = null; route(); return; }
    if (Date.now() < until) careerWatch = setTimeout(tick, 10000);
  };
  careerWatch = setTimeout(tick, 10000);
}

let claudeWatch;
/** After the setup window opens: check every few seconds until Claude Code is signed in. */
function watchClaude() {
  clearTimeout(claudeWatch);
  const until = Date.now() + 15 * 60 * 1000;
  const tick = async () => {
    try {
      const st = await api('/api/settings/claude-code');
      if (st.found && st.signed_in) { toast('Claude is ready.'); await refreshOverview(); route(); return; }
    } catch {}
    if (Date.now() < until) claudeWatch = setTimeout(tick, 5000);
  };
  claudeWatch = setTimeout(tick, 5000);
}

async function checkClaude(force) {
  const box = $('#ccStatus'), pill = $('#ccPill');
  if (!box) return;
  if (force) box.innerHTML = '<span class="spin" data-kind="check" data-secs="6"></span> Checking…';
  try {
    const st = await api('/api/settings/claude-code');
    box.innerHTML = claudeSetupHtml(st);
    if (settingsCache?.claude.engine !== 'api') pill.innerHTML = st.found && st.signed_in ? '<span class="pill good">Ready</span>' : `<span class="pill warn">${st.found ? 'Not signed in' : 'Not installed'}</span>`;
  } catch (err) { box.textContent = err.message; }
}

// Files dropped on Add CVs are new CVs; a file dropped on a CV's own card is a newer version of it.
const dropSpot = e => e.target.closest?.('#drop,[data-drop-cv]');
document.addEventListener('dragover', e => { const d = dropSpot(e); if (d && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = dropSpot(e); if (d && !d.contains(e.relatedTarget)) d.classList.remove('over'); });
document.addEventListener('drop', e => {
  const d = dropSpot(e);
  if (!d || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  d.classList.remove('over');
  const files = [...e.dataTransfer.files].filter(f => /\.(docx|pdf|txt|doc)$/i.test(f.name));
  if (!files.length) return toast('Drop a Word, PDF or text file.', true);
  if (d.dataset.dropCv) uploadCvs(files.slice(0, 1), d.dataset.dropCv); else uploadCvs(files, null);
});

let settingsPoll;
function pollSettings() {
  clearTimeout(settingsPoll);
  settingsPoll = setTimeout(async () => {
    // Settings, or the Welcome page (continuing from another computer starts there).
    if (!location.hash.startsWith('#settings') && !/^#(search\/(what|setup)|calendar\/settings|inbox\/settings)/.test(location.hash) && location.hash !== '#welcome') return;
    const st = await api('/api/settings').catch(() => null);
    if (!st) return;
    await refreshOverview();
    route();
    if (st.google.connecting) pollSettings();
  }, 3000);
}

document.addEventListener('click', e => {
  // A More menu closes on a click outside it, or on one of its items.
  document.querySelectorAll('details.menu[open]').forEach(m => {
    // On a phone the status lines are part of the menu sheet, which stays open until it's closed.
    if (m.id === 'statusPop' && document.body.classList.contains('more-open')) return;
    if (!m.contains(e.target) || e.target.closest('.menu-list')) m.open = false;
  });

  const to = e.target.closest('a[data-tab-to]');
  if (to) jobTabs[decodeURIComponent(to.getAttribute('href').replace('#job/', ''))] = to.dataset.tabTo;
  if (to && to.dataset.scroll) scrollToAfter = to.dataset.scroll;
  const el = e.target.closest('[data-act]');
  if (el && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') { e.preventDefault(); act(el); return; }
  const row = e.target.closest('tr[data-href]');
  if (row) location.hash = row.dataset.href;
  // In Pipeline, on a wide window, a job opens beside the list; elsewhere its row opens in place.
  const ex = e.target.closest('tr[data-expand]');
  if (ex && panelFits() && location.hash.startsWith('#applications') && !e.target.closest('a,button,.open-reviews')) { openPanel(ex.dataset.expand); return; }
  if (ex) togglePosting(ex);
  const name = e.target.closest('.jrow[data-job-row] a.qt');
  if (name && panelFits() && location.hash.startsWith('#applications') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openPanel(name.closest('.jrow').dataset.jobRow); }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.act === 'smallSources') { smallSources = el.checked; route(); return; }
  if (el.dataset.act === 'repeatMode') {
    try { await api('/api/settings/repeat', { method: 'POST', body: { mode: el.value } }); settingsCache = null; toast({ light: 'Companies you applied to before: the same headline and a few changes.', same: 'Companies you applied to before: the same CV as before.', usual: 'Companies you applied to before: tailored as usual.' }[el.value]); }
    catch (e) { toast(e.message, true); }
    return;
  }
  if (el.dataset.act === 'autoSubmit') {
    try { await api('/api/answer-bank', { method: 'POST', body: { auto_submit: el.checked } }); toast(el.checked ? 'On: simple forms answered entirely from your saved answers are submitted after a 10-second countdown you can stop.' : 'Off: Job Hunt fills forms in, and you press Submit.'); }
    catch (e) { el.checked = !el.checked; toast(e.message, true); }
    return;
  }
  if (el.dataset.act === 'phoneDetails') {
    try { await api('/api/settings/phone', { method: 'POST', body: { details: el.checked } }); toast(el.checked ? 'Notices now show the company and role.' : 'Notices now keep details private.'); }
    catch (err) { el.checked = !el.checked; toast(err.message, true); }
    return;
  }
  if (el.dataset.act === 'welcomeSource') {
    try { await api(`/api/connections/${encodeURIComponent(el.dataset.id)}`, { method: 'POST', body: { on: el.checked } }); settingsCache = null; toast(el.checked ? 'Added: the next search includes it.' : 'Removed.'); }
    catch (err) { el.checked = !el.checked; toast(err.message, true); }
    return;
  }
  if (el.dataset.act === 'autostart') {
    try { await api('/api/settings/app', { method: 'POST', body: { autostart: el.checked } }); toast(el.checked ? 'Job Hunt will start when you sign in.' : 'Job Hunt won\'t start by itself.'); }
    catch (err) { el.checked = !el.checked; toast(err.message, true); }
  }
  if (el.dataset.act === 'budgetOn' || el.dataset.act === 'budgetHour') {
    const body = el.dataset.act === 'budgetOn' ? { on: el.checked } : { hour: Number(el.value) };
    await api('/api/usage/budget', { method: 'POST', body }).then(() => { toast('Saved.'); renderUsage(); }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'weeklyDay' || el.dataset.act === 'weeklyEmail') {
    const body = el.dataset.act === 'weeklyDay' ? { day: el.value } : { email: el.checked };
    await api('/api/settings/weekly', { method: 'POST', body }).then(() => toast('Saved.')).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'phoneUrgent') {
    await api('/api/settings/phone', { method: 'POST', body: { urgent_only: el.checked } }).then(() => toast('Saved.')).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'calShowGoogle') {
    await api('/api/calendar/show-google', { method: 'POST', body: { on: el.checked } }).then(() => route()).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'ratingsAuto') {
    await api('/api/settings/ratings', { method: 'POST', body: { on: el.checked } }).then(() => toast(el.checked ? 'Job Hunt will look up company ratings.' : 'Company ratings won\'t be looked up.')).catch(err => toast(err.message, true));
    return;
  }
  if (el.dataset.act === 'clipWatch') {
    await api('/api/settings/clip-watch', { method: 'POST', body: { on: el.checked } }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'browserPick') {
    await api('/api/settings/app', { method: 'POST', body: { browser: el.value } }).then(() => { settingsCache = null; toast(`Links open in ${el.options[el.selectedIndex].text}.`); }).catch(err => toast(err.message, true));
    return;
  }
  if (el.dataset.act === 'updateAuto') {
    await api('/api/settings/app', { method: 'POST', body: { update_auto: el.checked } }).then(() => { settingsCache = null; toast(el.checked ? 'On: updates install by themselves when Job Hunt isn\'t busy and you\'re not using it.' : 'Off: Job Hunt tells you when an update is ready, and you install it.'); }).catch(err => { el.checked = !el.checked; toast(err.message, true); });
    return;
  }
  if (el.dataset.act === 'wakePc') {
    await api('/api/settings/app', { method: 'POST', body: { wake: el.checked } }).then(() => { settingsCache = null; route(); toast(el.checked ? 'Job Hunt will wake this PC for its tasks when it is plugged in.' : 'Job Hunt won\'t wake this PC.'); }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'applyMode' || el.dataset.act === 'applyCv') {
    const body = el.dataset.act === 'applyMode' ? { mode: el.value } : { attach_cv: el.checked };
    await api('/api/recruiters/settings', { method: 'POST', body }).then(() => toast(el.dataset.act === 'applyCv' ? (el.checked ? 'Your tailored CV goes with emails Job Hunt sends.' : 'No CV attached.')
      : { draft: 'When you apply, the email waits in your Gmail drafts.', send: 'When you apply, Job Hunt sends the email for you.', off: 'No emails when you apply.' }[el.value])).catch(err => toast(err.message, true));
    return;
  }
  if (el.dataset.act === 'keepAwake') {
    await api('/api/settings/app', { method: 'POST', body: { keep_awake: el.checked } }).catch(err => toast(err.message, true));
  }
  if (el.dataset.act === 'closeMode') {
    await api('/api/settings/app', { method: 'POST', body: { close: el.value } }).catch(err => toast(err.message, true));
  }
  if (el.dataset.upload?.startsWith('own-') && el.files.length) {
    const f = el.files[0], what = el.dataset.upload.slice(4), id = main().dataset.job;
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}/own-file?what=${what}&filename=${encodeURIComponent(f.name)}`, { method: 'POST', raw: await f.arrayBuffer() });
      toast(`Using your ${what === 'cv' ? 'CV' : 'cover letter'} for this role.`); route();
    } catch (err) { toast(err.message, true); }
    el.value = '';
    return;
  }
  if (el.dataset.upload && el.files.length) {
    if (el.dataset.upload === 'cv-add' || el.dataset.upload === 'cv-replace') await uploadCvs([...el.files], el.dataset.upload === 'cv-replace' ? el.dataset.track : null);
    else if (el.dataset.upload === 'restore') {
      const file = el.files[0];
      if (!await ask(`Restore from ${file.name}? Everything in Job Hunt now is replaced with this backup, and Job Hunt restarts. What's here now is kept in a "before-restore" folder.`)) { el.value = ''; return; }
      try {
        toast('Restoring… Job Hunt restarts in a moment.');
        await api('/api/backup/restore', { method: 'POST', raw: await file.arrayBuffer() });
        setTimeout(() => location.reload(), 6000);
      } catch (err) { toast(err.message, true); }
    } else if (el.dataset.upload === 'network') {
      try {
        const r = await api('/api/network', { method: 'POST', raw: await el.files[0].text() });
        toast(`${r.count} connections saved. Jobs at their companies now show who you know there.`);
        route();
      } catch (err) { toast(err.message, true); }
    } else if (el.dataset.upload === 'signature') {
      try {
        await api('/api/settings/signature', { method: 'POST', raw: await el.files[0].arrayBuffer() });
        toast('Signature added. New cover letters will include it.');
        route();
      } catch (err) { toast(err.message, true); }
    } else {
      try {
        await api('/api/settings/google-client', { method: 'POST', raw: await el.files[0].text() });
        toast('Connection file saved. Now press Connect Google.');
        await refreshOverview(); route();
      } catch (err) { toast(err.message, true); }
    }
    el.value = '';
  }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    const kind = form.dataset.form;
    const f = form.elements;
    if (kind === 'declineChange') {
      await api(`/api/jobs/${encodeURIComponent(form.dataset.job)}/decline`, { method: 'POST', body: { change: f.change.value } });
      toast('Rewriting the reply…'); setTimeout(route, 300); return;
    }
    if (kind === 'careerPath') { if (f.path.value.trim()) await savePath([...pathList((settingsCache || await api('/api/settings')).profile?.wants?.path), ...pathList(f.path.value)]); return; }
    if (kind === 'add') {
      const claude = form.querySelector('[name=claude]:checked')?.value === '1';
      await api('/api/add', { method: 'POST', body: { company: f.company.value, title: f.title.value, url: f.url.value, location: f.location.value, description: f.description.value, claude } });
      toast(claude ? 'Added. Once it\'s scored and tailored it appears under Ready to approve; you get a notice.' : 'Saved. It\'s in All jobs, Saved for later.');
      location.hash = '#overview';
    } else if (kind === 'other') {
      await api('/api/settings/other', { method: 'POST', body: { for: f.for.value, url: f.service.value || f.url.value, key: f.key.value, model: f.model.value } });
      toast(f.for.value ? 'Saved. The next search uses it.' : 'Saved. Claude does everything.');
      await refreshOverview(); route();
    } else if (kind === 'claude') {
      await api('/api/settings/claude', { method: 'POST', body: { engine: form.querySelector('[name=engine]:checked').value, claude_key: f.claude_key.value, model: f.model.value, tailor_model: f.tailor_model.value, tailor_effort: f.tailor_effort.value, score_model: f.score_model.value, score_batch: Number(f.score_batch.value), path: f.path.value } });
      toast('Saved.');
      await refreshOverview(); route();
    } else if (kind === 'apify') {
      await api('/api/settings/keys', { method: 'POST', body: { apify_key: f.apify_key.value, apify_actor: f.apify_actor.value } });
      toast(f.apify_key.value.trim() ? 'The token works, and it\'s saved. Turn LinkedIn on if it isn\'t.' : 'Saved.');
      settingsCache = null; route();
    } else if (kind === 'recruiterEdit') {
      const body = Object.fromEntries(['email', 'name', 'company', 'phone', 'linkedin', 'notes'].filter(k => f[k]).map(k => [k, f[k].value]));
      await api('/api/recruiters/edit', { method: 'POST', body });
      toast('Saved.'); route();
    } else if (kind === 'sites') {
      const sites = [...form.querySelectorAll('[name=site]:checked')].map(x => x.value);
      const custom = [...form.querySelectorAll('.site-own')].map(r => ({ name: r.querySelector('[name=own_name]').value.trim(), url: r.querySelector('[name=own_url]').value.trim() })).filter(c => c.url);
      await api('/api/sites', { method: 'POST', body: { sites, custom } });
      toast(sites.length + custom.length ? 'Saved. The next search includes them; Test them to check each one now.' : 'Saved.');
      settingsCache = null; route();
    } else if (kind === 'jsearch' || kind === 'jooble') {
      await api('/api/settings/keys', { method: 'POST', body: kind === 'jsearch' ? { jsearch_key: f.jsearch_key.value, jsearch_provider: f.jsearch_provider.value } : { jooble_key: f.jooble_key.value } });
      toast((kind === 'jsearch' ? f.jsearch_key : f.jooble_key).value.trim() ? 'The key works, and it\'s saved.' : 'Saved.');
      await refreshOverview(); route();
    } else if (kind === 'adzuna') {
      await api('/api/settings/keys', { method: 'POST', body: { adzuna_id: f.adzuna_id.value, adzuna_key: f.adzuna_key.value } });
      toast(f.adzuna_key.value.trim() ? 'The key works, and Adzuna is saved.' : 'Adzuna saved.');
      await refreshOverview(); route();
    } else if (kind === 'sync') {
      const where = form.querySelector('[name=where]:checked')?.value || 'drive';
      const r = await api('/api/sync/settings', { method: 'POST', body: { where, ...(f.dir ? { dir: f.dir.value } : {}), on: f.on.checked, secrets: f.secrets.checked, ...(f.every ? { every: Number(f.every.value) } : {}) } });
      toast(r.sync.newer ? `${r.sync.newer.device} has newer data there. Choose in the Queue whether to continue from it.` : r.sync.on ? `Synced. ${where === 'drive' ? 'The Job Hunt folder in your Google Drive' : 'This folder'} now has your latest data.` : 'Saved.');
      await refreshOverview(); route();
    } else if (kind === 'welcomeWant') {
      const p = JSON.parse(JSON.stringify(settingsCache.profile));
      p.min_salary = f.min_salary.value ? Number(f.min_salary.value) : null;
      p.wants = { ...(p.wants || {}), level: f.want_level.value.trim(), work: f.want_work.value, path: f.want_path ? f.want_path.value.trim() : (p.wants?.path || '') };
      // The strongest matches ready by themselves, unless everything already is.
      if (!p.auto_tailor) p.auto_tailor_min = f.strong.checked ? 85 : 0;
      await api('/api/settings/profile', { method: 'POST', body: { ...p, seen_sources: settingsCache.profile.sources } });
      try { localStorage.setItem('jh.wantDone', '1'); } catch (e) {}
      toast('Saved.'); route();
    } else if (kind === 'welcomeWhere') {
      const p = JSON.parse(JSON.stringify(settingsCache.profile));
      p.locations = fromLines(f.locations.value); p.remote_ok = f.remote_ok.checked; p.include_metro = !!f.include_metro?.checked; p.sources.adzuna_country = f.country.value;
      if (f.timezone?.value) p.timezone = f.timezone.value;
      await api('/api/settings/profile', { method: 'POST', body: { ...p, seen_sources: settingsCache.profile.sources } });
      toast('Saved.'); route();
    } else if (kind === 'calInterview') {
      if (!f.job_id.value) { toast('Pick the application first.', true); return; }
      if (!f.start.value) { toast('Choose the date and time.', true); return; }
      await api('/api/calendar/interview', { method: 'POST', body: { job_id: f.job_id.value, start: new Date(f.start.value).toISOString(), minutes: Number(f.minutes.value), link: f.link.value, note: f.note.value } });
      toast('Interview added, with prep time and reminders.');
      await refreshOverview(); route();
    } else if (kind === 'phone') {
      await api('/api/settings/phone', { method: 'POST', body: { server: f.server.value } });
      toast('Saved.'); route();
    } else if (kind === 'filesFolder') {
      const r = await api('/api/settings/files-folder', { method: 'POST', body: { dir: f.dir.value } });
      settingsCache = null; toast(`Your files are in ${r.folder}.`); route();
    } else if (kind === 'backup') {
      await api('/api/settings/backup', { method: 'POST', body: { secrets: f.secrets.checked } });
      toast('Backup settings saved.'); route();
    } else if (kind === 'links') {
      await api('/api/settings/links', { method: 'POST', body: { base: f.base.value } });
      settingsCache = null; toast(f.base.value.trim() ? 'Saved. Links in CVs tailored from now on note when they\'re opened.' : 'Turned off.'); route();
    } else if (kind === 'remote') {
      await api('/api/settings/remote', { method: 'POST', body: { password: f.password.value, port: f.port ? Number(f.port.value) : undefined, on: f.on ? f.on.checked : undefined } });
      toast('Saved.'); route();
    } else if (kind === 'profile') {
      await api('/api/settings/profile', { method: 'POST', body: readProfile(form, form.dataset.part) });
      toast('Saved.');
      await refreshOverview(); route();
    }
  } catch (err) { toast(err.message, true); }
  finally { if (btn) btn.disabled = false; }
});

// Chart tooltips.
document.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-tip]');
  const tip = $('#tip');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});

// Appearance: Auto follows Windows; Light and Dark stay as chosen.
function showTheme() {
  const pick = document.documentElement.dataset.theme || 'auto';
  document.querySelectorAll('[data-theme-pick]').forEach(b => {
    const on = b.dataset.themePick === pick;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  document.querySelectorAll('#mTheme, #dTheme').forEach(one => { one.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MODES[pick][1]}</svg>`; one.title = `Appearance: ${MODES[pick][0]}. Press to change.`; one.setAttribute('aria-label', one.title); });
}
function setTheme(pick) {
  if (pick === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pick;
  try { pick === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', pick); } catch (e) {}
  showTheme();
}
document.querySelectorAll('[data-theme-pick]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themePick)));
showTheme();

window.addEventListener('hashchange', () => document.body.classList.remove('more-open'));
window.addEventListener('hashchange', route);
// Keep the sidebar and the overview fresh while searches and email checks run in the background.
setInterval(async () => {
  // Housekeeping that runs every few minutes doesn't redraw the page.
  const busyWith = () => JSON.stringify((overview?.running || []).filter(r => !['care', 'calsync', 'sync', 'backup', 'check-postings'].includes(r))) + (overview?.counts?.ready || 0);
  const before = busyWith();
  await refreshOverview();
  const after = busyWith();
  const editing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const here = location.hash;
  if (before !== after && !editing && !pageDirty && !$('#calAddCard:not([hidden])') && (here === '' || ['#overview', '#results', '#calendar'].includes(here) || here.startsWith('#job/'))) route();
}, 8000);

refreshOverview().then(route).then(noteUpdated);
// Look for an update shortly after opening, then every 30 minutes.
setTimeout(checkUpdate, 4000);
setInterval(checkUpdate, 30 * 60 * 1000);
// While Job Hunt sits in the tray or behind other windows, look again whenever it comes to the front
// (the app also calls onShown when you open it from the tray or switch to its window).
let lastShownCheck = Date.now();
function onShown() {
  if (Date.now() - lastShownCheck < 60 * 1000) return;
  lastShownCheck = Date.now();
  checkUpdate();
  refreshOverview().catch(() => {}); // the counts; the page itself stays, so nothing you're typing is lost
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onShown(); });
window.addEventListener('focus', onShown);

// A card you fold shut stays shut next time (What Job Hunt did lately on the Queue).
document.addEventListener('toggle', e => { const k = e.target?.dataset?.keep; if (k) { try { localStorage.setItem(k, e.target.open ? '0' : '1'); } catch (err) {} } }, true);
