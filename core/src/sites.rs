//! Recruitment agencies' and job sites' own job listings: Robert Half, Michael Page, Randstad,
//! jobs.ca and the like, plus any site you add by its search address.
//!
//! None of these offer a feed for job seekers, so a site's search results page is read the way a
//! browser gets it, and postings are taken from it in the first way that works:
//!   1. the job-posting data sites put in their pages for Google (schema.org JobPosting, JSON-LD);
//!   2. the search data in careers sites built on Phenom (Aerotek and its sister companies);
//!   3. links that look like postings (the site's own pattern, or a general one).
//! A posting found as a link is read later from its own page, again from its JobPosting data when
//! it has some, or from the page's main text. Robert Half answers its own search as JSON.

use crate::sources::{find_apply_email, is_remote, salary_from_text, Posting};
use crate::util::{html_to_text, short_hash};
use base64::Engine;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

/// How a site is read.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum How {
    /// Its search page, read as above.
    Page,
    /// Robert Half's job search, which answers in JSON.
    RobertHalf,
}

/// A site Job Hunt knows. In `search`, {q} is the job title and {l} the place (both URL-encoded),
/// {qs}/{ls} the same as lower-case-hyphenated slugs, and {altis} Altis's encoded search. A search
/// without {q} is the site's whole list, read once per search.
pub struct Site {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: &'static str,
    /// The country its listings are in (its search pages are that country's).
    pub country: &'static str,
    pub about: &'static str,
    pub search: &'static str,
    /// Links to postings look like this (a regex on the address); empty: the general pattern.
    pub link: &'static str,
    pub how: How,
}

pub const SITES: &[Site] = &[
    Site { id: "roberthalf", name: "Robert Half", country: "ca", kind: "Agency", about: "Accounting, finance, tech, marketing and administrative roles.", search: "", link: "", how: How::RobertHalf },
    Site { id: "michaelpage", name: "Michael Page", country: "ca", kind: "Agency", about: "Professional and management roles.", search: "https://www.michaelpage.ca/jobs?search={q}&location={l}", link: r"/job-detail/", how: How::Page },
    Site { id: "randstad", name: "Randstad", country: "ca", kind: "Agency", about: "Office, customer service, industrial and professional roles.", search: "https://www.randstad.ca/jobs/q-{qs}/l-{ls}/", link: r"/jobs/[a-z0-9-]+_[a-z0-9-]+_\d+", how: How::Page },
    Site { id: "adecco", name: "Adecco", country: "ca", kind: "Agency", about: "Temporary and permanent jobs across industries.", search: "https://www.adecco.ca/en-ca/jobs/job-search/?k={q}&l={l}", link: r"/job/|/jobs/[^/?#]+/\d{4,}", how: How::Page },
    Site { id: "hays", name: "Hays", country: "ca", kind: "Agency", about: "Specialist roles in tech, construction, finance and more.", search: "https://www.hays.ca/en-CA/job-search?q={q}&location={l}", link: r"/job-detail/|/jobs?/[^?#]*\d{5,}", how: How::Page },
    Site { id: "aerotek", name: "Aerotek", country: "us", kind: "Agency", about: "Industrial, manufacturing and skilled trades roles.", search: "https://jobs.aerotek.com/us/en/search-results?keywords={q}&location={l}", link: r"/job/", how: How::Page },
    Site { id: "aplin", name: "Aplin", country: "ca", kind: "Agency", about: "Professional, contract and permanent roles across Canada.", search: "https://www.aplin.com/jobs/?search={q}", link: "", how: How::Page },
    Site { id: "altis", name: "Altis Recruitment", country: "ca", kind: "Agency", about: "Administrative, customer service, marketing, finance and project roles.", search: "https://jobportal.altis.com/search?b=altisrecruitment&search={altis}", link: r"/jobs/\d+/", how: How::Page },
    Site { id: "lro", name: "LRO Staffing", country: "ca", kind: "Agency", about: "Professional, administrative and government-related roles, especially in Ottawa.", search: "https://jobs.lrostaffing.com/job-listings/", link: r"/job-post/", how: How::Page },
    Site { id: "locksearch", name: "Lock Search Group", country: "ca", kind: "Agency", about: "Specialized professional and senior roles.", search: "https://www.locksearchgroup.com/opportunities/", link: r"/(?:job|opportunit(?:y|ies))/[a-z0-9-]{8,}", how: How::Page },
    Site { id: "peoplefirst", name: "People First HR", country: "ca", kind: "Agency", about: "Professional recruitment and executive roles, mostly in Manitoba.", search: "https://peoplefirsthr.com/jobs", link: "", how: How::Page },
    Site { id: "jobsca", name: "Jobs.ca", country: "ca", kind: "Job site", about: "Canada's Jobs.ca network: also covers healthcarejobs.ca, techjobs.ca, itjobs.ca and salesrep.ca.", search: "https://www.jobs.ca/jobs?q={q}&l={l}", link: "", how: How::Page },
    Site { id: "techtalent", name: "Tech Talent Canada", country: "ca", kind: "Job site", about: "Canadian tech roles.", search: "https://jobs.techtalent.ca/?q={q}", link: r"/j/[a-z0-9-]+-[0-9a-f]{8,}", how: How::Page },
    Site { id: "cips", name: "CIPS job board", country: "ca", kind: "Job site", about: "IT roles from Canada's IT professional association.", search: "https://cips.ca/jobs/", link: r"/jobs?/[a-z0-9-]{8,}/?$", how: How::Page },
];

/// A job site you added: its name and its search address, with {title} and {place} where the
/// job title and place go (or neither, for a page that lists all its jobs).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct CustomSite {
    pub name: String,
    pub url: String,
}

/// A site to read: a known one, or one you added (as a site with your address).
pub struct Target {
    pub id: String,
    pub name: String,
    pub search: String,
    pub link: String,
    pub how: How,
}

impl CustomSite {
    pub fn id(&self) -> String {
        format!("site-{}", short_hash(&self.url))
    }
}

/// The sites you turned on, known and your own.
pub fn targets(on: &[String], custom: &[CustomSite]) -> Vec<Target> {
    let mut out: Vec<Target> = SITES.iter().filter(|s| on.iter().any(|x| x == s.id))
        .map(|s| Target { id: s.id.into(), name: s.name.into(), search: s.search.into(), link: s.link.into(), how: s.how })
        .collect();
    out.extend(custom.iter().filter(|c| c.url.starts_with("http")).map(|c| Target {
        id: c.id(),
        name: if c.name.trim().is_empty() { url::Url::parse(&c.url).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_else(|| "Your site".into()) } else { c.name.trim().to_string() },
        search: c.url.replace("{title}", "{q}").replace("{place}", "{l}"),
        link: String::new(),
        how: How::Page,
    }));
    out
}

/// Whether a source name belongs to a job site here (known or yours).
pub fn is_site_source(source: &str) -> bool {
    source.starts_with("site-") || SITES.iter().any(|s| s.id == source)
}

fn slug(s: &str) -> String {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join("-")
}

/// A site's search address for a title and place.
pub fn search_url(t: &Target, title: &str, place: &str) -> String {
    let enc = |s: &str| url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>();
    let city = place.split(',').next().unwrap_or(place).trim();
    let altis = || {
        let q = json!({ "Keyword": title, "JobTypeIds": [], "IndustryIds": [], "Specializations": [], "Locations": if place.is_empty() { json!([]) } else { json!([place]) } });
        base64::engine::general_purpose::STANDARD.encode(q.to_string())
    };
    let mut u = t.search.replace("{q}", &enc(title)).replace("{l}", &enc(place)).replace("{qs}", &slug(title)).replace("{ls}", &slug(city));
    if u.contains("{altis}") {
        u = u.replace("{altis}", &enc(&altis()));
    }
    u
}

/// The searches for a site: a few titles in your first place, or once for a whole list.
pub fn searches_for(t: &Target, titles_places: &[(String, String)]) -> Vec<(String, String)> {
    if t.how == How::RobertHalf || t.search.contains("{q}") || t.search.contains("{qs}") || t.search.contains("{altis}") {
        titles_places.iter().take(3).cloned().collect()
    } else {
        vec![(String::new(), String::new())]
    }
}

fn get(c: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    std::thread::sleep(Duration::from_millis(1500));
    let r = c.get(url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en;q=0.9")
        .send().map_err(|e| format!("couldn't connect ({e})"))?;
    match r.status().as_u16() {
        200 => r.text().map_err(|e| format!("unreadable page ({e})")),
        404 | 410 => Err("not found: the site's search address may have changed".into()),
        403 | 429 | 503 => Err("the site turned the request away (it may block automated reading)".into()),
        s => Err(format!("the site said {s}")),
    }
}

// --- reading postings from a page ---------------------------------------------------------------

/// Every schema.org JobPosting in a page's JSON-LD (alone, in a list, or in a @graph).
fn json_ld_postings(html: &str) -> Vec<Value> {
    static LD: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<script[^>]*application/ld\+json[^>]*>(.*?)</script>"#).unwrap());
    fn walk(v: &Value, out: &mut Vec<Value>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => {
                let t = o.get("@type").map(|t| t.to_string()).unwrap_or_default();
                if t.contains("JobPosting") {
                    out.push(v.clone());
                    return;
                }
                for k in ["@graph", "itemListElement", "item", "mainEntity"] {
                    if let Some(x) = o.get(k) {
                        walk(x, out);
                    }
                }
            }
            _ => {}
        }
    }
    let mut out = vec![];
    for m in LD.captures_iter(html) {
        if let Ok(v) = serde_json::from_str::<Value>(m[1].trim()) {
            walk(&v, &mut out);
        }
    }
    out
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.trim().to_string(),
        Value::Object(o) => o.get("name").map(text).unwrap_or_default(),
        Value::Array(a) => a.iter().map(text).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("; "),
        _ => String::new(),
    }
}

/// A JobPosting's place: "City, Province", or remote.
fn ld_place(j: &Value) -> (String, bool) {
    let remote = j["jobLocationType"].as_str().is_some_and(|t| t.contains("TELECOMMUTE"));
    let locs = match &j["jobLocation"] { Value::Array(a) => a.clone(), Value::Null => vec![], v => vec![v.clone()] };
    let place = locs.iter().map(|l| {
        let a = &l["address"];
        if a.is_string() {
            return text(a);
        }
        [text(&a["addressLocality"]), text(&a["addressRegion"])].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ")
    }).find(|s| !s.is_empty()).unwrap_or_default();
    (if place.is_empty() && remote { "Remote".into() } else { place }, remote)
}

/// A JobPosting's pay, as text and its yearly top.
fn ld_pay(j: &Value) -> Option<(String, Option<f64>)> {
    let b = &j["baseSalary"];
    let v = &b["value"];
    let (min, max) = (v["minValue"].as_f64().or(v["value"].as_f64()), v["maxValue"].as_f64().or(v["value"].as_f64()));
    let unit = v["unitText"].as_str().unwrap_or("").to_uppercase();
    let max = max?;
    let money = |x: f64| format!("${}", crate::util::thousands(x.round() as i64));
    let t = match min.filter(|m| *m != max) { Some(m) => format!("{}–{}", money(m), money(max)), None => money(max) };
    if unit == "HOUR" { Some((format!("{t}/hour"), None)) } else { Some((t, Some(max))) }
}

fn id_from_url(u: &str) -> String {
    static NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d{4,})(?:[/?#]|$|\D*$)").unwrap());
    let path = url::Url::parse(u).map(|x| x.path().to_string()).unwrap_or_else(|_| u.to_string());
    NUM.captures(&path).map(|m| m[1].to_string()).unwrap_or_else(|| short_hash(&path))
}

fn from_ld(t: &Target, j: &Value, base: &url::Url) -> Option<Posting> {
    let title = html_to_text(&text(&j["title"]));
    let link = text(&j["url"]);
    let link = if link.is_empty() { base.to_string() } else { base.join(&link).map(|u| u.to_string()).unwrap_or(link) };
    if title.is_empty() {
        return None;
    }
    let (place, remote) = ld_place(j);
    let description = html_to_text(&text(&j["description"]));
    let pay = ld_pay(j).or_else(|| salary_from_text(&description));
    let own_id = text(&j["identifier"]["value"]);
    Some(Posting {
        source: t.id.clone(),
        external_id: if own_id.is_empty() { id_from_url(&link) } else { own_id },
        company: Some(text(&j["hiringOrganization"])).filter(|c| !c.is_empty()).unwrap_or_else(|| t.name.clone()),
        remote: remote || is_remote(&[&place, &title]),
        title,
        location: place,
        apply_email: find_apply_email(&description),
        description,
        url: link,
        posted_at: Some(text(&j["datePosted"])).filter(|d| !d.is_empty()).map(|d| d.chars().take(25).collect()),
        salary_max: pay.as_ref().and_then(|p| p.1),
        salary: pay.map(|p| p.0),
    })
}

/// The jobs in a Phenom careers page's own search data ("eagerLoadRefineSearch").
fn phenom_jobs(t: &Target, html: &str, base: &url::Url) -> Vec<Posting> {
    let Some(at) = html.find("\"eagerLoadRefineSearch\"") else { return vec![] };
    let Some(start) = html[at..].find("\"jobs\":[").map(|i| at + i + 7) else { return vec![] };
    let Some(Ok(Value::Array(jobs))) = serde_json::Deserializer::from_str(&html[start..]).into_iter::<Value>().next() else { return vec![] };
    let site = base.path().split('/').filter(|s| !s.is_empty()).take(2).collect::<Vec<_>>().join("/");
    jobs.iter().filter_map(|j| {
        let title = text(&j["title"]);
        let id = [&j["jobId"], &j["reqId"], &j["jobSeqNo"]].iter().map(|v| text(v)).find(|s| !s.is_empty())?;
        if title.is_empty() {
            return None;
        }
        let place = Some(text(&j["cityStateCountry"])).filter(|s| !s.is_empty()).unwrap_or_else(|| text(&j["location"]));
        let teaser = html_to_text(&text(&j["descriptionTeaser"]));
        let pay = salary_from_text(&teaser);
        Some(Posting {
            source: t.id.clone(),
            external_id: id.clone(),
            company: t.name.clone(),
            remote: is_remote(&[&place, &title]),
            url: base.join(&format!("/{site}/job/{id}")).map(|u| u.to_string()).unwrap_or_default(),
            title,
            location: place,
            description: String::new(),
            posted_at: Some(text(&j["postedDate"])).filter(|d| !d.is_empty()).or_else(|| Some(text(&j["dateCreated"])).filter(|d| !d.is_empty())),
            salary_max: pay.as_ref().and_then(|p| p.1),
            salary: pay.map(|p| p.0),
            apply_email: None,
        })
    }).collect()
}

/// Links that look like postings: the site's pattern, or (without one) a link into a jobs path that
/// ends in an id or a long slug, with a title-like text.
fn linked_jobs(t: &Target, html: &str, base: &url::Url, place: &str) -> Vec<Posting> {
    static A: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>(.*?)</a>"#).unwrap());
    static GENERAL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)/(?:jobs?|careers?|opportunit(?:y|ies)|postings?|vacanc(?:y|ies)|positions?)/(?:[^?#]*\d{4,}|[a-z0-9]+(?:-[a-z0-9]+){2,})").unwrap());
    static NOT_TITLES: &[&str] = &["apply", "apply now", "view job", "view details", "read more", "learn more", "more", "details", "jobs", "all jobs", "search jobs", "next", "previous", "share", "save"];
    let own = (!t.link.is_empty()).then(|| Regex::new(&format!("(?i){}", t.link)).ok()).flatten();
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for m in A.captures_iter(html) {
        let Ok(href) = base.join(m[1].trim()) else { continue };
        if !["http", "https"].contains(&href.scheme()) || href.host_str() != base.host_str() && own.is_none() {
            continue;
        }
        let path = href.path();
        let fits = match &own { Some(r) => r.is_match(href.as_str()), None => GENERAL.is_match(path) };
        let title = html_to_text(&m[2]).split_whitespace().collect::<Vec<_>>().join(" ");
        let words = title.split(' ').count();
        if !fits || !(2..=16).contains(&words) && !(own.is_some() && words >= 1) || NOT_TITLES.contains(&title.to_lowercase().as_str()) || title.len() > 140 {
            continue;
        }
        let key = format!("{}{}", href.host_str().unwrap_or(""), path.trim_end_matches('/'));
        if !seen.insert(key) {
            continue;
        }
        out.push(Posting {
            source: t.id.clone(),
            external_id: id_from_url(href.as_str()),
            company: t.name.clone(),
            remote: is_remote(&[&title]),
            title,
            // Where it was searched for, until its page says.
            location: place.to_string(),
            url: href.to_string(),
            ..Posting::default()
        });
    }
    out
}

/// The postings on a site's search results page.
pub fn parse_page(t: &Target, html: &str, page_url: &str, place: &str) -> Vec<Posting> {
    let Ok(base) = url::Url::parse(page_url) else { return vec![] };
    let ld: Vec<Posting> = json_ld_postings(html).iter().filter_map(|j| from_ld(t, j, &base)).collect();
    if !ld.is_empty() {
        return ld;
    }
    let ph = phenom_jobs(t, html, &base);
    if !ph.is_empty() {
        return ph;
    }
    linked_jobs(t, html, &base, place)
}

/// One search on a site.
pub fn search(c: &reqwest::blocking::Client, t: &Target, title: &str, place: &str) -> Result<Vec<Posting>, String> {
    if t.how == How::RobertHalf {
        return robert_half(c, t, title, place);
    }
    let url = search_url(t, title, place);
    let html = get(c, &url)?;
    let list = parse_page(t, &html, &url, place);
    if list.is_empty() && html.len() < 20_000 && (html.contains("id=\"root\"") || html.contains("id=\"app\"") || html.contains("__NEXT_DATA__") || html.contains("ng-app")) {
        return Err("the page lists its jobs only in a web browser, so Job Hunt can't read them".into());
    }
    Ok(list)
}

/// The text of a posting found as a link: its JobPosting data, or the page's main text.
pub fn parse_posting_page(html: &str) -> Option<(String, Option<Value>)> {
    if let Some(j) = json_ld_postings(html).into_iter().next() {
        let d = html_to_text(&text(&j["description"]));
        if d.len() > 60 {
            return Some((d, Some(j)));
        }
    }
    static MAIN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<(main|article)\b[^>]*>(.*)</(?:main|article)>").unwrap());
    static BODY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<body\b[^>]*>(.*)</body>").unwrap());
    static JUNK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<(script|style|nav|header|footer|noscript|svg|form)\b.*?</(?:script|style|nav|header|footer|noscript|svg|form)>").unwrap());
    let part = MAIN.captures(html).map(|m| m[2].to_string()).or_else(|| BODY.captures(html).map(|m| m[1].to_string()))?;
    let t: String = html_to_text(&JUNK.replace_all(&part, "")).chars().take(8000).collect();
    (t.len() > 200).then_some((t, None))
}

/// Fill in the text of new postings found as links, at most `max`, a couple of seconds apart.
pub fn details(c: &reqwest::blocking::Client, postings: &mut [&mut Posting], max: usize) -> usize {
    let mut n = 0;
    let until = std::time::Instant::now() + Duration::from_secs(150);
    for p in postings.iter_mut().take(max) {
        if std::time::Instant::now() > until {
            break;
        }
        let Ok(html) = get(c, &p.url) else { continue };
        let Some((d, ld)) = parse_posting_page(&html) else { continue };
        if let Some(j) = ld {
            let (place, remote) = ld_place(&j);
            if !place.is_empty() {
                p.location = place;
            }
            p.remote |= remote;
            if let Some(c) = Some(text(&j["hiringOrganization"])).filter(|c| !c.is_empty()) {
                p.company = c;
            }
            if p.posted_at.is_none() {
                p.posted_at = Some(text(&j["datePosted"])).filter(|d| !d.is_empty());
            }
            if let Some((t, max)) = ld_pay(&j) {
                p.salary = Some(t);
                p.salary_max = max;
            }
        }
        if p.salary.is_none() {
            if let Some((t, max)) = salary_from_text(&d) {
                p.salary = Some(t);
                p.salary_max = max;
            }
        }
        p.apply_email = find_apply_email(&d);
        p.description = d;
        n += 1;
    }
    n
}

// --- Robert Half ------------------------------------------------------------------------------

/// Robert Half's own job search (what its jobs page asks), in Canada.
fn robert_half(c: &reqwest::blocking::Client, t: &Target, title: &str, place: &str) -> Result<Vec<Posting>, String> {
    std::thread::sleep(Duration::from_millis(1500));
    let body = json!({ "country": "ca", "keywords": title, "location": place, "distance": "50", "remote": "Any", "emptype": "", "jobtype": "", "timetype": "",
        "postedwithin": "0", "sortby": "PUBLISHED_DATE_DESC", "pagesize": 25, "pagenumber": 1, "payrate_min": 0, "payrate_period": "", "source": ["Salesforce"] });
    let r = c.post("https://www.roberthalf.com/bin/jobSearchServlet")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .json(&body).send().map_err(|e| format!("couldn't connect ({e})"))?;
    if !r.status().is_success() {
        return Err(format!("Robert Half said {}", r.status()));
    }
    let v: Value = r.json().map_err(|e| format!("unexpected answer ({e})"))?;
    Ok(parse_robert_half(t, &v))
}

pub fn parse_robert_half(t: &Target, v: &Value) -> Vec<Posting> {
    v["jobs"].as_array().into_iter().flatten().filter_map(|j| {
        let title = text(&j["jobtitle"]);
        let id = text(&j["unique_job_number"]);
        if title.is_empty() || id.is_empty() {
            return None;
        }
        let place = [text(&j["city"]), text(&j["stateprovince"])].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ");
        let description = html_to_text(&text(&j["description"]));
        let (lo, hi) = (j["payrate_min"].as_f64().or_else(|| text(&j["payrate_min"]).parse().ok()), j["payrate_max"].as_f64().or_else(|| text(&j["payrate_max"]).parse().ok()));
        let hourly = text(&j["payrate_period"]).to_lowercase().contains("hour");
        let pay = hi.filter(|h| *h > 0.0).map(|h| {
            let m = |x: f64| format!("${}", crate::util::thousands(x.round() as i64));
            let t = match lo.filter(|l| *l > 0.0 && *l != h) { Some(l) => format!("{}–{}", m(l), m(h)), None => m(h) };
            if hourly { (format!("{t}/hour"), None) } else { (t, Some(h)) }
        }).or_else(|| salary_from_text(&description));
        let remote = text(&j["remote"]).eq_ignore_ascii_case("yes") || is_remote(&[&place, &title]);
        Some(Posting {
            source: t.id.clone(),
            external_id: id,
            company: "Robert Half (client not named)".into(),
            remote,
            title,
            location: place,
            url: text(&j["job_detail_url"]),
            apply_email: None,
            posted_at: Some(text(&j["date_posted"])).filter(|d| !d.is_empty()),
            salary_max: pay.as_ref().and_then(|p| p.1),
            salary: pay.map(|p| p.0),
            description,
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site(id: &str) -> Target {
        targets(&[id.to_string()], &[]).pop().unwrap()
    }

    #[test]
    fn search_addresses() {
        assert_eq!(search_url(&site("michaelpage"), "Tax Manager", "Toronto, ON"), "https://www.michaelpage.ca/jobs?search=Tax+Manager&location=Toronto%2C+ON");
        assert_eq!(search_url(&site("randstad"), "Tax Manager", "Toronto, ON"), "https://www.randstad.ca/jobs/q-tax-manager/l-toronto/");
        let altis = search_url(&site("altis"), "Tax Manager", "Toronto, ON");
        let enc = altis.split("search=").nth(1).unwrap();
        let raw: String = url::form_urlencoded::parse(format!("x={enc}").as_bytes()).next().unwrap().1.into();
        let q: Value = serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(raw).unwrap()).unwrap();
        assert_eq!((q["Keyword"].as_str(), q["Locations"][0].as_str()), (Some("Tax Manager"), Some("Toronto, ON")));
        // A whole-list page is read once; a search page for a few titles.
        let tp = vec![("A".to_string(), "Toronto, ON".to_string()), ("B".into(), "Toronto, ON".into()), ("C".into(), "x".into()), ("D".into(), "y".into())];
        assert_eq!(searches_for(&site("lro"), &tp).len(), 1);
        assert_eq!(searches_for(&site("michaelpage"), &tp).len(), 3);
        let mine = targets(&[], &[CustomSite { name: "".into(), url: "https://careers.example.org/search?kw={title}&where={place}".into() }]);
        assert_eq!(mine[0].name, "careers.example.org");
        assert_eq!(search_url(&mine[0], "Tax Manager", "Toronto, ON"), "https://careers.example.org/search?kw=Tax+Manager&where=Toronto%2C+ON");
        assert!(is_site_source(&mine[0].id) && is_site_source("hays") && !is_site_source("linkedin"));
    }

    #[test]
    fn postings_from_json_ld_phenom_and_links() {
        let t = site("jobsca");
        let ld = r#"<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
          {"@type":"ListItem","position":1,"item":{"@type":"JobPosting","title":"Senior Tax Analyst","url":"/job/12345678/senior-tax-analyst","datePosted":"2026-10-18",
           "hiringOrganization":{"@type":"Organization","name":"Maple Bank"},"jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Toronto","addressRegion":"ON"}},
           "baseSalary":{"@type":"MonetaryAmount","currency":"CAD","value":{"@type":"QuantitativeValue","minValue":90000,"maxValue":110000,"unitText":"YEAR"}},
           "description":"<p>Own indirect tax filings.</p>"}}]}</script></html>"#;
        let l = parse_page(&t, ld, "https://www.jobs.ca/jobs?q=tax", "Toronto, ON");
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].id().as_str(), l[0].company.as_str(), l[0].location.as_str()), ("jobsca:12345678", "Maple Bank", "Toronto, ON"));
        assert_eq!((l[0].url.as_str(), l[0].salary_max, l[0].description.as_str()), ("https://www.jobs.ca/job/12345678/senior-tax-analyst", Some(110000.0), "Own indirect tax filings."));

        let a = site("aerotek");
        let ph = r#"<script>phApp.ddo = {"eagerLoadRefineSearch":{"status":200,"hits":2,"data":{"jobs":[
          {"jobId":"JP-005123456","title":"Maintenance Technician","cityStateCountry":"Mississauga, Ontario, Canada","postedDate":"2026-10-17T00:00:00.000+0000","descriptionTeaser":"Pay: $28 - $32 per hour"},
          {"reqId":"JP-005123457","title":"Quality Inspector","location":"Brampton, Ontario"}],"aggregations":[]}}};</script>"#;
        let l = parse_page(&a, ph, "https://jobs.aerotek.com/us/en/search-results?keywords=x", "");
        assert_eq!(l.len(), 2);
        assert_eq!((l[0].external_id.as_str(), l[0].url.as_str(), l[0].salary.as_deref()), ("JP-005123456", "https://jobs.aerotek.com/us/en/job/JP-005123456", Some("$28–$32/hour")));

        let lro = site("lro");
        let links = r#"<nav><a href="/job-listings/">Jobs</a><a href="/about">About us</a></nav>
          <div class="job"><a href="https://jobs.lrostaffing.com/job-post/Project-Administrator-Intermediate-Contract-18375">Project Administrator (Intermediate)</a> <a href="/job-post/Project-Administrator-Intermediate-Contract-18375">Apply</a></div>
          <div class="job"><a href="/job-post/Senior-Business-Analyst-Permanent-18390">Senior Business Analyst</a></div>"#;
        let l = parse_page(&lro, links, "https://jobs.lrostaffing.com/job-listings/", "Ottawa, ON");
        assert_eq!(l.iter().map(|p| (p.title.as_str(), p.external_id.as_str(), p.location.as_str())).collect::<Vec<_>>(),
            vec![("Project Administrator (Intermediate)", "18375", "Ottawa, ON"), ("Senior Business Analyst", "18390", "Ottawa, ON")]);
        // The general pattern, for a site without its own.
        let ap = site("aplin");
        let gen = r#"<a href="/jobs/">All jobs</a><a href="/jobs/senior-payroll-specialist-calgary/">Senior Payroll Specialist</a><a href="/contact/">Contact</a><a href="https://other.example/jobs/x-y-z">Elsewhere</a>"#;
        let l = parse_page(&ap, gen, "https://www.aplin.com/jobs/?search=payroll", "");
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].url, "https://www.aplin.com/jobs/senior-payroll-specialist-calgary/");
    }

    #[test]
    fn posting_pages_and_robert_half() {
        let page = r#"<html><body><header>Menu</header><main><h1>Senior Payroll Specialist</h1><p>Our client, a Calgary energy company, is hiring a Senior Payroll Specialist to run bi-weekly payroll for 1,200 employees across Alberta and BC. You'll reconcile, report and improve processes.</p><p>Salary $80,000 - $90,000. Email resumes to jobs@aplin.example</p></main><footer>© Aplin</footer></body></html>"#;
        let (d, ld) = parse_posting_page(page).unwrap();
        assert!(ld.is_none() && d.contains("bi-weekly payroll") && !d.contains("Menu") && !d.contains("© Aplin"));
        let rh = json!({ "found": 1, "jobs": [{ "unique_job_number": "03720-0013141339-cauen", "jobtitle": "Senior Accountant", "city": "Toronto", "stateprovince": "ON",
            "job_detail_url": "https://www.roberthalf.com/ca/en/job/toronto-on/senior-accountant/03720-0013141339-cauen", "description": "<p>Month-end close.</p>",
            "date_posted": "2026-10-17T14:00:00Z", "payrate_min": "75000", "payrate_max": "85000", "payrate_period": "Yearly", "remote": "No" }] });
        let l = parse_robert_half(&site("roberthalf"), &rh);
        assert_eq!((l[0].location.as_str(), l[0].salary.as_deref(), l[0].salary_max), ("Toronto, ON", Some("$75,000–$85,000"), Some(85000.0)));
        assert_eq!(l[0].description, "Month-end close.");
    }
}
