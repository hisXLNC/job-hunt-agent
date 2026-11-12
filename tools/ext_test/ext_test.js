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
function answers(fields) {
  const values = {};
  for (const f of fields || []) {
    if (f.type === 'skills') values[f.key] = SKILLS;
    else if (f.type === 'prompt') values[f.key] = 'Computer Science';
    else if (/email/i.test(f.label)) values[f.key] = 'sam@example.com';
    else if (/phone/i.test(f.label)) values[f.key] = '416-555-0100';
    else if (/school/i.test(f.label)) values[f.key] = 'University of Toronto';
  }
  return { values, files: {}, roles: 0, banked: [], job: { title: 'Senior Program Manager', company: 'Mock Co' }, app_version: VERSION };
}
const listen = (server, port) => new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', () => ok(server)); });
const json = (res, v) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(v)); };

(async () => {
  const only = process.argv.slice(2);
  const names = Object.keys(VARIANTS).filter(n => !only.length || only.includes(n));
  if (only.some(n => n !== 'app' && n !== 'profile' && VARIANTS[n] === undefined)) { console.log(`No such variant. Choose from: ${Object.keys(VARIANTS).join(', ')}, app, profile`); process.exit(1); }
  // Job Hunt's side: says its version, and answers a form's questions.
  let asked = null;
  let picked = '';
  let bridge;
  try {
    bridge = await listen(http.createServer((req, res) => {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.url === '/ext/ping') return json(res, { ok: true, version: VERSION });
        if (req.url === '/ext/pick') { picked = JSON.parse(body || '{}').job_id || ''; return json(res, { ok: true }); }
        if (req.url === '/ext/fill') {
          asked = JSON.parse(body || '{}');
          // A site's own profile: no application to match it to, so the panel is given the choice,
          // and once the profile is chosen, one job from the CV.
          if (/\/match\/profile/.test(asked.url || '')) {
            if (picked !== 'profile') { res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ error: "Job Hunt can't tell which application this is. Choose it below, or the last one if this is a profile to fill in from your CV.", choose: [{ id: 'a1', title: 'Business Project Manager', company: 'osc', status: 'approved' }, { id: 'profile', title: 'Not an application', company: 'a profile here, from my CV', status: 'profile' }] })); }
            const by = { 'job title': 'Senior Program Manager', 'employer name': 'Maple Bank', 'city': 'Toronto', 'province': 'Ontario', 'start date': '2019-03-01' };
            const values = {};
            for (const f of asked.fields || []) for (const k of Object.keys(by)) if (String(f.label || '').toLowerCase().includes(k)) values[f.key] = by[k];
            return json(res, { values, files: {}, roles: 0, banked: [], job: { id: 'profile', title: 'Your profile', company: '127.0.0.1' }, app_version: VERSION, profile: true, note: 'That was job 1 on your CV (Senior Program Manager).' });
          }
          return json(res, answers(asked.fields));
        }
        json(res, { ok: true });
      });
    }), 47613);
  } catch (e) { console.log('skipped: 127.0.0.1:47613 is in use (is Job Hunt running here?)'); process.exit(2); }
  const html = fs.readFileSync(path.join(__dirname, 'workday.html'));
  const profileHtml = fs.readFileSync(path.join(__dirname, 'profile.html'));
  const site = await listen(http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url.startsWith('/match/profile') ? profileHtml : html); }), 0);
  const base = `http://127.0.0.1:${site.address().port}/apply`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-ext-'));
  const extDir = path.join(tmp, 'ext');
  buildExtension(extDir);
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { headless: false, viewport: { width: 1100, height: 700 },
    args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ key: 'jh-test' }));

  const failed = [];
  // What a run must have done, whoever filled it in.
  const judge = (got, s) => {
    const problems = [];
    for (const w of WANT) if (!got.skills.includes(w)) problems.push(`"${w}" wasn't chosen`);
    if (!got.skills.some(x => /^Payment/.test(x))) problems.push('nothing chosen for "Payments Integration" (the list has Payments)');
    const extra = got.skills.filter(x => !WANT.includes(x) && !/^Payment/.test(x));
    if (extra.length) problems.push(`chosen though not on the CV: ${extra.join(', ')}`);
    if (got.study.join() !== 'Computer Science') problems.push(`Field of Study is ${JSON.stringify(got.study)}, not Computer Science`);
    if (!/Underwater Basket Weaving/.test(s)) problems.push('the skill the site doesn\'t have wasn\'t reported');
    if (/add these yourself\): [^.]*(Python|SQL|Project Management|Vendor Management)/.test(s)) problems.push('a skill that was chosen is reported as not taken');
    return problems;
  };
  for (const name of names) {
    const page = await ctx.newPage();
    const url = `${base}?${VARIANTS[name]}`;
    await page.goto(url);
    const t0 = Date.now();
    await sw.evaluate(async ({ url, zoom }) => {
      const [tab] = await chrome.tabs.query({ url: url.split('?')[0] + '*', active: true });
      if (zoom) await chrome.tabs.setZoom(tab.id, zoom);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fill.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__jobhunt.start() });
    }, { url, zoom: name === 'zoom' ? 0.8 : 0 });
    const status = () => page.evaluate(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || '');
    let s = '';
    for (let i = 0; i < 600; i++) { await page.waitForTimeout(500); s = await status(); if (/^Filled \d+/.test(s) || /Couldn't|No form|No answers/.test(s)) break; }
    const got = await page.evaluate(() => ({ skills: window.mock.skills(), study: window.mock.study(), clicks: window.mock.clicks.length, searches: window.mock.searches }));
    const secs = Math.round((Date.now() - t0) / 1000);
    const details = await sw.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url: url.split('?')[0] + '*', active: true });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__jobhunt.details() });
      return r.result;
    }, url).catch(() => null);
    if (process.env.TRACE) for (const k of (details && details.skills) || []) console.log(`        ${k.skill} -> ${k.chose || 'nothing'} (${k.how || ''}) ${k.searches.map(x => `${x.q}: ${x.found} in ${x.ms}ms${x.real ? ' real' : ''}`).join('; ')}`);
    const problems = judge(got, s);
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${name.padEnd(7)} ${secs}s  skills: ${got.skills.join(', ') || 'none'} | study: ${got.study.join(', ') || 'none'}`);
    if (problems.length) {
      failed.push(name);
      for (const p of problems) console.log(`        ${p}`);
      console.log(`        panel: ${s.slice(0, 300)}`);
      console.log(`        searches: ${got.searches.join(' | ')}  clicks in the list: ${got.clicks}`);
    }
    await page.close();
  }
  // Job Hunt's own Apply window: the same script without the extension (no real clicks), talking to
  // the app through addresses it catches. The list here takes a script's clicks.
  if (!only.length || only.includes('app')) {
    const page = await ctx.newPage();
    const fill = fs.readFileSync(path.join(ROOT, 'core', 'src', 'fill.js'), 'utf8').replace("'__TOKEN__'", "'tok'").replace('__JOB__', JSON.stringify({ title: 'Senior Program Manager', company: 'Mock Co' }));
    let answer = null;
    await page.route('https://jobhunt.invalid/**', route => {
      const [, kind, b64] = new URL(route.request().url()).pathname.split('/');
      if (kind === 'fields') answer = answers(JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).fields);
      return route.fulfill({ status: 204 }); // no content: the page stays where it is, as when the app cancels it
    });
    await page.addInitScript(fill);
    const t0 = Date.now();
    await page.goto(`${base}?click=any`);
    for (let i = 0; i < 40 && !answer; i++) await page.waitForTimeout(500);
    let s = '', got = { skills: [], study: [] };
    if (answer) {
      await page.evaluate(a => { window.__jobhunt.fill(a); }, answer);
      for (let i = 0; i < 400; i++) { await page.waitForTimeout(500); s = await page.evaluate(() => document.querySelector('[data-jobhunt-panel]')?.shadowRoot.querySelector('.s')?.textContent || ''); if (/^Filled \d+/.test(s)) break; }
      got = await page.evaluate(() => ({ skills: window.mock.skills(), study: window.mock.study() }));
    }
    const problems = answer ? judge(got, s) : ['the form was never read (no questions were sent to Job Hunt)'];
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${'app'.padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  skills: ${got.skills.join(', ') || 'none'} | study: ${got.study.join(', ') || 'none'}`);
    if (problems.length) { failed.push('app'); for (const p of problems) console.log(`        ${p}`); console.log(`        panel: ${s.slice(0, 300)}`); }
    await page.close();
  }
  // A job site's own profile (one job at a time, whole dates): Job Hunt can't match it to an
  // application, offers the profile, fills it from the CV, and has nothing to mark as submitted.
  if (!only.length || only.includes('profile')) {
    const page = await ctx.newPage();
    const url = `http://127.0.0.1:${site.address().port}/match/profile/experience`;
    await page.goto(url);
    const t0 = Date.now();
    await sw.evaluate(async url => {
      const [tab] = await chrome.tabs.query({ url: url + '*', active: true });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fill.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__jobhunt.start() });
    }, url);
    const panel = f => page.evaluate(f);
    const problems = [];
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
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${'profile'.padEnd(7)} ${Math.round((Date.now() - t0) / 1000)}s  ${got.title || 'no title'} at ${got.employer || 'no employer'}, from ${got.start || 'no date'}`);
    if (problems.length) { failed.push('profile'); for (const p of problems) console.log(`        ${p}`); console.log(`        panel: ${s.slice(0, 300)}`); }
    await page.close();
  }
  await ctx.close();
  bridge.close(); site.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed.length) { console.log(`\n${failed.length} failed: ${failed.join(', ')}`); process.exit(1); }
  console.log('\nThe extension fills the mock Workday page.');
})().catch(e => { console.log(`FAIL  the test itself stopped: ${e.message}`); process.exit(1); });
