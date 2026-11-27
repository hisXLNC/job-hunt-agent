// The functions in this file are run inside the page the person is looking at
// (chrome.scripting.executeScript). Each must stand alone: it cannot use
// anything defined outside itself. They only read. Filling a form in is
// filler.js's work.

// Reads the job posting on the page.
function pageGrabPosting() {
  const text = el => (el ? (el.innerText || el.textContent || '').replace(/\s+\n/g, '\n').trim() : '');
  const out = { title: '', company: '', location: '', description: '', url: location.href.split('#')[0] };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      const list = Array.isArray(j) ? j : (j['@graph'] || [j]);
      for (const x of list) {
        if (!x || x['@type'] !== 'JobPosting') continue;
        out.title = String(x.title || '');
        out.company = String((x.hiringOrganization && x.hiringOrganization.name) || '');
        const a = [].concat(x.jobLocation || [])[0];
        const ad = a && a.address;
        if (ad) out.location = [ad.addressLocality, ad.addressRegion].filter(v => typeof v === 'string' && v).join(', ');
        // Parsed as an inert document: nothing in it runs or loads.
        out.description = (new DOMParser().parseFromString(String(x.description || ''), 'text/html').body.innerText || '').trim();
      }
    } catch (e) { /* not ours to fix */ }
  }
  const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || '';
  if (!out.title) out.title = text(document.querySelector('h1')) || meta('og:title') || document.title;
  if (!out.company) out.company = text(document.querySelector('a[href*="/company/"]')) || meta('og:site_name');
  if (out.description.length < 200) {
    const pick = document.querySelector('#job-details, .jobs-description, .description__text, [class*="job-description"], [class*="jobDescription"], [data-automation-id="jobPostingDescription"], main, article') || document.body;
    out.description = text(pick);
  }
  out.title = out.title.slice(0, 200);
  out.company = out.company.slice(0, 120);
  out.location = out.location.slice(0, 120);
  out.description = out.description.slice(0, 60000);
  return out;
}

// Reads how many have applied, as LinkedIn shows it to the person signed in
// ("47 applicants", "Over 100 people clicked apply"). Only the posting's top
// card is read, so a number in the description is never taken for it.
function pageGrabApplicants() {
  const RE = /(?:over\s+|more than\s+)?\d[\d,]*\s+(?:applicants?|people clicked apply)|be among the first \d+ applicants/i;
  const cards = document.querySelectorAll('.job-details-jobs-unified-top-card__container--two-pane, .job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container, .jobs-unified-top-card, .top-card-layout, [class*="top-card"]');
  for (const c of cards) {
    const m = (c.innerText || c.textContent || '').match(RE);
    if (m) return m[0].slice(0, 120);
  }
  return null;
}

// Reads the person's name and headline from a LinkedIn profile.
function pageGrabProfile() {
  const text = el => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const name = text(document.querySelector('main h1, h1'));
  let headline = text(document.querySelector('main .text-body-medium, .top-card-layout__headline, [data-generated-suggestion-target]'));
  if (!headline) {
    const d = (document.querySelector('meta[name="description"], meta[property="og:description"]') || {}).content || '';
    headline = d.split(' · ')[0].slice(0, 160);
  }
  let title = headline, company = '';
  const at = headline.match(/^(.*?)\s+(?:at|@)\s+(.+?)(?:\s*[|·].*)?$/i);
  if (at) { title = at[1]; company = at[2]; }
  return { name: name.slice(0, 120), title: title.slice(0, 160), company: company.slice(0, 120), url: location.origin + location.pathname.replace(/\/+$/, '') };
}

// Reads the posts on a LinkedIn feed, post search or single post: who wrote
// each, their headline, the text and the post's own address. Only reads; Job
// Hunt keeps the ones that read like someone hiring.
function pageGrabPosts() {
  const flat = el => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const body = el => (el ? (el.innerText || el.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '');
  // LinkedIn repeats a name for screen readers; the visible copy is the one marked aria-hidden.
  const shown = el => (el ? flat(el.querySelector('span[aria-hidden="true"]') || el) : '');
  const out = [], seen = new Set();
  const boxes = document.querySelectorAll('[data-urn*="urn:li:activity:"], [data-id*="urn:li:activity:"], .feed-shared-update-v2');
  for (const b of boxes) {
    const urn = ((b.getAttribute('data-urn') || b.getAttribute('data-id') || '').match(/urn:li:activity:\d+/) || [])[0] || '';
    if (urn && seen.has(urn)) continue;
    const t = body(b.querySelector('.update-components-text, .feed-shared-update-v2__description, .feed-shared-text, .update-components-update-v2__commentary'));
    if (!t) continue;
    if (urn) seen.add(urn);
    const actor = b.querySelector('.update-components-actor__title, .update-components-actor__name, .feed-shared-actor__name');
    const desc = b.querySelector('.update-components-actor__description, .feed-shared-actor__description');
    const link = b.querySelector('a.update-components-actor__meta-link, a.update-components-actor__image, a[href*="/in/"]');
    out.push({
      author: shown(actor).slice(0, 120), headline: shown(desc).slice(0, 200), text: t.slice(0, 6000),
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : '',
      author_url: link && /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\//.test(link.href) ? link.href.split('?')[0] : '',
    });
    if (out.length >= 50) break;
  }
  if (!out.length && /\/posts\/|\/feed\/update\//.test(location.pathname)) {
    const t = body(document.querySelector('main, article'));
    if (t) out.push({ author: '', headline: '', text: t.slice(0, 6000), url: location.origin + location.pathname, author_url: '' });
  }
  return out;
}

// Reads "Meet the hiring team" on a LinkedIn posting: each person's name, role
// and profile link. Only that part of the page is read.
function pageGrabHiringTeam() {
  const lines = el => (el.innerText || el.textContent || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const NOISE = /^(message|follow|connect|job poster|verified|premium|•|·|\d+(st|nd|rd|th)\+?|\d+(st|nd|rd|th) degree connection|show more|see more|meet the hiring team|people you can reach out to)$/i;
  const head = [...document.querySelectorAll('h2,h3,span,div')].find(el => el.children.length <= 1 && /^(meet the hiring team|people you can reach out to)$/i.test((el.textContent || '').trim()));
  if (!head) return [];
  let box = head;
  for (let i = 0; i < 6 && box && !box.querySelector('a[href*="/in/"]'); i++) box = box.parentElement;
  if (!box) return [];
  const out = [], seen = new Set();
  for (const a of box.querySelectorAll('a[href*="/in/"]')) {
    let url;
    try { const u = new URL(a.href, location.href); if (!/(^|\.)linkedin\.com$/.test(u.hostname)) continue; url = u.origin + u.pathname.replace(/\/+$/, ''); } catch (e) { continue; }
    if (seen.has(url)) continue;
    // The person's own card: the nearest part around the link that holds their words.
    let card = a;
    for (let i = 0; i < 4 && card.parentElement && card.parentElement !== box && lines(card).length < 2; i++) card = card.parentElement;
    const words = lines(card).map(s => s.replace(/\s*[•·]\s*(1st|2nd|3rd\+?)$/i, '')).filter(s => !NOISE.test(s));
    const name = (lines(a).filter(s => !NOISE.test(s))[0] || words[0] || '').replace(/\s*[•·].*$/, '');
    if (!name || name.length > 120) continue;
    seen.add(url);
    const title = words.find(s => s !== name && !s.startsWith(name)) || '';
    out.push({ name, title: title.slice(0, 160), url });
    if (out.length >= 6) break;
  }
  return out;
}

// Reads the jobs on an Indeed search page: each card's job key, title,
// employer, place, pay and age. Indeed's own data for the cards is read too,
// when the page carries it, for what a card leaves out. Only reads.
function pageGrabIndeed() {
  const flat = el => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const out = new Map();
  const JK = /^[0-9a-f]{12,20}$/i;
  const view = jk => location.origin + '/viewjob?jk=' + jk;
  for (const a of document.querySelectorAll('[data-jk]')) {
    const jk = (a.getAttribute('data-jk') || '').toLowerCase();
    if (!JK.test(jk) || out.has(jk)) continue;
    const card = a.closest('.job_seen_beacon, .cardOutline, li, td.resultContent, [class*="jobCard"]') || a.parentElement;
    if (!card) continue;
    const title = flat(card.querySelector('h2 a span[title], .jobTitle span[title], h2 span[id^="jobTitle"], h2')) || a.getAttribute('aria-label') || '';
    const company = flat(card.querySelector('[data-testid="company-name"], .companyName'));
    const place = flat(card.querySelector('[data-testid="text-location"], .companyLocation'));
    let pay = '';
    for (const el of card.querySelectorAll('[data-testid="attribute_snippet_testid"], .salary-snippet-container, .salaryOnly, .estimated-salary, [class*="salary"]')) {
      const t = flat(el);
      if (/\d/.test(t) && /[$£€]|hour|year|month|week/i.test(t)) { pay = t; break; }
    }
    const posted = flat(card.querySelector('[data-testid="myJobsStateDate"], .date')).replace(/^(posted|employer active|active)\s*/i, '');
    const snippet = flat(card.querySelector('[data-testid="jobsnippet_footer"], .job-snippet'));
    out.set(jk, { job_id: jk, title, company, location: place, pay, posted, description: snippet, url: view(jk) });
  }
  // Indeed's own data behind the cards, in a script on the page.
  for (const s of document.querySelectorAll('script')) {
    const src = s.textContent || '';
    const at = src.indexOf('"mosaic-provider-jobcards"]=');
    if (at < 0) continue;
    try {
      const start = src.indexOf('{', at), end = src.indexOf('};', start);
      const data = JSON.parse(src.slice(start, end + 1));
      const results = (((data.metaData || {}).mosaicProviderJobCardsModel || {}).results) || [];
      for (const r of results) {
        const jk = String(r.jobkey || '').toLowerCase();
        if (!JK.test(jk)) continue;
        const had = out.get(jk) || { job_id: jk, url: view(jk), description: '', title: '', company: '', location: '', pay: '', posted: '' };
        out.set(jk, {
          ...had,
          title: had.title || String(r.displayTitle || r.title || ''),
          company: had.company || String(r.company || ''),
          location: had.location || String(r.formattedLocation || ''),
          pay: had.pay || String((r.salarySnippet && r.salarySnippet.text) || ''),
          posted: had.posted || String(r.formattedRelativeTime || ''),
        });
      }
      break;
    } catch (e) { /* not the cards' data; the cards on the page are enough */ }
  }
  return [...out.values()].filter(j => j.title && j.company).slice(0, 30).map(j => ({
    ...j, title: j.title.slice(0, 200), company: j.company.slice(0, 120), location: j.location.slice(0, 120),
    pay: j.pay.slice(0, 120), posted: j.posted.slice(0, 60), description: (j.description || '').slice(0, 2000),
  }));
}

// Reads the text of the given Indeed jobs, one at a time and slowly, from the
// site the page is on, as Indeed's own page does when a job is clicked. Stops
// at the first answer that isn't a job (Indeed asking who is there).
async function pageIndeedTexts(jks) {
  const out = {};
  const blockText = html => {
    const marked = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h[1-6]|ul|ol|tr)>/gi, m => m + '\n');
    const d = new DOMParser().parseFromString(marked, 'text/html');
    return (d.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  };
  for (const jk of (Array.isArray(jks) ? jks : []).slice(0, 15)) {
    if (!/^[0-9a-f]{12,20}$/i.test(jk)) continue;
    try {
      const r = await fetch('/viewjob?jk=' + jk, { credentials: 'same-origin' });
      if (!r.ok) break;
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const desc = doc.querySelector('#jobDescriptionText');
      if (!desc) break;
      const pay = doc.querySelector('#salaryInfoAndJobType');
      out[jk] = { description: blockText(desc.innerHTML).slice(0, 60000), pay: pay ? (pay.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '' };
    } catch (e) { break; }
    await new Promise(res => setTimeout(res, 1200 + Math.random() * 1200));
  }
  return out;
}
