// Open the recruiter and job sites in a real browser, the way the Windows app's hidden window does,
// and print what their finished pages offer: links that look like postings, and search forms.
//   node tools/render_sites.js
// Run on GitHub (Actions -> Checks -> "sites"): the cloud sessions can't reach these sites.
const { chromium } = require('playwright');

const SITES = [
  ['Randstad', 'https://www.randstad.ca/jobs/q-accountant/l-toronto/'],
  ['Adecco', 'https://www.adecco.com/en-ca/job-seekers/find-a-job?k=Accountant&l=Toronto%2C+ON'],
  ['Adecco search', 'https://www.adecco.com/en-ca/job-search'],
  ['Adecco search q', 'https://www.adecco.com/en-ca/job-search?k=accountant&l=Toronto'],
  ['Hays', 'https://www.hays.ca/job-search/accountant-jobs-in-toronto'],
  ['Aerotek', 'https://jobs.aerotek.com/us/en/search-results?keywords=Accountant'],
  ['Aerotek Canada', 'https://jobs.aerotek.com/ca/en/search-results?keywords=Technician'],
  ['Michael Page', 'https://www.michaelpage.ca/jobs/accountant/toronto'],
  ['Robert Half', 'https://www.roberthalf.com/ca/en/jobs/accountant/toronto'],
  ['Altis', 'https://jobportal.altis.com/?keyword=Accountant'],
  ['People First HR', 'https://peoplefirsthr.com/jobs'],
  ['Jobs.ca', 'https://www.jobs.ca/jobs?q=Accountant&l=Toronto%2C+ON'],
  ['Tech Talent Canada', 'https://jobs.techtalent.ca/?q=Developer'],
  ['Job Bank', 'https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=Accountant&locationstring=Toronto%2C+ON'],
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-CA', viewport: { width: 1280, height: 900 } });
  for (const [name, url] of SITES) {
    const page = await ctx.newPage();
    console.log(`\n== ${name}  ${url}`);
    // The searches a page makes in the background: where its jobs come from.
    const calls = [];
    page.on('response', async r => {
      const type = r.headers()['content-type'] || '';
      if (!/json/.test(type) || /analytics|consent|onetrust|google|facebook|hotjar|optimizely|datadog|newrelic|clarity/.test(r.url())) return;
      try {
        const body = await r.text();
        const req = r.request();
        calls.push(`${req.method()} ${r.url().slice(0, 220)}  [${r.status()}, ${body.length} chars]${req.postData() ? `\n        body: ${req.postData().slice(0, 300)}` : ''}\n        answer: ${body.slice(0, 300).replace(/\s+/g, ' ')}`);
      } catch (e) {}
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // Settle: the link count stops changing for two seconds (at most 30 s).
      let last = -1, steady = 0;
      for (let i = 0; i < 30 && steady < 2; i++) {
        await page.waitForTimeout(1000);
        const n = await page.evaluate(() => document.links.length).catch(() => -1);
        steady = n === last ? steady + 1 : 0; last = n;
      }
      const info = await page.evaluate(() => {
        const abs = a => a.href;
        const links = [...document.links].map(a => ({ href: abs(a), text: (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) }))
          .filter(l => l.text && /job|career|posting|position|vacanc|opportun|\/j\/|detail/i.test(l.href) && !/\.(css|js|png|svg|jpg)(\?|$)/.test(l.href));
        const seen = new Set();
        const uniq = links.filter(l => !seen.has(l.href) && seen.add(l.href));
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).join(' ');
        const inputs = [...document.querySelectorAll('input, select')].filter(i => i.type !== 'hidden').map(i => `${i.tagName.toLowerCase()}[name=${i.name || ''}][id=${i.id || ''}][placeholder=${i.placeholder || ''}][aria=${i.getAttribute('aria-label') || ''}]`).slice(0, 12);
        return { title: document.title, final: location.href, links: document.links.length, text: document.body ? document.body.innerText.length : 0,
          jobposting: (ld.match(/JobPosting/g) || []).length, jobish: uniq.length, sample: uniq.slice(0, 25), inputs };
      });
      console.log(`title=${JSON.stringify(info.title)} final=${info.final}`);
      console.log(`links=${info.links} text=${info.text} JobPosting=${info.jobposting} job-ish=${info.jobish}`);
      for (const l of info.sample) console.log(`   ${l.href}  |  ${l.text}`);
      if (/search/i.test(name)) console.log('   inputs:', info.inputs.join('  '));
      for (const c of calls.filter(c => c.length > 0).slice(0, 12)) console.log('   XHR', c);
    } catch (e) {
      console.log('FAILED', e.message.split('\n')[0]);
    }
    await page.close();
  }
  await browser.close();
})();
