// Job Hunt on the phone: Today, a role, replies, interviews, people and
// adding a role from a link. A small
// page of its own, because the phone can only make a few calls (see
// internal/api/reach.go). Everything shown is put in as text, never as HTML.

const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') n.append(kid.nodeType ? kid : String(kid));
  return n;
};
const page = document.getElementById('page'), tabs = document.getElementById('tabs'), title = document.getElementById('title');
let me = null;

async function call(method, path, body) {
  const r = await fetch('/api/' + path, { method, headers: method === 'GET' ? {} : { 'X-JobHunt': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { me = null; throw Object.assign(new Error('pair'), { pair: true }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'That didn\'t work. Try again.');
  return d;
}
const get = p => call('GET', p), post = (p, b) => call('POST', p, b || {}), put = (p, b) => call('PUT', p, b || {});
const copyText = t => navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => toast('Couldn\'t copy. Select the text instead.')) ?? toast('Couldn\'t copy. Select the text instead.');

// A button that does one thing, says so, and draws the page again.
const doing = (label, fn, cls = 'btn') => el('button', { class: cls, type: 'button', on: { click: async ev => {
  const b = ev.currentTarget, was = b.textContent; b.disabled = true;
  try { await fn(b); } catch (e) { fail(e); } finally { if (b.isConnected) { b.disabled = false; b.textContent = was; } }
} } }, label);

// A link shared to Job Hunt from another app arrives as ?url=…&text=…; it
// waits on the Add tab.
let shared = '';
{
  const q = new URLSearchParams(location.search);
  const found = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  if (found) { shared = found.slice(0, 2000); history.replaceState(null, '', '/#add'); }
}

let toastTimer;
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
}
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
function ago(ts, now) {
  const s = Math.max(0, now - ts);
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
const when = ts => new Date(ts * 1000).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fitTone = n => (n >= 80 ? 'var(--good)' : n >= 60 ? 'var(--warn)' : 'var(--crit)');

const TODO = { apply: ['Send', 'hot'], decide: ['Prepare', 'blue'], mail: ['Reply', 'blue'], talk: ['Interview', 'blue'], chase: ['Follow up', 'warn'], send: ['Send note', 'good'], meet: ['Write to', 'good'] };

function unpaired(old) {
  title.textContent = 'Job Hunt';
  tabs.replaceChildren();
  page.replaceChildren(el('div', { class: 'card' }, el('h2', {}, old ? 'That code has been used or has run out' : 'This phone isn\'t paired yet'),
    el('p', { class: 's', style: 'margin-top:8px' }, 'On your computer open Job Hunt, go to You, then Connections, then Phone access, and press "Add a phone". Point this phone\'s camera at the code it shows.')));
}

function nav(on, counts) {
  const tab = (key, label, n) => el('a', { href: '#' + key, class: on === key ? 'on' : '' }, label, n ? el('b', {}, n) : '');
  tabs.replaceChildren(tab('today', 'Today'), tab('replies', 'Replies', counts?.replies), tab('interviews', 'Interviews'), tab('people', 'People'), tab('add', 'Add'));
}

async function today() {
  const d = await get('today'), now = Date.now() / 1000;
  title.textContent = 'Today';
  nav('today', { replies: d.cards.filter(c => c.kind === 'mail').length });
  const cards = d.cards.map(c => {
    const [word, tone] = TODO[c.kind] || ['', ''];
    const href = c.role_id && c.kind !== 'mail' ? '#role/' + c.role_id : c.kind === 'mail' ? '#replies' : c.kind === 'talk' ? '#interviews' : null;
    const body = [el('div', { class: 'row' }, el('div', { class: 'grow' },
      el('div', { class: 'row', style: 'gap:6px;margin-bottom:4px' }, el('span', { class: 'chip ' + tone }, word), c.fresh ? el('span', { class: 'chip hot' }, 'Fresh') : '', c.at && c.kind !== 'talk' ? el('span', { class: 'm' }, ago(c.at, now)) : '', c.kind === 'talk' ? el('span', { class: 'm' }, when(c.at)) : ''),
      el('div', { class: 't' }, c.title), el('div', { class: 's cut' }, c.sub)),
      c.fit > 0 ? el('div', { class: 'fit', style: 'color:' + fitTone(c.fit) }, c.fit, el('small', {}, c.seen >= 0 && c.seen != null ? c.seen + ' applied' : 'fit')) : '')];
    if (!href) body.push(el('div', { class: 'm', style: 'margin-top:6px' }, c.why || '', ' Done on your computer.'));
    return href ? el('a', { class: 'card', href }, body) : el('div', { class: 'card' }, body);
  });
  const unwritten = d.cards.filter(c => c.kind === 'chase' && !c.body).length;
  page.replaceChildren(el('div', { class: 'm', style: 'padding:0 2px' }, d.numbers.map(n => `${n.value} ${n.label.toLowerCase()}`).join(' · ')),
    el('div', { class: unwritten > 1 ? 'two' : '' }, doing('Search now', async b => { b.textContent = 'Starting…'; await post('search'); toast('Searching. New roles show up here in a few minutes.'); }),
      unwritten > 1 ? doing(`Write all ${unwritten} follow-ups`, async b => { b.textContent = 'Starting…'; const r = await post('roles/chaseall'); toast(r.writing ? `Writing ${r.writing}. Press Refresh in a minute.` : 'Every follow-up is written already.'); }) : ''),
    ...(cards.length ? cards : [el('div', { class: 'empty' }, 'Your list is clear.')]));
}

async function role(id, stay) {
  const d = await get('roles/' + id), r = d.role, now = d.now;
  title.textContent = r.company;
  nav('today');
  const url = safeUrl(r.apply_url || r.url), ready = !!d.letter, later = !r.closed && r.later_until > now;
  const act = (name, body, done) => async ev => {
    const b = ev.currentTarget; b.disabled = true;
    try { await post(`roles/${id}/${name}`, body); toast(done); await role(id); } catch (e) { fail(e); b.disabled = false; }
  };
  const facts = [r.location, r.workplace, r.pay].filter(Boolean).join(' · ');
  const kids = [
    el('div', { class: 'card' }, el('div', { class: 'row' }, el('div', { class: 'grow' }, el('h2', {}, r.title), el('div', { class: 's', style: 'margin-top:4px' }, r.company), facts ? el('div', { class: 'm' }, facts) : ''),
      r.fit >= 0 ? el('div', { class: 'fit', style: 'color:' + fitTone(r.fit) }, r.fit_tailored > r.fit ? `${r.fit} → ${r.fit_tailored}` : r.fit, el('small', {}, r.fit_tailored > r.fit ? 'fit, tailored' : 'fit')) : ''),
      el('div', { class: 'm', style: 'margin-top:8px' }, [r.posted_at ? 'Posted ' + ago(r.posted_at, now) : '', r.applicants >= 0 ? (r.applicants === 24 ? 'under 25' : r.applicants === 200 || (r.applicants > 100 && r.applicants % 100 === 1) ? `${r.applicants - r.applicants % 100}+` : r.applicants) + ' applicants' : '', r.applied_at ? 'You applied ' + ago(r.applied_at, now) : '', r.closed ? 'Closed: ' + (r.closed_why || r.closed) : '', later ? 'Saved for later' : ''].filter(Boolean).join(' · ')),
      d.reading?.summary ? el('p', { class: 's', style: 'margin-top:10px' }, d.reading.summary) : ''),
  ];
  if (!r.closed) {
    if (url) kids.push(el('a', { class: 'btn p', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the posting'));
    if (ready) kids.push(el('div', { class: 'three' }, el('a', { class: 'btn', href: `/api/roles/${id}/cv.pdf` }, 'CV'), el('a', { class: 'btn', href: `/api/roles/${id}/letter.pdf` }, 'Letter'), el('a', { class: 'btn', href: `/api/roles/${id}/both.pdf` }, 'Both')));
    else if (d.preparing) kids.push(el('div', { class: 'card m' }, 'Writing your CV and letter. About a minute; press Refresh.'));
    else if (r.fit >= 0 && r.stage !== 'applied') kids.push(el('button', { class: 'btn', type: 'button', on: { click: act('prepare', {}, 'Writing your CV and letter') } }, 'Prepare my CV and letter'));
    if (r.stage === 'applied') kids.push(el('button', { class: 'btn', type: 'button', on: { click: act('unapply', {}, 'Put back') } }, 'I didn\'t send it'));
    else if (!r.applied_at) kids.push(el('div', { class: 'two' }, el('button', { class: 'btn', type: 'button', on: { click: act('applied', {}, 'Marked as applied') } }, 'I applied'),
      el('button', { class: 'btn q', type: 'button', on: { click: ev => { if (confirm('Not for you? Job Hunt will never bring this role back.')) act('no', {}, 'Set aside')(ev); } } }, 'Not for me')));
    if (!r.applied_at) kids.push(later ? el('button', { class: 'btn', type: 'button', on: { click: act('later', { days: 0 }, 'Back on Today') } }, 'Bring back to Today')
      : el('div', {}, el('h3', {}, 'Save for later'), el('div', { class: 'three', style: 'margin-top:6px' }, [[1, 'Tomorrow'], [3, '3 days'], [7, 'Next week']].map(([n, label]) => el('button', { class: 'btn', type: 'button', on: { click: act('later', { days: n }, 'Saved for later') } }, label)))));
  }
  kids.push(...chasePart(id, d));
  if (d.letter) {
    const text = el('textarea', { rows: 12, 'aria-label': 'Your letter' }, d.letter);
    kids.push(el('h3', {}, 'Your letter'), el('div', { class: 'card col' }, text,
      el('div', { class: 'two' }, doing('Save', async () => { await post(`roles/${id}/letter`, { text: text.value }); toast('Letter saved'); }), doing('Copy', () => copyText(text.value))),
      ask(id, 'askletter', 'undoletter', d.letter_prev, 'What to change in the letter', 'Shorter, and open with the project I led', 'Letter written again', 'The letter is as it was')));
  }
  if (d.cv?.doc) kids.push(el('h3', {}, 'Your CV for this role'), el('div', { class: 'card col' },
    el('p', { class: 's' }, `${(d.cv.doc.changes || []).filter(c => !c.off).length} changes to your CV for this role. Read them on your computer, or ask for something different here.`),
    ask(id, 'askcv', 'undocv', d.cv.doc.prev, 'What to change in the CV', 'Make more of the team I managed', 'CV tailored again', 'The CV changes are as they were')));
  const notes = el('textarea', { rows: 3, 'aria-label': 'Your notes on this role', placeholder: 'Who referred you, what the recruiter said…' }, d.my_notes || '');
  kids.push(el('h3', {}, 'Your notes'), el('div', { class: 'card col' }, notes, doing('Save notes', async () => { await post(`roles/${id}/notes`, { text: notes.value }); toast('Saved'); })));
  kids.push(el('p', { class: 'm', style: 'text-align:center' }, 'Filling the form for you happens in the side panel on your computer.'));
  page.replaceChildren(...kids);
  if (!stay) scrollTo(0, 0);
}

// Asking Claude to change the letter or the CV, with a way back.
function ask(id, what, undo, prev, label, example, done, undone) {
  const box = el('input', { type: 'text', 'aria-label': label, placeholder: 'For example: ' + example });
  return el('div', { class: 'col' }, el('div', { class: 's' }, label),
    box, doing('Ask for this change', async b => {
      if (!box.value.trim()) { toast('Say what to change.'); return; }
      b.textContent = 'Writing…';
      await post(`roles/${id}/${what}`, { ask: box.value.trim() }); toast(done); await role(id, true);
    }),
    prev ? doing('Undo the last change' + (prev.ask ? `: "${prev.ask.slice(0, 40)}"` : ''), async () => { await post(`roles/${id}/${undo}`); toast(undone); await role(id, true); }, 'btn q') : '');
}

// The follow-up on an application that has gone quiet.
function chasePart(id, d) {
  const r = d.role, c = d.chase;
  if (r.closed || r.stage !== 'applied' || !r.applied_at) return [];
  if (c?.sent_at) return [el('div', { class: 'card m' }, 'You followed up ' + ago(c.sent_at, d.now) + '. One is enough.')];
  if (c?.body && !c.dropped_at) {
    const subj = el('input', { type: 'text', 'aria-label': 'Subject', value: c.subject || '' }), text = el('textarea', { rows: 8, 'aria-label': 'Your follow-up' }, c.body);
    return [el('h3', {}, 'Your follow-up'), el('div', { class: 'card col' }, c.to ? el('div', { class: 's' }, 'To ' + c.to + (c.email ? ' · ' + c.email : '')) : '', subj, text,
      el('div', { class: 'two' }, doing('Save', async () => { await post(`roles/${id}/chasesave`, { subject: subj.value, text: text.value }); toast('Saved'); }), doing('Copy', () => copyText(text.value))),
      el('div', { class: 'two' }, doing('I sent it', async () => { await post(`roles/${id}/chasesave`, { subject: subj.value, text: text.value }); await post(`roles/${id}/chasesent`); toast('Noted'); await role(id, true); }, 'btn p'),
        doing('Let it go', async () => { await post(`roles/${id}/chasedrop`); toast('No follow-up for this one'); await role(id, true); }, 'btn q')),
      el('p', { class: 'm' }, 'Job Hunt wrote it; you send it, from your own mail.'))];
  }
  if (!d.chase_due) return [];
  return [el('div', { class: 'card col' }, el('div', { class: 't' }, 'No reply yet'), el('p', { class: 's' }, 'One short follow-up is normal. Job Hunt writes it; you send it.'),
    el('div', { class: 'two' }, doing('Write follow-up', async b => { b.textContent = 'Writing…'; await post(`roles/${id}/chase`); await role(id, true); }, 'btn p'),
      doing('Let it go', async () => { await post(`roles/${id}/chasedrop`); await role(id, true); }, 'btn q')))];
}

const KINDS = { knows_work: 'Knows your work', made_move: 'Made the same move', same_roots: 'Same roots', same_craft: 'Same craft', mentor: 'Mentor', recruiter: 'Recruiter', contact: 'You know them' };
function noteState(n) {
  if (!n) return ['Not written to', ''];
  return { draft: ['Note drafted', 'warn'], sent: ['Written to', 'blue'], quiet: ['No answer', ''], replied: ['Answered', 'good'] }[n.state] || ['', ''];
}

async function people() {
  const d = await get('people?size=60&page=1'), now = Date.now() / 1000;
  title.textContent = 'People';
  nav('people');
  page.replaceChildren(el('div', { class: 'm', style: 'padding:0 2px' }, `${d.know} ${d.know === 1 ? 'person knows' : 'people know'} who you are`),
    ...(d.people.length ? d.people.map(p => {
      const [word, tone] = p.knows_you_at ? ['Knows you', 'good'] : noteState(p.note);
      return el('a', { class: 'card', href: '#person/' + p.id }, el('div', { class: 'row', style: 'gap:6px;margin-bottom:4px' }, el('span', { class: 'chip ' + tone }, word), el('span', { class: 'm' }, KINDS[p.kind] || ''), p.note?.sent_at ? el('span', { class: 'm' }, ago(p.note.sent_at, now)) : ''),
        el('div', { class: 't' }, p.name), el('div', { class: 's cut' }, [p.title, p.company].filter(Boolean).join(' · ')));
    }) : [el('div', { class: 'empty' }, 'Nobody here yet. Job Hunt finds people to write to from your computer.')]),
    d.total > d.people.length ? el('p', { class: 'm', style: 'text-align:center' }, `The first ${d.people.length} of ${d.total}. The rest are on your computer.`) : '');
}

async function person(id) {
  const d = await get('people/' + id), p = d.person, n = d.notes?.[0], url = safeUrl(p.url), now = Date.now() / 1000;
  title.textContent = p.name;
  nav('people');
  const again = purpose => async b => { b.textContent = 'Writing…'; await post(`people/${id}/note`, purpose ? { purpose } : {}); await person(id); };
  const kids = [el('div', { class: 'card' }, el('h2', {}, p.name), el('div', { class: 's', style: 'margin-top:4px' }, [p.title, p.company].filter(Boolean).join(' · ')), p.why ? el('p', { class: 's', style: 'margin-top:8px' }, p.why) : '')];
  if (url) kids.push(el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open their profile'));
  if (n) {
    const subj = n.channel === 'email' ? el('input', { type: 'text', 'aria-label': 'Subject', value: n.subject || '' }) : null;
    const body = el('textarea', { rows: n.channel === 'email' ? 9 : 6, 'aria-label': 'Your note' }, n.body);
    const save = () => put(`notes/${n.id}`, { subject: subj?.value || '', body: body.value });
    const mark = (what, said) => async () => { await save(); await post(`notes/${n.id}/${what}`); toast(said); await person(id); };
    kids.push(el('h3', {}, n.state === 'draft' ? 'Your note · draft' : n.sent_at ? 'Your note · sent ' + ago(n.sent_at, now) : 'Your note'),
      el('div', { class: 'card col' }, el('p', { class: 'm' }, (n.channel === 'linkedin' ? 'For the LinkedIn connect box. ' : 'An email. ') + 'Nothing is sent until you send it yourself.'), subj || '', body,
        el('div', { class: 'two' }, doing('Save', async () => { await save(); toast('Saved'); }), doing('Copy', async () => { await save(); copyText(body.value); })),
        n.state === 'draft' ? doing('I sent it', mark('sent', 'Noted. A reminder comes in a week if they are quiet.'), 'btn p') : '',
        n.state === 'sent' ? el('div', { class: 'two' }, doing('They answered', mark('replied', 'One more person who knows you'), 'btn p'), doing('Let it go', mark('quiet', 'Let go'), 'btn q')) : '',
        n.state === 'sent' ? doing('Write a follow-up', again('nudge')) : '', n.state === 'replied' ? doing('Write a thank-you', again('thanks')) : '',
        doing('Write it again', again(''))));
  } else kids.push(doing('Write a note', again(''), 'btn p'));
  page.replaceChildren(...kids);
  scrollTo(0, 0);
}

// Adding a role from a link: pasted, or shared to Job Hunt from another app.
function add() {
  title.textContent = 'Add a role';
  nav('add');
  const box = el('textarea', { rows: 3, 'aria-label': 'The link to the posting', placeholder: 'https://…' }, shared);
  shared = '';
  page.replaceChildren(el('div', { class: 'card col' }, el('div', { class: 't' }, 'Add a role from a link'),
    el('p', { class: 's' }, 'Paste the link to a job posting, or share it to Job Hunt from your browser. Job Hunt reads it and scores it against your CV.'),
    box, doing('Add it', async b => {
      if (!/https?:\/\//i.test(box.value)) { toast('Paste a link that starts with https://'); return; }
      b.textContent = 'Reading…';
      const r = await post('roles/link', { text: box.value });
      toast('Added. Claude is reading it.');
      location.hash = 'role/' + r.id;
    }, 'btn p'),
    el('p', { class: 'm' }, 'A role you said no to stays closed. Some sites can only be read on your computer, with the side panel.')));
}

async function replies() {
  const d = await get('mail'), now = Date.now() / 1000;
  title.textContent = 'Replies';
  nav('replies');
  const KIND = { interview: ['They want to talk', 'good'], rejection: ['No', ''], offer: ['Offer', 'good'], question: ['A question', 'blue'], receipt: ['Received', ''] };
  page.replaceChildren(...(d.mail.length ? d.mail.map(m => {
    const [word, tone] = KIND[m.kind] || [m.kind || 'Mail', ''];
    return el(m.role_id ? 'a' : 'div', { class: 'card', href: m.role_id ? '#role/' + m.role_id : null }, el('div', { class: 'row', style: 'gap:6px;margin-bottom:4px' }, el('span', { class: 'chip ' + tone }, word), el('span', { class: 'm' }, ago(m.at, now))),
      el('div', { class: 't' }, m.subject), el('div', { class: 's' }, m.from_name || m.from_addr), m.summary ? el('p', { class: 's', style: 'margin-top:8px' }, m.summary) : '');
  }) : [el('div', { class: 'empty' }, d.on ? 'No replies yet.' : 'Job Hunt isn\'t watching your inbox. Turn it on under You, Connections on your computer.')]));
}

async function interviews() {
  const d = await get('talks');
  title.textContent = 'Interviews';
  nav('interviews');
  const one = t => { const link = safeUrl(t.link); return el('div', { class: 'card' }, el('div', { class: 't' }, t.title), el('div', { class: 's' }, [t.person, t.company].filter(Boolean).join(' · ')), el('div', { class: 'm' }, `${when(t.at)} · ${t.minutes} min`),
    link ? el('a', { class: 'btn p', style: 'margin-top:10px', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Join') : ''); };
  const up = d.upcoming || [], past = (d.past || []).slice(0, 5);
  page.replaceChildren(...(up.length ? up.map(one) : [el('div', { class: 'empty' }, 'Nothing booked.')]), ...(past.length ? [el('h3', {}, 'Behind you'), ...past.map(one)] : []));
}

function fail(e) {
  if (e.pair) return unpaired(false);
  toast(e.message || 'That didn\'t work.');
}

async function show() {
  const h = location.hash.slice(1);
  try {
    if (!me) me = await get('phone/me').catch(e => { if (e.pair && h === 'old') return null; throw e; });
    if (!me) return unpaired(true);
    if (h === 'old') { history.replaceState(null, '', '/'); }
    const m = /^role\/(\d+)$/.exec(h), who = /^person\/(\d+)$/.exec(h);
    if (m) await role(m[1]);
    else if (who) await person(who[1]);
    else if (h === 'people') await people();
    else if (h === 'add') add();
    else if (h === 'replies') await replies();
    else if (h === 'interviews') await interviews();
    else await today();
  } catch (e) {
    if (e.pair) return unpaired(false);
    if (!page.children.length) page.replaceChildren(el('div', { class: 'empty' }, 'Can\'t reach Job Hunt. Your computer has to be on, with Job Hunt running, and this phone on the same Wi-Fi (or Tailscale on both).'));
    else fail(e);
  }
}
addEventListener('hashchange', show);
document.getElementById('again').addEventListener('click', show);
// Coming back to the page draws it again, unless something typed isn't saved.
const typed = () => [...document.querySelectorAll('textarea, input')].some(x => x.value !== x.defaultValue);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !typed()) show(); });
show();
