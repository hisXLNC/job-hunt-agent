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
