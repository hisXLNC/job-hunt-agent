// Runs in the Apply window, on the company's application page (main frame only). It reads the
// form, sends the questions to Job Hunt, fills in what comes back and attaches your CV and letter,
// then leaves the Submit button to you. Talks to Job Hunt by asking to open a jobhunt.invalid
// address, which the app catches and cancels; the token keeps the page from faking that.
(() => {
  if (window.top !== window || window.__jobhunt) return;
  const TOKEN = '__TOKEN__';
  const JOB = __JOB__;
  // In the browser extension (no token): messages go through the extension, which asks Job Hunt.
  const EXT = !TOKEN && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  // On your phone (the bookmark): messages go straight to Job Hunt on your PC, through Tailscale.
  const PHONE = !TOKEN && !EXT && window.__jobhuntRemote;
  // In the window, messages go as an address Job Hunt catches and cancels. A filled-in form usually
  // guards against leaving it ("Leave site? Changes may not be saved"), which would stop the message,
  // so while one goes, that guard is stopped before it runs (this script runs before the page's own).
  let sending = 0;
  window.addEventListener('beforeunload', e => { if (Date.now() - sending < 2000) e.stopImmediatePropagation(); }, true);
  // --- talking to Job Hunt from a browser (the extension, or the phone's bookmark) ---
  // What happened on this page, newest last: in Copy details, and (the extension) in its log.
  const trail = [];
  let unsent = [];
  function trace(m, d) {
    const e = { t: Date.now(), m: String(m).slice(0, 300), d };
    trail.push(e); if (trail.length > 150) trail.shift();
    unsent.push(e);
  }
  // Hand what happened to the extension's log; with `why`, Job Hunt is given the log too.
  function flush(why) {
    if (!EXT || (!unsent.length && !why)) return;
    const events = unsent; unsent = [];
    try { chrome.runtime.sendMessage({ jobhunt: 'log', data: { events, why, page: location.hostname } }, () => void chrome.runtime.lastError); } catch (e) { /* the extension was updated */ }
  }
  const ORPHAN = 'The extension was updated. Reload this page (F5), then fill again.';
  // One short question to Job Hunt: { ok, v } or { ok: false, error, why, data }. why: 'http' (Job
  // Hunt said no), 'offline', 'timeout', 'silent' (the extension didn't answer), 'orphan' (the
  // extension was updated since this page opened: this copy can't reach it), or the extension's own.
  const rpc = PHONE ? async (path, body) => {
    const R = window.__jobhuntRemote, stop = new AbortController(), timer = setTimeout(() => stop.abort(), 20000);
    let r;
    try { r = await fetch(R.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Job-Hunt-Key': R.key }, body: JSON.stringify(body), signal: stop.signal }); }
    catch (e) { return { ok: false, why: stop.signal.aborted ? 'timeout' : 'offline', error: "Can't reach Job Hunt on your PC. Is it running there, and is Tailscale on on this phone?" }; }
    finally { clearTimeout(timer); }
    const v = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, v } : { ok: false, why: 'http', error: v.error || `Job Hunt said ${r.status}.`, data: v };
  } : (path, body) => new Promise(res => {
    const timer = setTimeout(() => res({ ok: false, why: 'silent', error: "The extension didn't answer." }), 70000);
    try {
      if (!chrome.runtime || !chrome.runtime.id) throw new Error('Extension context invalidated');
      chrome.runtime.sendMessage({ jobhunt: 'ask', data: { path, body } }, v => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        res(v || { ok: false, why: /invalidated/i.test((err && err.message) || '') ? 'orphan' : 'silent', error: (err && err.message) || "The extension didn't answer." });
      });
    } catch (e) { clearTimeout(timer); res({ ok: false, why: 'orphan', error: String(e && e.message || e) }); }
  });
  // The answers for a form. Claude can take a minute or more, and a browser drops a request its
  // extension has waited on that long, so: the form is handed over for a ticket, then Job Hunt is
  // asked every second or two whether the answers are there. What can go wrong on the way is put
  // right here where it can be: Job Hunt not answering for a moment (asked again), Job Hunt
  // restarted meanwhile (the form is sent again, once). A newer request makes an older one unwanted.
  let asking = 0, waitNote = '';
  async function getAnswers(data) {
    const J = window.__jobhunt, mine = ++asking, t0 = Date.now(), current = () => mine === asking;
    const fail = (msg, why) => { if (!current()) return; waitNote = ''; trace('failed: ' + msg, { why }); flush(why || 'failed'); J.failed(msg); };
    let ticket = null, restarts = 0, misses = 0;
    waitNote = '';
    for (;;) {
      if (!ticket) {
        const r = await rpc('/ext/fill/start', data);
        if (!current()) return;
        if (!r.ok) {
          if (r.data && r.data.choose) { trace('which application? asked'); flush(); return J.choose(r.error, r.data.choose); }
          if (r.why === 'orphan') return fail(ORPHAN, 'orphan');
          return fail(['updating', 'stale', 'key', 'offline'].includes(r.why) ? r.error : "Couldn't fill it in: " + r.error, r.why);
        }
        // A Job Hunt from before tickets answers in one go.
        if (!r.v.ticket) { trace('answers (in one request)'); flush(); return J.fill(r.v); }
        ticket = r.v.ticket;
        trace('form sent', { boxes: data.fields.length });
        flush();
      }
      await wait(misses ? 2500 : 1200);
      if (!current()) return;
      const p = await rpc('/ext/fill/poll', { ticket });
      if (!current()) return;
      const secs = Math.round((Date.now() - t0) / 1000);
      if (p.ok && misses) { trace('Job Hunt is answering again', { secs }); misses = 0; }
      if (p.ok && p.v.waiting) {
        if (secs > 720) return fail("Claude hasn't answered in 12 minutes. Check Job Hunt (is Claude signed in, or at its limit?), then press Fill in this form.", 'slow');
        waitNote = secs > 60 ? ' Claude is taking longer than usual; Job Hunt is still waiting for it.' : '';
        continue;
      }
      if (p.ok) { waitNote = ''; trace('answers arrived', { secs, values: Object.keys(p.v.values || {}).length, files: Object.keys(p.v.files || {}).length }); flush(); return J.fill(p.v); }
      if (p.data && p.data.gone) {
        if (restarts++ < 1) { trace('heal: Job Hunt was restarted meanwhile; sending the form again', { secs }); ticket = null; continue; }
        return fail('Job Hunt was restarted while it was writing the answers. Press Fill in this form again.', 'gone');
      }
      if (p.why === 'orphan') return fail(ORPHAN, 'orphan');
      if (p.why === 'http' || p.why === 'key') return fail("Couldn't fill it in: " + p.error, p.why);
      // Not answering (closed? busy? the extension asleep?): asked again for about half a minute.
      misses++;
      trace('no word from Job Hunt', { why: p.why, misses, secs });
      waitNote = " Job Hunt isn't answering; still trying.";
      if (misses >= 12) return fail(p.why === 'offline' ? 'Job Hunt stopped answering (was it closed?). Open it, then press Fill in this form.' : "Couldn't reach Job Hunt: " + p.error, p.why);
    }
  }
  async function remoteSend(kind, data) {
    const J = window.__jobhunt;
    if (kind === 'fields') return getAnswers(data);
    if (kind === 'pick') {
      const r = await rpc('/ext/pick', data);
      trace(r.ok ? 'application chosen' : 'choosing failed: ' + r.error);
      if (r.ok) J.start(); else J.failed(r.why === 'orphan' ? ORPHAN : "Couldn't choose it: " + r.error);
    } else if (['salary', 'dismiss', 'learn', 'applied'].includes(kind)) {
      const r = await rpc('/ext/' + kind, data);
      if (!r.ok) { trace(`${kind} not told to Job Hunt: ${r.error}`, { why: r.why }); flush(); }
    }
  }
  const send = (PHONE || EXT) ? (kind, data) => { remoteSend(kind, { ...data, url: location.href, title: document.title }).catch(e => { trace('error: ' + (e && e.stack || e)); flush('error'); window.__jobhunt.failed('Something went wrong talking to Job Hunt. Press Fill in this form again.'); }); }
 : (kind, data) => {
    sending = Date.now();
    const json = JSON.stringify({ t: TOKEN, ...data });
    let bin = '';
    for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    location.href = 'https://jobhunt.invalid/' + kind + '/' + b64;
  };
  const clean = s => (s || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim().slice(0, 300);
  const ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|icims\.com|jobvite\.com|bamboohr\.com|myworkdayjobs\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jazzhr\.com|applytojob\.com/i;

  // --- the panel, in its own shadow root so the page's styles don't reach it ---
  let askEl = null, chooseEl = null, retired = false, barEl = null, barTimer = null, ui, statusEl, headEl, buttons = {}, amber = [], amberAt = 0, filled = false, autoTimer = null;
  // One Job Hunt per page: another copy (the extension and the window both, or two copies of the
  // extension) would press each Add button twice and fill boxes the other one moved.
  // Which copy this is: the extension's (with its version) or the Apply window's. When the extension
  // updates, the copy already on an open page (Workday's form never reloads) stops working; a new
  // copy takes over from it instead of stepping aside.
  const ME = EXT ? 'ext:' + chrome.runtime.getManifest().version : PHONE ? 'phone' : 'app';
  const other = () => [...document.querySelectorAll('[data-jobhunt-panel]')].filter(h => h !== ui).some(h => {
    const v = h.getAttribute('data-jobhunt-panel');
    if (EXT && v !== 'app' && v !== ME) { h.remove(); return false; } // an older extension's: gone
    return true;
  });
  function panel() {
    if (ui) return;
    if (other()) { ui = document.createElement('div'); statusEl = document.createElement('p'); headEl = null; for (const k of ['fill', 'open', 'next', 'applied', 'stop', 'skip', 'drop']) buttons[k] = document.createElement('button'); retired = true; return; }
    const host = document.createElement('div');
    host.setAttribute('data-jobhunt-panel', ME);
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .p{font:14px/1.45 'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;background:#fff;color:#16181d;border:1px solid #eae9e3;border-radius:16px;box-shadow:0 1px 2px rgba(22,24,29,.06),0 14px 40px rgba(22,24,29,.16);padding:14px 16px 12px;width:320px}
      .h{display:flex;align-items:center;gap:9px;font-weight:650;margin-bottom:8px;letter-spacing:-.01em}.h .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .m{width:24px;height:24px;flex:none;display:block}
      .x{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#6b7180;padding:2px 6px;border-radius:7px}.x:hover{background:#f1f0eb}
      .s{color:#454a57;margin:0 0 10px}.r{display:flex;flex-wrap:wrap;gap:6px}
      button.b{font:inherit;font-weight:560;border:1px solid #deddd6;background:#fff;color:#16181d;border-radius:10px;padding:8px 12px;cursor:pointer;flex:1 1 auto}
      button.b:hover{border-color:#6b7180}
      button.b.pr{background:#2d55e8;border-color:#2d55e8;color:#fff;flex:1 1 100%;padding:10px 14px;font-size:15px}button.b[hidden]{display:none}button.b:disabled{opacity:.55;cursor:default}
      .f{display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:10px;padding-top:9px;border-top:1px solid #eae9e3}.f:not(:has(button:not([hidden]))){display:none}
      .f button.b{flex:none;border:0;background:none;padding:0;font-size:12.5px;font-weight:500;color:#6b7180;border-radius:0}.f button.b:hover{color:#2d55e8}
      .bar{height:6px;background:#eae9e3;border-radius:3px;overflow:hidden;margin:0 0 10px}.bar i{display:block;height:100%;width:0;background:#2d55e8;border-radius:3px;transition:width .45s}
      .min{width:auto}.min .s,.min .r,.min .f,.min .bar,.min .c,.min .q{display:none}.min .h{margin:0}
      .q{margin:0 0 10px;padding:10px 12px;border-radius:12px;background:#fbf0d4;color:#5c3a00}.q[hidden]{display:none}.q p{margin:0 0 8px}
      .c{display:flex;flex-direction:column;gap:6px;margin:0 0 10px}.c[hidden]{display:none}.c select{font:inherit;padding:8px 10px;border:1px solid #deddd6;border-radius:10px;max-width:100%;background:#fff}
      @media (max-width:420px){.p{width:calc(100vw - 32px)}}
    </style><div class="p"><div class="h"><svg class="m" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="jhg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3A5BD9"/><stop offset="1" stop-color="#22389A"/></linearGradient></defs><rect x="2" y="2" width="60" height="60" rx="14" fill="url(#jhg)"/><path d="M25 19.5v-2.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><rect x="12" y="19.5" width="40" height="28" rx="5" fill="#fff"/><path d="M12 31h40" stroke="#22389A" stroke-width="2.4"/><rect x="28.5" y="28" width="7" height="6" rx="1.5" fill="#22389A"/><circle cx="48" cy="46" r="10" fill="#E9B949" stroke="#22389A" stroke-width="2.4"/><path d="m43.6 46.2 3 3 5.6-6" fill="none" stroke="#22389A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="t">Job Hunt${JOB.company ? ` · ${JOB.company.replace(/[<>&]/g, '')}` : ''}${JOB.queue ? ` · ${JOB.queue}` : ''}</span><button class="x" title="Smaller">–</button></div>
      <p class="s"></p><div class="q" hidden><p class="qt"></p><div class="r"><button class="b pr" data-k="replace">Replace with Job Hunt's</button><button class="b" data-k="keep">Keep it</button></div></div><div class="c" hidden><select></select><button class="b pr" data-k="pick">Fill it in for this job</button></div><div class="bar" hidden><i></i></div><div class="r">
        <button class="b pr" data-k="fill">Fill in this form</button><button class="b" data-k="open" hidden>Open the form</button>
        <button class="b" data-k="next" hidden>Next to check</button><button class="b" data-k="applied">I submitted it</button>
        <button class="b" data-k="stop" hidden>Stop: I'll submit it</button></div>
      <div class="f">
        <button class="b" data-k="diag" ${EXT ? '' : 'hidden'} title="Copies what Job Hunt saw and did on this page (each box, what it meant to put there and what the box holds now), to paste to Claude when something was filled in wrongly or not at all">Copy details</button>
        <button class="b" data-k="skip" ${JOB.queue ? '' : 'hidden'} title="Leave this one for later and open the next application">Skip to the next</button>
        <button class="b" data-k="brief" ${EXT ? '' : 'hidden'} title="For a form Job Hunt can't fill: copies everything another assistant needs to fill it in (the Claude extension for Chrome, say): who you are, your facts, this job's tailored CV and cover letter, and to stop before Submit. Paste it to that assistant on this page.">Copy a brief for Claude</button>
        <button class="b" data-k="drop" title="Not for you after all (the pay, say): Job Hunt sets it aside${JOB.queue ? ' and opens the next one' : ''}">Not interested</button></div></div>`;
    statusEl = root.querySelector('.s');
    barEl = root.querySelector('.bar');
    root.querySelectorAll('[data-k]').forEach(b => { buttons[b.dataset.k] = b; });
    root.querySelector('.x').onclick = () => root.querySelector('.p').classList.toggle('min');
    buttons.fill.onclick = () => { trace('Fill in this form pressed'); start(); };
    chooseEl = root.querySelector('.c');
    askEl = root.querySelector('.q');
    buttons.replace.onclick = async () => {
      askEl.hidden = true;
      status('Replacing the file with Job Hunt\'s…');
      const n = await replaceFiles();
      status(n ? `Replaced: Job Hunt's ${n === 1 ? 'file is' : 'files are'} attached now. Read the form over, then press its Submit button.` : 'Couldn\'t replace it here: delete the old file with its bin icon, then press Fill in again.');
    };
    buttons.keep.onclick = () => { askEl.hidden = true; replaceAsk = []; status('Kept your file. Check the form, then submit it.'); };
    buttons.pick.onclick = () => {
      const id = chooseEl.querySelector('select').value;
      if (!id) return;
      chooseEl.hidden = true; buttons.fill.hidden = false; buttons.fill.disabled = true;
      status(id === 'profile' ? 'Filling it in from your CV…' : 'Filling it in for the job you chose…');
      send('pick', { job_id: id });
    };
    buttons.next.onclick = () => nextAmber();
    buttons.diag.onclick = async () => {
      if (!(diag.fields || []).length && !diag.snapshot) diag = { ...diag, version: ME, snapshot: snapshot() };
      let text = 'Job Hunt form details ' + JSON.stringify({ page: location.hostname, ...diag, trail: trail.map(e => ({ ...e, t: new Date(e.t).toISOString() })) }, null, 1);
      // With the extension's own log (what it asked Job Hunt and what came back, no answers in it).
      if (EXT) { flush(); try { const more = await Promise.race([chrome.runtime.sendMessage({ report: 'copy details', page: location.hostname }), wait(4000)]); if (more) text += '\n\n' + more; } catch (e) { /* the extension was updated */ } }
      try { await navigator.clipboard.writeText(text); }
      catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      status('Copied. Paste it to Claude and say what went wrong.');
    };
    buttons.brief.onclick = async () => {
      buttons.brief.disabled = true;
      const r = await rpc('/ext/brief', { url: location.href, title: document.title });
      buttons.brief.disabled = false;
      if (!r.ok) { status(r.data && r.data.choose ? 'Choose which application this is first (press Fill in this form), then copy the brief.' : `Couldn't write the brief: ${r.error}`); return; }
      try { await navigator.clipboard.writeText(r.v.text); }
      catch (e) { const t = document.createElement('textarea'); t.value = r.v.text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      trace('brief copied');
      status('Copied. Open the Claude extension on this page and paste it: it has your details, this job\'s CV and letter, and says to stop before Submit.');
    };
    buttons.skip.onclick = () => { buttons.skip.disabled = true; status('Opening the next application…'); send('skip', {}); };
    buttons.drop.onclick = () => { buttons.drop.disabled = true; clearTimeout(autoTimer); status(JOB.queue ? 'Set aside as Not interested. Opening the next application…' : 'Set aside as Not interested in Job Hunt. You can close this window.'); send('dismiss', {}); };
    buttons.stop.onclick = () => { clearTimeout(autoTimer); autoTimer = null; buttons.stop.hidden = true; status('Stopped. Read the form over, then press its Submit button yourself.'); };
    headEl = root.querySelector('.t');
    buttons.applied.onclick = () => { const p = pressed(); recorded = true; window.name = ''; status(JOB.queue && JOB.more ? 'Marked as applied. Opening the next one…' : 'Marked as applied in Job Hunt. This window closes in a few seconds.'); buttons.applied.hidden = true; send('applied', { url: location.href, fields: (p && p.fields) || [] }); };
    (document.body || document.documentElement).appendChild(host);
    ui = host;
  }
  const status = t => { panel(); statusEl.textContent = t; };
  // The progress bar: while Claude writes the answers it creeps towards `to` (most of the way by
  // the time it usually takes), then filling in takes it to the end. null hides it.
  const barAt = () => (barEl && !barEl.hidden && parseFloat(barEl.firstChild.style.width)) || 0;
  function progress(p) {
    panel();
    if (!barEl) return;
    clearInterval(barTimer); barTimer = null;
    barEl.hidden = p == null;
    if (p != null) barEl.firstChild.style.width = Math.max(0, Math.min(100, p)).toFixed(1) + '%';
  }
  function creep(to, seconds, text) {
    const from = barAt(), t0 = Date.now();
    progress(from);
    const tick = () => {
      const s = (Date.now() - t0) / 1000;
      barEl.firstChild.style.width = (from + (to - from) * (1 - Math.exp(-1.6 * s / seconds))).toFixed(1) + '%';
      status(text(Math.round(s)));
    };
    tick();
    barTimer = setInterval(tick, 500);
  }

  // --- reading the form ---
  const own = el => ui && ui.contains(el);
  const shown = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return (r.width > 0 || r.height > 0) && s.visibility !== 'hidden' && s.display !== 'none'; };
  function textOf(el) {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('input,select,textarea,option,script,style').forEach(x => x.remove());
    return clean(c.textContent);
  }
  // The question an input belongs to: the nearest label-like text before it.
  function question(el, group) {
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      node = node.parentElement;
      if (!node) break;
      if (node.matches('fieldset')) { const lg = node.querySelector('legend'); if (lg) return textOf(lg); }
      const lb = node.getAttribute('aria-labelledby');
      if (lb && /group|radiogroup/.test(node.getAttribute('role') || '')) return clean(lb.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' '));
      if (/group|radiogroup/.test(node.getAttribute('role') || '') && node.getAttribute('aria-label')) return clean(node.getAttribute('aria-label'));
      // Past the question's own box: the next level up holds other questions too.
      const mine = x => x === el || (group && group.includes(x)) || (el.name && x.name === el.name && x.type === el.type);
      if ([...node.querySelectorAll('input,select,textarea')].some(x => !mine(x) && x.type !== 'hidden' && !own(x))) break;
      const cands = [...node.querySelectorAll('legend,label,h2,h3,h4,h5,p,span,div')].filter(x =>
        !x.contains(el) && !x.querySelector('input,select,textarea') && (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && textOf(x).length > 1);
      if (cands.length) return textOf(cands[cands.length - 1]);
    }
    return '';
  }
  function labelOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = clean(by.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' ')); if (t) return t; }
    if (el.labels && el.labels.length) { const t = textOf(el.labels[0]); if (t) return t; }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    return question(el) || clean(el.placeholder || el.name || el.id);
  }
  let addNote = '', otherChosen = [], skillMiss = [], skillUnsure = [], attached = new Set(), fields = [], byKey = {}, adders = {}, round = 0, ownClick = false, waitingSince = 0, toggled = false, reveals = 0;
  const NOT_SEND = /^\s*\+?\s*(add|delete|remove|edit|cancel|back|previous|next|continue|save|upload|select|choose|attach|browse|clear|close|sign in|log in|create account)\b/i;
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "Add Another" under Work Experience or Education: the form shows one entry until it's pressed.
  const ADD = /^\s*\+?\s*add\b/i;
  const NOT_ADD = /\b(file|attachment|resume|cv|cover|link|website|document|photo|skill|reference)s?\b/i;
  const HISTORY = /experience|employment|work|job|position|education|school|degree|qualification|language|certif|licen[cs]e/i;
  function collectAdders(n) {
    adders = {};
    const seen = new Set();
    for (const b of document.querySelectorAll('button,[role=button],a')) {
      if (own(b) || !shown(b)) continue;
      const t = clean(b.textContent || b.getAttribute('aria-label') || '');
      if (!t || t.length > 40 || !ADD.test(t) || NOT_ADD.test(t)) continue;
      // The button that saves the entry you're filling in ("Add" beside Cancel, a small form's own
      // submit) adds no new entry: pressed as one, it sent the empty form (Job Bank's Add a work
      // experience came back with "Value is required" and a fresh page, as if nothing had happened).
      const beside = b.parentElement ? [...b.parentElement.querySelectorAll('button,input[type=button],input[type=submit],a')].some(x => x !== b && /^\s*cancel\s*$/i.test(x.textContent || x.value || '')) : false;
      const saves = /^\s*add\s*$/i.test(t) && b.type === 'submit' && !b.hasAttribute('data-automation-id') && b.form && b.form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea').length >= 2;
      if (beside || saves) continue;
      // Its section: the nearest heading before it that names one (a heading inside the entry, say
      // a date picker's, doesn't count), or what the button says ("Add Another Work Experience").
      let sec = sectionOf(b);
      const aria = clean(b.getAttribute('aria-label') || '');
      if (!HISTORY.test(sec + ' ' + t)) {
        const before = heads.filter(h => h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).map(h => textOf(h).slice(0, 80));
        sec = [...before].reverse().find(x => HISTORY.test(x)) || (HISTORY.test(aria) ? aria.replace(ADD, '').replace(/^\s*another\s*/i, '') : '');
      }
      if (!sec || !HISTORY.test(sec + ' ' + t)) continue;
      const base = sec.replace(/\s*\d+\s*$/, '');
      if (seen.has(base.toLowerCase())) continue;
      seen.add(base.toLowerCase());
      // How many entries it has now: its numbered headings ("Work Experience 1", "2"…), else its title boxes.
      const numbered = new RegExp('^' + reEsc(base) + '\\s*\\d+$', 'i');
      let have = heads.filter(h => numbered.test(textOf(h))).length;
      if (!have) have = fields.filter(f => (f.section || '').toLowerCase().startsWith(base.toLowerCase()) && /title|position|degree|school|institution|employer|company/i.test(f.label)).length;
      const key = 'a' + n++;
      fields.push({ key, type: 'add', label: t, section: base, entries: have, value: '' });
      adders[key] = b;
    }
  }
  // The part of the form a box is in: the nearest heading before it ("Work Experience 2",
  // "Education 1"), so each entry gets its own job or school from the CV.
  let heads = [], dateHeads = [];
  const sectionOf = el => {
    let t = '';
    for (const h of heads) { if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) t = h; else break; }
    return t ? textOf(t).slice(0, 80) : '';
  };
  // What Job Hunt saw, for "Copy details": where an element sits (tags, ids, Workday's names, roles)
  // and a short copy of its HTML, without styles or what you typed.
  let diag = {};
  const where = el => { const out = []; for (let x = el; x && x !== document.body && out.length < 9; x = x.parentElement) out.push(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (x.getAttribute('data-automation-id') ? `[da=${x.getAttribute('data-automation-id')}]` : '') + (x.getAttribute('role') ? `[role=${x.getAttribute('role')}]` : '') + (x.getAttribute('aria-selected') ? `[sel=${x.getAttribute('aria-selected')}]` : '')); return out.join(' < '); };
  const htmlOf = (el, n) => el ? el.outerHTML.replace(/\s(style|class|d|viewBox|fill|xmlns)="[^"]*"/g, '').replace(/\svalue="[^"]*"/g, '').slice(0, n) : '';
  // A skills box (Workday's "Type to Add Skills"): type a skill, press Enter, choose the match from
  // the list that comes up; once per skill. Its value is the skills chosen so far.
  const SKILLS = /\bskills?\b/i;
  // A box that takes one item from the site's list (Workday's Field of Study): typed, then chosen like a skill.
  const PROMPT = /field of study|area of study|major|discipline|specialization|specialisation/i;
  // Workday draws such a box as a "multiselect" (School or University, Certification): told by how
  // it's built, whatever it's called. Typed into as plain text, Workday drops what was typed.
  const PROMPT_BOX = '[data-automation-id=multiSelectContainer],[data-automation-id=multiselectInputContainer],[data-uxi-widget-type=multiselect]';
  const builtAsPrompt = el => !!el.closest(PROMPT_BOX) || el.getAttribute('data-uxi-widget-type') === 'selectinput';
  const isPrompt = (el, type) => ['text', 'search'].includes(type) && !SKILLS.test(labelOf(el)) && (builtAsPrompt(el) || PROMPT.test(labelOf(el)) && (/myworkday/i.test(location.hostname) || !!(el.closest('[data-automation-id^=formField]') || el.parentElement)?.parentElement?.querySelector('[data-automation-id=promptIcon],[data-automation-id=multiselectInputContainer],[data-uxi-widget-type=multiselect],[data-automation-id=multiSelectContainer]')));
  const isSkills = (el, type) => ['text', 'search'].includes(type) && SKILLS.test(labelOf(el)) && !/years|level|describe|summary/i.test(labelOf(el));
  const skillPills = el => {
    const box = el.closest('[data-automation-id=multiSelectContainer],[data-uxi-widget-type=multiselect],[role=group],div');
    const area = box && box.parentElement ? box.parentElement.parentElement || box.parentElement : null;
    return area ? [...area.querySelectorAll('[data-automation-id=selectedItem],[data-automation-id=promptSelectionLabel],[role=listitem],.pill,.tag,.chip')].map(x => clean(x.textContent)).filter(Boolean) : [];
  };
  // Dropdowns made of a button and a list (Workday's "Select One"): their options are only on the page
  // while open, so each is opened once, read and closed before the form is read.
  const DROPS = 'button[aria-haspopup=listbox]';
  const dropOptions = new WeakMap();
  // (Not the items already chosen in a skills or school box: Workday draws those like options, and
  // counted as the open list's they kept a long list from being scrolled.)
  // Options of a list that wouldn't close (a search box's results that only real keys dismiss): they
  // are not the next dropdown's, and counting them put one list's choices in another.
  const staleOptions = new WeakSet();
  const openOptions = () => [...document.querySelectorAll('[role=listbox] [role=option], [data-automation-id=promptOption]')].filter(o => !own(o) && shown(o) && !staleOptions.has(o) && !o.closest('[data-automation-id=selectedItem],[data-automation-id=selectedItemList],[data-automation-id=multiselectInputContainer]'));
  // Close whatever list is open: Escape where the focus is (Workday moves it into the list), then a
  // click outside it. A list left open had its options taken for the next dropdown's, which put one
  // dropdown's answers in another.
  async function closeLists(b) {
    for (let i = 0; i < 4 && openOptions().length; i++) {
      for (const el of new Set([document.activeElement, openOptions()[0], b].filter(Boolean))) pressKey(el, 'Escape');
      await wait(120);
      if (!openOptions().length) break;
      for (const t of ['mousedown', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      // A search box closes its results when it loses the focus.
      const at = document.activeElement;
      if (at && at !== document.body && !own(at) && /^(INPUT|TEXTAREA)$/.test(at.tagName)) at.blur();
      await wait(260);
      if (i === 2 && b && openOptions().length) { ownClick = true; b.click(); ownClick = false; await wait(150); }
    }
  }
  // Open a dropdown and return its options: the list it names (aria-controls), else the options that
  // weren't on the page before it opened.
  async function openDrop(b) {
    await closeLists();
    for (const o of openOptions()) staleOptions.add(o);
    ownClick = true; b.click(); ownClick = false;
    let list = [];
    for (let i = 0; i < 12; i++) {
      await wait(120);
      const ctl = b.getAttribute('aria-controls') || b.getAttribute('aria-owns');
      const box = ctl && document.getElementById(ctl);
      list = box ? [...box.querySelectorAll('[role=option],[data-automation-id=promptOption]')].filter(shown) : openOptions();
      if (list.length) break;
    }
    return list;
  }
  // A long list (every language) may show only part of itself until scrolled: scroll it to find more.
  // `texts` (when given) collects every option's words as they come into view: a list that draws
  // only the rows in view (Workday's languages) takes the earlier ones off the page as it scrolls,
  // and reading only what's left sent Claude a part of the list to choose from.
  const scrollerOf = list => { for (let x = list.length ? list[0].parentElement : null; x && x !== document.body; x = x.parentElement) if (x.scrollHeight > x.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(x).overflowY)) return x; return list.length ? list[0].closest('[role=listbox]') || list[0].parentElement : null; };
  async function moreOptions(list, want, texts) {
    const note = l => { if (texts) for (const o of l) { const t = clean(o.textContent); if (t && !texts.includes(t)) texts.push(t); } };
    note(list);
    const scroller = scrollerOf(list);
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 4) return list;
    const hit = () => want ? openOptions().find(o => same(o.textContent, want)) || openOptions().find(o => same(core(o.textContent), core(want))) : null;
    // From the top: a list opened part-way down (at the option chosen before) hides what's above.
    if (scroller.scrollTop > 0) { scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll')); await wait(150); note(openOptions()); }
    let all = [...openOptions()];
    for (let i = 0; i < 60; i++) {
      if (hit()) break;
      const top = scroller.scrollTop;
      scroller.scrollTop = top + Math.max(80, scroller.clientHeight - 20);
      scroller.dispatchEvent(new Event('scroll'));
      await wait(100);
      if (scroller.scrollTop === top) break;
      const now = openOptions();
      note(now);
      for (const o of now) if (!all.includes(o)) all.push(o);
    }
    // Looking for one option: the rows as they are once the list has settled (a list that draws
    // only what's in view draws its rows again as it scrolls; the ones seen a moment ago are gone).
    if (want) { await wait(200); return openOptions(); }
    return all.filter(o => o.isConnected);
  }
  async function readDrops() {
    let n = 0;
    for (const b of document.querySelectorAll(DROPS)) {
      if (own(b) || !shown(b) || b.disabled || dropOptions.has(b) || n++ > 40) continue;
      const texts = [];
      await moreOptions(await openDrop(b), '', texts);
      dropOptions.set(b, texts.filter(t => !/^select one$/i.test(t)));
      await closeLists(b);
    }
  }
  async function fillDrop(b, v) {
    if (same(clean(b.textContent), v) || same(core(b.textContent), core(v))) return true;
    let list = await openDrop(b);
    // The option of that name, wherever it is in the list; a near match only once the whole list
    // has been looked through (in a list of languages, the rows in view aren't all there is).
    const exact = l => l.findIndex(o => same(o.textContent, v) || same(core(o.textContent), core(v)));
    let i = exact(list);
    if (i < 0) { list = await moreOptions(list, v); i = exact(list); if (i < 0) i = pick(list.map(o => clean(o.textContent)), v); }
    // For Copy details: a choice that wasn't in the list, or didn't take.
    const tell = why => (diag.drops ||= []).push({ label: labelOf(b).slice(0, 40), want: String(v).slice(0, 40), why, saw: list.slice(0, 12).map(o => clean(o.textContent).slice(0, 30)), now: clean(b.textContent).slice(0, 40) });
    if (i < 0) { tell('not in the list'); await closeLists(b); return false; }
    const name = clean(list[i].textContent);
    list[i].scrollIntoView({ block: 'nearest' });
    ownClick = true; list[i].click(); ownClick = false;
    await wait(300);
    await closeLists(b);
    const ok = same(core(b.textContent), core(name || v)) || !/^select one$/i.test(clean(b.textContent));
    if (!ok) tell('clicked, not taken');
    return ok;
  }
  // Workday's dates: a box each for month, (day) and year, side by side in one wrapper.
  const datePart = el => {
    if (el.tagName !== 'INPUT') return '';
    const id = (el.getAttribute('data-automation-id') || '') + ' ' + (el.id || '');
    const m = /dateSection(Month|Day|Year)/i.exec(id) || (el.getAttribute('role') === 'spinbutton' && /^(month|day|year)$/i.exec(clean(el.getAttribute('aria-label') || '')));
    return m ? m[1].toLowerCase() : '';
  };
  const dateParts = el => {
    let box = el.parentElement;
    for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
      const ps = [...box.querySelectorAll('input')].filter(x => datePart(x));
      if (ps.length > 1 || box.getAttribute('data-automation-id') === 'dateInputWrapper') return ps.length ? ps : [el];
    }
    return [el];
  };
  // "07/2023", "2023-07", "Jul 2023", "July 1, 2023", "2023": month, day and year.
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function splitDate(v) {
    v = String(v).trim().toLowerCase();
    const y = (/\b(19|20)\d{2}\b/.exec(v) || [])[0] || '';
    let m = '', d = '';
    const name = MONTHS.findIndex(x => new RegExp('\\b' + x).test(v));
    if (name >= 0) { m = String(name + 1); const dd = /\b(\d{1,2})(st|nd|rd|th)?\b/.exec(v.replace(y, '')); if (dd) d = dd[1]; }
    else {
      const nums = v.replace(y, ' ').match(/\d{1,2}/g) || [];
      if (/^(19|20)\d{2}/.test(v)) { m = nums[0] || ''; d = nums[1] || ''; } else { m = nums[0] || ''; d = nums.length > 1 ? nums[1] : ''; }
    }
    const pad = x => x ? x.padStart(2, '0') : '';
    return { month: +m >= 1 && +m <= 12 ? pad(m) : '', day: +d >= 1 && +d <= 31 ? pad(d) : '', year: y };
  }
  async function fillDate(parts, v) {
    const want = splitDate(v);
    if (!want.year) return false;
    for (const el of parts) {
      const k = datePart(el), val = want[k] || (k === 'day' ? '01' : '');
      if (!val) continue;
      el.focus();
      setter(el, val);
      await wait(120);
    }
    return parts.every(el => !datePart(el) || !want[datePart(el)] || clean(el.value).replace(/^0/, '') === want[datePart(el)].replace(/^0/, ''));
  }
  function collect() {
    fields = []; byKey = {};
    heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role=heading]')].filter(h => !own(h) && shown(h) && textOf(h).length > 1);
    // A heading over nothing but a date's own boxes (Workday's "From", "To", "Expiration Date") names
    // that date, not a part of the form: it goes in the date's label, and the boxes after it stay in
    // their entry ("Education 1"), where it used to pass for the section of everything below it.
    const dateBox = h => { const box = h.closest('fieldset') || h.parentElement; const ins = box ? [...box.querySelectorAll('input,select,textarea')].filter(x => x.type !== 'hidden' && !own(x)) : []; return ins.length > 0 && ins.length <= 4 && ins.every(x => datePart(x)) ? box : null; };
    dateHeads = heads.map(h => [h, dateBox(h)]).filter(x => x[1]);
    heads = heads.filter(h => !dateHeads.some(x => x[0] === h));
    const groups = {};
    let n = 0;
    const datesDone = new Set();
    for (const el of document.querySelectorAll('input,select,textarea')) {
      if (own(el) || el.disabled) continue;
      // A date in parts (Workday's MM / YYYY boxes): one field for the whole date, filled part by part.
      const part = datePart(el);
      if (part) {
        if (datesDone.has(el)) continue;
        const parts = dateParts(el);
        // The words around a date's own boxes ("From"), not one box's "Month".
        parts.forEach(x => datesDone.add(x));
        const kinds = parts.map(datePart);
        const fmt = kinds.includes('day') ? 'MM/DD/YYYY' : kinds.includes('month') ? 'MM/YYYY' : 'YYYY';
        const key = 'f' + n++;
        const now = parts.map(x => clean(x.value)).filter(Boolean).join('/');
        const f = { key, type: 'date', format: fmt, label: `${(dateHeads.find(x => x[1].contains(el)) ? textOf(dateHeads.find(x => x[1].contains(el))[0]) : '') || (question(el, parts) || labelOf(el)).replace(/\s*\b(month|day|year)\b\s*$/i, '') || 'Date'} (${fmt})`, required: parts.some(x => x.required || x.getAttribute('aria-required') === 'true'), value: kinds.includes('year') && parts.find(x => datePart(x) === 'year').value ? now : '' };
        const sec = sectionOf(el); if (sec) f.section = sec;
        fields.push(f); byKey[key] = parts;
        continue;
      }
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'password'].includes(type)) continue;
      if (type === 'search' && !SKILLS.test(labelOf(el)) && !builtAsPrompt(el)) continue;
      const choice = type === 'radio' || type === 'checkbox';
      if (type !== 'file' && !choice && !shown(el)) continue;
      if (choice && !shown(el) && !(el.labels && [...el.labels].some(shown))) continue;
      if (choice && el.name) {
        // Grouped by name within one entry: Workday gives every entry's "I currently work here" the
        // same name, and as one group, ticking it in one entry ticked it in all of them.
        const g = groups[type + el.name + '|' + sectionOf(el)] ||= { key: 'g' + n++, type: type === 'radio' ? 'radio' : 'checkboxes', els: [], options: [] };
        g.els.push(el); g.options.push((el.labels && el.labels.length ? textOf(el.labels[0]) : '') || clean(el.value));
        continue;
      }
      const key = 'f' + n++;
      const chosen = type === 'select' && el.selectedIndex >= 0 && el.value !== '' ? clean(el.options[el.selectedIndex].text) : '';
      const f = { key, type: isSkills(el, type) ? 'skills' : isPrompt(el, type) ? 'prompt' : el.getAttribute('role') === 'combobox' ? 'combobox' : type, label: labelOf(el), required: el.required || el.getAttribute('aria-required') === 'true', value: type === 'file' ? (el.files && el.files.length ? 'attached' : '') : choice ? '' : type === 'select' ? chosen : clean(el.value) };
      if (type === 'checkbox') f.checked = el.checked;
      if (type === 'select') f.options = [...el.options].filter(o => o.value !== '' && !/^\s*(select|choose|--|please)/i.test(o.text)).map(o => clean(o.text)).slice(0, 60);
      if (type === 'checkbox') f.context = question(el);
      const sec = sectionOf(el); if (sec) f.section = sec;
      fields.push(f); byKey[key] = [el];
    }
    for (const g of Object.values(groups)) {
      const first = g.els[0];
      // One box, or several that all say the same ("I currently work here" in each entry, with no
      // headings between them): each is a lone checkbox of its own.
      if (g.type === 'checkboxes' && (g.els.length === 1 || new Set(g.options).size === 1)) {
        g.els.forEach((el, i) => {
          const key = i ? g.key + '_' + i : g.key;
          const f = { key, type: 'checkbox', label: (g.options[i] !== 'on' && g.options[i]) || labelOf(el), context: question(el), required: el.required, value: '', checked: el.checked };
          const sec = sectionOf(el); if (sec) f.section = sec;
          fields.push(f); byKey[key] = [el];
        });
        continue;
      }
      fields.push({ key: g.key, type: g.type, label: question(first) || clean(first.name), section: sectionOf(first) || undefined, options: g.options.slice(0, 40), required: g.els.some(e => e.required), value: g.els.filter(e => e.checked).map((e, i) => g.options[g.els.indexOf(e)]).join('; ') });
      byKey[g.key] = g.els;
    }
    // Workday's dropdowns ("Select One"): buttons that open a list, read beforehand (readDrops).
    for (const b of document.querySelectorAll(DROPS)) {
      if (own(b) || !shown(b) || b.disabled) continue;
      const key = 'd' + n++;
      const now = clean(b.textContent);
      const f = { key, type: 'select', drop: true, label: labelOf(b).replace(/\s*(select one|required)\s*/gi, ' ').trim(), required: b.getAttribute('aria-required') === 'true' || /required/i.test(b.getAttribute('aria-label') || ''),
        value: /^select one$/i.test(now) ? '' : now, options: (dropOptions.get(b) || []).slice(0, 260) };
      const sec = sectionOf(b); if (sec) f.section = sec;
      fields.push(f); byKey[key] = [b];
    }
    fields = fields.slice(0, 160);
    collectAdders(n);
    return fields;
  }
  const formHere = () => collect().filter(f => f.type !== 'checkbox').length >= 3 && fields.some(f => f.type === 'email' || f.type === 'file' || /e-?mail|resume|cv/i.test(f.label));

  // --- filling ---
  const setter = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    for (const e of ['input', 'change']) el.dispatchEvent(new Event(e, { bubbles: true }));
    // Sites built on React keep what you typed only once the box loses focus (focusout); without it a
    // redraw (pressing Add, say) empties the box again.
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
  // "5 - Fluent" is "Fluent": the numbering in front of an option doesn't have to be in the answer.
  const core = t => clean(t).toLowerCase().replace(/^\d+\s*[-\u2013.:)]\s*/, '');
  const near = (a, b) => { a = clean(a).toLowerCase(); b = clean(b).toLowerCase(); if (!a || !b) return false; if (a === b || a.startsWith(b) || b.startsWith(a)) return true; const x = core(a), y = core(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };
  const mark = (el, ok) => {
    let box = ['radio', 'checkbox'].includes(el.type) ? (el.closest('fieldset,[role=radiogroup],[role=group]') || el.parentElement) : el;
    // A hidden upload box (behind an Attach button): mark what you can see around it.
    while (box && box.parentElement && !shown(box)) box = box.parentElement;
    box.style.outline = ok ? '2px solid #2e9d5b' : '2px solid #e0a000';
    box.style.outlineOffset = '2px';
    if (!ok && !amber.includes(box)) amber.push(box);
  };
  const pick = (list, v) => list.findIndex(o => same(o, v)) >= 0 ? list.findIndex(o => same(o, v)) : list.findIndex(o => near(o, v));
  // A pause. A tab you aren't looking at has its timers slowed by the browser (to one a second, then
  // one a minute): a fill that takes two minutes in front took fifteen behind another tab. There,
  // the extension's background keeps the time instead (it isn't slowed) and answers when it's up.
  const wait = ms => new Promise(r => {
    if (!EXT || !document.hidden || ms < 20) return setTimeout(r, ms);
    let done = false;
    const go = () => { if (!done) { done = true; r(); } };
    setTimeout(go, ms + 1500); // whichever comes first
    try { chrome.runtime.sendMessage({ jobhunt: 'sleep', data: { ms } }, () => { void chrome.runtime.lastError; go(); }); } catch (e) { setTimeout(go, ms); }
  });
  // An upload box that already has a file (any name: one you or the site attached before, often the
  // CV you gave Workday at the start): the file's name is listed next to it. Looked for up the page
  // from the box, but not past another upload box (the cover letter's).
  const FILE_NAME = /[^\s\\/]\.(pdf|docx?|rtf|odt|txt|pages)(?![a-z])/i;
  function hasFile(el) {
    let node = el;
    for (let i = 0; i < 7 && node.parentElement && node.parentElement !== document.body; i++) {
      node = node.parentElement;
      if ([...node.querySelectorAll('input[type=file]')].some(x => x !== el)) return null;
      if (FILE_NAME.test(textOf(node))) return node;
    }
    return null;
  }
  // The files listed in a box, by name ("Jane - CV.pdf").
  const fileNames = node => [...new Set([...node.querySelectorAll('*')].filter(x => !x.children.length || x.children.length === 1 && !x.firstElementChild.textContent.trim())
    .map(x => clean(x.textContent)).filter(t => t.length < 150 && /\S\.(pdf|docx?|rtf|odt|txt|pages)$/i.test(t)))];
  // Files the form has already, of another name: asked about once the form is filled (replace them
  // with Job Hunt's, or keep them).
  let replaceAsk = [];
  function attach(el, file) {
    const bytes = Uint8Array.from(atob(file.b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.mime }));
    el.files = dt.files;
    for (const e of ['input', 'change']) el.dispatchEvent(new Event(e, { bubbles: true }));
    // Workday takes the file and empties its box at once, so an empty box afterwards is fine.
    return true;
  }
  // Attached, and seen to be: the box holds the file, or the page lists its name (Workday takes the
  // file and empties its box). If neither, the file is dropped on the upload area as a person
  // would, and looked for again; a file that never shows is left for you, in amber.
  async function attachSure(el, file) {
    const there = () => (el.isConnected && el.files && el.files.length > 0) || (document.body.innerText || '').includes(file.name);
    const seen = async ms => { for (let i = 0; i < ms / 250; i++) { if (there()) return true; await wait(250); } return there(); };
    attach(el, file);
    if (await seen(5000)) return true;
    let zone = null;
    for (let x = el.parentElement, i = 0; x && i < 6 && !zone; x = x.parentElement, i++) zone = x.querySelector('[data-automation-id=file-upload-drop-zone],[data-automation-id*=dropzone i],[class*=dropzone i],[class*=drop-zone i]');
    if (!zone) return false;
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(file.b64), c => c.charCodeAt(0))], file.name, { type: file.mime }));
    for (const t of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    return seen(6000);
  }
  async function replaceFiles() {
    let done = 0;
    for (const r of replaceAsk) {
      // The box's Delete buttons (Workday's bin icon, or anything called delete or remove).
      const bins = [...r.node.querySelectorAll('button,[role=button]')].filter(b => !own(b) && shown(b) &&
        /delete|remove|trash|bin/i.test([b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-automation-id'), b.textContent].join(' ')));
      for (const b of bins) { ownClick = true; b.click(); ownClick = false; await wait(700); }
      // A dialog asking to confirm the delete: confirm it.
      const ok = [...document.querySelectorAll('button')].find(b => !own(b) && shown(b) && /^(ok|yes|delete|remove|confirm)\b/i.test(clean(b.textContent)) && b.closest('[role=dialog],[role=alertdialog]'));
      if (ok) { ownClick = true; ok.click(); ownClick = false; await wait(700); }
      const box = r.el.isConnected ? r.el : r.node.querySelector('input[type=file]') || document.querySelector('input[type=file]');
      if (box && attach(box, r.file)) { attached.add(r.label + '|' + r.file.name); done++; }
      await wait(500);
    }
    replaceAsk = [];
    return done;
  }
  async function fillOne(f, v, file) {
    const els = byKey[f.key] || [];
    const el = els[0];
    if (!el) return false;
    if (f.type === 'file') {
      if (!file) return el.files && el.files.length > 0;
      // Attached already (this time, or the page lists the file): not again. Workday empties its
      // upload box after taking a file, so a second round would upload it twice.
      if (attached.has(f.label + '|' + file.name) || (document.body.innerText || '').includes(file.name)) return true;
      const there = hasFile(el);
      if (there) {
        if (!replaceAsk.some(r => r.el === el)) replaceAsk.push({ el, node: there, file, label: f.label, names: fileNames(there) });
        return true;
      }
      attached.add(f.label + '|' + file.name);
      if (await attachSure(el, file)) return true;
      attached.delete(f.label + '|' + file.name);
      return false;
    }
    if (v == null || v === '') return f.value !== '' && f.type !== 'checkbox';
    if (f.drop) return fillDrop(el, v);
    if (f.type === 'date' && f.format) return fillDate(els, v);
    if (f.type === 'select') {
      const opts = [...el.options];
      const i = pick(opts.map(o => o.text), v);
      if (i < 0) return false;
      setter(el, opts[i].value);
      return true;
    }
    if (f.type === 'radio') {
      const i = pick(f.options, v);
      if (i < 0) return false;
      if (!els[i].checked) els[i].click();
      return els[i].checked;
    }
    if (f.type === 'checkboxes') {
      const want = String(v).split(/;\s*/);
      let any = false;
      for (const [i, e] of els.entries()) {
        if (!want.some(w => near(f.options[i], w))) continue;
        if (!e.checked) e.click();
        if (!e.checked) { (e.labels && e.labels[0] || e.parentElement).click(); await wait(100); }
        any = any || e.checked;
      }
      return any;
    }
    if (f.type === 'checkbox') {
      // "yes" ticks it; "no" unticks a box that's ticked wrongly ("I currently work here" on a past job).
      const on = /^(yes|true|checked|tick)/i.test(String(v)), off = /^(no|false|unchecked|untick|clear)/i.test(String(v));
      for (let i = 0; i < 3 && ((on && !el.checked) || (off && el.checked)); i++) {
        // A list still open can swallow the click: close it first. Then the box, else its label.
        if (openOptions().length) await closeLists();
        const target = i === 0 ? el : i === 1 ? (el.labels && el.labels[0]) || el.parentElement : el.parentElement;
        ownClick = true; target.click(); ownClick = false; toggled = true;
        await wait(150);
      }
      return on ? el.checked : off ? !el.checked : false;
    }
    // Already has an answer (yours or the site's): kept, unless Job Hunt corrects it from your CV
    // (a site's CV reader often cuts a job title short or puts it in the wrong box).
    if (f.value && same(f.value, v)) return true;
    // Boxes that choose from the site's own list are searched, never typed into as text.
    if (f.type === 'skills') return fillSkills(el, v);
    if (f.type === 'prompt') return fillSkills(el, String(v).split(/\s*[;\n]\s*/)[0], true);
    // A box that opens a list of its own, named by the box (SuccessFactors: "No Selection", its
    // list in aria-owns): opened as a click opens it, and the answer chosen from that list.
    if (f.type === 'combobox' && await fillOwned(el, v)) return true;
    el.focus();
    setter(el, String(v));
    if (f.type === 'combobox') {
      await wait(500);
      const opt = [...document.querySelectorAll('[role=option]')].find(o => near(o.textContent, v));
      if (!opt) return false;
      opt.click();
    }
    return true;
  }
  async function fillOwned(el, v) {
    const id = el.getAttribute('aria-owns') || el.getAttribute('aria-controls');
    if (!id) return false;
    const rows = () => {
      const list = document.getElementById(id);
      if (!list || !shown(list)) return [];
      const all = [...list.querySelectorAll('[role=option],li,a')].filter(o => shown(o) && clean(o.textContent).length > 0 && clean(o.textContent).length < 120);
      // The innermost of each (an li around an a is one option, not two).
      return all.filter(o => !all.some(x => x !== o && o.contains(x)));
    };
    const choose = list => { const names = list.map(o => clean(o.textContent)); let i = names.findIndex(n => same(n, v)); if (i < 0) i = names.findIndex(n => near(n, v)); return i < 0 ? null : list[i]; };
    const was = el.value;
    let list = [];
    // Opened by a click on the box; if that shows nothing, by its arrow; then by typing the answer.
    const arrow = el.parentElement && el.parentElement.querySelector('button');
    for (const open of [() => mouse(el), () => arrow && mouse(arrow), () => { el.focus(); setter(el, String(v)); pressKey(el, 'ArrowDown'); }]) {
      open();
      for (let i = 0; i < 6 && !list.length; i++) { await wait(250); list = rows(); }
      if (list.length) break;
    }
    if (!list.length) { trace('a list of its own never opened', { label: labelOf(el).slice(0, 60), id }); if (el.value !== was) setter(el, was); return false; }
    let opt = choose(list);
    if (!opt) {
      trace('no such choice in its list', { label: labelOf(el).slice(0, 60), want: String(v).slice(0, 40), has: list.slice(0, 12).map(o => clean(o.textContent).slice(0, 30)) });
      if (el.value !== was) setter(el, was);
      pressKey(el, 'Escape');
      return false;
    }
    const name = clean(opt.textContent);
    const took = () => same(el.value, name) || near(el.value, name);
    mouse(opt);
    await wait(350);
    // A list that ignores a script's click takes a real one.
    if (!took() && opt.isConnected && shown(opt)) { await realClick(opt, true); await wait(350); }
    if (!took()) trace('its list took no choice', { label: labelOf(el).slice(0, 60), want: name.slice(0, 40), now: String(el.value).slice(0, 40) });
    return took();
  }
  // A click the way a mouse makes one: pointer and mouse press and release at the element's middle,
  // then the click (sites that act on the press ignore a bare click()).
  const mouse = el => {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    ownClick = true;
    for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown']) el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, { ...o, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, o));
    // No focus here: Workday closes the list when its box loses focus, before the click lands.
    for (const t of ['pointerup', 'mouseup']) el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, { ...o, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, o));
    el.click();
    ownClick = false;
  };
  // Asking the extension to act as you would (through the browser's debugger, the one way an
  // extension can): a real click, real typing, a real key. null when it can't (not the extension,
  // or it didn't answer). Chrome shows "started debugging this browser" while it does; that bar goes
  // again a while after the last one.
  const extSaid = new Set(); // each kind of failure is written down once
  const ext = (kind, data, ms = 4000) => new Promise(res => {
    if (!EXT) return res(null);
    const t = setTimeout(() => res(null), ms);
    try { chrome.runtime.sendMessage({ jobhunt: kind, data: data || {} }, v => { clearTimeout(t); void chrome.runtime.lastError; if (v && !v.ok && !extSaid.has(kind + v.error)) { extSaid.add(kind + v.error); trace(`${kind} failed: ${v.error}`); } res(v && v.ok ? (v.v || v) : null); }); }
    catch (e) { clearTimeout(t); res(null); }
  });
  // The debugger, on and ready. When it has just come on, its bar moves the page down: wait for
  // that before aiming a click (a click aimed before it showed lands a row too high).
  const debugReady = async () => { const v = await ext('debug'); if (v && v.fresh) await wait(1500); return !!v; };
  // A real click on an element: Workday's lists ignore clicks a page script makes, however
  // mouse-like. Aimed near the element's left (its tick box and the start of its name), or its middle.
  const realClick = async (el, middle) => {
    if (!EXT || !el || !el.isConnected || !(await debugReady()) || !el.isConnected) return false;
    el.scrollIntoView({ block: 'nearest' });
    await wait(60);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return !!(await ext('click', { x: r.left + (middle ? r.width / 2 : Math.min(r.width / 2, 60)), y: r.top + r.height / 2 }));
  };
  const pressKey = (el, k) => {
    for (const t of ['keydown', 'keypress', 'keyup']) {
      const n = k === 'Enter' ? 13 : k === 'Escape' ? 27 : k === 'ArrowDown' ? 40 : 0;
      // keyCode in the event itself as well: the extension's script runs beside the page's, which
      // doesn't see properties added to the event afterwards.
      const e = new KeyboardEvent(t, { key: k, code: k, keyCode: n, which: n, charCode: t === 'keypress' ? n : 0, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'keyCode', { get: () => n }); Object.defineProperty(e, 'which', { get: () => n });
      el.dispatchEvent(e);
    }
  };
  const typeIn = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // The options of the list that's open. Not the items already chosen: Workday draws each of those
  // with the same markup as an option, inside the box (they were taken for search results).
  const CHOSEN = '[data-automation-id=selectedItem],[data-automation-id=selectedItemList],[data-automation-id=multiselectInputContainer]';
  // Nor the line a list shows when a search found nothing: Workday draws "No Items." as an option.
  const options = () => [...document.querySelectorAll('[data-automation-id=promptOption],[role=option]')].filter(o => !own(o) && !o.closest(CHOSEN) && shown(o) && clean(o.textContent) && !/^no (items|results|matches|options)\.?$/i.test(clean(o.textContent)));
  // The site saying a search found nothing ("No Items."), in the box's field or in the list that opened.
  const NOTHING = /\bno (items|results|matches|options)\b/i;
  const LISTS = '[data-automation-id=activeListContainer],[data-automation-id*=noResult],[data-automation-id=popupContent],[role=listbox],[role=dialog]';
  // Each skill: search for it, wait for the site's matches, choose the closest (the same name, else
  // one that starts with it or holds it), make sure the site took it, then the next. `one`: a box
  // that takes a single item (Field of Study).
  async function fillSkills(first, v, one) {
    const want = String(v).split(/\s*[;\n]\s*/).map(clean).filter(Boolean).slice(0, one ? 1 : 12);
    // Workday redraws the box after each skill: find it again each time (by its id, else in its field).
    const field = first.closest('[data-automation-id^=formField]') || first.parentElement?.parentElement?.parentElement || document.body;
    const box = () => first.isConnected ? first : (first.id && document.getElementById(first.id)) || [...field.querySelectorAll('input')].find(x => shown(x) && !own(x)) || first;
    const sig = () => options().map(o => clean(o.textContent)).join('|');
    const label = o => clean(o.getAttribute('data-automation-label') || o.textContent).toLowerCase();
    const bare = x => x.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
    const words = x => x.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9+#]+/).filter(w => w.length > 1 && !['and', 'the', 'for', 'of', '&'].includes(w)).map(w => w.slice(0, 6));
    // How well an option fits a skill: the same name best, then one that starts with it or holds it,
    // then the share of their words they have in common (both ways, so "Management" alone doesn't
    // pass for "Vendor Management").
    // A certificate's short form, spelled out: lists name them in full, often after who issues them
    // ("Project Management Institute - Project Management Professional"), where "PMP" finds nothing.
    const FULL = { pmp: 'Project Management Professional', capm: 'Certified Associate in Project Management', pgmp: 'Program Management Professional', pfmp: 'Portfolio Management Professional',
      'pmi-acp': 'Agile Certified Practitioner', 'pmi-pba': 'Professional in Business Analysis', 'pmi-rmp': 'Risk Management Professional', 'pmi-sp': 'Scheduling Professional',
      csm: 'Certified ScrumMaster', cspo: 'Certified Scrum Product Owner', psm: 'Professional Scrum Master', pspo: 'Professional Scrum Product Owner', safe: 'Scaled Agile',
      cbap: 'Certified Business Analysis Professional', ccba: 'Certification of Capability in Business Analysis', cpa: 'Chartered Professional Accountant', cfa: 'Chartered Financial Analyst',
      cissp: 'Certified Information Systems Security Professional', cisa: 'Certified Information Systems Auditor', cism: 'Certified Information Security Manager',
      prince2: 'PRINCE2', lssgb: 'Lean Six Sigma Green Belt', lssbb: 'Lean Six Sigma Black Belt', mba: 'Master of Business Administration' };
    const full = skill => FULL[skill.toLowerCase().replace(/[®™.]/g, '').replace(/\s+/g, ' ').trim()] || '';
    // The name after who issues it: "Project Management Professional" of "Project Management Institute - Project Management Professional".
    const tail = x => x.includes(' - ') ? x.slice(x.lastIndexOf(' - ') + 3).trim() : '';
    const fit = (o, skill) => Math.max(fit1(label(o), skill), tail(label(o)) ? fit1(tail(label(o)), skill) : 0, full(skill) ? Math.max(fit1(label(o), full(skill)), tail(label(o)) ? fit1(tail(label(o)), full(skill)) : 0) : 0);
    const fit1 = (x, skill) => {
      const s = skill.toLowerCase();
      if (!x || /^(search results|no (items|results|matches)|searching|loading)/.test(x)) return 0;
      if (x === s || bare(x) === bare(s)) return 100;
      // Its short form in brackets, either way round: "PMP" is "Project Management Professional (PMP)".
      const abbrs = t => [...t.matchAll(/\(([^)]{2,12})\)/g)].map(m => m[1].trim());
      const abbr = t => abbrs(t)[0] || '';
      if (abbrs(x).some(a => a === s || (abbr(s) && a === abbr(s))) || (abbr(s) && abbr(s) === x)) return 95;
      const a = words(s), b = words(x);
      const common = a.filter(w => b.includes(w)).length;
      let n = a.length && b.length ? 60 * common / Math.max(a.length, b.length) : 0;
      if (x.startsWith(s)) n += 25; else if (x.includes(s)) n += 20; else if (s.includes(x) && b.length > 1) n += 10;
      return n;
    };
    // Close enough to choose: a good fit, or a plainer name for the same thing (every word of the
    // option is in the skill: "Payments" for "Payments Integration"). Not a different thing that
    // shares a word ("Vendor Relations" for "Vendor Management").
    const closeEnough = (o, skill, score) => score >= 45 || (score >= 30 && words(label(o)).every(w => words(skill).includes(w)));
    // The chosen items, as far as they can be seen: named pills, and how many items the box's own
    // list of chosen ones holds (Workday's selectedItemList), whatever they look like.
    const names = () => skillPills(box());
    const kids = () => { const l = field !== document.body && field.querySelector('[data-automation-id=selectedItemList]'); return l ? l.children.length : -1; };
    const rowOf = o => o.closest('[role=option],[data-automation-id=menuItem],li') || o;
    const tick = o => rowOf(o).querySelector('input[type=checkbox],input[type=radio]');
    // An option the site shows as chosen: its tick box is ticked, or it's marked selected.
    // (Not aria-selected in Workday's lists: there it marks the row the keyboard is on, the first
    // one after every search. Read as "chosen", it left every skill unclicked.)
    const lit = x => x.getAttribute('data-automation-id') === 'menuItem' || !!x.closest('[data-automation-id=activeListContainer]');
    const ticked = o => { const r = rowOf(o), c = tick(o); return !!(c && c.checked) || [o, r].some(x => (x.getAttribute('aria-selected') === 'true' && !lit(r)) || x.getAttribute('aria-checked') === 'true') || !!r.querySelector('[aria-checked=true]'); };
    // Whether this option's state can be seen at all. When it can't, one real click is trusted and
    // never repeated: a second click would untick it.
    const visible = o => !!tick(o) || [o, rowOf(o)].some(x => (x.hasAttribute('aria-selected') && !lit(rowOf(o))) || x.hasAttribute('aria-checked')) || kids() >= 0 || names().length > 0;
    const find = name => { const l = options().filter(o => same(o.getAttribute('data-automation-label') || o.textContent, name)); return l.find(o => o.matches('[data-automation-id=promptOption]')) || l[0] || null; };
    const nothing = () => !options().length && ([...document.querySelectorAll('[data-automation-id=promptOption],[role=option]')].some(o => !own(o) && !o.closest(CHOSEN) && shown(o) && NOTHING.test(clean(o.textContent))) || NOTHING.test(clean(field === document.body ? '' : field.textContent || '')) || [...document.querySelectorAll(LISTS)].some(x => !own(x) && shown(x) && NOTHING.test(clean(x.textContent).slice(0, 200))));
    // The search took an item by itself: with one match, Workday's Enter chooses it and closes the
    // list (the school's "Other" became "Other School" that way, and was then reported as not found).
    const tookItself = had => names().find(p => !had.some(h => same(h, p))) || '';
    // Typing the way the page takes it: as a script does (most sites), or as real typing through the
    // extension when the site didn't react to that.
    let trusted = false, scriptWorks = false, silent = false;
    const trace = [];
    const search = async query => {
      if (options().length || nothing()) { pressKey(box(), 'Escape'); await wait(350); }
      const el = box();
      const before = sig();
      let added = 0;
      const seen = new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && !own(n)) added++; });
      seen.observe(document.body, { childList: true, subtree: true });
      const t0 = Date.now();
      el.focus(); el.click();
      typeIn(el, '');
      await wait(150);
      if (trusted) { el.focus(); await ext('type', { text: query }); await wait(250); await ext('key', { key: 'Enter' }); }
      else { typeIn(el, query); await wait(300); pressKey(el, 'Enter'); }
      const key = words(query);
      const ours = l => l.some(o => key.some(w => label(o).includes(w)));
      let list = [], none = 0, reacted = true;
      // A list that never says "No items" is waited on in full once; after that, five seconds.
      const looks = silent ? 30 : 70;
      for (let i = 0; i < looks; i++) {
        await wait(170);
        list = options();
        const busy = !list.length || /^(searching|loading)/i.test(clean(list[0].textContent));
        if (!busy && (ours(list) || (sig() !== before && i > 30))) break;
        // "No Items", twice in a row and not straight away (the last search's may still be showing).
        none = i > 3 && nothing() ? none + 1 : 0;
        if (none >= 2) { list = []; break; }
        // Nothing on the page changed in three seconds: the site didn't take the typing.
        if (i === 18 && !added && !list.length) { reacted = false; break; }
      }
      seen.disconnect();
      if (reacted && !list.length && none < 2) silent = true;
      if (!reacted && EXT && !trusted && !scriptWorks) { trusted = true; return search(query); }
      if (reacted && !trusted) scriptWorks = true;
      // Settled: the same list three looks in a row (Workday fills it in a bit at a time).
      if (list.length) { let last = sig(), same3 = 0; for (let i = 0; i < 20 && same3 < 3; i++) { await wait(220); const now = sig(); same3 = now === last ? same3 + 1 : 0; last = now; } }
      list = options();
      trace.push({ q: query, found: list.length, ms: Date.now() - t0, real: trusted || undefined, reacted: reacted || undefined, hidden: document.hidden || undefined,
        top: [...new Set(list.map(o => clean(o.getAttribute('data-automation-label') || o.textContent).slice(0, 70)))].slice(0, 8) });
      return list;
    };
    // Choosing with real arrow keys and Enter, when clicks didn't take: only when the row the keys
    // are on can be seen to be the right one (or it's the only one), so a wrong skill is never added.
    // `nudge`: the row marked as the keyboard's (aria-selected, on the first row after a search)
    // wasn't really under the keys, and Enter searched again instead of choosing. Step down onto
    // the list first, and back up if that went past the row.
    const byKeys = async (name, nudge) => {
      const rows = () => [...new Set(options().map(rowOf))].filter(shown);
      const mine = r => same(r.querySelector('[data-automation-label]')?.getAttribute('data-automation-label') || r.textContent, name);
      if (!rows().some(mine)) return false;
      const on = () => { const id = box().getAttribute('aria-activedescendant'); const a = (id && document.getElementById(id)) || (document.activeElement && document.activeElement.closest && document.activeElement.closest('[role=option]')) || rows().find(r => /\b(active|focus(ed)?|highlight(ed)?|hover(ed)?)\b/i.test(r.className || '')) || rows().find(r => lit(r) && r.getAttribute('aria-selected') === 'true'); return a ? rowOf(a) : null; };
      box().focus();
      if (nudge) {
        if (!(await ext('key', { key: 'ArrowDown' }))) return false;
        await wait(160);
        const a = on();
        if (!(a && mine(a)) && rows().length > 1 && rows().findIndex(mine) < rows().indexOf(a)) { await ext('key', { key: 'ArrowUp' }); await wait(160); }
      }
      for (let i = 0; i < 8; i++) {
        const a = on();
        if (a && mine(a)) break;
        if (!(await ext('key', { key: 'ArrowDown' }))) return false;
        await wait(140);
      }
      const a = on();
      if (!(a ? mine(a) : rows().length === 1)) return false;
      return !!(await ext('key', { key: 'Enter' }));
    };
    // Choose an option and make sure the site took it. Says how ('click', 'box', 'keys', 'mouse',
    // 'already'), 'unseen' when it was clicked but the site shows no sign either way, or ''.
    const choose = async (best, name) => {
      const was = { kids: kids(), names: names().length };
      const got = () => names().some(p => same(p, name) || near(p, name)) || kids() > Math.max(0, was.kids) || names().length > was.names || options().some(o => same(o.getAttribute('data-automation-label') || o.textContent, name) && ticked(o));
      const settle = async ms => { for (let i = 0; i < ms / 200; i++) { if (got()) return true; await wait(200); } return got(); };
      const cur = () => find(name) || (best.isConnected ? best : null);
      if (cur() && ticked(cur())) return 'already';
      if (EXT) {
        const canSee = visible(cur() || best);
        if (await realClick(cur())) { if (await settle(canSee ? 4000 : 1500)) return 'click'; if (!canSee) return 'unseen'; }
        // Not taken, and it shows as not chosen: its tick box itself, then the keyboard.
        let t = cur();
        const c = t && tick(t);
        if (t && c && !ticked(t) && shown(c) && await realClick(c, true) && await settle(3000)) return 'box';
        t = cur();
        if (t && !ticked(t) && !got() && await byKeys(name) && await settle(3000)) return 'keys';
        for (let i = 0; i < 15 && !got() && !find(name); i++) await wait(200);
        t = cur();
        if (t && find(name) && !ticked(t) && !got() && await byKeys(name, true) && await settle(3000)) return 'keys';
        if (got()) return 'click';
      }
      // Without real clicks (the app's window, or the phone): a mouse-like press on the option, its box, its row.
      const b = cur() || best;
      for (const t of [b, tick(b), rowOf(b), b.querySelector('[data-automation-id=promptOption]')].filter((x, i, a) => x && a.indexOf(x) === i)) {
        if (!t.isConnected || got()) break;
        mouse(t);
        if (await settle(1500)) return 'mouse';
      }
      return got() ? 'mouse' : '';
    };
    let added = 0;
    diag.skills ||= [];
    // A school is that school or none: "American University" isn't "American University of Kuwait".
    const strict = one && /school|university|college|institution/i.test(labelOf(first));
    const chosenNames = [];
    for (const skill of want) {
      if (names().some(p => same(p, skill))) { added++; skillMiss = skillMiss.filter(x => !same(x, skill)); continue; }
      // The skill as written, then plainer searches when the list has nothing close: without its
      // plural, its first two words, its last two, its first word ("Payments Integration" finds
      // nothing, "Payments" does).
      const plain = skill.replace(/\s*\([^)]*\)/g, ''), parts = plain.split(/\s+/);
      const queries = [skill, plain.replace(/(\w{3,})s\b/g, '$1'), parts.length > 2 ? parts.slice(0, 2).join(' ') : '', parts.length > 2 ? parts.slice(-2).join(' ') : '', parts.length > 1 && parts[0].length > 3 ? parts[0] : '']
        .concat(full(skill) ? [full(skill)] : [])
        .filter((q, i, a) => q && a.findIndex(x => x.toLowerCase() === q.toLowerCase()) === i);
      let list = [], best = null, score = 0;
      // Said while it looks (a list that answers slowly took a minute a box, and looked stuck).
      const boxName = clean(labelOf(first) || '').slice(0, 40) || 'list';
      status(`Looking for “${skill.slice(0, 50)}” in the site's ${boxName} list…${document.hidden ? ' (This tab is behind another: the browser slows it there. Keep it in front for a quicker fill.)' : ''}`);
      // Real clicks need the browser's debugger, whose bar moves the page (and closes an open list)
      // when it comes on: on before the list is opened, not at the first click. (The first skill
      // and Field of Study were "not taken" for that.)
      if (EXT) await debugReady();
      trace.length = 0;
      const had = names();
      let itself = '';
      for (const q of queries) {
        list = await search(q);
        const p = tookItself(had);
        if (p) {
          const f = Math.max(fit1(p.toLowerCase(), skill), full(skill) ? fit1(p.toLowerCase(), full(skill)) : 0, tail(p.toLowerCase()) ? fit1(tail(p.toLowerCase()), skill) : 0);
          if (strict ? f >= 95 : f >= 45) { itself = p; break; }
          // Not what was meant: taken off again (a box of one is simply chosen over).
          diag.skills.push({ skill, tookItself: p, q, wrong: true });
          if (!one) { const pill = [...field.querySelectorAll('[data-automation-id=selectedItem]')].find(x => same(x.textContent, p)), del = pill && pill.querySelector('[data-automation-id=DELETE_charm]'); if (del) { await realClick(del, true); await wait(400); } }
        }
        for (const o of list) { const f = fit(o, skill); if (f > score && (strict ? f >= 95 : closeEnough(o, skill, f))) { score = f; best = o; } }
        if (score >= 45 || strict) break;
      }
      if (itself) {
        diag.skills.push({ skill, searches: trace.slice(), chose: itself, how: 'enter' });
        added++; skillMiss = skillMiss.filter(x => !same(x, skill)); chosenNames.push([skill, itself]);
        if (box().value) typeIn(box(), '');
        await wait(250);
        continue;
      }
      // A box that takes one item, and the site's list doesn't have yours: its "Other" (or "Not
      // Applicable"), as such forms ask for, and said in the panel so you can check it.
      let other = '';
      if (!best && one) {
        for (const alt of ['Other', 'Not Applicable']) {
          list = await search(alt);
          // Chosen by the search itself ("Other School", "Not Applicable - Not Applicable").
          const p = tookItself(had);
          if (p && new RegExp('^' + alt + '\\b', 'i').test(p)) {
            diag.skills.push({ skill, searches: trace.slice(), chose: p, how: 'enter', other: alt });
            const what = labelOf(first) || 'a box'; if (!otherChosen.includes(what)) otherChosen.push(what);
            added++; skillMiss = skillMiss.filter(x => !same(x, skill)); chosenNames.push([skill, p]);
            itself = p;
            break;
          }
          const a = alt.toLowerCase();
          best = list.find(o => label(o) === a) || list.find(o => tail(label(o)) === a) || list.find(o => new RegExp('^' + alt + '\\b', 'i').test(label(o)) && label(o).length < 30) || null;
          if (best) { other = alt; score = 100; break; }
        }
      }
      if (itself) { if (box().value) typeIn(box(), ''); await wait(250); continue; }
      const log = { skill, searches: trace.slice() };
      diag.skills.push(log);
      if (!best) {
        if (!skillMiss.some(x => same(x, skill))) skillMiss.push(skill);
        log.notInList = list.slice(0, 8).map(o => clean(o.textContent).slice(0, 60));
        if (!diag.skill) diag.skill = { skill, notInList: true, options: list.slice(0, 10).map(o => ({ text: clean(o.textContent).slice(0, 60), label: o.getAttribute('data-automation-label'), at: where(o) })), typed: box().value, box: htmlOf(field, 2500) };
        pressKey(box(), 'Escape'); await wait(250); typeIn(box(), ''); await wait(300);
        continue;
      }
      // The list as it is now (a plainer search may have replaced the one the best match came from).
      const name = clean(best.getAttribute('data-automation-label') || best.textContent);
      if (!best.isConnected && !find(name)) await search(name);
      const snap = ((find(name) || best).closest('[role=listbox]') || best.parentElement?.parentElement || best).cloneNode(true);
      const how = await choose(best, name);
      Object.assign(log, { chose: name, fit: Math.round(score), how: how || 'not taken' });
      if (how) chosenNames.push([skill, name]);
      if (how && other) { const what = labelOf(first) || 'a box'; if (!otherChosen.includes(what)) otherChosen.push(what); }
      if (how === 'unseen') { added++; skillMiss = skillMiss.filter(x => !same(x, skill)); if (!skillUnsure.some(x => same(x, name))) skillUnsure.push(name); }
      else if (how) { added++; skillMiss = skillMiss.filter(x => !same(x, skill)); }
      else if (!skillMiss.some(x => same(x, skill))) {
        skillMiss.push(skill);
        if (!diag.skill) diag.skill = { skill, chose: name, options: list.slice(0, 6).map(o => ({ text: clean(o.textContent).slice(0, 60), at: where(o) })), list: htmlOf(snap, 6000), pills: names(), box: htmlOf(field, 2500) };
      }
      // A moment for the site to redraw the box, then clear it for the next.
      await wait(500);
      if (options().length) { pressKey(box(), 'Escape'); await wait(300); }
      if (box().value) typeIn(box(), '');
      await wait(250);
    }
    // What the site shows as chosen, once it's all done: a skill that was clicked but isn't there
    // (the site didn't keep it, or a redraw emptied the box) is reported, never passed off as added.
    if (!one && added) {
      await wait(700);
      const have = names(), count = Math.max(kids(), have.length);
      const lost = count <= 0 ? chosenNames : have.length ? chosenNames.filter(([, n]) => !have.some(p => same(p, n) || near(p, n))) : [];
      if (lost.length) {
        diag.skillsLost = { shown: have, count, lost: lost.map(x => x[0]), box: htmlOf(field, 2500) };
        for (const [skill, n] of lost) { if (!skillMiss.some(x => same(x, skill))) skillMiss.push(skill); skillUnsure = skillUnsure.filter(x => !same(x, n)); }
        added -= lost.length;
      }
    }
    return added > 0;
  }
  // One box, kept from stopping the rest: an error in it, or a list that never answers, is written
  // down and the box left for you (amber).
  const guarded = (f, work) => {
    const limit = ['skills', 'prompt'].includes(f.type) ? 300000 : 90000;
    let timer;
    return Promise.race([
      Promise.resolve().then(work).catch(e => { trace(`box "${String(f.label || '').slice(0, 50)}" (${f.type}) failed: ${e && e.message || e}`); return false; }),
      new Promise(res => { timer = setTimeout(() => { trace(`box "${String(f.label || '').slice(0, 50)}" (${f.type}) took over ${limit / 1000}s: left for you`); res(false); }, limit); }),
    ]).finally(() => clearTimeout(timer));
  };
  window.__jobhunt = {
    status,
    // Which copy this is, and whether it can still reach its extension (after an update it can't,
    // and a new copy is put on the page).
    version: EXT ? chrome.runtime.getManifest().version : '',
    alive: () => !EXT || !!(chrome.runtime && chrome.runtime.id),
    trail: () => trail,
    // Fill the form in. Something unexpected on the page part-way (a box that vanished, a site's own
    // script throwing): the form is read again and filled once more, then it's said plainly.
    async fill(answer) {
      for (let attempt = 0; ; attempt++) {
        try { return await this.fillNow(answer); }
        catch (e) {
          trace(`error while filling (attempt ${attempt + 1}): ${e && e.stack || e}`);
          if (attempt >= 1) {
            flush('fill error');
            ext('undebug');
            if (buttons.diag) buttons.diag.hidden = false;
            return this.failed('Something on this page stopped Job Hunt part-way. Check what was filled, then press Fill in this form again; Copy details has what happened.');
          }
          sent = null;
          status('The page changed under Job Hunt; reading it again…');
          await wait(700);
        }
      }
    },
    async fillNow(answer) {
      if (retired) return;
      waitingSince = 0;
      if (answer.job && headEl) headEl.textContent = answer.profile ? `Job Hunt · your profile on ${answer.job.company}` : `Job Hunt · ${answer.job.company}`;
      // The answers go to the boxes as they were when the form was sent (boxes added or moved since
      // would shift them); read again only if the page replaced them.
      if (sent && Object.values(sent.byKey).every(els => els.every(e => e.isConnected))) ({ fields, byKey, adders } = sent);
      else collect();
      sent = null;
      // Your CV has more jobs or schools than the form shows: press its Add buttons first, then read
      // the form again and fill every entry at once (a redraw after filling could empty the boxes).
      if (round < 1) diag = { version: ME, adds: fields.filter(f => f.type === 'add').map(f => ({ label: f.label, section: f.section, entries: f.entries, answer: answer.values && answer.values[f.key] })), roles: answer.roles,
        addButtons: [...document.querySelectorAll('button,[role=button],a')].filter(b => !own(b) && /^\s*\+?\s*add\b/i.test(clean(b.textContent || b.getAttribute('aria-label') || ''))).slice(0, 12).map(b => ({ text: clean(b.textContent || '').slice(0, 50), aria: b.getAttribute('aria-label'), shown: shown(b), section: sectionOf(b), at: where(b) })),
        headings: heads.map(h => textOf(h).slice(0, 50)).slice(0, 40),
        files: Object.keys(answer.files || {}).map(k => ({ key: k, name: answer.files[k] && (answer.files[k].name || answer.files[k].kind) })), note: answer.note, job: answer.job && `${answer.job.title} at ${answer.job.company}`,
        // Where files go on this page (an upload area can be a drop zone with its file box hidden).
        uploads: [...document.querySelectorAll('input[type=file],[data-automation-id*="file-upload" i],[data-automation-id*="attachments" i],[class*="dropzone" i]')].filter(x => !own(x)).slice(0, 6).map(x => ({ at: where(x), shown: shown(x), html: htmlOf(x, 700) })) };
      // How many to add: Claude's answer, and for jobs at least what your CV has more than the form.
      const isWork = f => /experience|employment|work|job|position/i.test(f.section || '');
      const howMany = f => Math.max(parseInt(answer.values && answer.values[f.key], 10) || 0, isWork(f) ? (answer.roles || 0) - (f.entries || 0) : 0);
      const adds = round < 1 ? fields.filter(f => f.type === 'add' && howMany(f) > 0) : [];
      if (adds.length) {
        round++;
        let added = 0;
        const what = [];
        for (const f of adds) {
          const was = added;
          const want = Math.min(8, howMany(f));
          for (let i = 0; i < want; i++) {
            let b = adders[f.key];
            if (!b || !b.isConnected || !shown(b)) {
              collect();
              b = Object.keys(adders).map(k => fields.find(x => x.key === k)).filter(x => x && x.section === f.section).map(x => adders[x.key])[0];
            }
            if (!b) break;
            ownClick = true; b.click(); ownClick = false; added++;
            await wait(900);
          }
          if (added > was) what.push(`${added - was} ${f.section}`);
        }
        if (added) {
          addNote = `Added ${what.join(', ')} from your CV.`;
          progress(barAt());
          status(`Added ${what.join(', ')} from your CV; filling in the form…`);
          await wait(600);
          start(true);
          return;
        }
      }
      // Why no job was added, when the form has fewer than your CV: said in the panel.
      const work = fields.find(f => f.type === 'add' && /experience|employment|work|job|position/i.test(f.section || ''));
      if (round < 1 && !addNote) {
        if (work && answer.roles > (work.entries || 0)) addNote = `Your CV has ${answer.roles} jobs, but Workday's ${work.label} for ${work.section} didn't add any.`;
        else if (!work && /work experience|employment/i.test(document.body.innerText || '') && answer.roles) addNote = `Job Hunt didn't find the Add button for your jobs on this page.`;
      }
      amber = []; amberAt = 0; toggled = false; replaceAsk = []; if (askEl) askEl.hidden = true;
      let ok = 0, todo = 0, i = 0;
      const base = barAt(), total = fields.length || 1;
      progress(base);
      status('Filling in the form…');
      for (const f of fields) {
        progress(base + (100 - base) * (i++ / total));
        if (f.type === 'add') continue;
        const file = answer.files && answer.files[f.key];
        const v = answer.values && answer.values[f.key];
        const done = await guarded(f, () => fillOne(f, v, file));
        // For Copy details: what each box got (no values: the labels and whether each was filled).
        // (Now also what Job Hunt meant to put in each box and what the box held afterwards, so a
        // wrong or missing answer can be traced: it's your own details, copied only when you press it.)
        { const e = (byKey[f.key] || [])[0], live = e && e.isConnected;
          const now = !live ? '(box replaced)' : e.type === 'checkbox' || e.type === 'radio' ? String(e.checked) : e.type === 'file' ? (e.files && e.files.length ? e.files[0].name : '') : e.tagName === 'SELECT' ? clean((e.options[e.selectedIndex] || {}).text || '') : clean(e.value || e.getAttribute('aria-label') || e.textContent || '');
          (diag.fields ||= []).push({ key: f.key, label: String(f.label || '').slice(0, 60), type: f.type, section: f.section, required: f.required || undefined, had: f.value ? String(f.value).slice(0, 60) : '', want: file ? `file: ${file.name || file.kind || 'yes'}` : v == null ? null : String(v).slice(0, 80), now: String(now).slice(0, 80), filled: !!done,
            options: f.options ? f.options.slice(0, 15) : undefined, at: live ? where(e) : undefined,
            html: live && (f.type === 'file' || (!done && (v != null && v !== '' || file))) ? htmlOf(e.closest('[data-automation-id^="formField"],[data-automation-id*="attachments" i],fieldset,li,section') || e.parentElement, 1500) : undefined }); }
        // Green is what Job Hunt filled; a box the site (or you) had filled already isn't marked.
        const theirs = f.value !== '' && f.type !== 'file' && (v == null || v === '' || same(f.value, v));
        if (theirs && done) continue;
        // Not yours to fix: the end date of the job you're in ("Present": its box goes when I currently
        // work here is ticked), and an upload box for a certificate or transcript that isn't asked for.
        const present = f.type === 'date' && /^(present|current|now|ongoing)$/i.test(String(v || '').trim());
        const sideFile = f.type === 'file' && !file && !f.required && /certif|licen|transcript|portfolio|reference/i.test(`${f.label} ${f.section}`);
        if (present || sideFile) continue;
        const matters = f.required || done || v || f.type === 'file';
        if (!matters) continue;
        mark((byKey[f.key] || [])[0], done);
        if (done) ok++; else todo++;
      }
      // Unticking "I currently work here" shows that job's end date: read the form again once and
      // fill the boxes that appeared.
      if (toggled && reveals < 1) {
        await wait(800);
        const had = new Set(Object.values(byKey).flat());
        const appeared = collect().some(f => f.type !== 'add' && f.type !== 'file' && !f.value && !(byKey[f.key] || []).some(e => had.has(e)));
        if (appeared) { reveals++; round = Math.max(round, 1); status('Unticked "I currently work here" on past jobs; filling in their end dates…'); start(true, true); return; }
      }
      filled = true;
      trace('filled', { ok, todo, boxes: fields.length });
      flush();
      // Done with real clicks and keys: let the browser's debugger go now, not two minutes on.
      ext('undebug');
      progress(100);
      setTimeout(() => { if (!barTimer) progress(null); }, 2500);
      buttons.fill.disabled = false; buttons.fill.textContent = 'Fill in again';
      // A profile isn't an application: nothing to mark as submitted or to set aside.
      buttons.next.hidden = !todo; buttons.applied.hidden = !!answer.profile; if (answer.profile) buttons.drop.hidden = true;
      buttons.diag.hidden = false; // what Job Hunt saw and did, to paste to Claude when something's off
      const saved = ((answer.banked || []).length ? ` ${answer.banked.length} from your saved answers.` : '') + (addNote ? ' ' + addNote : '') + (answer.note ? ' ' + answer.note : '') + (skillMiss.length ? ` Not in the site's list, or not taken (add these yourself): ${skillMiss.join(', ')}.` : '') + (skillUnsure.length ? ` Chosen, but the site didn't show it: check ${skillUnsure.join(', ')}.` : '') + (otherChosen.length ? ` Not in the site's list, so "Other" was chosen for: ${otherChosen.join(', ')}.` : '')
        + (EXT && answer.app_version && /^\d/.test(answer.app_version) && answer.app_version.replace(/-.*/, '') !== chrome.runtime.getManifest().version ? ` (This extension is ${chrome.runtime.getManifest().version}, Job Hunt is ${answer.app_version}: open the extension's button once so it updates, then reload this page.)` : '');
      status(todo
        ? `Filled ${ok}.${saved} ${todo} for you, in amber: boxes that agree to terms are yours to tick, and Job Hunt leaves anything your CV and facts don't answer. Read the form over, then press its Submit button.`
        : `Filled ${ok}.${saved} Read the form over (green is what Job Hunt filled), then press its Submit button.`);
      if (todo) nextAmber();
      // A file was there already: replace it with Job Hunt's, or keep it?
      if (replaceAsk.length && askEl) {
        const names = replaceAsk.flatMap(r => r.names).filter(Boolean);
        askEl.querySelector('.qt').textContent = `This form has ${names.length ? `"${names.slice(0, 2).join('", "')}"` : 'a file'} attached already. Replace it with Job Hunt's ${replaceAsk.map(r => /letter/i.test(r.file.name) ? 'cover letter' : 'tailored CV').join(' and ')} (${replaceAsk.map(r => r.file.name).join(', ')})?`;
        askEl.hidden = false;
        replaceAsk[0].node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Submitting for you (only if you turned it on, and Job Hunt said this form qualifies): not with
      // anything left for you, a box still unticked or a captcha on the page. Ten seconds to stop it.
      if (answer.auto && !todo && !captcha() && !unticked()) {
        const btn = submitButton();
        if (btn) {
          let left = 10;
          buttons.stop.hidden = false;
          const tick = () => {
            if (!autoTimer && left < 10) return;
            if (left <= 0) { autoTimer = null; buttons.stop.hidden = true; status('Submitting…'); btn.click(); return; }
            status(`All answered from your saved answers. Submitting in ${left}s; Stop to check.`);
            left--; autoTimer = setTimeout(tick, 1000);
          };
          autoTimer = setTimeout(tick, 0);
        }
      }
    },
    start: () => start(),
    // What Job Hunt saw and did on this page (what Copy details copies).
    details: () => diag,
    failed(msg) { waitingSince = 0; waitNote = ''; progress(null); buttons.fill.disabled = false; if (EXT && buttons.diag) buttons.diag.hidden = false; status(msg); },
    // Job Hunt can't tell which application this page is: choose it from your jobs (Submit's first).
    choose(msg, list) {
      waitingSince = 0; progress(null); buttons.fill.disabled = false;
      status(msg);
      if (!chooseEl || !list || !list.length) return;
      const sel = chooseEl.querySelector('select');
      sel.textContent = '';
      const here = (document.title + ' ' + location.hostname).toLowerCase();
      for (const j of list) {
        const o = document.createElement('option');
        o.value = j.id;
        o.textContent = j.id === 'profile' ? 'A profile, from my CV' : `${j.title} · ${j.company}${j.status === 'ready' ? ' (not approved yet)' : ''}`;
        sel.appendChild(o);
      }
      // The button says what it will do with the choice.
      const say = () => { buttons.pick.textContent = sel.value === 'profile' ? 'Fill it in from my CV' : 'Fill it in for this job'; };
      sel.onchange = say;
      // Chosen already: the first whose company the page names (its title or address).
      const named = list.find(j => { const w = String(j.company || '').toLowerCase().split(/\s+/)[0]; return w.length >= 3 && here.includes(w); });
      if (named) sel.value = named.id;
      // A page that reads as your own profile or account, or no job to choose: the profile.
      else if (list.some(j => j.id === 'profile') && (list.length === 1 || /\/(profile|account|my-?(info|profile|account)|resume|experience|education|credentials|candidate)(\/|$|\?)/i.test(location.pathname))) sel.value = 'profile';
      say();
      chooseEl.hidden = false;
      buttons.fill.hidden = true; // one blue button: the one under the list
    },
  };
  // What stops Job Hunt submitting for you: a captcha, or a required box you haven't ticked.
  const captcha = () => !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey]');
  const unticked = () => [...document.querySelectorAll('input[type=checkbox]')].some(c => !own(c) && !c.checked && (c.required || c.getAttribute('aria-required') === 'true'));
  const submitButton = () => [...document.querySelectorAll('button,input[type=submit]')].find(b => !own(b) && shown(b) && (b.type === 'submit' || /submit( application)?|send application/i.test(b.textContent || b.value || '')));
  function nextAmber() {
    if (!amber.length) return;
    amber[amberAt % amber.length].scrollIntoView({ behavior: 'smooth', block: 'center' });
    amberAt++;
  }
  let sent = null, opens = 0, unfolded = false, lettersTried = false, letterOpened = 0;
  try { letterOpened = Number(sessionStorage.getItem('jobhunt-letter') || 0); } catch (e) { /* storage off */ }
  // A form that keeps its cover letter behind a link (Indeed: "Supporting documents", an Add link
  // and "No cover letter or additional documents added"): the link that opens it, or nothing.
  const LETTER_BOX = /cover letter|supporting documents?|motivation letter/i;
  function letterAdder() {
    for (const b of document.querySelectorAll('a,button,[role=button]')) {
      if (own(b) || !shown(b)) continue;
      const t = clean(b.textContent || b.getAttribute('aria-label') || '');
      if (!t || t.length > 45 || !/^\W*(add|upload|attach)\b/i.test(t)) continue;
      if (/\b(resume|cv|experience|education|skill|language|certif|licen[cs]e|link|website|reference)/i.test(t)) continue;
      if (LETTER_BOX.test(t)) return b;
      if (!/^\W*(add|upload|attach)\W*$/i.test(t)) continue;
      // A bare "Add": it's the letter's when the small block around it says so and holds no file yet.
      let node = b;
      for (let i = 0; i < 4 && node.parentElement && node.parentElement !== document.body; i++) {
        node = node.parentElement;
        const said = textOf(node);
        if (said.length > 400) break;
        if (LETTER_BOX.test(said)) { if (!FILE_NAME.test(said) && !node.querySelector('input[type=file],textarea')) return b; break; }
      }
    }
    return null;
  }
  // What's on the page, for Copy details when nothing was filled (or Job Hunt tripped on the page):
  // each box and button with its label, and the form's own markup without what's typed in it.
  const snapshot = () => {
    try {
      return { path: location.pathname, boxes: [...document.querySelectorAll('input,select,textarea,button,a[role=button]')].filter(x => !own(x)).slice(0, 80).map(x => ({ tag: x.tagName.toLowerCase(), type: x.type || undefined, id: x.id || undefined, name: x.name || undefined, shown: shown(x), required: x.required || x.getAttribute('aria-required') === 'true' || undefined,
          label: clean((x.labels && x.labels[0] ? x.labels[0].textContent : '') || x.getAttribute('aria-label') || (/^(BUTTON|A)$/.test(x.tagName) ? x.textContent : '') || x.placeholder || '').slice(0, 70) })),
        html: htmlOf(document.querySelector('main form, form, main') || document.body, 7000) };
    } catch (e) { return { error: String(e && e.stack || e) }; }
  };
  // Pressing Fill in this form always ends in something said. A page that trips Job Hunt (it did
  // nothing on Job Bank's Add a work experience, with nothing to go on) is said so, with what
  // happened and what the page holds in Copy details.
  async function start(more, dates) {
    try { return await startNow(more, dates); }
    catch (e) {
      trace(`error reading the page: ${e && e.stack || e}`);
      diag = { ...diag, version: ME, error: String(e && e.stack || e).slice(0, 1500), snapshot: snapshot() };
      flush('start error');
      waitingSince = 0; waitNote = ''; progress(null);
      if (buttons.fill) buttons.fill.disabled = false;
      if (buttons.diag) buttons.diag.hidden = false;
      status(`Job Hunt tripped on this page (${String(e && e.message || e).slice(0, 120)}). Press Copy details below and send it to Claude; or Copy a brief for Claude to have the Claude extension fill it in.`);
    }
  }
  async function startNow(more, dates) {
    if (!more) { round = 0; reveals = 0; addNote = ''; skillMiss = []; skillUnsure = []; otherChosen = []; }
    panel();
    if (retired) return;
    checkPay();
    // A form whose parts are folded away (SuccessFactors: "Expand all sections", then Profile
    // Information and the rest as closed bars) shows no boxes to read: its parts are opened first.
    if (!more && !unfolded) {
      unfolded = true;
      const said = b => clean(b.textContent || b.getAttribute('aria-label') || '');
      const all = [...document.querySelectorAll('a,button,[role=button]')].find(b => !own(b) && shown(b) && /^\W*expand all( sections)?\W*$/i.test(said(b)));
      // (Closed bars are opened one by one only on a page that shows next to nothing to fill: on a
      // form that's already open, something closed is as likely a menu as a part of the form.)
      const few = collect().filter(f => f.type !== 'add').length < 3;
      const shut = all || !few ? [] : [...document.querySelectorAll('[aria-expanded=false]')].filter(b => !own(b) && shown(b) && b.matches('button,[role=button],a,h2,h3,h4,summary,[role=tab],[class*=accordion i],[class*=section i]') && said(b).length > 2 && said(b).length < 60 && !b.closest('nav,header,[role=navigation],[role=menu],[role=menubar],[role=listbox],[role=combobox]') && !b.hasAttribute('aria-haspopup')).slice(0, 12);
      if (all || shut.length) {
        status('Opening the form\'s sections…');
        trace('opening folded sections', { all: !!all, n: shut.length });
        ownClick = true;
        if (all) all.click(); else for (const b of shut) { b.click(); await wait(150); }
        ownClick = false;
        await wait(1200);
      }
    }
    // The cover letter's place, when the form keeps it behind a link: opened, so the letter goes in
    // with the rest. It may open here or on a page of its own (carried on with there).
    if (!more && !lettersTried) {
      lettersTried = true;
      const before = collect();
      const opener = before.some(f => ['file', 'textarea'].includes(f.type) && /cover|letter|motivation/i.test(`${f.label} ${f.section}`)) ? null : letterAdder();
      if (opener) {
        const name = clean(opener.textContent || opener.getAttribute('aria-label') || 'Add').slice(0, 40), boxes = () => document.querySelectorAll('input[type=file],textarea').length, had = boxes(), from = location.href;
        trace('opening the cover letter\'s place', { name });
        status('Opening the place for your cover letter…');
        letterOpened = Date.now();
        try { sessionStorage.setItem('jobhunt-letter', String(letterOpened)); sessionStorage.setItem('jobhunt-continue', String(letterOpened)); } catch (e) { /* storage off: you press Fill in this form on the next page */ }
        ownClick = true; opener.click(); ownClick = false;
        for (let i = 0; i < 12; i++) { await wait(500); if (boxes() > had || location.href !== from) break; }
        await wait(600);
        // Offered a choice of uploading or writing it: the upload, when the page has no box for it yet.
        if (!document.querySelector('input[type=file]')) {
          const up = [...document.querySelectorAll('a,button,[role=button],label')].find(b => !own(b) && shown(b) && /^\W*upload\b.{0,30}$/i.test(clean(b.textContent || '')) && !/resume|cv\b/i.test(b.textContent || ''));
          if (up && up.tagName !== 'LABEL') { ownClick = true; up.click(); ownClick = false; await wait(900); }
        }
        try { sessionStorage.removeItem('jobhunt-continue'); } catch (e) { /* as above */ }
      }
    }
    if (document.querySelector(DROPS)) { status('Reading the form…'); await readDrops(); }
    const all = collect();
    // An upload box in the place Job Hunt just opened for the letter is the letter's, whatever it's
    // called there ("Upload a file").
    if (Date.now() - letterOpened < 180000) for (const f of all) if (f.type === 'file' && !/resume|r\u00e9sum\u00e9|\bcv\b|curriculum|cover|letter|certif|licen|transcript|portfolio|reference/i.test(`${f.label} ${f.section || ''}`)) f.section = 'Cover letter';
    sent = { fields, byKey, adders };
    // The end dates that appeared: only the boxes still empty go (with the entries' checkboxes), not
    // the whole form again.
    const list = dates ? all.filter(f => !['add', 'file', 'skills', 'prompt'].includes(f.type) && (!f.value || f.type === 'checkbox')) : all;
    // No boxes here, but the page has a button that opens some (a profile's list of jobs with "Add a
    // new experience"): pressed for you. Its form may open on this page (then it's filled now) or
    // on the next one (the extension brings the panel there, and it carries on by itself).
    if (!all.some(f => !['add'].includes(f.type)) && opens < 2) {
      const opener = Object.values(adders).find(b => b && b.isConnected && shown(b))
        || [...document.querySelectorAll('a,button,[role=button]')].find(b => { const t = clean(b.textContent || b.getAttribute('aria-label') || ''); return !own(b) && shown(b) && t.length <= 60 && ADD.test(t) && HISTORY.test(t) && !NOT_ADD.test(t); });
      if (opener) {
        opens++;
        const name = clean(opener.textContent || opener.getAttribute('aria-label') || 'Add').slice(0, 50);
        trace('no boxes here: pressing the page\'s own button', { name });
        status(`Pressing \u201c${name}\u201d to open its form…`);
        try { sessionStorage.setItem('jobhunt-continue', String(Date.now())); } catch (e) { /* storage off: you press Fill in this form on the next page */ }
        ownClick = true; opener.click(); ownClick = false;
        for (let i = 0; i < 16; i++) { await wait(500); if (collect().some(f => !['add', 'file'].includes(f.type))) break; }
        if (collect().some(f => !['add', 'file'].includes(f.type))) { try { sessionStorage.removeItem('jobhunt-continue'); } catch (e) { /* as above */ } return start(more, dates); }
        progress(null); status(`Pressed \u201c${name}\u201d. When its form shows, press Fill in this form.`);
        return;
      }
    }
    if (!list.length) { progress(null); unfolded = false; status('Job Hunt can\'t find a form to fill on this page. If the form is here, press Copy a brief for Claude below and give it to the Claude extension; if it isn\'t yet, open it with the page\'s own button (Apply, or Add), then press Fill in this form.'); return; }
    // No answer in six minutes (Job Hunt closed, Claude busy): the button comes back.
    const mine = waitingSince = Date.now();
    // (In a browser, getAnswers keeps asking and says what it finds: no guessing by the clock.)
    if (!EXT && !PHONE) setTimeout(() => { if (waitingSince === mine) { waitingSince = 0; progress(null); buttons.fill.disabled = false; status('No answer from Job Hunt. Is it running? Try again.'); } }, 360000);
    buttons.fill.disabled = true;
    // About how long Claude takes: longer with more questions (a form with several jobs on it, say).
    const usual = Math.round(15 + list.length * 0.8);
    const n = list.filter(f => f.type !== 'add').length;
    if (!more) progress(0);
    creep(more ? 93 : 75, usual, s => dates
      ? `Filling in the end dates of your past jobs… ${s}s (usually about ${usual}s).${waitNote}`
      : more
      ? `Writing answers for all ${n} boxes, now with every job and school on your CV… ${s}s (usually about ${usual}s).${waitNote}`
      : `Reading ${n} questions and writing answers from your CV… ${s}s (usually about ${usual}s).${waitNote}`);
    trace(dates ? 'reading the end dates' : more ? 'reading the form again' : 'reading the form', { boxes: list.length, host: location.hostname });
    send('fields', { url: location.href, fields: list });
  }

  // When you press the form's Submit button, Job Hunt watches for the site's confirmation ("Thank you
  // for applying", "We've received your application", a /confirmation address) and marks it applied
  // by itself. The press, and the answers as you sent them (kept for next time), are remembered in
  // window.name, which stays with this window when the site moves to another page, even on another
  // domain. Without a confirmation, Job Hunt asks you when you close the window.
  const MARK = 'jobhunt-submitted:';
  const DONE = /thanks? (you )?for (applying|your application|submitting( your application)?|your submission)|application (has been |was |is )?(successfully )?(submitted|received|sent|complete)|we('ve| have)? (successfully )?received your (application|submission|resume|résumé|cv)|your application (has been|was|is) (successfully )?(received|submitted|sent|complete|on its way)|successfully (applied|submitted)|you('ve| have) (successfully )?applied|submission (received|complete|successful)|application complete/i;
  // Only once you've pressed Submit: a polite line many job pages show before you apply, too.
  const DONE_AFTER_PRESS = /thank you for your interest|we('ll| will) (be in touch|review your application|contact you)|thanks?,? we('ve| have) got it/i;
  const DONE_URL = /[/#?&](confirmation|confirm|thank-?you|thanks|success|submitted|application-?(complete|submitted|received)|applied)\b/i;
  const pressed = () => {
    const raw = (window.name || '').startsWith(MARK) ? window.name.slice(MARK.length) : '';
    if (!raw) return null;
    let v;
    try { v = JSON.parse(raw); } catch (e) { v = { at: Number(raw) }; }
    return v && v.at && Date.now() - v.at < 10 * 60 * 1000 ? v : null;
  };
  const pressedAt = () => (pressed() || {}).at || 0;
  let recorded = false;
  const pageText = () => (document.body ? document.body.innerText : '').slice(0, 40000);
  const confirmedHere = strict => DONE.test(pageText()) || (!strict && (DONE_AFTER_PRESS.test(pageText()) || DONE_URL.test(location.href)));
  function recordApplied() {
    if (recorded) return;
    recorded = true;
    const p = pressed();
    window.name = '';
    panel();
    buttons.applied.hidden = true;
    status(JOB.queue && JOB.more ? 'Submitted: the site confirmed it. Marked as applied. Opening the next one…' : 'Submitted: the site confirmed it. Marked as applied in Job Hunt. This window closes in a few seconds.');
    send('applied', { url: location.href, auto: true, fields: (p && p.fields) || [] });
  }
  async function watchForConfirmation(seconds, vouched) {
    for (let i = 0; i < seconds && !recorded; i++) {
      await wait(1000);
      if (pressedAt() && confirmedHere(false)) { recordApplied(); return; }
      if (vouched && confirmedHere(true)) { recordApplied(); return; }
      if (i === 8 && !recorded && pressedAt() && !waitingSince) { panel(); buttons.applied.hidden = false; status('Waiting for the site to confirm… If it went through, press I submitted it.'); }
    }
  }
  // You sent the form: a Submit-like button, or the form itself (Enter, or a button Job Hunt can't name).
  function onPressed() {
    let fields = [];
    if (filled) { try { fields = collect().filter(f => f.type !== 'file').map(f => ({ label: f.label, type: f.type, value: f.value, options: f.options, section: f.section })); } catch (err) { /* the form changed */ } }
    try { window.name = MARK + JSON.stringify({ at: Date.now(), fields: fields.slice(0, 80) }); } catch (e) { window.name = MARK + JSON.stringify({ at: Date.now() }); }
    watchForConfirmation(120);
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button,input[type=submit],[role=button]');
    if (!b || own(b) || ownClick) return;
    const t = clean(b.textContent || b.value || b.getAttribute('aria-label') || '');
    // A page's other buttons are often "submit" too (a button with no type is): Add another, Delete,
    // Save and Continue, Next, Upload… aren't sending the application.
    // Save and Continue / Next on a form of several pages (Workday): keep this page's answers for
    // next time now (your GPA, notice period…), since only the last page is there when you submit.
    if (/^\s*(save and continue|save & continue|next|continue)\b/i.test(t) && ui && !retired) {
      try { send('learn', { fields: collect().filter(f => !['file', 'add', 'skills'].includes(f.type) && f.value).map(f => ({ label: f.label, type: f.type, value: f.value, options: f.options, section: f.section })).slice(0, 80) }); } catch (err) { /* the form changed */ }
    }
    if (NOT_SEND.test(t)) return;
    if ((b.type === 'submit' && b.form) || /^\s*(submit|send)\b|submit (my |your )?application|send (my |your )?application|apply now|complete application|finish application/i.test(b.textContent || b.value || '')) onPressed();
  }, true);
  document.addEventListener('submit', e => { if (!own(e.target) && filled) onPressed(); }, true);
  // Arrived on a new page after pressing Submit: is this the confirmation? (The app also asks each
  // page that loads after it filled the form in this window, for confirmations on another site.)
  if (pressedAt()) watchForConfirmation(30);
  window.__jobhuntAfterFill = () => { if (!recorded && !formHere()) watchForConfirmation(30, true); };

  // Pay stated on the page (the company's posting often has it when the job board's copy didn't):
  // sent once per page, and Job Hunt keeps it if the job had none.
  const PAY = /(?:CA\$|C\$|CAD\s*\$?|US\$|\$)\s?\d[\d,]*(?:\.\d+)?\s?[kK]?\s*(?:-|–|—|to)\s*(?:CA\$|C\$|CAD\s*\$?|US\$|\$)?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?[^.\n]{0,40}/;
  let payChecked = false;
  function checkPay() {
    if (payChecked || !document.body) return;
    const m = (document.body.innerText || '').slice(0, 60000).match(PAY);
    if (m) { payChecked = true; send('salary', { text: m[0] }); }
  }
  // On each page: fill the form by itself the first time one appears, or point the way to it.
  async function look() {
    for (let i = 0; i < 20; i++) {
      await wait(1000);
      if (!document.body) continue;
      panel();
      if (retired) return;
      if (i === 2 || i === 8) checkPay();
      if (filled || recorded) return;
      if (formHere()) {
        const k = 'jobhunt-filled:' + location.href;
        let seen = false;
        try { seen = sessionStorage.getItem(k) === '1'; sessionStorage.setItem(k, '1'); } catch (e) { /* storage off */ }
        if (!seen) start(); else status('Press Fill in this form to fill it in again.');
        return;
      }
      const frame = [...document.querySelectorAll('iframe[src]')].find(f => ATS.test(f.src));
      if (frame) {
        buttons.open.hidden = false;
        buttons.open.onclick = () => { location.href = frame.src; };
        status('The form is inside this page. Press Open the form.');
        return;
      }
      if (i === 2 && !pressedAt()) status('Use the page\'s Apply button to get to the form. Job Hunt fills it in when it appears.');
    }
  }
  if (EXT) {
    panel();
    // The page Job Hunt opened itself a moment ago (it pressed the site's Add button): carried on with.
    let opened = 0;
    try { opened = Number(sessionStorage.getItem('jobhunt-continue') || 0); sessionStorage.removeItem('jobhunt-continue'); } catch (e) { /* storage off */ }
    if (Date.now() - opened < 90000) { status('Filling in the form that opened…'); setTimeout(() => start(), 1200); }
    else status('Press Fill in this form when the form is on screen.');
    return;
  }
  // From the phone's bookmark: tapped with the form on screen, so it starts right away.
  if (PHONE) { panel(); start(); return; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look); else look();
})();
