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
  // background.js puts fill.js on the page (again, if the copy there is from before an update) and
  // starts it; the answers come back to the page through background.js.
  const r = await new Promise(ok => chrome.runtime.sendMessage({ fillTab: tab.id }, ok));
  if (!r || !r.ok) return say("Couldn't fill it in", (r && r.error) || 'The extension didn\'t answer. Close this and press the button again.', true);
  say('Filling it in', 'Job Hunt is reading the form and writing the answers: watch the panel on the page. You press Submit.', false, 'Working');
  setTimeout(() => window.close(), 2500);
}
// What the extension did lately (what it asked Job Hunt, what came back, what it put right by
// itself), to paste to Claude when something isn't working. No answers or form contents in it.
async function copyLog() {
  const text = await new Promise(ok => chrome.runtime.sendMessage({ report: 'copied from the popup', page: tab && tab.url ? new URL(tab.url).hostname : '' }, ok));
  try { await navigator.clipboard.writeText(text || 'No log.'); $('log').textContent = 'Copied: paste it to Claude'; }
  catch (e) { $('log').textContent = "Couldn't copy it"; }
}
// Leads: the hiring posts on this page (LinkedIn's feed or a search of posts), or this one page.
async function posts(chosen) {
  say('Reading the posts…', 'Job Hunt keeps the ones where someone says they\'re hiring, and reads each against your CV.', false, 'Working');
  const r = await new Promise(ok => chrome.runtime.sendMessage({ posts: tab.id, chosen }, ok));
  if (!r || !r.ok) return say("Couldn't send them", r ? r.error : '', true);
  const { seen, added, hiring, note, many } = r.v;
  if (!many) return say(added ? 'Added to your leads' : 'Already in your leads', added ? 'It\'s under Leads in Job Hunt\'s Queue, with where you\'d help and who to write to.' : 'Job Hunt has this one.', false, 'Done');
  say(added ? `${added} hiring post${added === 1 ? '' : 's'} added` : 'No new hiring posts here',
    `${seen} post${seen === 1 ? '' : 's'} read, ${hiring} about hiring${hiring > added ? `, ${hiring - added} already seen or not really hiring` : ''}. ${added ? 'They\'re under Leads in Job Hunt\'s Queue.' : 'Scroll down for more posts and press again.'}${note ? ' ' + note : ''}`, false, 'Done');
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
  $('log').onclick = e => { e.preventDefault(); copyLog(); };
  $('posts').onclick = () => posts(false);
  $('lead').onclick = e => { e.preventDefault(); posts(true); };
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
    $('stale').textContent = `This copy of the extension is older than Job Hunt (${c.stale.version}) and can't update itself. In ${navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome'}://extensions, remove it, then press Load unpacked and choose ${c.stale.folder || 'the folder shown in Job Hunt: Settings → Applying → Filling in formslying → Filling in forms'}. From then on it updates by itself.`;
  }
  const ping = await ask('/ext/ping');
  if (!ping || !ping.ok) {
    conn('off', /running/.test((ping && ping.error) || '') ? 'Job Hunt isn\'t running' : 'Not connected');
    $('fill').disabled = true;
    if (onPage) say('Job Hunt isn\'t running', 'Open Job Hunt on this computer to fill in forms. Sending a posting still works.', true);
    return;
  }
  conn('on', 'Connected');
  // Leads: on LinkedIn's feed or a search of posts, send the hiring ones; and the searches to open.
  const postsPage = onPage && /linkedin\.com\/(feed|search\/results\/(content|all)|posts|in\/[^/]+\/recent-activity)/.test(tab.url);
  if (postsPage) { $('posts').hidden = false; $('posts').className = 'pr'; $('fill').hidden = true; $('send').hidden = true; }
  ask('/ext/leads/searches').then(r => {
    const list = (r && r.ok && r.v.searches) || [];
    if (!list.length && !onPage) return;
    $('leads').hidden = false;
    for (const s of list.slice(0, 5)) {
      const b = document.createElement('button'); b.textContent = s.title; b.title = `LinkedIn posts from the last week that say hiring and ${s.title}`;
      b.onclick = () => { chrome.tabs.create({ url: s.url }); window.close(); };
      $('searches').appendChild(b);
    }
    if (onPage && !postsPage) $('leadline').hidden = false;
  });
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
  } else say(...(postsPage ? ['Hiring posts on this page', 'Job Hunt keeps the posts where someone says they\'re hiring, with how well you fit and who to write to. Scroll first to read more of them.'] : ['A job posting or a form?', 'Send the posting to Job Hunt, or fill in the application form on this page.']), false, 'This page');
})();
