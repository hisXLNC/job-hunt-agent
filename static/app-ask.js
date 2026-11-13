// ---- The assistant: Ask Claude, from any screen ----
// A button that floats over every page and opens a conversation beside what you're doing. Each
// message goes with the screen you're on (its name, its text, the job if there is one, and any
// words you selected), so "what does this mean?" needs no explaining. One conversation, kept.

const SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
const PRACTISE = "Let's practise my interview for this role. You play the interviewer. Ask one question at a time, the kind this company would really ask for this role, and wait for my answer. After each answer, say in two or three plain sentences what worked and what to change, then ask the next question. Start with the first question now.";
const askSt = { open: false, chat: [], busy: false, error: '', quote: '', timer: 0, sent: 0, loaded: false };
const askKeep = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

/** The screen you're on, as the assistant is told: its name, the job on it, and its text. */
function askPage() {
  const [page, arg] = (location.hash.slice(1) || 'overview').split('/');
  const place = (NAV.find(([id]) => id === placeOf()) || [])[1] || 'Job Hunt';
  const side = $('#jobPanel');
  const beside = side && !side.hidden;
  const h1 = ((beside ? side : $('#main')).querySelector('h1, h2')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const job = ['job', 'apply', 'review'].includes(page) && arg ? decodeURIComponent(arg) : beside ? panelJob : '';
  const text = el => (el?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  // The job beside a list is what you're looking at; the list behind it comes second.
  const seen = (beside ? `${text(side)}\n\n` : '') + text($('#main'));
  return { where: h1 && h1 !== place ? `${place} › ${h1}` : place, short: h1 || place, hash: location.hash, job, seen: seen.slice(0, 9000), quote: askSt.quote };
}

/** Questions worth a tap, for where you are. */
function askIdeas() {
  if (askSt.quote) return ['What does this mean?', 'Do I have this in my CV?', 'How would I show this?'];
  const p = askPage();
  if (p.job) return ['Why this fit score?', 'What do the missing keywords mean?', 'Is this role worth applying to?', 'What should I say about salary?'];
  if (location.hash.startsWith('#settings') || location.hash.startsWith('#search')) return ['What does this screen do?', 'What should I set here?'];
  if (location.hash.startsWith('#cvs')) return ['What should I improve in my CV?', 'Explain this screen'];
  return ['What should I do next?', 'Explain this screen'];
}

function askBuild() {
  if ($('#askFab')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <button id="askFab" class="ask-fab" type="button" title="Ask Claude about what's on screen (C)">${SPARK}<span>Ask Claude</span></button>
    <button id="askSel" class="ask-sel" type="button" hidden>${SPARK}Ask Claude</button>
    <section id="askPanel" class="ask-panel" role="dialog" aria-label="Ask Claude" hidden>
      <header class="ask-head">
        <span class="ask-mark">${SPARK}</span>
        <div class="ask-title"><b>Ask Claude</b><span class="muted small" id="askWhere"></span></div>
        <button class="btn ghost sm" type="button" id="askNew" hidden>New chat</button>
        <button class="ask-x" type="button" id="askClose" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="ask-log" id="askLog" aria-live="polite"></div>
      <div class="ask-foot">
        <div class="ask-quote" id="askQuote" hidden></div>
        <div class="ask-ideas" id="askIdeas"></div>
        <form class="ask-send" id="askForm">
          <textarea id="askMsg" rows="1" placeholder="Ask about anything on this screen…" aria-label="Your message"></textarea>
          <button class="btn primary ask-go" type="submit" aria-label="Send" title="Send (Enter)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
        </form>
      </div>
    </section>`);
  $('#askFab').addEventListener('click', () => askOpen());
  $('#askClose').addEventListener('click', askClose);
  $('#askNew').addEventListener('click', async () => {
    if (!await ask('Start a new chat? This conversation is deleted.')) return;
    try { askTake(await api('/api/ask', { method: 'POST', body: { clear: true } })); } catch (e) { toast(e.message, true); }
  });
  $('#askForm').addEventListener('submit', e => { e.preventDefault(); askSend($('#askMsg').value); });
  const box = $('#askMsg');
  const grow = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; };
  box.addEventListener('input', () => { grow(); askDrawFoot(); });
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askSend(box.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); askClose(); }
  });
  $('#askIdeas').addEventListener('click', e => { const b = e.target.closest('button'); if (b) askSend(b.textContent); });
  $('#askQuote').addEventListener('click', e => { if (e.target.closest('button')) { askSt.quote = ''; askDrawFoot(); } });
  // A link in an answer goes to that screen; the conversation stays open beside it.
  $('#askLog').addEventListener('click', async e => {
    const c = e.target.closest('[data-ask-copy]');
    if (!c) return;
    const text = askSt.chat[+c.dataset.askCopy]?.text || '';
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (x) { toast('Select the text and copy it.', true); }
  });
  // Select words on a page: a small button beside them asks about just those.
  const sel = $('#askSel');
  const picked = () => {
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const text = s.toString().trim();
    const at = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement;
    if (text.length < 2 || !at?.closest('#main, #jobPanel') || at.closest('input, textarea, [contenteditable]')) return null;
    return { text: text.slice(0, 2000), box: s.getRangeAt(0).getBoundingClientRect() };
  };
  document.addEventListener('mouseup', e => {
    if (e.target.closest?.('#askSel')) return;
    setTimeout(() => {
      const p = picked();
      if (!p || !p.box.width) { sel.hidden = true; return; }
      sel.hidden = false;
      sel.style.top = `${Math.min(innerHeight - 44, p.box.bottom + 8)}px`;
      sel.style.left = `${Math.max(8, Math.min(innerWidth - 140, p.box.right - 60))}px`;
    }, 0);
  });
  document.addEventListener('scroll', () => { sel.hidden = true; }, true);
  sel.addEventListener('mousedown', e => e.preventDefault()); // keep the selection until the click lands
  sel.addEventListener('click', () => { const p = picked(); sel.hidden = true; askOpen(p?.text); });
  window.addEventListener('hashchange', () => setTimeout(askDrawFoot, 400));
}

/** Open the assistant; with `quote`, about those words. */
function askOpen(quote) {
  askBuild();
  if (quote === undefined) { const s = getSelection(); const at = s?.anchorNode?.parentElement; const t = s?.toString().trim() || ''; if (t.length > 1 && at?.closest('#main, #jobPanel')) quote = t.slice(0, 2000); }
  if (quote) askSt.quote = quote;
  askSt.open = true;
  askKeep('ask.open', '1');
  $('#askPanel').hidden = false;
  $('#askFab').hidden = true;
  document.body.classList.add('ask-open');
  askDraw();
  askLoad();
  setTimeout(() => $('#askMsg')?.focus(), 30);
}
function askClose() {
  askSt.open = false;
  askKeep('ask.open', '');
  $('#askPanel').hidden = true;
  $('#askFab').hidden = false;
  document.body.classList.remove('ask-open');
}

/** Take the conversation as the server has it, and keep watching while an answer is on its way. */
function askTake(st) {
  const was = askSt.chat.length, wasBusy = askSt.busy;
  Object.assign(askSt, { chat: st.chat || [], busy: !!st.busy, error: st.error || '', loaded: true });
  if (st.draft && !$('#askMsg').value) { $('#askMsg').value = st.draft; $('#askMsg').dispatchEvent(new Event('input')); }
  askDraw(was !== askSt.chat.length || wasBusy !== askSt.busy);
  clearTimeout(askSt.timer);
  if (askSt.busy) askSt.timer = setTimeout(askLoad, 1000);
  // An answer that arrived while the panel was closed: say so on the button.
  $('#askFab')?.classList.toggle('new', !askSt.open && wasBusy && !askSt.busy && !askSt.error);
}
async function askLoad() {
  try { askTake(await api('/api/ask')); } catch (e) { clearTimeout(askSt.timer); if (askSt.busy) askSt.timer = setTimeout(askLoad, 3000); }
}
async function askSend(text) {
  text = String(text || '').trim();
  if (!text) return;
  askBuild();
  if (!askSt.open) askOpen();
  if (askSt.busy) { toast('Claude is still answering the last message.'); return; }
  const page = askPage();
  const box = $('#askMsg');
  box.value = ''; box.style.height = 'auto';
  // Shown at once; the server's copy replaces it.
  askSt.chat = [...askSt.chat, { who: 'you', text, about: page.where, quote: page.quote }];
  askSt.busy = true; askSt.error = ''; askSt.sent = Date.now(); askSt.quote = '';
  askDraw(true);
  try { askTake(await api('/api/ask', { method: 'POST', body: { message: text, page } })); }
  catch (e) { askSt.chat.pop(); askSt.busy = false; askSt.error = e.message; box.value = text; askDraw(true); }
}

function askDrawFoot() {
  if (!$('#askPanel')) return;
  const p = askPage();
  $('#askWhere').textContent = `Looking at: ${p.short}`;
  const q = $('#askQuote');
  q.hidden = !askSt.quote;
  q.innerHTML = askSt.quote ? `<span>“${esc(askSt.quote.length > 160 ? `${askSt.quote.slice(0, 160)}…` : askSt.quote)}”</span><button type="button" aria-label="Don't ask about these words" title="Remove">×</button>` : '';
  const ideas = $('#askIdeas');
  ideas.hidden = askSt.busy || !!$('#askMsg').value.trim();
  ideas.innerHTML = askIdeas().map(i => `<button type="button" class="ask-idea">${esc(i)}</button>`).join('');
}
function askDraw(toEnd) {
  if (!$('#askPanel')) return;
  const log = $('#askLog');
  let last = '';
  const rows = askSt.chat.map((m, i) => {
    if (m.who === 'you') {
      const on = m.about && m.about !== last ? `<div class="ask-on muted small">${esc(m.about)}</div>` : '';
      last = m.about || last;
      return `${on}<div class="ask-msg me">${m.quote ? `<div class="ask-q">“${esc(m.quote.slice(0, 160))}${m.quote.length > 160 ? '…' : ''}”</div>` : ''}${esc(m.text)}</div>`;
    }
    return `<div class="ask-msg them">${mdHtml(m.text)}<button class="ask-copy" type="button" data-ask-copy="${i}" title="Copy this answer">Copy</button></div>`;
  });
  if (!askSt.chat.length && !askSt.busy) rows.push(`<div class="ask-hello"><span class="ask-mark big">${SPARK}</span><b>Ask about anything you see</b>
    <p class="muted small">Claude can see the screen you're on, your CV and what Job Hunt knows about each job. Ask what a word means, why a role scored as it did, or for a draft answer. Select words on a page to ask about just those.</p></div>`);
  if (askSt.busy) rows.push('<div class="ask-msg them wait"><span class="spin" data-kind="chat"></span>Thinking…</div>');
  if (askSt.error) rows.push(`<div class="ask-err small"><b>Claude couldn't answer.</b> ${esc(askSt.error)} Your message is back in the box to send again.</div>`);
  log.innerHTML = rows.join('');
  $('#askNew').hidden = !askSt.chat.length || askSt.busy;
  $('#askPanel').classList.toggle('fresh', !askSt.chat.length);
  $('#askMsg').placeholder = askSt.chat.length ? 'Reply, or ask something else…' : 'Ask about anything on this screen…';
  askDrawFoot();
  if (toEnd !== false) log.scrollTop = log.scrollHeight;
}

askBuild();
// As you left it: open if it was open (on a wide window), and an answer still being written keeps coming.
if (askKeep('ask.open') && matchMedia('(min-width: 900px)').matches) askOpen(''); else askLoad();
