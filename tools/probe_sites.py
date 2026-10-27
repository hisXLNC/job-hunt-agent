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

SITES = {
    "Robert Half (JSON)": [("POST", "https://www.roberthalf.com/bin/jobSearchServlet", {"country": "ca", "keywords": TITLE, "location": PLACE, "distance": "50", "remote": "Any", "emptype": "", "jobtype": "", "timetype": "", "postedwithin": "0", "sortby": "PUBLISHED_DATE_DESC", "pagesize": 25, "pagenumber": 1, "payrate_min": 0, "payrate_period": "", "source": ["Salesforce"]})],
    "Michael Page": [f"https://www.michaelpage.ca/jobs?search={q}&location={l}", f"https://www.michaelpage.ca/jobs/{slug(TITLE)}/{slug(CITY)}", f"https://www.michaelpage.ca/jobs/{slug(TITLE)}"],
    "Randstad": [f"https://www.randstad.ca/jobs/q-{slug(TITLE)}/l-{slug(CITY)}/", f"https://www.randstad.ca/jobs/q-{slug(TITLE)}/", f"https://www.randstad.ca/jobs/?q={q}&l={c}"],
    "Adecco": [f"https://www.adecco.ca/en-ca/jobs/job-search/?k={q}&l={l}", f"https://www.adecco.ca/en-ca/jobs?k={q}&l={c}", f"https://www.adecco.ca/en-ca/jobs/?keywords={q}&location={c}"],
    "Hays": [f"https://www.hays.ca/en-CA/job-search?q={q}&location={l}", f"https://www.hays.ca/en-CA/job-search/{slug(TITLE)}-jobs-in-{slug(CITY)}", f"https://www.hays.ca/job-search/{slug(TITLE)}-jobs"],
    "Aerotek": [f"https://jobs.aerotek.com/us/en/search-results?keywords={q}&location={l}", f"https://jobs.aerotek.com/ca/en/search-results?keywords={q}", f"https://www.aerotek.com/en-ca/job-search?keyword={q}"],
    "Altis": ["https://jobportal.altis.com/search?b=altisrecruitment", "https://altis.com/jobs/", "https://altis.com/find-a-job/"],
    "LRO Staffing": ["https://jobs.lrostaffing.com/job-listings/", "https://lrostaffing.com/jobs/", "https://lrostaffing.com/job-seekers/"],
    "People First HR": ["https://peoplefirsthr.com/jobs", "https://peoplefirsthr.com/jobs/", "https://peoplefirsthr.com/job-board/"],
    "Jobs.ca": [f"https://www.jobs.ca/jobs?q={q}&l={l}", f"https://www.jobs.ca/search/?keywords={q}&location={c}", f"https://www.jobs.ca/en/search/?keywords={q}&location={c}"],
    "Tech Talent Canada": [f"https://jobs.techtalent.ca/?q={q}", "https://jobs.techtalent.ca/", "https://techtalent.ca/jobs/"],
    "CIPS": ["https://cips.ca/jobs/", "https://cips.ca/careers/", "https://jobs.cips.ca/"],
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

def report(name, item):
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
    print(f"    job-ish links {len(hrefs)}: {hrefs[:12]}")
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
for name, items in SITES.items():
    print(name)
    for it in items:
        report(name, it)
if ALSO:
    print("Also")
    for u in ALSO:
        report("also", u)
