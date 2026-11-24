// The side panel. It talks only to Job Hunt on this computer, and reads or
// writes a page only when the person presses a button here. Everything that
// comes from a page or a posting is put on screen as text, never as markup.

const BASE = 'http://127.0.0.1:47700/api/ext/';
const APP = 'http://127.0.0.1:47700/';
const $main = document.getElementById('main'), $status = document.getElementById('status');

let key = '', code = '';
let state = 'start';          // start | off | pair | ok
let tab = null;               // the tab beside the panel
let page = { kind: 'none' };  // what that tab is showing
let next = [];                // roles ready to apply to
let flash = null;             // the result of the last button, for this address
let person = null;            // the profile being added
let working = '';             // which button is busy

// ---- small helpers ----------------------------------------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 2 * 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const STAGE = { new: 'Being read', found: 'Worth a look', ready: 'Ready to send', applied: 'Applied', reply: 'In conversation', interview: 'Interview', offer: 'Offer' };
const CLOSED = { screened: 'Set aside', no: 'Not interested', rejected: 'They said no', expired: 'Taken down', withdrawn: 'Withdrawn' };

class Away extends Error {}

async function call(path, { method = 'GET', body, raw } = {}) {
  let r;
  try {
    r = await fetch(BASE + path, { method, cache: 'no-store', headers: { 'X-JobHunt-Ext': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    setState('off');
    throw new Away('Job Hunt is not running.');
  }
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
    if (j.pair) { setState('pair'); throw new Away(j.error); }
    throw new Error(j.error || 'Job Hunt said no.');
  }
  if (raw) { if (!r.ok) throw new Error('That document is not written yet.'); return r; }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || 'Something went wrong.');
  return j;
}

async function loadKey() {
  const got = await chrome.storage.local.get('key');
  key = got.key;
  if (!key) {
    const a = new Uint8Array(32);
    crypto.getRandomValues(a);
    key = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ key });
  }
  const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  code = [...new Uint8Array(sum)].slice(0, 3).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function setState(s) {
  if (state === s) return;
  state = s;
  render();
}

// ---- what the tab is showing ------------------------------------------------------
// Normally the tab beside the panel. Opened as panel.html?tab=<id>, the panel
// follows that one tab instead (used when it is shown in a window of its own).
const pinned = Number(new URLSearchParams(location.search).get('tab')) || 0;
async function activeTab() {
  if (pinned) return chrome.tabs.get(pinned).catch(() => null);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function inPage(func, args = [], frames) {
  if (!tab) throw new Error('There is no page open beside this panel.');
  const target = { tabId: tab.id };
  if (frames === 'all') target.allFrames = true;
  else if (typeof frames === 'number') target.frameIds = [frames];
  try {
    const res = await chrome.scripting.executeScript({ target, func, args });
    return res.filter(r => r && r.result != null).map(r => ({ frame: r.frameId, result: r.result }));
  } catch (e) {
    throw new Error("Job Hunt can't reach this page. Reload the page and try again.");
  }
}

let seq = 0;
async function refresh(force) {
  const mine = ++seq;
  try {
    if (state !== 'ok') { await call('hello', { method: 'POST', body: {} }); state = 'ok'; }
    const t = await activeTab();
    const url = t && t.url ? t.url.split('#')[0] : '';
    let p;
    if (!t) p = { kind: 'none' };
    else if (!url) p = { kind: 'blind' };
    else if (!/^https?:/.test(url) || url.startsWith(APP)) p = { kind: 'other' };
    else if (/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^/]+/.test(url)) p = { kind: 'profile', url };
    else {
      const r = await call('role?url=' + encodeURIComponent(url));
      p = r.known ? { kind: 'role', role: r.role, url } : { kind: 'unknown', url };
    }
    const n = (await call('next')).roles || [];
    if (mine !== seq) return;
    if (flash && flash.url !== url) flash = null;
    if (person && person.url !== url) person = null;
    tab = t; page = p; next = n;
    if (p.kind === 'profile' && !person) grabProfile();
  } catch (e) {
    if (!(e instanceof Away) && mine === seq) flash = { tone: 'bad', title: e.message, url: tab && tab.url };
  }
  if (mine !== seq) return;
  // Don't redraw under someone who is typing, unless they pressed something.
  const typing = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
  if (force || !typing) render();
}
let soon;
const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(() => refresh(), 350); };

// ---- buttons ----------------------------------------------------------------------
async function run(name, fn) {
  if (working) return;
  working = name;
  render();
  try { await fn(); } catch (e) { if (!(e instanceof Away)) flash = { tone: 'bad', title: e.message, url: page.url }; }
  working = '';
  await refresh(true);
}
const say = (tone, title, lists) => { flash = { tone, title, lists, url: page.url }; };

async function fetchFile(id, which) {
  const r = await call(`role/${id}/${which}.docx`, { raw: true });
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') || '');
  let name = which === 'cv' ? 'CV.docx' : 'Cover letter.docx';
  if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; } }
  return { name, blob: await r.blob() };
}
function toB64(blob) {
  return new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => no(new Error('The file could not be read.')); fr.readAsDataURL(blob); });
}

const actions = {
  async send() {
    const got = await inPage(pageGrabPosting);
    const p = got[0] && got[0].result;
    if (!p || !p.title || p.description.length < 200) throw new Error("This doesn't look like a job posting. Open the posting itself and try again.");
    if (!p.company) throw new Error("Job Hunt couldn't tell which employer this is. Add the role by hand in Job Hunt.");
    await call('posting', { method: 'POST', body: p });
    say('good', 'Sent. Job Hunt is reading it; your fit shows here in a moment.');
  },
  async prepare() {
    await call(`role/${page.role.id}/prepare`, { method: 'POST', body: {} });
    say('good', 'Writing your CV and letter. About a minute.');
  },
  async attach(which) {
    const f = await fetchFile(page.role.id, which);
    const file = { name: f.name, b64: await toB64(f.blob), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', want: which };
    const res = await inPage(pageAttach, [file], 'all');
    const what = which === 'cv' ? 'CV' : 'letter';
    if (res.some(r => r.result.ok)) say('good', `Attached your ${what} (${f.name}). Check that the form shows it.`);
    else if (res.some(r => r.result.why === 'unsure')) say('warn', `This form has more than one upload and Job Hunt couldn't tell which is for the ${what}. Use Download and attach it yourself.`);
    else say('warn', `No upload field found on this page. If the form opens after "Apply", open it first. Or use Download and attach it yourself.`);
  },
  async download(which) {
    const f = await fetchFile(page.role.id, which);
    const a = h('a', { href: URL.createObjectURL(f.blob), download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  },
  async copyLetter() {
    await navigator.clipboard.writeText(page.role.letter || '');
    say('good', 'Letter copied.');
  },
  async fill() {
    const scans = await inPage(pageScanForm, [], 'all');
    const best = scans.sort((a, b) => b.result.fields.length - a.result.fields.length)[0];
    if (!best || !best.result.fields.length) { say('warn', 'No form found on this page. If it opens after "Apply", open it first.'); return; }
    const me = await call('me');
    const plan = planFill(best.result.fields, me);
    let answers = [];
    if (plan.ask.length) answers = (await call('answers', { method: 'POST', body: { role: page.role.id, questions: plan.ask.map(f => f.label) } })).answers || [];
    plan.ask.forEach((f, n) => {
      const a = answers[n] || {};
      const text = (a.answer || '').trim();
      if (!text) { plan.left.push(f.label); return; }
      if (f.kind === 'select' || f.kind === 'radio') {
        const o = a.sure ? matchOption(f, text) : -1;
        if (o < 0) plan.left.push(f.label);
        else plan.items.push({ i: f.i, option: o, tone: 'ok' });
      } else {
        plan.items.push({ i: f.i, value: text, tone: a.sure ? 'ok' : 'check' });
        if (!a.sure) plan.check.push(f.label);
      }
    });
    const done = (await inPage(pageFill, [plan.items], best.frame))[0];
    const n = done ? done.result : 0;
    const lists = [];
    if (plan.check.length) lists.push(['Check these (outlined in amber): Job Hunt was not sure', plan.check]);
    if (plan.left.length) lists.push(['Left for you', plan.left]);
    say(n ? 'good' : 'warn', n ? `Filled ${plural(n, 'field', 'fields')}, outlined in blue. Read them before you submit.` : 'Nothing to fill: the fields are already filled in or are yours to answer.', lists);
  },
  async applied() {
    await call(`role/${page.role.id}/applied`, { method: 'POST', body: {} });
    say('good', 'Marked as applied. Job Hunt will watch for their reply.');
  },
  async no() {
    if (!confirm("Not for you? Job Hunt won't show this role again.")) return;
    await call(`role/${page.role.id}/no`, { method: 'POST', body: {} });
  },
  async everySite() {
    const ok = await chrome.permissions.request({ origins: ['https://*/*'] });
    if (!ok) say('warn', 'Not switched on. Job Hunt keeps working on LinkedIn and the main hiring systems.');
  },
  async addPerson() {
    const form = document.getElementById('person');
    const f = Object.fromEntries(new FormData(form));
    if (!f.name.trim()) throw new Error('Their name is missing.');
    const r = await call('person', { method: 'POST', body: { name: f.name.trim(), title: f.title.trim(), company: f.company.trim(), kind: f.kind, url: person.url, draft: true } });
    person = { ...person, name: f.name, title: f.title, company: f.company, kind: f.kind, id: r.id, note: r.note };
  },
  async copyNote() {
    await navigator.clipboard.writeText(document.getElementById('note').value);
    say('good', "Copied. On their profile choose Connect, then Add a note, and paste it.");
  },
  async sentNote() {
    await call(`note/${person.note.id}/sent`, { method: 'POST', body: {} });
    person.note.state = 'sent';
    say('good', "Marked as sent. Job Hunt reminds you if a week goes by with no answer.");
  },
};

async function grabProfile() {
  const url = page.url;
  try {
    const got = await inPage(pageGrabProfile);
    if (page.url !== url || !got[0]) return;
    person = { ...got[0].result, url: got[0].result.url || url, kind: 'same_craft' };
    render();
  } catch (e) { person = { name: '', title: '', company: '', url, kind: 'same_craft' }; render(); }
}

// Things an employer may ask that are the person's alone to answer.
const PRIVATE = /gender|\brace\b|ethnic|veteran|disab|sexual|orientation|religio|pronoun|birth|\bage\b|marital|criminal|convict|social (security|insurance)|\bssn\b|\bsin\b|national id|passport|visible minority|indigenous|aboriginal/i;

function contactValue(f, me) {
  if (f.kind !== 'text') return undefined;
  const label = f.label.toLowerCase().trim(), t = `${label} ${f.name} ${f.auto}`;
  const links = me.links || [], parts = (me.name || '').trim().split(/\s+/);
  if (f.type === 'email' || /e-?mail/.test(t)) return me.email || '';
  if (f.type === 'tel' || /phone|mobile|telephone/.test(t)) return me.phone || '';
  if (/first.?name|given.?name|\bfname\b/.test(t)) return parts[0] || '';
  if (/last.?name|family.?name|surname|\blname\b/.test(t)) return parts.slice(1).join(' ');
  if (/^(full |legal |your )?name$/.test(label) || f.auto === 'name') return me.name || '';
  if (/linkedin/.test(t)) return links.find(l => /linkedin\.com/i.test(l)) || '';
  if (/github/.test(t)) return links.find(l => /github\.com/i.test(l)) || '';
  if (/^(current )?(city|location)( \(city\))?$/.test(label) || f.auto === 'address-level2') return me.location || me.home || '';
  return undefined;
}

function planFill(fields, me) {
  const plan = { items: [], ask: [], check: [], left: [] };
  for (const f of fields) {
    if (f.filled || !f.label) continue;
    if (PRIVATE.test(f.label)) { plan.left.push(f.label); continue; }
    const c = contactValue(f, me);
    if (c !== undefined) { if (c) plan.items.push({ i: f.i, value: c, tone: 'ok' }); else plan.left.push(f.label); continue; }
    if (f.type === 'date' || f.label.length < 6) continue;
    if (plan.ask.length < 30) plan.ask.push(f); else plan.left.push(f.label);
  }
  return plan;
}

function matchOption(f, answer) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const a = norm(answer);
  const opts = f.options.map(norm);
  let hits = opts.map((o, i) => (o && o === a ? i : -1)).filter(i => i >= 0);
  if (!hits.length) hits = opts.map((o, i) => (o && !/^(select|choose|please)\b/.test(o) && (a.startsWith(o + ' ') || o.startsWith(a + ' ')) ? i : -1)).filter(i => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}

// ---- drawing ----------------------------------------------------------------------
const btn = (label, name, arg, cls = '') => h('button', { class: 'btn ' + cls, disabled: !!working, onclick: () => run(name, () => actions[name](arg)) }, working === name ? [h('span', { class: 'spin' }), ' '] : null, label);

function flashCard() {
  if (!flash) return null;
  return h('div', { class: 'note ' + (flash.tone || ''), role: 'status' }, h('b', {}, flash.title),
    (flash.lists || []).map(([title, items]) => [h('div', { class: 's', style: 'margin-top:6px;font-weight:600' }, title), h('ul', { class: 'dots s' }, items.slice(0, 12).map(x => h('li', {}, x.length > 110 ? x.slice(0, 110) + '…' : x)))]));
}

function fitBox(r) {
  return h('div', { class: 'fit' }, h('div', {}, h('b', {}, r.fit || '–'), h('span', {}, 'Fit now')), h('div', {}, h('b', { style: 'color:var(--good)' }, r.fit_tailored || '–'), h('span', {}, 'Tailored')));
}

function roleCard(r) {
  const at = r.posted_at || r.first_seen_at, early = r.applicants >= 0 && r.applicants < 10;
  const kids = [
    h('div', { class: 'row' }, h('span', { class: 'chip ' + (r.closed ? '' : r.stage === 'ready' ? 'hot' : r.stage === 'applied' ? 'blue' : '') }, r.closed ? CLOSED[r.closed] || 'Closed' : STAGE[r.stage] || r.stage),
      h('span', { class: 's m' }, `${r.posted_at ? 'Posted' : 'Seen'} ${ago(at)}`, r.applicants >= 0 ? [' · ', h('b', { style: early ? 'color:var(--hot)' : '' }, plural(r.applicants, 'applicant', 'applicants'))] : null)),
    h('div', { class: 'row', style: 'align-items:flex-start' }, h('div', { class: 'grow' }, h('h2', {}, r.title), h('div', { class: 's m' }, [r.company, r.location].filter(Boolean).join(' · '))), r.fit ? fitBox(r) : null),
    r.summary ? h('p', { class: 's ink2' }, r.summary) : null,
  ];
  if (r.closed) kids.push(h('p', { class: 's m' }, r.closed === 'no' ? 'You said this one is not for you.' : r.closed_why || 'This role is closed.'));
  else if (r.stage === 'new') kids.push(h('p', { class: 's' }, h('span', { class: 'spin' }), ' Job Hunt is reading this role.'));
  else if (r.preparing) kids.push(h('p', { class: 's' }, h('span', { class: 'spin' }), ' Writing your CV and letter. About a minute.'));
  else if (!r.has_cv) kids.push(btn('Write my CV and letter for this', 'prepare', null, 'p wide'));
  else {
    kids.push(h('div', { class: 'eb', style: 'margin-top:4px' }, 'On the application form'),
      btn('Attach my CV', 'attach', 'cv', 'p wide'), btn('Fill in the form', 'fill', null, 'wide'),
      h('div', { class: 'row' }, r.has_letter ? btn('Attach letter', 'attach', 'letter') : null, r.has_letter ? btn('Copy letter', 'copyLetter') : null),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', disabled: !!working, onclick: () => run('download', () => actions.download('cv')) }, 'Download CV'), r.has_letter ? h('button', { class: 'btn ghost', disabled: !!working, onclick: () => run('download', () => actions.download('letter')) }, 'Download letter') : null));
  }
  if (!r.closed && r.stage !== 'new') {
    kids.push(h('div', { class: 'row', style: 'border-top:1px solid var(--line2);padding-top:8px' },
      ['applied', 'reply', 'interview', 'offer'].includes(r.stage) ? h('span', { class: 's m grow' }, 'You applied.') : btn('I applied', 'applied'),
      h('span', { class: 'grow' }), btn('Not for me', 'no', null, 'ghost danger')));
  }
  kids.push(h('a', { class: 's', href: `${APP}#/roles/${r.id}`, target: '_blank', rel: 'noopener' }, 'Open in Job Hunt'));
  return h('section', { class: 'card' }, kids);
}

function personCard() {
  if (!person) return h('section', { class: 'card' }, h('p', { class: 's' }, h('span', { class: 'spin' }), ' Reading this profile.'));
  const KINDS = [['same_craft', 'Does your work'], ['made_move', 'Made the same move'], ['same_roots', 'Shares your roots'], ['knows_work', 'Knows your work'], ['recruiter', 'Recruiter'], ['manager', 'Hiring manager'], ['mentor', 'Mentor'], ['contact', 'You know them']];
  if (!person.id) {
    return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'This profile'), h('h2', {}, 'Add them and get a note to send'),
      h('form', { id: 'person', style: 'display:grid;gap:8px', onsubmit: ev => { ev.preventDefault(); run('addPerson', actions.addPerson); } },
        h('label', { class: 'f' }, 'Name', h('input', { type: 'text', name: 'name', value: person.name, required: true })),
        h('label', { class: 'f' }, 'Their role', h('input', { type: 'text', name: 'title', value: person.title })),
        h('label', { class: 'f' }, 'Employer', h('input', { type: 'text', name: 'company', value: person.company })),
        h('label', { class: 'f' }, 'What you share', h('select', { name: 'kind' }, KINDS.map(([k, v]) => h('option', { value: k, selected: k === person.kind }, v)))),
        h('button', { class: 'btn p wide', disabled: !!working }, working === 'addPerson' ? [h('span', { class: 'spin' }), ' '] : null, 'Add and write a note')));
  }
  const n = person.note, sent = n && n.state !== 'draft';
  const count = h('span', { class: 'chip' }, `${n ? n.body.length : 0} of 300`);
  return h('section', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'eb' }, sent ? 'Your note · sent' : 'Your note · draft'), h('h2', {}, person.name)), count),
    n ? h('textarea', { id: 'note', maxlength: 300, 'aria-label': 'Your note', oninput: ev => { count.textContent = `${ev.target.value.length} of 300`; } }, n.body) : h('p', { class: 's m' }, 'No note yet. Write one in Job Hunt.'),
    n ? h('div', { class: 'row' }, btn('Copy', 'copyNote', null, 'p'), sent ? null : btn('I sent it', 'sentNote')) : null,
    h('p', { class: 's m' }, 'Job Hunt never sends it. Paste it into Connect, Add a note.'),
    h('a', { class: 's', href: `${APP}#/people/${person.id}`, target: '_blank', rel: 'noopener' }, 'Open in Job Hunt'));
}

function pageCard() {
  switch (page.kind) {
    case 'role': return roleCard(page.role);
    case 'profile': return personCard();
    case 'unknown': return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'This page'), h('h2', {}, 'Is this a job posting?'),
      h('p', { class: 's m' }, 'Send it to Job Hunt and it is scored against your CV, with a CV and letter written if it fits.'), btn('Send this posting to Job Hunt', 'send', null, 'p wide'));
    case 'blind': return h('section', { class: 'card' }, h('div', { class: 'eb' }, 'This page'), h('h2', {}, "Job Hunt isn't switched on for this site"),
      h('p', { class: 's m' }, "It works on LinkedIn and the main hiring systems as it is. To use it on an employer's own careers site, allow it on every site. It looks up the address of the page beside it in your own Job Hunt, and reads or fills a page only when you press a button here."),
      btn('Switch on for every site', 'everySite', null, 'wide'));
    default: return null;
  }
}

function nextCard() {
  const rest = next.filter(r => !(page.kind === 'role' && page.role.id === r.id)).slice(0, 6);
  if (!rest.length) return page.kind === 'role' || page.kind === 'profile' ? null : h('section', { class: 'card' }, h('h3', {}, 'Nothing is waiting to be sent'), h('p', { class: 's m' }, 'New roles appear here the moment their CV and letter are written.'));
  return h('section', { class: 'card next' }, h('div', { class: 'eb' }, 'Ready to send · freshest first'), h('ul', { class: 'plain' }, rest.map(r => {
    const link = safeUrl(r.apply_url) || safeUrl(r.url), early = r.applicants >= 0 && r.applicants < 10;
    return h('li', {}, link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, r.title) : h('b', {}, r.title),
      h('div', { class: 's m' }, r.company, ' · fit ', r.fit_tailored || r.fit, ' · ', ago(r.posted_at || r.first_seen_at), early ? [' · ', h('b', { style: 'color:var(--hot)' }, plural(r.applicants, 'applicant', 'applicants'))] : null));
  })));
}

function render() {
  $status.className = 'chip ' + (state === 'ok' ? 'good' : state === 'pair' ? 'warn' : '');
  $status.textContent = state === 'ok' ? 'Connected' : state === 'pair' ? 'Needs approval' : state === 'off' ? 'Not running' : 'Starting';
  let kids;
  if (state === 'off' || state === 'start') {
    kids = [h('section', { class: 'card' }, h('h2', {}, state === 'off' ? 'Job Hunt is not running' : 'Looking for Job Hunt'), h('p', { class: 's m' }, 'Start Job Hunt on this computer. This panel connects by itself.'))];
  } else if (state === 'pair') {
    kids = [h('section', { class: 'card ask' }, h('h2', {}, 'Approve this panel in Job Hunt'), h('div', { class: 'code', 'aria-label': 'Code ' + code.split('').join(' ') }, code),
      h('p', { class: 's' }, 'In Job Hunt open You, then Connections. Check that it shows this code and press Approve.'),
      h('a', { class: 'btn wide', href: `${APP}#/you/connections`, target: '_blank', rel: 'noopener' }, 'Open Job Hunt'))];
  } else {
    kids = [flashCard(), pageCard(), nextCard()];
  }
  $main.replaceChildren(...kids.flat().filter(Boolean));
}

// ---- start ------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(refreshSoon);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) refreshSoon(); });
chrome.permissions.onAdded.addListener(refreshSoon);
setInterval(() => {
  const waiting = state !== 'ok' || (page.kind === 'role' && (page.role.preparing || page.role.stage === 'new')) || (flash && flash.tone === 'good' && page.kind === 'unknown');
  if (waiting && !working) refresh();
}, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
loadKey().then(() => refresh());
