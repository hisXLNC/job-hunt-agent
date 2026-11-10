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
  // In the window, messages go as an address Job Hunt catches and cancels. A filled-in form usually
  // guards against leaving it ("Leave site? Changes may not be saved"), which would stop the message,
  // so while one goes, that guard is stopped before it runs (this script runs before the page's own).
  let sending = 0;
  window.addEventListener('beforeunload', e => { if (Date.now() - sending < 2000) e.stopImmediatePropagation(); }, true);
  const send = EXT ? (kind, data) => {
    // The extension was updated (or turned off) since this page opened: this copy can't reach it.
    const gone = () => { waitingSince = 0; progress(null); if (buttons.fill) buttons.fill.disabled = false; status('The Job Hunt extension was updated since this page opened. Reload this page (F5), then press Fill this form in the extension again.'); };
    try {
      if (!chrome.runtime || !chrome.runtime.id) return gone();
      const r = chrome.runtime.sendMessage({ jobhunt: kind, data: { ...data, url: location.href, title: document.title } });
      if (r && r.catch) r.catch(e => { if (/invalidated|receiving end/i.test(String(e && e.message))) gone(); });
    } catch (e) { gone(); }
  } : (kind, data) => {
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
  const ME = EXT ? 'ext:' + chrome.runtime.getManifest().version : 'app';
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
      .p{font:14px/1.4 system-ui,'Segoe UI',sans-serif;background:#fff;color:#1d1d1f;border:1px solid #d0d0d6;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:12px 14px;width:300px}
      .h{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}.h span{flex:1}
      .x{border:0;background:none;font-size:18px;cursor:pointer;color:#666;padding:0 4px}
      .s{color:#444;margin:0 0 10px}.r{display:flex;flex-wrap:wrap;gap:6px}
      button.b{font:inherit;border:1px solid #c8c8d0;background:#f6f6f8;border-radius:8px;padding:6px 10px;cursor:pointer}
      button.b.pr{background:#2f5bd3;border-color:#2f5bd3;color:#fff}button.b[hidden]{display:none}button.b:disabled{opacity:.6;cursor:default}
      .bar{height:6px;background:#e6e8ef;border-radius:3px;overflow:hidden;margin:0 0 10px}.bar i{display:block;height:100%;width:0;background:#2f5bd3;transition:width .45s}
      .min .s,.min .r,.min .bar,.min .c{display:none}
      .q{margin:0 0 10px;padding:8px 10px;border:1px solid #e0a000;border-radius:8px;background:#fff8e6}.q[hidden]{display:none}.q p{margin:0 0 6px}.min .q{display:none}
      .c{display:flex;flex-direction:column;gap:6px;margin:0 0 10px}.c[hidden]{display:none}.c select{font:inherit;padding:6px;border:1px solid #c8c8d0;border-radius:8px;max-width:100%}
    </style><div class="p"><div class="h"><span class="t">Job Hunt · ${(JOB.company || '').replace(/[<>&]/g, '')}${JOB.queue ? ` · ${JOB.queue}` : ''}</span><button class="x" title="Smaller">–</button></div>
      <p class="s"></p><div class="q" hidden><p class="qt"></p><div class="r"><button class="b pr" data-k="replace">Replace with Job Hunt's</button><button class="b" data-k="keep">Keep it</button></div></div><div class="c" hidden><select></select><button class="b pr" data-k="pick">Fill it in for this job</button></div><div class="bar" hidden><i></i></div><div class="r">
        <button class="b pr" data-k="fill">Fill in this form</button><button class="b" data-k="open" hidden>Open the form</button>
        <button class="b" data-k="next" hidden>Next to check</button><button class="b" data-k="applied">I submitted it</button>
        <button class="b" data-k="stop" hidden>Stop: I'll submit it</button>
        <button class="b" data-k="skip" ${JOB.queue ? '' : 'hidden'} title="Leave this one for later and open the next application">Skip to the next</button>
        <button class="b" data-k="drop" title="Not for you after all (the pay, say): Job Hunt sets it aside${JOB.queue ? ' and opens the next one' : ''}">Not interested</button></div></div>`;
    statusEl = root.querySelector('.s');
    barEl = root.querySelector('.bar');
    root.querySelectorAll('[data-k]').forEach(b => { buttons[b.dataset.k] = b; });
    root.querySelector('.x').onclick = () => root.querySelector('.p').classList.toggle('min');
    buttons.fill.onclick = () => start();
    chooseEl = root.querySelector('.c');
    askEl = root.querySelector('.q');
    buttons.replace.onclick = async () => {
      askEl.hidden = true;
      status('Replacing the file with Job Hunt\'s…');
      const n = await replaceFiles();
      status(n ? `Replaced: Job Hunt's ${n === 1 ? 'file is' : 'files are'} attached now. Read the form over, then press its Submit button.` : 'Couldn\'t replace it here: delete the old file with its bin icon, then press Fill in again.');
    };
    buttons.keep.onclick = () => { askEl.hidden = true; replaceAsk = []; status('Kept the file that was there. Read the form over, then press its Submit button.'); };
    buttons.pick.onclick = () => {
      const id = chooseEl.querySelector('select').value;
      if (!id) return;
      chooseEl.hidden = true; buttons.fill.hidden = false; buttons.fill.disabled = true;
      status('Filling it in for the job you chose…');
      send('pick', { job_id: id });
    };
    buttons.next.onclick = () => nextAmber();
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
  function question(el) {
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      node = node.parentElement;
      if (!node) break;
      if (node.matches('fieldset')) { const lg = node.querySelector('legend'); if (lg) return textOf(lg); }
      const lb = node.getAttribute('aria-labelledby');
      if (lb && /group|radiogroup/.test(node.getAttribute('role') || '')) return clean(lb.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' '));
      if (/group|radiogroup/.test(node.getAttribute('role') || '') && node.getAttribute('aria-label')) return clean(node.getAttribute('aria-label'));
      // Past the question's own box: the next level up holds other questions too.
      const mine = x => x === el || (el.name && x.name === el.name && x.type === el.type);
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
  let attached = new Set(), fields = [], byKey = {}, adders = {}, round = 0, ownClick = false, waitingSince = 0, toggled = false, reveals = 0;
  const NOT_SEND = /^\s*\+?\s*(add|delete|remove|edit|cancel|back|previous|next|continue|save|upload|select|choose|attach|browse|clear|close|sign in|log in|create account)\b/i;
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "Add Another" under Work Experience or Education: the form shows one entry until it's pressed.
  const ADD = /^\s*\+?\s*add\b/i;
  const NOT_ADD = /\b(file|attachment|resume|cv|cover|link|website|document|photo|skill|reference)s?\b/i;
  const HISTORY = /experience|employment|work|job|position|education|school|degree|qualification|language/i;
  function collectAdders(n) {
    adders = {};
    const seen = new Set();
    for (const b of document.querySelectorAll('button,[role=button],a')) {
      if (own(b) || !shown(b)) continue;
      const t = clean(b.textContent || b.getAttribute('aria-label') || '');
      if (!t || t.length > 40 || !ADD.test(t) || NOT_ADD.test(t)) continue;
      const sec = sectionOf(b);
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
  let heads = [];
  const sectionOf = el => {
    let t = '';
    for (const h of heads) { if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) t = h; else break; }
    return t ? textOf(t).slice(0, 80) : '';
  };
  // A skills box (Workday's "Type to Add Skills"): type a skill, press Enter, choose the match from
  // the list that comes up; once per skill. Its value is the skills chosen so far.
  const SKILLS = /\bskills?\b/i;
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
  const openOptions = () => [...document.querySelectorAll('[role=listbox] [role=option], [data-automation-id=promptOption]')].filter(o => !own(o) && shown(o));
  // Close whatever list is open: Escape where the focus is (Workday moves it into the list), then a
  // click outside it. A list left open had its options taken for the next dropdown's, which put one
  // dropdown's answers in another.
  async function closeLists(b) {
    for (let i = 0; i < 4 && openOptions().length; i++) {
      for (const el of new Set([document.activeElement, openOptions()[0], b].filter(Boolean))) pressKey(el, 'Escape');
      await wait(120);
      if (!openOptions().length) break;
      for (const t of ['mousedown', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      await wait(150);
      if (i === 2 && b && openOptions().length) { ownClick = true; b.click(); ownClick = false; await wait(150); }
    }
  }
  // Open a dropdown and return its options: the list it names (aria-controls), else the options that
  // weren't on the page before it opened.
  async function openDrop(b) {
    await closeLists();
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
  async function moreOptions(list, want) {
    const scroller = list.length && (list[0].closest('[role=listbox]') || list[0].parentElement);
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 4) return list;
    let all = [...list];
    for (let i = 0; i < 25; i++) {
      if (want && all.some(o => same(o.textContent, want))) break;
      const top = scroller.scrollTop;
      scroller.scrollTop = top + Math.max(80, scroller.clientHeight - 20);
      scroller.dispatchEvent(new Event('scroll'));
      await wait(100);
      if (scroller.scrollTop === top) break;
      for (const o of openOptions()) if (!all.includes(o)) all.push(o);
    }
    return all.filter(o => o.isConnected);
  }
  async function readDrops() {
    let n = 0;
    for (const b of document.querySelectorAll(DROPS)) {
      if (own(b) || !shown(b) || b.disabled || dropOptions.has(b) || n++ > 40) continue;
      const list = await moreOptions(await openDrop(b));
      dropOptions.set(b, [...new Set(list.map(o => clean(o.textContent)).filter(t => t && !/^select one$/i.test(t)))]);
      await closeLists(b);
    }
  }
  async function fillDrop(b, v) {
    if (same(clean(b.textContent), v) || same(core(b.textContent), core(v))) return true;
    let list = await openDrop(b);
    let i = pick(list.map(o => clean(o.textContent)), v);
    if (i < 0) { list = await moreOptions(list, v); i = pick(list.map(o => clean(o.textContent)), v); }
    if (i < 0) { await closeLists(b); return false; }
    list[i].scrollIntoView({ block: 'nearest' });
    ownClick = true; list[i].click(); ownClick = false;
    await wait(300);
    await closeLists(b);
    return same(core(b.textContent), core(list[i].textContent || v)) || !/^select one$/i.test(clean(b.textContent));
  }
  function collect() {
    fields = []; byKey = {};
    heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role=heading]')].filter(h => !own(h) && shown(h) && textOf(h).length > 1);
    const groups = {};
    let n = 0;
    for (const el of document.querySelectorAll('input,select,textarea')) {
      if (own(el) || el.disabled) continue;
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'password'].includes(type)) continue;
      if (type === 'search' && !SKILLS.test(labelOf(el))) continue;
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
      const f = { key, type: isSkills(el, type) ? 'skills' : el.getAttribute('role') === 'combobox' ? 'combobox' : type, label: labelOf(el), required: el.required || el.getAttribute('aria-required') === 'true', value: type === 'file' ? (el.files && el.files.length ? 'attached' : '') : choice ? '' : type === 'select' ? chosen : clean(el.value) };
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
        value: /^select one$/i.test(now) ? '' : now, options: (dropOptions.get(b) || []).slice(0, 150) };
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
  const wait = ms => new Promise(r => setTimeout(r, ms));
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
      return attach(el, file);
    }
    if (v == null || v === '') return f.value !== '' && f.type !== 'checkbox';
    if (f.drop) return fillDrop(el, v);
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
    el.focus();
    setter(el, String(v));
    if (f.type === 'skills') return fillSkills(el, v);
    if (f.type === 'combobox') {
      await wait(500);
      const opt = [...document.querySelectorAll('[role=option]')].find(o => near(o.textContent, v));
      if (!opt) return false;
      opt.click();
    }
    return true;
  }
  // A click the way a mouse makes one: pointer and mouse press and release at the element's middle,
  // then the click (sites that act on the press ignore a bare click()).
  const mouse = el => {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    ownClick = true;
    for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown']) el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, { ...o, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, o));
    if (el.focus) el.focus({ preventScroll: true });
    for (const t of ['pointerup', 'mouseup']) el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, { ...o, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, o));
    el.click();
    ownClick = false;
  };
  const pressKey = (el, k) => {
    for (const t of ['keydown', 'keypress', 'keyup']) {
      const e = new KeyboardEvent(t, { key: k, code: k, bubbles: true, cancelable: true });
      const n = k === 'Enter' ? 13 : k === 'Escape' ? 27 : k === 'ArrowDown' ? 40 : 0;
      Object.defineProperty(e, 'keyCode', { get: () => n }); Object.defineProperty(e, 'which', { get: () => n });
      el.dispatchEvent(e);
    }
  };
  const typeIn = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const options = () => [...document.querySelectorAll('[data-automation-id=promptOption],[role=option]')].filter(o => !own(o) && shown(o) && clean(o.textContent));
  // Each skill: type it, press Enter, wait for the list of matches, choose the closest (the same
  // name, else one that starts with it or contains it, else the first), then the next.
  async function fillSkills(first, v) {
    const want = String(v).split(/\s*[;\n]\s*/).map(clean).filter(Boolean).slice(0, 12);
    // Workday redraws the box after each skill: find it again each time (by its id, else in its field).
    const field = first.closest('[data-automation-id^=formField]') || first.parentElement?.parentElement?.parentElement || document.body;
    const box = () => first.isConnected ? first : (first.id && document.getElementById(first.id)) || [...field.querySelectorAll('input')].find(x => shown(x) && !own(x)) || first;
    const sig = () => options().map(o => clean(o.textContent)).join('|');
    let added = 0;
    for (const skill of want) {
      let el = box();
      if (skillPills(el).some(p => same(p, skill))) { added++; continue; }
      // The last skill's list still open: close it, so its matches aren't taken for this one's.
      if (options().length) { pressKey(el, 'Escape'); await wait(300); }
      el = box();
      const before = sig();
      el.focus(); el.click();
      typeIn(el, skill);
      pressKey(el, 'Enter');
      // Wait for this skill's matches (a list that wasn't there before), up to about five seconds.
      let list = [];
      for (let i = 0; i < 32; i++) {
        await wait(160);
        list = options();
        if (list.length && sig() !== before && !/^(searching|loading)/i.test(clean(list[0].textContent))) break;
      }
      await wait(250);
      list = options();
      if (!list.length || sig() === before && before) { typeIn(box(), ''); continue; }
      const t = o => clean(o.textContent).toLowerCase(), s = skill.toLowerCase();
      // Else the one sharing most of the skill's words ("Budgeting" for "Budget Planning"), if it shares at least half.
      const words = x => x.split(/[^a-z0-9+#]+/).filter(w => w.length > 2 && !['and', 'the', 'for'].includes(w)).map(w => w.slice(0, 6));
      const overlap = o => { const ow = words(t(o)); return words(s).filter(w => ow.includes(w)).length; };
      const most = [...list].sort((a, b) => overlap(b) - overlap(a))[0];
      const best = list.find(o => t(o) === s) || list.find(o => t(o).startsWith(s)) || list.find(o => t(o).includes(s)) || list.find(o => s.includes(t(o)))
        || (most && overlap(most) * 2 >= words(s).length && overlap(most) > 0 ? most : null);
      if (!best) { pressKey(box(), 'Escape'); typeIn(box(), ''); continue; }
      // Workday takes a skill on the mouse press, not on a plain click: press it like a mouse, then
      // check it was taken (a pill with its name, or the option ticked); else its checkbox, the
      // row around it, then the keyboard (arrow down to it, Enter).
      const name = clean(best.textContent);
      const taken = () => skillPills(box()).some(p => same(p, name) || near(p, name)) || [...options()].some(o => same(o.textContent, name) && (o.getAttribute('aria-selected') === 'true' || o.closest('[aria-selected=true]')));
      const idx = list.indexOf(best);
      const tries = [best, best.querySelector('input[type=checkbox],input[type=radio],[role=checkbox]'), best.closest('[role=option],[data-automation-id=menuItem],li'), best.querySelector('[data-automation-id=promptOption]'), best.parentElement].filter((x, i, a) => x && a.indexOf(x) === i);
      let ok = false;
      for (const t of tries) {
        if (!t.isConnected) continue;
        mouse(t);
        await wait(600);
        if ((ok = taken())) break;
      }
      if (!ok && idx >= 0) {
        const el2 = box();
        el2.focus();
        for (let k = 0; k <= idx; k++) { pressKey(el2, 'ArrowDown'); await wait(60); }
        pressKey(el2, 'Enter');
        await wait(600);
        ok = taken();
      }
      if (ok) added++;
      await wait(300);
      el = box();
      if (options().length) { pressKey(el, 'Escape'); await wait(250); }
      el = box();
      if (el.value) typeIn(el, '');
      await wait(300);
    }
    return added > 0;
  }
  window.__jobhunt = {
    status,
    async fill(answer) {
      if (retired) return;
      waitingSince = 0;
      if (answer.job && headEl) headEl.textContent = `Job Hunt · ${answer.job.company}`;
      // The answers go to the boxes as they were when the form was sent (boxes added or moved since
      // would shift them); read again only if the page replaced them.
      if (sent && Object.values(sent.byKey).every(els => els.every(e => e.isConnected))) ({ fields, byKey, adders } = sent);
      else collect();
      sent = null;
      // Your CV has more jobs or schools than the form shows: press its Add buttons first, then read
      // the form again and fill every entry at once (a redraw after filling could empty the boxes).
      const adds = round < 1 ? fields.filter(f => f.type === 'add' && parseInt(answer.values && answer.values[f.key], 10) > 0) : [];
      if (adds.length) {
        round++;
        let added = 0;
        const what = [];
        for (const f of adds) {
          const was = added;
          const want = Math.min(8, parseInt(answer.values[f.key], 10));
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
          progress(barAt());
          status(`Added ${what.join(', ')} from your CV; filling in the form…`);
          await wait(600);
          start(true);
          return;
        }
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
        const done = await fillOne(f, v, file);
        // Green is what Job Hunt filled; a box the site (or you) had filled already isn't marked.
        const theirs = f.value !== '' && f.type !== 'file' && (v == null || v === '' || same(f.value, v));
        if (theirs && done) continue;
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
      progress(100);
      setTimeout(() => { if (!barTimer) progress(null); }, 2500);
      buttons.fill.disabled = false; buttons.fill.textContent = 'Fill in again';
      buttons.next.hidden = !todo; buttons.applied.hidden = false;
      const saved = (answer.banked || []).length ? ` ${answer.banked.length} from your saved answers.` : '';
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
            status(`Everything's answered from your saved answers and facts. Submitting in ${left}s; press Stop to check it yourself.`);
            left--; autoTimer = setTimeout(tick, 1000);
          };
          autoTimer = setTimeout(tick, 0);
        }
      }
    },
    start: () => start(),
    failed(msg) { waitingSince = 0; progress(null); buttons.fill.disabled = false; status(msg); },
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
        o.textContent = `${j.title} · ${j.company}${j.status === 'ready' ? ' (not approved yet)' : ''}`;
        sel.appendChild(o);
      }
      // Chosen already: the first whose company the page names (its title or address).
      const named = list.find(j => { const w = String(j.company || '').toLowerCase().split(/\s+/)[0]; return w.length >= 3 && here.includes(w); });
      if (named) sel.value = named.id;
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
  let sent = null;
  async function start(more, dates) {
    if (!more) { round = 0; reveals = 0; }
    panel();
    if (retired) return;
    checkPay();
    if (document.querySelector(DROPS)) { status('Reading the form…'); await readDrops(); }
    const all = collect();
    sent = { fields, byKey, adders };
    // The end dates that appeared: only the boxes still empty go (with the entries' checkboxes), not
    // the whole form again.
    const list = dates ? all.filter(f => f.type !== 'add' && f.type !== 'file' && (!f.value || f.type === 'checkbox')) : all;
    if (!list.length) { progress(null); status('No form on this page yet. Use the page\'s Apply button, then press Fill in this form.'); return; }
    // No answer in six minutes (Job Hunt closed, Claude busy): the button comes back.
    const mine = waitingSince = Date.now();
    setTimeout(() => { if (waitingSince === mine) { waitingSince = 0; progress(null); buttons.fill.disabled = false; status('No answers came back from Job Hunt. Is it still running? Press Fill in this form to try again.'); } }, 360000);
    buttons.fill.disabled = true;
    // About how long Claude takes: longer with more questions (a form with several jobs on it, say).
    const usual = Math.round(15 + list.length * 0.8);
    const n = list.filter(f => f.type !== 'add').length;
    if (!more) progress(0);
    creep(more ? 93 : 75, usual, s => dates
      ? `Filling in the end dates of your past jobs… ${s}s (usually about ${usual}s).`
      : more
      ? `Writing answers for all ${n} boxes, now with every job and school on your CV… ${s}s (usually about ${usual}s).`
      : `Reading ${n} questions and writing answers from your CV… ${s}s (usually about ${usual}s).`);
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
      if (i === 8 && !recorded && pressedAt() && !waitingSince) { panel(); buttons.applied.hidden = false; status('Waiting for the site to confirm… If it says your application went through, press I submitted it (or just close this window: Job Hunt asks).'); }
    }
  }
  // You sent the form: a Submit-like button, or the form itself (Enter, or a button Job Hunt can't name).
  function onPressed() {
    let fields = [];
    if (filled) { try { fields = collect().filter(f => f.type !== 'file').map(f => ({ label: f.label, type: f.type, value: f.value, options: f.options })); } catch (err) { /* the form changed */ } }
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
      try { send('learn', { fields: collect().filter(f => !['file', 'add', 'skills'].includes(f.type) && f.value).map(f => ({ label: f.label, type: f.type, value: f.value, options: f.options })).slice(0, 80) }); } catch (err) { /* the form changed */ }
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
        status('The application form is inside this page. Press Open the form, and Job Hunt fills it in there.');
        return;
      }
      if (i === 2 && !pressedAt()) status('Use the page\'s Apply button to get to the form. Job Hunt fills it in when it appears.');
    }
  }
  if (EXT) { panel(); status('Press Fill in this form when the application form is on screen.'); return; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look); else look();
})();
