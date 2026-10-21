// Runs in the Apply window, on the company's application page (main frame only). It reads the
// form, sends the questions to Job Hunt, fills in what comes back and attaches your CV and letter,
// then leaves the Submit button to you. Talks to Job Hunt by asking to open a jobhunt.invalid
// address, which the app catches and cancels; the token keeps the page from faking that.
(() => {
  if (window.top !== window || window.__jobhunt) return;
  const TOKEN = '__TOKEN__';
  const JOB = __JOB__;
  const send = (kind, data) => {
    const json = JSON.stringify({ t: TOKEN, ...data });
    let bin = '';
    for (const b of new TextEncoder().encode(json)) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    location.href = 'https://jobhunt.invalid/' + kind + '/' + b64;
  };
  const clean = s => (s || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim().slice(0, 300);
  const ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|icims\.com|jobvite\.com|bamboohr\.com|myworkdayjobs\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jazzhr\.com|applytojob\.com/i;

  // --- the panel, in its own shadow root so the page's styles don't reach it ---
  let ui, statusEl, buttons = {}, amber = [], amberAt = 0, filled = false;
  function panel() {
    if (ui) return;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .p{font:14px/1.4 system-ui,'Segoe UI',sans-serif;background:#fff;color:#1d1d1f;border:1px solid #d0d0d6;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:12px 14px;width:300px}
      .h{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px}.h span{flex:1}
      .x{border:0;background:none;font-size:18px;cursor:pointer;color:#666;padding:0 4px}
      .s{color:#444;margin:0 0 10px}.r{display:flex;flex-wrap:wrap;gap:6px}
      button.b{font:inherit;border:1px solid #c8c8d0;background:#f6f6f8;border-radius:8px;padding:6px 10px;cursor:pointer}
      button.b.pr{background:#2f5bd3;border-color:#2f5bd3;color:#fff}button.b[hidden]{display:none}button.b:disabled{opacity:.6;cursor:default}
      .min .s,.min .r{display:none}
    </style><div class="p"><div class="h"><span>Job Hunt · ${JOB.company.replace(/[<>&]/g, '')}</span><button class="x" title="Smaller">–</button></div>
      <p class="s"></p><div class="r">
        <button class="b pr" data-k="fill">Fill in this form</button><button class="b" data-k="open" hidden>Open the form</button>
        <button class="b" data-k="next" hidden>Next to check</button><button class="b" data-k="applied">I submitted it</button></div></div>`;
    statusEl = root.querySelector('.s');
    root.querySelectorAll('[data-k]').forEach(b => { buttons[b.dataset.k] = b; });
    root.querySelector('.x').onclick = () => root.querySelector('.p').classList.toggle('min');
    buttons.fill.onclick = () => start();
    buttons.next.onclick = () => nextAmber();
    buttons.applied.onclick = () => { recorded = true; window.name = ''; status('Marked as applied in Job Hunt. You can close this window.'); buttons.applied.hidden = true; send('applied', { url: location.href }); };
    (document.body || document.documentElement).appendChild(host);
    ui = host;
  }
  const status = t => { panel(); statusEl.textContent = t; };

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
  let fields = [], byKey = {};
  function collect() {
    fields = []; byKey = {};
    const groups = {};
    let n = 0;
    for (const el of document.querySelectorAll('input,select,textarea')) {
      if (own(el) || el.disabled) continue;
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search', 'password'].includes(type)) continue;
      const choice = type === 'radio' || type === 'checkbox';
      if (type !== 'file' && !choice && !shown(el)) continue;
      if (choice && !shown(el) && !(el.labels && [...el.labels].some(shown))) continue;
      if (choice && el.name) {
        const g = groups[type + el.name] ||= { key: 'g' + n++, type: type === 'radio' ? 'radio' : 'checkboxes', els: [], options: [] };
        g.els.push(el); g.options.push((el.labels && el.labels.length ? textOf(el.labels[0]) : '') || clean(el.value));
        continue;
      }
      const key = 'f' + n++;
      const f = { key, type: el.getAttribute('role') === 'combobox' ? 'combobox' : type, label: labelOf(el), required: el.required || el.getAttribute('aria-required') === 'true', value: type === 'file' ? (el.files && el.files.length ? 'attached' : '') : choice ? '' : clean(el.value) };
      if (type === 'select') f.options = [...el.options].filter(o => o.value !== '' && !/^\s*(select|choose|--|please)/i.test(o.text)).map(o => clean(o.text)).slice(0, 60);
      if (type === 'checkbox') f.context = question(el);
      fields.push(f); byKey[key] = [el];
    }
    for (const g of Object.values(groups)) {
      const first = g.els[0];
      if (g.type === 'checkboxes' && g.els.length === 1) {
        const f = { key: g.key, type: 'checkbox', label: g.options[0] || labelOf(first), context: question(first), required: first.required, value: '' };
        fields.push(f); byKey[g.key] = g.els; continue;
      }
      fields.push({ key: g.key, type: g.type, label: question(first) || clean(first.name), options: g.options.slice(0, 40), required: g.els.some(e => e.required), value: g.els.filter(e => e.checked).map((e, i) => g.options[g.els.indexOf(e)]).join('; ') });
      byKey[g.key] = g.els;
    }
    return fields.slice(0, 120);
  }
  const formHere = () => collect().filter(f => f.type !== 'checkbox').length >= 3 && fields.some(f => f.type === 'email' || f.type === 'file' || /e-?mail|resume|cv/i.test(f.label));

  // --- filling ---
  const setter = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    for (const e of ['input', 'change']) el.dispatchEvent(new Event(e, { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  };
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
  const near = (a, b) => { a = clean(a).toLowerCase(); b = clean(b).toLowerCase(); return a && b && (a === b || a.startsWith(b) || b.startsWith(a)); };
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
  async function fillOne(f, v, file) {
    const els = byKey[f.key] || [];
    const el = els[0];
    if (!el) return false;
    if (f.type === 'file') {
      if (!file) return el.files && el.files.length > 0;
      const bytes = Uint8Array.from(atob(file.b64), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], file.name, { type: file.mime }));
      el.files = dt.files;
      for (const e of ['input', 'change']) el.dispatchEvent(new Event(e, { bubbles: true }));
      return el.files.length > 0;
    }
    if (v == null || v === '') return f.value !== '' && f.type !== 'checkbox';
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
      els.forEach((e, i) => { if (want.some(w => near(f.options[i], w))) { if (!e.checked) e.click(); any = true; } });
      return any;
    }
    if (f.type === 'checkbox') {
      if (/^(yes|true|checked|tick)/i.test(String(v)) && !el.checked) el.click();
      return el.checked;
    }
    if (f.value) return true; // already has an answer: yours or the site's
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
  window.__jobhunt = {
    status,
    async fill(answer) {
      collect();
      amber = []; amberAt = 0;
      let ok = 0, todo = 0;
      for (const f of fields) {
        const file = answer.files && answer.files[f.key];
        const done = await fillOne(f, answer.values && answer.values[f.key], file);
        const matters = f.required || done || (answer.values && answer.values[f.key]) || f.type === 'file';
        if (!matters) continue;
        mark((byKey[f.key] || [])[0], done);
        if (done) ok++; else todo++;
      }
      filled = true;
      buttons.fill.disabled = false; buttons.fill.textContent = 'Fill in again';
      buttons.next.hidden = !todo; buttons.applied.hidden = false;
      status(todo
        ? `Filled ${ok}. ${todo} for you, in amber: boxes that agree to terms are yours to tick, and Job Hunt leaves anything your CV and facts don't answer. Read the form over, then press its Submit button.`
        : `Filled ${ok}. Read the form over (green is what Job Hunt filled), then press its Submit button.`);
      if (todo) nextAmber();
    },
    failed(msg) { buttons.fill.disabled = false; status(msg); },
  };
  function nextAmber() {
    if (!amber.length) return;
    amber[amberAt % amber.length].scrollIntoView({ behavior: 'smooth', block: 'center' });
    amberAt++;
  }
  function start() {
    const list = collect();
    if (!list.length) { status('No form on this page yet. Use the page\'s Apply button, then press Fill in this form.'); return; }
    buttons.fill.disabled = true;
    status(`Reading ${list.length} questions and writing answers from your CV… this takes about half a minute.`);
    send('fields', { url: location.href, fields: list });
  }

  // When you press the form's Submit button, Job Hunt watches for the site's confirmation ("Thank you
  // for applying", "We've received your application") and marks it applied by itself. The press is
  // remembered in window.name, which stays with this window when the site moves to another page,
  // even on another domain. Without a confirmation, it asks you instead.
  const MARK = 'jobhunt-submitted:';
  const DONE = /thanks? (you )?for (applying|your application|submitting your application)|application (has been |was |is )?(successfully )?(submitted|received|sent|complete)|we('ve| have)? (successfully )?received your application|your application (has been|was) (successfully )?(received|submitted|sent)|successfully (applied|submitted)|you('ve| have) (successfully )?applied/i;
  const pressedAt = () => {
    const n = (window.name || '').startsWith(MARK) ? Number(window.name.slice(MARK.length)) : 0;
    return n && Date.now() - n < 10 * 60 * 1000 ? n : 0;
  };
  let recorded = false;
  const confirmedHere = () => DONE.test((document.body ? document.body.innerText : '').slice(0, 40000));
  function recordApplied() {
    if (recorded) return;
    recorded = true;
    window.name = '';
    panel();
    buttons.applied.hidden = true;
    status('Submitted: the site confirmed it. Marked as applied in Job Hunt. You can close this window.');
    send('applied', { url: location.href, auto: true });
  }
  async function watchForConfirmation(seconds, vouched) {
    for (let i = 0; i < seconds && !recorded; i++) {
      await wait(1000);
      if ((pressedAt() || vouched) && confirmedHere()) { recordApplied(); return; }
      if (i === 8 && !recorded) { panel(); buttons.applied.hidden = false; status('Waiting for the site to confirm… If it says your application went through, press I submitted it.'); }
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button,input[type=submit]');
    if (!b || own(b)) return;
    if (b.type === 'submit' || /submit|send application|apply now/i.test(b.textContent || b.value || '')) {
      window.name = MARK + Date.now();
      watchForConfirmation(120);
    }
  }, true);
  // Arrived on a new page after pressing Submit: is this the confirmation? (The app also asks each
  // page that loads after it filled the form in this window, for confirmations on another site.)
  if (pressedAt()) watchForConfirmation(30);
  window.__jobhuntAfterFill = () => { if (!recorded && !formHere()) watchForConfirmation(30, true); };

  // On each page: fill the form by itself the first time one appears, or point the way to it.
  async function look() {
    for (let i = 0; i < 20; i++) {
      await wait(1000);
      if (!document.body) continue;
      panel();
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look); else look();
})();
