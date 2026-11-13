// Job Hunt screens, continued. Settings, progress bars, connections, finding a job, and the keyboard.
'use strict';

// ---- Settings ----
const lines = v => (v || []).join('\n');
const fromLines = s => s.split(/\n|,/).map(x => x.trim()).filter(Boolean);
let settingsCache = null;

/** Your answers to the questions application forms keep asking, learned as you submit forms, and
 *  whether Job Hunt may submit simple forms for you. */
async function renderBank() {
  const box = $('#bankCard'); if (!box) return;
  let b;
  try { b = await api('/api/answer-bank'); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<header><h2>Your saved answers</h2>${b.answers.length ? `<span class="pill">${b.answers.length}</span>` : ''}</header>
    <p class="muted">When you submit a form, Job Hunt keeps your answers to the questions forms keep asking (work authorization, notice period, salary, how you heard about the job…) and fills them in next time without asking Claude: faster, the same answer everywhere, and less of your plan. Answers about one employer (why this role, your cover letter) aren't kept.</p>
    ${b.answers.length ? `<div class="bank">${b.answers.map((x, i) => `<div class="bank-row" data-i="${i}"><input type="text" class="bank-q" value="${esc(x.q)}" aria-label="Question"><input type="text" class="bank-a" value="${esc(x.a)}" aria-label="Your answer"><span class="muted small" title="Times used">${x.uses ? `used ${x.uses}×` : ''}</span><button class="btn ghost sm icon-only" data-act="bankDrop" data-i="${i}" title="Forget this answer">${svg('close')}</button></div>`).join('')}</div>` : '<p class="empty small">None yet: they appear after your first form.</p>'}
    <div class="row"><button class="btn" data-act="bankAdd">Add one</button>${b.answers.length ? '<button class="btn primary" data-act="bankSave">Save changes</button>' : ''}</div>
    <h3 class="sub">Submitting for you</h3>
    <label class="check"><input type="checkbox" data-act="autoSubmit" ${b.auto_submit ? 'checked' : ''}> <span>Submit simple forms for me<br><span class="muted small">Only on Greenhouse, Lever and Ashby forms, and only when every required question is answered from your saved answers, facts and files, nothing long was written for this job, there's no captcha and no box left for you to tick. It counts down 10 seconds first, with a Stop button. Anything else waits for you to press Submit.</span></span></label>`;
}
const bankRows = () => [...document.querySelectorAll('#bankCard .bank-row')].map(r => ({ q: r.querySelector('.bank-q').value, a: r.querySelector('.bank-a').value }));

/** The browser extension, in Settings → App: what it does, the download, the key to paste into it,
 *  the steps for Edge (and Chrome), and whether it has reached Job Hunt yet. */
function extensionCard(st) {
  const browser = st.app.browser === 'chrome' ? 'Chrome' : 'Edge';
  const page = browser === 'Chrome' ? 'chrome://extensions' : 'edge://extensions';
  return `<section class="card" id="extCard"><header><h2>Browser extension</h2>${st.ext_last ? `<span class="pill good" title="Last reached Job Hunt ${esc(ago(st.ext_last))}">Connected</span>` : '<span class="pill">Not connected yet</span>'}</header>
    <p class="muted"><b>Send to Job Hunt</b> in ${browser}: send a posting you're looking at to Job Hunt, and fill in application forms in your own browser, with your sign-ins and password manager, from your tailored CV and letter.</p>
    <label class="field" style="max-width:420px">Open links in<select data-act="browserPick">${[['', "Windows' default browser"], ['edge', 'Microsoft Edge'], ['chrome', 'Google Chrome']].map(([v, n]) => `<option value="${v}" ${(st.app.browser || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Postings, company sites, and Fill it in my own browser open there.</span></label>
    <ol class="small steps-list">
      <li>Job Hunt keeps the extension in this folder, and updates it with each new version: <span class="copy-row" style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"><code id="extDir">${esc(st.ext_folder || '')}</code><button class="btn ghost sm" data-act="copy" data-from="extDir">Copy</button><button class="btn ghost sm" data-act="folder" data-which="extension">Open the folder</button></span></li>
      <li>In ${browser}, open <code>${page}</code>, turn on <b>Developer mode</b>${browser === 'Edge' ? ' (at the bottom of the left side)' : ' (top right)'}, press <b>Load unpacked</b> and choose that folder (paste it into the folder box). Had it from a download before? Remove that copy first, so there's only one.</li>
      <li>Pin it: the puzzle-piece icon by the address bar → the eye or pin next to <b>Send to Job Hunt</b>.</li>
      ${st.ext_key ? `<li>Click it once and paste this key, then press <b>Save the key</b>: <span class="copy-row" style="display:inline-flex;gap:6px;align-items:center"><code id="extKey2">${esc(st.ext_key)}</code><button class="btn ghost sm" data-act="copy" data-from="extKey2">Copy</button></span></li>` : ''}
    </ol>
    <p class="muted small">Then on any application form, click it and press <b>Fill this form</b>; on a posting, <b>Send this job to Job Hunt</b>. Job Hunt needs to be running on this PC. It updates itself: after Job Hunt updates, the extension reloads with the new version when you next open it or start ${browser}. For another PC or browser profile, <a href="/api/extension.zip" download>download it</a> instead (that copy doesn't update itself).</p></section>`;
}

/** After Install and restart, from your phone (or a browser): Job Hunt on the PC goes away for a
 *  moment while it installs and restarts; this page reloads once it's back on the new version. */
async function waitForRestart(before) {
  if (!before) return;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (!r.ok) continue;
      const v = (await r.json())?.app?.version || '';
      if (v && v !== before) { location.reload(); return; }
    } catch (e) { /* restarting */ }
  }
  toast('Job Hunt hasn\'t come back yet. Check the PC: it may still be installing.', true);
}

/** Services that work the way OpenAI's API does: name, address ('' for one you type), and where its key comes from. */
const OTHER_AI = [['Grok (xAI)', 'https://api.x.ai/v1', 'console.x.ai'], ['ChatGPT (OpenAI)', 'https://api.openai.com/v1', 'platform.openai.com'], ['Gemini (Google)', 'https://generativelanguage.googleapis.com/v1beta/openai', 'aistudio.google.com'],
  ['OpenRouter (many models, one key)', 'https://openrouter.ai/api/v1', 'openrouter.ai'], ['On this PC (Ollama, no key)', 'http://localhost:11434/v1', ''], ['Another one', '', '']];
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches?.('form[data-form=other] [name=service]')) {
    const form = t.form, known = OTHER_AI.find(x => x[1] === t.value);
    form.querySelector('[data-other-url]').hidden = !!t.value;
    form.querySelector('[data-other-keyhint]').textContent = known?.[2] ? `Create one at ${known[2]}.` : t.value ? 'None needed.' : '';
    form.elements.model.innerHTML = '<option value="">Press Check to see its models</option>';
  }
  if (t.matches?.('[name=searches_per_day]')) { const s = t.form?.querySelector('[data-second-search]'); if (s) s.hidden = t.value !== '2'; }
});
/** Which model does what, in a line: from the Claude settings ({engine, model, tailor_model, score_model}). */
function modelsLine(c) {
  const api = c.engine === 'api';
  const name = m => {
    const k = (m || '').trim().toLowerCase();
    if (k === 'opus' || k === 'claude-opus-5-5') return api ? 'Opus 5.5' : 'Opus';
    if (k === 'sonnet' || k === 'claude-sonnet-5-5') return api ? 'Sonnet 5.5' : 'Sonnet';
    return k ? m.trim() : api ? 'Opus 5.5' : "Claude Code's default";
  };
  const other = name(c.model);
  const pick = m => (m || '').trim() ? name(m) : other;
  return `Searching, scoring and filling in forms: <b>${esc(pick(c.score_model))}</b> · CVs and cover letters: <b>${esc(pick(c.tailor_model))}</b> · Everything else (email, interview prep): <b>${esc(other)}</b>.`;
}

/** The cards of one group of settings, as HTML, with a marker before each (<!--@name-->) so the
 *  Settings pages can put them where they belong (see settingsBody and cut). `host`: Me's pages
 *  (CVs, Looking for) are drawn here whole, under their own heading; SET_RAW gives the HTML back. */
const SET_RAW = Symbol('raw');
/** A marked body, cut into its pieces by name. */
function cut(html) {
  const out = {};
  const parts = String(html).split(/<!--@([a-z_]*)-->/);
  for (let i = 1; i < parts.length; i += 2) if (parts[i] !== '_') out[parts[i]] = (out[parts[i]] || '') + parts[i + 1];
  return out;
}
async function settingsCards(tab, sub, host, given) {
  const st = given || (settingsCache = await api('/api/settings'));
  const p = st.profile;
  let body = '';
  if (tab === 'connections') {
    body = `<!--@attention--><section class="card attention" id="connStatus" hidden></section>
    <!--@claude--><section class="card" id="claudeCard"><header><h2>Claude</h2><span id="ccPill">${st.claude.engine === 'api' ? (st.claude.key ? '<span class="pill good">API key saved</span>' : '<span class="pill warn">Needed</span>') : (st.claude.code_found ? '<span class="pill">Checking…</span>' : '<span class="pill warn">Not found</span>')}</span></header>
      <p class="muted">Claude is the AI that reads job postings, picks the ones that fit you, rewrites your CV and cover letter for each, and sorts your job email.</p>
      <form data-form="claude" class="stack" style="gap:14px">
        <label class="check"><input type="radio" name="engine" value="code" ${st.claude.engine !== 'api' ? 'checked' : ''}> <span><b>Your Claude subscription</b> <span class="muted">(recommended)</span><br><span class="muted small">Your Claude Pro or Max plan, through Claude Code, a free helper from Anthropic that Job Hunt can install for you. Nothing extra to pay; each search uses some of your plan's usage.</span></span></label>
        <div id="ccStatus" class="small muted" style="margin-left:26px" ${st.claude.engine === 'api' ? 'hidden' : ''}><span class="spin" data-kind="check" data-secs="6"></span> Checking…</div>
        <label class="check"><input type="radio" name="engine" value="api" ${st.claude.engine === 'api' ? 'checked' : ''}> <span><b>An API key instead</b><br><span class="muted small">For people without a Claude subscription: you pay Anthropic for what you use. Create a key at <a href="#" data-act="link" data-url="https://console.anthropic.com/settings/keys">console.anthropic.com</a>.</span></span></label>
        <label class="field" id="apiKeyField" style="margin-left:26px;max-width:420px" ${st.claude.engine === 'api' ? '' : 'hidden'}>API key<input type="password" name="claude_key" autocomplete="off" placeholder="${st.claude.key ? 'Saved. Paste a new one to replace it' : 'sk-ant-…'}"></label>
        <p class="small muted" id="modelsLine">${modelsLine(st.claude)}</p>
        <details ${st.claude.model || st.claude.path ? 'open' : ''}><summary class="small muted">Advanced: which models</summary>
        <h3 class="sub">Tailoring CVs and cover letters</h3>
        <div class="form">
          <label class="field">Model<select name="tailor_model">${[['opus', 'Opus (best writing)'], ['sonnet', 'Sonnet (faster, uses less of your plan)'], ['', 'Same as for everything else']].map(([v, n]) => `<option value="${v}" ${st.claude.tailor_model === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">How hard Claude thinks<select name="tailor_effort">${[['low', 'Low (fastest)'], ['medium', 'Medium (recommended)'], ['high', 'High (slowest, a few minutes each)']].map(([v, n]) => `<option value="${v}" ${st.claude.tailor_effort === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <h3 class="sub">Searching</h3>
        <div class="form">
          <label class="field">Model<select name="score_model">${[['sonnet', 'Sonnet (recommended: nearly the same scores, much less of your plan)'], ['opus', 'Opus'], ['', 'Same as for everything else']].map(([v, n]) => `<option value="${v}" ${st.claude.score_model === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Scoring each new posting, reading posting pages, Indeed, salaries and company ratings: most of what Job Hunt asks of Claude.</span></label>
          <label class="field">Postings scored in one request<select name="score_batch">${[[4, 'Four (recommended: your CVs are sent once for the four)'], [6, 'Six (least usage)'], [2, 'Two'], [1, 'One (most usage)']].map(([v, n]) => `<option value="${v}" ${(st.score_batch || 4) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Each request carries your CVs and the scoring instructions. Scoring several postings in one sends those once, which is most of what a search uses.</span></label>
        </div>
        <div class="form" style="margin-top:10px">
          <label class="field">Model for everything else<input type="text" name="model" value="${esc(st.claude.model)}" placeholder="Default"><span class="hint">Email sorting and the rest. Blank: Claude Code's own choice, or Opus for the API.</span></label>
          <label class="field">Claude Code location<input type="text" name="path" value="${esc(st.claude.path)}" placeholder="C:\\Users\\you\\.local\\bin\\claude.exe"><span class="hint">Only if Job Hunt can't find it.</span></label>
        </div></details>
        <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="checkClaude">Check again</button>${st.claude.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="claude">Remove API key</button>' : ''}</div>
      </form></section>
    <!--@other--><section class="card" id="otherCard"><header><h2>Another AI</h2>${st.other.for ? `<span class="pill good">${st.other.for === 'all' ? 'Used for everything' : 'Used for searching'}</span>` : '<span class="pill">Optional</span>'}</header>
      <p class="muted">Grok, ChatGPT, Gemini or a model on your own PC can do some of the work in Claude's place, so a search uses none of your Claude plan. You pay that service for what you use (a model on your PC is free).</p>
      <form data-form="other" class="stack" style="gap:14px">
        <div class="form">
          <label class="field">Use it for<select name="for">${[['', 'Nothing: Claude does everything'], ['search', 'Searching: scoring postings, titles, salaries, job alerts (most of the usage)'], ['all', 'Everything, CVs and cover letters included']].map(([v, n]) => `<option value="${v}" ${st.other.for === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">Service<select name="service">${OTHER_AI.map(([n, u]) => `<option value="${esc(u)}" ${u && st.other.url === u ? 'selected' : ''} ${!u && st.other.url && !OTHER_AI.some(x => x[1] === st.other.url) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field" data-other-url ${st.other.url && !OTHER_AI.some(x => x[1] === st.other.url) ? '' : 'hidden'}>Its address<input type="url" name="url" value="${esc(st.other.url || OTHER_AI[0][1])}" placeholder="https://…/v1"><span class="hint">Any service that works the way OpenAI's API does: the address up to and including /v1.</span></label>
          <label class="field">Key<input type="password" name="key" autocomplete="off" placeholder="${st.other.key ? 'Saved. Paste a new one to replace it' : 'From the service\'s website'}"><span class="hint" data-other-keyhint></span></label>
          <label class="field">Model<span class="row" style="flex-wrap:nowrap"><select name="model" style="flex:1">${st.other.model ? `<option selected>${esc(st.other.model)}</option>` : '<option value="">Press Check to see its models</option>'}</select><button class="btn sm" type="button" data-act="otherModels">Check</button></span><span class="hint">Check tests the address and key and lists the models; nothing is used.</span></label>
        </div>
        <p class="small muted">Looking things up on the web stays with Claude through your subscription: Indeed, company ratings, a company's own application page and finding recruiters. Without Claude those are skipped. Scores from another AI can differ from Claude's by a few points, so matches near your fit score may fall on the other side of it.</p>
        <div class="row"><button class="btn primary" type="submit">Save</button>${st.other.url ? '<button class="btn ghost" type="button" data-act="otherForget">Remove it</button>' : ''}</div>
      </form></section>
    <!--@google--><section class="card" id="googleCard"><header><h2>Google</h2>${st.google.connected ? `<span class="pill good">Connected${st.google.email ? ` · ${esc(st.google.email)}` : ''}</span>` : '<span class="pill">Optional</span>'}</header>
      <p class="muted">One sign-in for your Gmail, Google Calendar and Drive. Everything stays in your Google account; each part has its own settings, linked here.</p>
      <div class="uses">${[
        ['Gmail', 'Sorts your job email, reads job alerts and drafts replies and follow-ups.', '#settings/mail/email', 'Email settings', st.google.connected],
        ['Calendar', 'Books interviews and reminders in your calendar.', '#settings/mail/calendar', 'Calendar settings', st.google.connected],
        ['Drive', 'Keeps your data in step between computers, with backups.', '#settings/sync', 'Sync & backup', st.google.connected && st.sync.on && st.sync.where === 'drive'],
      ].map(([n, about, href, link, on]) => `<div class="use"><b><span class="dot ${on ? 'on' : ''}"></span>${n}</b><span class="muted small">${about}</span><a class="small" href="${href}">${link} →</a></div>`).join('')}</div>
      ${st.google.connected && !st.sync.on && st.sync.drive_ready ? `<div class="advice"><b>Back up and sync to your Google Drive</b><p>Keeps everything in a private "Job Hunt" folder in your Drive, so you can install Job Hunt on any PC and pick up where you left off.</p><div class="row"><button class="btn primary" data-act="syncOn">Turn on</button></div></div>` : ''}
      ${st.google.connected ? `<div class="row">
          <button class="btn" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connecting ? '<span class="spin" data-kind="google" data-secs="90"></span>Waiting for Google…' : 'Reconnect Google'}</button>
          <button class="btn ghost" data-act="forget" data-what="google">Disconnect</button></div>`
      : st.google.client ? `<ol class="steps-list">
          <li>Press <b>Connect Google</b>. Your browser opens: sign in with your Gmail account.</li>
          <li>Google says it <b>hasn't verified</b> Job Hunt (it's a small app, not one Google has reviewed). Click <b>Advanced</b>, then <b>Go to Job Hunt</b>.</li>
          <li><b>Tick every box</b> and press <b>Continue</b>. Then come back here: Job Hunt finishes by itself.</li></ol>
        <div class="row"><button class="btn primary" data-act="google" ${st.google.connecting ? 'disabled' : ''}>${st.google.connecting ? '<span class="spin" data-kind="google" data-secs="90"></span>Waiting for Google… finish in your browser' : 'Connect Google'}</button></div>
        <p class="muted small">If Google says you don't have access, ask whoever gave you Job Hunt to add your Gmail address, then try again.</p>`
      : `<div class="advice"><b>One thing first: a Google connection file</b><p>This copy of Job Hunt doesn't have Google's connection built in. Whoever gave you Job Hunt can send you its connection file (a small file ending in <b>.json</b>). Save it, then choose it here; after that, it's one button.</p></div>
        <div class="row"><label class="btn primary">Choose the connection file<input type="file" accept=".json" data-upload="google-client" hidden></label></div>`}
      <details class="small" style="margin-top:10px"><summary class="muted">${st.google.own_client ? 'Your own connection file is in use' : 'Make your own connection file (technical, about 15 minutes)'}</summary>
        <ol class="steps-list" style="margin-top:6px">
          <li>At <a href="#" data-act="link" data-url="https://console.cloud.google.com">console.cloud.google.com</a>, create a project and enable the <b>Gmail API</b>, the <b>Google Calendar API</b> and the <b>Google Drive API</b>.</li>
          <li>Under Google Auth Platform → Audience, choose <b>External</b>, then <b>Publish app</b> (In production), or Google signs you out every 7 days.</li>
          <li>Under Clients, create a client of type <b>Desktop app</b> and download its JSON file. That's the connection file: you can give the same file to friends.</li>
          <li>Choose it here, then press Connect Google.</li>
        </ol>
        <div class="row"><label class="btn">${st.google.own_client ? 'Replace the connection file' : 'Choose a connection file'}<input type="file" accept=".json" data-upload="google-client" hidden></label>${st.google.own_client ? '<button class="btn ghost" data-act="forget" data-what="google">Remove it</button>' : ''}</div>
      </details>
      <div id="googlePaste" ${st.google.pasting ? '' : 'hidden'}>${googlePasteBox(st.google.paste_url)}</div></section>
    <!--@usage--><section class="card" id="usageCard"><p class="muted small"><span class="spin" data-kind="load" data-secs="3"></span> Loading…</p></section>`;
  } else if (tab === 'sources') {
    const desk = st.kind !== 'server' && !st.remote.here;
    // One source, as a row of the list: its name and state, what it last found, its buttons (filled
    // in from what Job Hunt knows: renderConnStatus and fillSourceRows), and its set-up, folded away.
    const tile = (id, name, tag, about, more = '', open = false) => `<article class="tile src" data-tile="${id}" id="tile-${id}">
      <header><b>${name}</b>${tag ? `<span class="tag">${tag}</span>` : ''}<span class="tile-state"></span><span class="src-last small muted"></span><span class="row src-acts"></span><span class="row tile-acts"></span></header>
      <p class="small muted">${about}</p><p class="small tile-detail"></p>
      ${more ? `<details ${open ? 'open' : ''}>${more}</details>` : ''}</article>`;
    const group = (name, rows) => rows.trim() ? `<h3 class="src-group">${name}</h3>${rows}` : '';
    const keyNote = (site, url) => `<p class="small">Get a key at <a href="#" data-act="link" data-url="${url}">${site}</a>, paste it here and press Save.</p>`;
    const T = {};
    T.boards = `${tile('boards', 'Company job boards', 'Free', 'Job Hunt finds employers near you and searches their own careers pages. Nothing to set up.',
        `<summary class="small">Choose companies yourself</summary><form data-form="profile" data-part="boards" class="stack" style="gap:10px;margin-top:8px">
          <label class="check"><input type="checkbox" name="auto_boards" ${p.sources.auto_boards !== false ? 'checked' : ''}> <span>Find employers near me by itself<br><span class="muted small">Every week, and when a search finds little that's new.</span></span></label>
          <div class="row"><button class="btn sm" type="button" data-act="suggestBoards">Suggest companies</button></div><div id="boardIdeas" class="ideas"></div>
          <div class="field">Add a company by its careers link<div class="row" style="flex-wrap:nowrap"><input type="url" id="boardLink" placeholder="https://www.affirm.com/careers" style="flex:1"><button class="btn" type="button" data-act="addBoardLink">Add</button></div>
            <span class="hint">Its careers page or any of its job postings. Job Hunt works out which job board it uses (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable or BambooHR).</span></div>
          <p class="muted small">Or type the name at the end of its careers link, like boards.greenhouse.io/<b>name</b> or jobs.lever.co/<b>name</b>. For Workday, paste the whole link.</p>
        <div class="form">
          <label class="field">Greenhouse<textarea name="greenhouse">${esc(lines(p.sources.greenhouse))}</textarea></label>
          <label class="field">Lever<textarea name="lever">${esc(lines(p.sources.lever))}</textarea></label>
          <label class="field">Ashby<textarea name="ashby">${esc(lines(p.sources.ashby))}</textarea></label>
          <label class="field">Workday<textarea name="workday" placeholder="https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1">${esc(lines(p.sources.workday))}</textarea><span class="hint">Careers links, one per line. Searched for your job titles.</span></label>
          <label class="field">SmartRecruiters<textarea name="smartrecruiters">${esc(lines(p.sources.smartrecruiters))}</textarea></label>
          <label class="field">Workable<textarea name="workable">${esc(lines(p.sources.workable))}</textarea></label>
          <label class="field">BambooHR<textarea name="bamboohr" placeholder="acme">${esc(lines(p.sources.bamboohr))}</textarea><span class="hint">The name before .bamboohr.com in the careers link.</span></label>
        </div>
        </form>`)}`;
    T.linkedin = `${tile('linkedin', 'LinkedIn', 'Free', "LinkedIn's public job search, the one anyone sees without signing in. It never touches your LinkedIn account. A few searches a day.",
        `<summary class="small">Steadier, through Apify (paid per result)</summary><form data-form="apify" class="form tile-form">
            <p class="small">With an Apify token, Job Hunt runs a LinkedIn jobs scraper on <a href="#" data-act="link" data-url="https://apify.com/store?search=linkedin%20jobs">Apify</a> instead, once per search. It gets past LinkedIn's limits and returns full descriptions. Apify's free plan includes a small monthly credit; after that you pay per result (check their prices). Sign up, then copy your token from Settings → API &amp; Integrations.</p>
            <label class="field">Apify token<input type="password" name="apify_key" autocomplete="off" placeholder="${st.apify.key ? 'Saved. Paste a new one to replace it' : 'apify_api_…'}"></label>
            <label class="field">Scraper<input type="text" name="apify_actor" value="${esc(st.apify.actor)}" placeholder="${esc(st.apify.default_actor)}"><span class="hint">Blank uses ${esc(st.apify.default_actor)}. Another LinkedIn jobs scraper from the Apify Store works too, as user/name.</span></label>
            <div class="row"><button class="btn primary" type="submit">Save</button>${st.apify.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="apify">Remove</button>' : ''}</div>
          </form>`, !!st.apify.key)}`;
    T.jobbank = p.sources.adzuna_country === 'ca' ? tile('jobbank', 'Job Bank', 'Free · Canada', "Canada's national job board, including postings found only there.") : '';
    T.freehire = tile('freehire', 'FreeHire', 'Free', "A free job search gathered from employers' own careers sites, with each posting's full text.");
    T.alerts = tile('alerts', 'Job-alert emails', 'Free', 'Set up job alerts on LinkedIn, Indeed, Job Bank, recruiters like Randstad, Adecco, Hays and Robert Half, or your country\'s job sites, sent to your Gmail, and Job Hunt reads them on every email check. Uses your <a href="#settings/accounts">Google account</a>.');
    T.jsearch = `${tile('jsearch', 'Google for Jobs', 'Free key', 'The widest reach: LinkedIn, Indeed, Glassdoor and company sites, with full descriptions. Free for about 6 searches a day.',
        `<summary class="small">${st.jsearch.key ? 'Change the key' : 'Add a key'}</summary>${keyNote('OpenWeb Ninja', 'https://www.openwebninja.com/api/jsearch')}<form data-form="jsearch" class="form tile-form">
          
          
          <label class="field">Key from<select name="jsearch_provider"><option value="openwebninja" ${st.jsearch.provider !== 'rapidapi' ? 'selected' : ''}>OpenWeb Ninja</option><option value="rapidapi" ${st.jsearch.provider === 'rapidapi' ? 'selected' : ''}>RapidAPI</option></select></label>
          <label class="field">Key<input type="password" name="jsearch_key" autocomplete="off" placeholder="${st.jsearch.key ? 'Saved. Paste a new one to replace it' : ''}"></label>
          <div class="row"><button class="btn primary" type="submit">Save</button>${st.jsearch.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="jsearch">Remove</button>' : ''}</div>
        </form>`, false)}`;
    T.jooble = `${tile('jooble', 'Jooble', 'Free key', 'Listings gathered from many job sites. It shows only part of each posting, so its scores are rougher.',
        `<summary class="small">${st.jooble.key ? 'Change the key' : 'Add a key'}</summary>${keyNote('jooble.org/api', 'https://jooble.org/api/about')}<form data-form="jooble" class="form tile-form">
          
          
          <label class="field">Key<input type="password" name="jooble_key" autocomplete="off" placeholder="${st.jooble.key ? 'Saved. Paste a new one to replace it' : ''}"></label>
          <div class="row"><button class="btn primary" type="submit">Save</button>${st.jooble.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="jooble">Remove</button>' : ''}</div>
        </form>`)}`;
    T.adzuna = `${tile('adzuna', 'Adzuna', 'Free key', 'A job search engine with listings from many sites.',
        `<summary class="small">${st.adzuna.key ? 'Change the key' : 'Add a key'}</summary>${keyNote('developer.adzuna.com', 'https://developer.adzuna.com')}<form data-form="adzuna" class="form tile-form">
          
          
          <label class="field">App ID<input type="text" name="adzuna_id" value="${esc(st.adzuna.id)}"></label>
          <label class="field">App key<input type="password" name="adzuna_key" autocomplete="off" placeholder="${st.adzuna.key ? 'Saved' : ''}"></label>
          <div class="row"><button class="btn" type="submit">Save</button>${st.adzuna.key ? '<button class="btn ghost" type="button" data-act="forget" data-what="adzuna">Remove</button>' : ''}</div>
        </form>`)}`;
    T.indeed = tile('indeed', 'Indeed', 'Uses your Claude plan', 'Searched through the Indeed connector on your Claude account: connect Indeed once at claude.ai → Settings → Connectors, then turn this on.');
    T.agencies = `${tile('agencies', 'Recruiters and job sites', 'Free', (st.sites?.catalog || []).some(x => x.country === p.sources.adzuna_country) ? 'Recruitment agencies and job sites in your country: choose which ones, or add any other site.' : `Add any job site you use in ${esc(st.countries?.find(c => c.code === p.sources.adzuna_country)?.name || 'your country')}: search on it, copy the address, and paste it in.`,
        `<summary class="small">Choose recruiters and sites</summary>${sitesForm(st)}`)}`;
    body = `<!--@list--><section class="card src-card"><header><h2>Where Job Hunt looks</h2><span class="muted small" id="srcCount"></span><button class="btn" data-act="testSources">Check them all</button></header>
      <p class="muted">Turn on the places you'd like searched. The free ones need nothing else; a few need a free key from their own website, pasted in once. Every search looks for the job titles from your CVs, in your locations.</p>
      <div id="sourceTest"></div>
      ${group('Job sites', [T.linkedin, T.jobbank, T.indeed, T.jsearch, T.adzuna, T.jooble, T.freehire].join(''))}
      ${group("Employers' own sites", T.boards)}
      ${group('Recruiters', T.agencies)}
      ${group('Sent to you', T.alerts)}
    </section>
    <!--@clip--><section class="card" id="clipCard"><header><h2>Jobs you find yourself</h2>${desk ? `<span class="pill ${st.clip_watch ? 'good' : ''}">${st.clip_watch ? 'Button on' : 'Button off'}</span>` : ''}</header>
      <p class="muted">Found a role on LinkedIn, a company site or anywhere else? ${desk ? 'Add a <b>Send to Job Hunt</b> button to your browser: on the posting, click it, and Job Hunt adds the job, scores it and puts it in your Queue to pick. Or' : ''} paste it on the <a href="#add">Add a job</a> page.</p>
      ${desk ? `<div class="row"><button class="btn primary" data-act="bookmarkSetup"><img src="/static/logo.svg" alt="" width="16" height="16">Set up the button</button><span class="muted small">Opens a page in your browser that walks you through it, so the button gets the Job Hunt logo.</span></div>
      <p class="small">Or use the <b>browser extension</b> (Chrome or Edge), which also fills in application forms: <a class="btn sm" href="#settings/extension">Set up the extension</a></p>
      <details class="small"><summary class="muted">Or add it yourself</summary><ol class="small steps-list">
        <li><button class="btn sm" data-act="copyBookmarklet">Copy the button</button>, or drag <a class="btn sm bookmarklet" href="${esc(bookmarklet())}" draggable="true" onclick="return false" title="Drag this onto your browser's bookmarks bar">${BOOKMARK_NAME}</a> to your bookmarks bar.</li>
        <li>In your browser (Chrome or Edge), show the bookmarks bar with <b>Ctrl+Shift+B</b>, right-click it → <b>Add page</b> (Edge: <b>Add favorite</b>). Name it <b>${BOOKMARK_NAME}</b>, paste into the address (URL) box, and save. Added this way it has no logo.</li></ol></details>
      <ol class="small steps-list">
        <li>Open a job posting and click the bookmark. On LinkedIn, click the job in the list so it shows on the right (or open the job itself), then click it.</li>
        <li>Job Hunt picks it up within a few seconds and tells you when it's ready. Added it before version 1.44? Add it again: the old one didn't work on LinkedIn.</li></ol>
      <label class="check"><input type="checkbox" data-act="clipWatch" ${st.clip_watch ? 'checked' : ''}> <span class="small">Pick up postings sent from the browser</span></label>` : '<div class="row"><a class="btn" href="#add">Add a job</a></div>'}
    </section>`;
  } else if (tab === 'cvs') {
    const kindName = { docx: 'Word', pdf: 'Converted from PDF', text: 'Converted from text', 'docx-converted': 'Converted to Job Hunt layout' };
    body = `<section class="card"><header><h2>Your CVs</h2>${st.cvs.length ? '<button class="btn" data-act="cvUpdateNow" title="Scores again the roles that lost their fit and tailors again the applications waiting for you, from your CVs as they are now. It starts at once; otherwise Job Hunt looks every half hour.">Update everything now</button>' : ''}<button class="btn ghost" data-act="folder" data-which="cv">${svg('folder')}Open folder</button></header>
      <p class="muted">Add as many CVs as you like, one for each kind of role. Every posting is scored against all of them and tailored from the best match.</p>
      <details class="more"><summary class="small muted">What Job Hunt changes in a CV</summary><p class="muted small">Word files are edited in place, so your formatting stays. PDF and text CVs are converted, word for word, into a clean Word copy first. Only your headline, summary, skills and bullet points are ever reworded, and an edit that adds a figure your CV doesn't state is refused.</p></details>
      <label class="drop" id="drop"><input type="file" accept=".docx,.pdf,.txt" multiple data-upload="cv-add" hidden>
        <b>Add CVs</b><span class="muted small">Drop Word, PDF or text files here, or click to choose. Claude reads each one and suggests the job titles to search for.</span></label>
    </section>
    <div id="cvUpdate">${cvUpdateHtml(st.cv_update)}</div>
    ${st.cvs.map(c => `<section class="card" data-cv="${esc(c.track)}" data-drop-cv="${esc(c.track)}" title="Drop a newer file of this CV here to replace it">
      <header><h2>${esc(c.label)}</h2><span class="pill ${c.exists ? (c.editable ? 'good' : 'warn') : 'crit'}">${c.exists ? (c.editable ? `${c.editable} parts can be tailored` : 'Layout can\'t be tailored') : 'File missing'}</span></header>
      <p class="muted small">${esc(kindName[c.kind] || 'Word')}${c.original ? ` · ${esc(c.original)}` : ''}${c.updated ? ` · updated ${esc(fmtDate(c.updated))}` : ''}</p>
      ${(c.areas || []).length ? `<div class="areas"><b class="small">Experience Claude found in it</b><ul class="small">${c.areas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${c.exists && !c.editable ? `<div class="card" style="box-shadow:none;background:var(--warn-soft);border-color:transparent"><p>Job Hunt can't find editable paragraphs in this file. Text boxes and some templates hide them. It will still write cover letters, but your CV won't be tailored.</p><div class="row"><button class="btn" data-act="convertCv" data-track="${esc(c.track)}">Convert to an editable copy</button><span class="muted small">Claude copies your CV word for word into Job Hunt's clean layout. Your original stays as it is.</span></div></div>` : ''}
      <div class="form">
        <div class="stack" style="gap:14px">
          <label class="field">Name<input type="text" data-k="label" value="${esc(c.label)}"></label>
          <label class="field">Cover-letter style<select data-k="letter_style">${[['standard', 'Standard (300–450 words)'], ['formal', 'Formal: banks, government, law'], ['short', 'Short and direct: startups, tech'], ['warm', 'Warm and personal']].map(([v, n]) => `<option value="${v}" ${(c.letter_style || 'standard') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">For letters written from this CV.</span></label>
        </div>
        <label class="field">Job titles to search for<textarea data-k="titles" style="min-height:220px">${esc(lines(c.titles))}</textarea><span class="hint">One per line. Missing a field you've worked in? Add titles here, or press Find more titles.</span></label>
        <label class="field">Keywords that also qualify a posting<textarea data-k="keywords">${esc(lines(c.keywords))}</textarea><span class="hint">A posting whose title doesn't match is still scored if it mentions one.</span></label>
      </div>
      ${c.ats ? atsHtml(c.ats) : ''}
      <div class="row">
        <button class="btn primary" data-act="saveCv" data-track="${esc(c.track)}">Save</button>
        ${c.exists ? `<button class="btn" data-act="openCv" data-track="${esc(c.track)}">${svg('doc')}Open</button>` : ''}
        <label class="btn" title="A newer version of this CV: Job Hunt then scores your waiting jobs again, tailors again what's waiting for your approval, and rewrites your career paths. You can also drop the file on this card.">Update this CV<input type="file" accept=".docx,.pdf,.txt" data-upload="cv-replace" data-track="${esc(c.track)}" hidden></label>
        <button class="btn" data-act="suggestCv" data-track="${esc(c.track)}">Find more titles</button>
        <button class="btn ghost danger" data-act="removeCv" data-track="${esc(c.track)}">Remove</button>
      </div></section>`).join('')}
    ${st.cvs.length ? '' : '<p class="empty">No CVs yet. Add one above to start.</p>'}`;
    const career = st.cvs.length ? careerHtml(st.career, st.career_thinking, st.profile.tracks || [], st.profile.wants?.path || '') : '<section class="card"><p>Add a CV first: Claude maps your career paths from it.</p><div class="row"><a class="btn primary" href="#cvs">Add your CV</a></div></section>';
    const details = `<form data-form="profile" data-part="about"><section class="card"><header><h2>About you</h2></header>
      <p class="muted">Your name goes on your CVs' file names and cover letters; your email is where the weekly review goes.</p>
      <div class="form">
        <label class="field">Your name<input type="text" name="name" value="${esc(p.name)}"></label>
        <label class="field">Your email<input type="email" name="email" value="${esc(p.email)}"></label>
      </div></section></form>
    <section class="card"><header><h2>Signature</h2>${st.signature ? '<span class="pill good">Added</span>' : ''}</header>
      <p class="muted">Goes on every cover letter, between the sign-off and your name. Sign a white sheet of paper, take a photo or scan, and crop it close. PNG or JPEG.</p>
      ${st.signature ? `<p><img src="${st.signature}" alt="Your signature" style="max-height:60px;max-width:260px;background:#fff;padding:6px;border-radius:6px"></p>` : ''}
      <div class="row">
        <label class="btn">${st.signature ? 'Replace signature' : 'Add signature'}<input type="file" accept=".png,.jpg,.jpeg" data-upload="signature" hidden></label>
        ${st.signature ? '<button class="btn ghost" data-act="forget" data-what="signature">Remove</button>' : ''}
      </div>
      <p class="muted small">Letters already written keep what they had. Saving a cover letter again adds it.</p></section>
    <form data-form="profile" data-part="certs"><section class="card" id="certsCard"><header><h2>Certifications</h2></header>
      <p class="muted">The certifications and licences you hold, like PMP or CPMAI. Job Hunt counts them as yours when it scores a posting, writes a cover letter and fills in an application form, whether or not your CV lists them. Only the name is needed; forms sometimes ask for the rest.</p>
      <div class="cert-list" id="certList">${(p.certifications || []).map(certRow).join('')}</div>
      <div class="row"><button class="btn" type="button" data-act="certAdd">${svg('add')}Add a certification</button></div></section></form>
    <form data-form="profile" data-part="stories"><section class="card"><header><h2>Your stories</h2></header>
      <p class="muted">True achievements and stories that aren't in your CV, for cover letters to draw on, like a hard delivery you pulled off or a problem only you solved. Cover letters may use them; your CV is never changed with them.</p>
      <label class="field">Stories<textarea name="stories" style="min-height:160px" placeholder="e.g. Managed a key shipment for a \$2B oil project in Iran.\nCoordinated urgent delivery of medical supplies to Iraq.">${esc(st.profile.stories || '')}</textarea><span class="hint">One per line or paragraph. Keep the real numbers.</span></label>
      <label class="field">Facts for application forms<textarea name="application_facts" placeholder="e.g. Citizen, no visa sponsorship needed.\nNotice period: one month.\nSalary expectation: (your range and currency).\nOpen to hybrid; not relocating.\nAddress: 123 Main St, Toronto, ON M5P 3M1\nPhone: (416) 555-0100">${esc(st.profile.application_facts || '')}</textarea><span class="hint">Used to answer application questions. Anything not here is left as “[Fill in]”.</span></label>
      <div class="row"><button class="btn primary" type="submit">Save</button></div></section></form>
    <section class="card" id="bankCard"><header><h2>Your saved answers</h2></header><p class="muted small">Loading…</p></section>`;
    const view = ['career', 'details'].includes(sub) ? sub : 'cvs';
    body = `${cvsTabs(view, st.cvs.length)}
      ${view === 'career' ? careerSeg('paths') + career : view === 'details' ? details : body}`;
  } else if (tab === 'search') {
    body = `<!--@titles--><section class="card"><header><h2>Job titles</h2><a class="btn ghost" href="#cvs">Your CVs</a></header>
        <p class="muted small">Each CV searches for its own titles. Type one and press Enter to add it. A posting whose title doesn't match is still scored if it mentions one of the keywords.</p>
        ${st.cvs.length ? st.cvs.map(c => `<div class="title-set" data-cv="${esc(c.track)}"><input type="hidden" data-k="label" value="${esc(c.label)}"><input type="hidden" data-k="letter_style" value="${esc(c.letter_style || 'standard')}">
          <div class="form"><label class="field">${st.cvs.length > 1 ? `Titles for your ${esc(c.label)} CV` : 'Job titles to search for'}<textarea data-chips data-add="Add a job title" data-k="titles" style="min-height:120px">${esc(lines(c.titles))}</textarea></label>
          <label class="field">Keywords that also qualify a posting<textarea data-chips data-add="Add a keyword" data-k="keywords" style="min-height:120px">${esc(lines(c.keywords))}</textarea></label></div>
          <div class="row"><button class="btn" data-act="saveCv" data-track="${esc(c.track)}">Save titles</button><button class="btn ghost" data-act="suggestCv" data-track="${esc(c.track)}">Find more titles</button></div></div>`).join('') : '<p class="muted">Add a CV first: Claude reads it and suggests the titles. <a href="#cvs">Add your CV</a></p>'}
      </section>
      <!--@where--><section class="card"><header><h2>Where</h2></header><div class="form">
        <div class="field">Cities or areas${placePicker('locations', p.locations, p.sources.adzuna_country)}<span class="hint">Job Hunt also looks about 50 km around each. None: anywhere in the country.</span></div>
        <div class="stack" style="gap:14px">
          <label class="field">Country${countrySelect('adzuna_country', p.sources.adzuna_country, st.countries)}<span class="hint">Where searches look, and which job sites are offered.</span></label>
          <label class="check"><input type="checkbox" name="include_metro" ${p.include_metro !== false ? 'checked' : ''}> <span>Include the area around each city<br><span class="muted small">Toronto, Oakville or any GTA city brings in the whole GTA (Mississauga, Markham, Vaughan…), Vancouver or Burnaby Metro Vancouver, Montreal Laval and Longueuil, London Greater London, New York the NYC area, Dubai Sharjah and Ajman.</span></span></label>
          <label class="check"><input type="checkbox" name="remote_ok" ${p.remote_ok ? 'checked' : ''}> <span>Include remote roles open across the country<br><span class="muted small">Remote roles based in one of your locations are always included.</span></span></label>
        </div>
      </div></section>
      <!--@wants--><section class="card"><header><h2>What you want</h2></header>
        <p class="muted small">The things that make you turn a role down, told to Job Hunt up front. Scoring weighs them for every new posting: a role that goes against one scores lower and says why.</p>
        <div class="form">
          <label class="field">The level you're going for<input type="text" name="want_level" value="${esc(p.wants?.level || '')}" placeholder="e.g. senior manager or director"></label>
          <label class="field">Permanent or contract<select name="want_work">${[['', 'Either'], ['permanent', 'Permanent only'], ['contract', 'Contract only']].map(([v, n]) => `<option value="${v}" ${(p.wants?.work || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field" style="grid-column:1/-1">The career path you're building<input type="text" name="want_path" value="${esc(p.wants?.path || '')}" placeholder="e.g. product leadership in fintech"><span class="hint">One path, or several with a semicolon between. Every role still shows up: Job Hunt only warns you (Could set you back) about one that would significantly set your career back. Me, Career maps the paths your CV supports.</span></label>
          <label class="field">Industries you want<textarea data-chips data-add="Add an industry" name="want_industries">${esc(lines(p.wants?.industries))}</textarea></label>
          <label class="field">Industries you don't want<textarea data-chips data-add="Add an industry" name="want_avoid">${esc(lines(p.wants?.avoid))}</textarea></label>
          <label class="field" style="grid-column:1/-1">Deal-breakers<textarea data-chips data-add="Add a deal-breaker" name="want_dealbreakers">${esc(lines(p.wants?.dealbreakers))}</textarea><span class="hint">For example: on-site five days, more than 25% travel, commission only. A posting that clearly has one is set aside with the reason.</span></label>
        </div></section>
      <!--@filters--><section class="card"><header><h2>Which roles</h2></header><div class="form">
        <label class="field">Skip these companies<textarea data-chips data-add="Add a company" name="exclude_companies">${esc(lines(p.exclude_companies))}</textarea></label>
        <label class="field">Skip titles containing<textarea data-chips data-add="Add a word" name="exclude_title_keywords">${esc(lines(p.exclude_title_keywords))}</textarea></label>
        <label class="field">Don't score jobs older than<input type="number" name="max_age_days" min="0" step="1" value="${p.max_age_days ?? 30}"><span class="hint">Days since the job was posted (0: any age). Older ones are set aside before scoring, using no Claude. Jobs whose posting date isn't known are scored.</span></label>
        <label class="field">Minimum yearly salary<input type="number" name="min_salary" min="0" step="1000" value="${p.min_salary ?? ''}" placeholder="No minimum, e.g. 120000"><span class="hint">Digits only. Jobs that pay less at most are skipped before scoring, so they use no Claude: the salary a job site gives, or the pay in the posting itself (hourly rates count as 2,080 hours a year). Jobs that don't say are kept. Job Hunt looks for missing salaries once a week. <a href="#" data-act="rescanSalaries">Look now</a></span></label>
        <label class="field">Skip companies rated below<select name="min_rating">${[['', 'Any rating'], ['3', '3.0 out of 5'], ['3.5', '3.5 out of 5'], ['4', '4.0 out of 5']].map(([x, n]) => `<option value="${x}" ${String(p.min_rating ?? '') === x || (x && Number(x) === p.min_rating) ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">From what employees say (Glassdoor and the like). Companies not rated yet are kept until they are.</span></label>
      </div>
        <label class="field" style="margin-top:14px">What matters to you<textarea name="guidance" placeholder="e.g. Prefer hybrid roles in fintech or government. Avoid pure sales roles. Open to contract roles.">${esc(p.guidance || '')}</textarea><span class="hint">Claude weighs this when scoring. Job titles and keywords for each CV are set in Me.</span></label>
      </section>
      <!--@employers--><section class="card"><header><h2>Employer ratings</h2></header>
        <label class="check"><input type="checkbox" data-act="ratingsAuto" ${st.ratings_auto ? 'checked' : ''}> <span>Look up what employees say<br><span class="muted small">Ratings and reviews from Glassdoor, Indeed and the like, for the companies of roles you're considering: shown as a star rating next to the company, and on each job. Each company is looked up once (again after two months), through Claude Code; it uses a little of your Claude plan.</span></span></label>
      </section>
      <!--@when--><section class="card"><header><h2>When Job Hunt searches</h2></header><div class="form">
        <label class="field">Searches a day<select name="searches_per_day">${[[1, 'One'], [2, 'Two: a second one later in the day']].map(([v, n]) => `<option value="${v}" ${(p.searches_per_day >= 2 ? 2 : 1) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Two finds new postings hours sooner, when applications are read most. The second scores only what's new since the first, so it uses a little more of your plan, not double.</span></label>
        <label class="field">Search every day at${hourSelect('search_hour', p.search_hour)}<span class="hint">Only at this time. If Job Hunt isn't running then (or is being updated), that search is skipped, not run later: it waits for the next scheduled time. Search now, in the top bar, runs one whenever you like.</span></label>
        <label class="field" data-second-search ${p.searches_per_day >= 2 ? '' : 'hidden'}>And again at${hourSelect('search_hour_2', p.search_hour_2 ?? 17)}<span class="hint">Skipped when you searched by hand in the two hours before.</span></label>
        ${postingHoursHtml(st.posting_hours, p)}
        <div class="field">Daily search<div class="row">${scheduleMenu(overview?.side?.paused, false)}</div><span class="hint">${overview?.side?.paused ? esc(pausedWords(overview.side.paused)) + '.' : 'On. Pause it for a while, or turn it off.'}</span></div>
      </div></section>
      <!--@tailoring--><section class="card"><header><h2>Tailoring</h2></header><div class="form">
        <label class="field">Tailor by itself<select name="auto_tailor_mode">${[['off', 'No: I pick which roles to tailor'], ['strong', 'Only strong fits (85 or better), so they\'re ready to approve'], ['all', 'Every role that clears my fit score']].map(([v, n]) => `<option value="${v}" ${(p.auto_tailor ? 'all' : p.auto_tailor_min > 0 ? 'strong' : 'off') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Strong fits: after each search the best new matches from the last two weeks are tailored without waiting for you, at most as many as Most applications tailored per search. They use your Claude plan as any tailoring does.</span></label>
        <label class="field">Most applications tailored per search<input type="number" min="1" max="50" name="max_per_run" value="${p.max_per_run}"><span class="hint">When Job Hunt tailors by itself: the most it does after one search, best fits first.</span></label>
        <label class="field">Fit score needed to tailor<span class="range-row"><input type="range" min="0" max="100" step="1" value="${p.score_threshold}" data-range-for="score_threshold" aria-label="Fit score needed to tailor"><input type="number" min="0" max="100" name="score_threshold" value="${p.score_threshold}"></span><span class="hint">0–100. Roles below it are skipped.</span></label>
        <div class="field">A company you've applied to before<select data-act="repeatMode">${[['light', 'Light touch: the same headline, at most 4 paragraphs changed (recommended)'], ['same', 'The same CV as before, with a new cover letter'], ['usual', 'Tailor as usual']].map(([v, n]) => `<option value="${v}" ${(st.repeat_mode || 'light') === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">They keep every CV you send on file, side by side. A different headline or a different story for the same achievement is what stands out.</span></div>
      </div></section>
      <!--@limits--><section class="card"><header><h2>Scoring</h2></header><div class="form">
        <label class="field">Most new postings scored per search<input type="number" min="5" max="200" name="max_scored_per_run" value="${p.max_scored_per_run}"><span class="hint">Spares your Claude usage; the rest are scored next time. With more than 40 matches waiting to be picked, a search by itself scores half this many, newest first.</span></label>
        <div class="field">Score skipped postings again<div><button class="btn" type="button" data-act="rescore" data-group="skipped">Score them again</button></div><span class="hint">After you change your CVs, titles, fit score or locations.</span></div>
      </div></section>
      <section class="card"><header><h2>Clearing out</h2></header><div class="form">
        <label class="field">Remove postings I never acted on<select name="purge_after_days">${[[0, 'Never'], [30, 'After 30 days'], [60, 'After 60 days'], [90, 'After 90 days']].map(([v, n]) => `<option value="${v}" ${(p.purge_after_days || 0) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">Skipped, not-interested and closed ones only; anything tailored, saved or applied to stays. Removed postings aren't brought back as new.</span></label>
      </div></section>`;
    // Me, Looking for: what describes the jobs you want. When it searches, and how much it scores
    // and tailors, are Settings' (Job search, Applying).
    if (host && host !== SET_RAW) {
      const P = cut(body);
      body = `${P.titles}<form data-form="profile" data-part="search">${P.where}${P.wants}${P.filters}</form>
        <p class="muted small">When Job Hunt searches and how many postings it scores are in <a href="#settings/jobs/schedule">Settings → Job search</a>; how applications are tailored is in <a href="#settings/applying">Settings → Applying</a>.</p>`;
    }
  } else if (tab === 'calendar') {
    const c = p.calendar;
    body = `<!--@calendar-->${st.google.connected ? '' : '<p class="muted"><b>Connect Google in <a href="#settings/accounts">Accounts</a></b> to have interviews put in your Google Calendar too.</p>'}
      <form data-form="profile" data-part="calendar">
      <section class="card"><header><h2>Your time</h2></header><div class="form">
        <label class="field">Your time zone${tzSelect('timezone', p.timezone)}<span class="hint">For interview times, the daily search and reminders.</span></label>
      </div></section>
      <section class="card"><header><h2>Interviews</h2></header><div class="form">
        <label class="field">Interviews from${hourSelect('work_start', c.work_start, 0, 23)}</label>
        <label class="field">Until${hourSelect('work_end', c.work_end, 1, 24)}</label>
        <label class="field">Interview length to offer (minutes)<input type="number" min="15" step="15" name="slot_minutes" value="${c.slot_minutes}"></label>
        <label class="field">How many times to offer<input type="number" min="1" max="6" name="propose_slots" value="${c.propose_slots}"></label>
        <label class="field">Prep time before interviews (minutes)<input type="number" min="0" step="15" name="prep_minutes" value="${c.prep_minutes}"><span class="hint">0 for none.</span></label>
        <label class="field">Reminders after an interview (days)<input type="text" name="followup_days" value="${esc(c.followup_days.join(', '))}"><span class="hint">E.g. 1, 7: a thank-you note the next day, and a check-in a week later.</span></label>
      </div>
      <details class="small" style="margin-top:10px" ${c.calendar_id && c.calendar_id !== 'primary' ? 'open' : ''}><summary class="muted">Advanced</summary><div class="form" style="margin-top:8px">
        <label class="field">Which Google calendar<input type="text" name="calendar_id" value="${esc(c.calendar_id)}"><span class="hint">Leave it as “primary” for your main calendar. For another one, paste its Calendar ID from Google Calendar → Settings → that calendar → Integrate calendar.</span></label>
      </div></details></section>
      </form>`;
  } else if (tab === 'inbox') {
    body = `<!--@email-->${st.google.connected ? '' : '<p class="muted"><b>Connect Google in <a href="#settings/accounts">Accounts</a> first:</b> Job Hunt reads your job email through it.</p>'}
      <form data-form="profile" data-part="inbox">
      <section class="card"><header><h2>Email</h2>${st.google.connected ? `<span class="pill good">Gmail connected</span>` : '<span class="pill warn">Needs Google</span>'}</header><div class="form">
        <label class="field">Check email every (minutes)<input type="number" min="10" max="240" name="inbox_minutes" value="${p.inbox_minutes}"><span class="hint">Replies, interview invitations and job alerts are read then; replies are drafted in Gmail for you to send.</span></label>
      </div></section></form>
      <!--@followups--><form data-form="profile" data-part="inbox">
      <section class="card"><header><h2>Following up</h2></header><div class="form">
        <label class="field">Follow up on applications after (days)<input type="number" min="0" max="45" name="follow_up_after" value="${p.follow_up_after ?? 8}"><span class="hint">With no reply by then, Job Hunt drafts a short follow-up in Gmail. 0 for never.</span></label>
      </div></section>
      <section class="card"><header><h2>Messages to recruiters</h2></header><div class="form">
        <label class="field">LinkedIn notes<select name="linkedin_note">${[[300, 'Up to 300 characters (LinkedIn Premium)'], [200, 'Up to 200 characters (a free account)']].map(([v, n]) => `<option value="${v}" ${(p.linkedin_note === 200 ? 200 : 300) === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">The note that goes with a connection request has a limit that depends on your account. Notes to recruiters and hiring teams are written to fit.</span></label>
      </div></section></form>`;
  } else if (tab === 'notifications') {
    const ph = st.phone;
    body = `<!--@weekly--><form data-form="profile" data-part="weekly">
      <section class="card"><header><h2>Weekly review</h2><button class="btn" type="button" data-act="weeklyNow">Send it now</button></header>
        <p class="muted">Once a week: what you sent against your goal, who replied, what's going quiet, what to do next, and the best new roles of the week to pick.</p>
        <div class="form">
          <label class="field">Weekly goal (applications)<input type="number" min="0" max="100" name="weekly_goal" value="${p.weekly_goal ?? 10}"><span class="hint">Shown in the Queue too. 0 for none.</span></label>
          <label class="field">When<select data-act="weeklyDay"><option value="sun" ${st.weekly.day === 'sun' ? 'selected' : ''}>Sunday at 6 PM, to plan the week ahead</option><option value="mon" ${st.weekly.day === 'mon' ? 'selected' : ''}>Monday, at the daily search hour</option></select></label>
        </div>
        <label class="check"><input type="checkbox" data-act="weeklyEmail" ${st.weekly.email ? 'checked' : ''}> <span>Email me the whole review${st.weekly.to ? ` at ${esc(st.weekly.to)}` : ''} (needs Gmail connected). Otherwise it's a short notice.</span></label>
      </section>
      </form>
      <!--@notices--><section class="card" id="noticesCard"><header><h2>Notices on your phone</h2>${ph.topic ? '<span class="pill good">On</span>' : '<span class="pill">Optional</span>'}</header>
        <p class="muted">Interviews, offers and applications ready, on your phone even when you're away from this computer. Uses the free ntfy app; no account needed.</p>
        <div class="row">${ph.topic ? '<button class="btn" data-act="phoneTest">Send a test</button><button class="btn ghost" data-act="phone" data-on="0">Turn off</button>' : '<button class="btn primary" data-act="phone" data-on="1">Turn on</button>'}</div>
        ${ph.topic ? `<ol class="small steps-list">
          <li>Install <b>ntfy</b> on your phone: <a href="#" data-act="link" data-url="https://play.google.com/store/apps/details?id=io.heckel.ntfy">Android</a> or <a href="#" data-act="link" data-url="https://apps.apple.com/app/ntfy/id1625396347">iPhone</a>.</li>
          <li>In ntfy, tap <b>+</b> and subscribe to <b class="mono">${esc(ph.topic)}</b>${ph.server && ph.server !== 'https://ntfy.sh' ? ` on ${esc(ph.server)}` : ''}.</li>
          <li>Press <b>Send a test</b> above.</li></ol>
          <label class="check"><input type="checkbox" data-act="phoneUrgent" ${ph.urgent_only ? 'checked' : ''}> <span class="small">Only what can't wait: interviews, offers, replies from employers and postings about to close.</span></label>
          <label class="check"><input type="checkbox" data-act="phoneDetails" ${ph.details ? 'checked' : ''}> <span class="small">Show the company and role in notices<br><span class="muted">Off (private): notices only say what kind they are, like “An interview update”. They travel through ntfy.sh, a public relay, so anyone who learned your topic name could read them.</span></span></label>
          <details class="small"><summary class="muted">Your own ntfy server (optional)</summary><form data-form="phone" class="form" style="margin-top:8px"><label class="field">Server<input type="url" name="server" value="${esc(ph.server)}" placeholder="https://ntfy.sh"></label><div class="row"><button class="btn sm" type="submit">Save</button></div></form></details>
          <p class="muted small">Keep the topic name to yourself.</p>` : ''}
      </section>`;
  } else if (tab === 'extension') {
    // Set up on the PC Job Hunt runs on (its folder and key are there); from a phone, say so.
    body = st.kind === 'server' || st.remote.here
      ? `<!--@ext--><section class="card"><header><h2>Browser extension</h2></header><p class="muted"><b>Send to Job Hunt</b> for Chrome or Edge sends a posting you're looking at to Job Hunt and fills in application forms in your own browser. It's set up on the computer Job Hunt runs on: open Job Hunt there and go to <b>Settings → Applying → Filling in forms</b>.</p>
          </section>
        <!--@phonefill--><section class="card"><header><h2>Fill forms on this phone</h2></header>
          <p class="muted">A phone's browser can't run the extension, so on a phone a bookmark does the filling. It carries your private key, so Job Hunt only hands it out on your PC.</p>
          <ol class="small steps-list">
            <li>On your PC, open Job Hunt: <b>Settings</b> → <b>Phone</b> → <b>Fill forms on your phone</b>.</li>
            <li>Press <b>Copy the bookmark</b> and send it to yourself (a note or an email to yourself).</li>
            <li>On this phone, bookmark any page, then edit that bookmark: name it <b>Job Hunt Fill</b> and paste what you copied as its address.</li>
            <li>On an application form, tap the address bar, type <b>Job Hunt Fill</b> and tap the bookmark. The Job Hunt panel appears and fills in the form.</li></ol></section>`
      : `<!--@ext-->${extensionCard(st)}<!--@phonefill-->${st.ext_key ? phoneCard(st) : `<section class="card"><header><h2>Fill forms on your phone</h2></header><p class="muted">Set up the <a href="#settings/applying/forms">browser extension</a> on this PC first: the phone uses the same key.</p></section>`}`;
  } else if (tab === 'sync') {
    const server = st.kind === 'server', here = st.remote.here;
    const b = st.backup;
    const kb = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const y = st.sync;
    const viaDrive = server || y.where === 'drive' || (!y.on && !y.folder); // new to syncing: Drive is the simpler way
    const every = [[5, 'Every 5 minutes after a change'], [10, 'Every 10 minutes after a change'], [30, 'Every 30 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Once a day'], [0, 'Only when I press Sync now']];
    const state = !y.on ? ['', 'Off', 'Your data is only on this computer (and in its daily backups).']
      : y.running ? ['', '<span class="spin" data-kind="sync" data-secs="30"></span>Syncing…', 'Saving the latest copy now.']
      : y.error ? ['crit', 'Didn\'t sync', y.error]
      : y.last ? ['good', 'Up to date', `Last synced ${ago(y.last)} from ${y.device}.`]
      : ['warn', 'Not synced yet', 'Press Sync now to save the first copy.'];
    const status = `<section class="card sync-status"><header><h2>Status</h2><span class="pill ${state[0]}">${state[1]}</span></header>
      <p class="${state[0] === 'crit' ? '' : 'muted'}">${esc(state[2])}</p>
      <div class="kpis small-kpis">
        <div class="kpi"><span class="kpi-l">Sync</span><span class="kpi-v">${y.on ? (y.last ? esc(ago(y.last)) : '–') : 'Off'}</span><span class="kpi-s">${y.on ? (y.where === 'drive' ? 'to Google Drive' : 'to your sync folder') : 'not turned on'}</span></div>
        <div class="kpi"><span class="kpi-l">Backup</span><span class="kpi-v">${b.last ? esc(ago(b.last)) : '–'}</span><span class="kpi-s">${y.drive_backup ? `in Google Drive ${esc(ago(y.drive_backup))}` : 'on this computer'}</span></div>
        <div class="kpi"><span class="kpi-l">Automatic sync</span><span class="kpi-v">${y.on ? esc((every.find(e => e[0] === y.every) || [0, `Every ${y.every} min`])[1].replace(' after a change', '')) : 'Off'}</span><span class="kpi-s">${y.on ? 'and when Job Hunt exits' : 'turn on sync below'}</span></div>
      </div>
      <div class="row">${y.on ? `<button class="btn primary" data-act="syncNow" ${y.running ? 'disabled' : ''}>Sync now</button>` : y.drive_ready ? '<button class="btn primary" data-act="syncOn">Turn on sync to Google Drive</button>' : '<a class="btn primary" href="#settings/accounts">Connect Google in Accounts</a>'}<button class="btn" data-act="backupNow">Back up now</button></div>
      ${y.on ? '' : '<p class="muted small">One click: your data goes to a private "Job Hunt" folder in your Google Drive and keeps itself up to date, with daily backups. On another PC, install Job Hunt and connect the same Google account to continue there.</p>'}</section>`;
    const sync = `<section class="card"><header><h2>Sync to Google Drive</h2>${y.on ? '<span class="pill good">On</span>' : ''}</header>
      <p class="muted">Pick up where you left off on any computer${server ? ', or move between this server and a PC' : ''}. Job Hunt keeps an up-to-date copy of everything in your own Google Drive; on another computer, install Job Hunt and connect the same Google account, and it finds your data and offers to continue from it. Use one at a time. Only you can see the copy.</p>
      <form data-form="sync" class="form">
        <fieldset class="field" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend class="small">Where</legend>
          <label class="check"><input type="radio" name="where" value="drive" ${viaDrive ? 'checked' : ''}> <span>Straight to Google Drive<br><span class="muted small">Through your Google connection: no Google Drive app needed. Job Hunt uses a "Job Hunt" folder in My Drive and can't see your other files. Daily backups are copied there too (the last three).${y.drive_ready ? '' : ' <b>Connect Google in Settings → Accounts first.</b>'}</span></span></label>
          ${server ? '' : `<label class="check"><input type="radio" name="where" value="folder" ${viaDrive ? '' : 'checked'}> <span>Through a folder on this computer<br><span class="muted small">One that Google Drive for desktop, OneDrive or Dropbox keeps in the cloud. Daily backups go there too.</span></span></label>`}
        </fieldset>
        ${server ? '' : `<div class="sync-folder" style="grid-column:1/-1" ${viaDrive ? 'hidden' : ''}><label class="field">Folder<span class="row" style="flex-wrap:nowrap;gap:6px"><input type="text" name="dir" value="${esc(y.folder || '')}" placeholder="${esc(y.suggest || 'G:\\My Drive\\Job Hunt')}" style="flex:1">${here ? '' : '<button class="btn" type="button" data-act="pickFolder" data-into="dir">Browse…</button>'}</span>
          <span class="hint">${y.suggest ? `<a href="#" data-act="useDrive" data-path="${esc(y.suggest)}">Use ${esc(y.suggest)}</a>` : 'Install <a href="#" data-act="link" data-url="https://www.google.com/drive/download/">Google Drive for desktop</a>, then use a folder in My Drive, like G:\\My Drive\\Job Hunt.'}</span></label></div>`}
        <label class="check" style="grid-column:1/-1"><input type="checkbox" name="on" ${y.on ? 'checked' : ''}> <b>Keep a synced copy there</b></label>
        <label class="field">How often<select name="every">${every.map(([v, n]) => `<option value="${v}" ${y.every === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="hint">It also syncs when Job Hunt exits.</span></label>
        <label class="check"><input type="checkbox" name="secrets" ${y.secrets ? 'checked' : ''}> <span>Include saved keys and sign-ins<br><span class="muted small">So another computer needs no setting up. They stay in your own Google Drive.</span></span></label>
        <div class="row"><button class="btn primary" type="submit">Save</button></div>
      </form></section>`;
    const backups = `<section class="card"><header><h2>Backups</h2></header>
      <p class="muted">Every day Job Hunt saves one zip file with everything: your applications, CVs, cover letters, settings and signature. The last ${14} are kept.
        ${server ? 'They go to the <b>/backups</b> folder you mapped to a NAS share, so Hyper Backup or Cloud Sync can copy them off the NAS.' : 'With sync on, each one goes to your Google Drive (or sync folder) too.'}</p>
      <form data-form="backup" class="form">
        <label class="check"><input type="checkbox" name="secrets" ${b.secrets ? 'checked' : ''}> <span>Include saved keys and sign-ins (Claude API key, Google, Adzuna)<br><span class="muted small">So a restore on a new computer or the NAS needs no signing in again. Keep the backup folder private if you tick this.</span></span></label>
        <div class="row"><button class="btn" type="submit">Save</button></div>
      </form>
      <p class="muted small">${b.last ? `Last backup ${esc(ago(b.last))}` : 'No backup yet.'} · Saved in ${esc(b.folder)}</p>
      ${b.files.length ? `<table><thead><tr><th>Backup</th><th>Size</th><th></th></tr></thead><tbody>${b.files.slice(0, 5).map(f => `<tr><td class="small">${esc(f.name.replace('JobHunt backup ', '').replace('.zip', ''))}</td><td class="small muted" data-v="${f.size}">${kb(f.size)}</td><td style="text-align:right"><a class="btn ghost" href="/api/backup/download/${encodeURIComponent(f.name)}" download>Download</a></td></tr>`).join('')}</tbody></table>` : ''}
      <div class="row" style="margin-top:10px"><label class="btn">Restore from a backup…<input type="file" accept=".zip" data-upload="restore" hidden></label>
        <span class="muted small">Replaces everything here with the backup and restarts Job Hunt. What's here now is kept in a "before-restore" folder.</span></div>
    </section>`;
    body = `<!--@sync-->${status}${sync}${server ? '' : filesCard(st, false)}${backups}`;
  } else {
    const server = st.kind === 'server', here = st.remote.here;
    const r = st.remote, cd = st.claude_desktop;
    const remote = server ? `<section class="card"><header><h2>Signed in from this browser</h2></header>
        <p class="muted">Job Hunt is running on your server. To change the password, enter a new one; every device is signed out.</p>
        <form data-form="remote" class="form"><label class="field">New password<input type="password" name="password" autocomplete="new-password" minlength="8"></label><span></span>
        <div class="row"><button class="btn" type="submit">Change password</button></div></form>
        <form method="post" action="/logout"><button class="btn ghost" type="submit">Sign out</button></form></section>`
      : `<details class="card" ${r.on || here ? 'open' : ''}><summary><b>Use it from your phone</b> <span class="muted small">(advanced: needs Tailscale on this PC and on your phone)</span>${r.on ? ' <span class="pill good">On</span>' : ''}</summary>
        <p class="muted">Use Job Hunt from your phone or another computer, in a web browser, while it runs here. Install <a href="#" data-act="link" data-url="https://tailscale.com/download">Tailscale</a> (free) on this PC and your phone and sign in to both with the same account: only your own devices can reach Job Hunt, from anywhere. This PC has to stay on.</p>
        <form data-form="remote" class="form">
          <label class="field">${r.password ? 'New password (optional)' : 'Password'}<input type="password" name="password" autocomplete="new-password" minlength="8" ${r.password ? '' : 'required'}><span class="hint">At least 8 characters. Changing it signs every device out.</span></label>
          <label class="field">Port<input type="number" name="port" min="1024" max="65535" value="${r.port}"><span class="hint">Changing it takes effect when Job Hunt restarts.</span></label>
          <label class="check"><input type="checkbox" name="on" ${r.on ? 'checked' : ''}> Turn on remote access</label>
          <div class="row"><button class="btn primary" type="submit">Save</button></div>
        </form>
        ${r.on ? `<p>On your phone, with Tailscale on, open <b>${esc(r.address)}</b></p><p class="muted small">Windows may ask whether Job Hunt can use the network the first time: allow it on private networks.</p>` : ''}
        ${here ? '<form method="post" action="/logout"><button class="btn ghost" type="submit">Sign out of this browser</button></form>' : ''}</details>`;
    const extras = `<section class="card"><header><h2>Ask Claude about your search</h2>${cd.added ? '<span class="pill good">Added</span>' : ''}</header>
        <p class="muted">Adds Job Hunt to the Claude desktop app, so you can ask in plain words: “What's waiting for my approval?”, “Make the Maple Bank letter shorter”, “Search now”.</p>
        <div class="row">${cd.available ? `<button class="btn ${cd.added ? '' : 'primary'}" data-act="addClaudeDesktop">${cd.added ? 'Add again' : 'Add to Claude'}</button>` : '<span class="muted small">Set this up from the Job Hunt app on your PC.</span>'}</div>
        ${cd.available ? `<p class="muted small">After adding: quit the Claude app fully (right-click its icon by the clock → Quit) and open it again. Job Hunt appears among its tools.${cd.config ? ` Claude's settings file: ${esc(cd.config)}` : ''}</p>` : ''}</section>
`;
    body = `<!--@updates--><section class="card"><header><h2>Updates</h2><span class="muted small">Version ${esc(shortVersion(st.app.version))}</span></header>
      <p class="muted small" id="updateStatus">${server ? 'The server version updates with its container image: when a new version is out, update the image in Container Manager.' : 'Job Hunt checks for updates every 30 minutes and lets you know when one is ready.'}</p>
      <div class="row"><button class="btn" data-act="updateCheck">Check for updates</button><button class="btn primary" data-act="updateInstall" id="updateInstallBtn" hidden>Install and restart</button></div>
      ${server ? '' : `<label class="check" style="margin-top:10px"><input type="checkbox" data-act="updateAuto" ${st.app.update_auto ? 'checked' : ''}> <span>Install updates by themselves<br><span class="muted small">When a new version is out, Job Hunt installs it and restarts once it isn't busy (no search, tailoring or form filling running) and you're not using its window, then tells you what changed. Your applications and settings stay as they are.</span></span></label>`}</section>
      <!--@remote-->${remote}
      <!--@links--><section class="card"><header><h2>Know when your CV links are opened</h2>${st.links?.base ? '<span class="pill good">On</span>' : ''}</header>
        <p class="muted">The web links in each tailored CV and cover letter (your LinkedIn, a portfolio) go through Job Hunt first, which notes the click and sends the reader straight on. The text they see doesn't change. Each job then shows whether its links were opened: a sign someone read your application.</p>
        <p class="muted small">Needs Job Hunt reachable from the internet at an https address, such as the server version behind Cloudflare. ${server ? '' : 'On this PC that means a tunnel (Cloudflare Tunnel or Tailscale Funnel) to remote access, which has to be on; links only work while this PC is on.'} Email security scanners and link previews are counted apart from people.</p>
        <form data-form="links" class="form"><label class="field">Job Hunt's public address<input name="base" type="url" placeholder="https://jobhunt.example.com" value="${esc(st.links?.base || '')}"><span class="hint">Leave empty to turn it off.</span></label>
        <div class="row"><button class="btn" type="submit">Save</button></div></form></section>
      <!--@extras-->${extras}
      <!--@whatsnew--><section class="card" id="whatsnew"><header><h2>What's new</h2></header><p class="muted small">Loading…</p></section>
      <!--@app-->${server || here ? `<section class="card"><header><h2>Starting, sleeping and closing</h2></header><p class="muted small">Your data: ${esc(st.app.data)}</p></section>` : `<section class="card"><header><h2>Starting, sleeping and closing</h2></header>
      <label class="check"><input type="checkbox" data-act="autostart" ${st.app.autostart ? 'checked' : ''}> Start Job Hunt when I sign in to Windows (in the tray, so searches and email checks keep running)</label>
      ${st.app.slept && st.app.keep_awake && Date.now() - new Date(st.app.slept.at) < 14 * 864e5 ? `<div class="card" style="box-shadow:none;border-color:var(--warn);margin:6px 0"><b>Windows put this PC to sleep during Job Hunt's work</b> <span class="muted small">(${esc(ago(st.app.slept.at))}, for ${st.app.slept.minutes} minutes, while ${esc((st.app.slept.during || []).join(', '))} was running)</span>
        <p class="small">Job Hunt asks Windows to stay on while it works, but closing a laptop's lid, the power button, or a power plan that forces sleep still win. To keep it on: plug it in, and in Control Panel → Power Options → Choose what closing the lid does, set it to Do nothing when plugged in.</p></div>` : ''}
      <label class="check"><input type="checkbox" data-act="wakePc" ${st.app.wake ? 'checked' : ''}> <span>Wake this PC from sleep to run Job Hunt's tasks<br><span class="muted small">For the daily search, the weekly review and interview prep, while Job Hunt is in the tray. On unless you turn it off. Job Hunt turns on Windows' "Allow wake timers" for when the PC is plugged in; on battery it stays asleep. It can't wake a PC that's shut down or hibernating, and a closed laptop lid may keep it asleep. Not waking? Check Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep → Allow wake timers → Enable.${st.app.wake && st.app.next_wake ? `<br>Next wake: ${esc(new Date(st.app.next_wake).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}${st.app.last_wake ? ` · last ${esc(ago(st.app.last_wake))}` : ''}</span></span></label>
      <label class="check"><input type="checkbox" data-act="keepAwake" ${st.app.keep_awake ? 'checked' : ''}> <span>Keep this PC awake while Job Hunt is working<br><span class="muted small">While it searches, tailors, checks email or backs up, and for a few minutes after (so it doesn't sleep between one step and the next), Windows won't go to sleep, including after it woke the PC for the daily search. The screen can still turn off. Once it's done, your usual sleep settings apply. Closing a laptop's lid still puts it to sleep unless you set the lid to Do nothing when plugged in.</span></span></label>
      <label class="field" style="max-width:420px">When I close the window<select data-act="closeMode"><option value="tray" ${st.app.close === 'tray' ? 'selected' : ''}>Keep running in the tray</option><option value="exit" ${st.app.close === 'exit' ? 'selected' : ''}>Exit Job Hunt</option></select></label>
      <div class="row"><button class="btn" data-act="folder" data-which="data">${svg('folder')}Open data folder</button><button class="btn" data-act="folder" data-which="applications">${svg('folder')}Open tailored applications</button></div>
      <p class="muted small">Your data: ${esc(st.app.data)}</p></section>`}`;
  }
  if (tab === 'cvs') {
    page(`${meHead(sub === 'details' ? 'details' : sub === 'career' ? 'career' : 'cvs', 'What Job Hunt knows about you: your CVs, your details, and where your career could go.', st.cvs.length)}
      ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${body}`);
    if (st.career_thinking) watchCareer(location.hash);
    if (st.cv_update?.running || st.cv_update?.tailoring) watchCvUpdate();
    if ($('#bankCard')) renderBank();
    return;
  }
  if (host === SET_RAW) return body;
  page(`${host}<p class="save-state right-note" id="saveState" aria-live="polite">Changes save by themselves</p>
    ${st.problems.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${body}`);
}

// ---- Settings: eight places down the side, tabs inside the bigger ones, and a search of them all ----
/** [id, name, icon, what's there]. Each thing Job Hunt signs in to or does is in one of these, once. */
const SET_NAV = [
  ['accounts', 'Accounts', '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 'Everything Job Hunt signs in to: Claude, Google and another AI. Each is here once, with what uses it.'],
  ['jobs', 'Job search', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 'Where Job Hunt looks, when, and how much it scores. What you\'re looking for (titles, places, filters) is in <a href="#search/what">Me → Looking for</a>.'],
  ['applying', 'Applying', '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', 'How applications are tailored, filled in and followed up.'],
  ['mail', 'Email & calendar', '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', 'How Job Hunt reads your job email and books interviews.'],
  ['notifications', 'Notifications', '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', 'How Job Hunt lets you know what\'s happening.'],
  ['phone', 'Phone', '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>', 'Job Hunt on your phone: using it there, filling in forms, sending jobs and getting notices.'],
  ['sync', 'Sync & backup', '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.75 3.75 0 0 1-.5 7.5z"/>', 'Your data on more than one computer, and safe copies of it.'],
  ['computer', 'App', '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', 'Updates, starting with Windows, sleep, and the app itself.'],
];
/** The tabs inside a place: [id, name, address when it isn't #settings/<place>/<id>]. */
const SET_TABS = {
  jobs: [['sources', 'Sources', '#search'], ['schedule', 'Schedule'], ['limits', 'Scoring & limits'], ['last', 'Last search', '#search/last']],
  applying: [['tailoring', 'Tailoring'], ['forms', 'Filling in forms'], ['followups', 'Following up']],
  mail: [['email', 'Email'], ['calendar', 'Calendar & interviews']],
};
/** Addresses from before the places were regrouped (links in old notices, and in the app). */
const SET_ALIAS = { connections: 'accounts', inbox: 'mail/email', calendar: 'mail/calendar', extension: 'applying/forms', app: 'computer', extras: 'computer', schedule: 'mail/calendar' };
const setHref = (section, tab) => { const t = (SET_TABS[section] || []).find(x => x[0] === tab) || (SET_TABS[section] || [])[0]; return section === 'jobs' && !tab ? '#search' : t ? (t[2] || `#settings/${section}/${t[0]}`) : `#settings/${section}`; };
const setWhere = (section, tab) => { const n = (SET_NAV.find(x => x[0] === section) || [])[1] || '', t = (SET_TABS[section] || []).find(x => x[0] === tab); return t ? `${n} › ${t[1]}` : n; };

/** A Settings page: the places down the side (with the search above them), then this place's
 *  heading, its tabs if it has any, and its cards. */
function settingsShell(section, tab, body, opts = {}) {
  const [, name, , about] = SET_NAV.find(x => x[0] === section) || SET_NAV[0];
  const tabs = SET_TABS[section];
  const st = settingsCache;
  const q = $('#setFind')?.value || '';
  return `<div class="set"><aside class="set-side">
      <label class="set-find">${svg('search')}<input type="search" id="setFind" placeholder="Search settings" autocomplete="off" aria-label="Search settings" value="${esc(opts.keep ? q : '')}"><kbd>/</kbd></label>
      <nav class="set-nav" aria-label="Settings">${SET_NAV.map(([id, n, d]) => `<a href="${setHref(id)}" class="${id === section ? 'on' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg><span>${n}</span></a>`).join('')}</nav></aside>
    <div class="set-main" id="setMain"><div class="head"><div class="grow"><h1>${name}</h1><p class="muted">${about}</p></div><div class="row">${opts.actions || ''}</div><span class="save-state" id="saveState" aria-live="polite">${opts.note || ''}</span></div>
      ${st?.problems?.length ? `<div class="card" style="border-color:var(--crit)"><b>Fix these before searching:</b><ul class="flags">${st.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${tabs ? placeTabs(tabs.map(([id, n, href]) => [href || `#settings/${section}/${id}`, n, id]), tab) : ''}
      ${body}</div></div>`;
}

/** The cards of one place (and tab), put together from the groups settingsCards builds. Nothing is
 *  drawn or fetched but the settings themselves, so the search can read every place this way. */
async function settingsBody(section, tab, st) {
  const got = {};
  const of = async group => got[group] || (got[group] = cut(await settingsCards(group, '', SET_RAW, st)));
  const form = (part, html) => html ? `<form data-form="profile" data-part="${part}">${html}</form>` : '';
  const link = (text, href, label) => `<section class="card"><p class="muted" style="margin:0">${text} <a href="${href}">${label} →</a></p></section>`;
  if (section === 'accounts') { const c = await of('connections'); return `${c.attention}${c.claude}${c.google}${c.other}${c.usage}`; }
  if (section === 'jobs') {
    const s = await of('search');
    if (tab === 'schedule') return form('search', s.when);
    if (tab === 'limits') return `${form('search', s.limits)}${s.employers}`;
    const src = await of('sources');
    return `${src.list}${src.clip}`;
  }
  if (section === 'applying') {
    if (tab === 'forms') { const e = await of('extension'); return `${e.ext}${link('On a phone, a bookmark fills in forms in the extension\'s place.', '#settings/phone', 'Phone')}`; }
    if (tab === 'followups') { const i = await of('inbox'), a = await of('app'); return `${i.followups}${a.links}`; }
    return form('search', (await of('search')).tailoring);
  }
  if (section === 'mail') return tab === 'calendar' ? (await of('calendar')).calendar : (await of('inbox')).email;
  if (section === 'notifications') { const n = await of('notifications'); return `${n.weekly}${n.notices}`; }
  if (section === 'phone') { const a = await of('app'), e = await of('extension'); return `${a.remote}${e.phonefill}${link('Interviews, offers and applications ready, as notices on your phone.', '#settings/notifications', 'Notifications')}`; }
  if (section === 'sync') return (await of('sync')).sync;
  const a = await of('app');
  return `${a.updates}${a.app}${a.extras}${a.whatsnew}`;
}

/** #settings/<place>/<tab>. */
async function showSettings(arg) {
  let [section, tab] = String(SET_ALIAS[(arg || '').split('/')[0]] || arg || 'accounts').split('/');
  if (!SET_NAV.some(x => x[0] === section)) section = 'accounts';
  // Job search's Sources and Last search have the search's own page (what each place found).
  if (section === 'jobs' && (!tab || tab === 'sources' || tab === 'last')) { location.replace(tab === 'last' ? '#search/last' : '#search'); return; }
  const tabs = SET_TABS[section];
  if (tabs && !tabs.some(x => x[0] === tab)) tab = tabs[0][0];
  const st = settingsCache = await api('/api/settings');
  const autosaves = section === 'notifications' || section === 'mail' || (section === 'jobs') || (section === 'applying' && tab !== 'forms');
  page(settingsShell(section, tabs ? tab : '', await settingsBody(section, tab, st), { note: autosaves ? 'Changes save by themselves' : '' }));
  settingsShown();
}

/** After a Settings page is drawn: the parts that fill themselves in, and the setting a search led to. */
let setFlash = '';
function settingsShown() {
  const st = settingsCache;
  if ($('#claudeCard') && st?.claude.engine !== 'api') checkClaude(false);
  if ($('#connStatus')) renderConnStatus();
  if ($('#usageCard')) renderUsage();
  if ($('#whatsnew')) { showWhatsNew(); if (update?.available) showUpdate(update); }
  if (connScrollTo) { const t = document.getElementById(connScrollTo); connScrollTo = null; if (t) { t.scrollIntoView({ block: 'start' }); t.querySelector('details')?.setAttribute('open', ''); } }
  if (setFlash) {
    const want = setFlash.toLowerCase(); setFlash = '';
    const el = [...document.querySelectorAll('#setMain h2, #setMain .tile > header b, #setMain label.field, #setMain div.field, #setMain label.check, #setMain summary')].find(x => setLabel(x).toLowerCase() === want);
    if (el) {
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
      const box = el.matches('h2, summary') || el.closest('.tile > header') ? (el.closest('.card, .tile') || el) : el;
      setTimeout(() => { box.scrollIntoView({ block: 'center' }); box.classList.add('set-flash'); setTimeout(() => box.classList.remove('set-flash'), 2400); }, 60);
    }
  }
}

/** A setting's name: the words of its label before its box (or of a card's heading). */
function setLabel(el) {
  if (el.matches('h2, b, summary')) return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 90);
  const c = el.cloneNode(true);
  c.querySelectorAll('input, select, textarea, .hint, .muted, button, .row, .chips, .range-row, br ~ *').forEach(x => x.remove());
  return c.textContent.replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** Every setting, for the search: its name, what its hint says, and where it is. Read from the
 *  pages themselves (settingsBody), so a setting added to a page can be found without listing it here. */
let setIndex = null;
async function settingsIndex() {
  if (setIndex) return setIndex;
  const st = settingsCache || (settingsCache = await api('/api/settings'));
  const out = [];
  for (const [section] of SET_NAV) {
    for (const [tab] of SET_TABS[section] || [['']]) {
      if (section === 'jobs' && tab === 'last') continue;
      let html = '';
      try { html = await settingsBody(section, tab, st); } catch (e) { continue; }
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const where = setWhere(section, tab), href = setHref(section, tab);
      const add = (el, kind) => {
        const title = setLabel(el);
        if (title.length < 3 || out.some(x => x.title === title && x.href === href)) return;
        const near = kind === 'card' ? el.closest('.card, .tile') : el;
        const about = (near?.querySelector(kind === 'card' ? 'p.muted, p.small' : '.hint, .muted')?.textContent || '').replace(/\s+/g, ' ').trim();
        out.push({ title, about: about.slice(0, 150), text: `${title} ${about}`.toLowerCase(), where, href, card: kind === 'card' });
      };
      doc.querySelectorAll('section.card > header h2, details.card > summary b, .tile > header b').forEach(el => add(el, 'card'));
      doc.querySelectorAll('label.field, div.field, label.check').forEach(el => add(el, 'field'));
    }
  }
  return (setIndex = out);
}

/** Search the settings as you type: the matches take the page's place, each with where it is and
 *  a way there. Emptying the box brings the page back. */
let setFindTimer;
async function settingsFind(q) {
  const main = $('#setMain'); if (!main) return;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) { route(); return; }
  const all = await settingsIndex();
  if (($('#setFind')?.value || '').trim() !== q.trim()) return; // typed on meanwhile
  const hits = all.filter(x => words.every(w => x.text.includes(w)))
    .sort((a, b) => (words.every(w => b.title.toLowerCase().includes(w)) - words.every(w => a.title.toLowerCase().includes(w))) || (b.card - a.card));
  const mark = t => { let h = esc(t); for (const w of words) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'); return h; };
  const places = new Set(hits.map(x => x.where)).size;
  document.querySelectorAll('.set-nav a.on').forEach(a => a.classList.remove('on'));
  main.innerHTML = `<div class="head"><div class="grow"><h1>Settings for “${esc(q.trim())}”</h1><p class="muted">${hits.length ? `${hits.length} setting${hits.length === 1 ? '' : 's'} in ${places} place${places === 1 ? '' : 's'}.` : 'Nothing by that name. Try another word, or look through the places on the left.'}</p></div></div>
    ${hits.length ? `<section class="card set-hits">${hits.slice(0, 40).map(x => `<a class="set-hit" href="${x.href}" data-act="setGo" data-find="${esc(x.title)}"><span class="grow"><b>${mark(x.title)}</b>${x.about ? `<span class="small muted">${mark(x.about)}</span>` : ''}</span><span class="set-where small muted">${esc(x.where)}</span><span class="btn sm">Open</span></a>`).join('')}</section>` : ''}`;
}
document.addEventListener('input', e => {
  if (e.target.id !== 'setFind') return;
  clearTimeout(setFindTimer);
  const q = e.target.value;
  setFindTimer = setTimeout(() => settingsFind(q), 160);
});
// "/" goes to the search of settings; Escape empties it.
document.addEventListener('keydown', e => {
  const box = $('#setFind'); if (!box) return;
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); box.focus(); box.select(); }
  else if (e.key === 'Escape' && e.target === box && box.value) { box.value = ''; settingsFind(''); }
});

/** The bookmark's name. Its icon is the Job Hunt logo, kept from the setup page it was made from. */
const BOOKMARK_NAME = 'Send to Job Hunt';
/** The setup page, opened in your browser: its icon is the Job Hunt logo, so a bookmark of it shows the
 *  logo; its address is then swapped for the button's code, and the logo stays. */
async function bookmarkPage() {
  const blob = await (await fetch('/static/icon-192.png')).blob();
  const logo = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  const code = JSON.stringify(bookmarklet()).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${BOOKMARK_NAME}</title>
<link rel="icon" type="image/png" href="${logo}"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px/1.55 system-ui,"Segoe UI",sans-serif;color:#1f201d;background:#f4f4f2;margin:0;padding:48px 16px}
main{max-width:620px;margin:0 auto;background:#fff;border:1px solid #eaeae6;border-radius:16px;padding:32px}
h1{font-size:24px;margin:12px 0 4px}ol{padding-left:22px}li{margin:14px 0}kbd{background:#efefec;border-radius:6px;padding:1px 6px;font:inherit}
button{font:inherit;background:#1f201d;color:#fff;border:0;border-radius:999px;padding:8px 18px;cursor:pointer}p.note{color:#636361;font-size:14px}</style></head>
<body><main><img src="${logo}" width="48" height="48" alt=""><h1>Send to Job Hunt</h1>
<p>Three steps give your browser a Job Hunt button with the Job Hunt logo.</p>
<ol><li>Press <kbd>Ctrl</kbd>+<kbd>D</kbd> to bookmark this page. Choose <b>Bookmarks bar</b> as the folder, keep the name, and press <b>Done</b>. (No bookmarks bar? Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.)</li>
<li><button id="copy">Copy the code</button> <span id="done"></span></li>
<li>Right-click the new <b>Send to Job Hunt</b> on your bookmarks bar and choose <b>Edit</b>. Select everything in the <b>URL</b> box, paste, and <b>Save</b>.</li></ol>
<p>Then, on any job posting (LinkedIn, Indeed, a company's site), click it: Job Hunt adds the job, scores it and puts it in your Queue, ready for you to tailor when you choose.</p>
<p class="note">The bookmark usually keeps the Job Hunt logo. If your browser shows a plain icon instead, the button works just the same.</p></main>
<script>var CODE=${code};document.getElementById('copy').onclick=function(){var d=document.getElementById('done');
function ok(){d.textContent='Copied. Now step 3.';}function fb(){var t=document.createElement('textarea');t.value=CODE;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();ok();}
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(CODE).then(ok,fb);else fb();};</script></body></html>`;
}
const bookmarklet = () => 'javascript:' + encodeURIComponent(`(${clipPage.toString()})()`);

// Versions have three parts everywhere: 1.7.0, 1.8.0… Older feeds wrote "1.07", which reads as 1.7.0.
function shortVersion(v) {
  const p = String(v || '').split('.');
  if (p.length === 2 && p[1] !== '') return `${Number(p[0])}.${Number(p[1])}.0`;
  return String(v || '');
}
const versionKey = v => { const [a, b, c] = shortVersion(v).split('.').map(Number); return (a || 0) * 1e6 + (b || 0) * 1e3 + (c || 0); };

async function showWhatsNew() {
  const box = $('#whatsnew');
  if (!box) return;
  try {
    const r = await api('/api/changelog');
    const current = shortVersion(r.current);
    // Include versions an available update would bring, from its own history.
    const extra = (update?.history || []).map(e => ({ ...e, version: shortVersion(e.version) })).filter(e => versionKey(e.version) > versionKey(current));
    const log = [...extra, ...r.log.map(e => ({ ...e, version: shortVersion(e.version) })).filter(e => !extra.some(x => x.version === e.version))];
    const entry = e => `<li>
      <h3>${esc(e.version)} · ${esc(e.title)}${e.version === current ? '<span class="pill">Installed</span>' : versionKey(e.version) > versionKey(current) ? '<span class="pill approved">Ready to install</span>' : ''}</h3>
      ${e.date ? `<p class="muted small">${esc(fmtDate(e.date))}</p>` : ''}
      <ul>${(e.changes || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul></li>`;
    // The newest few, and anything not installed yet; the rest folded away.
    const shown = Math.max(3, extra.length + 1);
    box.innerHTML = `<header><h2>What's new</h2></header><ol class="whatsnew">${log.slice(0, shown).map(entry).join('')}</ol>
      ${log.length > shown ? `<details><summary class="small muted">Earlier versions (${log.length - shown})</summary><ol class="whatsnew">${log.slice(shown).map(entry).join('')}</ol></details>` : ''}`;
  } catch (e) { box.innerHTML = `<header><h2>What's new</h2></header><p class="muted small">${esc(e.message)}</p>`; }
}

// ---- Progress bars ----
// Where a spinner would go, a small bar fills over the time that kind of work usually takes: your own
// average from Claude's requests this month (see /api/usage), or a fair guess until there is one. It
// slows as it nears the end and stops short of full, so it never says "done" before the work is.
// Work with real progress (a search) gives its percentage in data-p. A page redrawn while the work
// runs carries on from where its bar was, rather than starting again.
const GUESS_SECS = { score: 25, tailor: 100, revise: 40, answers: 45, followup: 25, outreach: 25, offer: 50, chat: 25, prep: 80, thanks: 25, decline: 25, lessons: 45, review: 40,
  career: 120, coach: 90, insights: 60, ratings: 45, recruiters: 60, employers: 120 };
let typicalSecs = {};
async function loadTypical() {
  try {
    const u = await api('/api/usage');
    for (const k of u.month?.kinds || []) {
      const { calls, secs, errors } = k.usage || {};
      const ok = (calls || 0) - (errors || 0);
      if (ok > 0 && secs > 0) typicalSecs[k.kind] = secs / calls;
    }
  } catch {}
}
/** How long a bar's work usually takes, in seconds. */
function expectedSecs(el) {
  if (el.dataset.secs) return Number(el.dataset.secs);
  const each = (el.dataset.kind || '').split('+').filter(Boolean).reduce((t, k) => t + (typicalSecs[k] || GUESS_SECS[k] || 30), 0) || 30;
  return each * Math.max(1, Number(el.dataset.n) || 1);
}
const barStarts = new Map(); // which work → [when it started, last seen]
function barKey(el) {
  // The same work on a redrawn page: its kind, the page, and the words beside it (numbers left out).
  const near = (el.parentElement?.textContent || '').replace(/\d+/g, '').trim().slice(0, 40);
  return `${el.dataset.kind || ''}|${location.hash.split('/')[0]}|${el.closest('[data-job]')?.dataset.job || ''}|${near}`;
}
function tickBars() {
  const now = Date.now();
  for (const el of document.querySelectorAll('.spin')) {
    let p;
    if (el.dataset.p != null && el.dataset.p !== '') p = Math.max(2, Math.min(100, Number(el.dataset.p))) / 100;
    else {
      const key = barKey(el);
      const seen = barStarts.get(key) || [now, now];
      seen[1] = now;
      barStarts.set(key, seen);
      // About 80% at the usual time, then slower and slower, never past 95%.
      const t = (now - seen[0]) / 1000 / expectedSecs(el);
      p = Math.max(0.04, Math.min(0.95, 1 - Math.exp(-1.6 * t)));
    }
    el.style.setProperty('--p', p.toFixed(3));
    if (!el.hasAttribute('role')) { el.setAttribute('role', 'progressbar'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100'); }
    el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }
  // Work no longer on screen for a while has finished: its bar starts afresh next time.
  for (const [k, v] of barStarts) if (now - v[1] > 5000) barStarts.delete(k);
}
loadTypical();
setInterval(loadTypical, 60 * 60 * 1000);
setInterval(tickBars, 400);
// Drawn at once (not at the next tick), so a new bar never shows empty or full for a moment.
new MutationObserver(() => tickBars()).observe(document.body, { childList: true, subtree: true });

let update = null;
/** The version whose top bar you put off with Later (it comes back for the next version). */
let updateBarLater = null;
/** A bar across the top of every page while an update waits: the sidebar note is easy to miss. */
function updateBarHtml() {
  return updatedBarHtml() + readyBarHtml();
}
/** Just updated (installed and restarted onto a newer version): what changed, until you press Got it. */
let updated = null;
function updatedBarHtml() {
  if (!updated) return '';
  const titles = updated.news.map(e => e.title).filter(Boolean);
  return `<div class="update-bar done" id="updatedBar" role="status"><span><b>✓ Job Hunt was updated to ${esc(updated.to)}.</b>${titles.length ? ` <span class="muted">${esc(titles.slice(0, 3).join(' · '))}${titles.length > 3 ? ` and ${titles.length - 3} more` : ''}</span>` : ''}</span>
    <span class="row"><a class="btn ghost" href="#settings/app" data-act="updatedOk">What's new</a><button class="btn" data-act="updatedOk">Got it</button></span></div>`;
}
/** Opening Job Hunt on a newer version than this window last saw: say so, with what changed since. */
async function noteUpdated() {
  const now = shortVersion(overview?.version);
  if (!now) return;
  let seen = null;
  try { seen = localStorage.getItem('seenVersion'); localStorage.setItem('seenVersion', now); } catch (e) { return; }
  if (!seen || versionKey(seen) >= versionKey(now)) return;
  let log = [];
  try { log = (await api('/api/changelog')).log || []; } catch (e) { /* the bar still says it updated */ }
  const news = log.map(e => ({ ...e, version: shortVersion(e.version) })).filter(e => versionKey(e.version) > versionKey(seen) && versionKey(e.version) <= versionKey(now));
  updated = { from: seen, to: now, news };
  if (!$('#updatedBar')) main().querySelector('.page')?.insertAdjacentHTML('afterbegin', updatedBarHtml());
}
function readyBarHtml() {
  if (!update?.available || updateBarLater === update.version) return '';
  return `<div class="update-bar" id="updateBar"><span><b>Job Hunt ${esc(shortVersion(update.version))} is ready.</b> <span class="muted">Your applications and settings stay as they are.</span></span>
    <span class="row"><button class="btn primary" data-act="updateInstall">Install and restart</button><a class="btn ghost" href="#settings/app">What's new</a><button class="btn ghost" data-act="updateLater">Later</button></span></div>`;
}
function showUpdate(u) {
  const bar = $('#updateBar');
  if (!u?.available || updateBarLater === u.version) bar?.remove();
  else if (!bar) main().querySelector('.page')?.insertAdjacentHTML('afterbegin', readyBarHtml());
  const note = $('#updateNote');
  if (u?.available) {
    note.innerHTML = `<b>Job Hunt ${esc(shortVersion(u.version))} is ready</b>
      <div class="row"><button class="btn primary" data-act="updateInstall">Install and restart</button><a class="btn ghost" href="#settings/app">What's new</a></div>`;
    note.hidden = false;
  } else note.hidden = true;
  const status = $('#updateStatus');
  if (status) {
    status.textContent = u?.server ? (u.newer ? `Version ${shortVersion(u.version)} is out. Update the Job Hunt image in Container Manager to get it.` : `You're on the newest version (${shortVersion(u.current)}).`)
      : u?.error ? `Couldn't check for updates: ${u.error}`
      : u?.available ? `Version ${shortVersion(u.version)} is ready to install. Your data stays as it is; Job Hunt restarts on the new version.`
      : u ? `You're on the newest version (${shortVersion(u.current)}).` : status.textContent;
    $('#updateInstallBtn').hidden = !u?.available;
  }
}

async function checkUpdate() {
  try { update = await api('/api/update/check'); } catch (e) { update = { error: e.message }; }
  showUpdate(update);
  return update;
}

/** One certification, as a row of boxes on Me, About me. */
const certRow = (c = {}) => `<div class="cert-row" data-cert>
  <label class="field">Certification<input type="text" data-k="name" value="${esc(c.name || '')}" placeholder="Project Management Professional (PMP)"></label>
  <label class="field">Issued by<input type="text" data-k="issuer" value="${esc(c.issuer || '')}" placeholder="PMI"></label>
  <label class="field">Credential number<input type="text" data-k="number" value="${esc(c.number || '')}" placeholder="Optional"></label>
  <label class="field">Issued<input type="text" data-k="issued" value="${esc(c.issued || '')}" placeholder="May 2021"></label>
  <label class="field">Expires<input type="text" data-k="expires" value="${esc(c.expires || '')}" placeholder="Never, or a date"></label>
  <button class="btn ghost danger sm" type="button" data-act="certRemove" aria-label="Remove this certification">Remove</button></div>`;

/** The profile with whatever fields this form holds: settings can sit in any card or tab. */
function readProfile(form, part) {
  const p = JSON.parse(JSON.stringify(settingsCache.profile));
  const el = n => form.elements[n];
  const v = n => el(n)?.value ?? '';
  const has = n => el(n) != null;
  for (const k of ['name', 'email', 'timezone', 'guidance', 'stories', 'application_facts']) if (has(k)) p[k] = v(k).trim();
  for (const k of ['remote_ok', 'include_metro', 'auto_tailor']) if (has(k)) p[k] = !!el(k).checked;
  if (part === 'certs') p.certifications = [...form.querySelectorAll('[data-cert]')].map(r => Object.fromEntries([...r.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value.trim()]))).filter(c => c.name);
  if (has('auto_tailor_mode')) { p.auto_tailor = v('auto_tailor_mode') === 'all'; p.auto_tailor_min = v('auto_tailor_mode') === 'strong' ? 85 : 0; }
  // What you want from a role (Me, Looking for): told to the scorer.
  if (has('want_level')) p.wants = { level: v('want_level').trim(), work: v('want_work'), industries: fromLines(v('want_industries')), avoid: fromLines(v('want_avoid')), dealbreakers: fromLines(v('want_dealbreakers')), path: has('want_path') ? v('want_path').trim() : (p.wants?.path || '') };
  for (const k of ['score_threshold', 'max_per_run', 'max_scored_per_run', 'purge_after_days', 'max_age_days', 'search_hour', 'search_hour_2', 'searches_per_day', 'linkedin_note', 'inbox_minutes', 'follow_up_after', 'weekly_goal']) if (has(k)) p[k] = Number(v(k) || 0);
  for (const k of ['locations', 'exclude_companies', 'exclude_title_keywords']) if (has(k)) p[k] = fromLines(v(k));
  if (has('min_salary')) p.min_salary = v('min_salary') ? Number(v('min_salary')) : null;
  if (has('min_rating')) p.min_rating = v('min_rating') ? Number(v('min_rating')) : null;
  if (has('adzuna_country')) Object.assign(p.sources, { adzuna_where: [], adzuna_country: v('adzuna_country') || 'ca' });
  if (part === 'boards') {
    p.sources.auto_boards = !!form.querySelector('[name=auto_boards]')?.checked;
    // Workday links can hold commas in rare cases, so they're split by line only.
    const byLine = x => x.split('\n').map(y => y.trim()).filter(Boolean);
    Object.assign(p.sources, { greenhouse: fromLines(v('greenhouse')), lever: fromLines(v('lever')), ashby: fromLines(v('ashby')),
      workday: byLine(v('workday')), smartrecruiters: fromLines(v('smartrecruiters')), workable: fromLines(v('workable')), bamboohr: fromLines(v('bamboohr')) });
  }
  for (const k of ['work_start', 'work_end', 'slot_minutes', 'propose_slots', 'prep_minutes']) if (has(k)) p.calendar[k] = Number(v(k));
  if (has('calendar_id')) p.calendar.calendar_id = v('calendar_id').trim() || 'primary';
  if (has('followup_days')) p.calendar.followup_days = fromLines(v('followup_days')).map(Number).filter(n => n > 0);
  return p;
}

// Board lists can change while Settings is open (Remove buttons, employers found by themselves):
// show the server's lists, without touching a field you're typing in.
async function reloadBoards() {
  if (!settingsCache) return;
  try { settingsCache.profile = (await api('/api/settings')).profile; } catch { return; }
  showBoardFields();
}
function showBoardFields() {
  const f = document.querySelector('form[data-form=profile][data-part=boards]');
  if (!f || !settingsCache) return;
  for (const k of ['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable', 'bamboohr']) {
    const el = f.elements[k];
    if (el && el !== document.activeElement) el.value = lines(settingsCache.profile.sources[k]);
  }
}

// Ticking roles to tailor
/** The Pick list's sort and filters, applied to its rows in place (ticks stay), and remembered. */
function applyPickView(box, saved) {
  const controls = [...box.querySelectorAll('[data-pickf]')];
  if (saved) controls.forEach(el => { if (el.dataset.pickf in saved) el.type === 'checkbox' ? el.checked = !!saved[el.dataset.pickf] : el.value = saved[el.dataset.pickf]; });
  // Until you choose otherwise: the best to apply to now first, and with a long list, the best ten.
  if (saved) {
    let fresh = false;
    try { fresh = !localStorage.getItem('jh.pickNow'); localStorage.setItem('jh.pickNow', '1'); } catch (e) {}
    const sort = controls.find(el => el.dataset.pickf === 'sort'), top = controls.find(el => el.dataset.pickf === 'top');
    if (fresh && sort) sort.value = 'now';
    if (top && !('top' in saved)) top.checked = (box.querySelector('.pick-list')?.children.length || 0) > 15;
  }
  const v = {};
  controls.forEach(el => { v[el.dataset.pickf] = el.type === 'checkbox' ? el.checked : el.value; });
  if (!saved) try { localStorage.setItem('jh.pickView', JSON.stringify(v)); } catch (e) {}
  const list = box.querySelector('.pick-list');
  if (!list) return;
  const key = { now: 'now', fit: 'score', reach: 'reach', new: 'age', pay: 'pay', rating: 'rating' }[v.sort] || 'now';
  // Expired postings last, whatever the order.
  const rows = [...list.children].sort((a, b) => (a.dataset.expired === '1') - (b.dataset.expired === '1') || Number(b.dataset[key]) - Number(a.dataset[key]) || Number(b.dataset.score) - Number(a.dataset.score));
  let shown = 0;
  for (const r of rows) {
    // Fit: "70" is 70 or more, "-70" under 70. Found: "7" within 7 days, "-14" over 14 days ago.
    const min = Number(v.min || 0), score = Number(r.dataset.score), age = Number(v.age || 0);
    const days = (Date.now() - Number(r.dataset.age || 0)) / 86400000;
    const hide = (min >= 0 ? score < min : score >= -min) || (age > 0 && days > age) || (age < 0 && days <= -age) || (v.pay && !(Number(r.dataset.pay) > 0))
      || (v.flags && Number(r.dataset.flags) > 0) || (v.place && !r.dataset.place.includes(v.place));
    // Best 10 only: the first ten that pass the filters, in the order chosen.
    const over = !hide && v.top && shown >= 10;
    r.hidden = hide || over;
    if (r.hidden) r.querySelector('[data-pick]').checked = false; // never tailor what you can't see
    else shown++;
    list.appendChild(r);
  }
  const more = box.querySelector('[data-pickmore]');
  if (more) { more.hidden = !(v.top && rows.length > shown); more.innerHTML = more.hidden ? '' : `Showing the best ${shown} of ${rows.length}. Deal with these first: the rest wait. <button class="btn ghost sm" type="button" data-act="pickShowAll">Show all ${rows.length}</button>`; }
  // With filters on, every count says what you can see, and how to see the rest.
  const hidden = rows.length - shown;
  const count = box.querySelector('[data-pickcount]');
  if (count) count.innerHTML = hidden ? `<b>${hidden} hidden by your filters.</b> <button class="btn ghost sm" type="button" data-act="pickShowAll">Show all ${rows.length}</button>` : '';
  const head = document.querySelector('[data-pickhead]');
  if (head) head.textContent = hidden ? `${shown} of ${rows.length} new matches` : `${rows.length} new match${rows.length === 1 ? '' : 'es'}`;
  const chip = document.querySelector('.pipe-tabs a[href="#applications/pick"] .n');
  if (chip) { chip.textContent = String(shown); chip.title = hidden ? `${shown} shown, ${hidden} hidden by your filters` : ''; }
  pickChanged(box);
}
function restorePickViews() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('jh.pickView') || 'null'); } catch (e) {}
  document.querySelectorAll('[data-pickbox]').forEach(b => applyPickView(b, saved || {}));
  applyQueueView(true);
}
/** The Queue's sort and filters, over every group in its list, and remembered: jobs that state no
 *  pay or have red flags are hidden when you ask, and each group is put in the order chosen. The
 *  Pick group has its own, finer controls; these set them to match. */
function applyQueueView(restore) {
  const box = document.querySelector('[data-queuebox]');
  if (!box) return;
  const controls = [...box.querySelectorAll('[data-queuef]')];
  // On the first group's heading line, to its right: no row of its own.
  const first = document.querySelector('.page [data-act=approveAll], .page [data-act=pickAll]')?.closest('.todo-group')?.querySelector('.group-h');
  if (first && !first.contains(box)) { first.appendChild(box); box.classList.add('inline'); first.classList.add('with-filters'); }
  if (restore) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('jh.queueF') || '{}') || {}; } catch (e) {}
    controls.forEach(el => { if (el.dataset.queuef in saved) el.type === 'checkbox' ? el.checked = !!saved[el.dataset.queuef] : el.value = saved[el.dataset.queuef]; });
  }
  const v = Object.fromEntries(controls.map(el => [el.dataset.queuef, el.type === 'checkbox' ? el.checked : el.value]));
  if (!restore) { try { localStorage.setItem('jh.queueF', JSON.stringify(v)); } catch (e) {} }
  const rows = [...document.querySelectorAll('.page .jrow[data-job-row]')];
  let shown = 0;
  const parents = new Set();
  for (const r of rows) {
    const hide = (v.pay && r.dataset.qhaspay !== '1') || (v.flags && Number(r.dataset.qflags) > 0);
    r.classList.toggle('qf-hide', hide);
    if (hide) r.querySelectorAll('input[type=checkbox]:checked').forEach(c => { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); // never act on what you can't see
    else shown++;
    if (!r.parentElement.classList.contains('pick-list')) parents.add(r.parentElement);
  }
  // Each group in the order chosen; its heading, buttons and bar stay where they are.
  if (v.sort) for (const p of parents) {
    const mine = [...p.children].filter(c => c.matches('.jrow[data-job-row]'));
    const after = mine[mine.length - 1].nextSibling;
    mine.sort((a, b) => Number(b.dataset['q' + v.sort]) - Number(a.dataset['q' + v.sort])).forEach(r => p.insertBefore(r, after));
  }
  // A group with nothing left to show steps aside.
  document.querySelectorAll('.page .todo-group').forEach(g => { const all = g.querySelectorAll('.jrow[data-job-row]'); const card = g.closest('.card'); if (card && all.length) card.classList.toggle('qf-hide', !g.querySelector('.jrow[data-job-row]:not(.qf-hide)') && !card.contains(box)); });
  // The Pick group's own controls follow these (only when you change one here).
  if (!restore) document.querySelectorAll('[data-pickbox]').forEach(pb => {
    const set = (k, val) => { const el = pb.querySelector(`[data-pickf="${k}"]`); if (el) el.type === 'checkbox' ? el.checked = val : el.value = val; };
    set('pay', !!v.pay); set('flags', !!v.flags);
    if (v.sort) set('sort', v.sort);
    applyPickView(pb);
  });
  if (typeof applyListSort === 'function') applyListSort();
  const n = box.querySelector('[data-queuecount]');
  if (n) n.innerHTML = shown < rows.length ? `Showing ${shown} of ${rows.length}. <a href="#" data-act="queueFClear">Show all</a>` : '';
}
/** The bar at the bottom while jobs are ticked: how many, and what to do with them. */
function selectBar(box, n) {
  const bar = box.querySelector('.select-bar');
  if (!bar) return;
  bar.hidden = !n;
  bar.querySelector('.select-n').textContent = `${n} selected`;
}
function approveChanged(box) {
  const n = box.querySelectorAll('[data-appr]:checked').length;
  const btn = box.querySelector('button[data-act=approvePicked]');
  if (btn) { btn.disabled = !n; btn.textContent = n ? `Approve ${n}` : 'Approve selected'; }
  selectBar(box, n);
  const all = box.querySelector('[data-act=approveAll]');
  if (all) all.textContent = n && n === box.querySelectorAll('[data-appr]').length ? 'Clear' : 'Select all';
}
function pickChanged(box) {
  const n = box.querySelectorAll('[data-pick]:checked').length;
  const btn = box.querySelector('button[data-act=tailorPicked]');
  if (btn) { btn.disabled = !n; btn.textContent = n ? `Tailor ${n}` : 'Tailor selected'; }
  selectBar(box, n);
  const all = box.querySelector('[data-act=pickAll]');
  if (all) all.textContent = n && n === box.querySelectorAll('.jrow:not([hidden]) [data-pick]').length ? 'Clear' : 'Select all';
}
// Sync: the folder box only for syncing through a folder.
document.addEventListener('change', e => {
  if (e.target.name !== 'where' || !e.target.closest('[data-form=sync]')) return;
  const box = e.target.closest('form').querySelector('.sync-folder');
  if (box) box.hidden = e.target.value === 'drive';
});
document.addEventListener('change', e => {
  const box = e.target.closest?.('[data-pickbox]');
  if (box && e.target.matches('[data-pick]')) pickChanged(box);
  if (box && e.target.matches('[data-pickf]')) applyPickView(box);
  if (e.target.matches?.('[data-queuef]')) applyQueueView(false);
  const abox = e.target.closest?.('[data-approvebox]');
  if (abox && e.target.matches('[data-appr]')) approveChanged(abox);
});

// Place pickers: a place typed (or chosen from the list) is added on Enter or when you move on;
// changing the country offers that country's cities.
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('.place-input')) { e.preventDefault(); e.target.closest('[data-places]').querySelector('[data-act=placeAdd]').click(); }
});
document.addEventListener('change', e => {
  if (e.target.matches?.('.place-input') && e.target.value.trim()) e.target.closest('[data-places]').querySelector('[data-act=placeAdd]').click();
  if (e.target.matches?.('select[name=country], select[name=adzuna_country]')) {
    const box = e.target.closest('form')?.querySelector('[data-places]');
    if (box) placesSet(box, placesOf(box), e.target.value);
  }
});

// The API key field only matters with the API option.
document.addEventListener('change', e => {
  if (e.target.matches?.('form[data-form=claude] [name=engine]')) {
    const f = $('#apiKeyField'), c = $('#ccStatus'), useKey = e.target.value === 'api';
    if (f) f.hidden = !useKey;
    if (c) { c.hidden = useKey; if (!useKey) checkClaude(true); }
  }
});

// ---- Connections: one row each, with its status and what fixes it ----
const CONN_PILL = { ok: ['good', 'Working'], partial: ['warn', 'Some not working'], problem: ['crit', 'Needs attention'], off: ['', 'Off'], setup: ['', 'Not set up'], unknown: ['good', 'On'], na: ['', 'Not in your country'] };
/** The recruiters database: everyone who emailed you about a role, with the applications they handled. */
let recruiterQuery = '';
async function showRecruiters() {
  const rec = await api('/api/recruiters');
  const list = rec.recruiters || [];
  const shown = list.filter(r => !r.hidden), hidden = list.filter(r => r.hidden);
  const when = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const apps = r => (r.applications || []).map(a => `<a href="#job/${encodeURIComponent(a.job_id)}">${esc(a.title || 'An application')}</a> ${a.status ? stagePill(a.status) : ''}<span class="muted small"> · ${esc(a.emails)} email${a.emails === 1 ? '' : 's'}, last ${esc(when(a.last_at))}${a.last_subject ? ` · “${esc(a.last_subject)}”` : ''}</span>`);
  const card = r => `<section class="card rec" data-text="${esc(`${r.name} ${r.company} ${r.email} ${(r.roles || []).join(' ')} ${r.notes}`.toLowerCase())}">
    <header><h2>${esc(r.name || r.email)} <span class="muted small" style="font-weight:400">${r.kind === 'agency' ? 'agency recruiter at' : 'recruiter at'} <b>${esc(r.company)}</b></span></h2>
      <span class="row"><button class="btn ghost sm" data-act="recruiterEdit" data-email="${esc(r.email)}">Edit</button><button class="btn ghost sm" data-act="recruiterHide" data-email="${esc(r.email)}" data-hidden="${r.hidden ? '0' : '1'}">${r.hidden ? 'Use again' : 'Not a recruiter'}</button></span></header>
    <div class="facts"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}${r.linkedin ? `<a href="#" data-act="link" data-url="${esc(r.linkedin)}">LinkedIn</a>` : ''}<span>${esc(RECRUITER_STAGE[r.stage] || 'emailed you')}</span><span>last ${esc(when(r.last_at))}</span></div>
    ${(r.applications || []).length ? `<div class="small"><b>Your applications they handled</b><ul class="rec-apps">${apps(r).map(x => `<li>${x}</li>`).join('')}</ul></div>`
      : (r.roles || []).length ? `<p class="small muted">Wrote about ${esc(r.roles.join(', '))}.</p>` : ''}
    ${(r.jobs || []).filter(j => !(r.applications || []).some(a => a.job_id === j.id)).length ? `<p class="small">Open at ${esc(r.company)} in your lists: ${r.jobs.filter(j => !(r.applications || []).some(a => a.job_id === j.id)).map(j => `<a href="#job/${encodeURIComponent(j.id)}">${esc(j.title)}</a>`).join(', ')}</p>` : ''}
    ${r.notes ? `<p class="small"><b>Notes:</b> ${esc(r.notes)}</p>` : ''}
    <form class="form rec-edit" data-form="recruiterEdit" hidden>
      <input type="hidden" name="email" value="${esc(r.email)}">
      <label class="field">Name<input name="name" value="${esc(r.name)}"></label><label class="field">Company<input name="company" value="${esc(r.company)}"></label>
      <label class="field">Phone<input name="phone" value="${esc(r.phone)}"></label><label class="field">LinkedIn<input name="linkedin" value="${esc(r.linkedin)}"></label>
      <label class="field" style="grid-column:1/-1">Notes<textarea name="notes">${esc(r.notes)}</textarea></label>
      <div class="row"><button class="btn primary" type="submit">Save</button></div></form></section>`;
  page(`${inboxHead('recruiters', 'Recruiters who emailed you about a role, saved with the applications they handled. Ask them to put you forward for new roles.', `${rec.gmail ? `<button class="btn" data-act="recruiterScan" ${rec.scanning ? 'disabled' : ''}>${rec.scanning ? '<span class="spin" data-kind="recruiters"></span>Looking…' : 'Find them in my email'}</button>` : ''}
        <button class="btn" data-act="recruiterNew">Add a recruiter</button><a class="btn ghost" href="/api/recruiters.csv" download>Download spreadsheet</a>`)}
    <section class="card"><header><h2>When you apply</h2></header>
      <p class="muted small">When you mark an application as submitted (or Job Hunt sees the confirmation email), it writes to the recruiter on it, or one you know at that company, or the person named in the posting: that you've applied, and, if they know you, could they put you forward. Never more than once a week to the same person, and never to the address the application went to.</p>
      <div class="row" style="gap:16px;flex-wrap:wrap">${[['draft', 'Draft it in Gmail for me to send'], ['send', 'Send it for me'], ['off', 'Off']].map(([v, n]) => `<label class="check"><input type="radio" name="applyMode" data-act="applyMode" value="${v}" ${(rec.on_apply?.mode || 'draft') === v ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" data-act="applyCv" ${rec.on_apply?.attach_cv ? 'checked' : ''}> <span>Attach my tailored CV to emails Job Hunt sends</span></label>
      ${rec.gmail ? '' : '<p class="muted small">Needs Gmail connected (Settings → Accounts); until then the email is written on the application\'s People list for you to copy.</p>'}</section>
    <section class="card"><header><h2>People you know</h2></header>
      <p class="muted small">Your LinkedIn connections, so each job shows who you know at the company and Job Hunt drafts a note asking for a referral. A referral is the surest way past the pile. In LinkedIn: Me → Settings → Data privacy → Get a copy of your data → Connections; LinkedIn emails you a file within the hour. Choose <b>Connections.csv</b> from it here. It stays on your computer.</p>
      <div class="row"><label class="btn ${rec.network?.count ? '' : 'primary'}">${rec.network?.count ? 'Replace with a newer export' : 'Choose Connections.csv'}<input type="file" accept=".csv" data-upload="network" hidden></label>
      ${rec.network?.count ? `<span class="muted small">${rec.network.count} connections${rec.network.at ? `, saved ${esc(ago(rec.network.at))}` : ''}</span><button class="btn ghost" data-act="forgetNetwork">Remove them</button>` : ''}</div></section>
    <form class="card form" data-form="recruiterEdit" id="recruiterNew" hidden><h2 style="grid-column:1/-1">Add a recruiter</h2>
      <label class="field">Name<input name="name" required></label><label class="field">Email<input name="email" type="email" required></label>
      <label class="field">Company<input name="company" required></label><label class="field">Phone<input name="phone"></label>
      <label class="field" style="grid-column:1/-1">Notes<textarea name="notes" placeholder="How you know them"></textarea></label>
      <div class="row"><button class="btn primary" type="submit">Add</button></div></form>
    ${list.length ? `<input type="search" id="recFilter" class="filter" placeholder="Find a recruiter, company or role" value="${esc(recruiterQuery)}" style="max-width:420px">` : ''}
    ${shown.length ? shown.map(card).join('') : `<section class="card"><p class="muted">${!rec.gmail ? 'Connect Gmail and Job Hunt finds them in your email: it reads the last two years once, then saves each recruiter as their emails arrive. <div class="row" style="margin-top:8px"><a class="btn primary" href="#settings/connections">Connect Gmail</a></div>' : rec.last ? 'None found yet. Each recruiter is saved as their emails arrive.' : 'Job Hunt looks through the last two years of your email for them once, then saves each new one as their emails arrive.'}</p></section>`}
    <p class="empty" id="recNone" hidden>No recruiter matches.</p>
    ${hidden.length ? `<details class="card"><summary class="muted">${hidden.length} marked not a recruiter</summary>${hidden.map(card).join('')}</details>` : ''}
    ${rec.last ? `<p class="muted small">Last looked through your email ${esc(ago(rec.last))}.</p>` : ''}`);
  const f = $('#recFilter');
  const apply = () => { recruiterQuery = f.value; const q = f.value.trim().toLowerCase(); let n = 0;
    document.querySelectorAll('.rec').forEach(c => { const on = !q || c.dataset.text.includes(q); c.hidden = !on; if (on) n++; }); $('#recNone').hidden = n > 0 || !q; };
  if (f) { f.addEventListener('input', apply); apply(); }
}

/** "You know a recruiter here": who, what you talked about, and the email asking them to put you forward. */
const RECRUITER_STAGE = { interview: 'you got to an interview', screen: 'you had a screening call', rejected: 'it ended in a rejection', offer: 'you got an offer', outreach: 'they approached you' };
const firstName = n => (n || '').split(/\s+/)[0] || 'them';
function recruiterCard(r, j) {
  const when = r.last_at ? new Date(r.last_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
  const about = (r.roles || []).length ? ` about ${esc(r.roles.slice(0, 2).join(', '))}` : '';
  return `<div class="card recruiter-card"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
    <span class="grow"><b>You know a recruiter at ${esc(r.company)}: ${esc(r.name)}</b><br>
      <span class="muted small">They emailed you${about}${when ? ` in ${esc(when)}` : ''}${RECRUITER_STAGE[r.stage] ? `, and ${RECRUITER_STAGE[r.stage]}` : ''}. Apply, then ask them to put you forward: it gets you past the pile of cold applications.</span></span>
    <span class="row">${r.asked ? '<span class="pill good">Asked</span>' : ''}<button class="btn ${r.asked ? '' : 'primary'}" data-act="askRecruiter" data-job="${esc(j.id)}" data-name="${esc(firstName(r.name))}">${r.asked ? 'Write again' : `Ask ${esc(firstName(r.name))} to put you forward`}</button></span></div></div>`;
}

/** Connecting Google away from the computer running Job Hunt: three steps, ending in a paste. */
function googlePasteBox(url) {
  return `<ol class="small apply-steps" style="margin-top:10px">
    <li>${url ? `<a class="btn primary sm" href="${esc(url)}" target="_blank" rel="noopener">Open Google sign-in</a>` : 'Press Connect Google again to start.'} and approve access with your Google account.</li>
    <li>Google then sends you to a page that <b>doesn't open</b> (its address starts with <code>http://127.0.0.1</code>). That's expected: copy that page's whole address from the address bar.</li>
    <li><span class="row" style="gap:6px"><input type="text" id="googlePasteUrl" placeholder="http://127.0.0.1:1/?state=…&code=…" style="flex:1;min-width:200px"><button class="btn primary sm" data-act="googleFinish">Finish</button></span></li></ol>`;
}

/** Recruiters' and job sites' own listings: which to search, how each is doing, and your own sites. */
const SITE_STATE = { ok: ['good', 'Working'], quiet: ['warn', 'No postings found'], problem: ['crit', "Couldn't read"], unknown: ['', 'Not searched yet'] };
function sitesForm(st) {
  const on = st.profile.sources.sites || [], mine = st.profile.sources.custom_sites || [];
  const status = Object.fromEntries((st.sites?.status || []).map(x => [x.id, x]));
  const pill = id => { const x = status[id]; if (!x) return ''; const [cls, label] = SITE_STATE[x.state] || ['', x.state]; return `<span class="pill ${cls}" title="${esc(x.detail)}">${label}</span>`; };
  // A recruiter site that can't be read (or shows nothing) still sends job alerts: suggest those.
  const ALERTS_OK = ['randstad', 'adecco', 'hays', 'roberthalf', 'michaelpage', 'altis', 'lro', 'peoplefirst', 'techtalent', 'jobsca', 'aplin'];
  const line = id => status[id] && status[id].state !== 'unknown' ? `<br><span class="small ${status[id].state === 'problem' ? '' : 'muted'}">${esc(status[id].detail)}${status[id].at ? ` · ${esc(ago(status[id].at))}` : ''}</span>${['problem', 'quiet'].includes(status[id].state) && ALERTS_OK.includes(id) ? '<br><span class="small">Tip: set up job alerts on its website for your titles, sent to your Gmail. Job Hunt reads them on every email check.</span>' : ''}` : '';
  const here = x => x.country === st.profile.sources.adzuna_country || on.includes(x.id);
  const group = kind => (st.sites?.catalog || []).filter(x => x.kind === kind && here(x)).map(x => `<label class="check"><input type="checkbox" name="site" value="${esc(x.id)}" ${on.includes(x.id) ? 'checked' : ''}>
      <span><b>${esc(x.name)}</b> ${on.includes(x.id) ? pill(x.id) : ''}<br><span class="muted small">${esc(x.about)}</span>${on.includes(x.id) ? line(x.id) : ''}</span></label>`).join('');
  const own = mine.map((c, i) => { const id = (st.sites?.status || []).find(x => x.template === c.url.replace('{title}', '{q}').replace('{place}', '{l}'))?.id;
    return `<div class="row site-own" data-i="${i}"><input type="text" name="own_name" value="${esc(c.name)}" placeholder="Name" style="max-width:180px"><input type="text" name="own_url" value="${esc(c.url)}" placeholder="Search address" style="flex:1">${id ? pill(id) : ''}<button class="btn ghost sm" type="button" data-act="siteDrop" data-i="${i}">Remove</button></div>`; }).join('');
  return `<p class="small muted" style="margin-top:8px">Job Hunt reads their own search pages for your titles, as a browser would. Agencies usually don't name their client, so the company shows as the agency.</p>
    <form data-form="sites" class="form">
      <div style="grid-column:1/-1">${group('Agency') ? `<h3 class="sub">Agencies</h3>${group('Agency')}` : ''}
        ${group('Job site') ? `<h3 class="sub" style="margin-top:10px">Job sites</h3>${group('Job site')}` : ''}</div>
      <div style="grid-column:1/-1"><h3 class="sub" style="margin-top:10px">Your own</h3>
        <p class="muted small">Any other site: search on it in your browser, then copy the address. Put {title} where your search words are and {place} where the place is, like <code>https://example.ca/jobs?q={title}&amp;where={place}</code>. A page that lists all its jobs works too.</p>
        <div id="ownSites" style="display:flex;flex-direction:column;gap:6px">${own}</div>
        <button class="btn ghost sm" type="button" data-act="siteAdd" style="margin-top:6px">Add a site</button></div>
      <div class="row"><button class="btn primary" type="submit">Save</button></div>
    </form>`;
}

/** Sources that can be searched on their own (see /api/sources/search), in the Search page's order. */
const SEARCHABLE = ['linkedin', 'boards', 'jobbank', 'freehire', 'jsearch', 'indeed', 'jooble', 'adzuna', 'agencies'];
const SRC_OUTCOME = {
  match: ['good', 'Fits'], low: ['', 'Below your fit score'], new: ['', 'Added'], waiting: ['warn', 'Scored with the next search'],
  known: ['', 'Already in Job Hunt'], filtered: ['', 'Skipped'],
};
const SRC_FILTERS = [['all', 'All'], ['match', 'Fits'], ['new', 'New'], ['known', 'Already had'], ['filtered', 'Skipped']];
const SRC_NEW = ['match', 'new', 'low', 'waiting'];
/** The Search page's filters, per source tab: {outcome, site}. */
const srcFilter = {};
let srcPoll;
/** Start a search of one source, then show its tab. */
async function searchSource(id) {
  await api('/api/sources/search', { method: 'POST', body: { id } });
  const tab = id.startsWith('site:') ? 'agencies' : id;
  if (location.hash === `#search/${tab}`) route(); else location.hash = `#search/${tab}`;
}
/** A source's latest results in a line: "42 found · 5 new · 2 fit you · 3 hours ago". */
function srcLastLine(r) {
  if (!r) return '<span class="muted">Not searched yet</span>';
  if (r.running) return `<span class="spin" data-kind="search"></span>Searching${r.searching && r.searching !== r.name ? ` ${esc(r.searching)}` : ''}…`;
  const c = r.counts || {};
  const bits = [`${c.found ?? (r.postings || []).length} found`];
  if (c.new) bits.push(`${c.new} new`);
  if (c.fits) bits.push(`<b>${c.fits} fit${c.fits === 1 ? 's' : ''} you</b>`);
  return `${bits.join(' · ')}${r.finished ? ` <span class="muted">· ${esc(ago(r.finished))}</span>` : ''}${r.error ? `<br><span class="crit-text">${esc(r.error)}</span>` : ''}`;
}
async function showSearch(arg) {
  clearTimeout(srcPoll);
  const d = await api('/api/sources/search');
  if (!location.hash.startsWith('#search')) return;
  const results = d.results || {};
  const own = Object.values(results).find(r => r.running);
  const full = d.running && !own;
  const rows = Object.fromEntries((d.sources || []).map(r => [r.id, r]));
  // The ones searched first, then those off or not set up.
  const isOff = id => ['off', 'setup', 'na'].includes(rows[id].status);
  const order = [...SEARCHABLE, 'alerts'].filter(id => rows[id]).sort((a, b) => isOff(a) - isOff(b));
  // Sources: where it looks, with each place's set-up. Last search: what it found, and each
  // place's own results (#search/<id>). Older links: #search/setup is Sources.
  const searched = SEARCHABLE.filter(id => results[id] && (results[id].postings || results[id].running || results[id].error));
  const view = arg === 'what' ? 'what' : arg === 'last' ? 'last' : arg && results[arg] && searched.includes(arg) ? arg : 'sources';
  const next = d.next_search ? new Date(d.next_search) : null;
  const status = `<p class="muted small search-when" id="srcStatus">${d.last_search ? `Last full search ${esc(ago(d.last_search))}` : 'No full search yet'}${d.paused ? ` · ${esc(pausedWords(d.paused))}` : next ? ` · next ${esc(next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${d.held ? ` · ${d.held} posting${d.held === 1 ? '' : 's'} waiting to be scored <button class="btn sm" data-act="scoreHeld">Score them all now</button>` : ''}</p>`;
  const actions = `${scheduleMenu(d.paused)}${d.running ? `<button class="btn ghost danger" data-act="searchStop">Stop</button>`
    : `<button class="btn primary" data-act="run" data-task="search">${svg('search')}Search everything now</button>`}`;
  const ownCard = own ? `<section class="card progress-card"><header><h2>Searching ${esc(own.searching || own.name)}</h2><b class="pct">${d.progress?.percent ?? 0}%</b></header>
      <div class="pbar${d.progress?.paused ? ' paused' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${d.progress?.percent ?? 0}"><i style="width:${d.progress?.percent ?? 0}%"></i></div>
      <p class="muted small">${esc(d.progress?.stage || 'Starting')}${d.progress?.detail ? ` · ${esc(d.progress.detail)}` : ''}</p>
      <div class="facts small"><span><b>${d.progress?.found ?? 0}</b> found</span><span><b>${d.progress?.new ?? 0}</b> new</span><span><b>${d.progress?.scored ?? 0}</b> scored</span></div></section>` : '';
  // What you're looking for is part of Me; where Job Hunt looks, and what each place found, is part of Settings.
  if (view === 'what') return settingsCards('search', '', meHead('what', 'What you\'re looking for: the titles, the places, and how picky to be. Job Hunt searches for these every day.', (settingsCache?.cvs || []).length));
  const top = `${status}<div id="srcProgress">${full ? progressHtml(d.progress) : ownCard}</div>`;
  let body;
  if (view === 'sources') {
    const busy = d.running;
    if (!overview) await refreshOverview();
    const st = settingsCache || (settingsCache = await api('/api/settings').catch(() => null));
    const titles = [...new Set((st?.cvs || []).flatMap(c => c.titles || []))];
    const places = st?.profile?.locations || [];
    const few = (l, n) => l.slice(0, n).map(x => `<b>${esc(x)}</b>`).join(', ') + (l.length > n ? ` and ${l.length - n} more` : '');
    const looking = st ? `<section class="card looking"><div class="auto-line">${svg('search')}<span class="grow">${titles.length ? `Looking for ${few(titles, 4)}` : '<b>No job titles yet.</b> Add a CV, or add titles yourself.'}
        ${places.length ? ` in ${few(places.map(p => String(p).split(',')[0]), 4)}` : ' anywhere in the country'}${st.profile.remote_ok ? ', and remote roles' : ''}${st.profile.min_salary ? `, paying ${money(st.profile.min_salary)} or more` : ''}.</span>
        <a class="btn sm" href="#search/what">Change</a></div></section>` : '';
    const P = st ? cut(await settingsCards('sources', '', SET_RAW, st)) : {};
    body = `${looking}${P.list || ''}${P.clip || ''}`;
  } else if (view === 'last') {
    if (!overview) await refreshOverview();
    const line = id => { const r = results[id]; return `<div class="src-row"><div class="src-name"><b>${esc(r.name || rows[id]?.name || id)}</b></div><div class="src-last small">${srcLastLine(r)}</div><div class="src-acts row"><a class="btn sm" href="#search/${esc(id)}">See what it found</a></div></div>`; };
    body = `${d.running ? '' : reportHtml(overview?.last_report)}
      <section class="card src-table"><header><h2>What each place found</h2></header>${searched.map(line).join('') || '<p class="muted">Nothing searched yet. Press Search everything now.</p>'}</section>`;
  } else {
    const r = results[view];
    const f = srcFilter[view] || (srcFilter[view] = { outcome: 'all', site: '' });
    const list = r.postings || [];
    const siteNames = Object.fromEntries((d.sites || []).map(x => [x.id, x.name]));
    const inSite = list.filter(p => !f.site || p.source === f.site);
    const n = k => inSite.filter(p => k === 'all' ? p.outcome !== 'filtered' : (k === 'new' ? SRC_NEW.includes(p.outcome) : p.outcome === k)).length;
    // All: what Job Hunt kept. Postings it skipped (outside your locations, say) only under Skipped.
    const shown = inSite.filter(p => f.outcome === 'all' ? p.outcome !== 'filtered' : (f.outcome === 'new' ? SRC_NEW.includes(p.outcome) : p.outcome === f.outcome));
    const probs = (r.report?.source_problems || []);
    const errs = (r.report?.errors || []).filter(e => !e.startsWith('Stopped'));
    const sitesHere = view === 'agencies' ? [...new Set(list.map(p => p.source))] : [];
    const row = p => {
      const [cls, label] = SRC_OUTCOME[p.outcome] || ['', p.outcome];
      const fit = p.score != null ? `<span class="pill ${p.outcome === 'match' ? 'good' : ''}">${p.score}</span>` : '';
      const what = p.outcome === 'filtered' ? `Skipped: ${p.detail}` : p.outcome === 'known' && p.status ? `Already in Job Hunt · ${STAGES[p.status] || p.status}` : p.outcome === 'match' && p.status ? `${label} · ${STAGES[p.status] || p.status}` : label;
      const title = p.job ? `<a href="#job/${encodeURIComponent(p.job)}">${esc(p.title)}</a>` : p.url ? `<a href="#" data-act="link" data-url="${esc(p.url)}">${esc(p.title)}</a>` : esc(p.title);
      return `<tr class="src-${esc(p.outcome)}"><td>${title}${p.job && p.status ? closedTag({ status: p.status, closed_at: p.closed_at, deadline: p.deadline }).replace(/^/, ' ') : ''}<br><span class="muted small">${esc(p.company)}${p.location ? ` · ${esc(p.location)}` : ''}${p.remote ? ' · Remote' : ''}${view === 'agencies' && siteNames[p.source] && siteNames[p.source] !== p.company ? ` · via ${esc(siteNames[p.source])}` : ''}</span></td>
        <td class="num">${fit}</td><td class="small ${cls === 'warn' ? '' : 'muted'}">${esc(what)}</td>
        <td class="num">${p.url ? `<button class="btn ghost sm icon-only" data-act="link" data-url="${esc(p.url)}" title="Open the posting">${svg('open')}</button>` : ''}</td></tr>`;
    };
    const searchBtn = rows[view] && !['off', 'setup', 'na'].includes(rows[view].status) ? `<button class="btn" data-act="srcSearch" data-id="${esc(view)}" ${d.running ? 'disabled' : ''}>${svg('search')}Search again</button>` : '';
    body = `<p class="small"><a href="#search/last">← Last search</a></p><section class="card"><header><h2>${esc(r.name)}</h2><div class="row">${searchBtn}${n('match') ? '<a class="btn primary" href="#applications/pick">Pick the ones to tailor</a>' : ''}</div></header>
      <p class="small">${r.running ? 'Searching now; the list below is from before.' : r.via === 'search' ? `From the full search ${esc(ago(r.finished))}.` : r.finished ? `Searched on its own ${esc(ago(r.finished))}.` : ''}
        ${list.length ? ` <b>${list.length}</b> posting${list.length === 1 ? '' : 's'}, <b>${n('new')}</b> new, <b>${n('match')}</b> fit${n('match') === 1 ? 's' : ''} you.` : r.finished ? ' Nothing found.' : ''}</p>
      ${r.error ? `<p class="small crit-text">${esc(r.error)}</p>` : ''}
      ${probs.length ? `<details class="small"><summary class="crit-text">${probs.length} search${probs.length === 1 ? '' : 'es'} couldn't be read</summary><p class="muted">${probs.slice(0, 12).map(esc).join('<br>')}</p></details>` : ''}
      ${errs.length ? `<p class="small muted">${errs.slice(0, 3).map(esc).join('<br>')}</p>` : ''}
      ${sitesHere.length > 1 ? `<div class="chips src-chips"><button class="chip ${f.site ? '' : 'on'}" data-act="srcFilter" data-site="">All sites</button>${sitesHere.map(s => `<button class="chip ${f.site === s ? 'on' : ''}" data-act="srcFilter" data-site="${esc(s)}">${esc(siteNames[s] || s)} <span class="muted">${list.filter(p => p.source === s).length}</span></button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="chips src-chips">${SRC_FILTERS.filter(([k]) => k === 'all' || n(k)).map(([k, name]) => `<button class="chip ${f.outcome === k ? 'on' : ''}" data-act="srcFilter" data-outcome="${k}">${name} <span class="muted">${n(k)}</span></button>`).join('')}</div>` : ''}
      ${shown.length ? `<div class="src-list"><table><thead><tr><th>Posting</th><th class="num">Fit</th><th>What happened</th><th></th></tr></thead><tbody>${shown.map(row).join('')}</tbody></table></div>` : list.length ? '<p class="empty">None of these.</p>' : ''}
    </section>`;
  }
  page(settingsShell('jobs', view === 'sources' ? 'sources' : 'last', top + body, { actions }));
  if (view === 'sources') { showSourceTest(); renderConnStatus(); fillSourceRows(d); }
  settingsShown();
  // While a search runs: the status and what each place found are kept current. The page itself is
  // drawn again only when nothing on it is being typed in or is open (a key being pasted, say).
  if (d.running) srcPoll = setTimeout(async () => {
    if (!location.hash.startsWith('#search')) return;
    const busyHere = view === 'sources' && (document.activeElement?.closest?.('.set-main form, .set-main details') || document.querySelector('.set-main .tile details[open]'));
    if (!busyHere) return route();
    try { const now = await api('/api/sources/search'); fillSourceRows(now); const pr = $('#srcProgress'); if (pr && now.running) pr.innerHTML = progressHtml(now.progress); if (!now.running) return route(); } catch (e) { /* next time */ }
    srcPoll = setTimeout(() => { if (location.hash.startsWith('#search')) route(); }, 4000);
  }, 1500);
}

/** On the list of sources: what each place last found, and its Search button. (Its state and its
 *  Turn on / Test buttons come from renderConnStatus.) */
function fillSourceRows(d) {
  const results = d.results || {}, busy = d.running;
  const rows = Object.fromEntries((d.sources || []).map(r => [r.id, r]));
  let on = 0, all = 0;
  document.querySelectorAll('.tile.src[data-tile]').forEach(t => {
    const id = t.dataset.tile, r = rows[id], res = results[id];
    if (!r) return;
    all++;
    const off = ['off', 'setup', 'na'].includes(r.status);
    if (!off) on++;
    const last = t.querySelector('.src-last'), acts = t.querySelector('.src-acts');
    if (last) last.innerHTML = id === 'alerts' ? (off ? '' : 'Read on every email check') : off ? '' : res?.postings || res?.running || res?.error ? `<a href="#search/${esc(id)}" class="plain">${srcLastLine(res)}</a>` : srcLastLine(res);
    if (acts) acts.innerHTML = SEARCHABLE.includes(id) && !off ? `<button class="btn sm" data-act="srcSearch" data-id="${esc(id)}" ${busy ? 'disabled' : ''} title="Search ${esc(r.name)} only, for all your job titles">${svg('search')}Search</button>` : '';
    // The recruiters and job sites chosen, each with how its last search went.
    if (id === 'agencies' && (d.sites || []).length && !t.querySelector('.src-sites')) {
      const siteRows = d.sites.map(x => { const [cls, label] = SITE_STATE[x.state] || ['', x.state];
        return `<div class="src-site"><span class="grow"><b>${esc(x.name)}</b> <span class="pill ${cls}">${label}</span><br><span class="small muted">${esc(x.detail)}${x.at ? ` · ${esc(ago(x.at))}` : ''}</span></span>
          ${off ? '' : `<button class="btn ghost sm" data-act="srcSearch" data-id="site:${esc(x.id)}" ${busy ? 'disabled' : ''}>Search</button>`}</div>`; }).join('');
      t.insertAdjacentHTML('beforeend', `<details class="src-sites"><summary class="small">${d.sites.length} recruiter${d.sites.length === 1 ? '' : 's'} and job site${d.sites.length === 1 ? '' : 's'} chosen</summary>${siteRows}</details>`);
    }
  });
  const n = $('#srcCount'); if (n && all) n.textContent = `${on} on · ${all - on} off`;
}

const CONN_ACT = {
  test: () => ['Test', 'connTest'], checkClaude: () => ['Check again', 'checkClaude'], google: () => ['Connect', 'google'],
  on: () => ['Turn on', 'connIndeed', 'data-on="1"'], off: () => ['Turn off', 'connIndeed', 'data-on="0"'],
  removeBroken: r => ['Remove broken boards', 'removeBroken', `data-boards="${esc(JSON.stringify(r.data || []))}"`],
  sitesOff: r => [`Turn off the ${(r.data || []).length === 1 ? 'one' : (r.data || []).length} not working`, 'sitesOff', `data-ids="${esc(JSON.stringify(r.data || []))}"`],
  phoneTest: () => ['Send a test', 'phoneTest'], syncNow: () => ['Sync now', 'syncNow'], backupNow: () => ['Back up now', 'backupNow'],
};
let connPoll;
const USAGE_KIND = { score: 'Scoring postings', tailor: 'Tailoring CVs and letters', email: 'Reading job email', indeed: 'Searching Indeed', titles: 'Checking near-miss titles', alerts: 'Job-alert emails', employers: 'Finding employers', prep: 'Interview prep', revise: 'Your changes to documents', answers: 'Application questions', offer: 'Offers', outreach: 'Messages to contacts', insights: "What's working", thanks: 'Thank-you notes', career: 'Career paths', coach: 'Career coach', postings: 'Reading postings', followup: 'Follow-ups', ratings: 'Company ratings', 'apply-link': "Finding companies' own postings", reasons: 'Shortening fit reasons', chat: 'Ask Claude (job chat)', cv: 'Reading your CVs', fill: 'Filling in forms', recruiters: 'Finding your recruiters', salaries: 'Finding salaries' };
async function renderUsage() {
  const box = $('#usageCard'); if (!box) return;
  let u;
  try { u = await api('/api/usage'); } catch (e) { return; }
  const tok = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
  const tz = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const w = u.week.total, max = Math.max(1, ...u.per_day.map(d => d.calls));
  const held = (u.deferred || []).map(d => d.kind === 'rescore' ? 'Scoring postings again' : `Tailoring ${d.ids.length} roles`);
  const open = box.querySelector('details')?.open || !!u.limited_until;
  box.innerHTML = `<details ${open ? 'open' : ''}><summary><b>Claude usage</b> <span class="muted small">how much Job Hunt uses, and saving it for the night</span>${u.limited_until ? ` <span class="pill crit">Limit reached until ${esc(tz(u.limited_until))}</span>` : ''}</summary>
    <p class="muted small">Every request Job Hunt makes to Claude, by what it was for.${u.engine === 'code' ? ' Claude plans limit use over 5-hour windows and each week; the cost is what the same use would cost through the API, as Claude Code reports it.' : ''}</p>
    <section class="kpis" style="margin:10px 0">
      <div class="kpi"><span class="kpi-l">Last 5 hours</span><span class="kpi-v">${u.last_5h}</span><span class="kpi-s">requests</span></div>
      <div class="kpi"><span class="kpi-l">Today</span><span class="kpi-v">${u.today.total.calls}</span><span class="kpi-s">${tok(u.today.total.input + u.today.total.output)} tokens</span></div>
      <div class="kpi"><span class="kpi-l">Last 7 days</span><span class="kpi-v">${w.calls}</span><span class="kpi-s">${tok(w.input + w.output)} tokens${w.cost ? ` · ≈ $${w.cost.toFixed(2)}` : ''}</span></div>
    </section>
    <div class="cols" style="height:60px">${u.per_day.map(d => `<div class="col" data-tip="${esc(fmtDate(d.day + 'T12:00'))}: ${d.calls} requests"><span class="c" style="height:${d.calls / max * 100}%"></span></div>`).join('')}</div>
    ${u.week.kinds.length ? `<table style="margin-top:10px"><thead><tr><th>Last 7 days</th><th class="num">Requests</th><th class="num">Tokens</th><th class="num">Time</th>${w.cost ? '<th class="num">≈ Cost</th>' : ''}</tr></thead><tbody>
      ${u.week.kinds.map(k => `<tr><td>${esc(USAGE_KIND[k.kind] || k.kind)}${k.usage.errors ? ` <span class="muted small">${k.usage.errors} failed</span>` : ''}</td><td class="num">${k.usage.calls}</td><td class="num">${tok(k.usage.input + k.usage.output)}</td><td class="num">${Math.round(k.usage.secs / 60)} min</td>${w.cost ? `<td class="num">$${k.usage.cost.toFixed(2)}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing yet this week.</p>'}
    <h3 class="sub">Budget mode</h3>
    <label class="check"><input type="checkbox" data-act="budgetOn" ${u.budget.on ? 'checked' : ''}> <span>Hold big batches for the night: scoring postings again, and tailoring more than 3 roles at once. Your daily search and single roles still run right away.</span></label>
    <label class="field" style="max-width:240px">Start held batches at<select data-act="budgetHour">${[19, 20, 21, 22, 23, 0, 1, 2].map(h => `<option value="${h}" ${u.budget.hour === h ? 'selected' : ''}>${new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}</option>`).join('')}</select></label>
    <p class="muted small">When your usage limit is reached, the same batches wait and start by themselves once it resets.</p>
    ${held.length ? `<div class="row" style="margin-top:6px"><span><b>Waiting:</b> ${held.map(esc).join(', ')}</span><button class="btn sm primary" data-act="runHeld">Run now</button><button class="btn sm ghost" data-act="clearHeld">Cancel</button></div>` : ''}</details>`;
}

/** Where each place lives now that job sources have their own tab. */
const CONN_HOME = { listingsCard: 'tile-jsearch', sitesCard: 'tile-agencies', linkedinCard: 'tile-linkedin' };
let connScrollTo = null;
/** One button for a connection: Turn on, Test, Connect… */
function connBtn(r, a, testing) {
  if (a.startsWith('goto:')) {
    const to = a.slice(5);
    if (to.endsWith('Card')) return `<button class="btn ghost sm" data-act="connGoto" data-to="${esc(CONN_HOME[to] || to)}">Open</button>`;
    return `<a class="btn ghost sm" href="${{ calendar: '#settings/notifications', sources: '#search/setup', search: '#search/what' }[to] || `#settings/${esc(to)}`}">Open</a>`;
  }
  if (a.startsWith('link:')) return `<button class="btn sm" data-act="link" data-url="${esc(a.slice(5))}">Open Claude connectors</button>`;
  const [label, act, extra] = (CONN_ACT[a] || (() => [a, a]))(r);
  const cls = a === 'on' ? 'primary' : a === 'off' ? 'ghost' : r.status === 'problem' || a === 'test' ? '' : 'ghost';
  return `<button class="btn ${cls} sm" data-act="${act}" data-id="${esc(r.id)}" ${extra || ''} ${testing && act === 'connTest' ? 'disabled' : ''}>${label}</button>`;
}

/** Fill in each source's tile, and on Accounts, what needs attention (nothing shows when all is well). */
/** A running test's progress: a bar and "3 of 12 checked". */
const testBar = p => {
  const total = Math.max(1, p?.total || 0), done = Math.min(p?.done || 0, total);
  return `<span class="test-bar" title="Testing"><span class="meter"><i style="width:${Math.max(4, done / total * 100)}%"></i></span><span class="small muted">${done} of ${total} checked</span></span>`;
};
let connWasTesting = false;
/** A problem whose fix is a button: the button goes beside it, so there's nowhere else to go.
 *  Claude Code signed out: Sign in to Claude, here. Returns [what to say, the button]. */
function connFix(r) {
  const signedOut = /Claude Code isn't signed in/.test(r.detail || '');
  if (!signedOut) return [r.detail || '', ''];
  // What Claude Code itself said stays with it (it tells a signed-out Claude Code from anything else).
  const said = (/ Claude Code said: .*$/.exec(r.detail) || [''])[0];
  return [`Claude Code isn't signed in on this PC. Sign it in here: Job Hunt tests this again by itself once you have.${said}`, `<button class="btn primary sm" data-act="claudeSetup" data-install="" data-id="${esc(r.id)}">Sign in to Claude</button>`];
}
async function renderConnStatus() {
  clearTimeout(connPoll);
  let d;
  try { d = await api('/api/connections'); } catch (e) { return; }
  document.querySelectorAll('[data-tile]').forEach(t => {
    const r = d.rows.find(x => x.id === t.dataset.tile);
    if (!r) return;
    const [cls, label] = CONN_PILL[r.status] || ['', r.status];
    t.querySelector('.tile-state').innerHTML = `<span class="pill ${cls}">${label}</span>`;
    t.classList.toggle('off', ['off', 'setup'].includes(r.status));
    t.classList.toggle('problem', ['problem', 'partial'].includes(r.status));
    const [said, fix] = connFix(r);
    t.querySelector('.tile-detail').innerHTML = ['off', 'setup'].includes(r.status) ? ''
      : `${esc(said)}${r.at ? ` <span class="muted">· ${esc(ago(r.at))}</span>` : ''}`;
    // The one being tested shows how far along it is instead of its buttons.
    t.querySelector('.tile-acts').innerHTML = d.progress && d.progress.only === r.id ? testBar(d.progress)
      : fix + (r.actions || []).filter(a => !a.startsWith('goto:') && !(fix && a.startsWith('link:'))).map(a => connBtn(r, a, d.testing)).join('');
  });
  const box = $('#connStatus');
  if (box) {
    const probs = d.rows.filter(r => ['problem', 'partial'].includes(r.status));
    box.hidden = !probs.length;
    box.innerHTML = `<header><h2>Needs attention</h2></header>${probs.map(r => { const [said, fix] = connFix(r); return `<div class="conn-row problem">
      <span class="conn-name"><b>${esc(r.name)}</b></span><span class="grow small">${esc(said)}${r.at ? ` <span class="muted">· tested ${esc(ago(r.at))}</span>` : ''}</span>
      <span class="row todo-act">${fix}${(r.actions || []).filter(a => !(fix && a.startsWith('link:'))).map(a => connBtn(r, a, d.testing)).join('')}</span></div>`; }).join('')}`;
  }
  // Done testing: the sources page shows each site's result.
  if (connWasTesting && !d.testing && location.hash.startsWith('#search/setup')) { connWasTesting = false; settingsCache = null; route(); return; }
  connWasTesting = d.testing;
  if (d.testing) connPoll = setTimeout(() => { if (location.hash.startsWith('#settings') || location.hash.startsWith('#search/setup')) renderConnStatus(); }, 1500);
}

// ---- Settings save themselves ----
let saveTimer;
function saveState(text, cls) {
  const el = $('#saveState');
  if (el) { el.textContent = text; el.className = `save-state ${cls || ''}`; }
}
async function autosave(form) {
  try {
    const body = readProfile(form, form.dataset.part);
    // The board lists as this page last saw them, so the server keeps boards changed elsewhere.
    body.seen_sources = settingsCache.profile.sources;
    const r = await api('/api/settings/profile', { method: 'POST', body });
    delete body.seen_sources;
    settingsCache.profile = r.profile || body;
    showBoardFields();
    saveState('✓ All changes saved', 'ok');
  } catch (e) { saveState(e.message, 'err'); }
}
['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const form = e.target.closest?.('form[data-form=profile]');
  if (!form || e.target.type === 'file') return;
  saveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => autosave(form), 800);
}));

// ---- Find any job (Ctrl+K) ----
/** A search over every job, company first, grouped by where it stands; Enter opens the first. */
let paletteJobs = null;
async function jobPalette() {
  if ($('.palette-back')) return;
  const back = document.createElement('div');
  back.className = 'modal-back palette-back';
  back.innerHTML = `<div class="modal palette" role="dialog" aria-modal="true" aria-label="Find a job">
    <input type="search" class="palette-q" placeholder="Find a job by company, title or place…" aria-label="Find a job">
    <div class="palette-list"><p class="muted small">Loading…</p></div>
    <p class="muted small palette-hint">↑ ↓ to choose · Enter to open · Esc to close</p></div>`;
  document.body.appendChild(back);
  const q = back.querySelector('.palette-q'), list = back.querySelector('.palette-list');
  let sel = 0, shown = [];
  const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
  const ORDER = ['ready', 'approved', 'queued', 'interviewing', 'offer', 'applied', 'saved', 'no_response', 'rejected', 'skipped', 'dismissed'];
  const draw = () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = j => `${j.company} ${j.title} ${j.location || ''}`.toLowerCase();
    shown = (paletteJobs || []).filter(j => words.every(w => hay(j).includes(w)))
      .sort((a, b) => (ORDER.indexOf(a.status) - ORDER.indexOf(b.status)) || (b.score || 0) - (a.score || 0)).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let last = '';
    list.innerHTML = shown.length ? shown.map((j, i) => {
      const head = j.status !== last ? `<h3>${esc(STAGES[j.status] || j.status)}</h3>` : '';
      last = j.status;
      return `${head}<a class="palette-row ${i === sel ? 'on' : ''}" href="#job/${encodeURIComponent(j.id)}" data-i="${i}">${scoreBadge(j.score)}<span class="grow"><b>${esc(j.company)}</b> · ${esc(j.title)}${expiredWhy(j) ? ' <span class="pill crit expired">Expired</span>' : ''}<br><span class="muted small">${esc(j.location || '')}</span></span></a>`;
    }).join('') : `<p class="muted small">${paletteJobs ? 'No job matches.' : 'Loading…'}</p>`;
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const key = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); close(); location.hash = `#job/${encodeURIComponent(shown[sel].id)}`; }
  };
  document.addEventListener('keydown', key, true);
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('.palette-row')) close(); });
  q.addEventListener('input', () => { sel = 0; draw(); });
  q.focus();
  try { paletteJobs = (await api('/api/jobs')).jobs; } catch (e) { paletteJobs = []; }
  draw();
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); jobPalette(); }
});
/** Every key, in Job Hunt's own dialog. */
function keysHelp() {
  const rows = [['Ctrl + K', 'Find any job'], ['c', 'Ask Claude about what is on screen'], ['/', 'Search the list on this page'], ['j / k', 'Next or previous job'], ['Enter X L →', 'In the Queue: do it, not interested, later, skip'], ['↑ ↓ Space X T', 'In the Pick list: move, tick, not interested, tailor the ticked ones'], ['a', 'Approve (on a job ready to approve)'],
    ['o', 'Open the posting'], ['t', 'Tailor my CV for this role'], ['Esc', 'Back to the list'], ['?', 'These keys']];
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Keys"><h2>Keys</h2>
    <table class="keys"><thead><tr><th>Key</th><th>What it does</th></tr></thead><tbody>${rows.map(([k, w]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(w)}</td></tr>`).join('')}</tbody></table>
    <p class="muted small">In Review: a approve · s save for later · x not interested · n next.</p>
    <div class="modal-btns"><button class="btn primary">Close</button></div></div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?') { e.preventDefault(); close(); } };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('button')) close(); });
  document.addEventListener('keydown', key, true);
  document.body.appendChild(back);
}

// ---- Keyboard ----
// Ctrl+K find a job · / search the list · a approve · j / k next and previous job · o open the
// posting · t tailor · c ask Claude · Esc back · ? the keys
let jobOrder = [];
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ($('.modal-back')) return;
  if (e.key === 'Escape' && panelJob) { closePanel(); return; }
  const t = e.target;
  if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  // Queue: decide without the mouse.
  const deck = document.querySelector('.decision[data-kind]');
  if (deck && ['Enter', 'x', 'l', 'ArrowRight', 's'].includes(e.key) && !(t && ['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && e.key === 'Enter')) {
    const b = e.key === 'Enter' ? deck.querySelector('[data-primary]') : e.key === 'x' ? deck.querySelector('[data-status=dismissed]') : e.key === 'l' ? deck.querySelector('[data-status=saved]') : deck.querySelector('[data-act=queueSkip]');
    if (b) { e.preventDefault(); b.click(); return; }
  }
  // Pick: walk the list and tick without the mouse.
  const pickRows = [...document.querySelectorAll('.pick-list .jrow.pick')].filter(r => !r.hidden);
  if (pickRows.length && ['ArrowDown', 'ArrowUp', 'j', 'k', ' ', 'Enter', 'x', 't'].includes(e.key) && !(t && ['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && [' ', 'Enter'].includes(e.key))) {
    const at = pickRows.findIndex(r => r.classList.contains('kb'));
    const cur = pickRows[at];
    if (['ArrowDown', 'ArrowUp', 'j', 'k'].includes(e.key)) {
      const to = pickRows[Math.max(0, Math.min(pickRows.length - 1, at < 0 ? 0 : at + (e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)))];
      cur?.classList.remove('kb'); to.classList.add('kb'); to.scrollIntoView({ block: 'nearest' });
      e.preventDefault(); return;
    }
    if (e.key === 't') { const b = document.querySelector('[data-pickbox] .select-bar:not([hidden]) [data-act=tailorPicked]'); if (b) { e.preventDefault(); b.click(); } else toast('Tick a role first (Space).'); return; }
    if (cur) {
      e.preventDefault();
      if (e.key === ' ') cur.querySelector('[data-pick]').click();
      else if (e.key === 'Enter') cur.querySelector('a.qt').click();
      else if (e.key === 'x') { const n = pickRows[at + 1] || pickRows[at - 1]; n?.classList.add('kb'); cur.querySelector('[data-status=dismissed]').click(); }
      return;
    }
  }
  const onJob = location.hash.startsWith('#job/');
  const id = onJob ? decodeURIComponent(location.hash.slice(5)) : null;
  if (e.key === '/') {
    const f = $('#filter') || $('#docFilter');
    if (f) { e.preventDefault(); f.focus(); }
  } else if (e.key === '?') {
    e.preventDefault(); keysHelp();
  } else if (e.key === 'o' && onJob) {
    const b = document.querySelector('.actions [data-act=open][data-what=company], .actions [data-act=open][data-what=posting]');
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 't' && onJob) {
    const b = document.querySelector('.actions [data-act=tailorPicked]');
    if (b) { e.preventDefault(); b.click(); }
  } else if (e.key === 'c') {
    e.preventDefault(); askOpen();
  } else if (e.key === 'Escape' && onJob) {
    history.length > 1 ? history.back() : (location.hash = '#applications');
  } else if (e.key === 'a' && onJob) {
    const b = document.querySelector('.actions [data-act=approve]');
    if (b) { e.preventDefault(); b.click(); }
  } else if ((e.key === 'j' || e.key === 'k') && onJob && jobOrder.length) {
    const i = jobOrder.indexOf(id);
    const next = jobOrder[i + (e.key === 'j' ? 1 : -1)];
    if (next) location.hash = `#job/${encodeURIComponent(next)}`;
    else toast(e.key === 'j' ? 'That was the last one in the list.' : 'That was the first one in the list.');
  }
});

/** When the postings you've found went up, and the search times that follow from it. */
function postingHoursHtml(ph, p) {
  const label = h => h === 0 ? 'midnight' : h === 12 ? 'noon' : `${h % 12} ${h < 12 ? 'AM' : 'PM'}`;
  if (!ph || !ph.suggest) return `<div class="field" id="postHours">When postings go up<span class="hint">Employers post most around 11 AM, dip over lunch and post again from mid to late afternoon (studies of posting times), so Job Hunt searches at noon and 5 PM unless you choose otherwise. Once it has found ${ph?.counted ? `more postings that say when they went up (${ph.counted} so far)` : '40 postings that say when they went up'}, it suggests times from your own.</span></div>`;
  const [a, b] = ph.suggest, max = Math.max(1, ...ph.by_hour);
  const same = p.search_hour === a && (p.searches_per_day < 2 || p.search_hour_2 === b);
  return `<div class="field" id="postHours">When your postings go up
    <div class="hourbars" title="Postings by the hour they went up, your time">${ph.by_hour.map((n, h) => `<span class="${h + 1 === a || h + 1 === b ? 'peak' : ''}" style="height:${Math.max(4, n / max * 100)}%" title="${label(h)}: ${n}"></span>`).join('')}</div>
    <div class="hourticks"><span>midnight</span><span>6 AM</span><span>noon</span><span>6 PM</span><span></span></div>
    <span class="hint">Of the ${ph.counted} postings that say when they went up, most did just before ${label(a)} and ${label(b)} (your time).${same ? ' Your searches already run then.' : ''}</span>
    ${same ? '' : `<div class="row"><button class="btn sm" type="button" data-act="useHours" data-a="${a}" data-b="${b}">Search at ${label(a)}${p.searches_per_day >= 2 ? ` and ${label(b)}` : ''}</button><span class="muted small">Sets the times above.</span></div>`}</div>`;
}
