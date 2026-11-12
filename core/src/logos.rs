//! Company logos: each company's own icon, taken once from its own website and kept, so a list of
//! jobs shows who they are at a glance. No outside service: Job Hunt asks the company's site, the
//! way a browser does for the icon on a tab. A company whose own site Job Hunt doesn't know (its
//! jobs were only seen on a job board) keeps its letter.

use crate::pipeline::Agent;
use base64::Engine as _;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// Sites that host many companies' applications: their icon is theirs, not the company's.
const HOSTS_OF_MANY: &[&str] = &["myworkdayjobs.com", "myworkdaysite.com", "icims.com", "taleo.net", "greenhouse.io", "lever.co", "ashbyhq.com",
    "smartrecruiters.com", "workable.com", "bamboohr.com", "successfactors.", "oraclecloud.com", "ultipro.com", "adp.com", "jobvite.com", "breezy.hr",
    "recruitee.com", "teamtailor.com", "applytojob.com", "paylocity.com", "dayforcehcm.com", "csod.com", "eightfold.ai", "avature.net", "phenompeople.com",
    "jazz.co", "jazzhr.com", "njoyn.com", "hrmdirect.com", "pinpointhq.com", "rippling.com", "gusto.com", "freehire.", "apply.workable.com"];

/// The company's own site a link is on, without the part that names its careers pages
/// ("careers.bmo.com" is bmo.com's); None for a job board or a site that hosts many companies.
pub fn own_site(link: &str) -> Option<String> {
    let host = url::Url::parse(link).ok()?.host_str()?.to_lowercase();
    if host.is_empty() || !host.contains('.') || crate::sources::is_job_board(link) || HOSTS_OF_MANY.iter().any(|h| host.contains(h)) {
        return None;
    }
    let mut site = host.as_str();
    for p in ["www.", "careers.", "career.", "jobs.", "job.", "apply.", "recruiting.", "talent.", "join.", "work.", "emplois.", "carrieres.", "www."] {
        if let Some(rest) = site.strip_prefix(p).filter(|r| r.contains('.')) {
            site = rest;
        }
    }
    Some(site.to_string())
}

/// A company's name from its site's address, for a page that gave none: "Scotiabank" from
/// "https://jobs.scotiabank.com/job/1" (or from "jobs.scotiabank.com"). A job board's or a hosting
/// site's address gives its plain host, as before; None when it isn't an address.
pub fn name_from_site(link: &str) -> Option<String> {
    let link = if link.contains("://") { link.trim().to_string() } else { format!("https://{}", link.trim()) };
    let host = url::Url::parse(&link).ok()?.host_str()?.trim_start_matches("www.").to_lowercase();
    if !host.contains('.') {
        return None;
    }
    let Some(site) = own_site(&link) else { return Some(host) };
    let label = site.split('.').next().unwrap_or("");
    let mut c = label.chars();
    Some(match c.next() {
        // Short ones are initials (BMO, RBC); the rest read as a name.
        Some(f) if label.len() > 3 => f.to_uppercase().collect::<String>() + c.as_str(),
        _ => label.to_uppercase(),
    })
}

/// Companies that were named by a site's address ("jobs.scotiabank.com") get the name read from
/// it ("Scotiabank"), once: so they group, and share a logo, with the same company's other jobs.
pub fn name_hosts_once(agent: &Agent) {
    if !agent.secret("companies.named").is_empty() {
        return;
    }
    let jobs = agent.db().jobs(None, 5000).unwrap_or_default();
    for j in jobs {
        let c = j.company.trim();
        if c.contains('.') && !c.contains(' ') && own_site(&format!("https://{c}")).is_some() {
            if let Some(name) = name_from_site(c).filter(|n| n != c) {
                let _ = agent.db().rename_company(&j.id, &j.title, &name);
            }
        }
    }
    let _ = agent.db().set("companies.named", &crate::util::now());
}

/// Where a company's logo is kept. Two steps, so two spellings of one company ("Scotiabank" and
/// "jobs.scotiabank.com") share one logo: the company's site, then that site's image.
fn key(company: &str) -> String {
    format!("logo2:co:{}", crate::db::company_key(company))
}
fn site_key(site: &str) -> String {
    format!("logo2:site:{site}")
}

/// What's kept for a company: None when Job Hunt hasn't looked yet (or looked long ago and found
/// none); Some(None) when it looked lately and there's none; Some(the image) otherwise.
pub fn kept(agent: &Agent, company: &str) -> Option<Option<(String, Vec<u8>)>> {
    let saved = agent.secret(&key(company));
    let (kind, rest) = saved.split_once('|')?;
    if kind == "none" {
        // Looked and found none: look again after two weeks (its own site may be known by then).
        let fresh = chrono::DateTime::parse_from_rfc3339(rest).is_ok_and(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_days() < 14);
        return fresh.then_some(None);
    }
    let image = agent.secret(&site_key(rest));
    let (ctype, data) = image.split_once('|')?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).ok()?;
    Some(Some((ctype.to_string(), bytes)))
}

static WANTED: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// Look for a company's logo in the background (once at a time, never twice for the same company
/// at once) and keep what's found, or that nothing was.
pub fn want(agent: &Arc<Agent>, company: &str) {
    let k = key(company);
    if company.trim().is_empty() || !WANTED.lock().unwrap_or_else(|e| e.into_inner()).insert(k.clone()) {
        return;
    }
    let (a, company) = (agent.clone(), company.to_string());
    std::thread::spawn(move || {
        let _one = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let http = client();
        let mut value = format!("none|{}", crate::util::now());
        for (site, sure) in sites_for(&a, &company) {
            // A site another spelling of the company already led to: its image is here.
            if !a.secret(&site_key(&site)).is_empty() {
                value = format!("site|{site}");
                break;
            }
            if let Some((ctype, bytes)) = fetch_checked(&http, &format!("https://{site}"), &company, sure) {
                let _ = a.db().set(&site_key(&site), &format!("{ctype}|{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
                value = format!("site|{site}");
                break;
            }
        }
        let _ = a.db().set(&k, &value);
        WANTED.lock().unwrap_or_else(|e| e.into_inner()).remove(&k);
    });
}

/// The words of a company's name that tell it apart: no legal endings, no "bank" or "group".
fn name_words(company: &str) -> Vec<String> {
    const PLAIN: [&str; 30] = ["inc", "incorporated", "corp", "corporation", "ltd", "limited", "llc", "plc", "co", "company", "the", "group", "holdings", "of", "and", "canada", "bank",
        "financial", "services", "solutions", "technologies", "technology", "systems", "international", "global", "communications", "consulting", "partners", "lp", "llp"];
    company.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty() && !PLAIN.contains(w)).map(String::from).collect()
}

/// Whether a site's name is the company's: "scotiabank.com" for Scotiabank, "rbc.com" for Royal
/// Bank of Canada (its initials), "bmo.com" for BMO Financial Group.
fn site_is_named_for(site: &str, company: &str) -> bool {
    let label = site.split('.').next().unwrap_or("").replace('-', "");
    let all: Vec<String> = company.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect();
    let words = name_words(company);
    let initials: String = all.iter().filter(|w| !["of", "the", "and"].contains(&w.as_str())).filter_map(|w| w.chars().next()).collect();
    label.len() >= 2 && (words.iter().any(|w| w.len() >= 3 && (label.contains(w.as_str()) || (label.len() >= 4 && w.contains(&label)))) || words.concat() == label || (initials.len() >= 3 && initials.starts_with(&label) && label.len() >= 3))
}

/// The sites to try for a company, best first, each with whether its name alone says it's theirs
/// (else the home page has to name the company before its icon is taken): the company's name when
/// it is a site's address, the sites its jobs apply on, then likely addresses made from its name.
fn sites_for(agent: &Agent, company: &str) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = vec![];
    let mut add = |site: String, sure: bool| {
        if !site.is_empty() && !out.iter().any(|(s, _)| *s == site) {
            out.push((site, sure));
        }
    };
    // "jobs.scotiabank.com", kept as a company's name when a page gave none.
    let name = company.trim().to_lowercase();
    if name.contains('.') && !name.contains(' ') {
        if let Some(site) = own_site(&format!("https://{name}")) {
            add(site, true);
        }
    }
    let want = crate::db::company_key(company);
    let jobs = agent.db().jobs(None, 5000).unwrap_or_default();
    let mut from_jobs: Vec<String> = jobs.iter().filter(|j| crate::db::company_key(&j.company) == want)
        .flat_map(|j| [j.apply_url.as_deref().and_then(own_site), own_site(&j.url)]).flatten().collect();
    // A lead's company has no job, but its own site is often known.
    from_jobs.extend(crate::leads::all(agent).into_iter().filter(|l| crate::db::company_key(&l.company) == want && !l.site.is_empty()).map(|l| l.site));
    from_jobs.sort_by_key(|s| !site_is_named_for(s, company));
    for s in from_jobs {
        let sure = site_is_named_for(&s, company);
        add(s, sure);
    }
    // Likely addresses: the name's own words run together ("scotiabank", "rogers"), as .com and .ca.
    let words = name_words(company);
    let mut slugs = vec![words.concat()];
    if let Some(first) = words.first().filter(|w| w.len() >= 5 && words.len() > 1) {
        slugs.push(first.clone());
    }
    for slug in slugs.into_iter().filter(|s| s.len() >= 3 && s.is_ascii()) {
        for tld in ["com", "ca"] {
            add(format!("{slug}.{tld}"), false);
        }
    }
    out.truncate(6);
    out
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunt/1.0").build().expect("http client")
}

static TITLE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<title[^>]*>(.*?)</title>|<meta\b[^>]*(?:og:site_name|application-name)[^>]*>"#).unwrap());

/// Whether a home page says it's the company's: its title or site name has one of the words that
/// tell the company's name apart.
fn page_names(html: &str, company: &str) -> bool {
    let said: String = TITLE.find_iter(html).map(|m| m.as_str().to_lowercase()).collect::<Vec<_>>().join(" ");
    let said: Vec<&str> = said.split(|c: char| !c.is_alphanumeric()).collect();
    let words = name_words(company);
    words.iter().any(|w| w.len() >= 3 && said.contains(&w.as_str())) || (!words.is_empty() && said.join("").contains(&words.concat()))
}

/// A site's icon (see fetch_from), taken only when the site is the company's: its name says so
/// (`sure`), or its home page names the company. A guessed address that's someone else's gives none.
fn fetch_checked(http: &reqwest::blocking::Client, base: &str, company: &str, sure: bool) -> Option<(String, Vec<u8>)> {
    if !sure {
        let home = http.get(base).send().ok()?;
        if !home.status().is_success() {
            return None;
        }
        let html: String = home.text().unwrap_or_default().chars().take(400_000).collect();
        if !page_names(&html, company) {
            return None;
        }
    }
    fetch_from(http, base)
}

static LINK: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<link\b[^>]*>"#).unwrap());
static ATTR: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)\b(rel|href|sizes)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap());

/// The icon a site names for itself on its home page (the one a phone's home screen would use
/// first, else its largest), or the favicon at its root: (type, bytes). None when there's none or
/// it isn't an image of a sane size.
pub fn fetch_from(http: &reqwest::blocking::Client, base: &str) -> Option<(String, Vec<u8>)> {
    let home = http.get(base).send().ok()?;
    let at = home.url().clone();
    let html: String = home.text().unwrap_or_default().chars().take(400_000).collect();
    // (how good, link): a touch icon is square and big; then the largest icon named.
    let mut named: Vec<(u32, String)> = vec![];
    for tag in LINK.find_iter(&html) {
        let (mut rel, mut href, mut sizes) = (String::new(), String::new(), String::new());
        for c in ATTR.captures_iter(tag.as_str()) {
            let v = c.get(2).or(c.get(3)).or(c.get(4)).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            match c[1].to_lowercase().as_str() { "rel" => rel = v.to_lowercase(), "href" => href = v, _ => sizes = v }
        }
        if href.is_empty() || !rel.split_whitespace().any(|r| r == "icon" || r.starts_with("apple-touch-icon")) {
            continue;
        }
        let size = sizes.split(['x', 'X']).next().and_then(|n| n.trim().parse::<u32>().ok()).unwrap_or(0);
        named.push((if rel.contains("apple-touch-icon") { 1000 + size } else { size.max(1) }, href));
    }
    named.sort_by_key(|(good, _)| std::cmp::Reverse(*good));
    let mut tries: Vec<String> = named.into_iter().map(|(_, h)| h).take(3).collect();
    tries.push("/favicon.ico".into());
    for href in tries {
        let Ok(link) = at.join(&href) else { continue };
        if !matches!(link.scheme(), "http" | "https") {
            continue;
        }
        let Ok(r) = http.get(link.clone()).send() else { continue };
        if !r.status().is_success() {
            continue;
        }
        let header = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_lowercase();
        let path = link.path().to_lowercase();
        let ctype = if header.starts_with("image/") { header }
            else if path.ends_with(".png") { "image/png".into() } else if path.ends_with(".ico") { "image/x-icon".into() }
            else if path.ends_with(".svg") { "image/svg+xml".into() } else { continue };
        let Ok(bytes) = r.bytes() else { continue };
        if (64..=80_000).contains(&bytes.len()) {
            return Some((ctype, bytes.to_vec()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_companys_own_site() {
        assert_eq!(own_site("https://careers.bmo.com/jobs/1").as_deref(), Some("bmo.com"));
        assert_eq!(own_site("https://www.shopify.com/careers/x").as_deref(), Some("shopify.com"));
        assert_eq!(own_site("https://jobs.rbc.com/ca/en/job/1").as_deref(), Some("rbc.com"));
        // A job board, or a site that hosts many companies' applications: not theirs.
        for l in ["https://www.linkedin.com/jobs/view/1", "https://bmo.wd3.myworkdayjobs.com/External/job/1", "https://boards.greenhouse.io/acme/jobs/1", "https://jobs.lever.co/acme/1", "not a link"] {
            assert_eq!(own_site(l), None, "{l}");
        }
    }

    /// A stand-in for a company's site: answers each request with the next (type, body).
    fn serve(answers: Vec<(&'static str, Vec<u8>)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
        let h = std::thread::spawn(move || {
            let mut asked = vec![];
            for (ctype, body) in answers {
                let (mut c, _) = l.accept().unwrap();
                let mut buf = [0u8; 4096];
                let n = c.read(&mut buf).unwrap();
                asked.push(String::from_utf8_lossy(&buf[..n]).lines().next().unwrap_or("").to_string());
                write!(c, "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                c.write_all(&body).unwrap();
            }
            asked
        });
        (url, h)
    }

    #[test]
    fn the_icon_a_site_names_for_itself() {
        let png = vec![7u8; 900];
        let home = br#"<html><head><link rel="icon" href="/small.ico" sizes="16x16"><link href='/img/touch.png' rel='apple-touch-icon' sizes="180x180"></head></html>"#.to_vec();
        let (url, h) = serve(vec![("text/html", home), ("image/png", png.clone())]);
        let got = fetch_from(&client(), &url).unwrap();
        assert_eq!(got, ("image/png".to_string(), png));
        let asked = h.join().unwrap();
        assert!(asked[1].starts_with("GET /img/touch.png"), "the touch icon first: {asked:?}");
        // Nothing named, and what's at /favicon.ico isn't an image: none.
        let (url, h) = serve(vec![("text/html", b"<html></html>".to_vec()), ("text/html", b"<html>Not found</html>".to_vec())]);
        assert_eq!(fetch_from(&client(), &url), None);
        assert!(h.join().unwrap()[1].starts_with("GET /favicon.ico"));
    }

    #[test]
    fn kept_once_looked_for() {
        let s = crate::testkit::setup();
        assert_eq!(kept(&s.agent, "Acme Inc."), None, "not looked for yet");
        s.agent.db().set(&key("Acme Inc."), &format!("none|{}", crate::util::now())).unwrap();
        assert_eq!(kept(&s.agent, "ACME"), Some(None), "looked lately, none: the same company however it's written");
        // Its site, and that site's image: shared by every spelling that leads to the site.
        s.agent.db().set(&site_key("acme.com"), &format!("image/png|{}", base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3]))).unwrap();
        s.agent.db().set(&key("Acme"), "site|acme.com").unwrap();
        s.agent.db().set(&key("jobs.acme.com"), "site|acme.com").unwrap();
        assert_eq!(kept(&s.agent, "Acme Inc."), Some(Some(("image/png".to_string(), vec![1, 2, 3]))));
        assert_eq!(kept(&s.agent, "jobs.acme.com"), kept(&s.agent, "Acme"), "one company, one logo");
    }

    #[test]
    fn a_name_from_a_sites_address() {
        assert_eq!(name_from_site("https://jobs.scotiabank.com/job/Toronto/1").as_deref(), Some("Scotiabank"));
        assert_eq!(name_from_site("careers.bmo.com").as_deref(), Some("BMO"));
        assert_eq!(name_from_site("https://boards.greenhouse.io/acme/jobs/1").as_deref(), Some("boards.greenhouse.io"), "a hosting site: its address, as before");
        assert_eq!(name_from_site("not an address"), None);
        let s = crate::testkit::setup();
        let j = crate::db::Job { id: "x:1".into(), title: "Senior Delivery Manager".into(), company: "jobs.scotiabank.com".into(), url: "https://jobs.scotiabank.com/job/1".into(), status: "queued".into(), found_at: crate::util::now(), updated_at: crate::util::now(), ..Default::default() };
        s.agent.db().insert_job(&j).unwrap();
        name_hosts_once(&s.agent);
        assert_eq!(s.agent.db().job("x:1").unwrap().unwrap().company, "Scotiabank");
    }

    #[test]
    fn the_sites_to_try_for_a_company() {
        let s = crate::testkit::setup();
        // A site's address kept as the company's name: that site, and no checking needed.
        assert_eq!(sites_for(&s.agent, "jobs.scotiabank.com")[0], ("scotiabank.com".to_string(), true));
        // Seen only on a job board: likely addresses from its name, each to be checked.
        assert_eq!(sites_for(&s.agent, "Scotiabank"), vec![("scotiabank.com".to_string(), false), ("scotiabank.ca".to_string(), false)]);
        let rogers = sites_for(&s.agent, "Rogers Communications Inc.");
        assert!(rogers.contains(&("rogers.com".to_string(), false)), "{rogers:?}");
        // Where its jobs apply comes first; a site named for the company before one that isn't.
        for (id, url) in [("x:1", "https://careers.somewhere-else.io/job/1"), ("x:2", "https://jobs.rbc.com/ca/en/job/2")] {
            let j = crate::db::Job { id: id.into(), title: "Analyst".into(), company: "Royal Bank of Canada".into(), url: url.into(), status: "queued".into(), found_at: crate::util::now(), updated_at: crate::util::now(), ..Default::default() };
            s.agent.db().insert_job(&j).unwrap();
        }
        let rbc = sites_for(&s.agent, "Royal Bank of Canada");
        assert_eq!(rbc[0], ("rbc.com".to_string(), true), "its initials: {rbc:?}");
        assert_eq!(rbc[1], ("somewhere-else.io".to_string(), false), "not named for it: its home page has to say so");
        assert!(site_is_named_for("bmo.com", "BMO Financial Group") && site_is_named_for("mufgub.com", "MUFG") && !site_is_named_for("workopolis.com", "Scotiabank"));
        // A home page names the company in its title, or it isn't theirs.
        assert!(page_names("<html><head><title>Rogers: Wireless, Internet, TV</title></head></html>", "Rogers Communications Inc."));
        assert!(page_names(r#"<meta property="og:site_name" content="ScotiaBank">"#, "Scotiabank"));
        assert!(!page_names("<title>Domain for sale</title>", "Scotiabank"));
    }

    #[test]
    fn a_guessed_site_must_name_the_company() {
        let png = vec![7u8; 900];
        // Someone else's site at the guessed address: no icon is taken (and none is asked for).
        let (url, h) = serve(vec![("text/html", b"<html><head><title>Domain for sale</title></head></html>".to_vec())]);
        assert_eq!(fetch_checked(&client(), &url, "Scotiabank", false), None);
        assert_eq!(h.join().unwrap().len(), 1);
        // The company's: its home page says so, then its icon as usual.
        let home = br#"<html><head><title>Scotiabank Canada</title><link rel="icon" href="/i.png" sizes="64x64"></head></html>"#.to_vec();
        let (url, h) = serve(vec![("text/html", home.clone()), ("text/html", home), ("image/png", png.clone())]);
        assert_eq!(fetch_checked(&client(), &url, "Scotiabank", false), Some(("image/png".to_string(), png)));
        h.join().unwrap();
    }
}
