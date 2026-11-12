// The popup. Three things: fill in the application form on this page from your tailored CV (through
// background.js), send the posting you're on to Job Hunt (through the clipboard, as the bookmark
// does), and open the applications you've approved, one by one, to submit them.
const $ = id => document.getElementById(id);
const say = (what, more, bad, kicker) => { $('what').textContent = what; $('more').textContent = more || ''; $('page').className = bad ? 'card bad' : 'card'; if (kicker) $('kicker').textContent = kicker; };
const ask = (path, body) => new Promise(ok => chrome.runtime.sendMessage({ popup: path, body }, ok));
const conn = (state, text) => { $('conn').className = `conn ${state}`; $('connText').textContent = text; };
let tab;
async function send() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['clip.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => clipPage(true) });
    if (!result) return say("Couldn't read this page", 'Select the posting\'s text and press the button again.', true);
    await navigator.clipboard.writeText(result);
    const c = JSON.parse(result.slice(result.indexOf(':') + 1));
    say('Sent to Job Hunt', `${c.title || tab.title}${c.company ? ` at ${c.company}` : ''}. Job Hunt picks it up in a few seconds; it comes to your Queue once it's scored.`, false, 'Done');
  } catch (e) { say("Couldn't send it", String(e.message || e), true); }
}
async function fill() {
  try {
    // fill.js runs in the page (once), then starts reading the form; answers come back through background.js.
    const [{ result: loaded }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!window.__jobhunt });
    if (!loaded) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fill.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__jobhunt && window.__jobhunt.start() });
    say('Filling it in', 'Job Hunt is reading the form and writing the answers: watch the panel on the page. You press Submit.', false, 'Working');
    setTimeout(() => window.close(), 2500);
  } catch (e) { say("Couldn't fill it in", String(e.message || e), true); }
}
// A company's initial on a tile whose colour comes from its name, as in Job Hunt.
function tile(name) {
  const s = String(name || '?').trim(); let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  const el = document.createElement('span');
  el.className = 'av'; el.textContent = ((s.match(/[A-Za-z0-9]/) || ['?'])[0]).toUpperCase();
  el.style.background = `hsl(${h} 60% 92%)`; el.style.color = `hsl(${h} 45% 32%)`;
  return el;
}
// The applications you've approved: open each one's form, told to Job Hunt first so Fill this form
// knows which application it is.
function submitList(jobs) {
  const ready = jobs.filter(j => j.status === 'approved' && j.url).slice(0, 6);
  if (!ready.length) return;
  $('submit').hidden = false;
  const box = $('todo');
  box.textContent = '';
  for (const j of ready) {
    const row = document.createElement('div'); row.className = 'todo';
    const g = document.createElement('div'); g.className = 'g';
    const b = document.createElement('b'); b.textContent = j.title;
    const s = document.createElement('span'); s.textContent = j.company;
    g.append(b, s);
    const open = document.createElement('button'); open.textContent = 'Open'; open.title = 'Opens its application page; then press Fill this form there';
    open.onclick = async () => {
      open.disabled = true;
      await ask('/ext/pick', { job_id: j.id, url: j.url, title: j.title });
      chrome.tabs.create({ url: j.url });
      window.close();
    };
    row.append(tile(j.company), g, open);
    box.appendChild(row);
  }
}
(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onPage = tab && /^https?:/.test(tab.url || '');
  $('send').onclick = send;
  $('fill').onclick = fill;
  // The shortcut for Fill this form, as set in the browser (it can be changed there).
  try { chrome.commands.getAll(l => { const c = (l || []).find(x => x.name === 'fill-form'); if (c && c.shortcut) $('key-hint').textContent = c.shortcut; }); } catch (e) { /* older browser */ }
  $('change').onclick = e => { e.preventDefault(); $('setup').hidden = false; $('key').focus(); };
  $('save').onclick = async () => {
    await chrome.storage.local.set({ key: $('key').value.trim() });
    const r = await ask('/ext/ping');
    if (r && r.ok) { $('setup').hidden = true; conn('on', 'Connected'); say('Connected to Job Hunt', 'Fill this form now works on application pages.', false, 'Done'); }
    else { conn('off', 'Not connected'); say("That didn't connect", r ? r.error : 'Is Job Hunt running?', true); }
  };
  // Just updated: say so once (the icon's NEW badge goes too).
  const { updated: up } = await chrome.storage.local.get('updated');
  if (up) {
    $('updated').hidden = false;
    $('updated').textContent = `Updated to ${up.to}. Reload application forms that were open before the update.`;
    chrome.storage.local.remove('updated');
    chrome.action.setBadgeText({ text: '' });
  }
  if (!onPage) { $('acts').hidden = true; say('Open a job posting or application form', 'Then press this button on its page.', false); }
  const { key } = await chrome.storage.local.get('key');
  if (!key) { $('setup').hidden = false; $('change').hidden = true; $('fill').hidden = true; conn('off', 'No key yet'); if (onPage) say('Send this posting to Job Hunt', 'Or connect below to fill in application forms too.'); return; }
  // Older than Job Hunt: it reloads itself with the new files (then open it again).
  const c = await new Promise(ok => chrome.runtime.sendMessage({ check: true }, ok));
  if (c && c.updating) { $('acts').hidden = true; conn('on', 'Updating'); return say('Updating the extension…', `Job Hunt is on ${c.updating}; the extension reloads itself to match. Open it again in a moment.`, false, 'One moment'); }
  if (c && c.stale) {
    $('stale').hidden = false;
    $('stale').textContent = `This copy of the extension is older than Job Hunt (${c.stale.version}) and can't update itself. In ${navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome'}://extensions, remove it, then press Load unpacked and choose ${c.stale.folder || 'the folder shown in Job Hunt: Settings → Browser extension'}. From then on it updates by itself.`;
  }
  const ping = await ask('/ext/ping');
  if (!ping || !ping.ok) {
    conn('off', /running/.test((ping && ping.error) || '') ? 'Job Hunt isn\'t running' : 'Not connected');
    $('fill').disabled = true;
    if (onPage) say('Job Hunt isn\'t running', 'Open Job Hunt on this computer to fill in forms. Sending a posting still works.', true);
    return;
  }
  conn('on', 'Connected');
  const l = await ask('/ext/jobs');
  const jobs = (l && l.ok && l.v.jobs) || [];
  submitList(jobs);
  if (!onPage) return;
  // Which application this page is, and whether the company's own site has it.
  const r = await ask('/ext/which', { url: tab.url, title: tab.title });
  // Choose the job yourself: when Job Hunt guessed wrong, or couldn't tell.
  if (jobs.length) {
    $('otherline').hidden = false;
    $('jobs').textContent = '';
    for (const j of jobs) { const o = document.createElement('option'); o.value = j.id; o.textContent = `${j.title} · ${j.company}`; $('jobs').appendChild(o); }
    $('other').onclick = e => { e.preventDefault(); $('choose').hidden = false; $('otherline').hidden = true; };
    $('pick').onclick = async () => {
      const p = await ask('/ext/pick', { job_id: $('jobs').value, url: tab.url, title: tab.title });
      if (p && p.ok) { $('choose').hidden = true; say(`${p.v.job.title}`, `${p.v.job.company}. Chosen for this site: get to the application form, then press Fill this form.`, false, 'This application'); }
      else say("Couldn't choose it", p ? p.error : '', true);
    };
  }
  if (r && r.ok) {
    const j = r.v.job;
    say(j.title, r.v.company_link ? `${j.company}. Job Hunt found this job on the company's own site: applying there goes straight to them.` : `${j.company}. Get to the application form, then press Fill this form.`, false, 'This application');
    if (r.v.company_link) { $('company').hidden = false; $('company').onclick = () => { chrome.tabs.update(tab.id, { url: r.v.company_link }); window.close(); }; }
  } else say('A job posting or a form?', 'Send the posting to Job Hunt, or fill in the application form on this page.', false, 'This page');
})();
