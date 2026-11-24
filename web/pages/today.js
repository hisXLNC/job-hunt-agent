import { html, api, post, ago, when, rings, tile, toast, copy, safeUrl, app, openAssistant, BAND, KIND } from '../app.js';

const LABEL = {
  talk: ['Coming up', 'blue'], mail: ['Reply', 'blue'], apply: ['Apply now', 'hot'], decide: ['Worth a look', ''],
  send: ['Send your note', 'good'], nudge: ['Follow up', 'warn'], meet: ['Someone to write to', 'info'],
};

function meta(c) {
  if (c.kind === 'apply' || c.kind === 'decide') {
    const age = Date.now() / 1000 - c.at, hot = age < 86400, few = c.seen >= 0 && c.seen < 10;
    return html`<span class="s m">Posted <b style="${hot ? 'color:var(--hot)' : ''}">${ago(c.at)}</b>${c.seen >= 0 ? html` · <b style="${few ? 'color:var(--hot)' : ''}">${c.seen} applicant${c.seen === 1 ? '' : 's'}</b>` : ''}${c.band && BAND[c.band] ? html` · ${BAND[c.band]}` : ''}</span>`;
  }
  if (c.kind === 'talk') return html`<span class="s m">${when(c.at)}</span>`;
  if (c.kind === 'mail') return html`<span class="s m">Arrived ${ago(c.at)}</span>`;
  if (c.kind === 'meet') return html`<span class="s m">${KIND[c.band] || ''}</span>`;
  return '';
}

function buttons(c) {
  const url = safeUrl(c.url);
  switch (c.kind) {
    case 'apply': return html`<div class="row" style="gap:16px">${rings(c.fit, c.tailored)}<div class="col" style="gap:6px">
      ${url ? html`<a class="btn p" href="${url}" target="_blank" rel="noopener noreferrer">Open the posting</a>` : ''}
      <a class="btn sm" href="#/roles/${c.role_id}">Read what's sent</a>
      <div class="row" style="gap:6px"><button class="btn sm" data-act="applied" data-id="${c.role_id}">I applied</button><button class="btn sm ghost" data-act="no" data-id="${c.role_id}" data-confirm="Not interested in this role? It will never be shown again.">Not for me</button></div></div></div>`;
    case 'decide': return html`<div class="row" style="gap:16px">${rings(c.fit, c.tailored)}<div class="col" style="gap:6px">
      ${c.busy ? html`<span class="btn" disabled><span class="spin"></span>Writing your CV and letter</span>` : html`<button class="btn p" data-act="prepare" data-id="${c.role_id}">Prepare CV and letter</button>`}
      <a class="btn sm" href="#/roles/${c.role_id}">Look at it</a>
      <button class="btn sm ghost" data-act="no" data-id="${c.role_id}" data-confirm="Not interested in this role? It will never be shown again.">Not for me</button></div></div>`;
    case 'mail': return html`<div class="col" style="gap:6px;justify-content:center"><a class="btn p" href="#/replies/${c.mail_id}">Read and reply</a></div>`;
    case 'talk': return html`<div class="col" style="gap:6px;justify-content:center"><a class="btn p" href="#/interviews/${c.talk_id}">Open your prep</a>${url ? html`<a class="btn sm" href="${url}" target="_blank" rel="noopener noreferrer">Join link</a>` : ''}</div>`;
    case 'send': return html`<div class="col" style="gap:6px;justify-content:center"><button class="btn p" data-act="copyopen" data-note="${c.note_id}" data-url="${url}">Copy note${url ? ' and open profile' : ''}</button>
      <div class="row" style="gap:6px"><button class="btn sm" data-act="sent" data-id="${c.note_id}">I sent it</button><a class="btn sm ghost" href="#/people/${c.person_id}">Edit</a></div></div>`;
    case 'nudge': return html`<div class="col" style="gap:6px;justify-content:center"><button class="btn p" data-act="nudge" data-id="${c.person_id}" data-busy="Writing…">Write a follow-up</button><button class="btn sm" data-act="quiet" data-id="${c.note_id}">Let it go</button></div>`;
    case 'meet': return html`<div class="col" style="gap:6px;justify-content:center"><button class="btn p" data-act="draft" data-id="${c.person_id}" data-busy="Writing…">Write a note</button>${url ? html`<a class="btn sm" href="${url}" target="_blank" rel="noopener noreferrer">See profile</a>` : ''}</div>`;
  }
  return '';
}

function card(c, i) {
  const [label, cls] = LABEL[c.kind] || [c.kind, ''];
  return html`<div class="card row" style="gap:16px;padding:20px;align-items:stretch">
    <div class="num">${i + 1}</div>
    <div class="grow col" style="gap:6px"><div class="row wrap" style="gap:8px"><span class="chip ${c.fresh ? 'hot' : cls}">${c.fresh && c.kind === 'apply' ? 'Apply now · still early' : label}</span>${meta(c)}</div>
      <h3 style="font-size:16.5px">${c.title}${c.sub ? html` <span class="m" style="font-weight:500">· ${c.sub}</span>` : ''}</h3>
      ${c.body ? html`<p class="s quote pre">${c.body}</p>` : c.why ? html`<p class="s ink2">${c.why}</p>` : ''}</div>
    ${buttons(c)}</div>`;
}

function question(q, waiting) {
  return html`<div class="card" style="border-color:var(--warn);background:#FFFDF6"><div class="row"><h4>One thing Job Hunt needs from you</h4>${waiting ? html`<span class="chip warn" style="margin-left:auto">${waiting} more</span>` : ''}</div>
    <p style="margin-top:10px;font-weight:600">${q.text}</p>${q.why ? html`<p class="xs m" style="margin-top:3px">${q.why}</p>` : ''}
    ${q.options?.length ? html`<div class="row wrap" style="margin-top:10px;gap:6px">${q.options.map(o => html`<button class="btn sm" data-act="answer" data-id="${q.id}" data-answer="${o}">${o}</button>`)}</div>` : ''}
    <form data-act="answer" data-id="${q.id}" class="row" style="margin-top:8px;gap:6px"><input type="text" name="answer" placeholder="${q.options?.length ? 'Or type your own answer' : 'Type your answer'}" aria-label="Your answer"><button class="btn sm p">Save</button><button type="button" class="btn sm ghost" data-act="answer" data-id="${q.id}" data-answer="skip">Skip</button></form></div>`;
}

function landing(l) {
  return html`<div class="card"><div class="row"><h4>Before you land in ${l.city}</h4><span class="chip blue" style="margin-left:auto">${l.days} days</span></div>
    <div class="bar" style="margin-top:10px"><i style="width:${Math.round(l.done * 100 / l.steps.length)}%"></i></div>
    <div class="col" style="margin-top:12px;gap:9px">${l.steps.map(s => html`<a class="row top-al" href="${s.go}" style="color:inherit;text-decoration:none;gap:9px"><span class="check ${s.done ? 'on' : ''}">${s.done ? '✓' : ''}</span><span class="grow"><b class="s" style="${s.done ? 'color:var(--muted);font-weight:500' : ''}">${s.text}</b>${s.done ? '' : html`<span class="xs m" style="display:block">${s.sub}</span>`}</span></a>`)}</div></div>`;
}

export default {
  title: 'Today',
  sub: d => d.date + (app.state.moving ? ` · you land in ${app.state.days} days` : ''),
  topics: ['today', 'roles', 'people', 'mail', 'talks', 'status'],
  load: () => api('today'),
  view(d) {
    return html`<div class="body cols">
      <div class="col" style="gap:14px">
        <div class="card col" style="padding:22px;gap:18px">
          <div><div class="eb">${d.name ? html`Good to see you, ${d.name}` : 'Your search'}</div><h2 style="margin-top:6px">${d.headline}</h2>
            <p class="m" style="margin-top:6px">Ranked by what moves you closest to an interview. Freshest postings come first: the first ten applicants get read.</p></div>
          <div class="row" style="gap:0;border-top:1px solid var(--line2);padding-top:16px">${d.numbers.map(n => html`<div class="stat grow"><div class="big" style="${n.tone === 'hot' ? 'color:var(--hot)' : n.tone === 'good' ? 'color:var(--good)' : ''}">${n.value}</div><div class="xs" style="font-weight:600">${n.label}</div><div class="xs m">${n.sub}</div></div>`)}</div>
        </div>
        ${d.problems?.length ? html`<div class="card" style="border-color:var(--crit);background:#FFF8F7">${d.problems.map(p => html`<p class="s"><b style="color:var(--crit)">Needs attention.</b> ${p.text} <span class="m">· ${ago(p.at)}</span></p>`)}</div>` : ''}
        ${d.cards.length ? d.cards.map(card) : html`<div class="card empty"><h3>Your list is clear</h3><p>New roles show up here within minutes of being posted, with your CV and letter already written.</p><p style="margin-top:14px"><a class="btn" href="#/radar">See what is being watched</a></p></div>`}
        ${d.more ? html`<div class="card row" style="padding:12px 18px"><span class="eb">After these</span><span class="s"><b>${d.more}</b> more waiting</span><span class="grow"></span><a class="btn ghost sm" href="#/roles?stage=ready">Show all roles</a><a class="btn ghost sm" href="#/people">Show all people</a></div>` : ''}
      </div>
      <div class="col" style="gap:14px">
        ${d.question ? question(d.question, d.waiting) : ''}
        ${d.landing ? landing(d.landing) : ''}
        <div class="card"><h4>Done while you were away</h4><div class="col s" style="margin-top:10px;gap:9px">
          ${d.done?.length ? d.done.map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:62px;flex:none;padding-top:1px">${ago(a.at)}</span><span>${a.text}</span></div>`) : html`<span class="m">Nothing yet. The first search starts as soon as Claude is connected.</span>`}</div></div>
        <div class="card"><h4>Ask Claude, or tell it something</h4><p class="xs m" style="margin-top:3px">It sees everything here and can do what the screens do. Attach a posting, an e-mail or a screenshot if you like.</p>
          <form data-act="ask" class="col" style="margin-top:8px;gap:6px"><textarea name="text" rows="2" placeholder="I also hold a CPA from Ontario" aria-label="Message to Claude"></textarea><button class="btn sm" style="align-self:flex-end">Ask Claude</button></form></div>
      </div></div>`;
  },
  actions: {
    applied: ({ d }) => post(`roles/${d.id}/applied`).then(() => toast('Marked as applied')),
    no: ({ d }) => post(`roles/${d.id}/no`).then(() => toast('It won\'t be shown again')),
    prepare: ({ d }) => post(`roles/${d.id}/prepare`),
    async answer({ d, f }) {
      const answer = (d.answer || f?.answer || '').trim();
      if (!answer) throw new Error('Type an answer, or press Skip.');
      await post(`questions/${d.id}/answer`, { answer });
    },
    async copyopen({ d, data }) {
      const c = data.cards.find(x => String(x.note_id) === d.note);
      await copy(c?.body || '');
      if (d.url) window.open(d.url, '_blank', 'noopener');
      return false;
    },
    sent: ({ d }) => post(`notes/${d.id}/sent`).then(() => toast('Noted. Job Hunt will remind you in a week if they are quiet.')),
    quiet: ({ d }) => post(`notes/${d.id}/quiet`),
    async nudge({ d }) { await post(`people/${d.id}/note`, { purpose: 'nudge' }); location.hash = `#/people/${d.id}`; return false; },
    async draft({ d }) { await post(`people/${d.id}/note`, {}); location.hash = `#/people/${d.id}`; return false; },
    ask({ f, el }) {
      if (!f.text.trim()) return false;
      openAssistant(f.text.trim(), true);
      el.reset();
      return false;
    },
  },
};
