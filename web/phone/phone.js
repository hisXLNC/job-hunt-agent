// Job Hunt on the phone: Today, a role, replies and interviews. A small
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
const get = p => call('GET', p), post = (p, b) => call('POST', p, b || {});

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
  tabs.replaceChildren(tab('today', 'Today'), tab('replies', 'Replies', counts?.replies), tab('interviews', 'Interviews'));
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
  page.replaceChildren(el('div', { class: 'm', style: 'padding:0 2px' }, d.numbers.map(n => `${n.value} ${n.label.toLowerCase()}`).join(' · ')),
    ...(cards.length ? cards : [el('div', { class: 'empty' }, 'Your list is clear.')]));
}

async function role(id) {
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
      el('div', { class: 'm', style: 'margin-top:8px' }, [r.posted_at ? 'Posted ' + ago(r.posted_at, now) : '', r.applicants >= 0 ? r.applicants + ' applicants' : '', r.applied_at ? 'You applied ' + ago(r.applied_at, now) : '', r.closed ? 'Closed: ' + (r.closed_why || r.closed) : '', later ? 'Saved for later' : ''].filter(Boolean).join(' · ')),
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
  if (d.letter) kids.push(el('h3', {}, 'Your letter'), el('div', { class: 'card' }, el('p', { class: 'letter' }, d.letter),
    el('button', { class: 'btn', type: 'button', style: 'margin-top:10px', on: { click: () => navigator.clipboard?.writeText(d.letter).then(() => toast('Copied'), () => toast('Couldn\'t copy. Select the text instead.')) } }, 'Copy the letter')));
  kids.push(el('p', { class: 'm', style: 'text-align:center' }, 'Filling the form for you happens in the side panel on your computer.'));
  page.replaceChildren(...kids);
  scrollTo(0, 0);
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
    const m = /^role\/(\d+)$/.exec(h);
    if (m) await role(m[1]);
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) show(); });
show();
