// The Claude panel that sits beside every screen. It shows the conversation,
// sends what the person types and attaches, and puts a button under anything
// Claude wants to do that needs their OK.
import { html, Safe, esc, api, post, del, toast, app } from './app.js';

let view = { turns: [], files: [], busy: false, doing: '', engine: '' };
let lastSeen = 0, sending = false;

const $ = id => document.getElementById(id);
const SPARK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

function remember(open) { try { localStorage.setItem('jh.chat', open ? '1' : ''); } catch { /* private window */ } }
function remembered() { try { return localStorage.getItem('jh.chat') === '1'; } catch { return false; } }

// Claude's words become HTML here and nowhere else. Everything is escaped
// first; then only bold, lists, and links into the app itself are let back in.
const LINK = /\[([^\]\n]{1,120})\]\((#\/[\w\/?=&;%.,-]*|\/api\/roles\/\d+\/(?:cv|letter)\.docx)\)/g;
function inline(s) {
  return esc(s).replace(LINK, (m, text, to) => `<a href="${to}"${to[0] === '/' ? ' download' : ''}>${text}</a>`).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}
export function words(text) {
  const out = [];
  let list = null, para = [];
  const flush = () => {
    if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; }
    if (list) { out.push('<ul>' + list.map(x => '<li>' + x + '</li>').join('') + '</ul>'); list = null; }
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd(), item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } (list = list || []).push(inline(item[1])); }
    else if (!line.trim()) flush();
    else { if (list) flush(); para.push(inline(line.replace(/^#+\s*/, ''))); }
  }
  flush();
  return new Safe(out.join(''));
}

const size = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function attachment(f, pending) {
  const x = pending ? html`<button type="button" class="x" data-chat="drop" data-id="${f.id}" aria-label="Remove ${f.name}">×</button>` : '';
  if (f.kind === 'image') return html`<span class="att pic"><img src="/api/assistant/files/${f.id}" alt="${f.name}">${x}</span>`;
  return html`<span class="att"><b>${f.name}</b><span class="xs m">${size(f.size)}</span>${x}</span>`;
}

function heldCard(turn, h, i) {
  const state = { done: html`<span class="chip good">Done</span>`, declined: html`<span class="chip">Not done</span>`, failed: html`<span class="chip crit">Didn't work</span>` }[h.state];
  return html`<div class="held ${h.state}"><div class="eb">${h.state === 'waiting' ? 'Needs your OK' : 'You decided'}</div><b>${h.label}</b>
    ${h.why ? html`<span class="xs m">Claude: ${h.why}</span>` : ''}${h.note ? html`<span class="xs" style="color:var(--warn)">${h.note}</span>` : ''}${h.result ? html`<span class="xs" style="color:var(--crit)">${h.result}</span>` : ''}
    <div class="row" style="gap:8px;margin-top:4px">${state || html`<button type="button" class="btn sm p" data-chat="ok" data-turn="${turn.id}" data-i="${i}">Do it</button><button type="button" class="btn sm" data-chat="no" data-turn="${turn.id}" data-i="${i}">Don't</button>`}</div></div>`;
}

function turnView(t) {
  const files = view.files.filter(f => f.chat_id === t.id), x = t.extra || {};
  if (t.who === 'you') return html`<div class="turn you">${files.length ? html`<div class="atts">${files.map(f => attachment(f))}</div>` : ''}<div class="bub">${t.text}</div></div>`;
  return html`<div class="turn claude"><div class="bub ${x.problem ? 'bad' : ''}">${words(t.text)}</div>
    ${x.did?.length ? html`<div class="did">${x.did.map(d => html`<span class="${d.ok ? '' : 'bad'}">${d.ok ? '✓' : '✕'} ${d.label}${d.error ? html` · ${d.error}` : ''}</span>`)}</div>` : ''}
    ${(x.held || []).map((h, i) => heldCard(t, h, i))}</div>`;
}

function ideas() {
  const on = app.route?.parts?.[0] || 'today', role = on === 'roles' && /^\d+$/.test(app.route.parts[1] || '');
  const list = role ? ['Is this role worth my time? Be blunt.', 'Prepare my CV and letter for this role', 'Make the letter shorter and plainer', 'Who should I write to at this employer?']
    : on === 'people' ? ['Who should I write to first, and why?', 'Draft an intro note to the person most likely to answer', 'Who has not answered in a week?']
    : on === 'replies' ? ['What needs an answer from me today?', 'File this e-mail (attach or paste it)']
    : on === 'interviews' ? ['Prepare me for my next interview', 'Add an interview: say who, when and how']
    : ['What should I do first today?', 'Which roles have the fewest applicants right now?', 'Prepare the three best roles I have not applied to', 'Add this posting (attach a screenshot or paste it)'];
  return html`<div class="hello"><div class="mark">${new Safe(SPARK)}</div><h3>Ask, or say what to do</h3>
    <p class="s m">Claude sees what you see in Job Hunt and can do what the screens do: find, prepare, draft, file, change. It asks before removing anything, and it never sends or submits.</p>
    <div class="col" style="gap:6px;margin-top:12px">${list.map(x => html`<button type="button" class="idea" data-chat="idea">${x}</button>`)}</div></div>`;
}

function renderLog(stick) {
  const log = $('chat-log');
  if (!log) return;
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.innerHTML = (view.turns.length ? html`${view.turns.map(turnView)}` : ideas()).s
    + (view.busy ? html`<div class="turn claude"><div class="bub thinking"><span class="spin"></span><span>${view.doing || 'Thinking'}…</span><button type="button" class="btn sm ghost" data-chat="stop">Stop</button></div></div>`.s : '');
  if (stick || near) log.scrollTop = log.scrollHeight;
  const waiting = view.files.filter(f => f.chat_id === 0);
  $('chat-atts').innerHTML = html`${waiting.map(f => attachment(f, true))}`.s;
  $('chat-atts').hidden = !waiting.length;
  $('chat-send').disabled = view.busy || sending;
  $('chat-new').hidden = !view.turns.length;
}

export async function refreshAssistant(stick) {
  if (!$('chat') || $('chat').hidden) return;
  try { view = await api('assistant'); } catch { return; }
  const last = view.turns.length ? view.turns[view.turns.length - 1].id : 0;
  renderLog(stick || last !== lastSeen);
  lastSeen = last;
}

function seeing() {
  const el = $('chat-sees');
  if (el) el.textContent = 'Sees this screen: ' + ($('title')?.textContent || 'Job Hunt');
}
export function assistantRoute() { seeing(); if ($('chat') && !$('chat').hidden && !view.turns.length) renderLog(); }

export function openAssistant(text, send) {
  const box = $('chat');
  if (!box) return;
  box.hidden = false;
  document.querySelector('.app')?.classList.add('chat-open');
  $('chat-open')?.setAttribute('aria-expanded', 'true');
  remember(true);
  seeing();
  const ta = $('chat-text');
  if (text) ta.value = text;
  refreshAssistant(true).then(() => { if (text && send) submit(); });
  ta.focus();
}
function closeAssistant() {
  $('chat').hidden = true;
  document.querySelector('.app')?.classList.remove('chat-open');
  $('chat-open')?.setAttribute('aria-expanded', 'false');
  remember(false);
  $('chat-open')?.focus();
}

async function upload(files) {
  for (const file of files) {
    try { await api('assistant/files?name=' + encodeURIComponent(file.name || 'picture.png'), { method: 'POST', raw: file }); }
    catch (e) { toast(e.message, true); }
  }
  await refreshAssistant(true);
}

async function submit() {
  const ta = $('chat-text'), text = ta.value.trim(), files = view.files.filter(f => f.chat_id === 0).map(f => f.id);
  if (sending || view.busy || (!text && !files.length)) return;
  sending = true;
  $('chat-send').disabled = true;
  try {
    view = await post('assistant', { text, page: location.hash || '#/today', files });
    ta.value = '';
    ta.style.height = '';
    lastSeen = view.turns.length ? view.turns[view.turns.length - 1].id : 0;
  } catch (e) { toast(e.message, true); }
  sending = false;
  renderLog(true);
}

const acts = {
  close: closeAssistant,
  idea(el) { const ta = $('chat-text'); ta.value = el.textContent; ta.focus(); },
  stop() { post('assistant/stop').catch(() => {}); },
  async drop(el) { await del('assistant/files/' + el.dataset.id).catch(() => {}); refreshAssistant(); },
  async clear() {
    if (!confirm('Start a new conversation? What Claude already did stays done.')) return;
    try { await del('assistant'); } catch (e) { toast(e.message, true); }
    lastSeen = 0;
    refreshAssistant(true);
  },
  async ok(el) { await decide(el, true); },
  async no(el) { await decide(el, false); },
};
async function decide(el, ok) {
  el.closest('.held').querySelectorAll('button').forEach(b => { b.disabled = true; });
  if (ok) el.textContent = 'Doing it…';
  try { await post('assistant/confirm', { turn: +el.dataset.turn, index: +el.dataset.i, ok }); } catch (e) { toast(e.message, true); }
  refreshAssistant();
}

// The panel's frame. It is put on the page once, with the rest of the app.
export const assistantButton = () => html`<button type="button" class="btn sm ask" id="chat-open" aria-expanded="false" aria-controls="chat" title="Ask Claude (Ctrl+J)">${new Safe(SPARK)}Ask Claude</button>`;
export const assistantFrame = () => html`<aside class="chat" id="chat" aria-label="Claude" hidden>
  <header><span class="mark">${new Safe(SPARK)}</span><div class="grow"><b>Claude</b><div class="xs m" id="chat-sees"></div></div>
    <button type="button" class="btn sm ghost" id="chat-new" data-chat="clear" hidden>New</button><button type="button" class="btn sm ghost" data-chat="close" aria-label="Close Claude">✕</button></header>
  <div class="chat-log" id="chat-log" aria-live="polite"></div>
  <form class="chat-box" id="chat-form"><div class="atts" id="chat-atts" hidden></div>
    <textarea id="chat-text" rows="2" placeholder="Ask anything, or say what to do" aria-label="Message to Claude"></textarea>
    <div class="row" style="gap:8px"><label class="btn sm" title="Attach a document or a picture"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3"/></svg>Attach<input type="file" id="chat-file" multiple hidden accept=".docx,.pdf,.txt,.md,.csv,.eml,.html,.json,.ics,image/png,image/jpeg,image/gif,image/webp"></label>
      <span class="xs m grow">Enter sends</span><button class="btn sm p" id="chat-send">Send</button></div></form></aside>`;

export function mountAssistant() {
  const box = $('chat');
  if (!box || box.dataset.on) return;
  box.dataset.on = '1';
  $('chat-open').addEventListener('click', () => (box.hidden ? openAssistant() : closeAssistant()));
  box.addEventListener('click', ev => { const el = ev.target.closest('[data-chat]'); if (el && acts[el.dataset.chat]) { ev.preventDefault(); acts[el.dataset.chat](el); } });
  $('chat-form').addEventListener('submit', ev => { ev.preventDefault(); submit(); });
  const ta = $('chat-text');
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); submit(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 180) + 'px'; });
  ta.addEventListener('paste', ev => { const files = [...(ev.clipboardData?.files || [])]; if (files.length) { ev.preventDefault(); upload(files); } });
  $('chat-file').addEventListener('change', ev => { const files = [...ev.target.files]; ev.target.value = ''; if (files.length) upload(files); });
  box.addEventListener('dragover', ev => { ev.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', ev => { ev.preventDefault(); box.classList.remove('drop'); const files = [...(ev.dataTransfer?.files || [])]; if (files.length) upload(files); });
  if (remembered()) openAssistant();
}
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'j' && $('chat')) { ev.preventDefault(); $('chat').hidden ? openAssistant() : closeAssistant(); }
  if (ev.key === 'Escape' && $('chat') && !$('chat').hidden && $('chat').contains(document.activeElement)) closeAssistant();
});
