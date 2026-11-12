//! Leads: companies worth writing to directly, before or instead of applying to a posting. Two
//! kinds: someone saying in their own post that they're hiring (read from LinkedIn's post search
//! by the browser extension, or found on the web), and companies that just raised money (found
//! with a web search). Each is read against your CV for how well you fit and where you'd help,
//! and comes with the people to write to. You write the message; Job Hunt gives you the points
//! worth making, a rough draft if you ask, and keeps track of who you wrote to and who replied.

use crate::claude::{FoundLead, LeadView};
use crate::pipeline::Agent;
use crate::util::now;
use crate::{err, Error, R};
use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Someone to write to at a lead.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Person {
    pub name: String,
    pub role: String,
    /// Their profile (LinkedIn, usually).
    pub link: String,
    pub email: String,
    /// The address is a likely one (first name at the company's site), not one anybody published.
    pub guess: bool,
    /// What you wrote (or the rough draft you asked for), and whether it's the first or the follow-up.
    pub message: String,
    pub sent_at: String,
    pub followed_at: String,
    pub replied_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Lead {
    pub id: String,
    /// "post" (someone saying they're hiring) or "funding" (raised money lately).
    pub kind: String,
    pub company: String,
    pub about: String,
    pub role: String,
    /// "Raised a $4M seed round, announced November 3", or the post in a line.
    pub detail: String,
    /// The post itself, as it was read.
    pub text: String,
    pub url: String,
    /// The company's own site (just the domain), when known.
    pub site: String,
    /// Where it came from: "linkedin", "web" (the search) or "you".
    pub source: String,
    pub found_at: String,
    pub fit: Option<i64>,
    pub help: Vec<String>,
    pub points: Vec<String>,
    pub people: Vec<Person>,
    /// Addresses the company's own site publishes (jobs@, hello@): see `look_for_emails`.
    pub emails: Vec<String>,
    /// "" (open) or "aside" (not for you).
    pub status: String,
}

const KEY: &str = "leads";
/// A week with no reply, then one follow-up: the same as for recruiters (see playbook.rs).
const FOLLOW_UP_AFTER: i64 = crate::playbook::FOLLOW_UP_AFTER;

pub fn all(agent: &Agent) -> Vec<Lead> {
    serde_json::from_str(&agent.secret(KEY)).unwrap_or_default()
}

fn save(agent: &Agent, list: &[Lead]) -> R<()> {
    // Kept: everything you wrote to; of the rest, the newest 300 (set aside ones for a month, so
    // the same post isn't offered again).
    let month_ago = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    let mut keep: Vec<&Lead> = list.iter().filter(|l| l.people.iter().any(|p| !p.sent_at.is_empty()) || l.status != "aside" || l.found_at > month_ago).collect();
    if keep.len() > 300 {
        keep.sort_by(|a, b| b.found_at.cmp(&a.found_at));
        keep.truncate(300);
    }
    let text = json!(keep).to_string();
    agent.db().set(KEY, &text)
}

fn change(agent: &Agent, id: &str, f: impl FnOnce(&mut Lead) -> R<()>) -> R<Lead> {
    let mut list = all(agent);
    let l = list.iter_mut().find(|l| l.id == id).ok_or_else(|| Error("That lead is gone.".into()))?;
    f(l)?;
    let out = l.clone();
    save(agent, &list)?;
    Ok(out)
}

static HIRING: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(#hiring\b|\bwe(['’]| a)?re hiring|i(['’]| a)?m hiring|is hiring|are hiring|now hiring|hiring (a|an|for|our|my|two|three|several|multiple)\b|we(['’]| a)?re (looking|searching) for (a|an)\b|i(['’]| a)?m looking for (a|an) .{0,60}\b(to join|for my team|for our team)|looking to hire|join (my|our) team|open (role|roles|position|positions)\b|growing (my|our|the) team|come work with (me|us)|nous recrutons|on recrute)").unwrap());
static NOT_HIRING: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(#opentowork|open to work|i(['’]| a)?m looking for (a |my )?(new|next) (role|job|opportunity|position)|looking for my next|was laid off|were laid off|hire me\b)").unwrap());

/// Whether a post reads like someone hiring (and not like someone looking for work). A first,
/// free sieve: what passes is read properly afterwards.
pub fn looks_like_hiring(text: &str) -> bool {
    HIRING.is_match(text) && !NOT_HIRING.is_match(text)
}

/// LinkedIn's own post search for each kind of role you look for, newest first, from the last
/// week: (the title, the link). The extension opens these in your browser and reads the results.
pub fn linkedin_searches(agent: &Agent) -> Vec<(String, String)> {
    let p = agent.profile();
    let mut titles: Vec<String> = vec![];
    for t in p.tracks.iter().flat_map(|t| t.titles.iter()) {
        if !titles.iter().any(|x| x.eq_ignore_ascii_case(t)) && !t.trim().is_empty() {
            titles.push(t.trim().to_string());
        }
    }
    titles.into_iter().take(6).map(|t| {
        let q: String = url::form_urlencoded::byte_serialize(format!("\"hiring\" \"{t}\"").as_bytes()).collect();
        (t, format!("https://www.linkedin.com/search/results/content/?keywords={q}&origin=FACETED_SEARCH&sortBy=%22date_posted%22&datePosted=%22past-week%22"))
    }).collect()
}

/// Who you are, for reading a lead: (your name, your CV as text, what you're looking for).
fn candidate(agent: &Agent) -> (String, String, String) {
    let p = agent.profile();
    let cv = p.tracks.iter().find_map(|t| crate::cv::open(&agent.cv_path(&t.name)).ok()).map(|d| d.plain_text()).unwrap_or_default();
    let titles: Vec<&str> = p.tracks.iter().flat_map(|t| t.titles.iter().map(|x| x.as_str())).take(12).collect();
    let mut wants = format!("{} in {}{}", if titles.is_empty() { "roles like my last ones".into() } else { titles.join(", ") },
        if p.locations.is_empty() { "any place".into() } else { p.locations.join(", ") }, if p.remote_ok { " (remote is fine)" } else { "" });
    if !p.guidance.trim().is_empty() {
        wants.push_str(&format!(". {}", p.guidance.trim()));
    }
    (p.name.clone(), cv.chars().take(12000).collect(), wants)
}

/// A domain from what a page or the AI gave as a company's site: "https://www.acme.com/about" is
/// "acme.com". Empty when it isn't one (or is a job board or LinkedIn).
pub fn domain(site: &str) -> String {
    let s = site.trim().to_lowercase();
    if s.is_empty() {
        return String::new();
    }
    let link = if s.contains("://") { s } else { format!("https://{s}") };
    let Some(host) = url::Url::parse(&link).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())) else { return String::new() };
    let ok = host.contains('.') && !host.contains(' ') && !crate::sources::is_job_board(&link) && crate::logos::own_site(&link).is_some()
        && !["linkedin.com", "x.com", "twitter.com", "facebook.com", "medium.com", "substack.com", "techcrunch.com", "crunchbase.com"].iter().any(|h| host.ends_with(h));
    if ok { host } else { String::new() }
}

/// The likely address of someone at a company: their first name at its site. A guess, and shown as one.
pub fn likely_email(name: &str, site: &str) -> String {
    let first: String = name.split_whitespace().next().unwrap_or("").chars().filter(|c| c.is_ascii_alphabetic()).collect::<String>().to_lowercase();
    if first.len() < 2 || domain(site).is_empty() {
        return String::new();
    }
    format!("{first}@{}", domain(site))
}

fn with_likely_emails(l: &mut Lead) {
    for p in l.people.iter_mut().filter(|p| p.email.is_empty()) {
        p.email = likely_email(&p.name, &l.site);
        p.guess = !p.email.is_empty();
    }
}

static EMAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"[A-Za-z0-9][A-Za-z0-9._%+-]{0,40}@[A-Za-z0-9][A-Za-z0-9.-]{1,60}\.[A-Za-z]{2,10}").unwrap());

/// The addresses a company's own site publishes: on its home, contact, about, careers and team
/// pages. Only addresses at that site, at most eight.
pub fn published_emails(http: &reqwest::blocking::Client, base: &str, site: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for path in ["", "/contact", "/about", "/careers", "/team"] {
        let Ok(r) = http.get(format!("{base}{path}")).send() else { continue };
        if !r.status().is_success() {
            continue;
        }
        let html: String = r.text().unwrap_or_default().chars().take(400_000).collect();
        for m in EMAIL.find_iter(&html.replace("&#64;", "@").replace("%40", "@")) {
            let e = m.as_str().trim_end_matches('.').to_lowercase();
            let at_site = e.rsplit('@').next().is_some_and(|d| d == site || d.ends_with(&format!(".{site}")) || site.ends_with(&format!(".{d}")));
            if at_site && ![".png", ".jpg", ".gif", ".svg", ".webp"].iter().any(|x| e.ends_with(x)) && !out.contains(&e) {
                out.push(e);
            }
        }
        if out.len() >= 8 {
            break;
        }
    }
    out.truncate(8);
    out
}

/// Put published addresses where they belong: one with a person's name in it is theirs (and no
/// longer a guess); the rest are the company's (jobs@, hello@).
fn place_emails(l: &mut Lead, found: Vec<String>) {
    for e in found {
        let local = e.split('@').next().unwrap_or("").to_string();
        let whose = l.people.iter_mut().find(|p| {
            let parts: Vec<String> = p.name.to_lowercase().split_whitespace().map(|w| w.chars().filter(|c| c.is_ascii_alphabetic()).collect()).filter(|w: &String| w.len() >= 3).collect();
            parts.first().is_some_and(|f| local.starts_with(f.as_str()) || parts.last().is_some_and(|last| parts.len() > 1 && local.contains(last.as_str())))
        });
        match whose {
            Some(p) if p.email.is_empty() || p.guess => {
                p.email = e;
                p.guess = false;
            }
            Some(_) => {}
            None if !l.emails.contains(&e) => l.emails.push(e),
            None => {}
        }
    }
}

/// Look on the lead's own site for addresses (see published_emails). Ok(how many it found).
pub fn look_for_emails(agent: &Agent, id: &str) -> R<usize> {
    let lead = all(agent).into_iter().find(|l| l.id == id).ok_or_else(|| Error("That lead is gone.".into()))?;
    let site = domain(&lead.site);
    if site.is_empty() {
        return err("Job Hunt doesn't know this company's website. Add it, then look again.");
    }
    let found = published_emails(&crate::sources::http(), &format!("https://{site}"), &site);
    let n = found.len();
    change(agent, id, |l| {
        place_emails(l, found);
        Ok(())
    })?;
    Ok(n)
}

/// Read leads against your CV, eight at a time: who is hiring for what, how well you fit, where
/// you'd help. Those that turn out not to be hiring at all are marked (status "not"), for the
/// caller to drop.
fn size_up(agent: &Agent, leads: &mut [Lead]) -> R<()> {
    let (name, cv, wants) = candidate(agent);
    for chunk in leads.chunks_mut(8) {
        let text = chunk.iter().enumerate().map(|(i, l)| {
            let who = l.people.first().map(|p| format!("{} ({})", p.name, p.role)).unwrap_or_default();
            format!("### {}\nKind: {}\nFrom: {who}\nCompany: {}\nLink: {}\n{}\n{}", i + 1, if l.kind == "funding" { "raised money" } else { "hiring post" }, l.company, l.url, l.detail,
                l.text.chars().take(1800).collect::<String>())
        }).collect::<Vec<_>>().join("\n\n");
        let views: Vec<LeadView> = agent.llm().size_up_leads(&name, &cv, &wants, &text)?;
        for v in views {
            let Some(l) = v.n.checked_sub(1).and_then(|i| chunk.get_mut(i)) else { continue };
            if !v.hiring {
                l.status = "not".into();
                continue;
            }
            if !v.company.trim().is_empty() {
                l.company = v.company.trim().to_string();
            }
            l.about = v.about.trim().to_string();
            l.role = v.role.trim().to_string();
            if l.site.is_empty() {
                l.site = domain(&v.site);
            }
            l.fit = Some(v.fit.clamp(0, 100));
            l.help = v.help.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(3).collect();
            l.points = v.points.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(3).collect();
            with_likely_emails(l);
        }
    }
    Ok(())
}

/// Read the leads that haven't been yet (the AI wasn't set up, or was busy, when they came in).
pub fn size_up_waiting(agent: &Agent) -> R<usize> {
    let mut list = all(agent);
    let mut waiting: Vec<Lead> = list.iter().filter(|l| l.fit.is_none() && l.status.is_empty()).cloned().collect();
    if waiting.is_empty() {
        return Ok(0);
    }
    size_up(agent, &mut waiting)?;
    let n = waiting.len();
    for w in waiting {
        if let Some(l) = list.iter_mut().find(|l| l.id == w.id) {
            *l = w;
        }
    }
    // One you added yourself stays even when it doesn't read as hiring: you know better.
    list.retain(|l| l.status != "not" || l.source == "you");
    list.iter_mut().filter(|l| l.status == "not").for_each(|l| l.status.clear());
    save(agent, &list)?;
    Ok(n)
}

/// A post's link, however it was written: without the scheme, "www.", what follows a "?" and a
/// last "/". (Not db::url_key, which is for job postings and reads LinkedIn links for a job number.)
fn link_key(url: &str) -> String {
    let u = url.trim().to_lowercase();
    let u = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")).unwrap_or(&u);
    let (main, part) = u.split_once('#').unwrap_or((u, ""));
    let main = main.split('?').next().unwrap_or("").trim_start_matches("www.").trim_end_matches('/');
    if part.is_empty() { main.to_string() } else { format!("{main}#{part}") }
}

static AT_COMPANY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\b(?:at|@)\s+([A-Z0-9][^|·•,\n]{1,60})").unwrap());

/// Posts sent from your browser (the extension reads LinkedIn's post search, or the page you're
/// on): [{author, headline, link, text, url}]. `chosen`: you picked this page yourself, so it's
/// kept even when it doesn't read like a hiring post. Returns {seen, hiring, added}.
pub fn add_posts(agent: &Agent, posts: &[Value], chosen: bool) -> R<Value> {
    let mut list = all(agent);
    let mut fresh: Vec<Lead> = vec![];
    let mut hiring = 0;
    for p in posts.iter().take(60) {
        let f = |k: &str| p[k].as_str().unwrap_or("").trim().to_string();
        let (text, url) = (f("text"), f("url"));
        if text.chars().count() < 40 || !(chosen || looks_like_hiring(&text)) {
            continue;
        }
        hiring += 1;
        let id = format!("post:{}", crate::util::short_hash(&if url.is_empty() { text.chars().take(200).collect() } else { link_key(&url) }));
        if list.iter().chain(fresh.iter()).any(|l| l.id == id) || fresh.len() >= 25 {
            continue;
        }
        let (author, headline) = (f("author"), f("headline"));
        let host = url::Url::parse(&url).ok().and_then(|u| u.host_str().map(|h| h.to_lowercase())).unwrap_or_default();
        let company = AT_COMPANY.captures(&headline).map(|c| c[1].trim().to_string()).unwrap_or_default();
        let detail: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect();
        fresh.push(Lead {
            id, kind: "post".into(), company, detail, text: text.chars().take(6000).collect(), url, found_at: now(),
            source: if chosen { "you".into() } else if host.contains("linkedin.") { "linkedin".into() } else { "web".into() },
            people: if author.is_empty() { vec![] } else { vec![Person { name: author, role: headline.chars().take(160).collect(), link: f("link"), ..Default::default() }] },
            ..Default::default()
        });
    }
    // Read against your CV now when the AI is ready; otherwise they wait, unread, for it.
    let mut note = String::new();
    if !fresh.is_empty() && agent.claude_ready() {
        if let Err(e) = size_up(agent, &mut fresh) {
            note = format!("They're kept, but couldn't be read against your CV yet: {}", e.0);
        }
        fresh.retain(|l| l.status != "not" || chosen);
        fresh.iter_mut().for_each(|l| l.status.clear());
    }
    let added = fresh.len();
    if added > 0 {
        let names = fresh.iter().map(|l| if l.company.is_empty() { "a post".to_string() } else { l.company.clone() }).take(5).collect::<Vec<_>>().join(", ");
        list.extend(fresh);
        save(agent, &list)?;
        agent.db().log(None, "leads", &format!("{added} hiring post{} added: {names}", if added == 1 { "" } else { "s" }))?;
    }
    Ok(json!({ "seen": posts.len(), "hiring": hiring, "added": added, "note": note }))
}

/// A post or a piece of funding news you add yourself: its text, or just its link (read from the
/// page when the site lets Job Hunt in; LinkedIn doesn't, so paste a LinkedIn post's text).
pub fn add_own(agent: &Agent, url: &str, text: &str) -> R<Value> {
    let (url, mut text) = (url.trim().to_string(), text.trim().to_string());
    if text.chars().count() < 40 {
        if !url.starts_with("http") {
            return err("Paste the post's text, or the link to it.");
        }
        if url.contains("linkedin.com") {
            return err("LinkedIn doesn't let Job Hunt read a post from its link. Paste the post's text here too, or press the extension's button on the post.");
        }
        let html = crate::sources::http().get(&url).send().and_then(|r| r.text()).map_err(|e| Error(format!("Couldn't open that page ({e}). Paste its text instead.")))?;
        text = page_text(&html);
        if text.chars().count() < 40 {
            return err("Couldn't read anything on that page. Paste its text instead.");
        }
    }
    let r = add_posts(agent, &[json!({ "text": text, "url": url })], true)?;
    if r["added"] == 0 {
        return err("That one is already in your leads.");
    }
    Ok(r)
}

/// A page's words, without its markup, scripts and styles.
fn page_text(html: &str) -> String {
    static DROP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)<(script|style|noscript|svg|nav|footer)\b.*?</(script|style|noscript|svg|nav|footer)>").unwrap());
    static TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<[^>]+>").unwrap());
    let t = TAG.replace_all(&DROP.replace_all(html, " "), " ").replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"");
    t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(6000).collect()
}

fn from_found(f: FoundLead) -> Lead {
    let kind = if f.kind == "post" { "post" } else { "funding" };
    let key = if kind == "funding" { crate::db::company_key(&f.company) } else { link_key(&f.url) };
    let mut l = Lead {
        id: format!("{kind}:{}", crate::util::short_hash(&key)), kind: kind.into(), company: f.company.trim().into(), about: f.about.trim().into(), role: f.role.trim().into(),
        detail: f.detail.trim().into(), url: f.url.trim().into(), site: domain(&f.site), source: "web".into(), found_at: now(), fit: Some(f.fit.clamp(0, 100)),
        help: f.help.into_iter().filter(|x| !x.trim().is_empty()).take(3).collect(), points: f.points.into_iter().filter(|x| !x.trim().is_empty()).take(3).collect(),
        people: f.people.into_iter().filter(|p| !p.name.trim().is_empty()).take(3).map(|p| Person { name: p.name.trim().into(), role: p.role.trim().into(),
            link: Some(p.linkedin.trim().to_string()).filter(|x| x.starts_with("http")).unwrap_or_default(), ..Default::default() }).collect(),
        ..Default::default()
    };
    with_likely_emails(&mut l);
    l
}

/// Look on the web for leads: companies that raised money lately and people saying they're
/// hiring, for your kind of work. Ok(how many new ones). One web search by the AI, so it's run
/// when you ask, or once a day when you've turned that on.
pub fn find(agent: &Agent) -> R<usize> {
    let _g = agent.claim("leads")?;
    let (name, cv, wants) = candidate(agent);
    if cv.is_empty() {
        return err("Add your CV first: leads are read against it.");
    }
    let known = all(agent);
    let skip = known.iter().map(|l| l.company.as_str()).filter(|c| !c.is_empty()).collect::<Vec<_>>().join("\n");
    let found = agent.llm().find_leads(&name, &cv, &wants, &skip);
    let stamp = now();
    agent.db().set("last.leads", &stamp)?;
    let found = found?;
    let mut list = all(agent);
    let mut added = vec![];
    for f in found {
        let l = from_found(f);
        let same_company = |x: &Lead| !l.company.is_empty() && crate::db::company_key(&x.company) == crate::db::company_key(&l.company);
        if list.iter().any(|x| x.id == l.id || same_company(x)) {
            continue;
        }
        added.push(l.id.clone());
        list.push(l);
    }
    save(agent, &list)?;
    // The addresses each company's own site publishes: asked of the site itself, one after another.
    let http = crate::sources::http();
    for id in &added {
        let Some(site) = all(agent).into_iter().find(|l| l.id == *id).map(|l| l.site).filter(|s| !s.is_empty()) else { continue };
        let emails = published_emails(&http, &format!("https://{site}"), &site);
        if !emails.is_empty() {
            let _ = change(agent, id, |l| {
                place_emails(l, emails);
                Ok(())
            });
        }
    }
    if !added.is_empty() {
        let names = list.iter().filter(|l| added.contains(&l.id)).map(|l| l.company.clone()).take(5).collect::<Vec<_>>().join(", ");
        agent.db().log(None, "leads", &format!("{} new lead{} from the web: {names}", added.len(), if added.len() == 1 { "" } else { "s" }))?;
    }
    Ok(added.len())
}

/// Whether the daily look on the web is due: turned on, not done today, and past the hour of the
/// daily search.
pub fn due(agent: &Agent) -> bool {
    use chrono::Timelike;
    if agent.secret("leads.daily") != "1" || agent.is_running("leads") || agent.is_running("search") {
        return false;
    }
    let p = agent.profile();
    let local = Utc::now().with_timezone(&p.tz());
    let today = chrono::DateTime::parse_from_rfc3339(&agent.secret("last.leads")).is_ok_and(|t| t.with_timezone(&p.tz()).date_naive() == local.date_naive());
    !today && local.hour() >= p.search_hour
}

// --- the people, and what you write to them -------------------------------------------------------

fn time(s: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|t| t.with_timezone(&Utc))
}

/// A follow-up is due: written to a week or more ago, no reply, not followed up yet.
fn follow_up_due(p: &Person) -> bool {
    p.replied_at.is_empty() && p.followed_at.is_empty() && time(&p.sent_at).is_some_and(|t| (FOLLOW_UP_AFTER..=30).contains(&(Utc::now() - t).num_days()))
}

/// Change a person (or, with an index one past the last, add one): the fields given, as you typed
/// them. An address you type is yours, not a guess.
pub fn set_person(agent: &Agent, id: &str, index: usize, fields: &Value) -> R<Lead> {
    change(agent, id, |l| {
        if index == l.people.len() {
            if fields["name"].as_str().unwrap_or("").trim().is_empty() {
                return err("Give their name.");
            }
            l.people.push(Person::default());
        }
        let site = l.site.clone();
        let p = l.people.get_mut(index).ok_or_else(|| Error("That person is gone.".into()))?;
        let f = |k: &str| fields[k].as_str().map(|x| x.trim().to_string());
        if let Some(v) = f("name").filter(|v| !v.is_empty()) { p.name = v; }
        if let Some(v) = f("role") { p.role = v; }
        if let Some(v) = f("link") { p.link = v; }
        if let Some(v) = f("message") { p.message = v; }
        if let Some(v) = f("email") {
            if v != p.email {
                p.guess = false;
                p.email = v;
            }
        }
        if p.email.is_empty() {
            p.email = likely_email(&p.name, &site);
            p.guess = !p.email.is_empty();
        }
        Ok(())
    })
}

/// A rough draft to one of a lead's people, for you to rewrite in your own words: the first
/// message, or (a week after it, with no reply) the one follow-up.
pub fn draft(agent: &Agent, id: &str, index: usize) -> R<Lead> {
    let lead = all(agent).into_iter().find(|l| l.id == id).ok_or_else(|| Error("That lead is gone.".into()))?;
    let p = lead.people.get(index).cloned().ok_or_else(|| Error("That person is gone.".into()))?;
    if !p.followed_at.is_empty() {
        return err(format!("You've written to {} and followed up already. That's enough: more would read as chasing.", p.name));
    }
    if let Some(t) = time(&p.sent_at).filter(|t| (Utc::now() - *t).num_days() < FOLLOW_UP_AFTER) {
        return err(format!("You wrote to {} on {}. Give them a week before following up.", p.name, t.with_timezone(&agent.profile().tz()).format("%B %-d")));
    }
    let profile = agent.profile();
    let (name, cv, _) = candidate(agent);
    let job = crate::db::Job {
        id: lead.id.clone(), company: lead.company.clone(), title: if lead.role.is_empty() { "(no role advertised)".into() } else { lead.role.clone() }, url: lead.url.clone(),
        description: format!("{}\n{}\n\n{}", lead.about, lead.detail, lead.text), ..Default::default()
    };
    let who = format!("name: {}\nrole: {}\nemail: {}\nnote: The candidate doesn't know them: a first, cold message.", p.name, p.role, if p.guess { "" } else { p.email.as_str() });
    let mut brief = vec![
        format!("No posting: this is a lead. {}", if lead.kind == "funding" { "The company just raised money and hasn't advertised a role." } else { "This person posted that they're hiring." }),
        format!("Why now: {}", lead.detail),
        if p.sent_at.is_empty() { "Message: the first one".into() } else { "Message: the one follow-up, to a first message with no reply".to_string() },
        "Applied: nothing to apply to".into(),
    ];
    if !lead.points.is_empty() {
        brief.push(format!("Points worth making (facts from the CV):\n- {}", lead.points.join("\n- ")));
    }
    if p.email.is_empty() || p.guess {
        brief.push(format!("LinkedIn note limit: {} characters", if profile.linkedin_note == 200 { 200 } else { 300 }));
    }
    let msg = crate::cv::humanize(&agent.llm().outreach(&name, &cv, &job, &who, &brief.join("\n"))?, &agent.own_words(&job, &profile));
    change(agent, id, |l| {
        l.people[index].message = msg;
        Ok(())
    })
}

/// You sent it: the first message, or (once that's sent) the follow-up.
pub fn sent(agent: &Agent, id: &str, index: usize) -> R<Lead> {
    let l = change(agent, id, |l| {
        let p = l.people.get_mut(index).ok_or_else(|| Error("That person is gone.".into()))?;
        if p.sent_at.is_empty() { p.sent_at = now(); } else { p.followed_at = now(); }
        Ok(())
    })?;
    agent.db().log(None, "leads", &format!("wrote to {} at {}", l.people[index].name, l.company))?;
    Ok(l)
}

/// They wrote back (or, pressed again, they didn't after all).
pub fn replied(agent: &Agent, id: &str, index: usize) -> R<Lead> {
    change(agent, id, |l| {
        let p = l.people.get_mut(index).ok_or_else(|| Error("That person is gone.".into()))?;
        p.replied_at = if p.replied_at.is_empty() { now() } else { String::new() };
        Ok(())
    })
}

/// Not for you (or, with `back`, for you after all).
pub fn set_aside(agent: &Agent, id: &str, back: bool) -> R<Lead> {
    change(agent, id, |l| {
        l.status = if back { String::new() } else { "aside".into() };
        Ok(())
    })
}

/// The company's website, as you give it: then its published addresses can be looked for.
pub fn set_site(agent: &Agent, id: &str, site: &str) -> R<Lead> {
    let d = domain(site);
    if d.is_empty() {
        return err("That doesn't look like a company's website (like acme.com).");
    }
    change(agent, id, |l| {
        l.site = d;
        with_likely_emails(l);
        Ok(())
    })
}

/// Open leads you haven't written to yet: the number on the Queue's Leads tab.
pub fn open_count(agent: &Agent) -> usize {
    all(agent).iter().filter(|l| l.status.is_empty() && !l.people.iter().any(|p| !p.sent_at.is_empty())).count()
}

/// Everything the Leads tab shows: the leads (to write to first, best fit first; then the ones
/// you wrote to; set aside last), and how the looking is set up.
pub fn view(agent: &Agent) -> Value {
    let mut list = all(agent);
    let wrote = |l: &Lead| l.people.iter().any(|p| !p.sent_at.is_empty());
    list.sort_by_key(|l| (l.status == "aside", wrote(l) && !l.people.iter().any(follow_up_due), std::cmp::Reverse(l.fit.unwrap_or(-1)), std::cmp::Reverse(l.found_at.clone())));
    let leads: Vec<Value> = list.iter().map(|l| {
        let mut v = json!(l);
        v["wrote"] = json!(wrote(l));
        v["replied"] = json!(l.people.iter().any(|p| !p.replied_at.is_empty()));
        v["people"] = json!(l.people.iter().map(|p| { let mut pv = json!(p); pv["due"] = json!(follow_up_due(p)); pv }).collect::<Vec<_>>());
        v
    }).collect();
    json!({
        "leads": leads,
        "searching": agent.is_running("leads"),
        "can_search": agent.engine_name() == "code",
        "ready": agent.claude_ready(),
        "daily": agent.secret("leads.daily") == "1",
        "last": Some(agent.secret("last.leads")).filter(|x| !x.is_empty()),
        "error": Some(agent.secret("leads.error")).filter(|x| !x.is_empty()),
        "linkedin": linkedin_searches(agent).into_iter().map(|(t, u)| json!({ "title": t, "url": u })).collect::<Vec<_>>(),
        "extension": !agent.secret("ext.last").is_empty(),
    })
}

/// Look on the web in the background (see find), with a notice when it found any.
pub fn find_in_background(agent: &std::sync::Arc<Agent>) {
    let a = agent.clone();
    std::thread::spawn(move || {
        match find(&a) {
            Ok(n) => {
                let _ = a.db().delete("leads.error");
                if n > 0 {
                    a.note(&format!("{n} new lead{}", if n == 1 { "" } else { "s" }), "Companies that just raised money or are saying they're hiring. They're under Leads in your Queue.");
                }
            }
            Err(e) if e.0.contains("already running") => {}
            Err(e) => {
                let _ = a.db().set("leads.error", &e.0);
                let _ = a.db().log(None, "leads:error", &e.0);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_post_that_reads_like_hiring() {
        for t in ["We're hiring a Senior Program Manager in Toronto!", "I'm hiring for two roles on my team", "Acme is hiring: come build payments with us", "Join our team as a Delivery Lead", "We are looking for a Product Owner to join us", "#hiring Technical Program Manager, remote"] {
            assert!(looks_like_hiring(t), "{t}");
        }
        for t in ["I'm looking for a new role after eight years at Acme. #opentowork", "Great article about hiring trends in 2026", "Hire me! I was laid off last week and we're hiring nobody", "Five tips for your next interview"] {
            assert!(!looks_like_hiring(t), "{t}");
        }
    }

    #[test]
    fn a_companys_site_and_a_likely_address() {
        assert_eq!(domain("https://www.acme.com/about"), "acme.com");
        assert_eq!(domain("Acme.io"), "acme.io");
        for not in ["", "linkedin.com/company/acme", "https://boards.greenhouse.io/acme", "not a site"] {
            assert_eq!(domain(not), "", "{not}");
        }
        assert_eq!(likely_email("Dana Okafor", "acme.com"), "dana@acme.com");
        assert_eq!(likely_email("Dana", ""), "");
        assert_eq!(likely_email("", "acme.com"), "");
    }

    /// A test's setup with the AI set up (as with an API key), so leads are read as they come in.
    fn setup() -> crate::testkit::Setup {
        let s = crate::testkit::setup();
        s.agent.db().set("claude.engine", "api").unwrap();
        s.agent.db().set("claude.key", "test").unwrap();
        s
    }

    fn post(author: &str, text: &str, n: u32) -> Value {
        json!({ "author": author, "headline": "Founder at Brightloop", "link": format!("https://www.linkedin.com/in/{}", author.to_lowercase().replace(' ', "-")),
            "text": text, "url": format!("https://www.linkedin.com/feed/update/urn:li:activity:{n}/") })
    }

    #[test]
    fn hiring_posts_from_the_browser_become_leads() {
        let s = setup();
        let posts = vec![
            post("Dana Okafor", "We're hiring a Senior Program Manager at Brightloop to run our platform rebuild. DM me!", 1),
            post("Sam Lee", "Ten lessons from my first year as a manager. Number three will surprise you, I promise.", 2),
            post("Ravi Patel", "I'm hiring! But this one is really an advert for a course, not a job at all: NOT-HIRING", 3),
            post("Lee Wong", "Brightloop is hiring a Delivery Lead as well: join our team and take the pilots to rollout.", 4),
        ];
        let r = add_posts(&s.agent, &posts, false).unwrap();
        assert_eq!((r["seen"].as_u64(), r["hiring"].as_u64(), r["added"].as_u64()), (Some(4), Some(3), Some(2)), "one isn't about hiring; one read as hiring but isn't");
        let list = all(&s.agent);
        assert_eq!(list.len(), 2, "each post is its own lead");
        assert_eq!(link_key("https://www.LinkedIn.com/feed/update/urn:li:activity:1/?utm=x"), "linkedin.com/feed/update/urn:li:activity:1");
        let l = &list[0];
        assert_eq!((l.kind.as_str(), l.source.as_str(), l.company.as_str()), ("post", "linkedin", "Brightloop"));
        assert_eq!(l.fit, Some(82));
        assert!(!l.help.is_empty() && !l.points.is_empty());
        assert_eq!(l.people[0].name, "Dana Okafor");
        assert_eq!(l.people[0].link, "https://www.linkedin.com/in/dana-okafor");
        // The same posts again: nothing new.
        assert_eq!(add_posts(&s.agent, &posts, false).unwrap()["added"], 0);
        assert_eq!(open_count(&s.agent), 2);
        assert_eq!(s.agent.overview().unwrap()["leads"], 2, "the number on the Queue's Leads tab");
        // One you add yourself is kept even when it doesn't read like hiring.
        let r = add_own(&s.agent, "", "Brightloop's sister company Northwind closed a seed round this week and is building a team.").unwrap();
        assert_eq!(r["added"], 1);
        assert!(add_own(&s.agent, "https://www.linkedin.com/posts/x", "").unwrap_err().0.contains("Paste the post's text"));
    }

    #[test]
    fn writing_to_someone_once_then_one_follow_up() {
        let s = setup();
        add_posts(&s.agent, &[post("Dana Okafor", "We're hiring a Senior Program Manager at Brightloop to run our platform rebuild.", 1)], false).unwrap();
        let id = all(&s.agent)[0].id.clone();
        // Their site, then a likely address, marked as a guess; one you type is yours.
        let l = set_site(&s.agent, &id, "https://www.brightloop.io/").unwrap();
        assert_eq!((l.people[0].email.as_str(), l.people[0].guess), ("dana@brightloop.io", true));
        let l = set_person(&s.agent, &id, 0, &json!({ "email": "dana.okafor@brightloop.io" })).unwrap();
        assert!(!l.people[0].guess);
        // Your own words are kept as typed; a rough draft is there when you ask.
        let l = set_person(&s.agent, &id, 0, &json!({ "message": "Hi Dana, saw your post." })).unwrap();
        assert_eq!(l.people[0].message, "Hi Dana, saw your post.");
        let l = draft(&s.agent, &id, 0).unwrap();
        assert!(l.people[0].message.contains("No posting: this is a lead") && l.people[0].message.contains("the first one"), "{}", l.people[0].message);
        let l = sent(&s.agent, &id, 0).unwrap();
        assert!(!l.people[0].sent_at.is_empty() && l.people[0].followed_at.is_empty());
        assert_eq!(open_count(&s.agent), 0, "written to: no longer waiting for you");
        assert!(draft(&s.agent, &id, 0).unwrap_err().0.contains("Give them a week"));
        // A week on with no reply: a follow-up is due, once.
        change(&s.agent, &id, |l| { l.people[0].sent_at = (Utc::now() - chrono::Duration::days(8)).to_rfc3339(); Ok(()) }).unwrap();
        assert_eq!(view(&s.agent)["leads"][0]["people"][0]["due"], true);
        let l = draft(&s.agent, &id, 0).unwrap();
        assert!(l.people[0].message.contains("the one follow-up"));
        sent(&s.agent, &id, 0).unwrap();
        assert!(draft(&s.agent, &id, 0).unwrap_err().0.contains("That's enough"));
        let l = replied(&s.agent, &id, 0).unwrap();
        assert!(!l.people[0].replied_at.is_empty());
        assert_eq!(view(&s.agent)["leads"][0]["replied"], true);
        // Someone else at the company, added by you.
        let l = set_person(&s.agent, &id, 1, &json!({ "name": "Lee Wong", "role": "CTO" })).unwrap();
        assert_eq!((l.people.len(), l.people[1].email.as_str()), (2, "lee@brightloop.io"));
        assert!(set_aside(&s.agent, &id, false).unwrap().status == "aside");
    }

    #[test]
    fn leads_from_the_web() {
        let s = setup();
        assert!(!due(&s.agent), "the daily look is off until you turn it on");
        let n = find(&s.agent).unwrap();
        assert_eq!(n, 2);
        let list = all(&s.agent);
        let f = list.iter().find(|l| l.kind == "funding").unwrap();
        assert_eq!((f.company.as_str(), f.site.as_str(), f.source.as_str()), ("Northwind Robotics", "northwind.example", "web"));
        assert_eq!(f.people.len(), 2);
        assert_eq!((f.people[0].email.as_str(), f.people[0].guess), ("maya@northwind.example", true));
        assert!(!s.agent.secret("last.leads").is_empty());
        // Again: the same companies aren't added twice (and the AI was told to skip them).
        assert_eq!(find(&s.agent).unwrap(), 0);
        assert!(s.llm.calls.lock().unwrap().iter().any(|c| c.starts_with("find_leads:") && c.contains("Northwind Robotics")));
    }

    #[test]
    fn addresses_a_site_publishes() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
        let h = std::thread::spawn(move || {
            for body in ["<a href=\"mailto:jobs@acme.com\">Jobs</a> or dana.okafor&#64;acme.com, not press@other.com or logo@2x.png", "", "", "", ""] {
                let (mut c, _) = l.accept().unwrap();
                let mut buf = [0u8; 4096];
                let _ = c.read(&mut buf).unwrap();
                write!(c, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        let http = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap();
        let found = published_emails(&http, &base, "acme.com");
        h.join().unwrap();
        assert_eq!(found, vec!["jobs@acme.com".to_string(), "dana.okafor@acme.com".to_string()]);
        // Dana's is hers (no longer a guess); the other is the company's.
        let mut lead = Lead { site: "acme.com".into(), people: vec![Person { name: "Dana Okafor".into(), email: "dana@acme.com".into(), guess: true, ..Default::default() }], ..Default::default() };
        place_emails(&mut lead, found);
        assert_eq!((lead.people[0].email.as_str(), lead.people[0].guess), ("dana.okafor@acme.com", false));
        assert_eq!(lead.emails, vec!["jobs@acme.com".to_string()]);
    }
}
