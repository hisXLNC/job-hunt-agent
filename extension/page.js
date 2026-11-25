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
