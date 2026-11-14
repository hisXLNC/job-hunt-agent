// ---- A CV from a conversation ----
// For someone with no CV, or one that's out of date: Claude interviews them (what they do, each
// job and what came of it, education, skills), writes the CV as they go, and one button makes it
// one of their CVs. In the first-run setup and on Me, CVs: wherever a page puts [data-cv-chat].

const cvChat = { open: false, text: '', timer: 0, st: null, hearing: null };
const cvChatSpeech = () => window.SpeechRecognition || window.webkitSpeechRecognition;

function cvChatHtml(st) {
  const chat = st.chat || [];
  const rows = [`<div class="ask-msg them"><p>Tell me what kind of work you're looking for and what you do now, in your own words. Or paste an old CV, your LinkedIn profile or rough notes, and I'll start from that.</p></div>`,
    ...chat.map(m => `<div class="ask-msg ${m.who === 'you' ? 'me' : 'them'}">${m.who === 'you' ? esc(m.text) : mdHtml(m.text)}</div>`)];
  if (st.busy) rows.push('<div class="ask-msg them wait"><span class="spin" data-kind="cvchat"></span>Thinking…</div>');
  if (st.error) rows.push(`<div class="ask-err small"><b>Claude couldn't answer.</b> ${esc(st.error)} Your message is back in the box to send again.</div>`);
  return `<details class="cv-chat-box" ${cvChat.open || chat.length ? 'open' : ''}>
    <summary><b>No CV, or yours is out of date? Build one by talking to Claude</b><span class="muted small">Claude asks about your work a step at a time and writes the CV from your answers. Nothing is made up: it only uses what you say.</span></summary>
    <div class="cv-chat-grid">
      <div class="cv-chat-talk">
        <div class="ask-log cv-chat-log" aria-live="polite">${rows.join('')}</div>
        <form class="ask-send" data-cv-chat-form>
          <textarea rows="2" placeholder="${chat.length ? 'Your answer…' : 'e.g. I\'m a project coordinator at a hospital and want project manager roles'}" aria-label="Your message" ${st.busy ? 'disabled' : ''}>${esc(cvChat.text || st.draft || '')}</textarea>
          ${cvChatSpeech() ? `<button class="btn cv-chat-mic" type="button" data-cv-chat-mic aria-label="Speak your answer" title="Speak your answer: press, talk, and it's typed for you">${svg('mic')}</button>` : ''}
          <button class="btn primary ask-go" type="submit" aria-label="Send" title="Send (Enter)" ${st.busy ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
        </form>
      </div>
      <div class="cv-chat-cv">
        <div class="row" style="justify-content:space-between"><b>Your CV so far</b>${st.cv ? `<span class="pill ${st.ready ? 'good' : 'warn'}">${st.ready ? 'Ready to use' : 'Still thin'}</span>` : ''}</div>
        ${st.cv ? `<pre class="cv-chat-draft">${esc(st.cv)}</pre>` : '<p class="muted small">It appears here once you\'ve told Claude about a job you\'ve had or what you studied, and grows with each answer.</p>'}
        <div class="row">
          <button class="btn ${st.ready ? 'primary' : ''}" type="button" data-cv-chat-create ${st.cv && !st.busy ? '' : 'disabled'} title="Adds it to your CVs, laid out as a Word file. You can keep talking and make a better one after.">Create my CV</button>
          ${chat.length ? '<button class="btn ghost" type="button" data-cv-chat-clear>Start over</button>' : ''}
        </div>
        ${st.cv && !st.ready ? '<p class="muted small">You can create it now, but a few more answers will make it stronger.</p>' : ''}
      </div>
    </div></details>`;
}

function cvChatDraw(st) {
  cvChat.st = st;
  document.querySelectorAll('[data-cv-chat]').forEach(box => {
    const had = box.querySelector('textarea'), typing = had && document.activeElement === had;
    box.innerHTML = cvChatHtml(st);
    const log = box.querySelector('.cv-chat-log'); log.scrollTop = log.scrollHeight;
    if (typing && !st.busy) box.querySelector('textarea').focus();
  });
  clearTimeout(cvChat.timer);
  if (st.busy) cvChat.timer = setTimeout(cvChatLoad, 1200);
}
async function cvChatLoad() {
  if (!document.querySelector('[data-cv-chat]')) return;
  try { cvChatDraw(await api('/api/cv-chat')); } catch (e) { /* the page says so when a message is sent */ }
}
async function cvChatSend(box) {
  const ta = box.querySelector('textarea'), text = ta.value.trim();
  if (!text) return toast('Write your answer first.', true);
  cvChat.text = ''; cvChat.open = true;
  // Shown at once; the server's copy replaces it.
  cvChatDraw({ ...(cvChat.st || {}), chat: [...((cvChat.st || {}).chat || []), { who: 'you', text }], busy: true, error: '', draft: '' });
  try { cvChatDraw(await api('/api/cv-chat', { method: 'POST', body: { message: text } })); }
  catch (e) { cvChat.text = text; toast(e.message, true); cvChatLoad(); }
}
/** Speak an answer: the browser types what it hears into the box. */
function cvChatHear(btn) {
  const box = btn.closest('[data-cv-chat]'), ta = box.querySelector('textarea');
  if (cvChat.hearing) { cvChat.hearing.stop(); return; }
  const R = cvChatSpeech();
  const r = cvChat.hearing = new R();
  r.lang = navigator.language || 'en-US'; r.interimResults = false; r.continuous = true;
  const base = ta.value.trim();
  let said = '';
  r.onresult = e => { said = [...e.results].map(x => x[0].transcript).join(' '); ta.value = `${base} ${said}`.trim(); cvChat.text = ta.value; };
  r.onerror = e => { toast(e.error === 'not-allowed' ? 'The microphone isn\'t allowed here. Type your answer instead.' : 'Couldn\'t hear that. Type your answer instead.', true); };
  r.onend = () => { cvChat.hearing = null; document.querySelectorAll('[data-cv-chat-mic]').forEach(b => b.classList.remove('on')); };
  try { r.start(); btn.classList.add('on'); toast('Listening. Press the microphone again when you\'re done.'); } catch (e) { cvChat.hearing = null; toast('The microphone isn\'t available here. Type your answer instead.', true); }
}

document.addEventListener('submit', e => { const f = e.target.closest?.('[data-cv-chat-form]'); if (f) { e.preventDefault(); cvChatSend(f.closest('[data-cv-chat]')); } });
document.addEventListener('input', e => { if (e.target.closest?.('[data-cv-chat-form]')) cvChat.text = e.target.value; });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.closest?.('[data-cv-chat-form]')) { e.preventDefault(); cvChatSend(e.target.closest('[data-cv-chat]')); }
});
document.addEventListener('toggle', e => { if (e.target.matches?.('.cv-chat-box')) cvChat.open = e.target.open; }, true);
document.addEventListener('click', async e => {
  const mic = e.target.closest?.('[data-cv-chat-mic]');
  if (mic) return cvChatHear(mic);
  if (e.target.closest?.('[data-cv-chat-clear]')) {
    if (!await ask('Start the CV conversation over? What you\'ve told Claude so far is deleted. CVs you already created stay.', 'Start over')) return;
    try { cvChat.text = ''; cvChatDraw(await api('/api/cv-chat', { method: 'POST', body: { clear: true } })); } catch (x) { toast(x.message, true); }
    return;
  }
  const make = e.target.closest?.('[data-cv-chat-create]');
  if (make) {
    make.disabled = true; make.innerHTML = '<span class="spin" data-kind="cv"></span>Creating…';
    try {
      const r = await api('/api/cv-chat', { method: 'POST', body: { create: true } });
      toast(`Added to your CVs as “${r.track.label}”. Claude suggested ${(r.track.titles || []).length} job titles to search for.`);
      settingsCache = null;
      await refreshOverview();
      route();
    } catch (x) { toast(x.message, true); cvChatLoad(); }
  }
});
// It fills itself in wherever a page puts its place.
{
  let t = 0;
  const look = () => { const b = document.querySelector('[data-cv-chat]:not([data-done])'); if (b) { document.querySelectorAll('[data-cv-chat]').forEach(x => { x.dataset.done = '1'; }); if (cvChat.st) cvChatDraw(cvChat.st); cvChatLoad(); } };
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(look, 100); }).observe(document.getElementById('main'), { childList: true, subtree: true });
}
