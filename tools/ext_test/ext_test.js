// The browser extension, loaded for real into Chromium, filling a stand-in Workday page
// (tools/ext_test/workday.html) with answers from a stand-in for Job Hunt on 127.0.0.1:47613.
//
//   node tools/ext_test/ext_test.js            every variant of the page
//   node tools/ext_test/ext_test.js std slow   only the variants named
//
// It checks what the extension is there for and has got wrong before: every skill your CV has is
// chosen from the site's list (the right one, once, never unticked again), a skill the site doesn't
// have is reported and not replaced by something else, and Field of Study is chosen. Exit code 1
// with what failed; 2 (skipped) where Playwright or the port isn't available.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log("skipped: Node with Playwright isn't installed here"); process.exit(2); }

const ROOT = path.resolve(__dirname, '..', '..');
const VERSION = '9.9.9';
const SKILLS = 'Python; Project Management; SQL; Underwater Basket Weaving; Vendor Management; Payments Integration';
// What the site's list has for each: "Payments Integration" isn't there, "Payments" is (a shorter search finds it).
const WANT = ['Python', 'Project Management', 'SQL', 'Vendor Management'];
const VARIANTS = {
  std: '',                       // real clicks, the usual markup
  odd: 'pills=odd',              // chosen items drawn in a way the filler doesn't recognise
  typing: 'typing=trusted',      // only real typing and Enter search
  keys: 'click=keys',            // the mouse does nothing in the list: real keys only
  slow: 'slow=4000',             // a search takes four seconds
  zoom: '',                      // the browser zoomed to 80%
  issuer: 'certs=issuer',        // certificates listed as "Issuer - Name" without short forms: PMP is still found
  heal: '',                      // Job Hunt forgets the form once (a restart) and drops three requests: the extension recovers by itself
};

function buildExtension(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.join(ROOT, 'static', 'extension');
  for (const f of fs.readdirSync(ext)) fs.copyFileSync(path.join(ext, f), path.join(dir, f));
  fs.copyFileSync(path.join(ROOT, 'static', 'clip.js'), path.join(dir, 'clip.js'));
  // As Job Hunt writes it (core/src/fill.rs extension_script, bridge.rs write_extension).
  const fill = fs.readFileSync(path.join(ROOT, 'core', 'src', 'fill.js'), 'utf8').replace("'__TOKEN__'", "''").replace('__JOB__', "(window.__jobhuntExt || { title: '', company: '' })");
  fs.writeFileSync(path.join(dir, 'fill.js'), fill);
  const bg = path.join(dir, 'background.js');
  fs.writeFileSync(bg, fs.readFileSync(bg, 'utf8').replace('__JH_VERSION__', VERSION));
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  m.version = VERSION;
  m.host_permissions.push('<all_urls>'); // the test starts the fill itself; you'd click the extension (activeTab)
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
}

// Job Hunt's answers for the mock form's boxes.
// The CV here has a school and a certificate the site's lists don't have, three languages (two
// fluent, one not) and a second certificate, as the form that showed these bugs did.
const LANGS = ['English', 'Arabic', 'French'];
// The variants run side by side, each in its own browser: what belongs to one is kept under its name.
const fieldsOf = {};
const briefs = [], reports = [];
function answers(fields, name) {
  const values = {}, files = {};
  fieldsOf[name] = fields || [];
  for (const f of fields || []) {
    const nth = Number((/(\d+)\s*$/.exec(f.section || '') || [])[1] || 1), sec = f.section || '';
    if (f.type === 'add') { if (/certif/i.test(sec)) values[f.key] = String(Math.max(0, 2 - (f.entries || 0))); else if (/language/i.test(sec)) values[f.key] = String(Math.max(0, 3 - (f.entries || 0))); }
    else if (f.type === 'file') { if (/cover|letter/i.test(`${f.label} ${sec}`)) files[f.key] = { name: 'Sam Lee - Cover letter.pdf', mime: 'application/pdf', b64: Buffer.from('%PDF-1.4 letter').toString('base64') }; else if (/resume|cv/i.test(`${f.label} ${sec}`)) files[f.key] = { name: 'Sam Lee - CV.pdf', mime: 'application/pdf', b64: Buffer.from('%PDF-1.4 test').toString('base64') }; }
    else if (f.type === 'skills') values[f.key] = SKILLS;
    else if (f.type === 'prompt') values[f.key] = /school|university/i.test(f.label) ? 'American University of Kuwait' : /certif/i.test(f.label) ? (nth === 1 ? 'PMP' : 'PMI-CPMAI') : 'Computer Science';
    else if (/^language$/i.test(f.label)) values[f.key] = LANGS[nth - 1] || '';
    else if (/comprehension/i.test(f.label)) values[f.key] = nth === 3 ? 'Beginner' : 'Fluent';
    else if (/fluent/i.test(f.label)) values[f.key] = nth === 3 ? 'no' : 'yes';
    else if (f.type === 'date' && /^from/i.test(f.label)) { if (/education/i.test(sec)) values[f.key] = '2005'; else if (/work experience/i.test(sec)) values[f.key] = '03/2019'; }
    else if (/province/i.test(f.label)) values[f.key] = 'Ontario';
    else if (/email/i.test(f.label)) values[f.key] = 'sam@example.com';
    else if (/phone/i.test(f.label)) values[f.key] = '416-555-0100';
    else if (/job title/i.test(f.label)) values[f.key] = 'Program Manager';
    else if (/company/i.test(f.label)) values[f.key] = 'Maple Bank';
    else if (/role description/i.test(f.label)) values[f.key] = 'Led delivery.';
  }
  return { values, files, roles: 0, banked: [], job: { title: 'Senior Program Manager', company: 'Mock Co' }, app_version: VERSION };
}
const listen = (server, port) => new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', () => ok(server)); });
const json = (res, v) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(v)); };

(async () => {
  const only = process.argv.slice(2);
  const names = Object.keys(VARIANTS).filter(n => !only.length || only.includes(n));
  if (only.some(n => n !== 'app' && n !== 'profile' && n !== 'posts' && n !== 'folded' && n !== 'letter' && VARIANTS[n] === undefined)) { console.log(`No such variant. Choose from: ${Object.keys(VARIANTS).join(', ')}, app, profile, posts`); process.exit(1); }
  // Job Hunt's side: says its version, and answers a form's questions.
  let picked = '';
  let leads = null;
  const tickets = new Map(), logs = [];
  // Per variant (the page's address carries its name as v=): how often it asked, and what goes wrong for it.
  const st = {}, of = n => (st[n] ||= { starts: 0, polls: 0, fault: {} });
  const nameOf = url => { try { return new URL(url).searchParams.get('v') || 'misc'; } catch (e) { return 'misc'; } };
  let ticketNo = 0;
  let bridge;
  try {
    bridge = await listen(http.createServer((req, res) => {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.url === '/ext/ping') return json(res, { ok: true, version: VERSION });
        if (req.url === '/ext/leads') { leads = JSON.parse(body || '{}'); const hiring = leads.posts.filter(p => /hiring/i.test(p.text)).length; return json(res, { seen: leads.posts.length, hiring, added: hiring, note: '' }); }
        if (req.url === '/ext/pick') { picked = JSON.parse(body || '{}').job_id || ''; return json(res, { ok: true }); }
        if (req.url === '/ext/report') { reports.push(JSON.parse(body || '{}')); return json(res, { ok: true }); }
        if (req.url === '/ext/brief') { briefs.push(JSON.parse(body || '{}')); return json(res, { text: 'Please fill in the application form on this page for me.' }); }
        if (req.url === '/ext/log') { logs.push(JSON.parse(body || '{}')); return json(res, { kept: 1 }); }
        // The answers: in one request (/ext/fill, the phone), or for a ticket that is then asked
        // after (/ext/fill/start and /ext/fill/poll, the extension). ANSWER_DELAY=45000: Claude is slow.
        if (req.url === '/ext/fill' || req.url === '/ext/fill/start') {
          const asked = JSON.parse(body || '{}'), name = nameOf(asked.url), mine = of(name);
          let v;
          // A site's own profile: no application to match it to, so the panel is given the choice,
          // and once the profile is chosen, one job from the CV.
          if (/\/match\/profile/.test(asked.url || '')) {
            if (picked !== 'profile') { res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ error: "Job Hunt can't tell which application this is. Choose it below, or the last one if this is a profile to fill in from your CV.", choose: [{ id: 'a1', title: 'Business Project Manager', company: 'osc', status: 'approved' }, { id: 'profile', title: 'Not an application', company: 'a profile here, from my CV', status: 'profile' }] })); }
            const by = { 'job title': 'Senior Program Manager', 'employer name': 'Maple Bank', 'city': 'Toronto', 'province': 'Ontario', 'start date': '2019-03-01' };
            const values = {};
            for (const f of asked.fields || []) for (const k of Object.keys(by)) if (String(f.label || '').toLowerCase().includes(k)) values[f.key] = by[k];
            v = { values, files: {}, roles: 0, banked: [], job: { id: 'profile', title: 'Your profile', company: '127.0.0.1' }, app_version: VERSION, profile: true, note: 'That was job 1 on your CV (Senior Program Manager).' };
          } else v = answers(asked.fields, name);
          const delay = Number(process.env.ANSWER_DELAY || 0) || mine.fault.delay || 0;
          if (req.url === '/ext/fill') return setTimeout(() => json(res, v), delay);
          mine.starts++;
          const ticket = 't' + (++ticketNo);
          tickets.set(ticket, { at: Date.now(), ready: Date.now() + delay, v, name });
          return json(res, { ticket });
        }
        if (req.url === '/ext/fill/poll') {
          const { ticket } = JSON.parse(body || '{}');
          const mine = tickets.has(ticket) ? of(tickets.get(ticket).name) : null;
          if (mine) mine.polls++;
          if (mine && mine.fault.forget > 0) { mine.fault.forget--; tickets.delete(ticket); }
          else if (mine && mine.fault.drop > 0) { mine.fault.drop--; return req.socket.destroy(); }
          const f = tickets.get(ticket);
          if (!f) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Job Hunt was restarted while it was writing the answers.', gone: true })); }
          return json(res, Date.now() < f.ready ? { waiting: true, secs: Math.round((Date.now() - f.at) / 1000) } : f.v);
        }
        json(res, { ok: true });
      });
    }), 47613);
  } catch (e) { console.log('skipped: 127.0.0.1:47613 is in use (is Job Hunt running here?)'); process.exit(2); }
  const html = fs.readFileSync(path.join(__dirname, 'workday.html'));
  const profileHtml = fs.readFileSync(path.join(__dirname, 'profile.html'));
  // An application with its parts folded away, as SuccessFactors draws it (Rogers).
  const foldedHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Solution Delivery Manager - Mock Careers</title></head><body><h1>Solution Delivery Manager (343472)</h1><p><a href="#" onclick="document.getElementById(\'profile\').style.display=\'block\';return false">Expand all sections</a> <a href="#" onclick="return false">Collapse all sections</a></p><h2>My Documents</h2><p>Accepted file types: DOCX, PDF</p><h2>Profile Information</h2><div id="profile" style="display:none"><label for="email">Email</label><input id="email" type="email"><label for="phone">Phone</label><input id="phone" type="tel"><label for="city">City</label><input id="city" type="text"><label for="note">Anything else</label><input id="note" type="text"></div></body></html>';
  // The profile's list of jobs, as Job Bank's "Manage your work experience and skills": no boxes, a link to the form.
  const listHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Job Match - Mock Job Site</title></head><body><h1>Manage your work experience and skills</h1><h2>Experience and skills</h2><p>Add your latest work experience and acquired skills, then list other jobs you\u2019ve held before.</p><p><a class="btn" href="/match/profile/experience">Add a new experience</a></p><table><thead><tr><th>Job title (NOC code)</th><th>Employer Name</th><th>Employment Period</th></tr></thead><tbody><tr><td colspan="3">No experience listed. Click on "Add new experience" to fill in the table.</td></tr></tbody></table><p><button>Previous</button> <button>Continue</button></p></body></html>';
  // A review page as Indeed draws it: the CV is there already, and the cover letter sits behind
  // "Supporting documents · Add", which opens a plain upload box.
  const letterHtml = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Review your application - Mock Jobs</title></head><body><h1>Please review your application</h1>'
    + '<div><h2>Resume</h2><div>Sam Lee - CV.pdf</div></div><div><label for="email">Email</label><input id="email" type="email"><label for="phone">Phone</label><input id="phone" type="tel"><label for="city">City</label><input id="city" type="text"></div>'
    // A choice as SuccessFactors draws it: a box that says "No Selection", and a list of its own that a click opens.
    + '<div><div id="p:_selectContainer"><input aria-label="Province/Territory/State" autocomplete="off" type="text" placeholder="No Selection" aria-owns="p:_listSelect" role="combobox" aria-required="true" aria-expanded="false" id="prov" onclick="document.getElementById(\'p:_listSelect\').style.display=\'block\'" readonly><button type="button" tabindex="-1" aria-label="Province/Territory/State"><span></span></button></div>'
    + '<ul id="p:_listSelect" style="display:none">' + ['Alberta', 'British Columbia', 'Ontario', 'Quebec'].map(n => `<li><a href="javascript:void(0)" onclick="document.getElementById(\'prov\').value=\'${n}\';document.getElementById(\'p:_listSelect\').style.display=\'none\'">${n}</a></li>`).join('') + '</ul></div>'
    + '<div id="docs"><div style="display:flex;justify-content:space-between"><h2>Supporting documents</h2><a href="#" id="addDocs" onclick="document.getElementById(\'up\').style.display=\'block\';this.remove();return false">Add</a></div><div>No cover letter or additional documents added. This is optional to add.</div>'
    + '<div id="up" style="display:none"><label for="doc">Upload a file</label><input id="doc" type="file"></div></div><button type="button">Submit your application</button></body></html>';
  const postsHtml = fs.readFileSync(path.join(__dirname, 'posts.html'));
  const site = await listen(http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/nothing') ? '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Careers - Mock</title></head><body><h1>Thanks for your interest</h1><p>Nothing to fill in here.</p></body></html>' : req.url.startsWith('/folded') ? foldedHtml : req.url.startsWith('/letter') ? letterHtml : req.url.startsWith('/match/profile/list') ? listHtml : req.url.startsWith('/match/profile') ? profileHtml : req.url.startsWith('/search/results/content') ? postsHtml : html); }), 0);
  const base = `http://127.0.0.1:${site.address().port}/apply`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-ext-'));
  const extDir = path.join(tmp, 'ext');
  buildExtension(extDir);
  // A browser of its own with the extension loaded, for one variant.
  let browsers = 0;
  const open = async () => {
    const ctx = await chromium.launchPersistentContext(path.join(tmp, `profile-${++browsers}`), { headless: false, viewport: { width: 1100, height: 700 },
      args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`] });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await sw.evaluate(() => chrome.storage.local.set({ key: 'jh-test' }));
    return { ctx, sw };
  };

  const failed = [];
  // What a run must have done, whoever filled it in.
  const judge = (got, s, running) => {
    const lastFields = fieldsOf[running] || [];
    const problems = [];
    for (const w of WANT) if (!got.skills.includes(w)) problems.push(`"${w}" wasn't chosen`);
    if (!got.skills.some(x => /^Payment/.test(x))) problems.push('nothing chosen for "Payments Integration" (the list has Payments)');
    const extra = got.skills.filter(x => !WANT.includes(x) && !/^Payment/.test(x));
    if (extra.length) problems.push(`chosen though not on the CV: ${extra.join(', ')}`);
    if (got.study.join() !== 'Computer Science') problems.push(`Field of Study is ${JSON.stringify(got.study)}, not Computer Science`);
    if (!/Underwater Basket Weaving/.test(s)) problems.push('the skill the site doesn\'t have wasn\'t reported');
    if (/add these yourself\): [^.]*(Python|SQL|Project Management|Vendor Management)/.test(s)) problems.push('a skill that was chosen is reported as not taken');
    // What the OSC Workday form got wrong (2.57.0).
    const st = got.state || {}, eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!eq(st.school, ['Other'])) problems.push(`School or University is ${JSON.stringify(st.school)}, not Other (the list doesn't have the school; "American University" is a different one)`);
    const certs = running === 'issuer' ? ['Project Management Institute - Project Management Professional', 'Not Applicable - Not Applicable'] : ['Project Management Professional (PMP)', 'Other'];
    if (!eq(st.certs, certs)) problems.push(`the certifications are ${JSON.stringify(st.certs)}, not ${JSON.stringify(certs)}`);
    if (!eq(st.languages, LANGS)) problems.push(`the languages are ${JSON.stringify(st.languages)}, not ${LANGS.join(', ')}`);
    if (!eq(st.levels, ['5 - Fluent', '5 - Fluent', '1 - Beginner'])) problems.push(`the language levels are ${JSON.stringify(st.levels)}`);
    if (!eq(st.fluent, [true, true, false])) problems.push(`"I am fluent" is ${JSON.stringify(st.fluent)}`);
    if (st.eduFrom !== '2005') problems.push(`Education's From is "${st.eduFrom}", not 2005`);
    if (st.workFrom !== '03/2019' || st.company !== 'Maple Bank') problems.push(`the job's From is "${st.workFrom}" and its company "${st.company}"`);
    if (!eq(st.resume, ['Sam Lee - CV.pdf'])) problems.push(`the upload area lists ${JSON.stringify(st.resume)}, not the CV once`);
    if (!/"Other" was chosen for: [^.]*School/.test(s)) problems.push('the panel doesn\'t say Other was chosen for the school');
    const lang = lastFields.find(f => /^language$/i.test(f.label));
    if (!lang || (lang.options || []).length < 120 || !LANGS.every(l => lang.options.includes(l))) problems.push(`the language list sent to Job Hunt has ${lang ? (lang.options || []).length : 0} of 120 options${lang && !lang.options.includes('English') ? ', without English' : ''}`);
    const desc = lastFields.find(f => /role description/i.test(f.label)), from = lastFields.find(f => f.type === 'date' && /work experience/i.test(f.section || ''));
    if (!desc || desc.section !== 'Work Experience 1') problems.push(`Role Description's section is "${desc && desc.section}", not Work Experience 1`);
    if (!from || !/^From \(MM\/YYYY\)/.test(from.label)) problems.push(`the job's From date is labelled "${from && from.label}"`);
    const up = lastFields.filter(f => f.type === 'file');
    if (up.length !== 1 || up[0].section !== 'Resume/CV') problems.push(`the upload box's section is ${JSON.stringify(up.map(f => f.section))}`);
    return problems;
  };
  const runVariant = async name => {
    const { ctx, sw } = await open();
    const said = [], say = x => said.push(x); // printed together, not mixed with another variant's
    const page = await ctx.newPage();
    const url = `${base}?${VARIANTS[name]}${VARIANTS[name] ? '&' : ''}v=${name}`;
    const mine = of(name);
    mine.fault = name === 'heal' ? { forget: 1, drop: 3, delay: 3000 } : {};
    await page.goto(url);
    const t0 = Date.now();
    await sw.evaluate(async ({ url, zoom }) => {
      const [tab] = await chrome.tabs.query({ url: url.split('?')[0] + '*', active: true });
      if (zoom) await chrome.tabs.setZoom(tab.id, zoom);
      await startFill(tab.id); // what the popup's button and the keyboard shortcut do
    }, { url, zoom: name === 'zoom' ? 0.8 : 0 });
    const status = () => page.evaluate(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || '');
    let s = '';
    for (let i = 0; i < 600; i++) { await page.waitForTimeout(500); s = await status(); if (/^Filled \d+/.test(s) || /Couldn't|No form|No answers/.test(s)) break; }
    const got = await page.evaluate(() => ({ skills: window.mock.skills(), study: window.mock.study(), clicks: window.mock.clicks.length, searches: window.mock.searches, state: window.mock.state() }));
    const secs = Math.round((Date.now() - t0) / 1000);
    const details = await sw.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url: url.split('?')[0] + '*', active: true });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ ...window.__jobhunt.details(), trail: window.__jobhunt.trail() }) });
      return r.result;
    }, url).catch(() => null);
    if (process.env.TRACE) for (const k of (details && details.skills) || []) say(`        ${k.skill} -> ${k.chose || 'nothing'} (${k.how || ''}) ${k.searches.map(x => `${x.q}: ${x.found} in ${x.ms}ms${x.real ? ' real' : ''}`).join('; ')}`);
    const problems = judge(got, s, name);
    if (!mine.starts || !mine.polls) problems.push('the answers weren\'t asked for with a ticket (/ext/fill/start, then /ext/fill/poll)');
    if (name === 'heal') {
      // Put right by itself, and written down: in the page's trail and in the extension's log.
      const trail = ((details && details.trail) || []).map(e => e.m).join(' | ');
      if (!/heal: Job Hunt was restarted/.test(trail)) problems.push(`the page's trail doesn't say the form was sent again: ${trail.slice(0, 300)}`);
      if (!/no word from Job Hunt/.test(trail) || !/answering again/.test(trail)) problems.push(`the page's trail doesn't say Job Hunt stopped answering and came back: ${trail.slice(0, 300)}`);
      const log = await sw.evaluate(() => report('test', 'mock'));
      if (!/form sent/.test(log) || !/heal: Job Hunt was restarted/.test(log) || !/"extension"/.test(log)) problems.push(`the extension's log is missing the fill or the repair: ${log.slice(0, 400)}`);
      await page.waitForTimeout(500);
      if (!logs.some(l => l.why === 'test' && (l.events || []).length)) problems.push('Job Hunt was not given the log');
    }
    say(`${problems.length ? 'FAIL' : 'ok  '}  ${name.padEnd(7)} ${secs}s  skills: ${got.skills.join(', ') || 'none'} | study: ${got.study.join(', ') || 'none'}`);
    if (problems.length) {
      failed.push(name);
      for (const p of problems) say(`        ${p}`);
      say(`        panel: ${s.slice(0, 300)}`);
      if (details && details.drops) say(`        dropdowns: ${JSON.stringify(details.drops).slice(0, 700)}`);
      say(`        searches: ${got.searches.join(' | ')}  clicks in the list: ${got.clicks}`);
    }
    await ctx.close();
    console.log(said.join('\n'));
  };
  const rest = async () => {
  const { ctx, sw } = await open();
  // Job Hunt's own Apply window: the same script without the extension (no real clicks), talking to
  // the app through addresses it catches. The list here takes a script's clicks.
  if (!only.length || only.includes('app')) {
    const page = await ctx.newPage();
    const fill = fs.readFileSync(path.join(ROOT, 'core', 'src', 'fill.js'), 'utf8').replace("'__TOKEN__'", "'tok'").replace('__JOB__', JSON.stringify({ title: 'Senior Program Manager', company: 'Mock Co' }));
    let answer = null;
    await page.route('https://jobhunt.invalid/**', route => {
      const [, kind, b64] = new URL(route.request().url()).pathname.split('/');
      if (kind === 'fields') answer = answers(JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).fields, 'app');
      return route.fulfill({ status: 204 }); // no content: the page stays where it is, as when the app cancels it
    });
    await page.addInitScript(fill);
    const t0 = Date.now();
    await page.goto(`${base}?click=any`);
    for (let i = 0; i < 40 && !answer; i++) await page.waitForTimeout(500);
    let s = '', got = { skills: [], study: [] };
    if (answer) {
      // Each time the form is read again (after its Add buttons were pressed), the app answers again.
      let given = null;
      for (let i = 0; i < 500; i++) { if (answer !== given) { given = answer; await page.evaluate(a => { window.__jobhunt.fill(a); }, answer); } await page.waitForTimeout(500); s = await page.evaluate(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || ''); if (/^Filled \d+/.test(s)) break; }
      got = await page.evaluate(() => ({ skills: window.mock.skills(), study: window.mock.study(), state: window.mock.state() }));
    }
    const problems = answer ? judge(got, s, 'app') : ['the form was never read (no questions were sent to Job Hunt)'];
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${'app'.padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  skills: ${got.skills.join(', ') || 'none'} | study: ${got.study.join(', ') || 'none'}`);
    if (problems.length) { failed.push('app'); for (const p of problems) console.log(`        ${p}`); console.log(`        panel: ${s.slice(0, 300)}`); }
    await page.close();
  }
  // A job site's own profile (one job at a time, whole dates): Job Hunt can't match it to an
  // application, offers the profile, fills it from the CV, and has nothing to mark as submitted.
  // Twice: started on the form itself; and started on the profile's list of jobs, a page with no
  // boxes and an "Add a new experience" link to the form (Job Bank's): the link is pressed for you,
  // and the page it leads to is filled without another press.
  for (const fromList of [false, true]) if (!only.length || only.includes('profile')) {
    picked = '';
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${site.address().port}/match/profile/${fromList ? 'list' : 'experience'}`;
    await page.goto(url);
    const t0 = Date.now();
    await sw.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url: url + '*', active: true });
      await startFill(tab.id);
    }, url);
    if (fromList) { await page.waitForURL('**/match/profile/experience', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600); }
    const panel = f => page.evaluate(f);
    const problems = [];
    if (fromList && !/\/match\/profile\/experience$/.test(page.url())) problems.push(`the list's Add link wasn't pressed (still on ${page.url()})`);
    let chosen = null;
    for (let i = 0; i < 60 && !chosen; i++) { await page.waitForTimeout(500); chosen = await panel(() => { const r = document.querySelector('[data-jobhunt-panel]')?.shadowRoot, c = r?.querySelector('.c'); return c && !c.hidden ? { value: c.querySelector('select').value, button: c.querySelector('[data-k=pick]').textContent, logo: r.querySelectorAll('svg.m path, svg.m circle').length, head: r.querySelector('.t').textContent } : null; }); }
    if (!chosen) problems.push('the panel never offered the choice');
    else {
      if (chosen.value !== 'profile') problems.push(`the profile wasn't chosen for a page that reads as one (chosen: ${chosen.value})`);
      if (chosen.button !== 'Fill it in from my CV') problems.push(`the button says "${chosen.button}"`);
      if (chosen.logo < 4) problems.push('the panel has no Job Hunt logo');
      if (/·\s*$/.test(chosen.head)) problems.push(`the heading ends in a stray dot: "${chosen.head}"`);
      await panel(() => document.querySelector('[data-jobhunt-panel]').shadowRoot.querySelector('[data-k=pick]').click());
    }
    let s = '';
    for (let i = 0; i < 120 && chosen; i++) { await page.waitForTimeout(500); s = await panel(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || ''); if (/^Filled \d+/.test(s) || /Couldn't|No form|No answers/.test(s)) break; }
    const got = await panel(() => { const r = document.querySelector('[data-jobhunt-panel]')?.shadowRoot; const v = id => document.getElementById(id).value; return { title: v('title'), employer: v('employer'), city: v('city'), prov: v('prov'), start: v('start'), end: v('end'), applied: !r?.querySelector('[data-k=applied]')?.hidden, drop: !r?.querySelector('[data-k=drop]')?.hidden }; });
    const want = { title: 'Senior Program Manager', employer: 'Maple Bank', city: 'Toronto', prov: 'Ontario', start: '2019-03-01', end: '' };
    for (const k of Object.keys(want)) if (got[k] !== want[k]) problems.push(`${k} is "${got[k]}", not "${want[k]}"`);
    if (chosen && !/job 1 on your CV/.test(s)) problems.push('the panel doesn\'t say which job it filled in');
    if (got.applied || got.drop) problems.push('I submitted it or Not interested is offered on a profile');
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${(fromList ? 'profile (from its list)' : 'profile').padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  ${got.title || 'no title'} at ${got.employer || 'no employer'}, from ${got.start || 'no date'}`);
    if (problems.length) { failed.push(fromList ? 'profile from its list' : 'profile'); for (const p of problems) console.log(`        ${p}`); console.log(`        panel: ${s.slice(0, 300)}`); }
    await page.close();
  }
  // A form whose parts are folded away (SuccessFactors, as Rogers uses it): "Expand all sections"
  // is pressed first, and what it shows is filled. And the brief for another assistant can be copied.
  if (!only.length || only.includes('folded')) {
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${site.address().port}/folded/apply`;
    await page.goto(url);
    const t0 = Date.now();
    await sw.evaluate(async url => { const [tab] = await chrome.tabs.query({ url: url + '*', active: true }); await startFill(tab.id); }, url);
    let s = '';
    for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); s = await page.evaluate(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || ''); if (/^Filled \d+/.test(s) || /Couldn't|can't find|No answers/.test(s)) break; }
    const got = await page.evaluate(() => ({ open: document.getElementById('profile').style.display !== 'none', email: document.getElementById('email').value, phone: document.getElementById('phone').value, brief: !document.querySelector('[data-jobhunt-panel]').shadowRoot.querySelector('[data-k=brief]').hidden }));
    const problems = [];
    if (!got.open) problems.push('Expand all sections was not pressed');
    if (got.email !== 'sam@example.com' || got.phone !== '416-555-0100') problems.push(`the boxes it showed weren't filled (email "${got.email}", phone "${got.phone}")`);
    if (!got.brief) problems.push('the panel has no Copy a brief for Claude');
    // A page Job Hunt can't fill: the hand-over to the Claude extension is offered, and pressing it says what to do next.
    await page.goto(`http://127.0.0.1:${site.address().port}/nothing/here`);
    // (The panel follows to the site's next page by itself; its own button starts the fill there.)
    for (let i = 0; i < 30; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => !!document.querySelector('[data-jobhunt-panel]')?.shadowRoot?.querySelector('[data-k=fill]'))) break; if (i === 12) await sw.evaluate(async url => { const [tab] = await chrome.tabs.query({ url: url + '*', active: true }); await startFill(tab.id); }, `http://127.0.0.1:${site.address().port}/nothing/here`); }
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('[data-jobhunt-panel]').shadowRoot.querySelector('[data-k=fill]').click());
    let hand = { shown: false, said: '' };
    for (let i = 0; i < 40 && !hand.shown; i++) { await page.waitForTimeout(500); hand = await page.evaluate(() => { const r = document.querySelector('[data-jobhunt-panel]')?.shadowRoot; return { shown: !!r && !r.querySelector('[data-k=hand]').hidden, said: r?.querySelector('.s')?.textContent || '' }; }); }
    if (!hand.shown) problems.push(`Let Claude finish it isn't offered on a page Job Hunt can't fill (panel: ${hand.said.slice(0, 120)})`);
    else {
      await page.evaluate(() => document.querySelector('[data-jobhunt-panel]').shadowRoot.querySelector('[data-k=hand]').click());
      await page.waitForTimeout(1500);
      const said = await page.evaluate(() => document.querySelector('[data-jobhunt-panel]').shadowRoot.querySelector('.s').textContent);
      if (!/Copied for Claude|Choose which application/.test(said)) problems.push(`pressing Let Claude finish it said "${said.slice(0, 160)}"`);
    }
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${'folded'.padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  email ${got.email || 'empty'}`);
    if (problems.length) { failed.push('folded'); for (const p of problems) console.log(`        ${p}`); console.log(`        panel: ${s.slice(0, 300)}`); }
    await page.close();
  }
  // A cover letter kept behind "Supporting documents · Add" (Indeed's review page): the link is
  // pressed, and the upload box it shows gets the letter, not the CV.
  if (!only.length || only.includes('letter')) {
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${site.address().port}/letter/review`;
    await page.goto(url);
    const t0 = Date.now();
    await sw.evaluate(async url => { const [tab] = await chrome.tabs.query({ url: url + '*', active: true }); await startFill(tab.id); }, url);
    let s = '';
    for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); s = await page.evaluate(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || ''); if (/^Filled \d+/.test(s) || /Couldn't|can't find|No answers|tripped/.test(s)) break; }
    const got = await page.evaluate(() => ({ open: document.getElementById('up').style.display !== 'none', file: document.getElementById('doc').files[0]?.name || '', email: document.getElementById('email').value, prov: document.getElementById('prov').value }));
    const problems = [];
    if (got.prov !== 'Ontario') problems.push(`the box with a list of its own holds "${got.prov}", not Ontario`);
    if (!got.open) problems.push('the Add beside Supporting documents was not pressed');
    if (got.file !== 'Sam Lee - Cover letter.pdf') problems.push(`the box it opened holds "${got.file || 'nothing'}", not the cover letter`);
    if (got.email !== 'sam@example.com') problems.push(`the rest of the page wasn't filled (email "${got.email}")`);
    // How it went is reported for the site's tally: counts, no answers.
    await page.waitForTimeout(600);
    const rep = reports.find(r => /\/letter\/review/.test(r.url || '') && !r.handed && !r.failed);
    if (!rep || !(rep.filled > 0) || JSON.stringify(rep).includes('sam@example.com')) problems.push(`no tally of this fill was sent, or it holds an answer (${JSON.stringify(rep || null).slice(0, 160)})`);
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${'letter'.padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  ${got.file || 'no file'}`);
    if (problems.length) { failed.push('letter'); for (const p of problems) console.log(`        ${p}`); console.log(`        panel: ${s.slice(0, 300)}`); }
    await page.close();
  }
  // Hiring posts: a page of posts (a stand-in for LinkedIn's search) read by the extension and sent
  // to Job Hunt, each with who wrote it and its own link; and one ordinary page, sent as chosen.
  if (!only.length || only.includes('posts')) {
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${site.address().port}/search/results/content/?keywords=hiring`;
    await page.goto(url);
    const t0 = Date.now();
    const send = (url, chosen) => sw.evaluate(async ({ url, chosen }) => {
      const [tab] = await chrome.tabs.query({ url: url.split('?')[0] + '*', active: true });
      try { return await sendPosts(tab.id, chosen); } catch (e) { return { error: e.message }; }
    }, { url, chosen });
    const r = await send(url, false);
    const problems = [];
    const got = (leads && leads.posts) || [];
    if (r.error) problems.push(`sending failed: ${r.error}`);
    if (got.length !== 3) problems.push(`${got.length} posts were read, not 3 (a nested box read twice, or one missed)`);
    const d = got[0] || {};
    if (d.author !== 'Dana Okafor') problems.push(`the first post's writer is "${d.author}", not "Dana Okafor"`);
    if (d.headline !== 'Co-founder at Brightloop') problems.push(`her headline is "${d.headline}"`);
    if (d.link !== 'https://www.linkedin.com/in/dana-okafor-123') problems.push(`her profile link is "${d.link}"`);
    if (d.url !== 'https://www.linkedin.com/feed/update/urn:li:activity:7001/') problems.push(`the post's link is "${d.url}"`);
    if (!/closed our seed round/.test(d.text || '')) problems.push('the post\'s text is cut short');
    if (got[2] && (got[2].link !== 'https://www.linkedin.com/company/northwind-robotics' || /see more/.test(got[2].text))) problems.push(`a company's post: link "${got[2].link}", text ends "${got[2].text.slice(-20)}"`);
    if (leads && leads.chosen) problems.push('a page of many posts was sent as one you chose');
    if (!r.error && (r.added !== 2 || !r.many)) problems.push(`Job Hunt's answer didn't come back (${JSON.stringify(r)})`);
    // An ordinary page (the mock form): one post, kept because you chose it.
    leads = null;
    const other = await ctx.newPage();
    await other.goto(`${base}?click=any`);
    const r2 = await send(`${base}?click=any`, true);
    if (r2.error || !leads || leads.posts.length !== 1 || !leads.chosen) problems.push(`one page you chose wasn't sent as one chosen post (${JSON.stringify(r2).slice(0, 120)})`);
    await other.close();
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${'posts'.padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  ${got.map(p => p.author).join(', ') || 'no posts'}`);
    if (problems.length) { failed.push('posts'); for (const p of problems) console.log(`        ${p}`); }
    await page.close();
  }
  await ctx.close();
  };
  // Three browsers at a time (JOBS=1 for one after another, when reading a failure).
  const jobs = names.map(n => () => runVariant(n));
  if (!only.length || ['app', 'profile', 'posts', 'folded', 'letter'].some(n => only.includes(n))) jobs.push(rest);
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.max(1, Number(process.env.JOBS) || 3) }, async () => { while (jobs.length) await jobs.shift()(); }));
  console.log(`      (${Math.round((Date.now() - t0) / 1000)}s in all)`);
  bridge.close(); site.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed.length) { console.log(`\n${failed.length} failed: ${failed.join(', ')}`); process.exit(1); }
  console.log('\nThe extension fills the mock Workday page.');
})().catch(e => { console.log(`FAIL  the test itself stopped: ${e.message}`); process.exit(1); });
