// The Send to Job Hunt button and browser extension share this: the bookmark carries its source,
// and the extension (static/extension) runs it in the tab and copies what it returns.
/** The Send to Job Hunt button: reads the posting on the page you're on and puts it on the clipboard
 *  (or, with `only`, returns it). */
function clipPage(only) {
  var M = 'JOBHUNT-CLIP:', job = null;
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    try {
      var d = JSON.parse(s.textContent), list = [].concat(d['@graph'] || d);
      list.forEach(function (x) { if (!job && x && [].concat(x['@type']).indexOf('JobPosting') >= 0) job = x; });
    } catch (e) {}
  });
  var t = function (x) { return (x == null ? '' : String(x)).trim(); };
  // Plain text from HTML without parsing it: sites like LinkedIn refuse HTML parsing from scripts.
  var plain = function (h) {
    return String(h || '').replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
  };
  var q = function (sels) { for (var i = 0; i < sels.length; i++) { var e = document.querySelector(sels[i]); if (e && t(e.innerText)) return t(e.innerText); } return ''; };
  var sel = t(getSelection());
  var c = { v: 1, url: location.href, title: '', company: '', location: '', text: '', structured: !!job };
  // LinkedIn signed in: the job open on the right of a search, or its own page. Job Hunt reads
  // the posting itself from its number, so the link matters most.
  var li = /linkedin\./.test(location.hostname) && (new URLSearchParams(location.search).get('currentJobId') || (location.pathname.match(/\/jobs\/view\/(?:[^\/]*-)?(\d{6,})/) || [])[1]);
  if (li && !job) {
    c.url = 'https://www.linkedin.com/jobs/view/' + li + '/';
    c.title = q(['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.t-24.t-bold', 'h1']);
    c.company = q(['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name']);
    c.text = sel || q(['.jobs-description__content', '#job-details', '.jobs-box__html-content', '.jobs-search__job-details--container', '.jobs-details']);
  }
  if (job) {
    c.title = t(job.title);
    c.company = t(job.hiringOrganization && job.hiringOrganization.name);
    var place = [].concat(job.jobLocation || [])[0], a = (place && place.address) || {};
    c.location = [a.addressLocality, a.addressRegion, a.addressCountry && a.addressCountry.name || a.addressCountry].filter(function (x) { return typeof x === 'string'; }).join(', ');
    c.text = t(plain(job.description));
    if (sel.length > 200) c.text = sel;
  } else if (!li) {
    var h = document.querySelector('h1');
    c.title = t(h && h.innerText) || document.title;
    c.text = sel || t((document.querySelector('main') || document.body).innerText);
  }
  if (li && c.text.length < 40) c.text = c.title || 'LinkedIn job ' + li;
  // LinkedIn, signed in: the people the posting lists under "Meet the hiring team" (who posted it,
  // who the role reports to), each with their name, headline and profile link.
  if (li) {
    var people = [], boxes = [];
    [].forEach.call(document.querySelectorAll('h2, h3, h4, [class*="hirer-card"], [class*="people-who-can-help"], [class*="jobs-poster"]'), function (h) {
      var cls = String(h.className || ''), own = /hirer-card|people-who-can-help|jobs-poster/.test(cls);
      if (!own && !/hiring team|people you can reach out to|job poster/i.test(t(h.innerText).slice(0, 80))) return;
      var box = own ? h : (h.closest('section, .artdeco-card, [class*="hirer"], [class*="people-who-can-help"]') || h.parentElement);
      if (box && boxes.indexOf(box) < 0) boxes.push(box);
    });
    var skip = /^(job poster|message|connect|follow|view profile|meet the hiring team|people you can reach out to|show more|show all|·|•)$|^[•·]?\s*(1st|2nd|3rd\+?|3rd)\b|mutual connection|degree connection|^\d+\+? (followers|connections)/i;
    boxes.forEach(function (box) {
      [].forEach.call(box.querySelectorAll('a[href*="/in/"]'), function (a) {
        var m = String(a.href).match(/linkedin\.com\/in\/([^\/?#]+)/);
        if (!m || people.length >= 4) return;
        var link = 'https://www.linkedin.com/in/' + m[1];
        if (people.some(function (p) { return p.link === link; })) return;
        // The smallest block around the link that names the person: their card.
        var card = a, lines = [];
        for (var up = 0; up < 5 && card.parentElement && card !== box; up++) {
          lines = t(card.innerText).split('\n').map(t).filter(function (x) { return x && !skip.test(x); });
          if (lines.length >= 2) break;
          card = card.parentElement;
        }
        var label = t(a.getAttribute('aria-label')).replace(/^view\s+/i, '').replace(/[’']s?\s+(verified\s+)?profile.*$/i, '');
        var name = t((lines[0] || label).replace(/\s*[\u2022\u00B7]?\s*\b(1st|2nd|3rd)\b\+?.*$/i, '').replace(/\s+(is verified|verified).*$/i, '')) || label;
        if (!name || name.length > 80 || !/[A-Za-z\u00C0-\u024F]/.test(name)) return;
        var role = lines.filter(function (x) { return x !== name && x.indexOf(name) < 0; })[0] || '';
        people.push({ name: name, role: role.slice(0, 160), link: link });
      });
    });
    if (people.length) c.people = people;
  }
  c.text = c.text.slice(0, 30000);
  var out = M + JSON.stringify(c);
  if (only) return out;
  var done = function () { alert('Sent to Job Hunt: ' + (c.title || document.title) + '\n\nJob Hunt picks it up in a few seconds.'); };
  var fallback = function () { var ta = document.createElement('textarea'); ta.value = out; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(out).then(done, fallback); else fallback();
}

/** The posts on the page you're on, for Job Hunt's leads: on LinkedIn (the feed, or a search of
 *  posts) each post with who wrote it; on any other page, the text you selected or the page's own
 *  text as one post. Returns { posts: [{author, headline, link, text, url}], many }. Job Hunt keeps
 *  only the ones where someone says they're hiring. */
function clipPosts() {
  var t = function (x) { return (x == null ? '' : String(x)).trim(); };
  var first = function (el, sels) { for (var i = 0; i < sels.length; i++) { var e = el.querySelector(sels[i]); if (e && t(e.innerText)) return e; } return null; };
  var line = function (e) { return e ? t(t(e.innerText).split('\n')[0]) : ''; };
  var posts = [], taken = [];
  var boxes = document.querySelectorAll('[data-urn^="urn:li:activity"], [data-urn^="urn:li:share"], [data-urn^="urn:li:ugcPost"], [data-id^="urn:li:activity"], [data-id^="urn:li:share"], [data-id^="urn:li:ugcPost"], .feed-shared-update-v2');
  [].forEach.call(boxes, function (box) {
    // A post inside one already read (LinkedIn nests the same post's boxes): once.
    if (taken.some(function (b) { return b.contains(box) || box.contains(b); })) return;
    var body = first(box, ['.update-components-text', '.feed-shared-update-v2__description', '.feed-shared-inline-show-more-text', '[class*="update-components-text"]', '[class*="commentary"]', '.break-words']);
    var text = t(body && body.innerText).replace(/\s*…\s*(see more|more)\s*$/i, '');
    if (text.length < 40) return;
    taken.push(box);
    var urn = box.getAttribute('data-urn') || box.getAttribute('data-id') || '';
    var a = box.querySelector('a[href*="/in/"]') || box.querySelector('a[href*="/company/"]');
    var m = a && String(a.href).match(/linkedin\.com\/(in|company)\/([^\/?#]+)/);
    var name = line(first(box, ['.update-components-actor__title span[aria-hidden="true"]', '.update-components-actor__title', '.update-components-actor__name', '[class*="actor__title"]', '[class*="actor__name"]']))
      || t(a && a.getAttribute('aria-label')).replace(/^view\s+/i, '').replace(/[’']s?\s+(verified\s+)?profile.*$/i, '');
    name = t(name.replace(/\s*[•·]\s*(1st|2nd|3rd\+?|Following|Follow).*$/i, '').replace(/\s+(is verified|verified).*$/i, ''));
    var headline = line(first(box, ['.update-components-actor__description span[aria-hidden="true"]', '.update-components-actor__description', '[class*="actor__description"]']));
    posts.push({ author: name.slice(0, 80), headline: headline.slice(0, 200), link: m ? 'https://www.linkedin.com/' + m[1] + '/' + m[2] : (a ? String(a.href).split('?')[0] : ''),
      text: text.slice(0, 6000), url: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : location.href.split('#')[0] + '#post-' + posts.length });
  });
  if (posts.length) return { posts: posts.slice(0, 60), many: true };
  // Any other page: what you selected, or what the page says.
  var sel = t(getSelection());
  var author = document.querySelector('meta[name="author"]');
  var text = sel.length >= 40 ? sel : t((document.querySelector('article') || document.querySelector('main') || document.body).innerText);
  return { posts: text.length >= 40 ? [{ author: t(author && author.content), headline: '', link: '', text: text.slice(0, 6000), url: location.href }] : [], many: false, title: document.title };
}
