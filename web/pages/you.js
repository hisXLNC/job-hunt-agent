import { html, api, post, put, del, when, toast, copy, app, rel, exact, with_, applyTheme } from '../app.js';
import { oldCard, oldActions } from '../old.js';

const TABS = [['', 'About you'], ['arriving', 'Arriving'], ['connections', 'Connections'], ['panel', 'Browser side panel'], ['app', 'The app and debugging']];
const lines = s => (s || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
const WORK = { '': 'Not said yet', citizen: 'Yes, as a citizen', resident: 'Yes, as a permanent resident', permit: 'Yes, on a work permit', none: 'Not yet' };

// What the "Find a setting" box knows: where each setting lives and the words
// people use for it. set names the card (data-set); field, the input inside it.
const SETTINGS = [
  ['', 'profile', 'name', 'Your name and how you describe yourself', 'name headline title describe'],
  ['', 'profile', 'rare', 'The one thing few other applicants have', 'rare strength lead unique'],
  ['', 'profile', 'city', 'City, country and where you live now', 'city country town location place toronto home live'],
  ['', 'profile', 'places', 'Nearby places that also count', 'nearby places area towns commute region'],
  ['', 'profile', 'arrive_on', 'Arrival date', 'arrive arrival landing date move moving relocate'],
  ['', 'profile', 'work_status', 'Allowed to work', 'work permit visa citizen resident status authorization authorisation sponsorship'],
  ['', 'profile', 'pay_floor', 'Lowest yearly salary', 'salary pay floor minimum money wage compensation'],
  ['', 'profile', 'level', 'Job titles to look for', 'titles search look for level step up sideways roles keywords'],
  ['', 'profile', 'domain', 'Words that mark your field', 'field domain words keywords'],
  ['', 'profile', 'avoid', 'Never show: titles or employers', 'never show avoid block hide exclude employers mute'],
  ['', 'profile', 'wp_remote', 'Ways of working: remote, hybrid, on site', 'remote hybrid onsite on site office work from home'],
  ['', 'profile', 'max_age_days', 'Hard limits: age of posting, pay, contract, part-time', 'hard limits old postings age contract part-time internship strict'],
  ['', 'profile', 'may_prepare', 'When a strong role appears: write straight away or ask', 'prepare automatically ask before writing tailor auto'],
  ['', 'cvs', '', 'Your CVs', 'cv resume résumé upload add file word pdf'],
  ['', 'facts', '', 'What Job Hunt knows about you', 'facts know about me remember forget'],
  ['', 'answers', '', 'Answers saved for forms', 'answers forms questions saved application'],
  ['arriving', '', '', 'Arriving: your CV in local form', 'arriving arrival pack newcomer local cv terms'],
  ['connections', 'claude', '', 'Claude: subscription, API key, model', 'claude api key model subscription sign in connect anthropic ai'],
  ['connections', 'claude', 'daily_limit', 'Daily spending limit', 'limit budget spend cost dollars money cap'],
  ['connections', 'phone', '', 'Phone notices', 'phone ntfy notice notification push buzz mobile topic quiet hours'],
  ['connections', 'phoneaccess', '', 'Job Hunt on your phone', 'phone mobile access remote browser wifi tailscale away qr code pair'],
  ['connections', 'owncal', '', 'Your Google Calendar', 'google calendar sync busy free times outlook icloud ical ics availability'],
  ['app', 'cloud', '', 'Copies in Google Drive or OneDrive', 'sync google drive onedrive dropbox cloud another computer second pc laptop move'],
  ['connections', 'mail', '', 'Your inbox', 'inbox mail email e-mail gmail imap app password replies'],
  ['connections', 'desk', 'notify', 'Windows notifications', 'notification windows toast alert desktop popup'],
  ['connections', 'desk', 'awake', 'Keep this computer awake', 'awake sleep power standby'],
  ['connections', 'desk', 'morning', 'Morning summary and reminders', 'morning summary reminder remind interview tomorrow closing weekly review thank you'],
  ['connections', 'desk', 'startup', 'Start with Windows', 'start startup sign in boot login autostart windows'],
  ['connections', 'phone', 'detail', 'What phone notices say', 'private privacy urgent only interviews offers names employer'],
  ['connections', 'schedule', '', 'When Job Hunt searches', 'schedule search times when how often quick check full search hours frequency'],
  ['panel', 'panel', '', 'Browser side panel', 'side panel extension browser chrome edge fill forms pair connect'],
  ['app', 'theme', '', 'Light or dark', 'dark light theme colour color night mode appearance look match windows'],
  ['app', 'copies', '', 'Saved copies: restore one', 'backup backups copy copies restore put back recover undo lost'],
  ['app', 'copies', 'dir', 'Where copies are kept', 'backup folder where location drive path onedrive usb'],
  ['app', 'copies', 'keep', 'How many copies are kept', 'backup keep how many 7 14 30 days'],
  ['app', 'version', '', 'Version and updates', 'version update upgrade new install automatic auto-update check'],
  ['app', 'version', '', 'Your data folder', 'data folder files where stored directory'],
  ['app', 'version', '', 'Stop Job Hunt', 'stop quit exit close shut down'],
  ['app', 'debug', '', 'Debugging record', 'debug log report problem error bug support'],
  ['app', 'calls', '', 'Claude, lately: calls and cost', 'usage calls cost spent tokens'],
].map(([tab, set, field, label, words], i) => ({ id: 's' + i, tab, set, field, label, hay: (label + ' ' + words).toLowerCase() }));

function findSettings(text) {
  const want = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!want.length) return [];
  return SETTINGS.filter(x => want.every(w => x.hay.includes(w))).slice(0, 8);
}
const tabName = k => (TABS.find(t => t[0] === k) || TABS[0])[1];
function drawFound(box, text) {
  const hits = findSettings(text);
  box.innerHTML = (hits.length ? html`${hits.map(x => html`<a href="#/you${x.tab ? '/' + x.tab : ''}?hl=${x.id}"><b>${x.label}</b> <span class="m">· ${tabName(x.tab)}</span></a>`)}` : html`<div class="s m" style="padding:10px">No setting matches “${text}”.</div>`).s;
  box.hidden = !text.trim();
}
document.addEventListener('input', ev => { if (ev.target.id === 'setfind') drawFound(document.getElementById('setfound'), ev.target.value); });
document.addEventListener('keydown', ev => {
  if (ev.target.id !== 'setfind') return;
  const box = document.getElementById('setfound');
  if (ev.key === 'Escape') { box.hidden = true; ev.target.value = ''; }
  if (ev.key === 'Enter') { const a = box.querySelector('a'); if (a) { ev.target.blur(); location.hash = a.getAttribute('href'); } }
});
document.addEventListener('click', ev => { if (!ev.target.closest('.setfind')) document.getElementById('setfound')?.setAttribute('hidden', ''); });

function about(d) {
  const p = d.profile;
  d.cvs ||= []; d.facts ||= []; d.answers ||= []; p.titles ||= {};
  return html`<div class="cols wide"><div class="col" style="gap:14px">
    <form data-act="saveprofile" class="card col" style="gap:12px" data-set="profile"><h3>You</h3>
      <div class="grid2"><label class="field">Name<input type="text" name="name" value="${p.name}"></label><label class="field">How you describe yourself<input type="text" name="headline" value="${p.headline}"></label></div>
      <label class="field">The one thing few other applicants have <span class="h">Job Hunt leads with this.</span><input type="text" name="rare" value="${p.rare}"></label>
      <div class="grid3"><label class="field">City you want to work in<input type="text" name="city" value="${p.city}"></label><label class="field">Country<input type="text" name="country" value="${p.country}"></label><label class="field">Where you live now<input type="text" name="home" value="${p.home}"></label></div>
      <label class="field">Nearby places that also count <span class="h">${d.area?.length ? html`${p.city} already includes ${d.area.join(', ')}. Add any others here, comma-separated.` : 'Other towns you would work in. Comma-separated.'}</span><input type="text" name="places" value="${(p.places || []).join(', ')}" placeholder="${d.area?.length ? 'Hamilton, Guelph' : ''}"></label>
      <div class="grid3"><label class="field">You arrive on <span class="h">Leave empty if you are there.</span><input type="date" name="arrive_on" value="${p.arrive_on}"></label>
        <label class="field">Allowed to work there on arrival<select name="work_status">${Object.entries(WORK).map(([k, v]) => html`<option value="${k}" ${p.work_status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field">Lowest yearly salary<input type="number" name="pay_floor" value="${p.pay_floor || ''}" placeholder="No floor"></label></div>
      <label class="row s" style="font-weight:500"><input type="checkbox" name="start_early" ${p.start_early ? 'checked' : ''}> Open to starting remotely before you arrive</label>
      <div class="hr"></div><h3>What to look for</h3><p class="s m">One title per line. All three groups are searched equally often.</p>
      <div class="grid3"><label class="field">At your level<textarea name="level" rows="4">${(p.titles.level || []).join('\n')}</textarea></label><label class="field">A step up<textarea name="step_up" rows="4">${(p.titles.step_up || []).join('\n')}</textarea></label><label class="field">Sideways<textarea name="sideways" rows="4">${(p.titles.sideways || []).join('\n')}</textarea></label></div>
      <div class="grid2"><label class="field">Words that mark your field <span class="h">A title with one of these is always read. Comma-separated.</span><input type="text" name="domain" value="${(p.domain || []).join(', ')}"></label>
        <label class="field">Never show <span class="h">Titles or employers. Comma-separated.</span><input type="text" name="avoid" value="${(p.avoid || []).join(', ')}"></label></div>
      <div class="row wrap" style="gap:16px"><span class="s" style="font-weight:600">Ways of working:</span>${['remote', 'hybrid', 'onsite'].map(w => html`<label class="row s" style="gap:5px"><input type="checkbox" name="wp_${w}" ${!p.workplaces?.length || p.workplaces.includes(w) ? 'checked' : ''}> ${w === 'onsite' ? 'On site' : w[0].toUpperCase() + w.slice(1)}</label>`)}</div>
      <div class="hr"></div><h3>Hard limits</h3><p class="s m">A posting that breaks one of these is set aside without being read. You can still see them under Roles → Set aside.</p>
      <div class="grid3"><label class="field">Posted no longer ago than<select name="max_age_days">${[[0, 'Any age'], [1, '1 day'], [3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month']].map(([v, t]) => html`<option value="${v}" ${(p.max_age_days || 0) === v ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="row s" style="gap:6px;font-weight:500;align-self:end;height:36px"><input type="checkbox" name="pay_strict" ${p.pay_strict ? 'checked' : ''}> Set aside roles that pay under your floor</label></div>
      <div class="row wrap" style="gap:16px"><span class="s" style="font-weight:600">Never show:</span>${[['contract', 'Contract'], ['part-time', 'Part-time'], ['internship', 'Internships']].map(([k, t]) => html`<label class="row s" style="gap:5px"><input type="checkbox" name="no_${k}" ${(p.no_types || []).includes(k) ? 'checked' : ''}> ${t}</label>`)}</div>
      <div class="hr"></div><h3>Letters, follow-ups and your week</h3>
      <div class="grid3"><label class="field">Letter style <span class="h">You can change it for any one role.</span><select name="letter_style">${[['standard', 'Standard'], ['formal', 'Formal: banks, government, law'], ['short', 'Short and direct'], ['warm', 'Warm and personal']].map(([k, t]) => html`<option value="${k}" ${p.letter_style === k ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="field">Follow up on an application <span class="h">When there has been no reply.</span><select name="chase_days">${[...new Set([0, 5, 8, 10, 14, 21, p.chase_days ?? 8])].sort((a, b) => a - b).map(n => html`<option value="${n}" ${(p.chase_days ?? 8) === n ? 'selected' : ''}>${n ? `After ${n} days` : 'Never'}</option>`)}</select></label>
        <label class="field">Applications a week <span class="h">Your goal. 0 for none.</span><input type="number" name="weekly_goal" min="0" max="100" value="${p.weekly_goal ?? 10}"></label></div>
      <label class="field" style="max-width:420px">How you sign a letter <span class="h">One line each. Leave empty for "Sincerely," and your name.</span><textarea name="signature" rows="2" placeholder="Kind regards,&#10;Sam Rivera, CPA">${p.signature || ''}</textarea></label>
      <label class="field" style="max-width:420px">When a strong role appears<select name="may_prepare"><option value="do" ${p.may_prepare !== 'ask' ? 'selected' : ''}>Write the CV and letter straight away</option><option value="ask" ${p.may_prepare === 'ask' ? 'selected' : ''}>Ask me before writing anything</option></select></label>
      <p class="xs m">Job Hunt never submits an application or sends a message. That is always you.</p>
      <div class="row"><button class="btn p">Save</button></div></form>
  </div>
  <div class="col" style="gap:14px">
    <div class="card" data-set="cvs"><h4>Your CVs</h4><div class="col" style="margin-top:10px;gap:10px">${d.cvs.map(c => html`<div class="row"><div class="grow"><b class="s">${c.name}</b><div class="xs m">${c.filename} · added ${rel(c.created_at)}</div></div><a class="btn sm" href="/api/cvs/${c.id}/file">Download</a>${d.cvs.length > 1 ? html`<button class="btn sm ghost danger" data-act="delcv" data-id="${c.id}" data-confirm="Remove this CV?">Remove</button>` : ''}</div>`)}</div>
      <label class="btn sm" style="margin-top:10px">Add another CV<input type="file" accept=".docx,.pdf,.txt,.md" hidden data-on="change" data-act="addcv"></label><p class="xs m" style="margin-top:6px">Word or PDF. Reading it takes about a minute.</p></div>
    <div class="card" data-set="facts"><h4>What Job Hunt knows about you</h4><p class="xs m" style="margin-top:3px">Facts beyond your CV. Used wherever they help, never invented.</p>
      <div class="col s" style="margin-top:8px;gap:6px">${d.facts.map(f => html`<div class="row top-al"><span class="grow">${f.text}</span><button class="btn sm ghost" data-act="delfact" data-id="${f.id}" aria-label="Forget this">Forget</button></div>`)}</div>
      <form data-act="addfact" class="row" style="margin-top:8px;gap:6px"><input type="text" name="text" placeholder="I am a CPA in good standing" aria-label="A fact about you"><button class="btn sm">Add</button></form></div>
    <div class="card" data-set="answers"><h4>Answers saved for forms</h4><p class="xs m" style="margin-top:3px">Asked once, reused on every application.</p>
      <div class="col s" style="margin-top:8px;gap:8px">${d.answers.map(a => html`<div class="row top-al"><div class="grow"><b>${a.question}</b><div class="ink2">${a.answer}</div></div><button class="btn sm ghost" data-act="delanswer" data-id="${a.id}">Remove</button></div>`)}${!d.answers.length ? html`<span class="m">None yet.</span>` : ''}</div></div>
  </div></div>`;
}

function arriving(d) {
  if (!d.has) return html`<div class="card empty"><h3>${d.building ? 'Writing your arrival pack' : 'Arriving in ' + (d.profile.city || 'a new country')}</h3>
    <p style="max-width:560px;margin:0 auto">Employers discount what they don't recognise: foreign employers, titles, currencies, rules. This pack closes that gap honestly: your CV in the local form, your experience restated in their terms, and ready answers to the questions newcomers get.</p>
    <p style="margin-top:14px">${d.building ? html`<span class="spin" style="display:inline-block"></span>` : html`<button class="btn p" data-act="build">Write my arrival pack</button>`}</p></div>`;
  const doc = d.doc, on = doc.changes.filter(c => !c.off).length;
  return html`<div class="cols wide"><div class="col" style="gap:14px">
    <div class="card col" style="gap:12px"><div class="row"><div class="grow"><div class="eb">Your CV in ${d.profile.country || 'local'} form</div><h3 style="margin-top:4px">${on} of ${doc.changes.length} changes on. The facts stay the same.</h3></div>
      ${doc.applied ? html`<span class="chip good">Copy made</span>` : ''}<button class="btn ${doc.applied ? '' : 'p'}" data-act="apply">${doc.applied ? 'Make a fresh copy' : 'Make a copy of my CV with these'}</button></div>
      ${doc.changes.map((c, i) => html`<div class="row top-al" style="gap:12px;${c.off ? 'opacity:.55' : ''}"><button class="switch ${c.off ? '' : 'on'}" role="switch" aria-checked="${c.off ? 'false' : 'true'}" aria-label="Use this change" data-act="toggle" data-i="${i}" data-off="${c.off ? '' : '1'}"></button>
        <div class="grow s">${c.before ? html`<div><span class="del">${c.before}</span></div>` : ''}<div><span class="ins">${c.after}</span></div><div class="xs m">${c.why}</div></div></div>`)}
      <p class="xs m">Your original CV is kept. The copy is used for roles in ${d.profile.country || 'the new country'} from then on.</p></div>
    <div class="card" style="padding:0"><div style="padding:14px 16px 8px"><div class="eb">Your experience, in their terms</div></div><table class="tbl"><thead><tr><th>On your CV</th><th>What a recruiter there recognises</th></tr></thead><tbody>
      ${(doc.terms || []).map(t => html`<tr><td class="s" style="width:40%"><b>${t.yours}</b></td><td class="s"><b style="color:var(--accent)">${t.theirs}</b><div class="xs m">${t.why}</div></td></tr>`)}</tbody></table></div>
  </div>
  <div class="col" style="gap:14px"><div class="card"><div class="row"><h4 class="grow">Questions newcomers get</h4><button class="btn sm ghost" data-act="build" data-confirm="Write the whole pack again? Your switches are reset.">Write again</button></div><p class="xs m" style="margin-top:3px">Ready answers. Fill the [gaps] only you know.</p>
    <div class="col" style="margin-top:10px;gap:12px">${(doc.screening || []).map(q => html`<div class="s"><b>${q.q}</b><div class="ink2 quote" style="margin-top:3px">${q.a}</div></div>`)}</div></div></div></div>`;
}

// Job Hunt on the phone: a second door, shut unless the person opens it.
function phoneAccess(p) {
  if (!p) return '';
  const home = p.addresses.find(a => a.kind === 'home'), away = p.addresses.find(a => a.kind === 'anywhere');
  return html`<div class="card col" style="gap:10px" data-set="phoneaccess"><div class="row"><h3 class="grow">Job Hunt on your phone</h3><span class="chip ${p.on ? (p.problem ? 'crit' : 'good') : ''}">${p.on ? (p.problem ? 'Problem' : p.devices.length ? 'On' : 'On, no phone yet') : 'Off'}</span></div>
    <p class="s m">See Today, open a role, read your letter, download the CV and letter, and mark a role applied, not for you or saved for later, from your phone's browser. Nothing is installed on the phone. Your data stays on this computer, so <b>this computer has to be on with Job Hunt running</b>.</p>
    ${p.problem ? html`<p class="s" style="color:var(--crit)">${p.problem}</p>` : ''}
    <label class="row s" style="font-weight:500"><input type="checkbox" data-on="change" data-act="phoneon" ${p.on ? 'checked' : ''}> Let my phone connect</label>
    ${p.on ? html`<ol class="steps s">
        <li>Put your phone on <b>the same Wi-Fi</b> as this computer.</li>
        <li>Press <b>Add a phone</b> and point the phone's camera at the code. It opens Job Hunt in the phone's browser and stays paired.</li>
        <li>The first time, Windows may ask whether Job Hunt may be reached on your network. Choose <b>Allow</b> (private networks).</li>
      </ol>
      <div class="row wrap"><button class="btn p" data-act="phonecode" data-kind="home" ${home ? '' : 'disabled'} title="${home ? 'Shows a code for a phone on the same Wi-Fi.' : 'This computer is not on a network a phone could reach.'}">Add a phone</button>
        ${away ? html`<button class="btn" data-act="phonecode" data-kind="anywhere" title="Tailscale is running on this computer. A phone that also runs Tailscale, signed in to the same account, reaches Job Hunt from anywhere.">Add a phone through Tailscale</button>` : ''}</div>
      <div id="phonecode"></div>
      ${p.devices.length ? html`<div class="col" style="gap:6px">${p.devices.map(x => html`<div class="row s"><span class="grow"><b>${x.name}</b> <span class="m">· added ${rel(x.added)} · last used ${rel(x.seen)}</span></span><button class="btn sm danger" data-act="phoneforget" data-id="${x.id}" data-confirm="Remove this phone? It will have to scan a new code to connect again.">Remove</button></div>`)}</div>` : ''}
      <details class="xs m"><summary>Away from home, and how safe this is</summary>
        <p style="margin-top:6px"><b>Away from home.</b> The code above works on your own Wi-Fi only. To reach Job Hunt from anywhere, install the free program Tailscale on this computer and on your phone and sign in to both with the same account${away ? '' : '; an "Add a phone through Tailscale" button then appears here'}. Job Hunt is never put on the open internet.</p>
        <p style="margin-top:6px"><b>How safe.</b> Only a phone that scanned a code shown on this screen can connect; a code works once, for ten minutes. The phone can look and do the few things listed above. It cannot reach your keys, passwords, connections, saved copies or settings. On your own Wi-Fi the pages are not encrypted, so don't turn this on where you share the network with strangers; through Tailscale they are.</p></details>` : ''}</div>`;
}

// The person's own calendar, read-only, through its private address.
function ownCalendar(c) {
  if (!c) return '';
  const slot = t => `${new Date(t.start * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${clockOf(t.start)} to ${clockOf(t.end)}`;
  return html`<form data-act="savecal" data-busy="Reading…" class="card col" style="gap:10px" data-set="owncal"><div class="row"><h3 class="grow">Your Google Calendar</h3><span class="chip ${c.on ? (c.note ? 'crit' : 'good') : ''}">${c.on ? (c.note ? 'Problem' : 'Connected') : 'Off'}</span></div>
    <p class="s m">Job Hunt reads your calendar so it knows when you are busy: your own entries show on the month under Interviews, an interview that lands on one is flagged, and the times you are free are listed here, ready to copy into a reply. It reads only. What it reads stays on this computer and is never given to Claude.</p>
    ${c.note ? html`<p class="s" style="color:var(--crit)">${c.note}</p>` : ''}
    ${c.on ? html`<p class="s">Read ${rel(c.at)} · ${c.count} ${c.count === 1 ? 'entry' : 'entries'} in the next four months. Read again every half hour.</p>` : html`<ol class="steps s">
      <li>On a computer, open <b>calendar.google.com</b>. Press the cog at the top right, then <b>Settings</b>.</li>
      <li>On the left, under <b>Settings for my calendars</b>, press your calendar's name.</li>
      <li>Scroll down to <b>Integrate calendar</b>. Copy the address under <b>Secret address in iCal format</b> (press the eye or the copy sign beside it).</li>
      <li>Paste it below and press <b>Connect</b>.</li></ol>`}
    <label class="field">${c.has_url ? 'Secret address' : 'Secret address in iCal format'} <span class="h">Works like a password: anyone who has it can read your calendar. It is kept only in Job Hunt's data file on this computer.</span><input type="password" name="url" placeholder="${c.has_url ? 'Saved. Paste to replace.' : 'https://calendar.google.com/calendar/ical/…/basic.ics'}" autocomplete="off"></label>
    <div class="row wrap"><button class="btn p">${c.on ? 'Read it now' : 'Connect'}</button>${c.has_url ? html`<button type="button" class="btn danger" data-act="forgetcal" data-confirm="Stop reading your calendar? The address and everything read from it are removed from Job Hunt.">Disconnect</button>` : ''}</div>
    ${c.on && c.free?.length ? html`<div><div class="eb">When you are free</div><p class="xs m" style="margin-top:3px">Working hours on the coming working days with nothing in your calendar or in Job Hunt.</p><ul class="s" style="margin:6px 0 0 18px">${c.free.map(t => html`<li>${slot(t)}</li>`)}</ul>
      <button type="button" class="btn sm" style="margin-top:8px" data-act="copyfree" data-text="${c.free.map(slot).join('\n')}">Copy these times</button></div>` : ''}
    <p class="xs m">Outlook and iCloud calendars have such an address too (Outlook: Settings → Calendar → Shared calendars → Publish a calendar → ICS). To put an interview <b>into</b> Google Calendar, open it under Interviews and press <b>Add to Google Calendar</b>.</p></form>`;
}
const clockOf = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function connections(d) {
  const cl = d.claude, ph = d.phone, m = d.mail, ext = d.ext;
  const usage = Object.entries(d.usage || {}).sort((a, b) => b[1].calls - a[1].calls);
  return html`<div class="grid2" style="align-items:start">
    <div class="col" style="gap:14px">
    <form data-act="savellm" class="card col" style="gap:10px" data-set="claude"><div class="row"><h3 class="grow">Claude</h3><span class="chip ${cl.engine && cl.ok ? 'good' : 'warn'}">${cl.engine ? (cl.ok ? 'Connected' : 'Resting') : 'Not connected'}</span></div>
      <p class="s m">Claude does the reading and writing. ${cl.note && !cl.ok ? html`<b style="color:var(--warn)">${cl.note}</b>` : ''}</p>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="claude-code" ${cl.engine === 'claude-code' ? 'checked' : ''} ${d.cli_found ? '' : 'disabled'}> <span><b>Your Claude subscription</b> through Claude Code<br><span class="m">${d.cli_found ? 'Found on this computer. Uses the plan you already pay for.' : 'Claude Code isn\'t installed on this computer. Install it from claude.com/claude-code and sign in.'}</span></span></label>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="api" ${cl.engine === 'api' ? 'checked' : ''}> <span><b>An API key</b><br><span class="m">Pay for what you use. A day of searching costs a few dollars.</span></span></label>
      <div class="grid2" style="padding-left:24px"><label class="field">API key<input type="password" name="key" placeholder="${cl.has_key ? 'Saved. Paste to replace.' : 'sk-ant-…'}" autocomplete="off"></label><label class="field">Stop at this much a day (USD)<input type="number" name="daily_limit" value="${cl.limit || ''}" placeholder="No limit" step="0.5" min="0"></label></div>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="demo" ${cl.engine === 'demo' ? 'checked' : ''}> <span><b>Sample answers</b><br><span class="m">No Claude. For looking around; the writing is crude.</span></span></label>
      <label class="field" style="max-width:340px">Model<select name="model">${d.models.map(x => html`<option value="${x.ID}" ${cl.model === x.ID ? 'selected' : ''}>${x.Name}: ${x.Note}</option>`)}</select></label>
      <div class="row"><button class="btn p">Save</button><button type="button" class="btn" data-act="testllm" data-busy="Asking Claude…">Test it</button><span class="grow"></span><span class="xs m">${cl.calls} calls today${cl.engine === 'api' ? html` · $${cl.today.toFixed(2)} today · $${cl.week.toFixed(2)} this week` : ''}</span></div>
      ${usage.length ? html`<details><summary class="s">What Claude was used for this week</summary><table class="tbl" style="margin-top:6px"><tbody>${usage.map(([k, u]) => html`<tr><td class="s">${k.replace(/_/g, ' ')}</td><td class="s">${u.calls} calls</td><td class="s">${u.cost ? '$' + u.cost.toFixed(2) : ''}</td><td class="s m">${u.errors ? u.errors + ' failed' : ''}</td></tr>`)}</tbody></table></details>` : ''}</form>
    ${moreSources(d)}
    <div class="card row"><span class="s grow">The browser side panel has its own page.</span><a class="btn sm" href="#/you/panel">Browser side panel</a></div>
    </div>
    <div class="col" style="gap:14px">
    <form data-act="savephone" class="card col" style="gap:10px" data-set="phone"><div class="row"><h3 class="grow">Phone notices</h3><span class="chip ${ph.on ? 'good' : ''}">${ph.on ? 'On' : 'Off'}</span></div>
      <p class="s m">A buzz on your phone when a strong role is still fresh, so you can apply inside the first hour. It uses ntfy, a free app that only delivers notices: no account, nothing to pay.</p>
      <ol class="steps s">
        <li><b>On your phone</b>, install the app called <b>ntfy</b> from the App Store or Google Play. Open it and allow notifications when it asks.</li>
        <li><b>Here</b>, press <b>Make a topic for me</b>, then <b>Save</b>. A topic is the name of your private channel. Anyone who knows the name could read your notices, which is why it is long and random.</li>
        <li><b>On your phone</b>, in ntfy press <b>+</b> (Subscribe to topic) and type the topic exactly as it is written below${ph.topic ? html`: <b class="mono">${ph.topic}</b>` : ''}. Leave everything else as it is and press <b>Subscribe</b>.</li>
        <li><b>Here</b>, tick <b>Send notices to my phone</b>, press <b>Save</b>, then <b>Send a test</b>. Your phone should buzz within a few seconds.</li>
      </ol>
      <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${ph.on ? 'checked' : ''}> Send notices to my phone</label>
      <label class="field">Topic <span class="h">The same on your phone and here.</span><input type="text" name="topic" value="${ph.topic}" placeholder="Press Make a topic for me" autocomplete="off" spellcheck="false"></label>
      <div class="grid3"><label class="field">Only for fit at or above <span class="h">75 is a good start.</span><input type="number" name="min_fit" value="${ph.min_fit}" min="50" max="100"></label><label class="field">No notices from <span class="h">Hour, 0 to 23.</span><input type="number" name="quiet_from" value="${ph.quiet_from}" min="0" max="23"></label><label class="field">Until <span class="h">Hour, 0 to 23.</span><input type="number" name="quiet_to" value="${ph.quiet_to}" min="0" max="23"></label></div>
      <label class="field" style="max-width:420px">Which notices <span class="h">Interviews and offers are sent as urgent.</span><select name="only"><option value="" ${ph.only === 'urgent' ? '' : 'selected'}>Fresh roles, replies, reminders and the morning summary</option><option value="urgent" ${ph.only === 'urgent' ? 'selected' : ''}>Only interviews and offers</option></select></label>
      <label class="row s" style="font-weight:500"><input type="checkbox" name="detail" ${ph.detail ? 'checked' : ''}> Name the role and the employer in the notice</label>
      <p class="xs m">Off, a notice says only what kind of thing happened ("A strong role, just posted", "An interview request"). The notice travels through the ntfy server, so leave this off unless your topic is long and yours alone.</p>
      <div class="row wrap"><button class="btn p">Save</button><button type="button" class="btn" data-act="newtopic">Make a topic for me</button><button type="button" class="btn" data-act="testphone">Send a test</button></div>
      <details class="xs m"><summary>No buzz after the test?</summary><p style="margin-top:6px">Check the topic is spelled the same in both places, and that it was saved here before the test. On an iPhone, open Settings → Notifications → ntfy and allow them. On Android, open the phone's Settings → Apps → ntfy → Battery and choose Unrestricted, or notices arrive late. Notices are held back between the two hours above${ph.quiet_from !== ph.quiet_to ? html` (now ${ph.quiet_from}:00 to ${ph.quiet_to}:00)` : ''}; the test is always sent.</p>
        <p style="margin-top:6px">A notice carries the job title, the employer, the fit and how old the posting is, and passes through ntfy's server on its way to your phone.</p>
        <label class="field" style="margin-top:8px;max-width:300px">Server <span class="h">Leave as it is unless you run your own.</span><input type="url" name="server" value="${ph.server}"></label></details></form>
    ${phoneAccess(d.phoneaccess)}${ownCalendar(d.owncal)}
    <form data-act="savemail" data-busy="Checking…" class="card col" style="gap:10px" data-set="mail"><div class="row"><h3 class="grow">Your inbox</h3><span class="chip ${m.on ? (m.note ? 'crit' : 'good') : ''}">${m.on ? (m.note ? 'Problem' : 'Connected') : 'Off'}</span></div>
      <p class="s m">So replies are noticed the moment they arrive. Job Hunt opens the inbox read-only and reads only mail from employers you applied to, hiring systems, people you wrote to, and job alerts from job sites. It cannot send, move or delete anything. Replies it reads are passed to Claude to be understood; job alerts are not.</p>
      ${m.note ? html`<p class="s" style="color:var(--crit)">${m.note}</p>` : ''}
      <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${m.on ? 'checked' : ''}> Watch my inbox for replies</label>
      <div class="grid2"><label class="field">Address<input type="email" name="user" value="${m.user}" autocomplete="off"></label><label class="field">App password <span class="h">Not your normal password.</span><input type="password" name="pass" placeholder="${d.mail_has_pass ? 'Saved. Paste to replace.' : '16 letters'}" autocomplete="off"></label></div>
      <div class="grid2"><label class="field">Mail server<input type="text" name="host" value="${m.host}"></label><label class="field">Check every <span class="h">Minutes, 5 to 240.</span><input type="number" name="every" value="${m.every || 10}" min="5" max="240"></label></div>
      <p class="xs m">A "we received your application" message marks that role as applied by itself, and adds the role if Job Hunt never found it. With Gmail, archived messages are read too.</p>
      <p class="xs m">Gmail: Google Account → Security → 2-Step Verification → App passwords. The password is kept only in Job Hunt's data file on this computer.</p>
      <div class="row"><button class="btn p">Save and check</button>${m.last_at ? html`<span class="xs m">Last read ${rel(m.last_at)}</span>` : ''}</div></form>
    ${thisComputer(d)}${schedule(d)}
    </div></div>`;
}

// The searches that take a key, and job-alert e-mails. A saved key is never
// sent back to this page: it only knows whether one is there.
const SRC_STATE = { working: ['good', 'Working'], problem: ['crit', 'Problem'], off: ['', 'Off'], none: ['', 'Not set up'], waiting: ['blue', 'Not tried yet'] };
function moreSources(d) {
  const saved = s => s.has_key ? 'Saved. Paste to replace.' : '';
  const row = s => {
    const alerts = s.id === 'alerts', [tone, word] = alerts && s.state === 'waiting' ? ['blue', 'Watching'] : SRC_STATE[s.state] || SRC_STATE.none;
    return html`<form data-act="savesource" data-id="${s.id}" class="col" style="gap:8px;border-top:1px solid var(--line2);padding-top:12px">
      <div class="row"><b class="grow">${s.name}</b><span class="chip ${tone}">${word}</span></div>
      <p class="s m">${s.about}</p>
      ${s.note ? html`<p class="s" style="color:var(--${s.state === 'problem' ? 'crit' : 'muted'})">${s.note}</p>` : ''}
      ${alerts ? html`<label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${s.on ? 'checked' : ''}> Take the postings out of job alerts in my inbox</label>` : html`
        <p class="xs m">${s.get} <a href="${s.link}" target="_blank" rel="noopener noreferrer">Open the page that gives the key</a></p>
        ${s.id === 'adzuna' ? html`<div class="grid2"><label class="field">Application ID<input type="text" name="app_id" placeholder="${saved(s)}" autocomplete="off"></label><label class="field">Application Key<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label></div>`
          : s.id === 'jsearch' ? html`<div class="grid2"><label class="field">Key<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label><label class="field">Key from<select name="from"><option value="rapidapi" ${s.from === 'rapidapi' ? 'selected' : ''}>RapidAPI</option><option value="openwebninja" ${s.from === 'openwebninja' ? 'selected' : ''}>OpenWeb Ninja</option></select></label></div>`
          : html`<label class="field" style="max-width:340px">Key<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label>`}
        <div class="row wrap" style="gap:14px"><label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${s.on ? 'checked' : ''}> Search ${s.name}</label>
          <label class="row s" style="gap:6px">At most <input type="number" name="limit" value="${s.limit}" min="1" max="5000" style="width:84px;height:30px" aria-label="Most requests a day to ${s.name}"> requests a day</label></div>
        <p class="xs m">${s.used} used today. Asked on full searches${s.fast ? ', and now and then on quick checks' : ''}. Keep the number inside what your plan allows.</p>`}
      <div class="row"><button class="btn sm p">Save</button>
        ${!alerts && s.has_key ? html`<button type="button" class="btn sm" data-act="testsource" data-id="${s.id}" data-busy="Asking…" title="Runs one small search now and says what came back.">Test</button><button type="button" class="btn sm ghost" data-act="delsource" data-id="${s.id}" data-confirm="Remove the key for ${s.name}? Roles already found there stay.">Remove the key</button>` : ''}
        <span class="grow"></span>${s.at ? html`<span class="xs m">Last answered ${ago(s.at)}: ${s.seen} posting${s.seen === 1 ? '' : 's'}${alerts || s.new ? `, ${s.new} new` : ''}</span>` : ''}</div></form>`;
  };
  return html`<div class="card col" style="gap:12px"><div><h3>More job sources</h3>
    <p class="s m" style="margin-top:4px">Other places Job Hunt can search with your titles and city. Each needs a key that you get yourself, free. A key is kept only in Job Hunt's data file on this computer and is sent only to the service it is for.</p></div>
    ${(d.more || []).map(row)}</div>`;
}

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
function thisComputer(d) {
  const k = d.desk || {};
  return html`<form data-act="savedesk" class="card col" style="gap:10px" data-set="desk"><div class="row"><h3 class="grow">On this computer</h3><span class="chip ${k.notify && d.can_notify ? 'good' : ''}">${k.notify && d.can_notify ? 'Notifications on' : 'Notifications off'}</span></div>
    <label class="row s" style="font-weight:500"><input type="checkbox" name="notify" ${k.notify ? 'checked' : ''}> Show a Windows notification for a fresh role that fits, and when someone writes to you</label>
    <p class="xs m">A click opens it in Job Hunt. Job Hunt also sits by the clock (the icon's menu opens it, searches now, checks for updates or stops it).${d.can_notify ? '' : ' Notifications are shown only on Windows.'}</p>
    <label class="field" style="max-width:420px">Keep this computer awake <span class="h">A sleeping computer finds nothing. The screen can still turn off.</span><select name="awake"><option value="working" ${k.awake === 'working' ? 'selected' : ''}>While Job Hunt is working</option><option value="always" ${k.awake === 'always' ? 'selected' : ''}>Always, while searching is on</option><option value="off" ${k.awake === 'off' ? 'selected' : ''}>Never</option></select></label>
    <label class="field" style="max-width:420px">Morning summary <span class="h">What needs you today, in one notice. Reminders also come the evening before an interview, after one, and two days before a posting closes.</span><select name="morning">${[[-1, 'Never'], [6, '6:00'], [7, '7:00'], [8, '8:00'], [9, '9:00'], [10, '10:00']].map(([v, t]) => html`<option value="${v}" ${k.morning === v ? 'selected' : ''}>${t}</option>`)}</select></label>
    ${d.startup?.can ? html`<label class="row s" style="font-weight:500"><input type="checkbox" name="startup" ${d.startup.on ? 'checked' : ''}> Start Job Hunt when I sign in to Windows <span class="xs m" style="font-weight:400">(in the background, by the clock)</span></label>` : ''}
    <div class="row"><button class="btn p">Save</button>${d.can_notify ? html`<button type="button" class="btn" data-act="testdesk">Show a test</button>` : ''}</div></form>`;
}
function schedule(d) {
  const sc = d.schedule || { full: [] };
  const hour = (name, v) => html`<select name="${name}" style="width:92px">${Array.from({ length: 24 }, (_, h) => html`<option value="${h}" ${v === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`)}</select>`;
  return html`<form data-act="saveschedule" class="card col" style="gap:10px" data-set="schedule"><h3>When Job Hunt searches</h3>
    <label class="field">Full searches at <span class="h">Every source, every title. Times of day, comma-separated; up to six.</span><input type="text" name="full" value="${sc.full.map(hhmm).join(', ')}" placeholder="07:00, 12:30, 17:30"></label>
    <label class="field" style="max-width:420px">Quick check for brand-new postings <span class="h">Only postings a couple of hours old with few applicants. This is what gets you in early.</span><select name="fast_minutes">${[[10, 'Every 10 minutes'], [15, 'Every 15 minutes'], [20, 'Every 20 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [120, 'Every 2 hours'], [0, 'Off']].map(([v, t]) => html`<option value="${v}" ${sc.fast_minutes === v ? 'selected' : ''}>${t}</option>`)}</select></label>
    <div class="row s" style="gap:8px"><span style="font-weight:600">Quick checks between</span>${hour('from', sc.from)}<span>and</span>${hour('to', sc.to)}<span class="m">Same time twice means all day.</span></div>
    <div class="row"><button class="btn p">Save</button></div></form>`;
}

function panel(d) {
  const ext = d.ext;
  const addr = (name, a) => html`<span class="row" style="gap:6px"><code class="s" style="background:var(--s2);padding:3px 7px;border-radius:6px">${a}</code><button type="button" class="btn sm" data-act="copytext" data-text="${a}" title="Copies the address. Paste it into the address bar of ${name}; a page cannot open it for you.">Copy</button></span>`;
  return html`<div class="grid2" style="align-items:start"><div class="card col" style="gap:10px" data-set="panel"><div class="row"><h3 class="grow">Browser side panel</h3><span class="chip ${ext.paired_at ? 'good' : ''}">${ext.paired_at ? 'Connected' : 'Not connected'}</span></div>
      <p class="s m">Sits beside a posting or an application form in Chrome or Edge: shows your fit, attaches your documents and fills in answers. You read the form and press Submit yourself; the side panel never does.</p>
      ${d.ext_pending ? html`<div class="card" style="border-color:var(--accent);background:var(--accent-soft)"><p class="s"><b>A side panel is asking to connect.</b> It shows the code <b style="font-size:16px;letter-spacing:.08em">${d.ext_pending}</b>. Approve only if the Job Hunt side panel in your browser shows the same code.</p><div class="row" style="margin-top:8px"><button class="btn p sm" data-act="pair">Approve</button></div></div>` : ''}
      ${ext.paired_at ? html`<div class="row"><span class="xs m grow">Connected ${rel(ext.paired_at)} · code ${ext.code}</span><button class="btn sm" data-act="unpair">Disconnect</button></div>` : ''}</div>
    <div class="card col" style="gap:12px"><h3>${ext.paired_at ? 'Putting it in another browser' : 'Getting it'}</h3>
      <div class="s"><b>1. Have the folder.</b> ${d.ext_dir ? html`It came with Job Hunt and is already on this computer:<div class="row" style="gap:6px;margin-top:5px;flex-wrap:wrap"><code class="s" style="background:var(--s2);padding:3px 7px;border-radius:6px;word-break:break-all">${d.ext_dir}</code><button type="button" class="btn sm" data-act="copytext" data-text="${d.ext_dir}">Copy</button><button type="button" class="btn sm" data-act="openfolder" data-what="extension">Open the folder</button></div><div class="xs m" style="margin-top:5px">Or <a href="/extension.zip" download>download it as a zip</a> for another computer.</div>` : html`<div class="row" style="margin-top:5px"><a class="btn p" href="/extension.zip" download>Download the side panel</a></div><div class="xs m" style="margin-top:5px">Unpack the zip somewhere it can stay, such as Documents. The browser reads it from there every time.</div>`}</div>
      <div class="s"><b>2. Open your browser's extensions page.</b><div class="row" style="gap:14px;margin-top:5px;flex-wrap:wrap">${addr('Chrome', 'chrome://extensions')}${addr('Edge', 'edge://extensions')}</div></div>
      <div class="s"><b>3. Switch on "Developer mode"</b>, press <b>Load unpacked</b> and pick the folder from step 1.</div>
      <div class="s"><b>4. Open the side panel</b> by pressing the Job Hunt icon in the browser's toolbar (pin it from the puzzle-piece menu). It shows a code.</div>
      <div class="s"><b>5. Come back to this page</b> and press Approve when the same code appears here.</div>
      <p class="xs m">After a Job Hunt update, press the round-arrow "Reload" on the extensions page so the side panel is the new version too.</p></div></div>`;
}

const THEMES = [['light', 'Light', 'Light pages, as Job Hunt has always looked.'], ['dark', 'Dark', 'Dark pages, easier on the eyes at night.'], ['system', 'Match Windows', 'Follows the light or dark setting of this computer, and changes with it.']];
function looks() {
  const cur = app.state.theme || 'light';
  return html`<div class="card row wrap" style="gap:12px" data-set="theme"><div class="grow" style="min-width:200px"><h4>How it looks</h4><p class="xs m" style="margin-top:3px">Remembered on this computer. Fit colours mean the same in both: green from 80, amber from 60, red below.</p></div>
    <div class="seg" role="group" aria-label="Light or dark">${THEMES.map(([k, v, tip]) => html`<button type="button" class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k ? 'true' : 'false'}" data-act="theme" data-theme="${k}" title="${tip}">${v}</button>`)}</div></div>`;
}

const bytes = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const COPIES = 7;
// The saved copies of the data, and putting one back.
function copies(b, route) {
  if (!b) return '';
  const all = b.copies || [], pages = Math.max(1, Math.ceil(all.length / COPIES)), page = Math.max(1, Math.min(+route.q.copies || 1, pages));
  const shown = all.slice((page - 1) * COPIES, page * COPIES), st = b.staged;
  return html`<div class="card col" style="gap:10px;padding-bottom:14px" data-set="copies"><div class="row"><div class="grow"><h4>Saved copies</h4><p class="xs m" style="margin-top:3px">A copy of all your data is saved every day and the newest ${b.keep} are kept.</p></div>
      <button class="btn sm" data-act="backup" title="Saves a copy of all your data now, as today's copy.">Save a copy now</button></div>
    ${st ? html`<div class="s" style="background:var(--warn-soft);padding:10px 12px;border-radius:8px"><b>The copy from ${st.at ? exact(st.at) : 'earlier'} is ready to be put back.</b> It takes the place of your data the next time Job Hunt starts. What you have now is saved first, as a copy of its own.
        <div class="row wrap" style="margin-top:8px;gap:8px">${b.can_restart ? html`<button class="btn sm p" data-act="restart" data-confirm="Restart Job Hunt now? It stops for a few seconds, puts the copy back and comes back by itself.">Restart Job Hunt now</button>` : html`<span class="xs"><b>Stop Job Hunt</b> with the button above, then start it again from the Start menu.</span>`}<button class="btn sm" data-act="cancelrestore" title="Forgets the copy that was waiting. Your data stays as it is.">Don't put it back</button></div></div>` : ''}
    ${all.length ? html`<table class="tbl" style="margin:0 -6px;width:calc(100% + 12px)"><thead><tr><th>Saved</th><th>What</th><th>Size</th><th></th></tr></thead><tbody>
      ${shown.map(c => html`<tr><td class="s" style="white-space:nowrap" title="${exact(c.at)}"><b>${new Date(c.at * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b> <span class="m">${new Date(c.at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></td><td class="s m" title="${c.name}">${c.before ? 'Before a restore' : 'Daily copy'}</td><td class="s m" style="white-space:nowrap">${bytes(c.size)}</td>
        <td style="text-align:right">${st && st.name === c.name ? html`<span class="chip warn">Waiting</span>` : html`<button class="btn sm" data-act="restore" data-name="${c.name}" data-busy="Checking…" data-confirm="Put back the copy from ${exact(c.at)}?\n\nEverything added or changed since then is replaced. What you have now is saved first, as a copy of its own, so you can come back to it.\n\nNothing changes until Job Hunt next starts." title="Checks this copy and gets it ready. It takes the place of your data when Job Hunt next starts; what you have now is saved first.">Restore this copy</button>`}</td></tr>`)}</tbody></table>
      ${all.length > COPIES ? html`<div class="pager s" style="padding-top:0"><span class="m">${(page - 1) * COPIES + 1}–${Math.min(page * COPIES, all.length)} of ${all.length}</span>${page > 1 ? html`<a class="btn sm" href="${with_(route, { copies: page - 1, hl: '' })}">Previous</a>` : html`<span class="btn sm" disabled>Previous</span>`}${page < pages ? html`<a class="btn sm" href="${with_(route, { copies: page + 1, hl: '' })}">Next</a>` : html`<span class="btn sm" disabled>Next</span>`}</div>` : ''}`
      : html`<p class="s m">No copies yet. The first is saved within a day, or press Save a copy now.</p>`}
    <div class="hr"></div>
    <div class="col" style="gap:6px" data-set="cloud"><h4>On another computer, or safe if this one breaks</h4>
      <p class="xs m">Keep the copies inside a cloud drive's folder and the drive's own program carries them off this computer. On another computer, install Job Hunt, point "Where copies are kept" at the same folder and restore the newest copy. Use Job Hunt on one computer at a time: two running at once would each overwrite the other's copy.</p>
      ${(b.cloud || []).length ? html`<div class="row wrap">${b.cloud.map(c => c.used ? html`<span class="chip good" title="${c.dir}">Copies are kept in ${c.name}</span>` : html`<button class="btn sm" data-act="cloudcopies" data-dir="${c.dir}" title="Makes the folder ${c.dir} and keeps the copies there, refreshed every three hours.">Keep copies in ${c.name}</button>`)}</div>`
        : html`<p class="xs m">No Google Drive, OneDrive or Dropbox folder was found on this computer. Install Google Drive for desktop (or OneDrive) and come back, or paste any folder below.</p>`}</div>
    <div class="hr"></div>
    <form data-act="savebackups" class="col" style="gap:8px"><div class="grid2" style="grid-template-columns:minmax(0,1fr) 150px"><label class="field">Where copies are kept <span class="h">The whole path of a folder that is already there, such as one on another drive. Leave empty for the data folder.</span><input type="text" name="dir" value="${b.custom ? b.dir : ''}" placeholder="${b.default_dir}" autocomplete="off" spellcheck="false"></label>
      <label class="field">Keep the newest<select name="keep">${[7, 14, 30].map(n => html`<option value="${n}" ${b.keep === n ? 'selected' : ''}>${n} copies</option>`)}</select></label></div>
      <div class="row wrap"><button class="btn sm p">Save</button><button type="button" class="btn sm" data-act="openfolder" data-what="backups" title="Opens the folder the copies are in.">Open the folder</button><span class="xs m grow" style="word-break:break-all">Now in ${b.dir}</span></div></form></div>`;
}

function theApp(d, route) {
  const st = app.state;
  return html`<div class="grid2" style="align-items:start"><div class="col" style="gap:14px">
    <div class="card col" style="gap:8px" data-set="version"><div class="row"><h3 class="grow">Job Hunt ${d.version}</h3><button class="btn sm" data-act="checkupdate" data-busy="Looking…" title="Asks now whether a newer version has been published.">Check for a newer version</button></div>
      ${d.update ? html`<div class="s" style="background:var(--accent-soft);padding:9px 11px;border-radius:8px"><div class="row"><b class="grow">Version ${d.update.version} is ready.</b>${st.can_install ? html`<button class="btn sm p" data-update title="Downloads it, checks it is the file that was published, installs it and starts Job Hunt again. About a minute. Your data stays.">Install now</button>` : html`<a class="btn sm p" href="${d.update.url}">Download the installer</a>`}</div>
        ${st.can_install ? '' : html`<p class="xs m" style="margin-top:4px">This copy wasn't put here by the installer, so it can't replace itself. Run the installer; your data stays.</p>`}
        ${d.update.notes ? html`<details style="margin-top:6px"><summary class="xs">What changes</summary><div class="news xs" style="margin-top:4px">${d.update.notes.split('\n').filter(l => l.trim()).slice(0, 14).map(l => html`<div>${l.replace(/\*\*/g, '')}</div>`)}</div></details>` : ''}</div>`
        : html`<p class="s m">This is the newest version${st.update_checked ? html` · looked ${rel(st.update_checked)}` : ''}.</p>`}
      <label class="row s" style="gap:8px;cursor:pointer"><input type="checkbox" data-on="change" data-act="autoupdate" ${st.auto_update ? 'checked' : ''} style="width:15px;height:15px"><span><b>Install new versions by themselves</b> <span class="m">Job Hunt looks every few hours, installs when it isn't in the middle of something, and tells you what changed.</span></span></label>
      <p class="s m">Everything is kept in one folder on this computer:</p><code class="s" style="background:var(--s2);padding:6px 9px;border-radius:7px;word-break:break-all">${d.dir}</code>
      <p class="s m">Job Hunt keeps searching while its window is closed; start it again from the Start menu to bring the window back.</p>
      <div class="row"><span class="grow"></span><button class="btn danger" data-act="quit" data-confirm="Stop Job Hunt? Searching stops until you start it again.">Stop Job Hunt</button></div></div>
    ${looks()}${copies(d.backups, route)}
    ${d.history?.length ? html`<div class="card col" style="gap:6px"><h4>What changed in each version</h4>${d.history.slice(0, 3).map(h => html`<details ${h.version === d.version ? 'open' : ''}><summary class="s">${h.version}${h.version === d.version ? ' · this one' : ''}</summary><div class="news" style="margin-top:6px"><ul>${h.text.split('\n').filter(l => l.trim()).map(l => html`<li>${l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}</li>`)}</ul></div></details>`)}
      ${d.history.length > 3 ? html`<details><summary class="s">Earlier versions (${d.history.length - 3})</summary>${d.history.slice(3).map(h => html`<div class="news" style="margin-top:8px"><h4>${h.version}</h4><ul>${h.text.split('\n').filter(l => l.trim()).map(l => html`<li>${l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}</li>`)}</ul></div>`)}</details>` : ''}</div>` : ''}
    ${d.old ? oldCard(d.old, false) : ''}
    ${d.problems?.length ? html`<div class="card"><h4>Recent problems</h4><div class="col s" style="margin-top:10px;gap:8px">${d.problems.map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:70px;flex:none">${rel(a.at)}</span><span>${a.text}</span></div>`)}</div></div>` : ''}
    ${d.debug ? html`<div class="card col" style="gap:8px" data-set="debug"><div class="row"><h4 class="grow">Debugging</h4><button class="btn sm p" data-act="copydebug" title="Copies the report below so you can paste it when reporting a problem. It leaves out your name, e-mail addresses and keys.">Copy debug details</button><a class="btn sm" href="/api/debug/report" download title="Saves a longer report (the newest 4,000 lines) as a text file.">Save as a file</a><button class="btn sm" data-act="openfolder" data-what="data" title="Opens the folder that holds your data and debug.log.">Open the folder</button></div>
      <p class="xs m">Job Hunt writes down everything it does: each search and page it fetches, each call to Claude, each background job, each error in the program or in a page. Your name, e-mail addresses and keys are left out. The file is debug.log in your data folder.</p>
      <pre class="xs" style="margin:0;background:var(--s2);border-radius:8px;padding:9px 10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;line-height:1.45">${d.debug.report.split('\n').slice(-45).join('\n')}</pre>
      <p class="xs m">The newest 45 lines. Copy or save for the rest.</p></div>` : ''}
  </div><div class="col" style="gap:14px">
    <div class="card" data-set="calls"><h4>Claude, lately</h4><p class="xs m" style="margin-top:3px">${d.today.calls} calls in the last day, ${d.week.calls} this week${d.week.cost ? html` · $${d.week.cost.toFixed(2)}` : ''}${d.week.errors ? html` · ${d.week.errors} failed` : ''}</p>
      <table class="tbl" style="margin-top:8px"><tbody>${(d.calls || []).map(c => html`<tr><td class="xs m" style="white-space:nowrap">${when(c.at)}</td><td class="s">${c.task.replace(/_/g, ' ')}</td><td class="xs m">${(c.ms / 1000).toFixed(1)} s</td><td class="xs" style="color:var(--crit)">${c.error ? c.error.slice(0, 80) : ''}</td></tr>`)}</tbody></table></div>
    ${d.changes?.length ? html`<div class="card"><h4>Changes Job Hunt made to your settings</h4><div class="col s" style="margin-top:10px;gap:8px">${d.changes.map(c => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:70px;flex:none">${rel(c.at)}</span><span class="grow">${c.what} <span class="m">· ${c.why}</span></span></div>`)}</div></div>` : ''}
  </div></div>`;
}

export default {
  title: 'You',
  sub: (d, route) => ({ '': 'What Job Hunt knows and looks for', arriving: 'Closing the gap for a newcomer', connections: 'Claude, more job sources, your phone, your inbox, this computer, and when to search', panel: 'Get it, put it in your browser, connect it', app: 'Version, your data, and what Job Hunt has been doing' })[route.parts[1] || ''],
  topics: ['you', 'profile', 'connections', 'app'],
  load(route) {
    switch (route.parts[1] || '') {
      case 'arriving': return api('arriving');
      case 'panel': return api('connections');
      case 'connections': return Promise.all([api('connections'), api('phoneaccess').catch(() => null), api('owncal').catch(() => null)]).then(([c, pa, oc]) => ({ ...c, phoneaccess: pa, owncal: oc }));
      case 'app': return Promise.all([api('app'), api('import/old').catch(() => null), api('debug').catch(() => null), api('changes').catch(() => []), api('backups').catch(() => null)]).then(([a, o, g, h, b]) => ({ ...a, old: o, debug: g, history: h, backups: b }));
    }
    return api('you');
  },
  view(d, route) {
    const tab = route.parts[1] || '';
    return html`<div class="body"><div class="tabs">${TABS.map(([k, v]) => html`<a class="${k === tab ? 'on' : ''}" href="#/you${k ? '/' + k : ''}">${v}</a>`)}
        <div class="setfind"><input type="text" id="setfind" placeholder="Find a setting" aria-label="Find a setting" autocomplete="off" title="Type what you are looking for, such as dark, salary, backup or phone. Enter opens the first match."><div class="found" id="setfound" hidden></div></div></div>
      ${tab === 'arriving' ? arriving(d) : tab === 'connections' ? connections(d) : tab === 'panel' ? panel(d) : tab === 'app' ? theApp(d, route) : about(d)}</div>`;
  },
  // A setting found through the search box is brought into view and marked, once.
  after(root, d, route) {
    if (!route.q.hl || route.hlDone) return;
    route.hlDone = true;
    const hit = SETTINGS.find(x => x.id === route.q.hl);
    const card = hit && root.querySelector(`[data-set="${hit.set}"]`);
    if (!card) return;
    const el = (hit.field && card.querySelector(`[name="${hit.field}"]`)?.closest('label')) || card;
    root.querySelectorAll('.hl').forEach(x => x.classList.remove('hl'));
    el.classList.add('hl');
    el.scrollIntoView({ block: 'center' });
    history.replaceState(null, '', location.hash.replace(/[?&]hl=[^&]*/, ''));
    setTimeout(() => el.classList.remove('hl'), 6000);
  },
  actions: {
    ...oldActions,
    async theme({ d }) { await put('theme', { theme: d.theme }); app.state.theme = d.theme; applyTheme(d.theme); },
    savebackups: ({ f }) => put('backups', { dir: f.dir.trim(), keep: +f.keep }).then(b => toast(`Saved. Copies go to ${b.dir}; the newest ${b.keep} are kept.`)),
    restore: ({ d }) => post('backups/restore', { name: d.name }).then(b => toast(b.can_restart ? 'Ready. It is put back when Job Hunt restarts: press Restart Job Hunt now.' : 'Ready. Stop Job Hunt and start it again to put it back.')),
    cancelrestore: () => del('backups/restore').then(() => toast('Nothing will be put back. Your data stays as it is.')),
    async restart() {
      await post('restart');
      document.body.innerHTML = '<div class="setup"><div class="card empty"><span class="spin" style="display:inline-block"></span><h3 style="margin-top:10px">Job Hunt is restarting</h3><p>A few seconds. This page comes back by itself.</p></div></div>';
      // Wait for it to go, then for it to answer again.
      const began = Date.now();
      let gone = false;
      const look = async () => {
        let up = false;
        try { up = (await fetch('/api/state', { cache: 'no-store' })).ok; } catch { up = false; }
        if (!up) gone = true;
        if (up && (gone || Date.now() - began > 6000)) { location.hash = '#/you/app'; location.reload(); return; }
        if (Date.now() - began > 60000) { document.body.innerHTML = '<div class="setup"><div class="card empty"><h3>Job Hunt did not come back</h3><p>Start it again from the Start menu. A copy that was waiting is put back then.</p></div></div>'; return; }
        setTimeout(look, 700);
      };
      setTimeout(look, 900);
      return false;
    },
    async checkupdate() { const r = await post('update/check'); toast(r.update ? `Version ${r.update.version} is ready` : 'This is the newest version'); },
    autoupdate: ({ value }) => put('update', { auto: value }).then(() => toast(value ? 'New versions install by themselves' : 'Job Hunt will only tell you about new versions')),
    async savedesk({ f, data }) {
      await put('desk', { notify: !!f.notify, awake: f.awake, morning: +f.morning });
      if (data.startup?.can && !!f.startup !== !!data.startup.on) await put('startup', { on: !!f.startup });
      toast('Saved');
    },
    testdesk: () => post('desk/test').then(() => { toast('Sent. It shows by the clock.'); return false; }),
    async saveschedule({ f }) {
      const full = f.full.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).map(t => { const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t); if (!m) throw new Error(`"${t}" isn't a time. Write times like 07:00 or 17:30.`); let h = +m[1]; if (/pm/i.test(m[3] || '') && h < 12) h += 12; if (/am/i.test(m[3] || '') && h === 12) h = 0; return h * 60 + +(m[2] || 0); });
      await put('schedule', { full, fast_minutes: +f.fast_minutes, from: +f.from, to: +f.to });
      toast('Saved. The next searches follow this.');
    },
    async saveprofile({ f }) {
      const wp = ['remote', 'hybrid', 'onsite'].filter(w => f['wp_' + w]);
      await put('profile', { name: f.name, headline: f.headline, rare: f.rare, city: f.city, places: lines(f.places), country: f.country, home: f.home, arrive_on: f.arrive_on, work_status: f.work_status, pay_floor: +f.pay_floor || 0,
        start_early: !!f.start_early, titles: { level: lines(f.level), step_up: lines(f.step_up), sideways: lines(f.sideways) }, domain: lines(f.domain), avoid: lines(f.avoid), workplaces: wp.length === 3 ? [] : wp, may_prepare: f.may_prepare,
        letter_style: f.letter_style, signature: f.signature, chase_days: Math.max(0, +f.chase_days || 0), weekly_goal: Math.max(0, Math.round(+f.weekly_goal) || 0),
        pay_strict: !!f.pay_strict, max_age_days: +f.max_age_days || 0, no_types: ['contract', 'part-time', 'internship'].filter(k => f['no_' + k]) });
      toast('Saved. The next search uses this.');
    },
    async addcv({ el }) { const file = el.files[0]; if (!file) return false; toast('Reading your CV. About a minute.'); await api('cvs?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file }); toast('CV added'); },
    delcv: ({ d }) => del(`cvs/${d.id}`),
    addfact: ({ f, el }) => post('facts', { text: f.text }).then(() => el.reset()),
    delfact: ({ d }) => del(`facts/${d.id}`),
    delanswer: ({ d }) => del(`answers/${d.id}`),
    build: () => post('arriving').then(() => toast('Writing your arrival pack. About a minute.')),
    toggle: ({ d }) => post('arriving/change', { index: +d.i, off: !!d.off }),
    apply: () => post('arriving/apply').then(() => toast('A copy of your CV in local form was added under You')),
    async savellm({ f }) {
      if (!f.engine) throw new Error('Choose how to reach Claude.');
      await put('llm', { engine: f.engine, key: f.key || '', model: f.model, daily_limit: +f.daily_limit || 0 });
      toast('Saved');
    },
    async testllm() { const r = await post('llm/test'); toast(r.message); return false; },
    async phoneon({ el }) { await put('phoneaccess', { on: el.checked }); toast(el.checked ? 'On. Now add a phone.' : 'Off. No phone can connect.'); },
    async phonecode({ d }) {
      const r = await post('phoneaccess/code', { kind: d.kind });
      const box = document.getElementById('phonecode');
      box.innerHTML = '';
      const img = new Image(220, 220); img.alt = 'A code for your phone\'s camera'; img.src = 'data:image/svg+xml;base64,' + btoa(r.qr); img.style.cssText = 'border-radius:10px;border:1px solid var(--line);background:#fff';
      const p = document.createElement('p'); p.className = 'xs m'; p.style.marginTop = '6px';
      p.textContent = `Point your phone's camera at this and open the link it shows. It works once, for the next ${r.minutes} minutes. Afterwards the phone opens Job Hunt at ${r.address}`;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.style.marginTop = '6px'; b.textContent = 'Copy the link instead';
      b.title = 'For when the camera won\'t read the code: send the link to your phone yourself and open it there.';
      b.addEventListener('click', () => copy(r.link));
      box.append(img, p, b);
      return false;
    },
    phoneforget: ({ d }) => del('phoneaccess/devices/' + d.id).then(() => toast('Removed')),
    async savecal({ f }) { await put('owncal', { url: f.url }); toast('Connected. Your entries are on the month under Interviews.'); },
    forgetcal: () => del('owncal').then(() => toast('Disconnected')),
    copyfree: ({ d }) => copy(d.text).then(() => false),
    cloudcopies: ({ d }) => post('backups/cloud', { dir: d.dir }).then(() => toast('Copies are kept there from now on. One was saved just now.')),
    savephone: ({ f }) => put('phone', { on: !!f.on, topic: f.topic, server: f.server, min_fit: +f.min_fit || 75, quiet_from: +f.quiet_from || 0, quiet_to: +f.quiet_to || 0, detail: !!f.detail, only: f.only || '' }).then(() => toast('Saved')),
    newtopic({ el }) { const a = new Uint8Array(12); crypto.getRandomValues(a); el.closest('form').querySelector('[name=topic]').value = 'jobhunt-' + [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); return false; },
    async testphone() { await post('phone/test'); toast('Sent. It should arrive on your phone in a few seconds.'); return false; },
    savesource: ({ f, d }) => put(`sources/${d.id}`, d.id === 'alerts' ? { on: !!f.on } : { app_id: (f.app_id || '').trim(), key: (f.key || '').trim(), from: f.from || '', on: !!f.on, limit: +f.limit || 0 }).then(() => toast('Saved')),
    async testsource({ d }) { const r = await post(`sources/${d.id}/test`); toast(r.message); },
    delsource: ({ d }) => del(`sources/${d.id}`).then(() => toast('Key removed')),
    savemail: ({ f }) => put('mailset', { on: !!f.on, user: f.user, pass: f.pass || '', host: f.host, every: Math.min(240, Math.max(5, +f.every || 10)) }).then(() => toast(f.on ? 'Connected. Job Hunt is reading recent replies.' : 'Saved')),
    copytext: ({ d }) => copy(d.text).then(() => false),
    copydebug: () => api('debug').then(g => copy(g.report)).then(() => false),
    openfolder: ({ d }) => post('open-folder', { what: d.what }).then(() => false),
    pair: () => post('ext/pair').then(() => toast('The side panel is connected')),
    unpair: () => post('ext/unpair'),
    async backup() { const r = await post('backup'); toast('Saved to ' + r.path); return false; },
    async quit() { await post('quit'); document.body.innerHTML = '<div class="setup"><div class="card empty"><h3>Job Hunt has stopped</h3><p>Start it again from the Start menu.</p></div></div>'; return false; },
  },
};
