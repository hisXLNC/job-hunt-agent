"""Read the recruiter and job sites the way Job Hunt does, and say what each answers.

    python tools/probe_sites.py ["Tax Manager"] ["Toronto, ON"]

For each address: the status, the size, whether a bot check stood in the way, and what the page
offers to read jobs from (JobPosting data, Phenom data, Next.js data, links that look like postings,
API addresses in its scripts). Run on GitHub (Actions -> Checks -> "sites") when sites stop working:
the cloud sessions here can't reach them. Extra addresses to try go in ALSO.
"""
import json, re, sys, urllib.parse, urllib.request, http.cookiejar, gzip, zlib

TITLE = sys.argv[1] if len(sys.argv) > 1 else "Tax Manager"
PLACE = sys.argv[2] if len(sys.argv) > 2 else "Toronto, ON"
CITY = PLACE.split(",")[0].strip()
q, l, c = (urllib.parse.quote_plus(x) for x in (TITLE, PLACE, CITY))
slug = lambda s: "-".join(w for w in re.split(r"[^a-z0-9]+", s.lower()) if w)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
HEAD = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-CA,en;q=0.9", "Accept-Encoding": "gzip, deflate"}

# name: (posting-link pattern, addresses to try)
SITES = {
    "Robert Half": (r"/job/|/jobs/[^?#]*\d{5,}", [f"https://www.roberthalf.com/ca/en/jobs?query={q}&location={c}", f"https://www.roberthalf.com/ca/en/jobs/all/{slug(CITY)}?query={q}", "https://www.roberthalf.com/ca/en/jobs"]),
    "Michael Page": (r"/job-detail/", [f"https://www.michaelpage.ca/jobs/accountant", f"https://www.michaelpage.ca/jobs/accountant/toronto", f"https://www.michaelpage.ca/jobs?search=accountant", f"https://www.michaelpage.ca/jobs/{slug(TITLE)}"]),
    "Randstad": (r"/jobs/[a-z0-9-]+_[a-z0-9-]+_\d+", [f"https://www.randstad.ca/jobs/q-{slug(TITLE)}/l-{slug(CITY)}/", "https://www.randstad.ca/jobs/q-accountant/l-toronto/"]),
    "Adecco": (r"/job/|/jobs/[^/?#]+/\d{4,}|/job-details?/", [f"https://www.adecco.com/en-ca/jobs?k={q}&l={c}", f"https://www.adecco.com/en-ca/job-seekers/find-a-job?k={q}&l={c}", f"https://www.adecco.com/en-ca/jobs/{slug(TITLE)}", "https://www.adecco.com/en-ca/job-seekers/find-a-job", "https://www.adecco.com/en-ca/jobs"]),
    "Hays": (r"/job-detail/", [f"https://www.hays.ca/job-search/{slug(TITLE)}-jobs", f"https://www.hays.ca/job-search/{slug(TITLE)}-jobs-in-{slug(CITY)}", "https://www.hays.ca/job-search/accountant-jobs-in-toronto", "https://www.hays.ca/job-search/accountant-jobs"]),
    "Aerotek": (r"/job/", [f"https://jobs.aerotek.com/us/en/search-results?keywords={q}"]),
    "Altis": (r"/jobs?/\d+", ["https://jobportal.altis.com/", f"https://jobportal.altis.com/search?keyword={q}"]),
    "LRO Staffing": (r"/job-post/", ["https://jobs.lrostaffing.com/job-listings/"]),
    "People First HR": (r"/jobs?/", ["https://peoplefirsthr.com/jobs"]),
    "Jobs.ca": (r"/job/|/jobs/", [f"https://www.jobs.ca/jobs?q={q}&l={l}"]),
    "Tech Talent Canada": (r"/j/", [f"https://jobs.techtalent.ca/?q={q}"]),
}
ALSO = sys.argv[3:]

def fetch(item):
    jar = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    if isinstance(item, tuple):
        _, url, body = item
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**HEAD, "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    else:
        url, req = item, urllib.request.Request(item, headers=HEAD)
    try:
        r = jar.open(req, timeout=30)
        status, final, hdr, raw = r.status, r.geturl(), r.headers, r.read()
    except urllib.error.HTTPError as e:
        status, final, hdr, raw = e.code, url, e.headers, e.read()
    except Exception as e:
        return url, None, url, {}, f"{type(e).__name__}: {e}"
    enc = (hdr.get("Content-Encoding") or "").lower()
    try:
        raw = gzip.decompress(raw) if enc == "gzip" else zlib.decompress(raw) if enc == "deflate" else raw
    except Exception:
        pass
    return url, status, final, hdr, raw.decode("utf-8", "replace")

def report(name, item, pattern=""):
    url, status, final, hdr, body = fetch(item)
    print(f"  {url}")
    if status is None:
        print(f"    FAILED {body}")
        return
    low = body.lower()
    bot = [w for w in ("cf-chl", "challenge-platform", "just a moment", "captcha", "akamai", "incapsula", "access denied", "px-captcha", "datadome") if w in low]
    print(f"    {status} {len(body):,} chars{'  -> ' + final if final != url else ''}  server={hdr.get('Server', '')!s:.30}{'  BOT: ' + ','.join(bot) if bot else ''}")
    if isinstance(item, tuple):
        try:
            v = json.loads(body)
            print(f"    json keys {list(v)[:8]}  jobs={len(v.get('jobs') or [])}")
        except Exception:
            print(f"    not json: {body[:200]!r}")
        return
    ld = len(re.findall(r'"@type"\s*:\s*"JobPosting"', body))
    phenom = '"eagerLoadRefineSearch"' in body
    nxt = "__NEXT_DATA__" in body
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
    print(f"    title={(title.group(1).strip() if title else '')[:70]!r}  JobPosting={ld}  phenom={phenom}  next={nxt}")
    hrefs = list(dict.fromkeys(h for h in re.findall(r'href\s*=\s*["\']([^"\'#]+)["\']', body) if re.search(r"(?i)job|career|position|vacanc|posting", h)))
    print(f"    job-ish links {len(hrefs)}: {hrefs[:6]}")
    if pattern:
        own = [h for h in re.findall(r'href\s*=\s*["\']([^"\'#]+)["\']', body) if re.search(pattern, h, re.I)]
        print(f"    POSTING LINKS ({pattern}) {len(set(own))}: {list(dict.fromkeys(own))[:5]}")
    apis = list(dict.fromkeys(re.findall(r'["\']((?:https?:)?//?[^"\'\s]*(?:api|graphql|search|jobs?)[^"\'\s]*\.?(?:json)?)["\']', body)))
    print(f"    api-ish strings: {[a for a in apis if len(a) < 140][:12]}")
    if nxt:
        m = re.search(r'(?s)<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body)
        if m:
            try:
                d = json.loads(m.group(1))
                print(f"    next pageProps keys: {list((d.get('props') or {}).get('pageProps', {}))[:12]}")
            except Exception:
                pass

print(f"Searching for {TITLE!r} in {PLACE!r}\n")
for name, (pattern, items) in SITES.items():
    print(name)
    for it in items:
        report(name, it, pattern)
if ALSO:
    print("Also")
    for u in ALSO:
        report("also", u)
