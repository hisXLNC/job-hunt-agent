// The form filler. The side panel puts this file into the page beside it when
// the person asks for a form to be filled in (never before), and then calls
// the few functions at the bottom. It reads the form, types answers in,
// chooses from lists and attaches files.
//
// It never sends anything by itself: while filling it will not press Submit,
// Apply, Next or Save and Continue, and a form that tries to send itself
// because of a click made here is stopped. The only buttons it presses while
// filling are the ones that open a list, the choices in it, Yes/No answer
// buttons and "Add another" under work history or education. The one
// exception is send(), called only when the person presses "Submit
// application" in the side panel: it presses this form's own Submit, once.
(() => {
  const BUILD = 2;
  const old = window.__jobhuntFiller;
  const alive = () => typeof chrome === 'undefined' || !chrome.runtime || !!chrome.runtime.id;
  if (old) { if (old.build === BUILD && old.alive()) return; old.retire(); }
  let retired = false;

  // ---- small things -----------------------------------------------------------------
  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/\s*[*\u2731\u2732\uFF0A]+\s*$/, '').replace(/\s*\((required|optional)\)\s*$/i, '').trim();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const win = el => (el.ownerDocument && el.ownerDocument.defaultView) || window;
  const shown = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), s = win(el).getComputedStyle(el);
    return (r.width > 0 || r.height > 0) && s.visibility !== 'hidden' && s.display !== 'none';
  };
  function textOf(el) {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('input,select,textarea,option,script,style,[aria-hidden="true"]').forEach(x => x.remove());
    return clean(c.textContent).slice(0, 400);
  }
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
  // "5 - Fluent" is "Fluent": numbering in front of a choice is not part of the answer.
  const core = t => clean(t).toLowerCase().replace(/^\d+\s*[-–.:)]\s*/, '').replace(/[.!]+$/, '');
  // One begins with the other, whole words only: "No" is "No, I am not" and not "Non-binary".
  const begins = (a, b) => a.startsWith(b) && (/^(e?s)?($|[^a-z0-9])/i.test(a.slice(b.length)) || /[^a-z0-9]$/i.test(b));
  const near = (a, b) => { a = core(a); b = core(b); return !!a && !!b && (a === b || begins(a, b) || begins(b, a)); };
  // "Job Board > LinkedIn", "Institute - Certificate": the last part is the name.
  const tail = x => { x = clean(x); return / > /.test(x) ? x.split(' > ').pop().trim() : x.includes(' - ') ? x.slice(x.lastIndexOf(' - ') + 3).trim() : ''; };

  // What was done on this page, for bug reports: steps, labels and where a
  // field sits. Never what was typed.
  const trail = [];
  const where = el => {
    const out = [];
    for (let x = el; x && x.tagName && x.tagName !== 'BODY' && out.length < 4; x = x.parentElement) {
      const da = x.getAttribute('data-automation-id') || x.getAttribute('data-ui') || x.getAttribute('data-testid');
      out.push(x.tagName.toLowerCase() + (x.id ? '#' + String(x.id).slice(0, 40) : '') + (da ? `[${String(da).slice(0, 40)}]` : '') + (x.getAttribute('role') ? `[role=${x.getAttribute('role')}]` : '') + (x.getAttribute('name') ? `[name=${String(x.getAttribute('name')).slice(0, 40)}]` : ''));
    }
    return out.join(' < ');
  };
  function note(step, f, more) {
    const row = { step };
    if (f && f.label !== undefined) { row.label = String(f.label).slice(0, 80); row.kind = f.kind; if (f.el) row.at = where(f.el); }
    else if (f && f.tagName) row.at = where(f);
    if (more) row.more = String(more).slice(0, 120);
    trail.push(row);
    if (trail.length > 400) trail.shift();
  }

  // ---- every part of the page: the page, open shadow roots, same-origin frames --------
  let rootList = [];
  const shadowOf = el => el.shadowRoot || (typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot ? (() => { try { return chrome.dom.openOrClosedShadowRoot(el); } catch (e) { return null; } })() : null);
  function findRoots() {
    const out = [], seen = new Set();
    const walk = root => {
      if (!root || seen.has(root) || out.length > 400) return;
      seen.add(root); out.push(root);
      for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { try { const d = el.contentDocument; if (d && d.body) walk(d); } catch (e) { /* another site's frame */ } continue; }
        if (el.tagName.includes('-') || el.shadowRoot) { const s = shadowOf(el); if (s) walk(s); }
      }
    };
    walk(document);
    rootList = out;
    guard();
    return out;
  }
  const all = sel => rootList.flatMap(r => [...r.querySelectorAll(sel)]);
  const byId = (el, id) => { const r = el.getRootNode(); return (r.getElementById && r.getElementById(id)) || el.ownerDocument.getElementById(id); };
  // Where an element sits in its own document, for one inside a shadow root: its outermost host.
  const anchor = el => { let x = el; for (let r = x.getRootNode(); r && r.host; r = x.getRootNode()) x = r.host; return x; };
  const follows = (a, b) => { // is b after a on the page?
    const x = anchor(a), y = anchor(b);
    if (x === y) return a.getRootNode() === b.getRootNode() ? !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : false;
    if (x.ownerDocument !== y.ownerDocument) return rootList.indexOf(x.ownerDocument) < rootList.indexOf(y.ownerDocument);
    return !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  // ---- which hiring system this is ------------------------------------------------------
  function detect() {
    const h = location.hostname, q = s => all(s).length > 0;
    if (/myworkday(jobs|site)\.com$|\.workday\.com$/.test(h) || q('[data-automation-id^="formField-"],[data-automation-id="applyFlowPage"],[data-automation-id="legalNameSection_firstName"]')) return 'workday';
    if (/lever\.co$/.test(h) || q('input[name^="urls["], input[name^="cards["], textarea[name^="cards["]')) return 'lever';
    if (/greenhouse\.io$/.test(h) || q('form.application--form, form#application_form, #grnhse_app, [id^="question_"]')) return 'greenhouse';
    if (/ashbyhq\.com$/.test(h) || q('[name^="_systemfield_"], [class*="ashby-application-form"]')) return 'ashby';
    if (/workable\.com$/.test(h) || q('[data-ui="application-form"]')) return 'workable';
    if (/smartrecruiters\.com$/.test(h) || q('oc-apply-form, oc-personal-information, spl-input')) return 'smartrecruiters';
    if (/successfactors\.(com|eu)$|sapsf\.(com|eu)$/.test(h) || q('.rcmFormField, #rcmJobApplicationCtr, [id*="rcmCandidate"]')) return 'successfactors';
    if (/icims\.com$/.test(h) || q('[class*="iCIMS_"]')) return 'icims';
    if (/zohorecruit\.[a-z.]+$/.test(h) || q('[id^="rec-form_"], lyte-input, lyte-dropdown')) return 'zoho';
    return '';
  }

  // ---- what a field is called -----------------------------------------------------------
  // Not a name: a spinner's "Loading", a site's own id for the box, a list's "Select One".
  const NO_NAME = /^(loading\b.*|rec-form_\w+|inputid|input|select( one)?|search|required|optional)$/i;
  // Things an employer may ask that are the person's alone to answer.
  const PRIVATE = /gender|\bsex\b|\brace\b|ethnic|veteran|disab|sexual|orientation|religio|pronoun|birth|\bage\b|marital|criminal|convict|felony|social (security|insurance)|\bssn\b|\bsin\b|national (id|insurance)|passport|visible minority|indigenous|aboriginal|first nations|transgender|lgbt|military status|passwor|\bbank|\biban\b|card number|credit card|signature/i;

  // The question an input belongs to: the nearest label-like words before it.
  function question(el, group) {
    let node = el;
    for (let i = 0; i < 7 && node; i++) {
      node = node.parentElement || (node.getRootNode() && node.getRootNode().host) || null;
      if (!node || node.tagName === 'BODY') break;
      if (node.tagName === 'FIELDSET') { const lg = node.querySelector('legend'); if (lg && textOf(lg)) return textOf(lg); }
      const role = node.getAttribute('role') || '';
      if (/group/.test(role)) {
        const lb = node.getAttribute('aria-labelledby');
        if (lb) { const t = clean(lb.split(/\s+/).map(id => textOf(byId(node, id))).join(' ')); if (t) return t; }
        if (node.getAttribute('aria-label')) return clean(node.getAttribute('aria-label'));
      }
      if (node.tagName.includes('-') && node.getAttribute('label')) return clean(node.getAttribute('label'));
      // Past the question's own box: the next level up holds other questions too.
      const mine = x => x === el || (group && group.includes(x)) || (el.name && x.name === el.name && x.type === el.type);
      if ([...node.querySelectorAll('input,select,textarea')].some(x => !mine(x) && x.type !== 'hidden' && x.getAttribute('aria-hidden') !== 'true' && !(x.tabIndex < 0 && !shown(x)))) break;
      const cands = [...node.querySelectorAll('legend,label,h2,h3,h4,h5,p,span,div')].filter(x =>
        !x.contains(el) && !(group && group.some(g => x.contains(g))) && !x.querySelector('input,select,textarea,button') && !x.closest('button,[role=option],[role=listbox]') && (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && textOf(x).length > 1);
      if (cands.length) {
        // The outermost of the last one: a label's own words, not one span of it.
        let best = cands[cands.length - 1];
        for (const c of cands) if (c.contains(best) && textOf(c) && c !== best) { best = c; break; }
        return textOf(best);
      }
    }
    return '';
  }
  function labelOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = clean(by.split(/\s+/).map(id => textOf(byId(el, id))).join(' ')); if (t && !NO_NAME.test(t)) return t; }
    if (el.labels && el.labels.length) { const t = textOf(el.labels[0]); if (t) return t; }
    if (el.id && !el.labels) { try { const l = el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && textOf(l)) return textOf(l); } catch (e) { /* odd id */ } }
    // Zoho Recruit names a box's label after the box: label#crc-label-rec-form_<id>.
    for (let x = el, i = 0; x && i < 10; x = x.parentElement, i++) {
      if (!x.id) continue;
      const id = String(x.id).replace(/_input$/, '');
      const lab = byId(el, 'crc-label-' + id) || byId(el, 'crc-label-rec-form_' + id);
      if (lab && textOf(lab)) return textOf(lab);
    }
    const al = clean(el.getAttribute('aria-label'));
    if (al && !NO_NAME.test(al)) return al;
    const q = question(el);
    if (q && !NO_NAME.test(q)) return q;
    const host = el.getRootNode().host;
    if (host) { const t = clean(host.getAttribute('label') || host.getAttribute('aria-label')); if (t) return t; }
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '').slice(0, 120);
  }
  const optLabel = el => (el.labels && el.labels.length ? textOf(el.labels[0]) : '') || clean(el.getAttribute('aria-label')) || textOf(el) || clean(el.value);

  // ---- lists that open: dropdowns made of a button and a list ----------------------------
  const OPTION = '[role="option"],[data-automation-id="promptOption"],[class*="select__option"],lyte-drop-item';
  const CHOSEN = '[data-automation-id="selectedItem"],[data-automation-id="selectedItemList"],[data-automation-id="multiselectInputContainer"],[class*="multi-value"]';
  const DROP = 'button[aria-haspopup="listbox"],[role="combobox"]:not(input):not(select):not(textarea)';
  const UNCHOSEN = /^(select( one| an option| \.\.\.|\.\.\.|…)?|choose( one)?|please (select|choose).*|month|year|day|[-\u2013\u2014]+\s*(none|select|make a selection)\s*[-\u2013\u2014]+|no selection|--+)?$/i;
  const NOTHING = /^no (items|results|matches|options)\b/i;
  const optName = o => clean(o.getAttribute('data-automation-label') || o.textContent);
  const openOptions = () => { findRoots(); return all(OPTION).filter(o => shown(o) && !o.closest(CHOSEN) && optName(o) && !NOTHING.test(optName(o))); };

  let ownClick = 0;
  // The words on buttons this file never presses.
  const SENDS = /^\s*(submit|send|apply|save|next|continue|finish|review|done|complete|sign|log ?in|create|register|delete|remove|withdraw|pay|confirm)\b/i;
  const key = (el, k) => { for (const t of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: k, code: k, keyCode: { Enter: 13, Escape: 27, ArrowDown: 40, Tab: 9 }[k] || 0, bubbles: true, cancelable: true, composed: true })); };
  // A click as a mouse makes one. `choice`: a choice in an open list (its words are not a button's).
  function press(el, choice) {
    if (!el || !el.isConnected) return false;
    if (!choice) {
      const t = clean(el.textContent || el.value || el.getAttribute('aria-label'));
      if (SENDS.test(t) || /bottom-navigation|pageFooter|submit/i.test(el.getAttribute('data-automation-id') || '') || (el.tagName === 'INPUT' && /^(submit|image)$/.test(el.type))) { note('would not press', el, t); return false; }
    }
    const w = win(el), o = { bubbles: true, cancelable: true, composed: true, view: w };
    ownClick++;
    try {
      if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerdown', o));
      el.dispatchEvent(new w.MouseEvent('mousedown', o));
      if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerup', o));
      el.dispatchEvent(new w.MouseEvent('mouseup', o));
      el.click();
    } finally { ownClick--; }
    return true;
  }
  async function closeLists(b) {
    for (let i = 0; i < 3 && openOptions().length; i++) {
      for (const el of new Set([document.activeElement, b].filter(Boolean))) key(el, 'Escape');
      await wait(80);
      if (!openOptions().length) break;
      ownClick++;
      try { for (const t of ['mousedown', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(t, { bubbles: true })); } finally { ownClick--; }
      const at = document.activeElement;
      if (at && /^(INPUT|TEXTAREA)$/.test(at.tagName)) at.blur();
      await wait(120);
      if (i === 1 && b && openOptions().length) { press(b); await wait(120); }
    }
  }
  const stale = new WeakSet();
  const optionsFor = b => {
    const ctl = b.getAttribute('aria-controls') || b.getAttribute('aria-owns');
    const box = ctl && byId(b, ctl);
    if (box && shown(box)) {
      const list = [...box.querySelectorAll(OPTION + ',li')].filter(o => shown(o) && optName(o) && !NOTHING.test(optName(o)));
      const inner = list.filter(o => !list.some(x => x !== o && o.contains(x)));
      if (inner.length) return inner;
    }
    return openOptions().filter(o => !stale.has(o));
  };
  async function openDrop(b) {
    await closeLists();
    for (const o of openOptions()) stale.add(o);
    if (b.tagName === 'INPUT') b.focus();
    press(b);
    let list = [];
    for (let i = 0; i < 12; i++) {
      await wait(90);
      list = optionsFor(b);
      if (list.length) break;
      if (i === 5) { b.focus(); key(b, 'ArrowDown'); }
    }
    return list;
  }
  // A long list may draw only the rows in view: scroll it, collecting what goes by.
  async function wholeList(list, b, names) {
    let scroller = null;
    for (let x = list.length ? list[0].parentElement : null; x && x.tagName !== 'BODY'; x = x.parentElement) if (x.scrollHeight > x.clientHeight + 4) { scroller = x; break; }
    list.forEach(o => names.add(optName(o)));
    if (!scroller) return list;
    for (let i = 0; i < 25; i++) {
      const was = scroller.scrollTop;
      scroller.scrollTop = was + Math.max(60, scroller.clientHeight - 20);
      await wait(70);
      list = optionsFor(b);
      list.forEach(o => names.add(optName(o)));
      if (scroller.scrollTop === was) break;
    }
    return list;
  }
  // Which choice an answer means. Exactly the same first; then one that begins the same, or
  // names the same thing after a group. -1 when none, or when two would do equally.
  function pick(names, want, loose) {
    const w = clean(want);
    if (!w) return -1;
    let i = names.findIndex(n => same(n, w));
    if (i >= 0) return i;
    i = names.findIndex(n => core(n) === core(w));
    if (i >= 0) return i;
    const hits = names.map((n, k) => (!UNCHOSEN.test(n) && (near(n, w) || (tail(n) && near(tail(n), w))) ? k : -1)).filter(k => k >= 0);
    if (hits.length === 1 || (hits.length > 1 && loose)) return hits[0];
    return -1;
  }

  // ---- dates ----------------------------------------------------------------------------
  // Workday's dates: a box each for month, (day) and year in one wrapper.
  const datePart = el => {
    if (el.tagName !== 'INPUT') return '';
    const id = (el.getAttribute('data-automation-id') || '') + ' ' + (el.id || '');
    const m = /dateSection(Month|Day|Year)/i.exec(id) || (el.getAttribute('role') === 'spinbutton' && /^(month|day|year)$/i.exec(clean(el.getAttribute('aria-label'))));
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
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // "2023-07", "07/2023", "Jul 2023", "July 1, 2023", "2023": month, day and year.
  function splitDate(v) {
    v = String(v).trim().toLowerCase();
    const y = (/\b(19|20)\d{2}\b/.exec(v) || [])[0] || '';
    let m = '', d = '';
    const name = MONTHS.findIndex(x => new RegExp('\\b' + x).test(v));
    if (name >= 0) { m = String(name + 1); const dd = /\b(\d{1,2})(st|nd|rd|th)?\b/.exec(v.replace(y, '')); if (dd) d = dd[1]; }
    else { const nums = v.replace(y, ' ').match(/\d{1,2}/g) || []; m = nums[0] || ''; d = nums[1] || ''; }
    const pad = x => (x ? x.padStart(2, '0') : '');
    return { month: +m >= 1 && +m <= 12 ? pad(m) : '', day: +d >= 1 && +d <= 31 ? pad(d) : '', year: y };
  }
  // A date as one box wants it: the browser's own date box, or the pattern the box shows.
  function dateFor(el, v) {
    const d = splitDate(v);
    if (!d.year) return String(v);
    const type = (el.getAttribute('type') || '').toLowerCase(), hint = `${el.getAttribute('placeholder') || ''} ${labelOf(el)}`.toLowerCase();
    if (type === 'date') return `${d.year}-${d.month || '01'}-${d.day || '01'}`;
    if (type === 'month') return `${d.year}-${d.month || '01'}`;
    if (/yyyy-mm-dd/.test(hint)) return `${d.year}-${d.month || '01'}-${d.day || '01'}`;
    if (/dd[/.-]mm[/.-]yyyy/.test(hint)) return `${d.day || '01'}/${d.month || '01'}/${d.year}`;
    if (/mm[/.-]dd[/.-]yyyy/.test(hint)) return `${d.month || '01'}/${d.day || '01'}/${d.year}`;
    if (/mm[/.-]yyyy/.test(hint)) return `${d.month || '01'}/${d.year}`;
    if (/yyyy-mm/.test(hint)) return `${d.year}-${d.month || '01'}`;
    if (/\byyyy\b|\byear\b/.test(hint) && !/month|mm/.test(hint)) return d.year;
    return String(v);
  }

  // ---- reading the form -----------------------------------------------------------------
  let fields = [], adders = [], site = '', heads = [], scanned = 0;
  // What Job Hunt put in a field, and which fields it first saw empty: to tell afterwards
  // which answers are the person's own.
  const puts = new WeakMap(), wasEmpty = new WeakSet();
  const NEWS = /newsletter|subscribe|mailing list|sign up for (our )?(news|updates|emails?)/i;
  const notTheForm = el => !!el.closest('footer,nav,[role=contentinfo],[role=navigation],[role=search]') || NEWS.test(`${el.id || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`);
  const sectionOf = el => {
    let t = null;
    const a = anchor(el);
    for (const h of heads) { if (h.ownerDocument === a.ownerDocument && (h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) t = h; }
    return t ? textOf(t).slice(0, 80) : '';
  };
  // Which entry of a history a field belongs to: "Work Experience 2" is job two.
  const ENTRY = [['edu', /education|school|academic|degree/i], ['lang', /language/i], ['cert', /certif|licen[cs]e/i], ['work', /work experience|employment|experience|work history|career history|previous (job|position)/i]];
  function entryOf(f, el) {
    const id = `${el.id || ''} ${el.getAttribute('name') || ''}`;
    const gh = /\b(school|degree|discipline|start-month|start-year|end-month|end-year)--(\d+)\b/.exec(id);
    if (gh) return { type: 'edu', n: +gh[2] + 1 };
    const sec = f.section || '';
    const hit = ENTRY.find(e => e[1].test(sec));
    if (!hit) return null;
    const m = /(\d+)\s*$/.exec(sec);
    return { type: hit[0], n: m ? +m[1] : 0 };
  }
  const isOn = el => (el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' || /(^|[\s_-])(active|selected|checked)([\s_-]|$)/i.test(String(el.className || '')));
  const SKILLS = /\bskills?\b/i;
  const PROMPT_BOX = '[data-automation-id="multiSelectContainer"],[data-automation-id="multiselectInputContainer"],[data-uxi-widget-type="multiselect"]';
  const comboLike = el => el.getAttribute('role') === 'combobox' || !!el.closest('[role="combobox"]') || /^(list|both)$/.test(el.getAttribute('aria-autocomplete') || '') || /^(listbox|true)$/.test(el.getAttribute('aria-haspopup') || '') || /select__input|tt-input|ui-autocomplete-input|typeahead/i.test(String(el.className || ''));

  // Parts of a form that are folded shut are opened, so their fields can be read.
  function unfold() {
    let n = 0;
    for (const d of all('details:not([open])')) if (d.querySelector('input,textarea,select') && !notTheForm(d)) { d.open = true; n++; note('opened a folded part', d); }
    for (const b of all('button[aria-expanded="false"][aria-controls],[role="button"][aria-expanded="false"][aria-controls]')) {
      if (b.getAttribute('aria-haspopup') || b.getAttribute('role') === 'combobox' || notTheForm(b) || !shown(b)) continue;
      const part = byId(b, b.getAttribute('aria-controls'));
      if (part && !shown(part) && part.querySelector('input,textarea,select') && press(b)) { n++; note('opened a folded part', b); }
    }
    return n;
  }
  function collect() {
    findRoots();
    if (unfold()) findRoots();
    site = detect();
    fields = []; adders = [];
    const hs = all('h1,h2,h3,h4,h5,h6,legend,[role="heading"]').filter(h => shown(h) && textOf(h).length > 1 && textOf(h).length < 100);
    // A heading over nothing but a date's boxes, or a question's own choices, names that
    // question and not a part of the form.
    heads = hs.filter(h => {
      const box = h.closest('fieldset') || h.parentElement;
      const ins = box ? [...box.querySelectorAll('input,select,textarea')].filter(x => x.type !== 'hidden') : [];
      if (ins.length && ins.length <= 6 && ins.every(x => datePart(x))) return false;
      if (h.tagName === 'LEGEND' && ins.length && (ins.length <= 2 || ins.every(x => x.type === 'radio' || x.type === 'checkbox'))) return false;
      return true;
    });
    const step = clean((all('[data-automation-id="progressBarActiveStep"]')[0] || {}).textContent).replace(/^current step \d+ of \d+\s*/i, '');
    const yours = /voluntary|self.?identif|equal opportunity|eeo|demographic|diversity/i;
    const add = (f, els) => {
      f.els = els; f.el = els[0];
      f.label = clean(f.label).slice(0, 400);
      f.section = sectionOf(els[0]);
      f.entry = entryOf(f, els[0]);
      if (!f.filled) wasEmpty.add(f.el);
      f.private = PRIVATE.test(f.label) || yours.test(f.section) || yours.test(step) || /^eeo\[/.test(f.name || '');
      fields.push(f);
    };
    const groups = new Map(), datesDone = new Set(), taken = new Set();
    for (const el of all('input,textarea,select,[contenteditable="true"][role="textbox"]')) {
      if (el.disabled || notTheForm(el)) continue;
      const tag = el.tagName;
      const part = datePart(el);
      if (part) {
        if (datesDone.has(el)) continue;
        const parts = dateParts(el);
        parts.forEach(x => datesDone.add(x));
        const kinds = parts.map(datePart);
        const format = kinds.includes('day') ? 'MM/DD/YYYY' : kinds.includes('month') ? 'MM/YYYY' : 'YYYY';
        const year = parts.find(x => datePart(x) === 'year');
        add({ kind: 'date', type: 'parts', format, label: (question(el, parts) || labelOf(el)).replace(/\s*\b(month|day|year)\b\s*$/i, '') || 'Date', filled: !!(year && year.value), required: parts.some(x => x.required || x.getAttribute('aria-required') === 'true') }, parts);
        continue;
      }
      const type = tag === 'SELECT' ? 'select' : tag === 'TEXTAREA' ? 'textarea' : tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : 'rich';
      if (['hidden', 'password', 'submit', 'button', 'image', 'reset', 'range', 'color'].includes(type)) continue;
      // A list's stand-in that only carries "required" (react-select's): not a field.
      if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0 && tag === 'INPUT') continue;
      const name = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('data-ui') || ''} ${el.getAttribute('data-automation-id') || ''}`.toLowerCase().trim();
      const base = { type, name, auto: (el.getAttribute('autocomplete') || '').toLowerCase(), required: el.required || el.getAttribute('aria-required') === 'true' };
      if (type === 'file') {
        const t = `${name} ${labelOf(el)} ${el.getAttribute('accept') || ''}`.toLowerCase();
        add({ ...base, kind: 'file', label: labelOf(el) || 'Upload', filled: !!(el.files && el.files.length) || !!hasFile(el), want: /cover|letter|motivation/.test(t) && !/resume|résumé|\bcv\b/.test(t.replace(/cover[ _-]?letter/g, '')) ? 'letter' : /resume|résumé|\bcv\b|curriculum/.test(t) ? 'cv' : '' }, [el]);
        continue;
      }
      if (type === 'radio' || type === 'checkbox') {
        if (!shown(el) && ((el.tabIndex < 0 && !(el.labels && el.labels.length)) || (!(el.labels && [...el.labels].some(shown)) && !shown(el.parentElement)))) continue;
        const sec = sectionOf(el);
        const box = el.closest('fieldset,[role="radiogroup"],[role="group"]');
        const k = type + '|' + (el.getAttribute('name') || '') + '|' + sec + '|' + (el.getAttribute('name') ? '' : box ? [...all('fieldset,[role="radiogroup"],[role="group"]')].indexOf(box) : 'x' + groups.size);
        let g = groups.get(k);
        if (!g) { g = { ...base, type, els: [] }; groups.set(k, g); }
        g.els.push(el);
        continue;
      }
      if (type === 'search' && !comboLike(el)) continue;
      if (tag === 'SELECT') {
        // A select hidden behind the site's own drawn list (iCIMS, select2, chosen): still the field.
        const drawn = !shown(el) && el.parentElement && [...el.parentElement.children].some(x => x !== el && shown(x) && /select|dropdown|chosen/i.test(String(x.className || '')));
        if (!shown(el) && !drawn) continue;
        const opts = [...el.options];
        const chosen = el.selectedIndex >= 0 && opts[el.selectedIndex] && el.value !== '' && !UNCHOSEN.test(clean(opts[el.selectedIndex].text));
        add({ ...base, kind: 'select', label: labelOf(el), options: opts.map(o => clean(o.text).slice(0, 120)), filled: !!chosen, multi: el.multiple }, [el]);
        continue;
      }
      if (!shown(el)) continue;
      const label = labelOf(el);
      let kind = tag === 'TEXTAREA' || type === 'rich' ? 'textarea' : 'text';
      if (kind === 'text') {
        const prompt = !!el.closest(PROMPT_BOX) || el.getAttribute('data-uxi-widget-type') === 'selectinput';
        if (SKILLS.test(label) && !/years|level|describe|summary/i.test(label) && (prompt || comboLike(el)) && !/comma/i.test(`${label} ${el.getAttribute('placeholder') || ''}`)) kind = 'skills';
        else if (prompt) kind = 'prompt';
        else if (comboLike(el)) kind = el.readOnly ? 'drop' : 'combo';
        else if (el.readOnly) continue;
      } else if (el.readOnly) continue;
      const val = type === 'rich' ? clean(el.textContent) : clean(el.value);
      const f = { ...base, kind, label, filled: kind === 'drop' ? !UNCHOSEN.test(val) : !!val, numeric: type === 'number' || /^(numeric|decimal)$/.test(el.getAttribute('inputmode') || '') || /^\[?\\?d|^\[0-9/.test(el.getAttribute('pattern') || ''), max: el.maxLength > 0 ? el.maxLength : 0 };
      if (kind === 'skills' || kind === 'prompt') { const box = el.closest('[data-automation-id^="formField"]') || el.closest(PROMPT_BOX) || el.parentElement; f.filled = !!(box && box.querySelector('[data-automation-id="selectedItem"],[class*="multi-value"]')); }
      if (kind === 'combo') { const box = el.closest('[class*="select__control"],[class*="select-shell"]'); if (box && box.querySelector('[class*="single-value"],[class*="multi-value"]')) f.filled = true; }
      taken.add(el);
      add(f, [el]);
    }
    for (const g of groups.values()) {
      const first = g.els[0], opts = g.els.map(optLabel).map(t => t.slice(0, 120));
      if (g.type === 'checkbox' && (g.els.length === 1 || new Set(opts).size === 1)) {
        // One box, or several that all say the same ("I currently work here" in each entry).
        for (const el of g.els) add({ ...g, els: undefined, kind: 'checkbox', label: (optLabel(el) !== 'on' && optLabel(el)) || labelOf(el), context: question(el), filled: el.checked }, [el]);
        continue;
      }
      add({ ...g, els: undefined, kind: g.type === 'radio' ? 'radio' : 'checks', label: question(first, g.els) || clean(first.getAttribute('name')), options: opts, filled: g.els.some(e => e.checked) }, g.els);
    }
    // Lists drawn by the site: a button (Workday's "Select One") or another element that opens one.
    for (const b of all(DROP)) {
      if (!shown(b) || b.disabled || b.getAttribute('aria-disabled') === 'true' || notTheForm(b)) continue;
      const inner = [...b.querySelectorAll('input')].find(x => taken.has(x));
      if (inner || fields.some(f => f.el === b)) continue;
      if (b.tagName === 'LYTE-DROPDOWN' && b.querySelector('[role="combobox"]')) continue;
      const now = clean(b.textContent);
      // Zoho Recruit's dates: a month and a year list for the start, and again for the end.
      let label = labelOf(b).replace(/\s*\b(select one|required)\b\s*/gi, ' ').trim();
      const range = b.closest('rec-month-range-component');
      if (range) {
        const i = [...range.querySelectorAll(DROP)].indexOf(b);
        const m = /_(from|to)_(month|year)$/.exec(((b.closest('rec-dropdown') || b.closest('lyte-dropdown') || b).id) || '');
        label = `${clean(range.getAttribute('cx-prop-label')) || 'Duration'}: ${m ? m[1] : i < 2 ? 'from' : 'to'} (${m ? m[2] : i % 2 ? 'year' : 'month'})`;
      }
      add({ kind: 'drop', type: 'drop', name: `${b.id || ''} ${b.getAttribute('data-automation-id') || ''}`.toLowerCase().trim(), auto: '', label, filled: !UNCHOSEN.test(now), options: [], required: b.getAttribute('aria-required') === 'true' || /required/i.test(b.getAttribute('aria-label') || '') }, [b]);
    }
    // Choices drawn as things to click that are not real radio buttons or tick boxes.
    const custom = new Map();
    for (const r of all('[role="radio"]:not(input),[role="checkbox"]:not(input)')) {
      if (!shown(r) || notTheForm(r) || r.querySelector('input')) continue;
      const box = r.closest('[role="radiogroup"],[role="group"],fieldset') || r.parentElement;
      if (!custom.has(box)) custom.set(box, []);
      custom.get(box).push(r);
    }
    for (const [, els] of custom) {
      const one = els[0].getAttribute('role') === 'checkbox';
      if (one && els.length === 1) add({ kind: 'checkbox', type: 'checkbox', name: '', auto: '', label: optLabel(els[0]) || labelOf(els[0]), context: question(els[0]), filled: isOn(els[0]) }, els);
      else add({ kind: one ? 'checks' : 'radio', type: one ? 'checkbox' : 'radio', name: '', auto: '', label: question(els[0], els), options: els.map(optLabel), filled: els.some(isOn) }, els);
    }
    // Yes and No as two buttons (Ashby).
    const seen = new Set();
    for (const b of all('button')) {
      if (seen.has(b) || !/^(yes|no)$/i.test(clean(b.textContent)) || !shown(b) || notTheForm(b) || !b.parentElement) continue;
      const sibs = [...b.parentElement.querySelectorAll(':scope > button')].filter(x => shown(x) && clean(x.textContent).length < 30);
      sibs.forEach(x => seen.add(x));
      const words = sibs.map(x => clean(x.textContent).toLowerCase());
      if (sibs.length < 2 || sibs.length > 4 || !words.includes('yes') || !words.includes('no')) continue;
      add({ kind: 'radio', type: 'buttons', name: '', auto: '', label: question(sibs[0], sibs), options: sibs.map(x => clean(x.textContent)), filled: sibs.some(isOn) }, sibs);
    }
    // In the order they are on the page, so each entry's fields sit together.
    fields.sort((a, b) => (a.el === b.el ? 0 : follows(a.el, b.el) ? -1 : 1));
    fields = fields.slice(0, 220);
    // Entries that are not numbered: how often their first kind of field has come round.
    const first = {}, at = {};
    for (const f of fields) {
      if (!f.entry || f.entry.n) continue;
      const t = f.entry.type, sig = f.kind + '|' + f.label.replace(/\s*\(.*\)$/, '').toLowerCase();
      if (!first[t]) first[t] = sig;
      if (sig === first[t]) at[t] = (at[t] || 0) + 1;
      f.entry.n = at[t] || 1;
    }
    fields.forEach((f, i) => { f.i = i; });
    collectAdders();
    scanned = Date.now();
    return step;
  }
  // "Add another" under work experience or education: the form shows one entry until it is pressed.
  const ADD = /^\s*\+?\s*add\b/i, NOT_ADD = /\b(file|attachment|resume|cv|cover|link|website|url|document|photo|skill|reference|portfolio)s?\b/i;
  function collectAdders() {
    if (site === 'workable' || site === 'smartrecruiters') return; // theirs open a small form with its own Save
    const seen = new Set();
    for (const b of all('button,[role="button"],a')) {
      if (!shown(b) || notTheForm(b)) continue;
      const t = clean(b.textContent || b.getAttribute('aria-label')), aria = clean(b.getAttribute('aria-label'));
      if (!t || t.length > 40 || !ADD.test(t) || NOT_ADD.test(t + ' ' + aria)) continue;
      if (!['workday', 'greenhouse', 'zoho'].includes(site) && !/another|add (work|education|experience|employment)/i.test(t + ' ' + aria)) continue;
      // The button that saves the entry being typed ("Add" beside Cancel) adds no new entry.
      const beside = b.parentElement ? [...b.parentElement.querySelectorAll('button,input[type=button],input[type=submit],a')].some(x => x !== b && /^\s*cancel\s*$/i.test(x.textContent || x.value || '')) : false;
      if (beside || (b.type === 'submit' && b.form && !b.hasAttribute('data-automation-id') && /^\s*add\s*$/i.test(t))) continue;
      // What it adds: said by the button, else by the fields just around it, else by its heading.
      let around = '';
      for (let p = b.parentElement, i = 0; p && i < 4 && !around; p = p.parentElement, i++) {
        const mine = fields.filter(f => f.entry && p.contains(f.el));
        if (mine.length) around = mine[mine.length - 1].entry.type;
      }
      const said = (ENTRY.find(e => e[1].test(t + ' ' + aria)) || [])[0];
      const type = said || around || (ENTRY.find(e => e[1].test(sectionOf(b))) || [])[0];
      if (!type || seen.has(type)) continue;
      seen.add(type);
      adders.push({ type, label: t, el: b, entries: Math.max(0, ...fields.filter(f => f.entry && f.entry.type === type).map(f => f.entry.n)) });
    }
  }
  // An upload box that already has a file: its name is listed next to it.
  const FILE_NAME = /[^\s\\/]\.(pdf|docx?|rtf|odt|txt|pages)(?![a-z])/i;
  function hasFile(el) {
    if (el.files && el.files.length) return el.files[0].name;
    let node = el;
    for (let i = 0; i < 6 && node.parentElement && node.parentElement.tagName !== 'BODY'; i++) {
      node = node.parentElement;
      if ([...node.querySelectorAll('input[type=file]')].some(x => x !== el)) return '';
      const m = FILE_NAME.exec(textOf(node));
      if (m) { const names = [...node.querySelectorAll('*')].filter(x => !x.children.length).map(x => clean(x.textContent)).filter(t => t.length < 150 && /\S\.(pdf|docx?|rtf|odt|txt|pages)$/i.test(t)); return names[0] || 'a file'; }
    }
    return '';
  }
  const pub = f => ({ i: f.i, kind: f.kind, type: f.type, label: f.label, section: f.section, entry: f.entry, options: (f.options || []).slice(0, 300), filled: !!f.filled, auto: f.auto || '', name: f.name || '', required: !!f.required, numeric: !!f.numeric, max: f.max || 0, private: !!f.private, context: f.context || '', format: f.format || '', want: f.want || '', multi: !!f.multi });

  // In a frame of the same site as the page around it, the outer page reads this one too.
  const covered = () => { if (window === window.top) return false; try { return !!window.parent.document.body; } catch (e) { return false; } };

  async function scan(opts) {
    opts = opts || {};
    if (covered()) return { fields: [], adders: [], files: 0, url: location.href, covered: true };
    const step = collect();
    // Lists that only hold their choices while open: each still-empty one is opened once and read.
    if (opts.lists !== false) {
      let n = 0;
      const skip = new Set(opts.skip || []); // read on an earlier pass
      for (const f of fields) {
        if (f.kind !== 'drop' || f.filled || f.private || n >= 24 || skip.has(`${f.section}|${f.label}`)) continue;
        n++;
        const names = new Set();
        const list = await openDrop(f.el);
        if (list.length) await wholeList(list, f.el, names);
        await closeLists(f.el);
        f.options = [...names].filter(x => !UNCHOSEN.test(x)).slice(0, 300);
        note(list.length ? 'read a list' : 'a list did not open', f, `${f.options.length} choices`);
      }
    }
    note('read the form', null, `${site || 'no known system'}; ${fields.length} fields; ${adders.length} add buttons${step ? '; step ' + step : ''}`);
    return { site, step, url: location.href, fields: fields.map(pub), adders: adders.map((a, i) => ({ a: i, type: a.type, label: a.label, entries: a.entries })), files: fields.filter(f => f.kind === 'file').length };
  }
  // The one field the person pointed at (right-click, "Job Hunt: fill this in").
  async function scanOne() {
    findRoots();
    let t = all('[data-jobhunt-target]')[0];
    all('[data-jobhunt-target]').forEach(x => x.removeAttribute('data-jobhunt-target'));
    if (!t) { t = document.activeElement; while (t && shadowOf(t) && shadowOf(t).activeElement) t = shadowOf(t).activeElement; }
    if (!t || t.tagName === 'BODY') return { field: null };
    collect();
    const f = fields.find(x => x.els.includes(t)) || fields.find(x => x.els.some(e => e.contains(t) || t.contains(e)));
    if (!f) return { field: null };
    if (f.kind === 'drop' && !f.private) { const names = new Set(); const list = await openDrop(f.el); if (list.length) await wholeList(list, f.el, names); await closeLists(f.el); f.options = [...names].filter(x => !UNCHOSEN.test(x)); }
    note('read one field', f);
    return { site, url: location.href, field: pub(f) };
  }

  // ---- filling --------------------------------------------------------------------------
  function setter(el, v) {
    if (el.isContentEditable) { el.focus(); el.textContent = v; el.dispatchEvent(new InputEvent('input', { bubbles: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return; }
    const w = win(el);
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype;
    // The browser's own way of setting a value, so that pages built with React or Angular notice.
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    for (const e of ['input', 'change']) el.dispatchEvent(new Event(e, { bubbles: true, composed: true }));
    // Such pages keep what was typed only once the box loses focus.
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
  }
  // Typed without leaving the box, so a list of suggestions stays open.
  function typeInto(el, q) {
    el.focus();
    Object.getOwnPropertyDescriptor(win(el).HTMLInputElement.prototype, 'value').set.call(el, q);
    for (const e of [new KeyboardEvent('keydown', { bubbles: true, composed: true, key: q.slice(-1) }), new InputEvent('input', { bubbles: true, composed: true, data: q, inputType: 'insertText' }), new KeyboardEvent('keyup', { bubbles: true, composed: true, key: q.slice(-1) })]) el.dispatchEvent(e);
  }
  // Key by key, for a box that ignores a value put in whole (a masked date box).
  function typeKeys(el, text) {
    const set = Object.getOwnPropertyDescriptor(win(el).HTMLInputElement.prototype, 'value').set;
    el.focus();
    set.call(el, '');
    for (const ch of String(text)) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      set.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
  function mark(el, tone) {
    let box = el;
    if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) box = (el.labels && el.labels[0]) || el.parentElement || el;
    while (box && box.parentElement && !shown(box)) box = box.parentElement;
    if (!box || !box.style) return;
    box.style.outline = `2px solid ${tone === 'check' ? '#B7791F' : '#2F4FC4'}`;
    box.style.outlineOffset = '1px';
  }
  const wants = it => [it.value, ...(it.alts || [])].map(v => clean(v)).filter(Boolean);
  // The first of the answers that is one of the choices.
  const choose = (names, it, loose) => { for (const w of wants(it)) { const i = pick(names, w, loose); if (i >= 0) return i; } return typeof it.option === 'number' && names[it.option] !== undefined ? it.option : -1; };

  async function fillDrop(f, it) {
    const b = f.el, names = new Set();
    let list = await openDrop(b);
    if (!list.length) { await closeLists(b); return { ok: false, why: 'closed' }; }
    let i = choose(list.map(optName), it);
    if (i < 0) { list = await wholeList(list, b, names); i = choose(list.map(optName), it); }
    if (i < 0) { await closeLists(b); return { ok: false, why: 'choice', options: [...names].filter(x => !UNCHOSEN.test(x)).slice(0, 60) }; }
    const name = optName(list[i]);
    list[i].scrollIntoView({ block: 'nearest' });
    press(list[i], true);
    await wait(200);
    await closeLists(b);
    const now = clean(b.tagName === 'INPUT' ? b.value : b.textContent);
    f.put = name;
    return !UNCHOSEN.test(now) || same(now, name) ? { ok: true } : { ok: false, why: 'ignored' };
  }
  // A box that suggests as you type (a place, a school), or a searchable list (react-select).
  async function fillCombo(f, it) {
    const el = f.el;
    const control = el.closest('[class*="select__control"],[class*="select-shell"]') || el;
    const strict = control !== el || el.getAttribute('aria-autocomplete') === 'list' || !!el.closest('[role="combobox"][aria-haspopup="listbox"]');
    await closeLists();
    for (const o of openOptions()) stale.add(o);
    el.focus();
    press(control);
    await wait(160);
    const seenNames = new Set();
    const look = async ms => { let list = []; for (let t = 0; t < ms; t += 120) { await wait(120); list = optionsFor(el); if (list.length) break; } list.forEach(o => seenNames.add(optName(o))); return list; };
    let list = optionsFor(el), i = choose(list.map(optName), it);
    list.forEach(o => seenNames.add(optName(o)));
    for (const w of i < 0 ? wants(it) : []) {
      typeInto(el, w);
      list = await look(2400);
      i = pick(list.map(optName), w, true);
      if (i >= 0) break;
      // A shorter search: the first words of a long answer.
      const short = w.split(/[,(]/)[0].trim();
      if (short && short !== w) { typeInto(el, short); list = await look(2000); i = pick(list.map(optName), w, true); if (i < 0) i = pick(list.map(optName), short, true); if (i >= 0) break; }
    }
    if (i < 0) {
      if (strict || !wants(it).length) { typeInto(el, ''); await closeLists(el); return { ok: false, why: 'choice', options: [...seenNames].slice(0, 60) }; }
      // A plain box that only suggests: what was typed stays, for the person to check.
      setter(el, wants(it)[0]);
      await closeLists(el);
      f.put = wants(it)[0];
      return { ok: true, check: true };
    }
    const name = optName(list[i]);
    press(list[i], true);
    await wait(220);
    await closeLists(el);
    f.put = name;
    const shows = clean(el.value) || clean((control.closest('[class*="select__control"],[class*="select-shell"],[role="combobox"]') || control.parentElement || control).textContent);
    return shows && (near(shows, name) || shows.toLowerCase().includes(core(name))) ? { ok: true } : { ok: true, check: true };
  }
  // Workday's boxes that take items from its own list: type, Enter, choose the match.
  async function fillPrompt(f, it, many) {
    const first = f.el;
    const field = first.closest('[data-automation-id^="formField"]') || first.closest(PROMPT_BOX) || first.parentElement;
    const box = () => (first.isConnected ? first : (first.id && byId(field, first.id)) || [...field.querySelectorAll('input')].find(shown) || first);
    const pills = () => [...(field.isConnected ? field : document).querySelectorAll('[data-automation-id="selectedItem"],[class*="multi-value"]')].map(x => clean(x.textContent).toLowerCase());
    const list = many ? [...new Set(String(it.value).split(/\s*[;\n]\s*/).map(clean).filter(Boolean))].slice(0, 12) : wants(it).slice(0, 4);
    let done = 0, missed = 0;
    const seenNames = new Set();
    for (const w of list) {
      if (pills().some(p => near(p, w))) { done++; if (!many) break; continue; }
      const el = box();
      await closeLists();
      for (const o of openOptions()) stale.add(o);
      typeInto(el, w);
      key(el, 'Enter');
      let opts = [];
      for (let t = 0; t < 3000; t += 150) { await wait(150); opts = openOptions().filter(o => !stale.has(o)); if (opts.length) break; }
      opts.forEach(o => seenNames.add(optName(o)));
      const names = opts.map(optName);
      let i = pick(names, w);
      if (i < 0) i = names.findIndex(n => core(n).replace(/\s*\([^)]*\)/g, '') === core(w));
      if (i < 0 && many) i = names.findIndex(n => n.toLowerCase().startsWith(w.toLowerCase() + ' '));
      if (i < 0) { missed++; typeInto(box(), ''); await closeLists(box()); continue; }
      const o = opts[i];
      press(o.querySelector('input[type=checkbox],input[type=radio]') || o, true);
      await wait(260);
      if (pills().some(p => near(p, names[i]) || near(p, tail(names[i]) || names[i]))) done++; else missed++;
      if (box().value) typeInto(box(), '');
      await closeLists(box());
      if (!many && done) break;
    }
    if (done) f.put = list.slice(0, done).join('; ');
    if (!done) return { ok: false, why: 'choice', options: many ? [] : [...seenNames].slice(0, 60) };
    return { ok: true, check: many && missed > 0, why: many && missed ? `${missed} not in its list` : '' };
  }
  async function fillOne(f, it) {
    const el = f.el;
    if (!el || !f.els.some(e => e.isConnected)) return { ok: false, why: 'gone' };
    if (f.private && !it.over) return { ok: false, why: 'yours' };
    if (f.kind === 'file') return { ok: false, why: 'file' };
    if (f.kind === 'date') {
      const d = splitDate(it.value);
      if (!d.year) return { ok: false, why: 'date' };
      for (const p of f.els) { const k = datePart(p), v = d[k] || (k === 'day' ? '01' : k === 'month' ? '01' : ''); if (!v) continue; p.focus(); setter(p, v); await wait(40); }
      f.put = String(it.value);
      return { ok: f.els.every(p => !d[datePart(p)] || clean(p.value).replace(/^0/, '') === d[datePart(p)].replace(/^0/, '')) };
    }
    if (f.kind === 'select') {
      const opts = [...el.options], names = opts.map(o => clean(o.text));
      const i = choose(names, it);
      if (i < 0 || UNCHOSEN.test(names[i])) return { ok: false, why: 'choice', options: names.filter(x => !UNCHOSEN.test(x)).slice(0, 60) };
      setter(el, opts[i].value);
      if (el.selectedIndex !== i) { el.selectedIndex = i; for (const e of ['input', 'change']) el.dispatchEvent(new Event(e, { bubbles: true })); }
      await wait(60);
      f.put = names[i];
      // A drawn list over a hidden select shows the choice once told.
      if (!shown(el) && el.parentElement) { const face = [...el.parentElement.querySelectorAll('[class*="selected"],[class*="chosen-single"] span,[class*="rendered"],.dropdown-text')].find(shown); if (face && !face.children.length) face.textContent = names[i]; }
      return { ok: !el.isConnected || el.selectedIndex === i };
    }
    if (f.kind === 'radio') {
      const i = choose(f.options, it);
      if (i < 0 || !f.els[i]) return { ok: false, why: 'choice', options: f.options.slice(0, 60) };
      const t = f.els[i];
      if (!isOn(t)) { press(t, true); await wait(60); }
      if (!isOn(t) && t.tagName === 'INPUT' && t.labels && t.labels[0]) { press(t.labels[0], true); await wait(60); }
      f.put = f.options[i];
      return { ok: isOn(t) || t.tagName !== 'INPUT', check: !isOn(t) };
    }
    if (f.kind === 'checks') {
      const want = wants(it).flatMap(w => w.split(/\s*;\s*/)).filter(Boolean);
      let any = false;
      for (const [i, e] of f.els.entries()) {
        if (!want.some(w => near(f.options[i], w))) continue;
        if (!isOn(e)) { press(e, true); await wait(50); }
        any = any || isOn(e);
      }
      return any ? { ok: true } : { ok: false, why: 'choice', options: f.options.slice(0, 60) };
    }
    if (f.kind === 'checkbox') {
      const on = /^(yes|true|checked|tick)/i.test(String(it.value)), off = /^(no|false|unchecked|untick)/i.test(String(it.value));
      for (let i = 0; i < 2 && ((on && !isOn(el)) || (off && isOn(el))); i++) { press(i === 0 ? el : (el.labels && el.labels[0]) || el.parentElement, true); await wait(80); }
      return { ok: on ? isOn(el) : off ? !isOn(el) : false };
    }
    if (f.kind === 'drop') return fillDrop(f, it);
    if (f.kind === 'skills') return fillPrompt(f, it, true);
    if (f.kind === 'prompt') return fillPrompt(f, it, false);
    // Never write over what the person typed, unless they pointed at this field and asked.
    const has = el.isContentEditable ? clean(el.textContent) : clean(el.value);
    if (has && !it.over) return { ok: false, why: 'kept' };
    if (f.kind === 'combo') return fillCombo(f, it);
    let v = String(it.value == null ? '' : it.value);
    if (!v) return { ok: false, why: 'empty' };
    let check = false;
    if (f.numeric) { const n = v.replace(/[^\d.]/g, ''); if (!n) return { ok: false, why: 'number' }; v = n; }
    if (/^(date|month)$/.test(f.type) || /\b(mm|yyyy)\b/i.test(el.getAttribute('placeholder') || '')) v = dateFor(el, v);
    if (f.max && v.length > f.max) { v = v.slice(0, f.max); check = true; }
    const was = el.value;
    el.focus && el.focus();
    setter(el, v);
    await wait(30);
    // A box that put back what it had: typed in as a keyboard would.
    if (!el.isContentEditable && el.isConnected && el.value === was && was !== v && el.tagName === 'INPUT') { typeKeys(el, v); await wait(60); }
    f.put = v;
    const now = el.isContentEditable ? clean(el.textContent) : el.value;
    return now ? { ok: true, check: check || clean(now) !== clean(v) } : { ok: false, why: 'ignored' };
  }
  // Types the answers in. `items`: [{ i, value, alts, option, tone, over }]. The answer for each
  // says whether it took, and why not when it did not.
  async function fill(items) {
    findRoots();
    const out = [];
    for (const it of items || []) {
      const f = fields[Number(it.i)];
      let r;
      if (!f) r = { ok: false, why: 'gone' };
      else { try { r = await fillOne(f, it); } catch (e) { r = { ok: false, why: 'error' }; note('tripped', f, e && e.message); } }
      if (f && r.ok) { f.done = true; if (f.put !== undefined) puts.set(f.el, f.put); mark(f.el, r.check || it.tone === 'check' ? 'check' : 'ok'); }
      if (f) note(r.ok ? (r.check ? 'filled, to check' : 'filled') : 'left', f, r.why || '');
      out.push({ i: it.i, ok: !!r.ok, check: !!r.check, why: r.why || '', options: r.options });
    }
    await closeLists();
    return out;
  }
  // Presses "Add another" for a part of the form (work, education), so its next entry shows.
  async function addEntry(a) {
    const x = adders[Number(a)];
    if (!x || !x.el.isConnected || !shown(x.el)) return { ok: false };
    const ok = press(x.el);
    note(ok ? 'pressed add' : 'did not press add', x.el, x.type);
    await wait(700);
    return { ok };
  }

  // ---- uploads --------------------------------------------------------------------------
  // Puts a file into the form's upload box. `file.want` is "cv" or "letter". A box that has
  // a file already keeps it unless `file.replace` says otherwise.
  async function attach(file) {
    if (covered()) return { ok: false, why: 'none' };
    findRoots();
    const inputs = all('input[type="file"]').filter(el => !el.disabled && !notTheForm(el));
    if (!inputs.length) return { ok: false, why: 'none' };
    const about = el => {
      let t = [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-ui'), el.getAttribute('data-automation-id')].join(' ') + ' ' + labelOf(el);
      const host = el.getRootNode().host;
      if (host) t += ' ' + (host.getAttribute('label') || '') + ' ' + host.tagName;
      const box = el.closest('[class*="field"],[class*="upload"],[class*="attach"],[class*="resume"],[class*="cover"],fieldset,li,section,div');
      if (box) t += ' ' + (box.innerText || box.textContent || '').slice(0, 300);
      return t.toLowerCase();
    };
    const isCV = t => /resume|résumé|\bcv\b|curriculum/.test(t), isLetter = t => /cover|letter|motivation/.test(t);
    let target;
    if (file.want === 'letter') target = inputs.find(el => { const t = about(el); return isLetter(t) && !isCV(t.replace(/cover[ _-]?letter/g, '')); }) || inputs.find(el => isLetter(about(el)) && !/resume|\bcv\b/.test(`${el.id} ${el.getAttribute('name')}`.toLowerCase()));
    else target = inputs.find(el => { const t = about(el); return isCV(t) && !isLetter(t); }) || inputs.find(el => isCV(about(el)) && !/cover|letter/.test(`${el.id} ${el.getAttribute('name')}`.toLowerCase())) || (inputs.length === 1 && !isLetter(`${inputs[0].id} ${inputs[0].getAttribute('name')}`.toLowerCase()) ? inputs[0] : null);
    if (!target) return { ok: false, why: file.want === 'letter' && inputs.length === 1 ? 'none' : 'unsure', count: inputs.length };
    const there = hasFile(target);
    if (there && !file.replace) { note('kept the file already there', target); return { ok: false, why: 'has', name: String(there).slice(0, 120) }; }
    const bin = atob(file.b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.type }));
    target.files = dt.files;
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await wait(150);
    // Some sites take the file and empty the box at once; then the page lists its name.
    const ok = (target.isConnected && target.files.length === 1) || (document.body.innerText || '').includes(file.name);
    note(ok ? 'attached a file' : 'a file did not take', target, file.want);
    if (ok) mark(target, 'ok');
    return { ok };
  }

  // ---- when the person sends the form ---------------------------------------------------
  const DONE = /thanks? (you )?for (applying|your application|submitting( your application)?|your submission)|application (has been |was |is )?(successfully )?(submitted|received|sent|complete)|we('ve| have)? (successfully )?received your (application|submission|resume|résumé|cv)|your application (has been|was|is) (successfully )?(received|submitted|sent|complete|on its way)|successfully (applied|submitted)|you('ve| have) (successfully )?applied|submission (received|complete|successful)|application complete/i;
  const POLITE = /thank you for your interest|we('ll| will) (be in touch|review your application|contact you)|thanks?,? we('ve| have) got it/i;
  const DONE_URL = /[/#?&](confirmation|confirm|thank-?you|thanks|success|submitted|application-?(complete|submitted|received)|applied|jobTasks\/completed)\b/i;
  const NOT_SEND = /^\s*\+?\s*(add|delete|remove|edit|cancel|back|previous|next|continue|save|upload|select|choose|attach|browse|clear|close|sign in|log in|create account|search|yes|no)\b/i;
  const NEVER_KEEP = /passwor|passcode|\bpin\b|social (security|insurance)|\bssn\b|\bsin\b|national (id|insurance)|passport|driver'?s? licen[cs]e|\bbank|\biban\b|routing|account (number|no)|sort code|card (number|no)|credit card|debit card|\bcvv\b|\bcvc\b|date of birth|birth ?(date|day)|\bdob\b/i;
  const CONTACT = /^(first|last|full|legal|given|family|middle|preferred)? ?name|e-?mail|phone|mobile|address|city|postal|zip|linkedin|github|website|portfolio|resume|cv\b/i;
  const sent = []; // what was told to the panel (read by the test bench)
  function tell(m) {
    sent.push(m);
    try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ jobhunt: m.kind, ...m }, () => void chrome.runtime.lastError); } catch (e) { /* the panel is closed */ }
  }
  const pageText = () => (document.body ? document.body.innerText || document.body.textContent || '' : '').slice(0, 40000);
  const formHere = () => { findRoots(); const ins = all('input:not([type=hidden]),textarea,select').filter(shown); return ins.length >= 3 && ins.some(x => x.type === 'email' || x.type === 'file' || /e-?mail|resume|cv|name/i.test(`${x.name} ${x.id} ${x.getAttribute('autocomplete')}`)); };
  // What a field holds now, in words.
  function nowOf(f) {
    const e = f.el;
    if (!f.els.some(x => x.isConnected)) return '';
    if (f.kind === 'select') return e.selectedIndex >= 0 && e.value !== '' ? clean((e.options[e.selectedIndex] || {}).text) : '';
    if (f.kind === 'radio') { const i = f.els.findIndex(isOn); return i >= 0 ? f.options[i] : ''; }
    if (f.kind === 'drop') { const t = clean(e.tagName === 'INPUT' ? e.value : e.textContent); return UNCHOSEN.test(t) ? '' : t; }
    if (f.kind === 'text' || f.kind === 'textarea' || f.kind === 'combo') return e.isContentEditable ? clean(e.textContent) : clean(e.value);
    return '';
  }
  // Answers the person gave themselves: a field Job Hunt left empty, or one they changed.
  // Only offered to the person in the panel; never anything private or long.
  function learned() {
    const out = [];
    for (const f of fields) {
      if (!['text', 'textarea', 'select', 'radio', 'drop', 'combo'].includes(f.kind) || f.private || f.entry) continue;
      if (/^(password|email|tel|url|date|month|file)$/.test(f.type) || f.label.length < 6 || f.label.length > 300) continue;
      if (NEVER_KEEP.test(f.label) || PRIVATE.test(f.label) || CONTACT.test(f.label) || /salary|compensation|cover letter/i.test(f.label)) continue;
      const now = nowOf(f);
      if (!now || now.length > 300) continue;
      const put = puts.get(f.el);
      if (put !== undefined ? same(now, put) : !wasEmpty.has(f.el)) continue;
      out.push({ label: f.label, answer: now });
      if (out.length >= 8) break;
    }
    return out;
  }
  let pressedAt = 0, was = null, notSendAt = 0, watching = false, told = false;
  const confirmed = (before, ago, strict) => {
    const text = pageText();
    if (DONE.test(text) && !(before && before.done) && (strict || ago < 3 * 60 * 1000)) return true;
    if (strict || ago > 60 * 1000) return false;
    const weak = (POLITE.test(text) && !(before && before.polite)) || (DONE_URL.test(location.href) && location.href.split('#')[0] !== (before && before.url) && !DONE_URL.test((before && before.url) || ''));
    return weak && !formHere();
  };
  async function poll() {
    const mine = pressedAt;
    for (let i = 0; i < 120 && mine === pressedAt && !told && !retired; i++) {
      await wait(1000);
      if (confirmed(was, Date.now() - pressedAt, false)) { told = true; note('the site said it was sent'); tell({ kind: 'submitted', url: location.href }); return; }
    }
  }
  function onPressed(how) {
    if (!watching || retired || Date.now() - pressedAt < 3000) return;
    pressedAt = Date.now(); told = false;
    const text = pageText();
    was = { done: DONE.test(text), polite: POLITE.test(text), url: location.href.split('#')[0] };
    let learn = [];
    try { learn = learned(); } catch (e) { /* the form changed */ }
    note('the person pressed ' + how);
    tell({ kind: 'pressed', url: location.href, was, at: pressedAt, learn });
    poll();
  }
  const guarded = new WeakSet();
  // On every part of the page: stop a form that a click made here would send, and notice
  // when the person sends it.
  function guard() {
    for (const r of rootList) {
      const t = r.nodeType === 9 ? r.defaultView : r;
      if (!t || guarded.has(t)) continue;
      guarded.add(t);
      t.addEventListener('submit', e => {
        if (retired) return;
        if (ownClick) { e.preventDefault(); e.stopImmediatePropagation(); note('stopped a form sending itself', e.target); return; }
        const s = e.submitter;
        if (Date.now() - notSendAt < 3000 || (s && NOT_SEND.test(clean(s.textContent || s.value)))) return;
        onPressed('submit');
      }, true);
      t.addEventListener('click', e => {
        if (retired || ownClick || !watching || !e.isTrusted && typeof chrome !== 'undefined' && chrome.runtime) return;
        const path = e.composedPath ? e.composedPath() : [e.target];
        const b = path.find(x => x.matches && x.matches('button,input[type=submit],[role="button"]'));
        if (!b) return;
        const t = clean(b.textContent || b.value || b.getAttribute('aria-label'));
        // Save and Continue on a form of several pages: this page's own answers, before it goes.
        if (/^\s*(save and continue|save & continue|next|continue)\b/i.test(t)) { let learn = []; try { learn = learned(); } catch (err) { /* changed */ } if (learn.length) tell({ kind: 'learn', url: location.href, learn }); }
        if (NOT_SEND.test(t)) { notSendAt = Date.now(); return; }
        if (/^\s*(submit|send)\b|submit (my |your )?application|send (my |your )?application|complete application|finish application/i.test(t)) onPressed('a send button');
      }, true);
    }
  }
  // Starts noticing when the person sends the form (asked for by the panel after a fill).
  function watch() { findRoots(); watching = true; return { ok: true }; }
  // Asked by the panel on a page that loaded after the person pressed Submit, or after they
  // were applying in this tab: is this the site saying the application went in?
  function check(before, at) {
    if (covered()) return { done: false };
    const ago = at ? Date.now() - at : 0;
    const done = before ? confirmed(before, ago, false) : (DONE.test(pageText()) && !formHere()) || (DONE_URL.test(location.pathname) && POLITE.test(pageText()) && !formHere());
    if (done) note('this page says it was sent');
    return { done: !!done };
  }

  // ---- sending, only when the person presses "Submit application" in the side panel ----
  // The form's own last button: "Submit", "Submit application", "Send application".
  const SUBMIT = /^\s*(submit|send)( (my |your |the |this )?application)?\s*$|^\s*submit (and|&) (apply|finish)\s*$|^\s*complete (my |your )?application\s*$/i;
  const words = b => clean(b.textContent || b.value || b.getAttribute('aria-label'));
  function sendButtons() {
    return all('button,input[type=submit],[role="button"]').filter(b => shown(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && !notTheForm(b) && SUBMIT.test(words(b)));
  }
  // What the panel shows before the person decides: the form's Submit button,
  // and every required field that is still empty. It reads; it changes nothing.
  function review() {
    if (covered()) return { covered: true };
    collect();
    const missing = fields.filter(f => f.required && !f.filled && !(f.kind === 'checkbox' && f.els.some(isOn))).map(f => f.label || 'A field without a name');
    const buttons = sendButtons();
    note('looked over the form', null, `${missing.length} required and empty; ${buttons.length} send buttons`);
    return { site, url: location.href, fields: fields.length, missing: [...new Set(missing)].slice(0, 30), button: buttons.length === 1 ? words(buttons[0]) : '', many: buttons.length > 1 };
  }
  // Presses this form's one Submit button. Asked for only by the person's own
  // press of "Submit application" in the side panel, for this one form.
  function send() {
    const r = review();
    if (r.covered || !r.button) return { ok: false, why: r.many ? 'many' : 'none' };
    if (r.missing.length) return { ok: false, why: 'missing', missing: r.missing };
    const b = sendButtons()[0];
    // The browser's own check of the form: a field it would refuse is not sent past.
    if (b.form && !b.form.noValidate && !b.formNoValidate && !b.form.checkValidity()) return { ok: false, why: 'invalid' };
    watching = true;
    onPressed('Submit application in the side panel');
    note('pressed Submit for the person', b, r.button);
    const w = win(b), o = { bubbles: true, cancelable: true, composed: true, view: w };
    if (w.PointerEvent) b.dispatchEvent(new w.PointerEvent('pointerdown', o));
    b.dispatchEvent(new w.MouseEvent('mousedown', o));
    if (w.PointerEvent) b.dispatchEvent(new w.PointerEvent('pointerup', o));
    b.dispatchEvent(new w.MouseEvent('mouseup', o));
    b.click();
    return { ok: true, button: r.button };
  }

  window.__jobhuntFiller = {
    build: BUILD, alive, retire: () => { retired = true; watching = false; },
    scan, scanOne, fill, addEntry, attach, watch, check, review, send,
    log: () => ({ site, url: location.origin + location.pathname, rows: trail.slice(-300) }),
    sent, learned,
  };
})();
