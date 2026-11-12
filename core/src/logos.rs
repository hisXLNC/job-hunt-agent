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

fn key(company: &str) -> String {
    format!("logo:{}", crate::db::company_key(company))
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
    let bytes = base64::engine::general_purpose::STANDARD.decode(rest).ok()?;
    Some(Some((kind.to_string(), bytes)))
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
        let found = site_of(&a, &company).and_then(|site| fetch_from(&client(), &format!("https://{site}")));
        let value = match found {
            Some((ctype, bytes)) => format!("{ctype}|{}", base64::engine::general_purpose::STANDARD.encode(bytes)),
            None => format!("none|{}", crate::util::now()),
        };
        let _ = a.db().set(&k, &value);
        WANTED.lock().unwrap_or_else(|e| e.into_inner()).remove(&k);
    });
}

/// The company's own site, from where its jobs apply (or were found).
fn site_of(agent: &Agent, company: &str) -> Option<String> {
    let want = crate::db::company_key(company);
    let jobs = agent.db().jobs(None, 5000).ok()?;
    jobs.iter().filter(|j| crate::db::company_key(&j.company) == want)
        .find_map(|j| j.apply_url.as_deref().and_then(own_site).or_else(|| own_site(&j.url)))
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(12))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) JobHunt/1.0").build().expect("http client")
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
        s.agent.db().set(&key("Acme"), &format!("image/png|{}", base64::engine::general_purpose::STANDARD.encode([1u8, 2, 3]))).unwrap();
        assert_eq!(kept(&s.agent, "Acme Inc."), Some(Some(("image/png".to_string(), vec![1, 2, 3]))));
    }
}
