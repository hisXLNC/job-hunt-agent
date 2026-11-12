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
  for (const [from, to] of [['overview/approve', '#applications/approve'], ['pipeline', '#applications/all'], ['inbox/settings', '#settings/inbox'], ['calendar/settings', '#settings/calendar'], ['settings/search', '#search/what']]) {
    await at(from);
    check(await hash() === to, `#${from} lands on ${to}`);
  }

  // Today lists the new matches, and its button goes to Pick.
  await at('overview');
  check((await text('.hsteps')).includes('Pick'), 'Today shows the steps');
  const pick = await page.$('.next-card a[href="#applications/pick"]');
  check(!!pick, 'Today lists the new matches to pick from');
  if (pick) { await pick.click(); await page.waitForTimeout(700); }
  check(await hash() === '#applications/pick', 'Its button opens Jobs on Pick');

  // Not interested: the main button doesn't teach scoring.
  const sent = [];
  page.on('request', r => { if (r.method() === 'POST' && /\/status$/.test(r.url())) sent.push(r.postDataJSON()); });
  const before = (await page.$$('[data-pick]')).length;
  check(before >= 3, `Pick has the sample matches (${before})`);
  await page.click('.todo-row.pick:last-child [data-status=dismissed]');
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
  check(await page.evaluate(() => document.querySelector('.todo-row.pick.kb [data-pick]')?.checked === true), 'Arrow and Space tick a role');
  await page.keyboard.press('t');
  check(await until(async () => ((await counts()).ready || 0) >= 1), 'Tailoring moves it to Approve');

  // Jobs opens on what needs you first; approve from the job's page.
  await at('applications');
  check((await text('.flow a.on')).startsWith('Approve'), 'Jobs opens on Approve when something is ready');
  await page.click('.todo-row a.btn');
  await page.waitForTimeout(1200);
  check((await text('.next-step')).includes('Next:'), 'A job says what to do next');
  const approve = await page.$('.next-step [data-act=approve]');
  check(!!approve, 'A tailored job offers Approve');
  if (approve) { await approve.click(); await page.waitForTimeout(1500); await okDialogs(); }
  check(await until(async () => ((await counts()).approved || 0) >= 1, 20), 'Approving moves it to Submit');

  // Submit: mark it applied, and it waits for a reply.
  await at('applications/submit');
  const applied = await page.$('.todo-row [data-status=applied]');
  check(!!applied, 'Submit lists the approved job');
  if (applied) { await applied.click(); await page.waitForTimeout(1200); await okDialogs(); }
  check(await until(async () => ((await counts()).applied || 0) >= 1, 20), 'Mark applied moves it to Waiting');
  await at('applications/waiting');
  check((await page.$$('.todo-row')).length >= 1, 'Waiting lists it');

  // Every page in the menu draws.
  for (const h of ['overview', 'applications/all', 'applications/new', 'applications/applied', 'applications/interviews', 'inbox', 'inbox/recruiters', 'calendar', 'search', 'search/what', 'search/setup',
    'cvs', 'cvs/documents', 'cvs/career', 'cvs/coach', 'cvs/details', 'results', 'settings', 'settings/inbox', 'settings/calendar', 'settings/notifications', 'settings/sync', 'settings/app', 'add', 'welcome']) {
    await at(h);
    const body = await text('#main');
    check(body.length > 40 && !body.includes("Couldn't load"), `#${h} draws`);
  }
  check((await text('#nav')).replace(/\s+/g, ' ').includes('Today Jobs Inbox Calendar'), 'The menu starts Today, Jobs, Inbox, Calendar');

  // A phone: nothing wider than the screen.
  const phone = await browser.newPage({ ...devices['iPhone 13'] });
  phone.on('pageerror', e => errors.push(`phone: ${e.message}`));
  await phone.addInitScript(() => { try { sessionStorage.setItem('welcomed', '1'); } catch (e) {} });
  for (const h of ['overview', 'applications/pick', 'applications/all', 'search']) {
    await phone.goto(`${base}/#${h}`); await phone.reload(); await phone.waitForTimeout(900);
    check(!await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `Phone: #${h} doesn't scroll sideways`);
  }
  check(errors.length === 0, `No script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  if (failed.length) { console.log(`\n${failed.length} failed:\n- ${failed.join('\n- ')}`); process.exit(1); }
  console.log('\nScreens work.');
})().catch(e => { console.log(`FAIL  the test itself stopped: ${e.message}`); process.exit(1); });
