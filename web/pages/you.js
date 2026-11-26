import { html, api, post, put, del, when, toast, copy, app, rel, exact, ago, with_, applyTheme, listSize, endless, carryOn } from '../app.js';
import { oldCard, oldActions } from '../old.js';

const TABS = [['', 'About you'], ['arriving', 'Arriving']];
// Settings has its own page, with a menu down the side.
const SECTIONS = [['connections', 'Connections', 'Claude, job sources, phone, inbox, calendar, this computer, when to search'], ['panel', 'Browser side panel', 'Fills application forms in your browser'], ['app', 'The app', 'Version, updates, look, copies and files'], ['debug', 'Debugging', 'The record to send with a problem, and what Claude did']];
const inSettings = tab => SECTIONS.some(x => x[0] === tab);
export const placeOf = tab => inSettings(tab) ? `#/settings/${tab}` : `#/you${tab ? '/' + tab : ''}`;
const lines = s => (s || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
// Titles are one per line and may hold a comma: "Director, Tax Technology".
const titleLines = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
const WORK = { '': 'Not said yet', citizen: 'Yes, as a citizen', resident: 'Yes, as a permanent resident', permit: 'Yes, on a work permit', none: 'Not yet' };

// What the "Find a setting" box knows: where each setting lives and the words
// people use for it. set names the card (data-set); field, the input inside it.
const SETTINGS = [
  ['', 'profile', 'name', 'Your name and how you describe yourself', 'name headline title describe'],
  ['', 'profile', 'rare', 'The one thing few other applicants have', 'rare strength lead unique'],
  ['', 'profile', 'city', 'City, country and where you live now', 'city country town location place toronto home live'],
  ['', 'profile', 'places', 'Other places to search', 'nearby places area towns cities commute region several more'],
  ['', 'profile', 'arrive_on', 'Arrival date', 'arrive arrival landing date move moving relocate'],
  ['', 'profile', 'work_status', 'Allowed to work', 'work permit visa citizen resident status authorization authorisation sponsorship'],
  ['', 'profile', 'pay_floor', 'Lowest yearly salary', 'salary pay floor minimum money wage compensation'],
  ['', 'profile', 'level', 'Job titles to look for', 'titles search look for level step up sideways roles keywords'],
  ['', 'profile', 'domain', 'Words that mark your field', 'field domain words keywords'],
  ['', 'profile', 'avoid', 'Never show: titles or employers', 'never show avoid block hide exclude employers mute'],
  ['', 'profile', 'wp_remote', 'Ways of working: remote, hybrid, on site', 'remote hybrid onsite on site office work from home'],
  ['', 'profile', 'max_age_days', 'Hard limits: age of posting, pay, contract, part-time', 'hard limits old postings age contract part-time internship strict'],
  ['', 'profile', 'keep_fit', 'Fit score a role needs, and when documents are written', 'fit score needed threshold tailor automatically strong fits all limit per search most tailored scored'],
  ['', 'profile', 'matters', 'What matters to you in a job', 'matters priorities preferences values what i want'],
  ['', 'profile', 'seniority', 'What you want: level, permanent or contract, industries, deal-breakers, career path', 'level seniority permanent contract industry industries sector deal-breakers dealbreakers career path on path off path want'],
  ['', 'profile', 'may_prepare', 'When a strong role appears: write straight away or ask', 'prepare automatically ask before writing tailor auto'],
  ['', 'cvs', '', 'Your CVs', 'cv resume résumé upload add file word pdf'],
  ['', 'facts', '', 'What Job Hunt knows about you', 'facts know about me remember forget'],
  ['', 'answers', '', 'Answers saved for forms', 'answers forms questions saved application'],
  ['arriving', '', '', 'Arriving: your CV in local form', 'arriving arrival pack newcomer local cv terms'],
  ['connections', 'claude', '', 'Claude: subscription, API key, model', 'claude api key model subscription sign in connect anthropic ai'],
  ['connections', 'claude', 'daily_limit', 'Daily spending limit', 'limit budget spend cost dollars money cap'],
  ['connections', 'claude', 'score_model', 'A model for each kind of work, effort, four postings per request', 'model scoring reading tailoring writing effort grouped batch cheaper haiku sonnet opus'],
  ['connections', 'otherai', '', 'Another AI: ChatGPT, Grok, Gemini, OpenRouter or a model on this computer', 'another other ai openai chatgpt gpt grok xai gemini groq openrouter ollama lm studio local model llm'],
  ['connections', 'vpn', '', 'VPN for blocked sources', 'vpn proton wireguard blocked country geoblock geoblocked adzuna region'],
  ['connections', 'phone', '', 'Phone notices', 'phone ntfy notice notification push buzz mobile topic quiet hours'],
  ['connections', 'phoneaccess', '', 'Job Hunt on your phone', 'phone mobile access remote browser wifi tailscale away qr code pair'],
  ['connections', 'owncal', 'talkset', 'When you can do interviews', 'interview hours availability times to offer length slots time zone'],
  ['connections', 'owncal', '', 'Your Google Calendar', 'google calendar sync busy free times outlook icloud ical ics availability'],
  ['connections', 'google', '', 'Google Calendar, both ways: sign in', 'google calendar sign in signin oauth client id secret cloud console two-way both ways sync push interviews prep block link to application'],
  ['app', 'cloud', '', 'Copies in Google Drive or OneDrive', 'sync google drive onedrive dropbox cloud another computer second pc laptop move'],
  ['connections', 'mail', '', 'Your inbox', 'inbox mail email e-mail gmail imap app password replies'],
  ['connections', 'desk', 'notify', 'Windows notifications', 'notification windows toast alert desktop popup'],
  ['connections', 'desk', 'awake', 'Keep this computer awake', 'awake sleep power standby'],
  ['connections', 'desk', 'morning', 'Morning summary and reminders', 'morning summary reminder remind interview tomorrow closing weekly review thank you'],
  ['connections', 'desk', 'startup', 'Start with Windows', 'start startup sign in boot login autostart windows'],
  ['connections', 'phone', 'detail', 'What phone notices say', 'private privacy urgent only interviews offers names employer'],
  ['connections', 'tidy', '', 'Employee ratings, setting aside old roles, budget mode', 'rating ratings stars glassdoor reviews employees skip below old roles clear tidy 30 60 90 days budget night cheap batch'],
  ['connections', 'schedule', '', 'When Job Hunt searches', 'schedule search times when how often quick check full search hours frequency'],
  ['panel', 'panel', '', 'Browser side panel', 'side panel extension browser chrome edge fill forms pair connect'],
  ['app', 'theme', '', 'Light or dark', 'dark light theme colour color night mode appearance look match windows'],
  ['app', 'copies', '', 'Saved copies: restore one', 'backup backups copy copies restore put back recover undo lost'],
  ['app', 'copies', 'dir', 'Where copies are kept', 'backup folder where location drive path onedrive usb'],
  ['app', 'copies', 'keep', 'How many copies are kept', 'backup keep how many 7 14 30 days'],
  ['connections', 'desk', 'wake', 'Wake this computer for searches', 'wake sleep timer power standby night'],
  ['connections', 'desk', 'browser', 'Browser that links open in', 'browser chrome edge firefox brave links open default'],
  ['connections', 'claude', '', 'Install Claude Code and sign in', 'claude code install sign in login subscription cli'],
  ['panel', 'bookmark', '', 'Bookmark button and copied job links', 'bookmarklet bookmark clipboard copy link firefox safari without extension'],
  ['app', 'files', 'dir', 'Folder for your CVs and letters as files', 'files folder documents word pdf tailored show files cv letter'],
  ['app', 'version', '', 'Version and updates', 'version update upgrade new install automatic auto-update check'],
  ['app', 'version', '', 'Your data folder', 'data folder files where stored directory'],
  ['app', 'version', '', 'Stop Job Hunt', 'stop quit exit close shut down'],
  ['debug', 'debug', '', 'Debugging record', 'debug log report problem error bug support'],
  ['debug', 'calls', '', 'Claude, lately: calls and cost', 'usage calls cost spent tokens'],
].map(([tab, set, field, label, words], i) => ({ id: 's' + i, tab, set, field, label, hay: (label + ' ' + words).toLowerCase() }));

function findSettings(text) {
  const want = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!want.length) return [];
  return SETTINGS.filter(x => want.every(w => x.hay.includes(w))).slice(0, 8);
}
const tabName = k => ([...TABS, ...SECTIONS].find(t => t[0] === k) || TABS[0])[1];
function drawFound(box, text) {
  const hits = findSettings(text);
  box.innerHTML = (hits.length ? html`${hits.map(x => html`<a href="${placeOf(x.tab)}?hl=${x.id}"><b>${x.label}</b> <span class="m">· ${tabName(x.tab)}</span></a>`)}` : html`<div class="s m" style="padding:10px">No setting matches “${text}”.</div>`).s;
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

// Which group of About you holds a field the settings search points at.
const GROUP_OF = { name: 'me', rare: 'me', city: 'me', places: 'me', arrive_on: 'me', work_status: 'me', pay_floor: 'me', level: 'look', domain: 'look', avoid: 'look', wp_remote: 'look', max_age_days: 'limits', matters: 'matters', seniority: 'wants', letter_style: 'letters', keep_fit: 'auto', may_prepare: 'auto' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const longDay = s => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const SEN = { mid: 'Mid-level', senior: 'Senior', lead: 'Team lead', manager: 'Manager', director: 'Director', executive: 'Executive' };
const LETTER = { standard: 'Standard', formal: 'Formal', short: 'Short and direct', warm: 'Warm' };

// One CV's own controls: what it is for, its letter style, a new file in its
// place, whether a screening system reads it, and what Claude read from it.
const moreTitles = new Map();
function cvControls(k, count) {
  const set = k.set || {}, m = k.model || {}, more = moreTitles.get(k.cv.id) || [];
  const item = it => [it.heading, it.org, it.dates].filter(Boolean).join(' · ');
  return html`<div class="col" style="gap:12px;border-top:1px solid var(--line2);padding-top:10px">
    ${k.redoing ? html`<p class="s" style="background:var(--accent-soft);padding:8px 10px;border-radius:8px"><span class="spin" style="width:10px;height:10px;display:inline-block"></span> Scoring and writing again the roles that use a changed CV. Your own edits are kept.</p>`
      : k.waiting ? html`<p class="xs m">${k.waiting} role${k.waiting === 1 ? '' : 's'} waiting to be sent use this CV. If you replace or remove it, they are scored and written again, with your own edits kept.</p>` : ''}
    <form data-act="savecv" data-id="${k.cv.id}" class="col" style="gap:10px">
      <label class="field">Name<input type="text" name="name" value="${k.cv.name}"></label>
      <label class="field">Job titles it is for <span class="h">One per line. Each is added to the titles Job Hunt looks for.</span><textarea name="titles" rows="3">${(set.titles || []).join('\n')}</textarea></label>
      ${more.length ? html`<div class="col" style="gap:6px"><span class="xs m">Titles this CV also suits. Tick the ones to add.</span><div class="row wrap" style="gap:6px">${more.map(t => html`<label class="chip" style="gap:5px;cursor:pointer"><input type="checkbox" name="more" value="${t}" style="margin:0">${t}</label>`)}</div>
        <div class="row" style="gap:8px"><button type="button" class="btn sm" data-act="addtitles" data-id="${k.cv.id}">Add the ticked titles</button><button type="button" class="btn sm ghost" data-act="droptitles" data-id="${k.cv.id}">None of these</button></div></div>` : ''}
      <label class="field">Words it is for <span class="h">Comma-separated. Claude picks this CV for postings that mention them.</span><input type="text" name="keywords" value="${(set.keywords || []).join(', ')}" placeholder="Vertex, SAP, e-invoicing"></label>
      <label class="field">Letter style with this CV<select name="letter_style"><option value="">The one under About you</option>${[['standard', 'Standard'], ['formal', 'Formal: banks, government, law'], ['short', 'Short and direct'], ['warm', 'Warm and personal']].map(([v, x]) => html`<option value="${v}" ${set.letter_style === v ? 'selected' : ''}>${x}</option>`)}</select></label>
      <div class="row wrap" style="gap:8px"><button class="btn sm p">Save</button><button type="button" class="btn sm" data-act="moretitles" data-id="${k.cv.id}" data-busy="Looking…" title="Claude reads this CV and suggests job titles it suits that you don't look for yet. Nothing is added until you tick them.">Find more titles</button>
        <label class="btn sm" title="Reads a new file in place of this one. Its name and settings stay.">Replace file<input type="file" accept=".docx,.pdf,.txt,.md" hidden data-on="change" data-act="replacecv" data-id="${k.cv.id}"></label>
        <span class="grow"></span>${count > 1 ? html`<button type="button" class="btn sm ghost danger" data-act="delcv" data-id="${k.cv.id}" data-confirm="Remove this CV? Roles waiting to be sent that use it are scored and written again from your other CV, with your own edits kept.">Remove</button>` : ''}</div></form>
    ${k.readable ? html`<div><div class="row" style="gap:8px"><h4 class="grow">Will a screening system read it?</h4>${(k.ats || []).some(x => x.bad) ? html`<span class="chip warn">${k.ats.filter(x => x.bad).length} to fix</span>` : html`<span class="chip good">Reads cleanly</span>`}</div>
      <ul class="s ink2" style="margin:6px 0 0 18px">${(k.ats || []).map(x => html`<li style="${x.bad ? 'color:var(--warn)' : ''}">${x.text}</li>`)}</ul>
      <p class="xs m" style="margin-top:4px">About the file Job Hunt writes from this CV. A tailored CV is checked again on each role.</p></div>
    <details><summary class="s" style="cursor:pointer"><b>What Claude read from it</b></summary><div class="col s" style="gap:8px;margin-top:8px">
      <div><b>${m.name}</b>${m.headline ? html` · ${m.headline}` : ''}<div class="xs m">${[m.contact?.email, m.contact?.phone, m.contact?.location].filter(Boolean).join(' · ')}</div></div>
      ${m.summary ? html`<p class="ink2">${m.summary}</p>` : ''}
      ${(m.sections || []).map(sec => html`<div><div class="eb">${sec.title}</div>${sec.kind === 'skills' ? html`<div class="ink2">${(sec.items || []).map(it => [it.heading, it.text, ...(it.bullets || [])].filter(Boolean).join(', ')).join(' · ')}</div>`
        : html`<ul style="margin:2px 0 0 18px">${(sec.items || []).map(it => html`<li>${item(it) || it.text}${(it.bullets || []).length ? html` <span class="m">· ${it.bullets.length} line${it.bullets.length === 1 ? '' : 's'}</span>` : ''}</li>`)}</ul>`}</div>`)}
      <p class="xs m">If something is missing or wrong here, fix it in your file and use Replace file.</p></div></details>` : ''}
  </div>`;
}

function about(d, route) {
  const p = d.profile;
  d.cvs ||= []; d.facts ||= []; d.answers ||= []; p.titles ||= {};
  const hit = route.q.hl && SETTINGS.find(x => x.id === route.q.hl);
  const open = route.q.open || (hit?.set === 'profile' ? GROUP_OF[hit.field] || '' : '');
  const t = p.titles, nt = (t.level || []).length + (t.step_up || []).length + (t.sideways || []).length;
  const wp = !p.workplaces?.length ? ['remote', 'hybrid', 'on site'] : p.workplaces.map(w => (w === 'onsite' ? 'on site' : w));
  const near = (d.area?.length || 0) + (p.places || []).length;
  const types = [['contract', 'contract'], ['part-time', 'part-time'], ['internship', 'internships']];
  const hidden = types.filter(([k]) => (p.no_types || []).includes(k)).map(x => x[1]);
  const limits = [p.max_age_days ? `Postings up to ${p.max_age_days === 1 ? '1 day' : p.max_age_days === 7 ? 'a week' : p.max_age_days === 14 ? '2 weeks' : p.max_age_days === 30 ? 'a month' : p.max_age_days + ' days'} old` : 'Any age of posting',
    hidden.length ? `no ${hidden.join(', ')}` : 'contract, part-time and internships all shown', p.pay_strict && p.pay_floor ? 'nothing under your pay floor' : ''].filter(Boolean);
  const wants = [p.seniority ? SEN[p.seniority] : '', p.terms === 'permanent' ? 'permanent only' : p.terms === 'contract' ? 'contract' : '', p.industries?.length ? `in ${p.industries.join(', ')}` : '',
    p.no_industries?.length ? `not in ${p.no_industries.join(', ')}` : '', p.deal_breakers?.length ? plural(p.deal_breakers.length, 'deal-breaker') : '', p.career_path ? `path: ${p.career_path}` : ''].filter(Boolean);
  const sign = (p.signature || '').split('\n').map(x => x.trim()).filter(Boolean).join(' ');
  const save = html`<div class="row" style="gap:8px;margin-top:4px"><button class="btn sm p">Save</button><a class="btn sm ghost" href="${with_(route, { open: '' })}">Cancel</a></div>`;
  const form = (group, body) => html`<form data-act="saveprofile" data-group="${group}" class="col" style="gap:12px" data-set="profile">${body}${save}</form>`;
  const rows = [
    ['me', 'You', ['', p.name || 'No name yet'], [p.headline, p.city ? `${[p.city, p.country].filter(Boolean).join(', ')}${near ? ` (and ${plural(near, 'nearby place')})` : ''}` : 'No city yet', p.arrive_on ? `arriving ${longDay(p.arrive_on)}` : '', `right to work ${p.work_status ? WORK[p.work_status].replace(/^Yes, /, '').toLowerCase() : 'not said yet'}`, p.pay_floor ? `pay floor ${p.pay_floor.toLocaleString()}` : 'no pay floor'].filter(Boolean).join(' · '),
      form('me', html`<div class="grid2"><label class="field">Name<input type="text" name="name" value="${p.name}"></label><label class="field">How you describe yourself<input type="text" name="headline" value="${p.headline}"></label></div>
      <label class="field">The one thing few other applicants have <span class="h">Job Hunt leads with this.</span><input type="text" name="rare" value="${p.rare}"></label>
      <div class="grid3"><label class="field">City you want to work in<input type="text" name="city" value="${p.city}"></label><label class="field">Country<input type="text" name="country" value="${p.country}"></label><label class="field">Where you live now<input type="text" name="home" value="${p.home}"></label></div>
      <label class="field">Other places to search <span class="h">${d.area?.length ? html`<details style="display:inline"><summary style="display:inline;cursor:pointer;color:var(--accent)">${p.city} already includes ${d.area.length} places</summary> ${d.area.join(', ')}.</details> Add any others here, comma-separated. Each is searched for every title.` : 'Other towns you would work in, comma-separated. Each is searched for every title.'}</span><input type="text" name="places" value="${(p.places || []).join(', ')}" placeholder="${d.area?.length ? 'Hamilton, Guelph' : ''}"></label>
      <div class="grid3"><label class="field">You arrive on <span class="h">Leave empty if you are there.</span><input type="date" name="arrive_on" value="${p.arrive_on}"></label>
        <label class="field">Allowed to work there on arrival<select name="work_status">${Object.entries(WORK).map(([k, v]) => html`<option value="${k}" ${p.work_status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field">Lowest yearly salary<input type="number" name="pay_floor" value="${p.pay_floor || ''}" placeholder="No floor"></label></div>
      <label class="row s" style="font-weight:500"><input type="checkbox" name="start_early" ${p.start_early ? 'checked' : ''}> Open to starting remotely before you arrive</label>`)],
    ['look', 'What to look for', [nt ? 'good' : 'warn', nt ? plural(nt, 'title') : 'No titles'], [`${(t.level || []).length} at your level, ${(t.step_up || []).length} a step up, ${(t.sideways || []).length} sideways`, p.domain?.length ? `field words: ${p.domain.join(', ')}` : '', p.avoid?.length ? `never: ${p.avoid.join(', ')}` : '', wp.join(', ')].filter(Boolean).join(' · '),
      form('look', html`<p class="xs m">One title per line. All three groups are searched equally often. <a href="#/career">Career path</a> can add more.</p>
      <div class="grid3"><label class="field">At your level<textarea name="level" rows="4">${(t.level || []).join('\n')}</textarea></label><label class="field">A step up<textarea name="step_up" rows="4">${(t.step_up || []).join('\n')}</textarea></label><label class="field">Sideways<textarea name="sideways" rows="4">${(t.sideways || []).join('\n')}</textarea></label></div>
      <div class="grid2"><label class="field">Words that mark your field <span class="h">A title with one of these is always read. Comma-separated.</span><input type="text" name="domain" value="${(p.domain || []).join(', ')}"></label>
        <label class="field">Never show <span class="h">Titles or employers. Comma-separated.</span><input type="text" name="avoid" value="${(p.avoid || []).join(', ')}"></label></div>
      <div class="row wrap" style="gap:16px"><span class="s" style="font-weight:600">Ways of working:</span>${['remote', 'hybrid', 'onsite'].map(w => html`<label class="row s" style="gap:5px"><input type="checkbox" name="wp_${w}" ${!p.workplaces?.length || p.workplaces.includes(w) ? 'checked' : ''}> ${w === 'onsite' ? 'On site' : w[0].toUpperCase() + w.slice(1)}</label>`)}</div>`)],
    ['limits', 'Hard limits', p.max_age_days || hidden.length || p.pay_strict ? ['blue', 'On'] : ['', 'None'], limits.join(' · '),
      form('limits', html`<p class="xs m">A posting that breaks one of these is set aside without being read. You can still see them under Roles → Set aside.</p>
      <div class="grid3"><label class="field">Posted no longer ago than<select name="max_age_days">${[[0, 'Any age'], [1, '1 day'], [3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month']].map(([v, x]) => html`<option value="${v}" ${(p.max_age_days || 0) === v ? 'selected' : ''}>${x}</option>`)}</select></label>
        <label class="row s" style="gap:6px;font-weight:500;align-self:end;height:36px"><input type="checkbox" name="pay_strict" ${p.pay_strict ? 'checked' : ''}> Set aside roles that pay under your floor${p.pay_floor ? ` (${p.pay_floor.toLocaleString()})` : ' (set it under You)'}</label></div>
      <div class="row wrap" style="gap:16px"><span class="s" style="font-weight:600">Never show:</span>${[['contract', 'Contract'], ['part-time', 'Part-time'], ['internship', 'Internships']].map(([k, x]) => html`<label class="row s" style="gap:5px"><input type="checkbox" name="no_${k}" ${(p.no_types || []).includes(k) ? 'checked' : ''}> ${x}</label>`)}</div>`)],
    ['matters', 'What matters to you', p.matters ? ['good', 'Written'] : ['warn', 'Not yet'], p.matters ? `“${p.matters.length > 150 ? p.matters.slice(0, 150) + '…' : p.matters}”` : 'In your own words; Claude weighs every role by it',
      form('matters', html`<label class="field">What matters to you in a job <span class="h">In your own words. Claude weighs every role by it.</span><textarea name="matters" rows="3" maxlength="1500" placeholder="A team that ships; no on-call; within 40 minutes by train; a manager who was an accountant.">${p.matters || ''}</textarea></label>`)],
    ['wants', 'What you want', wants.length ? ['good', 'Said'] : ['warn', 'Not yet'], wants.length ? wants.join(' · ') : 'Level, permanent or contract, industries, deal-breakers and your career path; Claude weighs every role by them',
      form('wants', html`<p class="xs m">Claude weighs every role by these when it reads it. A role that clearly has a deal-breaker, or is in an industry you don't want, is set aside with the reason; you can still see it under Roles → Set aside.</p>
      <div class="grid2"><label class="field">Level you want<select name="seniority"><option value="">Not said</option>${Object.entries(SEN).map(([k, v]) => html`<option value="${k}" ${p.seniority === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        <label class="field">Permanent or contract <span class="h">To never see contracts, use Hard limits.</span><select name="terms">${[['', 'Either'], ['permanent', 'Permanent'], ['contract', 'Contract']].map(([k, v]) => html`<option value="${k}" ${(p.terms || '') === k ? 'selected' : ''}>${v}</option>`)}</select></label></div>
      <div class="grid2"><label class="field">Industries you want <span class="h">Comma-separated.</span><input type="text" name="industries" value="${(p.industries || []).join(', ')}" placeholder="Banking, insurance"></label>
        <label class="field">Industries you don't want <span class="h">Comma-separated.</span><input type="text" name="no_industries" value="${(p.no_industries || []).join(', ')}" placeholder="Gambling, tobacco"></label></div>
      <label class="field">Deal-breakers <span class="h">One per line.</span><textarea name="deal_breakers" rows="3" placeholder="On-call rota&#10;More than two days a week away from home">${(p.deal_breakers || []).join('\n')}</textarea></label>
      <label class="field">The career path you want <span class="h">Roles are tagged On path or Off path. <a href="#/career">Career path</a> can set it from one of its routes.</span><input type="text" name="career_path" maxlength="300" value="${p.career_path || ''}" placeholder="Head of Tax Technology"></label>`)],
    ['letters', 'Letters and follow-ups', ['', LETTER[p.letter_style] || 'Standard'], [(p.chase_days ?? 8) ? `Follow up after ${p.chase_days ?? 8} days` : 'No follow-ups', sign ? `signed “${sign}”` : 'signed “Sincerely,” and your name', (p.weekly_goal ?? 10) ? `goal ${p.weekly_goal ?? 10} applications a week` : 'no weekly goal'].join(' · '),
      form('letters', html`<div class="grid3"><label class="field">Letter style <span class="h">You can change it for any one role.</span><select name="letter_style">${[['standard', 'Standard'], ['formal', 'Formal: banks, government, law'], ['short', 'Short and direct'], ['warm', 'Warm and personal']].map(([k, x]) => html`<option value="${k}" ${p.letter_style === k ? 'selected' : ''}>${x}</option>`)}</select></label>
        <label class="field">Follow up on an application <span class="h">When there has been no reply.</span><select name="chase_days">${[...new Set([0, 5, 8, 10, 14, 21, p.chase_days ?? 8])].sort((a, b) => a - b).map(n => html`<option value="${n}" ${(p.chase_days ?? 8) === n ? 'selected' : ''}>${n ? `After ${n} days` : 'Never'}</option>`)}</select></label>
        <label class="field">Applications a week <span class="h">Your goal. 0 for none.</span><input type="number" name="weekly_goal" min="0" max="100" value="${p.weekly_goal ?? 10}"></label></div>
      <label class="field" style="max-width:420px">How you sign a letter <span class="h">One line each. Leave empty for "Sincerely," and your name.</span><textarea name="signature" rows="2" placeholder="Kind regards,&#10;Sam Rivera, CPA">${p.signature || ''}</textarea></label>
      <div class="row wrap" style="gap:10px"><span class="s grow" style="min-width:220px"><b>Your handwritten signature</b> <span class="m">· a picture of it, placed under the closing in every letter (Word and PDF). PNG or JPEG.</span></span>
        ${d.signature_picture ? html`<img src="/api/profile/signature-picture?t=${Date.now()}" alt="Your signature" style="height:36px;max-width:180px;object-fit:contain;background:#fff;border-radius:6px;border:1px solid var(--line);padding:2px 6px"><button type="button" class="btn sm ghost" data-act="dropsig">Remove</button>` : ''}
        <label class="btn sm">${d.signature_picture ? 'Use another' : 'Add a picture'}<input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden data-on="change" data-act="addsig"></label></div>`)],
    ['auto', 'What Job Hunt does by itself', ['', `Fit ${p.keep_fit ?? 55}+`], [`Keeps roles from fit ${p.keep_fit ?? 55}`, p.may_prepare === 'ask' ? 'asks before writing anything' : `writes the CV and letter straight away from fit ${p.prepare_fit ?? 70}`, p.prepare_max ? `at most ${p.prepare_max} per search` : 'no limit per search'].join(' · '),
      form('auto', html`<div class="grid3" data-set="fit"><label class="field">Fit a role needs <span class="h">Under this, it is set aside. 55 unless you say.</span><input type="number" name="keep_fit" min="30" max="95" value="${p.keep_fit ?? 55}"></label>
        <label class="field">Write documents from fit <span class="h">85 for strong fits only; the same as the first for all.</span><input type="number" name="prepare_fit" min="30" max="100" value="${p.prepare_fit ?? 70}"></label>
        <label class="field">Most to write in one search <span class="h">0 for no limit. The rest wait on Today.</span><input type="number" name="prepare_max" min="0" max="200" value="${p.prepare_max || 0}"></label></div>
      <label class="field" style="max-width:420px">When a strong role appears<select name="may_prepare"><option value="do" ${p.may_prepare !== 'ask' ? 'selected' : ''}>Write the CV and letter straight away</option><option value="ask" ${p.may_prepare === 'ask' ? 'selected' : ''}>Ask me before writing anything</option></select></label>
      <p class="xs m">Job Hunt never submits an application or sends a message. That is always you.</p>`)],
  ];
  return html`<div class="cols wide"><div class="card" style="padding:0;align-self:start">${rows.map(([key, name, [tone, word], sum, body], i) => {
      const on = open === key;
      return html`<div class="fold ${on ? 'open' : ''}" style="${i ? 'border-top:1px solid var(--line2)' : ''}">
        <a class="foldhead" href="${with_(route, { open: on ? '' : key, hl: '' })}"><b class="foldname">${name}</b><span class="chip ${tone}">${word}</span><span class="grow s m foldsum">${sum}</span><span class="btn sm">${on ? 'Close' : 'Change'}</span></a>
        ${on ? html`<div class="foldbody">${body}</div>` : ''}</div>`; })}</div>
  <div class="col" style="gap:14px">
    <div class="card" data-set="cvs"><div class="row"><h4 class="grow">Your CVs</h4><label class="btn sm">Add another<input type="file" accept=".docx,.pdf,.txt,.md" hidden data-on="change" data-act="addcv"></label></div><div class="col" style="margin-top:10px;gap:10px">${d.cvs.map(c => {
      const on = String(route.q.cv) === String(c.id);
      return html`<div class="col" style="gap:8px"><div class="row"><div class="grow"><b class="s">${c.name}</b><div class="xs m">${c.filename} · added ${rel(c.created_at)}${(c.titles || []).length ? html` · for ${c.titles.slice(0, 2).join(', ')}${c.titles.length > 2 ? '…' : ''}` : ''}</div></div>
        <a class="btn sm" href="${with_(route, { cv: on ? '' : c.id, open: '', hl: '' })}" title="Titles and words this CV is for, its letter style, a new file in its place, and what Claude read from it.">${on ? 'Close' : 'Change'}</a><a class="btn sm" href="/api/cvs/${c.id}/file">Download</a></div>
        ${on && d.cvlook?.cv?.id === c.id ? cvControls(d.cvlook, d.cvs.length) : ''}</div>`; })}</div>
      <p class="xs m" style="margin-top:8px">Word or PDF. Reading one takes about a minute.</p></div>
    <div class="card" data-set="facts"><h4>What Job Hunt knows about you</h4><p class="xs m" style="margin-top:3px">Facts beyond your CV. Used wherever they help, never invented.</p>
      <div class="col s" style="margin-top:8px;gap:6px">${d.facts.map(f => html`<div class="row top-al"><span class="grow">${f.text}</span><button class="btn sm ghost" data-act="delfact" data-id="${f.id}" aria-label="Forget this">Forget</button></div>`)}</div>
      <form data-act="addfact" class="row" style="margin-top:8px;gap:6px"><input type="text" name="text" placeholder="I am a CPA in good standing" aria-label="A fact about you"><button class="btn sm">Add</button></form></div>
    <div class="card" data-set="answers"><h4>Answers saved for forms</h4><p class="xs m" style="margin-top:3px">Asked once, reused on every application.${d.answers.length ? '' : ' None yet.'}</p>
      ${d.answers.length ? html`<div class="col s" style="margin-top:8px;gap:8px">${d.answers.map(a => html`<div class="row top-al"><div class="grow"><b>${a.question}</b><div class="ink2">${a.answer}</div></div><button class="btn sm ghost" data-act="delanswer" data-id="${a.id}">Remove</button></div>`)}</div>` : ''}</div>
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
    <div class="hr"></div>
    <div data-set="talkset"><div class="eb">When you can do interviews</div><p class="xs m" style="margin-top:3px">When an employer asks for your availability, the drafted reply offers free times inside these hours${c.on ? '' : ' (once your calendar is connected; until then the draft leaves gaps for you to fill)'}. A message that fixes one time puts the interview into Interviews by itself.</p>
      <div class="grid4" style="margin-top:8px"><label class="field">From <span class="h">Hour, 0 to 22.</span><input type="number" name="t_from" min="0" max="22" value="${c.talkset?.from ?? 9}"></label><label class="field">Until <span class="h">Hour, up to 24.</span><input type="number" name="t_to" min="1" max="24" value="${c.talkset?.to ?? 17}"></label><label class="field">Minutes each<input type="number" name="t_minutes" min="15" max="240" step="15" value="${c.talkset?.minutes ?? 60}"></label><label class="field">Times to offer<input type="number" name="t_offer" min="1" max="6" value="${c.talkset?.offer ?? 3}"></label></div>
      <button type="button" class="btn sm" style="margin-top:8px" data-act="savetalkset">Save these hours</button></div>
    <p class="xs m">Outlook and iCloud calendars have such an address too (Outlook: Settings → Calendar → Shared calendars → Publish a calendar → ICS). To have Job Hunt put interviews <b>into</b> Google Calendar and follow moves made there, sign in under <b>Google Calendar, both ways</b>.</p></form>`;
}

// Google Calendar both ways, through a sign-in key the person makes once in
// Google Cloud Console. The secret and the sign-in are never sent back here.
const GCC = 'https://console.cloud.google.com';
const googleState = g => !g ? ['', 'Off'] : g.signed_in ? (g.note ? ['crit', 'Problem'] : ['good', 'Signed in']) : g.has_client ? ['warn', 'Not signed in'] : ['', 'Off'];
function googleCard(g) {
  if (!g) return '';
  const a = (href, text) => html`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const [tone, word] = googleState(g);
  return html`<form data-act="savegoogle" class="card col" style="gap:10px" data-set="google"><div class="row"><h3 class="grow">Google Calendar, both ways</h3><span class="chip ${tone}">${word}</span></div>
    <p class="s m">Signed in, Job Hunt puts each interview into your Google Calendar with a prep block before it and reminders the evening before and half an hour before, and changes it there when it changes here. Move or delete one in Google Calendar and Job Hunt follows, with a note on the role. Entries you made yourself that name an employer you applied to are offered under Interviews with <b>Link to application</b>. What it reads stays on this computer and is never given to Claude.</p>
    ${g.note ? html`<p class="s" style="color:var(--crit)">${g.note}</p>` : ''}
    ${g.signed_in ? html`<p class="s">${g.syncing ? 'Syncing now' : g.at ? 'Synced ' + rel(g.at) : 'Not synced yet'} · ${g.pushed} ${g.pushed === 1 ? 'conversation' : 'conversations'} kept in Google Calendar${g.lookalikes ? html` · <a href="#/interviews">${g.lookalikes} to link under Interviews</a>` : ''}. Synced every half hour, and within two minutes of a change here.</p>` : html`
    <details ${g.has_client ? '' : 'open'}><summary class="s"><b>Once: make your own sign-in key in Google Cloud Console</b> (about ten minutes, free)</summary><ol class="steps s" style="margin-top:6px">
      <li>Open ${a(GCC + '/projectcreate', 'Google Cloud Console')} and sign in with the Google account whose calendar you use. Make a new project named <b>Job Hunt</b> and press <b>Create</b>.</li>
      <li>Open the ${a(GCC + '/apis/library/calendar-json.googleapis.com', 'Google Calendar API')} page for that project and press <b>Enable</b>.</li>
      <li>Open ${a(GCC + '/auth/overview', 'Google Auth Platform')} and press <b>Get started</b>. App name <b>Job Hunt</b>, your own address for support and contact, audience <b>External</b>. Agree and press <b>Create</b>.</li>
      <li>On the left, press <b>Audience</b>, then <b>Publish app</b>. Without this, Google ends the sign-in every seven days.</li>
      <li>On the left, press <b>Clients</b>, then <b>Create client</b>. Application type <b>Desktop app</b>, name <b>Job Hunt</b>, then <b>Create</b>.</li>
      <li>Copy the <b>Client ID</b> and the <b>Client secret</b> it shows into the boxes below and press <b>Save</b>.</li>
      <li>Press <b>Sign in with Google</b>. Google warns that it hasn't verified the app: it is your own, so press <b>Advanced</b>, then <b>Go to Job Hunt</b>, and allow it to see and edit events in your calendars.</li></ol></details>
    <div class="grid2"><label class="field">Client ID<input type="text" name="client_id" placeholder="${g.has_client ? 'Saved. Paste to replace.' : '…apps.googleusercontent.com'}" autocomplete="off" spellcheck="false"></label><label class="field">Client secret <span class="h">Kept only in Job Hunt's data file on this computer.</span><input type="password" name="client_secret" placeholder="${g.has_client ? 'Saved. Paste to replace.' : 'GOCSPX-…'}" autocomplete="off"></label></div>`}
    ${g.waiting && !g.signed_in ? html`<p class="s"><span class="spin"></span> Waiting for Google. Finish signing in in your browser; this page updates by itself.</p>` : ''}
    <div class="row wrap">${g.signed_in ? html`<button type="button" class="btn p" data-act="syncgoogle" data-busy="Syncing…">Sync now</button><button type="button" class="btn" data-act="testgoogle" data-busy="Asking Google…">Test</button><button type="button" class="btn danger" data-act="signoutgoogle" data-confirm="Sign out of Google? Job Hunt stops changing your Google Calendar. Entries already there stay; the client ID and secret are kept so you can sign in again.">Sign out</button>`
      : html`<button class="btn ${g.has_client ? '' : 'p'}">Save</button>${g.has_client ? html`<button type="button" class="btn p" data-act="signingoogle">Sign in with Google</button><button type="button" class="btn danger" data-act="forgetgoogle" data-confirm="Remove the client ID and secret from Job Hunt?">Remove the key</button>` : ''}`}</div>
    <p class="xs m">Job Hunt asks Google only to see and edit calendar events, and keeps no password. Without signing in, the read-only address under Your calendar keeps working.</p></form>`;
}
const clockOf = ts => new Date(ts * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function connections(d, route) {
  const cl = d.claude, ph = d.phone, m = d.mail, ext = d.ext;
  const usage = Object.entries(d.usage || {}).sort((a, b) => b[1].calls - a[1].calls);
  const hit = route.q.hl && SETTINGS.find(x => x.id === route.q.hl);
  const open = route.q.open || (hit ? { talkset: 'owncal' }[hit.set] || hit.set : '');
  const gg = d.google;
  const claude = html`<form data-act="savellm" class="card col" style="gap:10px" data-set="claude"><div class="row"><h3 class="grow">Claude</h3><span class="chip ${cl.engine && cl.ok ? 'good' : 'warn'}">${cl.engine ? (cl.ok ? 'Connected' : 'Resting') : 'Not connected'}</span></div>
      <p class="s m">Claude does the reading and writing. ${cl.note && !cl.ok ? html`<b style="color:var(--warn)">${cl.note}</b>` : ''}</p>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="claude-code" ${cl.engine === 'claude-code' ? 'checked' : ''} ${d.cli_found ? '' : 'disabled'}> <span><b>Your Claude subscription</b> through Claude Code<br><span class="m">${d.cli_found ? 'Found on this computer. Uses the plan you already pay for.' : d.pc?.claude_install ? 'Not on this computer yet. Press Install Claude Code, then Sign in to Claude.' : 'Claude Code isn\'t installed on this computer. Install it from claude.com/claude-code and sign in.'}</span></span></label>
      ${d.pc?.claude_install ? html`<div class="col" style="gap:6px;padding-left:24px"><div class="row wrap" style="gap:8px">${d.cli_found ? '' : html`<button type="button" class="btn sm" data-act="installclaude" data-busy="Starting…" title="Runs Claude Code's own installer from claude.ai. About a minute; a notice says when it is done.">Install Claude Code</button>`}<button type="button" class="btn sm" data-act="signinclaude" ${d.cli_found ? '' : 'disabled'} title="Opens Claude Code in a window of its own, where you sign in with your Claude account.">Sign in to Claude</button></div>
        <p class="xs m">Sign in opens a black window. Pick a look, then your Claude account; your browser opens to sign in. When it says you are signed in, close that window, choose this option here, Save and press Test it. You need a paid Claude plan (Pro or Max).</p></div>` : ''}
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="api" ${cl.engine === 'api' ? 'checked' : ''}> <span><b>An API key</b><br><span class="m">Pay for what you use. A day of searching costs a few dollars.</span></span></label>
      <div class="grid2" style="padding-left:24px"><label class="field">API key<input type="password" name="key" placeholder="${cl.has_key ? 'Saved. Paste to replace.' : 'sk-ant-…'}" autocomplete="off"></label><label class="field">Stop at this much a day (USD)<input type="number" name="daily_limit" value="${cl.limit || ''}" placeholder="No limit" step="0.5" min="0"></label></div>
      <label class="row top-al s" style="gap:8px"><input type="radio" name="engine" value="demo" ${cl.engine === 'demo' ? 'checked' : ''}> <span><b>Sample answers</b><br><span class="m">No Claude. For looking around; the writing is crude.</span></span></label>
      <label class="field" style="max-width:340px">Model<select name="model">${d.models.map(x => html`<option value="${x.ID}" ${cl.model === x.ID ? 'selected' : ''}>${x.Name}: ${x.Note}</option>`)}</select></label>
      <details ${cl.score_model || cl.write_model || cl.effort || cl.grouped ? 'open' : ''}><summary class="s">A model for each kind of work</summary>
        <div class="grid3" style="margin-top:8px">${[['score_model', 'Reading roles', 'Most of the calls. A cheaper model saves the most here.'], ['write_model', 'Tailoring and writing', 'What employers read.']].map(([k, label, h]) => html`<label class="field">${label} <span class="h">${h}</span><select name="${k}"><option value="">The model above</option>${d.models.map(x => html`<option value="${x.ID}" ${cl[k] === x.ID ? 'selected' : ''}>${x.Name}</option>`)}</select></label>`)}
          <label class="field">Effort <span class="h">How hard Claude thinks. Lower is faster and cheaper.</span><select name="effort">${[['', 'As each task needs'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, t]) => html`<option value="${v}" ${(cl.effort || '') === v ? 'selected' : ''}>${t}</option>`)}</select></label></div>
        <label class="row top-al s" style="gap:8px;margin-top:8px"><input type="checkbox" name="grouped" ${cl.grouped ? 'checked' : ''}> <span><b>Read four postings in one request</b><br><span class="m">Cheaper, but a new role waits for three others before it is scored, so you hear about it later. Off keeps you among the first applicants.</span></span></label></details>
      <div class="row"><button class="btn p">Save</button><button type="button" class="btn" data-act="testllm" data-busy="Asking Claude…">Test it</button><span class="grow"></span><span class="xs m">${cl.calls} calls today${cl.engine === 'api' ? html` · $${cl.today.toFixed(2)} today · $${cl.week.toFixed(2)} this week` : ''}</span></div>
      ${usage.length ? html`<details><summary class="s">What Claude was used for this week</summary><table class="tbl" style="margin-top:6px"><tbody>${usage.map(([k, u]) => html`<tr><td class="s">${k.replace(/_/g, ' ')}</td><td class="s">${u.calls} calls</td><td class="s">${u.cost ? '$' + u.cost.toFixed(2) : ''}</td><td class="s m">${u.errors ? u.errors + ' failed' : ''}</td></tr>`)}</tbody></table></details>` : ''}</form>`;
  const phone = html`<form data-act="savephone" class="card col" style="gap:10px" data-set="phone"><div class="row"><h3 class="grow">Phone notices</h3><span class="chip ${ph.on ? 'good' : ''}">${ph.on ? 'On' : 'Off'}</span></div>
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
        <label class="field" style="margin-top:8px;max-width:300px">Server <span class="h">Leave as it is unless you run your own.</span><input type="url" name="server" value="${ph.server}"></label></details></form>`;
  const mail = html`<form data-act="savemail" data-busy="Checking…" class="card col" style="gap:10px" data-set="mail"><div class="row"><h3 class="grow">Your inbox</h3><span class="chip ${m.on ? (m.note ? 'crit' : 'good') : ''}">${m.on ? (m.note ? 'Problem' : 'Connected') : 'Off'}</span></div>
      <p class="s m">So replies are noticed the moment they arrive. Job Hunt opens the inbox read-only and reads only mail from employers you applied to, hiring systems, people you wrote to, and job alerts from job sites. Replies it reads are passed to Claude to be understood; job alerts are not. It writes a reply only when you ask for one. Anything more is a switch below, and each starts off.</p>
      ${m.note ? html`<p class="s" style="color:var(--crit)">${m.note}</p>` : ''}
      <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${m.on ? 'checked' : ''}> Watch my inbox for replies</label>
      <div class="grid2"><label class="field">Address<input type="email" name="user" value="${m.user}" autocomplete="off"></label><label class="field">App password <span class="h">Not your normal password.</span><input type="password" name="pass" placeholder="${d.mail_has_pass ? 'Saved. Paste to replace.' : '16 letters'}" autocomplete="off"></label></div>
      <div class="grid2"><label class="field">Mail server<input type="text" name="host" value="${m.host}"></label><label class="field">Check every <span class="h">Minutes, 5 to 240.</span><input type="number" name="every" value="${m.every || 10}" min="5" max="240"></label></div>
      <p class="xs m">A "we received your application" message marks that role as applied by itself, and adds the role if Job Hunt never found it. With Gmail, archived messages are read too.</p>
      <p class="xs m">Gmail: Google Account → Security → 2-Step Verification → App passwords. The password is kept only in Job Hunt's data file on this computer.</p>
      <div class="eb" style="margin-top:4px">More, if you want it</div>
      <label class="row top-al s" style="gap:8px"><input type="checkbox" name="drafts" ${m.drafts ? 'checked' : ''}><span><b style="font-weight:500">Save replies as drafts in my mail</b><span class="xs m" style="display:block">A "Save as a Gmail draft" button next to Copy puts a reply, follow-up, thank-you or note in your Drafts, in the thread of their message. It waits there for you.</span></span></label>
      <label class="row top-al s" style="gap:8px"><input type="checkbox" name="send" ${m.send ? 'checked' : ''}><span><b style="font-weight:500">Let me send mail from Job Hunt</b><span class="xs m" style="display:block">A "Send" button under each message Job Hunt wrote for you. It shows who it goes to and asks once more; one press sends that one message from your address. Nothing is ever sent by itself.</span></span></label>
      <label class="row top-al s" style="gap:8px"><input type="checkbox" name="labels" ${m.labels ? 'checked' : ''}><span><b style="font-weight:500">Label the mail Job Hunt reads</b><span class="xs m" style="display:block">Gmail only: messages about your applications get the label JobHunt/Applied, and recruiters' messages JobHunt/Recruiters. Nothing is moved or deleted.</span></span></label>
      <label class="row top-al s" style="gap:8px"><input type="checkbox" name="recruiters" ${m.recruiters ? 'checked' : ''}><span><b style="font-weight:500">Find recruiters in my mail</b><span class="xs m" style="display:block">Looks through the senders and subjects of two years of mail, leaving out automatic senders. Only the newest message from each likely recruiter is opened, and only its opening and signature go to Claude. They are added to People with their e-mail, phone and LinkedIn, and their employer's job board is watched when it can be found. Again once a week.</span></span></label>
      ${m.recruiters && m.on ? html`<div class="row xs m" style="gap:8px">${d.recruiter_scan?.at ? html`<span>Last looked ${rel(d.recruiter_scan.at)}: ${d.recruiter_scan.found} found so far.</span>` : html`<span>Not looked yet.</span>`}${d.recruiter_scan?.note ? html`<span style="color:var(--crit)">${d.recruiter_scan.note}</span>` : ''}<button type="button" class="link" data-act="scanrecruiters">Look now</button></div>` : ''}
      <div class="row"><button class="btn p">Save and check</button>${m.last_at ? html`<span class="xs m">Last read ${rel(m.last_at)}</span>` : ''}</div></form>`;
  const oa = d.other_ai || {};
  const cal = d.owncal || {}, pa = d.phoneaccess, k = d.desk || {}, sc = d.schedule || { full: [] }, more = d.more || [];
  const keyed = more.filter(x => x.id !== 'alerts' && x.id !== 'indeed'), setUp = keyed.filter(x => x.has_key);
  const model = (d.models || []).find(x => x.ID === cl.model)?.Name || '';
  const ts = cal.talkset || {}, ss = d.searchset?.set || {};
  const rows = [
    ['claude', 'Claude', cl.engine ? (cl.ok ? ['good', 'Connected'] : ['warn', 'Resting']) : ['warn', 'Not connected'],
      cl.engine ? `${{ 'claude-code': 'Your Claude subscription', api: 'An API key', demo: 'Sample answers (no Claude)' }[cl.engine] || cl.engine}${model ? ' · ' + model : ''} · ${cl.calls} calls today${cl.note && !cl.ok ? ' · ' + cl.note : ''}` : 'Claude does the reading and writing', claude],
    ['otherai', 'Another AI', oa.on ? (oa.ok ? ['good', 'On'] : ['warn', 'Resting']) : ['', 'Off'],
      oa.on ? `${(d.other_services || []).find(x => x.Base === oa.base)?.Name || oa.base} · ${oa.model} · ${oa.use === 'all' ? 'everything it can do' : 'searching only'}${oa.note ? ' · ' + oa.note : ''}` : 'ChatGPT, Grok, Gemini or a model on this computer, for the searching or for more', otherAI(d)],
    ['mail', 'Your inbox', m.on ? (m.note ? ['crit', 'Not working'] : ['good', 'Connected']) : ['', 'Off'],
      m.on ? (m.note || `${m.host || 'Mail'} · ${m.last_at ? 'checked ' + rel(m.last_at) : 'not checked yet'}${m.every ? `, every ${m.every} minutes` : ''}`) : 'Notices replies the moment they arrive; reads only unless you switch more on', mail],
    ['owncal', 'Your calendar', cal.on ? (cal.note ? ['crit', 'Not working'] : ['good', 'Connected']) : ['', 'Off'],
      `${cal.on ? (cal.note || 'Read only') : 'Not connected'} · interviews ${ts.from ?? 9} to ${ts.to ?? 17}, ${ts.minutes ?? 60} minutes each, ${ts.offer ?? 3} times offered`, ownCalendar(d.owncal)],
    ['google', 'Google Calendar, both ways', googleState(gg),
      gg?.signed_in ? (gg.note || `${gg.pushed} kept in Google Calendar${gg.at ? ' · synced ' + rel(gg.at) : ''}`) : gg?.has_client ? 'Key saved; press Sign in with Google' : 'Interviews into Google Calendar, and moves made there back here', googleCard(gg)],
    ['phone', 'Phone notices', ph.on ? ['good', 'On'] : ['', 'Off'],
      ph.on ? `For fit ${ph.min_fit} and up${ph.quiet_from !== ph.quiet_to ? ` · quiet ${ph.quiet_from}:00 to ${ph.quiet_to}:00` : ''}${ph.only === 'urgent' ? ' · interviews and offers only' : ''}` : 'A buzz on your phone when a strong role is posted, through the free ntfy app', phone],
    ['phoneaccess', 'Job Hunt on your phone', pa?.on ? (pa.problem ? ['crit', 'Not working'] : ['good', 'On']) : ['', 'Off'],
      pa?.on ? `${pa.devices?.length || 0} phone${pa.devices?.length === 1 ? '' : 's'} paired` : 'See Today and act on roles from your phone\'s browser', phoneAccess(d.phoneaccess)],
    ['sources', 'More job sources', setUp.length ? [setUp.length === keyed.length ? 'good' : 'warn', `${setUp.length} of ${keyed.length}`] : ['', 'None'],
      keyed.length ? (setUp.length ? `${setUp.map(x => x.name).join(', ')} set up` + (keyed.length > setUp.length ? ` · ${keyed.filter(x => !setUp.includes(x)).map(x => x.name).join(', ')} need${keyed.length - setUp.length === 1 ? 's' : ''} a key` : '') : `${keyed.map(x => x.name).join(', ')}: each needs a key`) : '', moreSources(d)],
    ['vpn', 'VPN for blocked sources', d.vpn?.server ? ['good', 'On'] : ['', 'Off'],
      d.vpn?.server ? `${d.vpn.server} · ${d.vpn.through.length ? d.vpn.through.map(id => d.vpn.choices.find(c => c.id === id)?.name || id).join(', ') : 'no source goes through it yet'}` : 'For job sources that turn away the country you are in, such as Adzuna', vpnCard(d)],
    ['schedule', 'Search times', ['good', 'On'], `Full searches at ${sc.full.length ? sc.full.map(hhmm).join(', ') : 'no set times'} · quick checks every ${sc.fast_minutes || 20} minutes`, schedule(d)],
    ['tidy', 'Ratings, old roles and budget', ss.min_rating || ss.clear_days || ss.budget ? ['blue', 'On'] : ['', 'Off'], tidySum(d), tidyCard(d)],
    ['desk', 'On this computer', ['good', 'On'], [d.startup?.on ? 'Starts when you sign in' : 'Does not start by itself', k.notify ? 'Windows notifications on' : 'no Windows notifications', k.morning >= 0 ? `morning summary at ${k.morning}:00` : 'no morning summary'].join(' · '), thisComputer(d)],
  ];
  return html`<div class="card" style="padding:0">${rows.map(([key, name, [tone, word], sum, body], i) => {
      const on = open === key;
      return html`<div class="fold ${on ? 'open' : ''}" style="${i ? 'border-top:1px solid var(--line2)' : ''}">
        <a class="foldhead" href="${with_(route, { open: on ? '' : key, hl: '' })}"><b class="foldname">${name}</b><span class="chip ${tone}">${word}</span><span class="grow s m foldsum">${sum}</span><span class="btn sm">${on ? 'Close' : word === 'Off' || word === 'None' || word === 'Not connected' ? 'Set up' : 'Change'}</span></a>
        ${on ? html`<div class="foldbody">${body}</div>` : ''}</div>`; })}</div>`;
}

// Another AI in Claude's place, for the searching or for everything. The key
// is never sent back to this page: it only knows whether one is there.
function otherAI(d) {
  const o = d.other_ai || {}, sv = d.other_services || [];
  const known = sv.find(x => x.Base === o.base);
  return html`<form data-act="saveother" data-busy="Trying it…" class="card col" style="gap:10px" data-set="otherai"><div class="row"><h3 class="grow">Another AI</h3><span class="chip ${o.on ? (o.ok ? 'good' : 'warn') : ''}">${o.on ? (o.ok ? 'On' : 'Resting') : 'Off'}</span></div>
    <p class="s m">Another AI service can do part of Claude's work: ChatGPT, Grok, Gemini, Groq, OpenRouter, or a model on this computer through Ollama or LM Studio. Any service that works the OpenAI way will do. Claude stays connected: it looks things up on the web, runs the assistant, and takes over whenever the other AI fails.</p>
    ${o.note ? html`<p class="s" style="color:var(--warn)">${o.note}</p>` : ''}
    <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${o.on ? 'checked' : ''}> Use another AI</label>
    <label class="field" style="max-width:420px">Use it for<select name="use"><option value="search" ${o.use === 'all' ? '' : 'selected'}>Searching: reading and scoring postings</option><option value="all" ${o.use === 'all' ? 'selected' : ''}>Everything it can do: searching and writing</option></select></label>
    <div class="grid2"><label class="field">Address <span class="h">Pick one or paste the service's own.</span><input type="url" name="base" value="${o.base || ''}" list="otherbases" placeholder="https://api.openai.com/v1" autocomplete="off" spellcheck="false"><datalist id="otherbases">${sv.map(x => html`<option value="${x.Base}">${x.Name}</option>`)}</datalist></label>
      <label class="field">Model <span class="h">Its name as the service writes it.</span><input type="text" name="model" value="${o.model || ''}" placeholder="${known?.Model || 'gpt-5-mini'}" autocomplete="off" spellcheck="false"></label></div>
    <label class="field" style="max-width:340px">Key <span class="h">Not needed for a model on this computer.</span><input type="password" name="key" placeholder="${o.has_key ? 'Saved. Paste to replace.' : ''}" autocomplete="off"></label>
    <p class="xs m">It is sent your CV, your profile and the postings it reads (and, for everything, what it writes for you; never your mail), and only to the address above. The key is kept only in Job Hunt's data file on this computer. A new address, model or key is tried before it is saved, and kept only if the service answers.</p>
    <div class="row wrap"><button class="btn p">Save</button>${o.base && o.model ? html`<button type="button" class="btn" data-act="testother" data-busy="Asking…" title="Asks the saved service one small question, without Claude.">Test it</button>` : ''}${o.has_key ? html`<button type="button" class="btn ghost" data-act="delother" data-confirm="Remove the key for the other AI? Claude does all the work again.">Remove the key</button>` : ''}</div></form>`;
}

// The searches that take a key, and job-alert e-mails. A saved key is never
// sent back to this page: it only knows whether one is there.
const SRC_STATE = { working: ['good', 'Working'], problem: ['crit', 'Problem'], off: ['', 'Off'], none: ['', 'Not set up'], waiting: ['blue', 'Not tried yet'] };
// A VPN for the sources that turn away the person's country: one WireGuard
// file, and a switch for each source. The file's key never comes back here.
function vpnCard(d) {
  const v = d.vpn || { through: [], choices: [] };
  return html`<div class="card col" style="gap:12px">
    <p class="s m">Some job sources turn away the country you are in. Job Hunt can send just those through a VPN server in a country they serve. Only the sources switched on below go through it: Claude, your inbox, everything else in Job Hunt and the rest of your computer stay on your own connection, and the VPN app doesn't need to be open. Once a file is here, a source that turns your country away is switched on by itself.</p>
    <div class="row wrap" style="gap:10px"><b class="s grow">${v.server ? html`Server: ${v.server}` : 'No VPN file yet'}</b>
      <label class="btn sm ${v.server ? '' : 'p'}" title="A WireGuard configuration file from your VPN account">${v.server ? 'Choose another file' : 'Choose a WireGuard file'}<input type="file" accept=".conf,text/plain" hidden data-on="change" data-act="vpnfile"></label>
      ${v.server ? html`<button type="button" class="btn sm" data-act="vpncheck" data-busy="Connecting…">Check</button><button type="button" class="btn sm ghost" data-act="vpnoff" data-confirm="Remove the VPN file? Every source goes over your own connection again.">Remove</button>` : ''}</div>
    <p class="xs m">For Proton VPN: sign in at <a href="https://account.protonvpn.com/downloads" target="_blank" rel="noopener noreferrer">account.protonvpn.com, Downloads</a>. Under WireGuard configuration give it a name, choose Windows, pick a server in the country you search in, press Create, then Download, and choose that file here. The free plan gives these files too, but may not let you choose the country. Any other VPN's WireGuard file works the same way. The file's private key stays in Job Hunt's data file on this computer.</p>
    <div class="col" style="gap:6px"><b class="s">Through the VPN</b>
      ${v.choices.map(c => html`<label class="row s"><input type="checkbox" data-on="change" data-act="vpnthrough" data-id="${c.id}" ${v.through.includes(c.id) ? 'checked' : ''}> ${c.name}</label>`)}</div>
    <p class="xs m">LinkedIn answers some VPN servers more slowly or asks them to slow down sooner; switch it on only if LinkedIn doesn't work from where you are.</p></div>`;
}

function moreSources(d) {
  const saved = s => s.has_key ? 'Saved. Paste to replace.' : '';
  const row = s => {
    const alerts = s.id === 'alerts', indeed = s.id === 'indeed', [tone, word] = alerts && s.state === 'waiting' ? ['blue', 'Watching'] : SRC_STATE[s.state] || SRC_STATE.none;
    return html`<form data-act="savesource" data-id="${s.id}" class="col" style="gap:8px;border-top:1px solid var(--line2);padding-top:12px">
      <div class="row"><b class="grow">${s.name}</b>${s.vpn ? html`<span class="chip blue" title="Its requests go through your VPN">Through ${s.vpn}</span>` : ''}<span class="chip ${tone}">${word}</span></div>
      <p class="s m">${s.about}</p>
      ${s.note ? html`<p class="s" style="color:var(--${s.state === 'problem' ? 'crit' : 'muted'})">${s.note}</p>` : ''}
      ${indeed ? html`<label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${s.on ? 'checked' : ''} ${s.state === 'none' && !s.on ? 'disabled' : ''}> Search Indeed through my Claude account</label>
        <p class="xs m">Needs Indeed connected in claude.ai: Settings, Connectors, Indeed. Only your titles and city are sent with each search. ${s.used} used today.</p>`
      : alerts ? html`<label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${s.on ? 'checked' : ''}> Take the postings out of job alerts in my inbox</label>` : html`
        <p class="xs m">${s.get} <a href="${s.link}" target="_blank" rel="noopener noreferrer">Open the page that gives the key</a></p>
        ${s.id === 'adzuna' ? html`<div class="grid2"><label class="field">Application ID<input type="text" name="app_id" placeholder="${saved(s)}" autocomplete="off"></label><label class="field">Application Key<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label></div>`
          : s.id === 'apify' ? html`<div class="grid2"><label class="field">API token<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label><label class="field">Scraper <span class="h">Leave empty for the usual one</span><input type="text" name="app_id" placeholder="${s.actor || 'curious_coder/linkedin-jobs-scraper'}" autocomplete="off"></label></div>`
          : s.id === 'jsearch' ? html`<div class="grid2"><label class="field">Key<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label><label class="field">Key from<select name="from"><option value="rapidapi" ${s.from === 'rapidapi' ? 'selected' : ''}>RapidAPI</option><option value="openwebninja" ${s.from === 'openwebninja' ? 'selected' : ''}>OpenWeb Ninja</option></select></label></div>`
          : html`<label class="field" style="max-width:340px">Key<input type="password" name="key" placeholder="${saved(s)}" autocomplete="off"></label>`}
        <div class="row wrap" style="gap:14px"><label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${s.on ? 'checked' : ''}> Search ${s.name}</label>
          <label class="row s" style="gap:6px">At most <input type="number" name="limit" value="${s.limit}" min="1" max="5000" style="width:84px;height:30px" aria-label="Most requests a day to ${s.name}"> requests a day</label></div>
        <p class="xs m">${s.used} used today. Asked on full searches${s.fast ? ', and now and then on quick checks' : ''}. Keep the number inside what your plan allows.</p>`}
      <div class="row"><button class="btn sm p" data-busy="${alerts || indeed ? 'Saving…' : 'Trying the key…'}">Save</button>
        ${indeed && s.state !== 'none' ? html`<button type="button" class="btn sm" data-act="testsource" data-id="indeed" data-busy="Asking Indeed through Claude, about a minute…" title="Runs one Indeed search now for your first title, through your Claude account, and says what came back. It counts as one of today's 8.">Test</button>` : ''}
        ${!alerts && !indeed && s.has_key ? html`<button type="button" class="btn sm" data-act="testsource" data-id="${s.id}" data-busy="${s.id === 'apify' ? 'Searching LinkedIn, about a minute…' : 'Asking…'}" title="${s.id === 'apify' ? 'Runs one real LinkedIn search for 10 postings through your scraper (about a cent) and says what came back.' : 'Runs one small search now and says what came back.'}">Test</button><button type="button" class="btn sm ghost" data-act="delsource" data-id="${s.id}" data-confirm="Remove the key for ${s.name}? Roles already found there stay.">Remove the key</button>` : ''}
        <span class="grow"></span>${s.at ? html`<span class="xs m">Last answered ${ago(s.at)}: ${s.seen} posting${s.seen === 1 ? '' : 's'}${alerts || s.new ? `, ${s.new} new` : ''}</span>` : ''}</div></form>`;
  };
  return html`<div class="card col" style="gap:12px"><div><h3>More job sources</h3>
    <p class="s m" style="margin-top:4px">Other places Job Hunt can search with your titles and city. Each needs a key that you get yourself, free. A new key is tried with one small search before it is saved. A key is kept only in Job Hunt's data file on this computer and is sent only to the service it is for.</p></div>
    ${(d.more || []).map(row)}</div>`;
}

const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
function thisComputer(d) {
  const k = d.desk || {};
  return html`<form data-act="savedesk" class="card col" style="gap:10px" data-set="desk"><div class="row"><h3 class="grow">On this computer</h3><span class="chip ${k.notify && d.can_notify ? 'good' : ''}">${k.notify && d.can_notify ? 'Notifications on' : 'Notifications off'}</span></div>
    <label class="row s" style="font-weight:500"><input type="checkbox" name="notify" ${k.notify ? 'checked' : ''}> Show a Windows notification for a fresh role that fits, and when someone writes to you</label>
    <p class="xs m">A click opens it in Job Hunt. Job Hunt also sits by the clock (the icon's menu opens it, searches now, checks for updates or stops it).${d.can_notify ? '' : ' Notifications are shown only on Windows.'}</p>
    <label class="field" style="max-width:420px">Keep this computer awake <span class="h">A sleeping computer finds nothing. The screen can still turn off.</span><select name="awake"><option value="working" ${k.awake === 'working' ? 'selected' : ''}>While Job Hunt is working</option><option value="always" ${k.awake === 'always' ? 'selected' : ''}>Always, while searching is on</option><option value="off" ${k.awake === 'off' ? 'selected' : ''}>Never</option></select></label>
    ${d.pc?.power ? wakeBlock(k, d.pc.power) : ''}
    ${(d.pc?.browsers || []).length ? html`<label class="field" style="max-width:420px">Open links in <span class="h">Postings, LinkedIn and other sites you open from Job Hunt's window. The side panel works in Chrome and Edge.</span><select name="browser"><option value="">Windows' own choice</option>${d.pc.browsers.map(b => html`<option value="${b.id}" ${k.browser === b.id ? 'selected' : ''}>${b.name}</option>`)}</select></label>` : ''}
    <label class="field" style="max-width:420px">Morning summary <span class="h">What needs you today, in one notice. Reminders also come the evening before an interview, after one, and two days before a posting closes.</span><select name="morning">${[[-1, 'Never'], [6, '6:00'], [7, '7:00'], [8, '8:00'], [9, '9:00'], [10, '10:00']].map(([v, t]) => html`<option value="${v}" ${k.morning === v ? 'selected' : ''}>${t}</option>`)}</select></label>
    ${d.startup?.can ? html`<label class="row s" style="font-weight:500"><input type="checkbox" name="startup" ${d.startup.on ? 'checked' : ''}> Start Job Hunt when I sign in to Windows <span class="xs m" style="font-weight:400">(in the background, by the clock)</span></label>` : ''}
    <div class="row"><button class="btn p">Save</button>${d.can_notify ? html`<button type="button" class="btn" data-act="testdesk">Show a test</button>` : ''}</div></form>`;
}
// Employee ratings, roles set aside when nobody acted on them, and budget mode.
function tidySum(d) {
  const ss = d.searchset?.set || {}, b = d.searchset?.budget || {};
  return [ss.ratings_off ? 'ratings not looked up' : `ratings looked up by themselves${d.searchset?.rated ? ` (${d.searchset.rated} so far)` : ''}`, ss.min_rating ? `skips employers rated under ${ss.min_rating.toFixed(1)}★` : '',
    ss.clear_days ? `sets aside roles untouched for ${ss.clear_days} days` : '', ss.budget ? (b.run_at ? `${b.waiting} wait for the night` : 'budget mode on') : ''].filter(Boolean).join(' · ');
}
function tidyCard(d) {
  const ss = d.searchset?.set || {};
  return html`<form data-act="savesearchset" class="card col" style="gap:10px" data-set="tidy"><h3>Ratings, old roles and budget</h3>
    <label class="row s" style="font-weight:500"><input type="checkbox" name="ratings" ${ss.ratings_off ? '' : 'checked'}> Look up what employees rate each employer, by itself</label>
    <p class="xs m">For employers of roles worth a look, a few a day, through Claude's web search. The ★ shows beside the employer in Roles. Needs your Claude subscription or an API key.</p>
    <div class="grid3"><label class="field">Skip employers rated under <span class="h">Their roles are set aside with the reason; never ones you saved, applied to or added.</span><select name="min_rating">${[[0, 'Don\'t skip any'], [2.5, '2.5★'], [3, '3.0★'], [3.3, '3.3★'], [3.5, '3.5★'], [3.8, '3.8★'], [4, '4.0★']].map(([v, t]) => html`<option value="${v}" ${(ss.min_rating || 0) === v ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label class="field">Set aside roles nobody acted on <span class="h">Never ones you saved, prepared, applied to or added. Nothing is deleted.</span><select name="clear_days">${[[0, 'Never'], [30, 'After 30 days'], [60, 'After 60 days'], [90, 'After 90 days']].map(([v, t]) => html`<option value="${v}" ${(ss.clear_days || 0) === v ? 'selected' : ''}>${t}</option>`)}</select></label></div>
    <label class="row top-al s" style="gap:8px"><input type="checkbox" name="budget" ${ss.budget ? 'checked' : ''}> <span><b>Budget mode</b><br><span class="m">When a search brings in more than 12 new postings, they wait to be read at night (from 01:00), with Run now and Cancel on Radar. Off reads every posting at once, so you can be among the first ten applicants.</span></span></label>
    <div class="row"><button class="btn p">Save</button></div></form>`;
}

// Waking a sleeping computer for the full searches, and what Windows' settings allow.
function wakeBlock(k, pw) {
  return html`<div class="col" style="gap:6px"><label class="row s" style="font-weight:500"><input type="checkbox" name="wake" ${k.wake ? 'checked' : ''}> Wake this computer for the full searches <span class="xs m" style="font-weight:400">(from sleep; not when it is shut down)</span></label>
    ${k.wake && pw.wake_at ? html`<p class="xs m">Next wake: ${when(pw.wake_at)}, a minute before the search.</p>` : ''}
    ${k.wake && pw.known && pw.blocked ? html`<div class="row wrap" style="gap:8px"><p class="s grow" style="color:var(--warn);min-width:220px">Windows' power settings don't allow wake timers, so this computer stays asleep.</p>${pw.can_allow ? html`<button type="button" class="btn sm" data-act="allowwake" data-busy="Asking Windows…">Allow wake timers</button>` : ''}</div>` : ''}
    ${k.wake && pw.modern ? html`<p class="xs m">This computer uses Modern Standby, where Windows may not wake it for a program. Keep it plugged in, and set Keep this computer awake to Always if searches are missed.</p>` : ''}</div>`;
}

function schedule(d) {
  const sc = d.schedule || { full: [] };
  const hour = (name, v) => html`<select name="${name}" style="width:92px">${Array.from({ length: 24 }, (_, h) => html`<option value="${h}" ${v === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`)}</select>`;
  return html`<form data-act="saveschedule" class="card col" style="gap:10px" data-set="schedule"><h3>When Job Hunt searches</h3>
    <label class="field">Full searches at <span class="h">Every source, every title. Times of day, comma-separated; up to six.</span><input type="text" name="full" value="${sc.full.map(hhmm).join(', ')}" placeholder="07:00, 12:30, 17:30"></label>
    <label class="field" style="max-width:420px">Quick check for brand-new postings <span class="h">Only postings a couple of hours old with few applicants. This is what gets you in early.</span><select name="fast_minutes">${[[10, 'Every 10 minutes'], [15, 'Every 15 minutes'], [20, 'Every 20 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [120, 'Every 2 hours'], [0, 'Off']].map(([v, t]) => html`<option value="${v}" ${sc.fast_minutes === v ? 'selected' : ''}>${t}</option>`)}</select></label>
    <div class="row s" style="gap:8px"><span style="font-weight:600">Quick checks between</span>${hour('from', sc.from)}<span>and</span>${hour('to', sc.to)}<span class="m">Same time twice means all day.</span></div>
    <div class="row"><button class="btn p">Save</button></div>${suggested(d)}</form>`;
}
// Search times suggested from when the roles found for you were posted.
function suggested(d) {
  const sg = d.suggest, sc = d.schedule || {};
  if (!sg) return '';
  if (!sg.ready) return html`<p class="xs m" style="border-top:1px solid var(--line2);padding-top:10px">Once Job Hunt has seen ${sg.need} postings that say the time they went up (${sg.seen} so far), it suggests search times from them.</p>`;
  const top = Math.max(...sg.hours.map(h => h.n), 1), hh = h => String(h).padStart(2, '0') + ':00';
  const span = sg.from === sg.to ? 'all day' : `between ${hh(sg.from)} and ${hh(sg.to)}`;
  return html`<div class="col" style="gap:8px;border-top:1px solid var(--line2);padding-top:10px"><b class="s">Suggested from your own postings</b>
    <div class="row" style="gap:2px;align-items:end;height:44px" role="img" aria-label="How many of your postings went up in each hour of the day">${sg.hours.map(h => html`<span title="${hh(h.hour)}: ${h.n} posting${h.n === 1 ? '' : 's'}" style="flex:1;min-width:3px;height:${Math.max(2, Math.round(40 * h.n / top))}px;border-radius:2px;background:var(--${sg.peaks.includes(h.hour) ? 'accent' : 'line'})"></span>`)}</div>
    <div class="row xs m" style="justify-content:space-between"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
    <p class="s ink2">Of the ${sg.seen} roles found for you lately that say when they went up, most went up around ${sg.peaks.map(hh).join(', ')}. Full searches at <b>${sg.full.map(hhmm).join(', ')}</b> and quick checks <b>${span}</b> would find them while few have applied.</p>
    <div class="row">${sg.same ? html`<span class="chip good">Your times follow this</span>` : html`<button type="button" class="btn sm" data-act="usesuggest" data-busy="Saving…">Use these times</button>`}</div></div>`;
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
      <p class="xs m">${d.ext_dir ? 'Loaded from this folder, the side panel keeps itself up to date: after Job Hunt updates, it reloads itself and shows NEW on its icon.' : 'After a Job Hunt update, download the zip again, unpack it over the old folder and press the round-arrow Reload on the extensions page.'}</p></div>
    ${noPanel(d)}</div>`;
}

// "Send to Job Hunt" as a bookmark: on a posting's page it opens Job Hunt with
// the role filled in. Nothing is added until the person presses Add there.
const bookmarklet = port => `javascript:(()=>{const d=document,g=s=>d.querySelector(s)||{},m=n=>g('meta[property="'+n+'"]').content||'';let j={};d.querySelectorAll('script[type="application/ld+json"]').forEach(x=>{try{[].concat(JSON.parse(x.textContent)).forEach(y=>[].concat(y&&y['@graph']||y).forEach(z=>{if(z&&z['@type']==='JobPosting')j=z}))}catch(e){}});const q=new URLSearchParams({add:'link',url:location.href.split('#')[0],title:String(j.title||g('h1').innerText||m('og:title')||d.title||'').trim().slice(0,200),company:String((j.hiringOrganization||{}).name||m('og:site_name')||'').trim().slice(0,120),text:String(getSelection()).trim().slice(0,12000)});open('http://127.0.0.1:${port}/#/roles?'+q,'_blank')})()`;
function noPanel(d) {
  const code = bookmarklet(location.port || '47700');
  return html`<div class="card col" style="gap:10px" data-set="bookmark"><h3>No side panel in this browser?</h3>
    <p class="s m">For Firefox, Safari or a browser at work: a bookmark that sends the posting you are looking at to Job Hunt. Job Hunt opens with the role filled in; you press Add.</p>
    <div class="row wrap" style="gap:8px"><a class="btn p" href="${code}" data-act="bookmarkhelp" title="Drag this to your browser's bookmarks bar">Send to Job Hunt</a><span class="xs m grow">Drag the button to your browser's bookmarks bar.</span><button type="button" class="btn sm" data-act="copytext" data-text="${code}" title="For a browser you can't drag to: make a new bookmark and paste this as its address.">Copy its address</button></div>
    <p class="xs m">If the site needs you to sign in to see the posting, select the posting's text before you press it. It works while Job Hunt is running on this computer.</p>
    ${d.pc?.clip ? html`<div class="hr"></div><label class="row s" style="font-weight:500"><input type="checkbox" data-on="change" data-act="saveclip" ${d.desk?.clip ? 'checked' : ''}> Notice job links I copy</label>
      <p class="xs m">Copy a link to a posting anywhere on this computer and Job Hunt offers to add it, under the bell and as a notification. Only a single job link is acted on; nothing else you copy is kept or sent anywhere. Off unless you turn it on.</p>` : ''}</div>`;
}

const THEMES = [['light', 'Light', 'Light pages, as Job Hunt has always looked.'], ['dark', 'Dark', 'Dark pages, easier on the eyes at night.'], ['system', 'Match Windows', 'Follows the light or dark setting of this computer, and changes with it.']];
function looks() {
  const cur = app.state.theme || 'light';
  return html`<div class="card row wrap" style="gap:12px" data-set="theme"><div class="grow" style="min-width:200px"><h4>How it looks</h4><p class="xs m" style="margin-top:3px">Remembered on this computer. Fit colours mean the same in both: green from 80, amber from 60, red below.</p></div>
    <div class="seg" role="group" aria-label="Light or dark">${THEMES.map(([k, v, tip]) => html`<button type="button" class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k ? 'true' : 'false'}" data-act="theme" data-theme="${k}" title="${tip}">${v}</button>`)}</div></div>`;
}

let handed = null; // the hand-over just made, said until the page is left
const bytes = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
// The saved copies of the data, and putting one back.
function copies(b, route, pick) {
  if (!b) return '';
  const all = b.copies || [], shown = all, st = b.staged;
  return html`<div class="card col" style="gap:10px;padding-bottom:14px" data-set="copies"><div class="row"><div class="grow"><h4>Saved copies</h4><p class="xs m" style="margin-top:3px">A copy of all your data is saved every day and the newest ${b.keep} are kept.</p></div>
      <button class="btn sm" data-act="backup" title="Saves a copy of all your data now, as today's copy.">Save a copy now</button></div>
    ${st ? html`<div class="s" style="background:var(--warn-soft);padding:10px 12px;border-radius:8px"><b>The copy from ${st.at ? exact(st.at) : 'earlier'} is ready to be put back.</b> It takes the place of your data the next time Job Hunt starts. What you have now is saved first, as a copy of its own.
        <div class="row wrap" style="margin-top:8px;gap:8px">${b.can_restart ? html`<button class="btn sm p" data-act="restart" data-confirm="Restart Job Hunt now? It stops for a few seconds, puts the copy back and comes back by itself.">Restart Job Hunt now</button>` : html`<span class="xs"><b>Stop Job Hunt</b> with the button above, then start it again from the Start menu.</span>`}<button class="btn sm" data-act="cancelrestore" title="Forgets the copy that was waiting. Your data stays as it is.">Don't put it back</button></div></div>` : ''}
    ${all.length ? html`<table class="tbl" style="margin:0 -6px;width:calc(100% + 12px)"><thead><tr><th>Saved</th><th>What</th><th>Size</th><th></th></tr></thead><tbody>
      ${shown.map(c => html`<tr><td class="s" style="white-space:nowrap" title="${exact(c.at)}"><b>${new Date(c.at * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b> <span class="m">${new Date(c.at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></td><td class="s m" title="${c.name}">${c.what || (c.before ? 'Before a restore' : 'Daily copy')}</td><td class="s m" style="white-space:nowrap">${bytes(c.size)}</td>
        <td style="text-align:right">${st && st.name === c.name ? html`<span class="chip warn">Waiting</span>` : html`<button class="btn sm" data-act="restore" data-name="${c.name}" data-busy="Checking…" data-confirm="Put back the copy from ${exact(c.at)}?\n\nEverything added or changed since then is replaced. What you have now is saved first, as a copy of its own, so you can come back to it.\n\nNothing changes until Job Hunt next starts." title="Checks this copy and gets it ready. It takes the place of your data when Job Hunt next starts; what you have now is saved first.">Restore this copy</button>`}</td></tr>`)}</tbody></table>
`
      : html`<p class="s m">No copies yet. The first is saved within a day, or press Save a copy now.</p>`}
    <div class="hr"></div>
    <div class="col" style="gap:6px" data-set="cloud"><h4>On another computer, or safe if this one breaks</h4>
      <p class="xs m">Keep the copies inside a cloud drive's folder and the drive's own program carries them off this computer. On the other computer, install Job Hunt and keep its copies in the same folder: when it starts, it offers to carry on where you left off. A spreadsheet of your applications is kept there too, up to date. Use Job Hunt on one computer at a time: nothing is merged.</p>
      ${b.other ? html`<div style="background:var(--accent-soft);padding:10px 12px;border-radius:8px">${carryOn(b.other)}</div>` : ''}
      ${handed ? html`<div class="s" style="background:var(--good-soft, var(--accent-soft));padding:10px 12px;border-radius:8px"><b>Handed over at ${when(handed.at)}.</b> A fresh copy is in ${handed.dir}. Stop Job Hunt here, then open it on the other computer and choose Continue. Give the drive a minute to carry the copy across.
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="quit" data-confirm="Stop Job Hunt on this computer?">Stop Job Hunt here</button></div></div>`
        : b.custom ? html`<div class="row wrap" style="gap:8px"><button class="btn sm" data-act="handover" data-busy="Saving…" title="Saves a fresh copy in the copies folder now, for the other computer to carry on from.">Hand over to the other computer</button><span class="xs m grow">This computer is ${b.computer}.</span></div>` : ''}
      ${(b.cloud || []).length ? html`<div class="row wrap">${b.cloud.map(c => c.used ? html`<span class="chip good" title="${c.dir}">Copies are kept in ${c.name}</span>` : html`<button class="btn sm" data-act="cloudcopies" data-dir="${c.dir}" title="Makes the folder ${c.dir} and keeps the copies there, refreshed every three hours.">Keep copies in ${c.name}</button>`)}</div>`
        : html`<p class="xs m">No Google Drive, OneDrive or Dropbox folder was found on this computer. Install Google Drive for desktop (or OneDrive) and come back, or paste any folder below.</p>`}</div>
    <div class="hr"></div>
    <form data-act="savebackups" class="col" style="gap:8px"><div class="grid2" style="grid-template-columns:minmax(0,1fr) 150px"><label class="field">Where copies are kept <span class="h">The whole path of a folder that is already there, such as one on another drive. Leave empty for the data folder.</span><input type="text" name="dir" value="${b.custom ? b.dir : ''}" placeholder="${b.default_dir}" autocomplete="off" spellcheck="false"></label>
      <label class="field">Keep the newest<select name="keep">${[7, 14, 30].map(n => html`<option value="${n}" ${b.keep === n ? 'selected' : ''}>${n} copies</option>`)}</select></label></div>
      <div class="row wrap"><button class="btn sm p">Save</button>${pick ? html`<button type="button" class="btn sm" data-act="pickfolder" data-for="dir" data-title="Where should Job Hunt keep the copies of your data?">Choose a folder…</button>` : ''}<button type="button" class="btn sm" data-act="openfolder" data-what="backups" title="Opens the folder the copies are in.">Open the folder</button><span class="xs m grow" style="word-break:break-all">Now in ${b.dir}</span></div></form></div>`;
}

// Every tailored CV and letter, also kept as files in a folder of the person's choosing.
function filesCard(fl) {
  if (!fl) return '';
  const shown = fl.folders.slice(0, listSize('files'));
  return html`<div class="card col" style="gap:10px" data-set="files"><div class="row"><div class="grow"><h4>Your CVs and letters as files</h4><p class="xs m" style="margin-top:3px">Each CV and letter Job Hunt writes is also saved as Word and PDF, in a folder of its own for each role.</p></div>${fl.dir ? html`<button class="btn sm" data-act="showfiles" data-folder="">Show files</button>` : ''}</div>
    <form data-act="savefiles" class="col" style="gap:8px">
      <label class="row s" style="font-weight:500"><input type="checkbox" name="on" ${fl.off ? '' : 'checked'}> Keep every CV and letter in a folder</label>
      <label class="field">Folder <span class="h">The whole path. Leave empty for ${fl.default || 'Documents'}.</span><input type="text" name="dir" value="${fl.custom ? fl.dir : ''}" placeholder="${fl.default}" autocomplete="off" spellcheck="false"></label>
      <div class="row wrap"><button class="btn sm p">Save</button>${fl.pick ? html`<button type="button" class="btn sm" data-act="pickfolder" data-for="dir" data-title="Where should Job Hunt keep your CVs and letters?">Choose a folder…</button>` : ''}</div></form>
    ${fl.folders.length ? html`<div class="eb">Tailored files</div><div class="col" style="gap:8px">${shown.map(f => html`<div class="row" style="gap:8px"><div class="grow" style="min-width:0"><div class="s">${f.name}</div><div class="xs m">${rel(f.at)} · ${f.files.map(x => x.name).join(' · ')}</div></div><button class="btn sm ghost" data-act="showfiles" data-folder="${f.name}">Show</button></div>`)}</div>${endless('files', shown.length, fl.folders.length, true)}`
      : html`<p class="xs m">${fl.off ? 'Off.' : 'No files yet. They appear as roles are prepared.'}</p>`}</div>`;
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
    ${looks()}${copies(d.backups, route, d.files?.pick)}
  </div><div class="col" style="gap:14px">
    ${filesCard(d.files)}
    ${d.history?.length ? html`<div class="card col" style="gap:6px"><h4>What changed in each version</h4>${d.history.slice(0, 3).map(h => html`<details ${h.version === d.version ? 'open' : ''}><summary class="s">${h.version}${h.version === d.version ? ' · this one' : ''}</summary><div class="news" style="margin-top:6px"><ul>${h.text.split('\n').filter(l => l.trim()).map(l => html`<li>${l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}</li>`)}</ul></div></details>`)}
      ${d.history.length > 3 ? html`<details><summary class="s">Earlier versions (${d.history.length - 3})</summary>${d.history.slice(3).map(h => html`<div class="news" style="margin-top:8px"><h4>${h.version}</h4><ul>${h.text.split('\n').filter(l => l.trim()).map(l => html`<li>${l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')}</li>`)}</ul></div>`)}</details>` : ''}</div>` : ''}
    ${d.old ? oldCard(d.old, false) : ''}
  </div></div>`;
}

// Debugging: the record to copy when reporting a problem, recent problems,
// what Claude was used for, and changes Job Hunt made to settings by itself.
function debugging(d) {
  return html`<div class="grid2" style="align-items:start"><div class="col" style="gap:14px">
    ${d.debug ? html`<div class="card col" style="gap:8px" data-set="debug"><div class="row"><h4 class="grow">Debugging</h4><button class="btn sm p" data-act="copydebug" title="Copies the report below so you can paste it when reporting a problem. It leaves out your name, e-mail addresses and keys.">Copy debug details</button><a class="btn sm" href="/api/debug/report" download title="Saves a longer report (the newest 4,000 lines) as a text file.">Save as a file</a><button class="btn sm" data-act="openfolder" data-what="data" title="Opens the folder that holds your data and debug.log.">Open the folder</button></div>
      <p class="xs m">Job Hunt writes down everything it does: each search and page it fetches, each call to Claude, each background job, each error in the program or in a page. Your name, e-mail addresses and keys are left out. The file is debug.log in your data folder.</p>
      <pre class="xs" style="margin:0;background:var(--s2);border-radius:8px;padding:9px 10px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;line-height:1.45">${d.debug.report.split('\n').slice(-45).join('\n')}</pre>
      <p class="xs m">The newest 45 lines. Copy or save for the rest.</p></div>` : ''}
    ${d.problems?.length ? html`<div class="card"><h4>Recent problems</h4><div class="col s" style="margin-top:10px;gap:8px">${d.problems.map(a => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:70px;flex:none">${rel(a.at)}</span><span>${a.text}</span></div>`)}</div></div>` : ''}
  </div><div class="col" style="gap:14px">
    <div class="card" data-set="calls"><h4>Claude, lately</h4><p class="xs m" style="margin-top:3px">${d.today.calls} calls in the last day, ${d.week.calls} this week${d.week.cost ? html` · $${d.week.cost.toFixed(2)}` : ''}${d.week.errors ? html` · ${d.week.errors} failed` : ''}</p>
      <table class="tbl" style="margin-top:8px"><tbody>${(d.calls || []).map(c => html`<tr><td class="xs m" style="white-space:nowrap">${when(c.at)}</td><td class="s">${c.task.replace(/_/g, ' ')}</td><td class="xs m">${(c.ms / 1000).toFixed(1)} s</td><td class="xs" style="color:var(--crit)">${c.error ? c.error.slice(0, 80) : ''}</td></tr>`)}</tbody></table></div>
    ${d.changes?.length ? html`<div class="card"><h4>Changes Job Hunt made to your settings</h4><div class="col s" style="margin-top:10px;gap:8px">${d.changes.map(c => html`<div class="row top-al" style="gap:10px"><span class="xs m" style="width:70px;flex:none">${rel(c.at)}</span><span class="grow">${c.what} <span class="m">· ${c.why}</span></span></div>`)}</div></div>` : ''}
  </div></div>`;
}

export default {
  title: (d, route) => route.parts[0] === 'settings' ? 'Settings' : 'You',
  sub: (d, route) => route.parts[0] === 'settings' ? ({ connections: 'Claude, more job sources, your phone, your inbox, this computer, and when to search', panel: 'Get it, put it in your browser, connect it', app: 'Version, updates, your data and saved copies', debug: 'What Job Hunt has been doing, and the record to send with a problem' })[route.parts[1] || 'connections']
    : ({ '': 'What Job Hunt knows and looks for', arriving: 'Closing the gap for a newcomer' })[route.parts[1] || ''],
  topics: ['you', 'profile', 'connections', 'app'],
  load(route) {
    const tab = route.parts[0] === 'settings' ? route.parts[1] || 'connections' : route.parts[1] || '';
    switch (tab) {
      case 'arriving': return api('arriving');
      case 'panel': return api('connections');
      case 'connections': return Promise.all([api('connections'), api('phoneaccess').catch(() => null), api('owncal').catch(() => null), api('google').catch(() => null), api('searchset').catch(() => null)]).then(([c, pa, oc, g, ss]) => ({ ...c, phoneaccess: pa, owncal: oc, google: g, searchset: ss }));
      case 'app': return Promise.all([api('app'), api('import/old').catch(() => null), api('changes').catch(() => []), api('backups').catch(() => null), api('files').catch(() => null)]).then(([a, o, h, b, fl]) => ({ ...a, old: o, history: h, backups: b, files: fl }));
      case 'debug': return Promise.all([api('app'), api('debug').catch(() => null)]).then(([a, g]) => ({ ...a, debug: g }));
    }
    if (route.q.cv) return Promise.all([api('you'), api(`cvs/${route.q.cv}/look`).catch(() => null)]).then(([y, k]) => ({ ...y, cvlook: k }));
    return api('you');
  },
  view(d, route) {
    const find = html`<div class="setfind"><input type="text" id="setfind" placeholder="Find a setting" aria-label="Find a setting" autocomplete="off" title="Type what you are looking for, such as dark, salary, backup or phone. Enter opens the first match."><div class="found" id="setfound" hidden></div></div>`;
    if (route.parts[0] === 'settings') {
      const tab = route.parts[1] || 'connections';
      return html`<div class="body"><div class="setwrap"><nav class="setmenu" aria-label="Settings">${find}
        ${SECTIONS.map(([k, v, w]) => html`<a class="${k === tab ? 'on' : ''}" href="#/settings/${k}" ${k === tab ? 'aria-current="page"' : ''}><b>${v}</b><span class="xs m">${w}</span></a>`)}</nav>
        <div class="setbody">${tab === 'panel' ? panel(d) : tab === 'app' ? theApp(d, route) : tab === 'debug' ? debugging(d) : connections(d, route)}</div></div></div>`;
    }
    const tab = route.parts[1] || '';
    return html`<div class="body"><div class="tabs">${TABS.map(([k, v]) => html`<a class="${k === tab ? 'on' : ''}" href="#/you${k ? '/' + k : ''}">${v}</a>`)}
        <a href="#/settings/connections" title="Connections, the browser side panel, the app and debugging have their own page">Settings →</a>${find}</div>
      ${tab === 'arriving' ? arriving(d) : about(d, route)}</div>`;
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
        if (up && (gone || Date.now() - began > 6000)) { location.hash = '#/settings/app'; location.reload(); return; }
        if (Date.now() - began > 60000) { document.body.innerHTML = '<div class="setup"><div class="card empty"><h3>Job Hunt did not come back</h3><p>Start it again from the Start menu. A copy that was waiting is put back then.</p></div></div>'; return; }
        setTimeout(look, 700);
      };
      setTimeout(look, 900);
      return false;
    },
    async checkupdate() { const r = await post('update/check'); toast(r.update ? `Version ${r.update.version} is ready` : 'This is the newest version'); },
    autoupdate: ({ value }) => put('update', { auto: value }).then(() => toast(value ? 'New versions install by themselves' : 'Job Hunt will only tell you about new versions')),
    async savedesk({ f, data }) {
      const set = { notify: !!f.notify, awake: f.awake, morning: +f.morning };
      if (data.pc?.power) set.wake = !!f.wake;
      if (f.browser !== undefined) set.browser = f.browser;
      await put('desk', set);
      if (data.startup?.can && !!f.startup !== !!data.startup.on) await put('startup', { on: !!f.startup });
      toast('Saved');
    },
    testdesk: () => post('desk/test').then(() => { toast('Sent. It shows by the clock.'); return false; }),
    savesearchset: ({ f }) => put('searchset', { ratings_off: !f.ratings, min_rating: +f.min_rating || 0, clear_days: +f.clear_days || 0, budget: !!f.budget }).then(() => toast('Saved')),
    usesuggest: ({ data }) => put('schedule', { full: data.suggest.full, fast_minutes: data.schedule?.fast_minutes ?? 20, from: data.suggest.from, to: data.suggest.to }).then(() => toast('Saved. The next searches follow these times.')),
    async saveschedule({ f }) {
      const full = f.full.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).map(t => { const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t); if (!m) throw new Error(`"${t}" isn't a time. Write times like 07:00 or 17:30.`); let h = +m[1]; if (/pm/i.test(m[3] || '') && h < 12) h += 12; if (/am/i.test(m[3] || '') && h === 12) h = 0; return h * 60 + +(m[2] || 0); });
      await put('schedule', { full, fast_minutes: +f.fast_minutes, from: +f.from, to: +f.to });
      toast('Saved. The next searches follow this.');
    },
    async saveprofile({ f, d, route }) {
      // Each group sends only its own fields; the rest of the profile stays as it is.
      const wp = ['remote', 'hybrid', 'onsite'].filter(w => f['wp_' + w]);
      const body = {
        me: () => ({ name: f.name, headline: f.headline, rare: f.rare, city: f.city, places: lines(f.places), country: f.country, home: f.home, arrive_on: f.arrive_on, work_status: f.work_status, pay_floor: +f.pay_floor || 0, start_early: !!f.start_early }),
        look: () => ({ titles: { level: titleLines(f.level), step_up: titleLines(f.step_up), sideways: titleLines(f.sideways) }, domain: lines(f.domain), avoid: lines(f.avoid), workplaces: wp.length === 3 ? [] : wp }),
        limits: () => ({ pay_strict: !!f.pay_strict, max_age_days: +f.max_age_days || 0, no_types: ['contract', 'part-time', 'internship'].filter(k => f['no_' + k]) }),
        matters: () => ({ matters: f.matters }),
        wants: () => ({ seniority: f.seniority, terms: f.terms, industries: lines(f.industries), no_industries: lines(f.no_industries), deal_breakers: titleLines(f.deal_breakers), career_path: f.career_path.trim() }),
        letters: () => ({ letter_style: f.letter_style, signature: f.signature, chase_days: Math.max(0, +f.chase_days || 0), weekly_goal: Math.max(0, Math.round(+f.weekly_goal) || 0) }),
        auto: () => ({ keep_fit: Math.min(95, Math.max(30, Math.round(+f.keep_fit) || 55)), prepare_fit: Math.min(100, Math.max(30, Math.round(+f.prepare_fit) || 70)), prepare_max: Math.max(0, Math.round(+f.prepare_max) || 0), may_prepare: f.may_prepare }),
      }[d.group];
      if (!body) return false;
      await put('profile', body());
      toast('Saved. The next search uses this.');
      location.hash = with_(route, { open: '' });
    },
    async addsig({ el }) { const file = el.files[0]; if (!file) return false; await api('profile/signature-picture', { method: 'POST', raw: file }); toast('Your signature goes into every letter from now on'); },
    dropsig: () => del('profile/signature-picture').then(() => toast('Letters are signed with your name only')),
    async addcv({ el }) { const file = el.files[0]; if (!file) return false; toast('Reading your CV. About a minute.'); await api('cvs?name=' + encodeURIComponent(file.name), { method: 'POST', raw: file }); toast('CV added'); },
    async delcv({ d, route }) {
      const r = await del(`cvs/${d.id}`);
      toast(r.redoing ? `Removed. ${r.redoing} waiting role${r.redoing === 1 ? ' is' : 's are'} being scored and written again, with your own edits kept.` : 'Removed');
      location.hash = with_(route, { cv: '' });
      return false;
    },
    savecv: ({ d, f }) => put(`cvs/${d.id}`, { name: f.name, titles: titleLines(f.titles), keywords: lines(f.keywords), letter_style: f.letter_style }).then(() => toast('Saved. Its titles are searched from the next search.')),
    async moretitles({ d }) {
      const r = await post(`cvs/${d.id}/titles`);
      moreTitles.set(+d.id, r.titles || []);
      if (!(r.titles || []).length) toast('No more titles to suggest. You already look for the ones this CV suits.');
    },
    async addtitles({ el, d, data }) {
      const ticked = [...el.form.querySelectorAll('input[name=more]:checked')].map(i => i.value);
      if (!ticked.length) { toast('Tick the titles to add first.', true); return false; }
      await put(`cvs/${d.id}`, { titles: [...(data.cvlook?.set?.titles || []), ...ticked] });
      moreTitles.delete(+d.id);
      toast(`Added ${ticked.length} title${ticked.length === 1 ? '' : 's'}. They are searched from the next search.`);
    },
    droptitles({ d }) { moreTitles.delete(+d.id); },
    async replacecv({ el, d }) {
      const file = el.files[0];
      if (!file) return false;
      toast('Reading the new file. About a minute.');
      const r = await api(`cvs/${d.id}/file?name=` + encodeURIComponent(file.name), { method: 'POST', raw: file });
      toast(r.redoing ? `New file read. ${r.redoing} waiting role${r.redoing === 1 ? ' is' : 's are'} being scored and written again, with your own edits kept.` : 'New file read.');
    },
    addfact: ({ f, el }) => post('facts', { text: f.text }).then(() => el.reset()),
    delfact: ({ d }) => del(`facts/${d.id}`),
    delanswer: ({ d }) => del(`answers/${d.id}`),
    build: () => post('arriving').then(() => toast('Writing your arrival pack. About a minute.')),
    toggle: ({ d }) => post('arriving/change', { index: +d.i, off: !!d.off }),
    apply: () => post('arriving/apply').then(() => toast('A copy of your CV in local form was added under You')),
    async savellm({ f }) {
      if (!f.engine) throw new Error('Choose how to reach Claude.');
      await put('llm', { engine: f.engine, key: f.key || '', model: f.model, daily_limit: +f.daily_limit || 0, score_model: f.score_model || '', write_model: f.write_model || '', effort: f.effort || '', grouped: !!f.grouped });
      toast('Saved');
    },
    async testllm() { const r = await post('llm/test'); toast(r.message); return false; },
    async saveother({ f }) {
      const r = await put('otherai', { on: !!f.on, use: f.use, base: (f.base || '').trim(), model: (f.model || '').trim(), key: (f.key || '').trim() });
      toast(r?.message || 'Saved');
    },
    async testother() { const r = await post('otherai/test'); toast(r.message); return false; },
    delother: () => del('otherai').then(() => toast('Key removed. Claude does all the work again.')),
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
    savetalkset({ el }) { const f = el.closest('form'); return put('talkset', { from: +f.t_from.value, to: +f.t_to.value, minutes: +f.t_minutes.value, offer: +f.t_offer.value }).then(() => toast('Saved')); },
    async savecal({ f }) { await put('owncal', { url: f.url }); toast('Connected. Your entries are on the month under Interviews.'); },
    forgetcal: () => del('owncal').then(() => toast('Disconnected')),
    savegoogle: ({ f }) => put('google', { client_id: (f.client_id || '').trim(), client_secret: (f.client_secret || '').trim() }).then(() => toast('Saved. Now press Sign in with Google.')),
    async signingoogle() {
      const r = await post('google/signin');
      // Google's page opens in the browser; it sends the browser back to Job Hunt by itself.
      const w = window.open(r.url, '_blank');
      if (w) w.opener = null;
      else if (!window.jhNative) location.href = r.url;
      toast('Google\'s sign-in page is open in your browser.');
      return false;
    },
    async syncgoogle() { await post('google/sync'); toast('Synced with Google Calendar'); },
    async testgoogle() { const r = await post('google/test'); toast(r.message); return false; },
    signoutgoogle: () => post('google/signout').then(() => toast('Signed out of Google')),
    forgetgoogle: () => del('google').then(() => toast('Removed')),
    copyfree: ({ d }) => copy(d.text).then(() => false),
    async handover() { const r = await post('backups/handover'); handed = r.handed; toast('Handed over. Stop Job Hunt here, then carry on on the other computer.'); },
    cloudcopies: ({ d }) => post('backups/cloud', { dir: d.dir }).then(() => toast('Copies are kept there from now on. One was saved just now.')),
    savephone: ({ f }) => put('phone', { on: !!f.on, topic: f.topic, server: f.server, min_fit: +f.min_fit || 75, quiet_from: +f.quiet_from || 0, quiet_to: +f.quiet_to || 0, detail: !!f.detail, only: f.only || '' }).then(() => toast('Saved')),
    newtopic({ el }) { const a = new Uint8Array(12); crypto.getRandomValues(a); el.closest('form').querySelector('[name=topic]').value = 'jobhunt-' + [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); return false; },
    async testphone() { await post('phone/test'); toast('Sent. It should arrive on your phone in a few seconds.'); return false; },
    // A new key is tried with one small search first; one the service refuses is not saved.
    savesource: ({ f, d }) => put(`sources/${d.id}`, d.id === 'alerts' || d.id === 'indeed' ? { on: !!f.on } : { app_id: (f.app_id || '').trim(), key: (f.key || '').trim(), from: f.from || '', on: !!f.on, limit: +f.limit || 0 }).then(r => toast(r?.warning || ((f.key || '').trim() ? 'Tried and saved. The key works.' : 'Saved'))),
    async vpnfile({ el }) {
      const file = el.files[0]; if (!file) return false;
      if (file.size > 16384) { toast('That file is too large to be a WireGuard configuration'); return false; }
      toast('Connecting to the VPN server…');
      const r = await put('vpn', { file: await file.text() });
      toast(r.message);
    },
    async vpncheck() { const r = await post('vpn/check'); toast(r.message); return false; },
    vpnoff: () => del('vpn').then(() => toast('Every source goes over your own connection again')),
    vpnthrough: ({ d, value }) => put(`vpn/${d.id}`, { on: value }),
    async testsource({ d }) { const r = await post(`sources/${d.id}/test`); toast(r.message); },
    delsource: ({ d }) => del(`sources/${d.id}`).then(() => toast('Key removed')),
    scanrecruiters: () => post('mail/recruiters').then(() => toast('Looking through your mail for recruiters. This takes a few minutes.')),
    savemail: ({ f }) => put('mailset', { on: !!f.on, user: f.user, pass: f.pass || '', host: f.host, every: Math.min(240, Math.max(5, +f.every || 10)), drafts: !!f.drafts, send: !!f.send, labels: !!f.labels, recruiters: !!f.recruiters }).then(() => toast(f.on ? 'Connected. Job Hunt is reading recent replies.' : 'Saved')),
    copytext: ({ d }) => copy(d.text).then(() => false),
    copydebug: () => api('debug').then(g => copy(g.report)).then(() => false),
    openfolder: ({ d }) => post('open-folder', { what: d.what }).then(() => false),
    async pickfolder({ el, d }) {
      const f = el.closest('form'), box = f.elements[d.for];
      const r = await post('pick-folder', { title: d.title, start: box.value || box.placeholder });
      if (r.dir) box.value = r.dir;
      return false;
    },
    savefiles: ({ f }) => put('files', { off: !f.on, dir: (f.dir || '').trim() }).then(() => toast(f.on ? 'Saved. New CVs and letters are kept there.' : 'Saved. No more files are written.')),
    showfiles: ({ d }) => post('files/show', { folder: d.folder }).then(() => false),
    saveclip: ({ value }) => put('desk', { clip: value }).then(() => toast(value ? 'On. Copy a link to a posting and Job Hunt offers to add it.' : 'Off. Copied links are left alone.')),
    allowwake: () => post('desk/allow-wake').then(() => toast('Wake timers are allowed while this computer is plugged in')),
    installclaude: () => post('claude-code/install').then(() => toast('Installing Claude Code. A notice says when it is done, in about a minute.')),
    signinclaude: () => post('claude-code/signin').then(() => { toast('Claude Code opened in its own window. Sign in there, then come back and press Test it.'); return false; }),
    bookmarkhelp: () => { toast('Drag this button to your bookmarks bar, then press it there on a posting.'); return false; },
    pair: () => post('ext/pair').then(() => toast('The side panel is connected')),
    unpair: () => post('ext/unpair'),
    async backup() { const r = await post('backup'); toast('Saved to ' + r.path); return false; },
    async quit() { await post('quit'); document.body.innerHTML = '<div class="setup"><div class="card empty"><h3>Job Hunt has stopped</h3><p>Start it again from the Start menu.</p></div></div>'; return false; },
  },
};
