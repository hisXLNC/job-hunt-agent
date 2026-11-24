// The functions in this file are run inside the page the person is looking at
// (chrome.scripting.executeScript). Each must stand alone: it cannot use
// anything defined outside itself. None of them ever touches a button or a
// submit control; pressing Submit is the person's.

// Reads the job posting on the page.
function pageGrabPosting() {
  const text = el => (el ? (el.innerText || el.textContent || '').replace(/\s+\n/g, '\n').trim() : '');
  const out = { title: '', company: '', location: '', description: '', url: location.href.split('#')[0] };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      const list = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const x of list) {
        if (!x || x['@type'] !== 'JobPosting') continue;
        out.title = String(x.title || '');
        out.company = String((x.hiringOrganization && x.hiringOrganization.name) || '');
        const a = [].concat(x.jobLocation || [])[0];
        const ad = a && a.address;
        if (ad) out.location = [ad.addressLocality, ad.addressRegion].filter(v => typeof v === 'string' && v).join(', ');
        // Parsed as an inert document: nothing in it runs or loads.
        out.description = (new DOMParser().parseFromString(String(x.description || ''), 'text/html').body.innerText || '').trim();
      }
    } catch (e) { /* not ours to fix */ }
  }
  const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || '';
  if (!out.title) out.title = text(document.querySelector('h1')) || meta('og:title') || document.title;
  if (!out.company) out.company = text(document.querySelector('a[href*="/company/"]')) || meta('og:site_name');
  if (out.description.length < 200) {
    const pick = document.querySelector('#job-details, .jobs-description, .description__text, [class*="job-description"], [class*="jobDescription"], [data-automation-id="jobPostingDescription"], main, article') || document.body;
    out.description = text(pick);
  }
  out.title = out.title.slice(0, 200);
  out.company = out.company.slice(0, 120);
  out.location = out.location.slice(0, 120);
  out.description = out.description.slice(0, 60000);
  return out;
}

// Reads the person's name and headline from a LinkedIn profile.
function pageGrabProfile() {
  const text = el => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const name = text(document.querySelector('main h1, h1'));
  let headline = text(document.querySelector('main .text-body-medium, .top-card-layout__headline, [data-generated-suggestion-target]'));
  if (!headline) {
    const d = (document.querySelector('meta[name="description"], meta[property="og:description"]') || {}).content || '';
    headline = d.split(' · ')[0].slice(0, 160);
  }
  let title = headline, company = '';
  const at = headline.match(/^(.*?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i);
  if (at) { title = at[1]; company = at[2]; }
  return { name: name.slice(0, 120), title: title.slice(0, 160), company: company.slice(0, 120), url: location.origin + location.pathname.replace(/\/+$/, '') };
}

// Lists the fields of the form on the page and numbers them.
function pageScanForm() {
  const clean = s => (s || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const byIds = ids => clean((ids || '').split(/\s+/).map(id => { const e = id && document.getElementById(id); return e ? e.innerText || e.textContent : ''; }).join(' '));
  const labelOf = el => {
    if (el.getAttribute('aria-labelledby')) { const t = byIds(el.getAttribute('aria-labelledby')); if (t) return t; }
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return clean(l.innerText); } catch (e) { /* odd id */ } }
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.innerText);
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const box = el.closest('[class*="field"], [class*="question"], [class*="form-group"], li, fieldset, div');
    const l = box && box.querySelector('label, legend, [class*="label"]');
    if (l) return clean(l.innerText);
    return clean(el.placeholder || el.name || '');
  };
  const groupLabel = el => {
    const fs = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (fs) {
      if (fs.getAttribute('aria-labelledby')) { const t = byIds(fs.getAttribute('aria-labelledby')); if (t) return t; }
      const lg = fs.querySelector('legend, [class*="label"], label');
      if (lg) return clean(lg.innerText);
      if (fs.getAttribute('aria-label')) return clean(fs.getAttribute('aria-label'));
    }
    return '';
  };
  document.querySelectorAll('[data-jobhunt-i]').forEach(el => { el.removeAttribute('data-jobhunt-i'); el.removeAttribute('data-jobhunt-o'); });
  const fields = [], radios = new Map();
  let files = 0;
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const type = (el.getAttribute('type') || (el.tagName === 'INPUT' ? 'text' : '')).toLowerCase();
    if (type === 'file') { files++; continue; }
    if (['hidden', 'password', 'submit', 'button', 'image', 'reset', 'search', 'checkbox', 'range', 'color'].includes(type)) continue;
    if (el.disabled || el.readOnly) continue;
    if (type === 'radio') {
      const key = el.name || groupLabel(el);
      if (!key) continue;
      let f = radios.get(key);
      if (!f) { f = { i: fields.length, kind: 'radio', label: groupLabel(el), options: [], filled: false, auto: '', name: el.name || '', type }; radios.set(key, f); fields.push(f); }
      el.setAttribute('data-jobhunt-i', f.i); el.setAttribute('data-jobhunt-o', f.options.length);
      f.options.push(labelOf(el).slice(0, 120));
      if (el.checked) f.filled = true;
      continue;
    }
    if (!shown(el)) continue;
    const f = { i: fields.length, kind: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : 'text', label: labelOf(el).slice(0, 400), options: [], filled: false, auto: (el.getAttribute('autocomplete') || '').toLowerCase(), name: (el.name || el.id || '').toLowerCase(), type };
    if (f.kind === 'select') {
      f.options = [...el.options].map(o => clean(o.textContent).slice(0, 120));
      f.filled = el.selectedIndex > 0 || (el.selectedIndex === 0 && !!el.value && !/^(select|choose|please|--)/i.test(clean(el.options[0].textContent)));
    } else {
      f.filled = !!el.value.trim();
    }
    el.setAttribute('data-jobhunt-i', f.i);
    fields.push(f);
  }
  return { fields, files, url: location.href };
}

// Types the answers into the numbered fields. `items` is a list of
// { i, value, tone } for text fields and { i, option, tone } for choices.
function pageFill(items) {
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const mark = (el, tone) => { el.style.outline = `2px solid ${tone === 'check' ? '#B7791F' : '#2F4FC4'}`; el.style.outlineOffset = '1px'; };
  let done = 0;
  for (const it of items || []) {
    const els = document.querySelectorAll(`[data-jobhunt-i="${Number(it.i)}"]`);
    if (!els.length) continue;
    const el = els[0];
    if (el.tagName === 'INPUT' && el.type === 'radio') {
      const pick = [...els].find(r => Number(r.getAttribute('data-jobhunt-o')) === Number(it.option));
      if (!pick || pick.type !== 'radio') continue;
      if (!pick.checked) pick.click();
      mark(pick.closest('label') || pick, it.tone);
      done++;
    } else if (el.tagName === 'SELECT') {
      const o = el.options[Number(it.option)];
      if (!o) continue;
      set(el, o.value); mark(el, it.tone); done++;
    } else if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['submit', 'button', 'image', 'reset', 'file', 'password', 'hidden', 'checkbox'].includes(el.type))) {
      if (el.value.trim()) continue; // never write over what the person typed
      set(el, String(it.value || '')); mark(el, it.tone); done++;
    }
  }
  return done;
}

// Puts a file into the form's upload field. `want` is "cv" or "letter".
function pageAttach(file) {
  const inputs = [...document.querySelectorAll('input[type="file"]')].filter(el => !el.disabled);
  if (!inputs.length) return { ok: false, why: 'none' };
  const about = el => {
    let t = [el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.accept].join(' ');
    if (el.id) { try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t += ' ' + l.innerText; } catch (e) { /* odd id */ } }
    const box = el.closest('[class*="field"], [class*="upload"], [class*="attach"], [class*="resume"], [class*="cover"], fieldset, li, section, div');
    if (box) t += ' ' + (box.innerText || '').slice(0, 300);
    return t.toLowerCase();
  };
  const isCV = t => /resume|résumé|\bcv\b|curriculum/.test(t), isLetter = t => /cover|letter|motivation/.test(t);
  let target;
  if (file.want === 'letter') target = inputs.find(el => { const t = about(el); return isLetter(t) && !isCV(t.replace(/cover letter/g, '')); }) || inputs.find(el => isLetter(about(el)));
  else target = inputs.find(el => { const t = about(el); return isCV(t) && !isLetter(t); }) || inputs.find(el => isCV(about(el))) || (inputs.length === 1 ? inputs[0] : null);
  if (!target) return { ok: false, why: 'unsure', count: inputs.length };
  const bin = atob(file.b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], file.name, { type: file.type }));
  target.files = dt.files;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: target.files.length === 1 };
}
