// Clicks through Job Hunt's screens in a real browser, against the developer preview
// (core/examples/dev_server.rs, sample data and a stand-in for Claude). Run by tools/screen_test.py,
// which starts the preview; `python tools/release_ci.py verify` runs that when Playwright is installed.
//
//   node tools/screen_test.js http://127.0.0.1:8790
//
// It checks the flow a job takes (pick, tailor, approve, submit, waiting), that every page in the menu
// draws without an error, that older addresses still land somewhere, and that a phone-sized window
// doesn't scroll sideways. Exit code 1 with the list of what failed.
const { chromium, devices } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8790';
const failed = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failed.push(what); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // The welcome tour is shown once per browser session: skip it.
  await page.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) {} });
  const at = async h => { await page.goto(`${base}/#${h}`); await page.reload(); await page.waitForTimeout(900); };
  const hash = () => page.evaluate(() => location.hash);
  const text = sel => page.evaluate(s => document.querySelector(s)?.innerText || '', sel);
  const counts = () => page.evaluate(() => fetch('/api/overview').then(r => r.json()).then(o => o.counts));
  const until = async (fn, secs = 60) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await page.waitForTimeout(500); } return false; };
  const okDialogs = async () => { for (let i = 0; i < 3; i++) { const b = await page.$('.modal .btn.primary'); if (!b) break; await b.click().catch(() => {}); await page.waitForTimeout(800); } };

  // Older addresses.
  for (const [from, to] of [['overview/ready', '#overview/approve'], ['pipeline', '#applications/all'], ['inbox/settings', '#settings/inbox'], ['calendar/settings', '#settings/calendar'], ['settings/search', '#search/what'], ['cvs/documents', '#applications/files']]) {
    await at(from);
    check(await hash() === to, `#${from} lands on ${to}`);
  }

  // The Queue opens on a decision: a new match to pick, with its buttons.
  await at('overview');
  const kind = () => page.evaluate(() => document.querySelector('.decision')?.dataset.kind || '');
  const title = () => text('.decision h2');
  check(await kind() === 'pick', 'The Queue opens on a new match to pick');
  check((await text('.qsteps')).includes('Pick'), 'The Queue counts its decisions by kind');
  const first = await title();
  await page.click('.decision [data-act=queueSkip]'); await page.waitForTimeout(500);
  check((await title()) !== first && (await kind()) === 'pick', 'Skip shows the next decision');

  // Pipeline, Pick: the list. Not interested: the main button doesn't teach scoring.
  await at('applications/pick');
  const sent = [];
  page.on('request', r => { if (r.method() === 'POST' && /\/status$/.test(r.url())) sent.push(r.postDataJSON()); });
  const before = (await page.$$('[data-pick]')).length;
  check(before >= 3, `Pipeline, Pick lists the sample matches (${before})`);
  await page.click('.jrow.pick:last-child [data-status=dismissed]');
  await page.waitForTimeout(500);
  check((await text('.modal .btn.primary')).trim() === 'Not interested', 'Not interested is the main button of its dialog');
  await page.click('.modal .btn.primary');
  await until(async () => sent.length > 0, 10);
  check(sent[0]?.status === 'dismissed' && sent[0]?.learn === false, 'Not interested sets it aside without learning from it');
  await page.waitForTimeout(1200);

  // Pick with the keyboard, then tailor.
  await at('applications/pick');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  check(await page.evaluate(() => document.querySelector('.jrow.pick.kb [data-pick]')?.checked === true), 'Arrow and Space tick a role');
  await page.keyboard.press('t');
  check(await until(async () => ((await counts()).ready || 0) >= 1), 'Tailoring moves it to Approve');

  // The Queue now leads with what's furthest along: approve it there, with the keyboard.
  await at('overview');
  check(await kind() === 'approve', 'The Queue leads with the tailored job to approve');
  const jobId = await page.evaluate(() => document.querySelector('.decision [data-primary]').dataset.job);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500); await okDialogs();
  check(await until(async () => ((await counts()).approved || 0) >= 1, 20), 'Enter approves it: it moves to Submit');

  // A job's own page says what to do next.
  await at(`job/${encodeURIComponent(jobId)}`);
  check((await text('.next-step')).includes('Next:'), 'A job says what to do next');
  check((await text('#nav a.on')).trim() === 'Pipeline', 'A job belongs to Pipeline');

  // Submit, from the Queue: mark it applied, and it waits for a reply.
  await at('overview/submit');
  check(await kind() === 'submit', 'The Queue, Submit shows the approved job');
  const applied = await page.$('.decision [data-status=applied]');
  if (applied) { await applied.click(); await page.waitForTimeout(1200); await okDialogs(); }
  check(await until(async () => ((await counts()).applied || 0) >= 1, 20), 'Mark applied moves it to Waiting');
  await at('applications/waiting');
  check((await page.$$('.jrow, .trow')).length >= 1, 'Pipeline, Waiting lists it');

  // Every page in the menu draws.
  for (const h of ['overview', 'results', 'applications/files', 'applications/all', 'applications/new', 'applications/applied', 'applications/interviews', 'inbox', 'inbox/recruiters', 'calendar', 'search', 'search/what', 'search/setup',
    'cvs', 'cvs/documents', 'cvs/career', 'cvs/coach', 'cvs/details', 'results', 'settings', 'settings/inbox', 'settings/calendar', 'settings/notifications', 'settings/sync', 'settings/extension', 'settings/app', 'add', 'welcome']) {
    await at(h);
    const body = await text('#main');
    check(body.length > 40 && !body.includes("Couldn't load"), `#${h} draws`);
  }
  check((await text('#nav')).replace(/\s+/g, ' ').trim().replace(/ \d+/g, '') === 'Queue Pipeline Inbox Calendar Me', 'The places are Queue, Pipeline, Inbox, Calendar, Me');
  const on = async () => `${(await text('#nav a.on')).replace(/\s*\d+\s*$/, '').trim()} / ${(await text('.place-tabs a.on, .pipe-tabs a.on')).replace(/\s*\d+\s*$/, '').trim()}`;
  await at('calendar'); check((await text('#nav a.on')).trim() === 'Calendar', 'The calendar is its own place');
  await at('inbox'); check(await on() === 'Inbox / Email', 'Inbox opens on Email');
  await at('results'); check(await on() === 'Pipeline / Insights', 'Results are Pipeline, Insights');
  await at('applications/files'); check(await on() === 'Pipeline / Tailored files', 'Tailored files are in Pipeline');
  await at('search/what'); check(await on() === 'Me / Looking for', 'What to search for is Me, Looking for');
  await at('cvs'); check((await on()).startsWith('Me / CVs'), 'Your CVs are Me, CVs');
  const gear = () => page.evaluate(() => document.querySelector('#settingsLink').classList.contains('on'));
  await at('settings'); check(await gear() && (await text('.place-tabs a.on')).trim() === 'Accounts', 'Settings is the gear');
  await at('search'); check(await gear() && (await text('.place-tabs a.on')).trim() === 'Job sources', 'Where it looks is Settings, Job sources');
  await page.click('#runLine'); await page.waitForTimeout(300);
  check(await page.evaluate(() => { const r = document.querySelector('#syncLine').getBoundingClientRect(); return r.width > 0 && r.height > 0; }), 'The status in the top bar opens the status lines');

  // A phone: nothing wider than the screen.
  const phone = await browser.newPage({ ...devices['iPhone 13'] });
  phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
  await phone.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) {} });
  for (const h of ['overview', 'applications/pick', 'applications/all', 'search']) {
    await phone.goto(`${base}/#${h}`); await phone.reload(); await phone.waitForTimeout(900);
    check(!await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `Phone: #${h} doesn't scroll sideways`);
  }
  // A phone held sideways (or a wide folding one): the tabs run down the right edge.
  const wide = await browser.newPage({ viewport: { width: 915, height: 500 }, hasTouch: true, isMobile: true });
  wide.on('pageerror', e => errors.push(`sideways: ${e.message}`));
  await wide.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) {} });
  for (const h of ['overview', 'applications/pick', 'settings/extension']) {
    await wide.goto(`${base}/#${h}`); await wide.reload(); await wide.waitForTimeout(900);
    const r = await wide.evaluate(() => { const b = document.querySelector('#tabbar').getBoundingClientRect(); return { left: b.left, right: b.right, height: b.height, w: innerWidth, h: innerHeight, scroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
    check(r.left > r.w - 110 && r.right >= r.w - 1 && r.height > r.h - 10 && !r.scroll, `Sideways phone: #${h} has its tabs down the right edge`);
  }
  // The phone's tabs are the five places; Settings is behind the top bar's menu button.
  await phone.goto(`${base}/#overview`); await phone.reload(); await phone.waitForTimeout(900);
  check((await phone.evaluate(() => document.querySelector('#tabbar').innerText)).replace(/\s+/g, ' ').replace(/ \d+/g, '').trim() === 'Queue Pipeline Inbox Calendar Me', 'Phone: the tabs are the five places');
  await phone.click('#mMenu'); await phone.waitForTimeout(400);
  check(await phone.evaluate(() => { const a = document.querySelector('#settingsLink'); const r = a.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; }), 'Phone: the menu button shows Settings');
  await phone.click('#settingsLink'); await phone.waitForTimeout(900);
  check(await phone.evaluate(() => location.hash.startsWith('#settings') && !document.body.classList.contains('more-open')), 'Phone: Settings opens and the menu closes');
  check(errors.length === 0, `No script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  if (failed.length) { console.log(`\n${failed.length} failed:\n- ${failed.join('\n- ')}`); process.exit(1); }
  console.log('\nScreens work.');
})().catch(e => { console.log(`FAIL  the test itself stopped: ${e.message}`); process.exit(1); });
