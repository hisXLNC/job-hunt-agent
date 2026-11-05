// The popup: send the posting you're on to Job Hunt (through the clipboard, as the bookmark does),
// or fill in the application form on this page from your tailored CV (through background.js).
const $ = id => document.getElementById(id);
const say = (what, more, bad) => { $('what').textContent = what; $('more').textContent = more || ''; document.body.className = bad ? 'bad' : ''; };
const ask = (path, body) => new Promise(ok => chrome.runtime.sendMessage({ popup: path, body }, ok));
let tab;
async function send() {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['clip.js'] });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => clipPage(true) });
    if (!result) return say("Couldn't read this page", 'Select the posting\'s text and press the button again.', true);
    await navigator.clipboard.writeText(result);
    const c = JSON.parse(result.slice(result.indexOf(':') + 1));
    say('Sent to Job Hunt', `${c.title || tab.title}${c.company ? ` at ${c.company}` : ''}. Job Hunt picks it up in a few seconds; with Job Hunt in a browser, paste it on its Add a job page.`);
  } catch (e) { say("Couldn't send it", String(e.message || e), true); }
}
async function fill() {
  try {
    // fill.js runs in the page (once), then starts reading the form; answers come back through background.js.
    const [{ result: loaded }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!window.__jobhunt });
    if (!loaded) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fill.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__jobhunt && window.__jobhunt.start() });
    say('Filling it in', 'Job Hunt is reading the form and writing the answers; watch the panel on the page. You press its Submit button.');
    setTimeout(() => window.close(), 2500);
  } catch (e) { say("Couldn't fill it in", String(e.message || e), true); }
}
(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) { $('acts').hidden = true; return say('Open a job posting or application form first', 'Then press this button on its page.', true); }
  $('send').onclick = send;
  $('fill').onclick = fill;
  $('change').onclick = e => { e.preventDefault(); $('setup').hidden = false; };
  $('save').onclick = async () => {
    await chrome.storage.local.set({ key: $('key').value.trim() });
    const r = await ask('/ext/ping');
    if (r && r.ok) { $('setup').hidden = true; say('Connected to Job Hunt', 'Fill this form now works on application pages.'); }
    else say("That didn't connect", r ? r.error : 'Is Job Hunt running?', true);
  };
  const { key } = await chrome.storage.local.get('key');
  if (!key) { $('setup').hidden = false; $('keyline').hidden = true; say('Job Hunt', 'Send a posting to Job Hunt, or set up Fill this form with your key below.'); return; }
  // Which application this page is, and whether the company's own site has it.
  const r = await ask('/ext/which', { url: tab.url, title: tab.title });
  if (r && r.ok) {
    const j = r.v.job;
    say(`${j.title} at ${j.company}`, r.v.company_link ? 'Job Hunt found this job on the company\'s own site: applying there goes straight to them.' : 'Get to the application form, then press Fill this form.');
    if (r.v.company_link) { $('company').hidden = false; $('company').onclick = () => { chrome.tabs.update(tab.id, { url: r.v.company_link }); window.close(); }; }
  } else if (r && r.error && /running/.test(r.error)) say('Job Hunt isn\'t running', 'Open Job Hunt on this computer to fill in forms. Sending a posting still works.', true);
  else say('Job Hunt', 'Send this posting to Job Hunt, or fill in the application form on this page.');
})();
